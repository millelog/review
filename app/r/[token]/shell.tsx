'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Comment, CommentType } from '@/lib/db'
import type { Thread } from '@/lib/comments'

const NAME_KEY = 'review:name'

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
  const [mobile, setMobile] = useState(false)
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
    if (!pending && openId === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setPending(null)
      setOpenId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, openId])

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
      <header style={S.bar}>
        <strong>{project}</strong>
        <span style={S.branch}>{branch}</span>
        <span style={S.branch}>{path}</span>
        <div style={S.spacer} />
        {name && <span style={S.branch}>{name}</span>}
        <button
          id="comment-mode"
          style={S.toggle(commentMode)}
          onClick={() => {
            setPending(null)
            setCommentMode((on) => !on)
          }}
        >
          {commentMode ? 'Click an element…' : 'Comment'}
        </button>
        <button style={S.toggle(!mobile)} onClick={() => setMobile(false)}>
          Desktop
        </button>
        <button style={S.toggle(mobile)} onClick={() => setMobile(true)}>
          Mobile
        </button>
      </header>

      <div style={S.stage}>
        <div style={{ ...S.frameBox, width: mobile ? 390 : '100%' }}>
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
              width={mobile ? 390 : frameRef.current?.clientWidth || 0}
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
          threads={threads}
          outdated={outdated}
          openId={openId}
          showResolved={showResolved}
          onShowResolved={setShowResolved}
          onSelect={focusThread}
          onToggleResolved={toggleResolved}
        />
      </div>

      {ready && !name && <NamePrompt onSubmit={saveName} />}
    </div>
  )

  function saveName(value: string) {
    localStorage.setItem(NAME_KEY, value)
    setName(value)
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
          Post
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
        <strong style={{ fontSize: 13 }}>{comment.author}</strong>
        {comment.type === 'change_request' && <span style={S.chip(true)}>Change request</span>}
        <span style={{ ...S.branch, fontSize: 11 }}>{stamp(comment.created_at)}</span>
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
      <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{comment.body}</p>
    </div>
  )
}

function NamePrompt({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <div style={S.overlay}>
      <form
        style={S.card}
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = value.trim()
          if (trimmed) onSubmit(trimmed)
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>What&rsquo;s your name?</h2>
        <p style={{ margin: 0, color: '#666', fontSize: 14 }}>Shown next to your comments.</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Jane Doe"
          style={S.input}
        />
        <button type="submit" style={S.primary}>
          Start reviewing
        </button>
      </form>
    </div>
  )
}

function Sidebar({
  threads,
  outdated,
  openId,
  showResolved,
  onShowResolved,
  onSelect,
  onToggleResolved,
}: {
  threads: Thread[]
  outdated: number[]
  openId: number | null
  showResolved: boolean
  onShowResolved: (on: boolean) => void
  onSelect: (t: Thread) => void
  onToggleResolved: (id: number) => void
}) {
  const visible = threads.filter((t) => showResolved || t.status === 'open')
  const paths = [...new Set(visible.map((t) => t.path))]

  return (
    <aside style={S.sidebar}>
      <div style={S.sidebarHead}>
        <strong style={{ fontSize: 13 }}>Feedback ({visible.length})</strong>
        <label style={{ ...S.branch, marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => onShowResolved(e.target.checked)}
          />
          Show resolved
        </label>
      </div>

      {visible.length === 0 && <p style={{ ...S.branch, padding: 12 }}>No comments yet.</p>}

      {paths.map((p) => (
        <section key={p}>
          <div style={S.group}>{p}</div>
          {visible
            .filter((t) => t.path === p)
            .map((t) => (
              <div key={t.id} style={S.item(openId === t.id)}>
                <button type="button" style={S.itemBody} onClick={() => onSelect(t)}>
                  <span style={{ fontSize: 13 }}>{t.body}</span>
                  <span style={S.meta}>
                    {t.author}
                    {t.replies.length > 0 && ` · ${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}`}
                  </span>
                </button>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                  {t.type === 'change_request' && <span style={S.badge('#f97316')}>Change request</span>}
                  <span style={S.badge(t.status === 'resolved' ? '#16a34a' : '#64748b')}>{t.status}</span>
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

const S = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    fontFamily: 'system-ui, sans-serif',
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderBottom: '1px solid #e5e5e5',
    fontSize: 14,
  },
  branch: { color: '#666', fontSize: 13 },
  spacer: { flex: 1 },
  toggle: (active: boolean) => ({
    padding: '4px 10px',
    fontSize: 13,
    borderRadius: 6,
    cursor: 'pointer',
    border: '1px solid #ddd',
    background: active ? '#111' : '#fff',
    color: active ? '#fff' : '#111',
  }),
  chip: (active: boolean) => ({
    padding: '3px 8px',
    fontSize: 12,
    borderRadius: 999,
    cursor: 'pointer',
    border: '1px solid #ddd',
    background: active ? '#111' : '#fff',
    color: active ? '#fff' : '#111',
  }),
  stage: { flex: 1, display: 'flex', justifyContent: 'center', background: '#f5f5f5', minHeight: 0 },
  frameBox: { position: 'relative', height: '100%' },
  frame: { width: '100%', height: '100%', border: 0, background: '#fff', display: 'block' },
  catcher: { position: 'absolute', inset: 0 },
  overlayLayer: { position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' },
  pinButton: (at: { x: number; y: number }, change: boolean, open: boolean) => ({
    position: 'absolute',
    left: at.x,
    top: at.y,
    marginLeft: -11,
    marginTop: -11,
    width: 22,
    height: 22,
    padding: 0,
    borderRadius: '50%',
    pointerEvents: 'auto',
    cursor: 'pointer',
    fontSize: 11,
    color: '#fff',
    background: change ? '#f97316' : '#f43f5e',
    border: open ? '2px solid #111' : '2px solid #fff',
    boxShadow: '0 1px 4px rgba(0,0,0,.4)',
  }),
  pin: {
    position: 'absolute',
    width: 14,
    height: 14,
    marginLeft: -7,
    marginTop: -7,
    borderRadius: '50%',
    background: '#f43f5e',
    border: '2px solid #fff',
    boxShadow: '0 1px 4px rgba(0,0,0,.4)',
  },
  compose: {
    position: 'absolute',
    width: 268,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: '#fff',
    padding: 12,
    borderRadius: 10,
    boxShadow: '0 6px 24px rgba(0,0,0,.2)',
  },
  textarea: {
    padding: '8px 10px',
    fontSize: 14,
    fontFamily: 'inherit',
    border: '1px solid #ddd',
    borderRadius: 6,
    resize: 'vertical',
    minHeight: 64,
  },
  ghost: {
    padding: '6px 10px',
    fontSize: 13,
    borderRadius: 6,
    cursor: 'pointer',
    border: '1px solid #ddd',
    background: '#fff',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    background: 'rgba(0,0,0,.4)',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    background: '#fff',
    padding: 24,
    borderRadius: 12,
    width: 320,
  },
  sidebar: {
    width: 280,
    flexShrink: 0,
    borderLeft: '1px solid #e5e5e5',
    background: '#fff',
    overflowY: 'auto',
  },
  sidebarHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderBottom: '1px solid #eee',
  },
  group: {
    padding: '6px 12px',
    fontSize: 12,
    color: '#666',
    background: '#fafafa',
    borderBottom: '1px solid #eee',
  },
  item: (active: boolean) => ({
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '8px 12px',
    borderBottom: '1px solid #f0f0f0',
    background: active ? '#eef2ff' : '#fff',
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
  },
  meta: { fontSize: 11, color: '#666' },
  badge: (color: string) => ({
    padding: '2px 6px',
    fontSize: 11,
    borderRadius: 999,
    background: color,
    color: '#fff',
  }),
  input: { padding: '8px 10px', fontSize: 15, border: '1px solid #ddd', borderRadius: 6 },
  primary: {
    padding: '8px 10px',
    fontSize: 15,
    border: 0,
    borderRadius: 6,
    background: '#111',
    color: '#fff',
    cursor: 'pointer',
  },
} satisfies Record<string, React.CSSProperties | ((...args: never[]) => React.CSSProperties)>
