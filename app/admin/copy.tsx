'use client'

import { useState } from 'react'

export default function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      style={S.button}
      onClick={async () => {
        await navigator.clipboard.writeText(url)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

const S = {
  button: {
    padding: '3px 10px',
    fontSize: 12,
    borderRadius: 6,
    border: '1px solid #ddd',
    background: '#fff',
    cursor: 'pointer',
  },
} satisfies Record<string, React.CSSProperties>
