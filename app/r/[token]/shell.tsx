'use client'

import { useEffect, useState } from 'react'

const NAME_KEY = 'review:name'

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

  useEffect(() => {
    setName(localStorage.getItem(NAME_KEY))
    setReady(true)
  }, [])

  function saveName(value: string) {
    localStorage.setItem(NAME_KEY, value)
    setName(value)
  }

  return (
    <div style={S.page}>
      <header style={S.bar}>
        <strong>{project}</strong>
        <span style={S.branch}>{branch}</span>
        <div style={S.spacer} />
        {name && <span style={S.branch}>{name}</span>}
        <button style={S.toggle(!mobile)} onClick={() => setMobile(false)}>
          Desktop
        </button>
        <button style={S.toggle(mobile)} onClick={() => setMobile(true)}>
          Mobile
        </button>
      </header>

      <div style={S.stage}>
        <iframe
          id="preview"
          src={src}
          title={`${project} — ${branch}`}
          style={{ ...S.frame, width: mobile ? 390 : '100%' }}
        />
      </div>

      {ready && !name && <NamePrompt onSubmit={saveName} />}
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
  stage: { flex: 1, display: 'flex', justifyContent: 'center', background: '#f5f5f5', minHeight: 0 },
  frame: { height: '100%', border: 0, background: '#fff' },
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
} satisfies Record<string, React.CSSProperties | ((active: boolean) => React.CSSProperties)>
