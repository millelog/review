// review embed bridge: brokers clicks, route changes and pin positions to the review shell.
// Dependency-free, single file, inert outside an iframe.
;(function () {
  'use strict'

  var VOLATILE_DATA = /^data-(react|nextjs|n-|nimg|radix|headlessui|floating|testid-gen)/
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
    // Extensions (Grammarly) and theme toggles own html/body attributes; they differ per browser.
    var tag = tagOf(el)
    if (tag === 'html' || tag === 'body') return null
    var attrs = el.attributes || []
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name
      if (name.indexOf('data-') !== 0 || VOLATILE_DATA.test(name)) continue
      var sel = tagOf(el) + '[' + name + '="' + cssEscapeValue(attrs[i].value) + '"]'
      if (isUnique(sel)) return sel
    }
    return null
  }

  // Greppable handle for the element: rendered text, else alt/aria-label.
  function textOf(el) {
    var t = el.innerText || el.textContent || el.getAttribute('alt') || el.getAttribute('aria-label') || ''
    t = String(t).trim().replace(/\s+/g, ' ')
    return t.length > 120 ? t.slice(0, 120) : t
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

  // Selector first; else the first same-tag element whose text matches (survives extension attrs, reordering).
  function resolvePin(pin, doc) {
    var el = null
    try {
      el = doc.querySelector(pin.selector)
    } catch (e) {}
    if (el || !pin.text) return el
    var leaf = String(pin.selector || '').split(' > ').pop()
    var m = /^[a-z][\w-]*/i.exec(leaf)
    var all = doc.getElementsByTagName(m ? m[0] : '*')
    for (var i = 0; i < all.length; i++) if (textOf(all[i]) === pin.text) return all[i]
    return null
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { selectorFor: selectorFor, textOf: textOf, resolvePin: resolvePin }
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
  var dirty = true // DOM changed since pins were last resolved
  var pendingScroll = null // {selector, text, until}: a scroll-to whose target hasn't rendered yet

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
    pendingScroll = null
    post({ type: 'path', path: path })
  }

  function scrollInto(target) {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function reportPositions() {
    var positions = []
    var missing = []
    if (pendingScroll && dirty) {
      var found = resolvePin(pendingScroll, document)
      if (found) scrollInto(found)
      if (found || Date.now() > pendingScroll.until) pendingScroll = null
    }
    for (var i = 0; i < tracked.length; i++) {
      var pin = tracked[i]
      // ponytail: cached element; re-resolve only after a DOM change, so scroll frames stay cheap.
      if (dirty && (!pin.el || !pin.el.isConnected)) pin.el = resolvePin(pin, document)
      var el = pin.el && pin.el.isConnected ? pin.el : null
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
    dirty = false
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
        text: textOf(el),
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
      dirty = true
      reportPositions()
    } else if (msg.type === 'scroll-to') {
      var target = resolvePin(msg, document)
      if (target) scrollInto(target)
      else pendingScroll = { selector: msg.selector, text: msg.text, until: Date.now() + 10000 }
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
  new MutationObserver(function () {
    dirty = true
    schedulePositions()
  }).observe(document.documentElement, { childList: true, subtree: true })

  reportPath()
})()
