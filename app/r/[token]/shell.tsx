'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react'
import type { Comment } from '@/lib/db'
import { COMMENT_TYPES, type CommentType } from '@/lib/types'
import type { Thread } from '@/lib/comments'
import { AVATAR_COLORS, avatarColor, LOGO } from '@/lib/brand'
import { previewSize } from '@/lib/preview'

const TYPE_LABEL: Record<CommentType, string> = { comment: 'Comment', change_request: 'Change request', copy: 'Content' }
const TYPE_COLOR: Record<CommentType, string> = { comment: '', change_request: '#c2410c', copy: '#6d28d9' }

const NAME_KEY = 'review:name'
const COLOR_KEY = 'review:color'

const VIEWPORTS = {
  desktop: { width: '100%', height: '100%' },
  tablet: { width: 768, height: 'min(1024px, 100%)' },
  mobile: { width: 390, height: 'min(844px, 100%)' },
} as const
type Viewport = keyof typeof VIEWPORTS

type Pending = {
  x: number
  y: number
  path: string
  selector: string
  text: string
  offsetX: number
  offsetY: number
  viewportWidth: number
}

export default function Shell({
  token,
  project,
  branch,
  src,
  staff = false,
}: {
  token: string
  project: string
  branch: string
  src: string
  staff?: boolean
}) {
  const [name, setName] = useState<string | null>(null)
  const [color, setColor] = useState('')
  const [editingMe, setEditingMe] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [ready, setReady] = useState(false)
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [panelOpen, setPanelOpen] = useState(false)
  const [docked, setDocked] = useState(false)
  const [cardPos, setCardPos] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [commentMode, setCommentMode] = useState(false)
  const [path, setPath] = useState('/')
  const [pending, setPending] = useState<Pending | null>(null)
  const [threads, setThreads] = useState<Thread[]>([])
  const [positions, setPositions] = useState<Record<number, { x: number; y: number }>>({})
  const [openId, setOpenId] = useState<number | null>(null)
  const [outdated, setOutdated] = useState<number[]>([])
  const [loadSeq, setLoadSeq] = useState(0)
  const [showResolved, setShowResolved] = useState(false)
  const [splashLeaving, setSplashLeaving] = useState(false)
  const [dockAnim, setDockAnim] = useState<'min' | 'max' | null>(null)
  const [stalled, setStalled] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const splashRef = useRef<HTMLFormElement>(null)
  const threadsRef = useRef<Thread[]>([])
  const focusRef = useRef<string | null>(null)
  const embedSeenRef = useRef(false)
  const draftRef = useRef(0)

  const previewOrigin = useMemo(() => new URL(src).origin, [src])

  const toFrame = useCallback(
    (msg: Record<string, unknown>) => {
      frameRef.current?.contentWindow?.postMessage({ source: 'review', ...msg }, previewOrigin)
    },
    [previewOrigin],
  )

  useEffect(() => {
    setName(localStorage.getItem(NAME_KEY))
    setColor(localStorage.getItem(COLOR_KEY) ?? '')
    setReady(true)
  }, [])

  const load = useCallback(async () => {
    // the staff feed is the same list plus internal agent notes; Access guards the /admin prefix
    const res = await fetch(`${staff ? '/admin/api' : '/api'}/comments?token=${encodeURIComponent(token)}`)
    if (res.ok) setThreads((await res.json()).comments)
  }, [token, staff])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => clearInterval(timer)
  }, [load])

  threadsRef.current = threads

  const pins = useMemo(
    () => threads.filter((t) => t.path === path && (showResolved || t.status === 'open')),
    [threads, path, showResolved],
  )
  const openThread = pins.find((t) => t.id === openId) ?? null
  const openCount = threads.filter((t) => t.status === 'open').length

  const sendTrack = useCallback(() => {
    toFrame({
      type: 'track',
      pins: pins.map((t) => ({
        id: t.id,
        selector: t.selector,
        offsetX: t.offset_x,
        offsetY: t.offset_y,
      })),
    })
  }, [pins, toFrame])

  useEffect(sendTrack, [sendTrack, loadSeq])

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== frameRef.current?.contentWindow || e.origin !== previewOrigin) return
      const msg = e.data
      if (!msg || msg.source !== 'review-embed') return
      embedSeenRef.current = true
      setStalled(false)
      if (msg.type === 'path') {
        setPath(msg.path)
        if (!draftRef.current) setPending(null)
        setOpenId((id) =>
          id !== null && threadsRef.current.find((t) => t.id === id)?.path === msg.path ? id : null,
        )
      } else if (msg.type === 'click') {
        setPending({
          x: msg.x,
          y: msg.y,
          path: msg.path,
          selector: msg.selector ?? '',
          text: msg.text ?? '',
          offsetX: msg.offsetX,
          offsetY: msg.offsetY,
          viewportWidth: msg.viewportWidth,
        })
        setCommentMode(false)
      } else if (msg.type === 'positions') {
        const next: Record<number, { x: number; y: number }> = {}
        for (const p of msg.positions) next[p.id] = { x: p.x, y: p.y }
        setPositions(next)
        // ponytail: only the current path is tracked, so outdated is per-report, not accumulated.
        setOutdated(msg.missing)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [previewOrigin])

  useEffect(() => {
    toFrame({ type: 'comment-mode', on: commentMode })
  }, [commentMode, toFrame])

  // ponytail: cross-origin, so a failed frame is invisible — infer it from embed.js never checking in.
  useEffect(() => {
    const timer = setTimeout(() => setStalled(!embedSeenRef.current), 8000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || draftRef.current) return
      setPending(null)
      setOpenId(null)
      setCommentMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** Splash exit: fly the splash onto the card's rect while the card scales up to catch it. */
  useLayoutEffect(() => {
    if (!splashLeaving) return
    const splash = splashRef.current
    const card = cardRef.current
    const done = () => setSplashLeaving(false)
    if (!splash || !card || reducedMotion()) return done()
    const s = splash.getBoundingClientRect()
    const c = card.getBoundingClientRect()
    const dx = c.left + c.width / 2 - (s.left + s.width / 2)
    const dy = c.top + c.height / 2 - (s.top + s.height / 2)
    splash.animate(
      [
        { transform: 'none', opacity: 1 },
        { opacity: 1, offset: 0.55 },
        {
          transform: `translate(${dx}px, ${dy}px) scale(${c.width / s.width}, ${c.height / s.height})`,
          opacity: 0,
        },
      ],
      { duration: 620, easing: EXPO, fill: 'forwards' },
    )
    card
      .animate(
        [
          { transform: 'scale(.72)', opacity: 0 },
          { transform: 'scale(.72)', opacity: 0, offset: 0.5 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        { duration: 700, easing: EXPO },
      )
      .finished.then(done, done)
  }, [splashLeaving])

  /** Minimize/maximize: the card flies into the dock (or back out) while the dock rises/sinks. */
  useLayoutEffect(() => {
    if (!dockAnim) return
    const card = cardRef.current
    const dock = dockRef.current
    const done = () => setDockAnim(null)
    if (!card || !dock || reducedMotion()) return done()
    const c = card.getBoundingClientRect()
    const d = dock.getBoundingClientRect()
    const dx = d.left + d.width / 2 - (c.left + c.width / 2)
    const dy = d.top + d.height / 2 - (c.top + c.height / 2)
    const flight = [
      { transform: 'none', opacity: 1 },
      { opacity: 0.9, offset: 0.5 },
      {
        transform: `translate(${dx}px, ${dy}px) scale(${d.width / c.width}, ${d.height / c.height})`,
        opacity: 0,
      },
    ]
    const rise = [
      { transform: 'translateY(110%)', opacity: 0 },
      { transform: 'none', opacity: 1 },
    ]
    if (dockAnim === 'min') {
      card.animate(flight, { duration: 420, easing: EXPO, fill: 'forwards' }).finished.then(done, done)
      dock.animate(rise, { duration: 280, delay: 140, easing: EXPO, fill: 'backwards' })
    } else {
      dock.animate([...rise].reverse(), { duration: 200, easing: 'ease-in', fill: 'forwards' })
      card.animate([...flight].reverse(), { duration: 420, easing: EXPO }).finished.then(done, done)
    }
  }, [dockAnim])

  /** Drag the panel by its header, clamped to the viewport. */
  function onHeaderDown(e: React.PointerEvent) {
    const el = cardRef.current
    if (e.button !== 0 || !el) return
    e.preventDefault()
    const r = el.getBoundingClientRect()
    const dx = e.clientX - r.left
    const dy = e.clientY - r.top
    const move = (ev: PointerEvent) => {
      setDragging(true)
      setCardPos({
        x: Math.min(Math.max(8, ev.clientX - dx), window.innerWidth - r.width - 8),
        y: Math.min(Math.max(8, ev.clientY - dy), window.innerHeight - r.height - 8),
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** POSTs a comment; on failure tells the reviewer instead of silently dropping it. */
  async function post(payload: Record<string, unknown>): Promise<boolean> {
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null)
    if (res?.ok) return true
    alert((await res?.json().catch(() => null))?.error ?? 'Could not post your comment — please try again')
    return false
  }

  async function save(body: string, type: CommentType): Promise<boolean> {
    if (!pending || !name) return false
    const ok = await post({
      token,
      path: pending.path,
      author: name,
      color,
      body,
      type,
      selector: pending.selector,
      element_text: pending.text,
      offset_x: pending.offsetX,
      offset_y: pending.offsetY,
      viewport_width: pending.viewportWidth,
    })
    if (!ok) return false
    setPending(null)
    await load()
    return true
  }

  async function reply(parentId: number, body: string) {
    if (!name) return
    if (await post({ token, path, author: name, color, body, parent_id: parentId })) await load()
  }

  async function toggleResolved(id: number) {
    await fetch(`/api/comments/${id}`, { method: 'PATCH' })
    await load()
  }

  async function remove(id: number, isRoot: boolean) {
    if (!name) return
    if (!confirm(isRoot ? 'Delete this comment and its replies?' : 'Delete this reply?')) return
    const res = await fetch(
      `/api/comments/${id}?token=${encodeURIComponent(token)}&author=${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    )
    if (!res.ok) return alert((await res.json()).error ?? 'Could not delete that comment')
    if (isRoot) setOpenId(null)
    await load()
  }

  async function edit(id: number, body: string) {
    if (!name) return
    const res = await fetch(`/api/comments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, author: name, body }),
    }).catch(() => null)
    if (!res?.ok) return alert((await res?.json().catch(() => null))?.error ?? 'Could not save that edit')
    await load()
  }

  /** Sidebar click: restore the page, preview size and scroll position the comment was left at. */
  function focusThread(t: Thread) {
    if (t.status === 'resolved') setShowResolved(true)
    const size = previewSize(t.viewport_width)
    if (size) setViewport(size)
    if (t.path !== path && frameRef.current) {
      focusRef.current = t.selector // scrolled once the new page loads
      frameRef.current.src = previewOrigin + t.path
    } else if (t.selector) {
      toFrame({ type: 'scroll-to', selector: t.selector })
    }
    setOpenId(t.id)
  }

  return (
    <div style={S.page}>
      <div style={S.stage}>
        <div style={{ ...S.frameBox, ...VIEWPORTS[viewport], ...S.frameShadow(viewport) }}>
          <iframe
            ref={frameRef}
            id="preview"
            src={src}
            title={`${project} — ${branch}`}
            style={S.frame}
            onLoad={() => {
              setPositions({})
              setOutdated([])
              setLoadSeq((n) => n + 1)
              toFrame({ type: 'ping' })
              if (focusRef.current) {
                toFrame({ type: 'scroll-to', selector: focusRef.current })
                focusRef.current = null
              }
            }}
          />
          <div style={S.overlayLayer}>
            {pins.map((t) =>
              positions[t.id] ? (
                <button
                  key={t.id}
                  data-pin={t.id}
                  className="pin-plant"
                  style={{
                    ...S.pinButton(positions[t.id], avatarColor(t.author, t.color), openId === t.id),
                    animationDelay: `${pins.indexOf(t) * 30}ms`,
                  }}
                  onClick={() => setOpenId((id) => (id === t.id ? null : t.id))}
                >
                  {pins.indexOf(t) + 1}
                </button>
              ) : null,
            )}
          </div>

          {openThread && positions[openThread.id] && (
            <ThreadPanel
              key={openThread.id}
              thread={openThread}
              at={positions[openThread.id]}
              width={frameRef.current?.clientWidth || 0}
              me={name}
              draftRef={draftRef}
              onReply={reply}
              onEdit={edit}
              onToggleResolved={toggleResolved}
              onDelete={remove}
              onClose={() => setOpenId(null)}
            />
          )}

          {pending && (
            <div
              style={S.catcher}
              onClick={() => {
                if (!draftRef.current) setPending(null)
              }}
            >
              <div
                className="pin-plant"
                style={{
                  ...S.pin,
                  left: pending.x,
                  top: pending.y,
                  background: avatarColor(name || 'G', color),
                }}
              />
              <Compose
                pending={pending}
                draftRef={draftRef}
                onSave={save}
                onCancel={() => setPending(null)}
              />
            </div>
          )}
        </div>

        <Sidebar
          open={panelOpen}
          threads={threads}
          outdated={outdated}
          openId={openId}
          showResolved={showResolved}
          onShowResolved={setShowResolved}
          onSelect={focusThread}
          onToggleResolved={toggleResolved}
          onClose={() => setPanelOpen(false)}
        />
      </div>

      {stalled && (
        <div className="hint-drop" style={S.hint}>
          <span style={{ ...S.hintDot, background: '#f59e0b' }} />
          The preview isn't responding, so comments won't work here — try refreshing, or let us know
        </div>
      )}

      {commentMode && (
        <div className="hint-drop" style={S.hint}>
          <span style={S.hintDot} />
          Click anywhere on the page to pin a comment · Esc to cancel
        </div>
      )}

      {name && (docked || dockAnim) && (
        <div ref={dockRef} className="dock" style={S.dock}>
          <button
            className={commentMode ? 'teal on' : 'teal'}
            style={S.dockChatBtn}
            title={commentMode ? 'Cancel commenting' : 'Leave a comment'}
            onClick={() => {
              setPending(null)
              setCommentMode((on) => !on)
            }}
          >
            <BubbleIcon />
          </button>
          <button className="gray" style={S.iconBtn} title="Open review panel" onClick={() => {
              setDocked(false)
              setDockAnim('max')
            }}>
            <Chevron up />
          </button>
        </div>
      )}
      {name && (!docked || dockAnim) && (
        <div ref={cardRef} style={S.cardWrap(cardPos, panelOpen)}>
          <div style={S.card}>
            <div style={S.cardHead(dragging)} onPointerDown={onHeaderDown}>
              <img src={LOGO} alt="Cascade Online" height={22} style={{ pointerEvents: 'none' }} />
              <span style={{ flex: 1 }} />
              <GripDots />
              <span style={{ flex: 1 }} />
              <button
                className="gray"
                style={S.iconBtn}
                title="Minimize"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setDocked(true)
                  setDockAnim('min')
                }}
              >
                <Chevron />
              </button>
            </div>

            <div style={{ padding: '14px 16px 16px' }}>
              <div style={S.label}>PREVIEW SIZE</div>
              <div style={S.segment}>
                {(['desktop', 'tablet', 'mobile'] as const).map((v) => (
                  <button
                    key={v}
                    className={viewport === v ? undefined : 'gray'}
                    style={S.vpBtn(viewport === v)}
                    onClick={() => setViewport(v)}
                  >
                    <VpIcon kind={v} />
                    {v[0].toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>

              <button
                id="comment-mode"
                className={commentMode ? 'teal on' : 'teal'}
                style={S.commentBtn}
                onClick={() => {
                  setPending(null)
                  setCommentMode((on) => !on)
                }}
              >
                <BubbleIcon />
                {commentMode ? 'Cancel commenting' : 'Leave a comment'}
              </button>

              <div style={S.cardFoot}>
                <button
                  className="gray"
                  style={S.mePill}
                  title="Edit your name and colour"
                  onClick={() => {
                    setDraftName(name ?? '')
                    setEditingMe((o) => !o)
                  }}
                >
                  <span style={S.avatar(avatarColor(name || 'G', color))}>
                    {(name || 'G')[0].toUpperCase()}
                  </span>
                  <span style={S.who}>{name || 'Guest reviewer'}</span>
                </button>
                <button className="gray" style={S.feedbackBtn(panelOpen)} onClick={() => setPanelOpen((o) => !o)}>
                  Feedback ({openCount})
                </button>
              </div>

              {editingMe && (
                <div style={S.mePanel}>
                  <input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={commitName}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    placeholder="Your name"
                    style={S.meInput}
                  />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {AVATAR_COLORS.map((c) => (
                      <button
                        key={c}
                        title={c}
                        className="swatch"
                        style={S.swatch(c, avatarColor(name || 'G', color) === c)}
                        onClick={() => {
                          setColor(c)
                          localStorage.setItem(COLOR_KEY, c)
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {ready && (!name || splashLeaving) && (
        <NamePrompt
          project={project}
          branch={branch}
          origin={previewOrigin}
          leaving={splashLeaving}
          formRef={splashRef}
          onSubmit={saveName}
        />
      )}
    </div>
  )

  /** Mounts the card immediately; the splash-exit effect above choreographs the handoff. */
  function saveName(value: string) {
    localStorage.setItem(NAME_KEY, value)
    setName(value)
    setSplashLeaving(true)
  }

  /** Blank input keeps the previous name — an empty one would re-trigger the splash. */
  function commitName() {
    const trimmed = draftName.trim()
    if (!trimmed) return setDraftName(name ?? '')
    localStorage.setItem(NAME_KEY, trimmed)
    setName(trimmed)
  }
}

function Compose({
  pending,
  draftRef,
  onSave,
  onCancel,
}: {
  pending: Pending
  draftRef: RefObject<number>
  onSave: (body: string, type: CommentType) => Promise<boolean>
  onCancel: () => void
}) {
  const [body, setBody] = useState('')
  const [type, setType] = useState<CommentType>('comment')
  const [saving, setSaving] = useState(false)
  useDraftGuard(draftRef, body)

  const left = popoverLeft(pending.x, pending.viewportWidth)

  return (
    <form
      className="pop-in"
      style={{
        ...S.compose,
        left,
        top: pending.y + 12,
        transformOrigin: left > pending.x ? 'top left' : 'top right',
      }}
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = body.trim()
        if (!trimmed || saving) return
        setSaving(true)
        onSave(trimmed, type).then((ok) => ok || setSaving(false))
      }}
    >
      <div style={{ display: 'flex', gap: 6 }}>
        {COMMENT_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={type === t ? undefined : 'gray'}
            style={S.chip(type === t)}
            onClick={() => setType(t)}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onInput={autoGrow}
        placeholder={type === 'copy' ? 'Write the final content that should go here' : 'What needs to change here?'}
        style={S.textarea}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="gray" style={S.ghost} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="teal" style={S.primary} disabled={saving}>
          Post comment
        </button>
      </div>
    </form>
  )
}

/** Counts open textareas holding unsaved text, so a stray click or Escape can't discard a draft. */
function useDraftGuard(ref: RefObject<number>, text: string) {
  const dirty = text.trim() !== ''
  useEffect(() => {
    if (!dirty) return
    ref.current += 1
    return () => {
      ref.current -= 1
    }
  }, [ref, dirty])
}

/** Grows with the text up to a few lines, then scrolls. Also usable as a ref, to size existing text on mount. */
function grow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  const borders = el.offsetHeight - el.clientHeight // border-box height needs them back
  el.style.height = `${Math.min(el.scrollHeight + borders, 160)}px`
}

function autoGrow(e: FormEvent<HTMLTextAreaElement>) {
  grow(e.currentTarget)
}

/** Popover sits right of the anchor, flipping left when it would overflow the preview. */
function popoverLeft(x: number, frameWidth: number) {
  const flip = x + 20 + CARD_W + 12 > frameWidth
  return Math.max(8, flip ? x - (CARD_W + 20) : x + 20)
}

function stamp(created: string) {
  return new Date(created.replace(' ', 'T') + 'Z').toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "Mobile" / "Tablet" / "Desktop", or null for replies and pre-tracking comments. */
function sizeLabel(width: number) {
  const size = previewSize(width)
  return size && size[0].toUpperCase() + size.slice(1)
}

function ThreadPanel({
  thread,
  at,
  width,
  me,
  draftRef,
  onReply,
  onEdit,
  onToggleResolved,
  onDelete,
  onClose,
}: {
  thread: Thread
  at: { x: number; y: number }
  width: number
  me: string | null
  draftRef: RefObject<number>
  onReply: (parentId: number, body: string) => Promise<void>
  onEdit: (id: number, body: string) => Promise<void>
  onToggleResolved: (id: number) => void
  onDelete: (id: number, isRoot: boolean) => void
  onClose: () => void
}) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const replyRef = useRef<HTMLTextAreaElement>(null)
  useDraftGuard(draftRef, body)

  const left = popoverLeft(at.x, width)

  return (
    <div
      className="pop-in"
      style={{
        ...S.compose,
        left,
        top: at.y + 12,
        gap: 10,
        transformOrigin: left > at.x ? 'top left' : 'top right',
      }}
      data-thread={thread.id}
    >
      <div style={S.threadScroll}>
        <Entry
          comment={thread}
          draftRef={draftRef}
          onClose={onClose}
          onDelete={thread.author === me ? () => onDelete(thread.id, true) : undefined}
          onEdit={thread.author === me ? (text) => onEdit(thread.id, text) : undefined}
        />
        {thread.replies.map((r) => (
          <Entry
            key={r.id}
            comment={r}
            draftRef={draftRef}
            onDelete={r.author === me ? () => onDelete(r.id, false) : undefined}
            onEdit={r.author === me ? (text) => onEdit(r.id, text) : undefined}
          />
        ))}
      </div>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        onSubmit={async (e) => {
          e.preventDefault()
          const trimmed = body.trim()
          if (!trimmed || saving) return
          setSaving(true)
          await onReply(thread.id, trimmed)
          setBody('')
          if (replyRef.current) replyRef.current.style.height = '' // shrink back after posting
          setSaving(false)
        }}
      >
        <textarea
          ref={replyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onInput={autoGrow}
          placeholder="Reply…"
          style={{ ...S.textarea, minHeight: 44 }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="gray"
            style={S.secondary}
            onClick={() => onToggleResolved(thread.id)}
          >
            {thread.status === 'resolved' ? 'Reopen' : 'Resolve'}
          </button>
          <button type="submit" className="teal" style={{ ...S.primary, flex: 1 }} disabled={saving}>
            Reply
          </button>
        </div>
      </form>
    </div>
  )
}

function Entry({
  comment,
  draftRef,
  onClose,
  onDelete,
  onEdit,
}: {
  comment: Comment
  draftRef: RefObject<number>
  onClose?: () => void
  onDelete?: () => void
  onEdit?: (body: string) => Promise<void>
}) {
  // null means "not editing"; anything else is the working copy of the body
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useDraftGuard(draftRef, draft ?? '')
  const size = sizeLabel(comment.viewport_width)
  // internal rows only ever reach the staff feed; the client link filters them out server-side
  const internal = !!comment.internal
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        ...(internal ? { borderLeft: '2px solid #0369a1', paddingLeft: 8 } : null),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={S.avatar(avatarColor(comment.author, comment.color))}>
          {comment.author[0].toUpperCase()}
        </span>
        <strong style={{ fontSize: 12.5, ...S.ellipsis }}>{comment.author}</strong>
        <span style={{ flex: 1 }} />
        {onEdit && draft === null && (
          <button
            type="button"
            className="gray"
            title="Edit"
            style={{ ...S.iconBtn, padding: 3 }}
            onClick={() => setDraft(comment.body)}
          >
            <PencilIcon />
          </button>
        )}
        {onDelete && (
          <button type="button" className="gray" title="Delete" style={{ ...S.iconBtn, padding: 3 }} onClick={onDelete}>
            <TrashIcon />
          </button>
        )}
        {onClose && (
          <button type="button" className="gray" title="Close" style={{ ...S.iconBtn, padding: 3 }} onClick={onClose}>
            <XIcon />
          </button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {internal && <span style={S.badge('#0369a1')}>Agent note - staff only</span>}
        {comment.type !== 'comment' && !internal && (
          <span style={S.badge(TYPE_COLOR[comment.type])}>{TYPE_LABEL[comment.type]}</span>
        )}
        <span style={{ ...S.muted, fontSize: 11 }}>
          {stamp(comment.created_at)}
          {size && ` · ${size}`}
          {comment.updated_at && ' · edited'}
        </span>
      </div>
      {draft === null ? (
        <p style={{ ...S.commentBody, margin: '3px 0 0', fontSize: 13.5 }}>{comment.body}</p>
      ) : (
        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 3 }}
          onSubmit={async (e) => {
            e.preventDefault()
            const trimmed = draft.trim()
            if (!trimmed || saving) return
            setSaving(true)
            await onEdit?.(trimmed)
            setDraft(null)
            setSaving(false)
          }}
        >
          <textarea
            autoFocus
            ref={grow}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onInput={autoGrow}
            style={{ ...S.textarea, minHeight: 60 }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="gray" style={S.ghost} onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="submit" className="teal" style={S.primary} disabled={saving}>
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ponytail: /favicon.ico only, falls back to our mark; parse the page's <link rel=icon> if sites need it.
function Favicon({ origin }: { origin: string }) {
  const [src, setSrc] = useState(`${origin}/favicon.ico`)
  return (
    <img
      src={src}
      alt=""
      width={14}
      height={14}
      style={{ borderRadius: 3, objectFit: 'contain' }}
      onError={() => setSrc('/mark.png')}
    />
  )
}

function NamePrompt({
  project,
  branch,
  origin,
  leaving,
  formRef,
  onSubmit,
}: {
  project: string
  branch: string
  origin: string
  leaving: boolean
  formRef: RefObject<HTMLFormElement | null>
  onSubmit: (name: string) => void
}) {
  const [value, setValue] = useState('')
  return (
    <div className="overlay-in" style={S.overlay(leaving)}>
      <form
        ref={formRef}
        className="splash-in"
        style={S.splash}
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = value.trim()
          if (!trimmed || leaving) return
          onSubmit(trimmed)
        }}
      >
        <img src={LOGO} alt="Cascade Online Design" height={40} style={{ marginBottom: 26 }} />
        <div style={S.splashTitle}>Preview your site and leave feedback</div>
        <p style={S.splashCopy}>
          This is a preview of your site in progress. Browse it at different screen sizes, and click
          anywhere on a page to leave a comment.
        </p>
        <div style={{ ...S.urlPill, display: 'inline-flex', width: 'auto', marginBottom: 24 }}>
          <Favicon origin={origin} />
          {project}
          <span style={{ opacity: 0.45 }}>·</span>
          {branch}
        </div>
        <label style={S.splashLabel}>
          Your name{' '}
          <span style={{ fontWeight: 400, color: 'rgba(255,255,255,.45)' }}>
            — shown next to your comments
          </span>
        </label>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Jane Doe"
          style={S.input}
        />
        <button
          type="submit"
          className="teal"
          style={{ ...S.primary, width: '100%', padding: 13, fontSize: 14.5 }}
        >
          Start reviewing
        </button>
      </form>
    </div>
  )
}

function Sidebar({
  open,
  threads,
  outdated,
  openId,
  showResolved,
  onShowResolved,
  onSelect,
  onToggleResolved,
  onClose,
}: {
  open: boolean
  threads: Thread[]
  outdated: number[]
  openId: number | null
  showResolved: boolean
  onShowResolved: (on: boolean) => void
  onSelect: (t: Thread) => void
  onToggleResolved: (id: number) => void
  onClose: () => void
}) {
  const visible = threads.filter((t) => showResolved || t.status === 'open')
  const paths = [...new Set(visible.map((t) => t.path))]

  return (
    <aside style={S.sidebar(open)}>
      <div style={S.sidebarHead}>
        <strong style={{ fontSize: 13 }}>Feedback ({visible.length})</strong>
        <label style={{ ...S.muted, marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => onShowResolved(e.target.checked)}
          />
          Show resolved
        </label>
        <button className="gray" style={S.iconBtn} onClick={onClose} title="Close">
          <Chevron right />
        </button>
      </div>

      {visible.length === 0 && <p style={{ ...S.muted, padding: 12 }}>No comments yet.</p>}

      {paths.map((p) => (
        <section key={p}>
          <div style={S.group}>{p}</div>
          {visible
            .filter((t) => t.path === p)
            .map((t) => (
              <div
                key={t.id}
                className={openId === t.id ? undefined : 'row'}
                style={S.item(openId === t.id)}
              >
                <button type="button" style={S.itemBody} onClick={() => onSelect(t)}>
                  <span style={{ ...S.commentBody, fontSize: 13 }}>{t.body}</span>
                  <span style={S.meta}>
                    <span style={S.dot(avatarColor(t.author, t.color))} />
                    {t.author}
                    {sizeLabel(t.viewport_width) && ` · ${sizeLabel(t.viewport_width)}`}
                    {t.replies.length > 0 &&
                      ` · ${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}`}
                  </span>
                </button>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                  {t.type !== 'comment' && <span style={S.badge(TYPE_COLOR[t.type])}>{TYPE_LABEL[t.type]}</span>}
                  <span style={S.badge(t.status === 'resolved' ? '#15803d' : '#475569')}>
                    {t.status}
                  </span>
                  {outdated.includes(t.id) && <span style={S.badge('#a16207')}>outdated</span>}
                  <button
                    type="button"
                    className="gray"
                    style={{ ...S.ghost, marginLeft: 'auto', fontSize: 12 }}
                    onClick={() => onToggleResolved(t.id)}
                  >
                    {t.status === 'resolved' ? 'Reopen' : 'Resolve'}
                  </button>
                </div>
              </div>
            ))}
        </section>
      ))}
    </aside>
  )
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function Chevron({ up, right }: { up?: boolean; right?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 14 14"
      {...stroke}
      style={{ transform: up ? 'rotate(180deg)' : right ? 'rotate(-90deg)' : undefined }}
    >
      <path d="M3 6l4 4 4-4" />
    </svg>
  )
}

function GripDots() {
  return (
    <svg width="11" height="16" viewBox="0 0 10 14" style={{ opacity: 0.35 }}>
      {[2.5, 7, 11.5].map((cy) =>
        [2.5, 7.5].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.4" fill="#fff" />),
      )}
    </svg>
  )
}

function VpIcon({ kind }: { kind: Viewport }) {
  if (kind === 'desktop')
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}>
        <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
        <path d="M5.5 14h5M8 11.5V14" />
      </svg>
    )
  const w = kind === 'tablet' ? 10 : 7
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}>
      <rect x={(16 - w) / 2} y="1.5" width={w} height="13" rx="1.5" />
      <path d="M7 12.5h2" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" {...stroke}>
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" {...stroke}>
      <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.6 9a1 1 0 0 0 1 1h4.8a1 1 0 0 0 1-1L12 4" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" {...stroke}>
      <path d="M11.6 2.4a1.4 1.4 0 0 1 2 2L6 12l-2.6.6.6-2.6zM10.2 3.8l2 2" />
    </svg>
  )
}

function BubbleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}>
      <path d="M14 10a1.5 1.5 0 0 1-1.5 1.5H5l-3 3V3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5z" />
    </svg>
  )
}

const CARD_W = 324
const EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)'
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const DARK = '#1e1e1e'
const HAIRLINE = '1px solid rgba(255,255,255,.09)'

const S = {
  page: { display: 'flex', flexDirection: 'column', height: '100dvh' },
  muted: { color: 'rgba(255,255,255,.55)', fontSize: 12 },
  ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  // anywhere, not break-word: an unbroken 200-char run must break mid-word or it overflows the card
  commentBody: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.5, minWidth: 0 },

  stage: {
    flex: 1,
    display: 'flex',
    justifyContent: 'center',
    background: '#141414',
    minHeight: 0,
    position: 'relative',
    overflow: 'hidden',
  },
  frameBox: { position: 'relative', maxWidth: '100%' },
  frameShadow: (v: Viewport) => ({
    boxShadow:
      v === 'desktop' ? 'none' : '0 0 0 1px rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.5)',
    transition: 'width 450ms var(--ease-out-expo)',
  }),
  frame: { width: '100%', height: '100%', border: 0, background: '#fff', display: 'block' },
  catcher: { position: 'absolute', inset: 0 },
  overlayLayer: { position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' },

  pinButton: (at: { x: number; y: number }, color: string, open: boolean) => ({
    position: 'absolute',
    left: at.x,
    top: at.y,
    transform: 'translate(-50%,-100%)',
    width: 26,
    height: 26,
    padding: 0,
    borderRadius: '50% 50% 50% 4px',
    pointerEvents: 'auto',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 700,
    color: '#fff',
    background: color,
    border: open ? '2px solid #fff' : '2px solid rgba(255,255,255,.85)',
    outline: open ? '2px solid var(--teal)' : 'none',
    boxShadow: '0 4px 12px rgba(0,0,0,.35)',
  }),
  pin: {
    position: 'absolute',
    width: 26,
    height: 26,
    transform: 'translate(-50%,-100%)',
    borderRadius: '50% 50% 50% 4px',
    background: 'var(--teal)',
    border: '2px solid #fff',
    boxShadow: '0 4px 12px rgba(0,0,0,.35)',
  },

  hint: {
    position: 'fixed',
    top: 18,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: DARK,
    color: '#fff',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 100,
    padding: '9px 20px',
    fontSize: 12.5,
    boxShadow: '0 10px 30px rgba(0,0,0,.4)',
    zIndex: 60,
    pointerEvents: 'none',
  },
  hintDot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--teal)' },

  cardWrap: (pos: { x: number; y: number } | null, sidebar: boolean) => ({
    position: 'fixed',
    zIndex: 40,
    touchAction: 'none',
    ...(pos
      ? { left: pos.x, top: pos.y }
      : { right: sidebar ? 324 : 24, bottom: 24, transition: 'right 300ms var(--ease-out-expo)' }),
  }),
  card: {
    width: 288,
    background: DARK,
    color: '#fff',
    border: HAIRLINE,
    borderRadius: 16,
    boxShadow: '0 24px 64px rgba(0,0,0,.5)',
    overflow: 'hidden',
  },
  cardHead: (dragging: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '11px 12px 11px 16px', // trimmed to hold the header height as the logo and icons grew
    cursor: dragging ? 'grabbing' : 'grab',
    borderBottom: '1px solid rgba(255,255,255,.07)',
    background: 'rgba(255,255,255,.03)',
    userSelect: 'none',
  }),
  iconBtn: {
    display: 'flex',
    padding: 5,
    border: 0,
    borderRadius: 6,
    color: 'rgba(255,255,255,.6)',
    cursor: 'pointer',
  },
  urlPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--card)',
    borderRadius: 100,
    padding: '7px 14px',
    marginBottom: 14,
    fontSize: 12,
    color: 'rgba(255,255,255,.75)',
  },
  label: {
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '.1em',
    color: 'rgba(255,255,255,.45)',
    marginBottom: 8,
  },
  segment: {
    display: 'flex',
    gap: 4,
    background: 'var(--card)',
    borderRadius: 100,
    padding: 4,
    marginBottom: 14,
  },
  vpBtn: (active: boolean) => ({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    padding: '8px 2px 7px',
    border: 0,
    borderRadius: 100,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 10.5,
    fontWeight: 600,
    background: active ? 'rgba(255,255,255,.92)' : undefined,
    color: active ? DARK : 'rgba(255,255,255,.6)',
    transition: 'background .25s var(--ease-out-expo), color .25s',
  }),
  commentBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 100,
    padding: 12.5,
    fontFamily: 'inherit',
    fontSize: 13.5,
    fontWeight: 700,
    cursor: 'pointer',
  },
  cardFoot: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 13,
    borderTop: '1px solid rgba(255,255,255,.08)',
  },
  avatar: (color: string) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: color,
    border: '1px solid rgba(255,255,255,.2)',
    color: '#fff',
    fontSize: 10.5,
    fontWeight: 700,
  }),
  mePill: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '3px 5px',
    margin: '-3px -5px',
    border: 0,
    borderRadius: 9,
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
  },
  mePanel: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid rgba(255,255,255,.08)',
  },
  meInput: {
    width: '100%',
    marginBottom: 9,
    padding: '8px 11px',
    fontSize: 13,
    fontFamily: 'inherit',
    background: 'var(--card)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,.14)',
    borderRadius: 9,
    outline: 'none',
  },
  swatch: (color: string, active: boolean) => ({
    width: 22,
    height: 22,
    padding: 0,
    borderRadius: '50%',
    background: color,
    cursor: 'pointer',
    border: active ? '2px solid #fff' : '1px solid rgba(255,255,255,.2)',
  }),
  dot: (color: string) => ({
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: color,
  }),
  who: { flex: 1, fontSize: 12, color: 'rgba(255,255,255,.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  feedbackBtn: (active: boolean) => ({
    border: 0,
    padding: '3px 6px',
    margin: '-3px -6px',
    borderRadius: 8,
    fontFamily: 'inherit',
    fontSize: 11.5,
    fontWeight: 600,
    cursor: 'pointer',
    color: active ? 'var(--teal)' : 'rgba(255,255,255,.55)',
  }),

  dock: {
    position: 'fixed',
    right: 24,
    bottom: 0,
    zIndex: 40,
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    color: 'rgba(255,255,255,.65)',
    border: '1px solid rgba(255,255,255,.1)',
    borderBottom: 'none',
    borderRadius: '14px 14px 0 0',
    padding: '9px 11px 6px',
    cursor: 'pointer',
    boxShadow: '0 -8px 30px rgba(0,0,0,.4)',
  },
  dockChatBtn: { display: 'flex', padding: 6, borderRadius: '50%', cursor: 'pointer' },

  compose: {
    position: 'absolute',
    zIndex: 45,
    width: CARD_W,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: DARK,
    color: '#fff',
    border: '1px solid rgba(255,255,255,.1)',
    padding: 16,
    borderRadius: 16,
    boxShadow: '0 20px 50px rgba(0,0,0,.45)',
  },
  threadScroll: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    overflowY: 'auto',
    maxHeight: 'min(45vh, 400px)',
    marginRight: -6,
    paddingRight: 6,
  },
  textarea: {
    padding: '10px 12px',
    fontSize: 13,
    fontFamily: 'inherit',
    background: 'var(--card)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,.14)',
    borderRadius: 10,
    resize: 'none',
    minHeight: 72,
    maxHeight: 160,
    lineHeight: 1.45,
    outline: 'none',
  },
  chip: (active: boolean) => ({
    padding: '3px 10px',
    fontSize: 11,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    borderRadius: 100,
    cursor: 'pointer',
    border: `1px solid ${active ? 'transparent' : 'rgba(255,255,255,.14)'}`,
    background: active ? 'var(--teal)' : undefined,
    color: active ? DARK : '#fff',
  }),
  ghost: {
    padding: '5px 12px',
    fontSize: 12,
    fontFamily: 'inherit',
    borderRadius: 100,
    cursor: 'pointer',
    border: 0,
    color: 'rgba(255,255,255,.65)',
  },
  secondary: {
    flex: 1,
    padding: '8px 12px',
    fontSize: 12.5,
    fontFamily: 'inherit',
    fontWeight: 600,
    border: '1px solid rgba(255,255,255,.16)',
    borderRadius: 100,
    color: 'rgba(255,255,255,.8)',
    cursor: 'pointer',
  },
  primary: {
    padding: '8px 16px',
    fontSize: 12.5,
    fontFamily: 'inherit',
    fontWeight: 700,
    borderRadius: 100,
    cursor: 'pointer',
  },

  overlay: (leaving: boolean) => ({
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    display: 'grid',
    placeItems: 'center',
    background: leaving ? 'rgba(20,20,20,0)' : 'rgba(20,20,20,.6)',
    backdropFilter: leaving ? 'blur(0px)' : 'blur(4px)',
    transition: 'background 500ms var(--ease-out-expo), backdrop-filter 500ms var(--ease-out-expo)',
    pointerEvents: leaving ? 'none' : 'auto',
  }),
  splash: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    width: 400,
    maxWidth: '86vw',
    background: DARK,
    color: '#fff',
    border: HAIRLINE,
    borderRadius: 24,
    padding: '38px 38px 32px',
    boxShadow: '0 40px 100px rgba(0,0,0,.55)',
  },
  splashTitle: { fontSize: 22, fontWeight: 700, lineHeight: 1.25, marginBottom: 8 },
  splashCopy: {
    margin: '0 0 22px',
    fontSize: 13.5,
    lineHeight: 1.55,
    color: 'rgba(255,255,255,.62)',
  },
  splashLabel: { fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.7)', marginBottom: 7 },
  input: {
    width: '100%',
    padding: '12px 14px',
    fontSize: 14.5,
    fontFamily: 'inherit',
    background: 'var(--card)',
    color: '#fff',
    border: '1.5px solid rgba(255,255,255,.14)',
    borderRadius: 12,
    outline: 'none',
    marginBottom: 14,
  },

  sidebar: (open: boolean) => ({
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    width: 300,
    background: DARK,
    color: '#fff',
    borderLeft: HAIRLINE,
    overflowY: 'auto',
    transform: open ? 'translateX(0)' : 'translateX(100%)',
    transition: 'transform 300ms var(--ease-out-expo)',
  }),
  sidebarHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderBottom: HAIRLINE,
  },
  group: {
    padding: '6px 12px',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '.06em',
    color: 'rgba(255,255,255,.45)',
    background: 'rgba(255,255,255,.03)',
    borderBottom: HAIRLINE,
  },
  item: (active: boolean) => ({
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '10px 12px',
    borderBottom: HAIRLINE,
    borderLeft: `2px solid ${active ? 'var(--teal)' : 'transparent'}`,
    background: active ? 'rgba(42,194,198,.12)' : undefined,
  }),
  itemBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    textAlign: 'left',
    border: 0,
    background: 'none',
    padding: 0,
    cursor: 'pointer',
    font: 'inherit',
    color: 'inherit',
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    color: 'rgba(255,255,255,.45)',
  },
  badge: (color: string) => ({
    padding: '2px 8px',
    fontSize: 10.5,
    fontWeight: 600,
    borderRadius: 999,
    background: color,
    color: '#fff',
  }),
} satisfies Record<string, React.CSSProperties | ((...args: never[]) => React.CSSProperties)>
