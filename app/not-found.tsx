import { LOGO } from '@/lib/brand'

export default function NotFound() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          background: 'var(--card)',
          borderRadius: 16,
          padding: 32,
          maxWidth: 420,
          textAlign: 'center',
        }}
      >
        <img src={LOGO} alt="Cascade Online" height={20} />
        <h1 style={{ fontSize: 18, margin: 0 }}>Link not found</h1>
        <p style={{ color: '#9a9a9a', margin: 0, fontSize: 14 }}>
          This review link is invalid or has been revoked.
        </p>
      </div>
    </main>
  )
}
