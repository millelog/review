// review embed bridge: brokers clicks, route changes and pin positions to the review shell.
// Dependency-free, single file, inert outside an iframe.
;(function () {
  'use strict'

  var VOLATILE_DATA = /^data-(react|nextjs|n-|radix|headlessui|floating|testid-gen)/
  var IDENT = /^[A-Za-z][\w-]*$/

  function tagOf(el) {
    return String(el.tagName).toLowerCase()
  }

  function cssEscapeValue(v) {
    return String(v).replace(/["\\]/g, '\\$&')
  }

  function idSelector(el, isUnique) {
    if (!el.id || !IDENT.test(el.id)) return null
    var sel = '#' + el.id
    return isUnique(sel) ? sel : null
  }

  function dataSelector(el, isUnique) {
    var attrs = el.attributes || []
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name
      if (name.indexOf('data-') !== 0 || VOLATILE_DATA.test(name)) continue
      var sel = tagOf(el) + '[' + name + '="' + cssEscapeValue(attrs[i].value) + '"]'
      if (isUnique(sel)) return sel
    }
    return null
  }

  function childIndex(parent, node) {
    var kids = parent.children
    for (var i = 0; i < kids.length; i++) if (kids[i] === node) return i + 1
    return 1
  }

  // id -> stable data-* -> structural nth-child path. Never class-based (utility CSS churns).
  function selectorFor(el, isUnique) {
    if (!isUnique) {
      isUnique = function (sel) {
        try {
          return document.querySelectorAll(sel).length === 1
        } catch (e) {
          return false
        }
      }
    }
    if (!el || !el.tagName) return null
    var direct = idSelector(el, isUnique) || dataSelector(el, isUnique)
    if (direct) return direct

    var parts = []
    var node = el
    while (node && node.tagName) {
      var parent = node.parentElement
      if (!parent) {
        parts.unshift(tagOf(node))
        break
      }
      parts.unshift(tagOf(node) + ':nth-child(' + childIndex(parent, node) + ')')
      var anchor = idSelector(parent, isUnique) || dataSelector(parent, isUnique)
      if (anchor) {
        parts.unshift(anchor)
        break
      }
      node = parent
    }
    return parts.join(' > ')
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { selectorFor: selectorFor }
    return
  }
  if (window.self === window.top) return

  // The shell serves this script, so its own origin is the review origin.
  var src = (document.currentScript && document.currentScript.src) || ''
  var REVIEW_ORIGIN = src ? new URL(src, location.href).origin : ''
  if (!REVIEW_ORIGIN) return

  var commentMode = false
  var tracked = []
  var lastPath = null

  function post(msg) {
    msg.source = 'review-embed'
    parent.postMessage(msg, REVIEW_ORIGIN)
  }

  function currentPath() {
    return location.pathname + location.search + location.hash
  }

  function reportPath() {
    var path = currentPath()
    if (path === lastPath) return
    lastPath = path
    post({ type: 'path', path: path })
  }

  function reportPositions() {
    var positions = []
    var missing = []
    for (var i = 0; i < tracked.length; i++) {
      var pin = tracked[i]
      var el = null
      try {
        el = document.querySelector(pin.selector)
      } catch (e) {}
      if (!el) {
        missing.push(pin.id)
        continue
      }
      var rect = el.getBoundingClientRect()
      positions.push({
        id: pin.id,
        x: rect.left + (pin.offsetX || 0),
        y: rect.top + (pin.offsetY || 0),
      })
    }
    post({ type: 'positions', positions: positions, missing: missing })
  }

  var frame = 0
  function schedulePositions() {
    if (frame) return
    frame = requestAnimationFrame(function () {
      frame = 0
      reportPositions()
    })
  }

  document.addEventListener(
    'click',
    function (e) {
      if (!commentMode) return
      e.preventDefault()
      e.stopPropagation()
      var el = e.target
      var rect = el.getBoundingClientRect()
      post({
        type: 'click',
        selector: selectorFor(el),
        offsetX: Math.round(e.clientX - rect.left),
        offsetY: Math.round(e.clientY - rect.top),
        viewportWidth: window.innerWidth,
        x: e.clientX,
        y: e.clientY,
        path: currentPath(),
      })
    },
    true
  )

  window.addEventListener('message', function (e) {
    if (e.origin !== REVIEW_ORIGIN) return
    var msg = e.data
    if (!msg || msg.source !== 'review') return
    if (msg.type === 'comment-mode') {
      commentMode = !!msg.on
      document.documentElement.style.cursor = commentMode ? 'crosshair' : ''
    } else if (msg.type === 'track') {
      tracked = msg.pins || []
      reportPositions()
    } else if (msg.type === 'scroll-to') {
      var target = null
      try {
        target = document.querySelector(msg.selector)
      } catch (e) {}
      if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      schedulePositions()
    } else if (msg.type === 'ping') {
      lastPath = null
      reportPath()
    }
  })

  ;['pushState', 'replaceState'].forEach(function (name) {
    var orig = history[name]
    history[name] = function () {
      var result = orig.apply(this, arguments)
      reportPath()
      schedulePositions()
      return result
    }
  })
  window.addEventListener('popstate', reportPath)
  window.addEventListener('hashchange', reportPath)
  window.addEventListener('scroll', schedulePositions, true)
  window.addEventListener('resize', schedulePositions)
  window.addEventListener('load', schedulePositions)

  reportPath()
})()
