'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Comment, CommentType } from '@/lib/db'
import type { Thread } from '@/lib/comments'
import { LOGO } from '@/lib/brand'

const NAME_KEY = 'review:name'

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
  offsetX: number
  offsetY: number
  viewportWidth: number
}

export default function Shell({
  token,
  project,
  branch,
  src,
}: {
  token: string
  project: string
  branch: string
  src: string
}) {
  const [name, setName] = useState<string | null>(null)
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
  const frameRef = useRef<HTMLIFrameElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const threadsRef = useRef<Thread[]>([])

  const previewOrigin = useMemo(() => new URL(src).origin, [src])

  const toFrame = useCallback(
    (msg: Record<string, unknown>) => {
      frameRef.current?.contentWindow?.postMessage({ source: 'review', ...msg }, previewOrigin)
    },
    [previewOrigin],
  )

  useEffect(() => {
    setName(localStorage.getItem(NAME_KEY))
    setReady(true)
  }, [])

  const load = useCallback(async () => {
    const res = await fetch(`/api/comments?token=${encodeURIComponent(token)}`)
    if (res.ok) setThreads((await res.json()).comments)
  }, [token])

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
      if (msg.type === 'path') {
        setPath(msg.path)
        setPending(null)
        setOpenId((id) =>
          id !== null && threadsRef.current.find((t) => t.id === id)?.path === msg.path ? id : null,
        )
      } else if (msg.type === 'click') {
        setPending({
          x: msg.x,
          y: msg.y,
          path: msg.path,
          selector: msg.selector ?? '',
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setPending(null)
      setOpenId(null)
      setCommentMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  async function save(body: string, type: CommentType) {
    if (!pending || !name) return
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        path: pending.path,
        author: name,
        body,
        type,
        selector: pending.selector,
        offset_x: pending.offsetX,
        offset_y: pending.offsetY,
        viewport_width: pending.viewportWidth,
      }),
    })
    setPending(null)
    await load()
  }

  async function reply(parentId: number, body: string) {
    if (!name) return
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, path, author: name, body, parent_id: parentId }),
    })
    await load()
  }

  async function toggleResolved(id: number) {
    await fetch(`/api/comments/${id}`, { method: 'PATCH' })
    await load()
  }

  /** Sidebar click: navigate the iframe to the comment's path, then highlight its pin. */
  function focusThread(t: Thread) {
    if (t.status === 'resolved') setShowResolved(true)
    if (t.path !== path && frameRef.current) frameRef.current.src = previewOrigin + t.path
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
            }}
          />
          <div style={S.overlayLayer}>
            {pins.map((t) =>
              positions[t.id] ? (
                <button
                  key={t.id}
                  data-pin={t.id}
                  style={S.pinButton(positions[t.id], t.type === 'change_request', openId === t.id)}
                  onClick={() => setOpenId((id) => (id === t.id ? null : t.id))}
                >
                  {pins.indexOf(t) + 1}
                </button>
              ) : null,
            )}
          </div>

          {openThread && positions[openThread.id] && (
            <ThreadPanel
              thread={openThread}
              at={positions[openThread.id]}
              width={frameRef.current?.clientWidth || 0}
              onReply={reply}
              onToggleResolved={toggleResolved}
              onClose={() => setOpenId(null)}
            />
          )}

          {pending && (
            <div style={S.catcher} onClick={() => setPending(null)}>
              <div style={{ ...S.pin, left: pending.x, top: pending.y }} />
              <Compose pending={pending} onSave={save} onCancel={() => setPending(null)} />
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

      {commentMode && (
        <div style={S.hint}>
          <span style={S.hintDot} />
          Click anywhere on the page to pin a comment · Esc to cancel
        </div>
      )}

      {!name ? null : docked ? (
        <button style={S.dock} onClick={() => setDocked(false)} title="Open review panel">
          <img src="/mark.png" alt="" width={16} height={16} />
          <Chevron up />
          {openCount > 0 && <span style={S.dockBadge}>{openCount}</span>}
        </button>
      ) : (
        <div ref={cardRef} style={S.cardWrap(cardPos, panelOpen)}>
          <div style={S.card}>
            <div style={S.cardHead(dragging)} onPointerDown={onHeaderDown}>
              <img src={LOGO} alt="Cascade Online" height={15} style={{ pointerEvents: 'none' }} />
              <span style={{ flex: 1 }} />
              <GripDots />
              <span style={{ flex: 1 }} />
              <button
                style={S.iconBtn}
                title="Minimize"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setDocked(true)}
              >
                <Chevron />
              </button>
            </div>

            <div style={{ padding: '14px 16px 16px' }}>
              <div style={S.urlPill}>
                <img src="/mark.png" alt="" width={14} height={14} />
                <span style={S.ellipsis}>{project}</span>
                <span style={{ opacity: 0.45 }}>·</span>
                <span style={S.ellipsis}>{branch}</span>
              </div>

              <div style={S.label}>PREVIEW SIZE</div>
              <div style={S.segment}>
                {(['desktop', 'tablet', 'mobile'] as const).map((v) => (
                  <button key={v} style={S.vpBtn(viewport === v)} onClick={() => setViewport(v)}>
                    <VpIcon kind={v} />
                    {v[0].toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>

              <button
                id="comment-mode"
                style={S.commentBtn(commentMode)}
                onClick={() => {
                  setPending(null)
                  setCommentMode((on) => !on)
                }}
              >
                <BubbleIcon />
                {commentMode ? 'Cancel commenting' : 'Leave a comment'}
              </button>

              <div style={S.cardFoot}>
                <span style={S.avatar}>{(name || 'G')[0].toUpperCase()}</span>
                <span style={S.who}>{name || 'Guest reviewer'}</span>
                <button style={S.feedbackBtn(panelOpen)} onClick={() => setPanelOpen((o) => !o)}>
                  Feedback ({openCount})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {ready && !name && <NamePrompt project={project} branch={branch} onSubmit={saveName} />}
    </div>
  )

  /** Delayed so the splash can play its collapse-into-the-panel transition. */
  function saveName(value: string) {
    localStorage.setItem(NAME_KEY, value)
    setTimeout(() => setName(value), 480)
  }
}

function Compose({
  pending,
  onSave,
  onCancel,
}: {
  pending: Pending
  onSave: (body: string, type: CommentType) => void
  onCancel: () => void
}) {
  const [body, setBody] = useState('')
  const [type, setType] = useState<CommentType>('comment')
  const [saving, setSaving] = useState(false)

  const left = popoverLeft(pending.x, pending.viewportWidth)

  return (
    <form
      style={{ ...S.compose, left, top: pending.y + 12 }}
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = body.trim()
        if (!trimmed || saving) return
        setSaving(true)
        onSave(trimmed, type)
      }}
    >
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" style={S.chip(type === 'comment')} onClick={() => setType('comment')}>
          Comment
        </button>
        <button
          type="button"
          style={S.chip(type === 'change_request')}
          onClick={() => setType('change_request')}
        >
          Change request
        </button>
      </div>
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What needs to change here?"
        style={S.textarea}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" style={S.ghost} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" style={S.primary} disabled={saving}>
          Post comment
        </button>
      </div>
    </form>
  )
}

/** Popover sits right of the anchor, flipping left when it would overflow the preview. */
function popoverLeft(x: number, frameWidth: number) {
  const flip = x + 20 + 280 > frameWidth
  return Math.max(8, flip ? x - 288 : x + 20)
}

function stamp(created: string) {
  return new Date(created.replace(' ', 'T') + 'Z').toLocaleString()
}

function ThreadPanel({
  thread,
  at,
  width,
  onReply,
  onToggleResolved,
  onClose,
}: {
  thread: Thread
  at: { x: number; y: number }
  width: number
  onReply: (parentId: number, body: string) => Promise<void>
  onToggleResolved: (id: number) => void
  onClose: () => void
}) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  return (
    <div
      style={{ ...S.compose, left: popoverLeft(at.x, width), top: at.y + 12, gap: 10 }}
      data-thread={thread.id}
    >
      <Entry
        comment={thread}
        onClose={onClose}
        onToggleResolved={() => onToggleResolved(thread.id)}
      />
      {thread.replies.map((r) => (
        <Entry key={r.id} comment={r} />
      ))}
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        onSubmit={async (e) => {
          e.preventDefault()
          const trimmed = body.trim()
          if (!trimmed || saving) return
          setSaving(true)
          await onReply(thread.id, trimmed)
          setBody('')
          setSaving(false)
        }}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Reply…"
          style={{ ...S.textarea, minHeight: 44 }}
        />
        <button type="submit" style={S.primary} disabled={saving}>
          Reply
        </button>
      </form>
    </div>
  )
}

function Entry({
  comment,
  onClose,
  onToggleResolved,
}: {
  comment: Comment
  onClose?: () => void
  onToggleResolved?: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={S.avatar}>{comment.author[0].toUpperCase()}</span>
        <strong style={{ fontSize: 12.5 }}>{comment.author}</strong>
        {comment.type === 'change_request' && <span style={S.chip(true)}>Change request</span>}
        <span style={{ ...S.muted, fontSize: 11 }}>{stamp(comment.created_at)}</span>
        {onToggleResolved && (
          <button
            type="button"
            style={{ ...S.ghost, marginLeft: 'auto' }}
            onClick={onToggleResolved}
          >
            {comment.status === 'resolved' ? 'Reopen' : 'Resolve'}
          </button>
        )}
        {onClose && (
          <button type="button" style={S.ghost} onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
        {comment.body}
      </p>
    </div>
  )
}

function NamePrompt({
  project,
  branch,
  onSubmit,
}: {
  project: string
  branch: string
  onSubmit: (name: string) => void
}) {
  const [value, setValue] = useState('')
  const [leaving, setLeaving] = useState(false)
  return (
    <div style={S.overlay(leaving)}>
      <form
        style={S.splash(leaving)}
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = value.trim()
          if (!trimmed) return
          setLeaving(true)
          onSubmit(trimmed)
        }}
      >
        <img src={LOGO} alt="Cascade Online Design" height={30} style={{ marginBottom: 26 }} />
        <div style={S.splashTitle}>You&rsquo;re invited to review a work-in-progress.</div>
        <p style={S.splashCopy}>
          Browse the site exactly as it will ship, switch device sizes, and pin comments right on the
          page. We see them instantly.
        </p>
        <div style={{ ...S.urlPill, display: 'inline-flex', width: 'auto', marginBottom: 24 }}>
          <img src="/mark.png" alt="" width={14} height={14} />
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
        <button type="submit" style={{ ...S.primary, width: '100%', padding: 13, fontSize: 14.5 }}>
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
        <button style={S.iconBtn} onClick={onClose} title="Close">
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
              <div key={t.id} style={S.item(openId === t.id)}>
                <button type="button" style={S.itemBody} onClick={() => onSelect(t)}>
                  <span style={{ fontSize: 13, lineHeight: 1.45 }}>{t.body}</span>
                  <span style={S.meta}>
                    {t.author}
                    {t.replies.length > 0 &&
                      ` · ${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}`}
                  </span>
                </button>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                  {t.type === 'change_request' && <span style={S.badge('#f97316')}>Change request</span>}
                  <span style={S.badge(t.status === 'resolved' ? '#16a34a' : '#64748b')}>
                    {t.status}
                  </span>
                  {outdated.includes(t.id) && <span style={S.badge('#a16207')}>outdated</span>}
                  <button
                    type="button"
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
      width="14"
      height="14"
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
    <svg width="10" height="14" viewBox="0 0 10 14" style={{ opacity: 0.35 }}>
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

function BubbleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}>
      <path d="M14 10a1.5 1.5 0 0 1-1.5 1.5H5l-3 3V3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5z" />
    </svg>
  )
}

const DARK = '#1e1e1e'
const HAIRLINE = '1px solid rgba(255,255,255,.09)'

const S = {
  page: { display: 'flex', flexDirection: 'column', height: '100dvh' },
  muted: { color: 'rgba(255,255,255,.55)', fontSize: 12 },
  ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

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

  pinButton: (at: { x: number; y: number }, change: boolean, open: boolean) => ({
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
    color: DARK,
    background: change ? '#f97316' : 'var(--teal)',
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
    ...(pos ? { left: pos.x, top: pos.y } : { right: sidebar ? 324 : 24, bottom: 24 }),
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
    padding: '12px 12px 12px 16px',
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
    background: 'none',
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
    background: active ? 'rgba(255,255,255,.92)' : 'transparent',
    color: active ? DARK : 'rgba(255,255,255,.6)',
    transition: 'background .25s var(--ease-out-expo), color .25s',
  }),
  commentBtn: (on: boolean) => ({
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    border: on ? '1.5px solid var(--teal)' : 'none',
    background: on ? 'transparent' : 'var(--teal)',
    color: on ? 'var(--teal)' : DARK,
    borderRadius: 100,
    padding: on ? 10.5 : 12,
    fontFamily: 'inherit',
    fontSize: 13.5,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'background .25s, color .25s',
  }),
  cardFoot: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 13,
    borderTop: '1px solid rgba(255,255,255,.08)',
  },
  avatar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: 'var(--card)',
    border: '1px solid rgba(255,255,255,.2)',
    color: 'rgba(255,255,255,.85)',
    fontSize: 10.5,
    fontWeight: 700,
  },
  who: { flex: 1, fontSize: 12, color: 'rgba(255,255,255,.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  feedbackBtn: (active: boolean) => ({
    border: 0,
    background: 'none',
    padding: 0,
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
    background: DARK,
    color: 'rgba(255,255,255,.65)',
    border: '1px solid rgba(255,255,255,.1)',
    borderBottom: 'none',
    borderTop: '2px solid var(--teal)',
    borderRadius: '12px 12px 0 0',
    padding: '9px 15px 11px',
    cursor: 'pointer',
    boxShadow: '0 -8px 30px rgba(0,0,0,.4)',
  },
  dockBadge: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 16,
    height: 16,
    padding: '0 4px',
    borderRadius: 8,
    background: 'var(--teal)',
    color: DARK,
    fontSize: 10,
    fontWeight: 700,
  },

  compose: {
    position: 'absolute',
    zIndex: 22,
    width: 268,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: DARK,
    color: '#fff',
    border: '1px solid rgba(255,255,255,.1)',
    padding: 14,
    borderRadius: 16,
    boxShadow: '0 20px 50px rgba(0,0,0,.45)',
  },
  textarea: {
    padding: '10px 12px',
    fontSize: 13,
    fontFamily: 'inherit',
    background: 'var(--card)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,.14)',
    borderRadius: 10,
    resize: 'vertical',
    minHeight: 72,
    outline: 'none',
  },
  chip: (active: boolean) => ({
    padding: '3px 10px',
    fontSize: 11,
    fontFamily: 'inherit',
    borderRadius: 100,
    cursor: 'pointer',
    border: `1px solid ${active ? 'transparent' : 'rgba(255,255,255,.14)'}`,
    background: active ? 'var(--teal)' : 'transparent',
    color: active ? DARK : '#fff',
  }),
  ghost: {
    padding: '5px 12px',
    fontSize: 12,
    fontFamily: 'inherit',
    borderRadius: 100,
    cursor: 'pointer',
    border: 0,
    background: 'none',
    color: 'rgba(255,255,255,.65)',
  },
  primary: {
    padding: '8px 16px',
    fontSize: 12.5,
    fontFamily: 'inherit',
    fontWeight: 700,
    border: 0,
    borderRadius: 100,
    background: 'var(--teal)',
    color: DARK,
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
  splash: (leaving: boolean) => ({
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
    transform: leaving ? 'translate(35vw, 35vh) scale(.1)' : 'none',
    opacity: leaving ? 0 : 1,
    transition: 'transform 560ms var(--ease-out-expo), opacity 420ms 80ms var(--ease-out-expo)',
  }),
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
    zIndex: 45,
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
    background: active ? 'rgba(42,194,198,.12)' : 'transparent',
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
  meta: { fontSize: 11, color: 'rgba(255,255,255,.45)' },
  badge: (color: string) => ({
    padding: '2px 8px',
    fontSize: 10.5,
    fontWeight: 600,
    borderRadius: 999,
    background: color,
    color: '#fff',
  }),
} satisfies Record<string, React.CSSProperties | ((...args: never[]) => React.CSSProperties)>
