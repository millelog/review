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

  // ponytail: a 40-char opening survives rewording further down the paragraph; full text often doesn't.
  function textKey(t) {
    return String(t || '').slice(0, 40)
  }

  // Exact: selector hit whose text still matches, else the first same-tag element opening with the stored
  // text. Approximate (copy edited or element gone): the bare selector hit, else the same slot in the
  // nearest surviving ancestor from the selector path, so the pin still lands where the comment was left.
  function resolvePin(pin, doc) {
    var el = null
    try {
      el = doc.querySelector(pin.selector)
    } catch (e) {}
    if (!pin.text) return { el: el, exact: !!el }
    var key = textKey(pin.text)
    if (el && textKey(textOf(el)) === key) return { el: el, exact: true }
    var parts = String(pin.selector || '').split(' > ')
    var m = /^[a-z][\w-]*/i.exec(parts[parts.length - 1])
    var all = doc.getElementsByTagName(m ? m[0] : '*')
    for (var i = 0; i < all.length; i++) if (textKey(textOf(all[i])) === key) return { el: all[i], exact: true }
    if (el) return { el: el, exact: false }
    while (parts.length > 1) {
      var leaf = parts.pop()
      var parent = null
      try {
        parent = doc.querySelector(parts.join(' > '))
      } catch (e) {}
      if (!parent) continue
      var n = /nth-child\((\d+)\)/.exec(leaf)
      var kids = parent.children || []
      var slot = kids[Math.min((n ? +n[1] : 1) - 1, kids.length - 1)]
      return { el: slot || parent, exact: false }
    }
    return { el: null, exact: false }
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
    // A closed <details> has no layout for its content, so scrollIntoView would be a no-op.
    for (var d = target.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function reportPositions() {
    var positions = []
    var missing = []
    if (pendingScroll && dirty) {
      var found = resolvePin(pendingScroll, document).el
      if (found) scrollInto(found)
      if (found || Date.now() > pendingScroll.until) pendingScroll = null
    }
    for (var i = 0; i < tracked.length; i++) {
      var pin = tracked[i]
      // ponytail: cached element; re-resolve only after a DOM change, so scroll frames stay cheap.
      if (dirty && (!pin.el || !pin.el.isConnected || !pin.exact)) {
        var hit = resolvePin(pin, document)
        pin.el = hit.el
        pin.exact = hit.exact
      }
      var el = pin.el && pin.el.isConnected ? pin.el : null
      if (!el || !pin.exact) missing.push(pin.id)
      if (!el) continue
      var rect = el.getBoundingClientRect()
      if (!rect.width && !rect.height) continue // hidden (e.g. inside a closed <details>): no pin to draw
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
      var target = resolvePin(msg, document).el
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
