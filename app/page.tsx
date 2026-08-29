import { LOGO } from '@/lib/brand'

export default function Home() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <img src={LOGO} alt="Cascade Online" height={28} />
        <p style={{ margin: 0, color: '#9a9a9a', fontSize: 14 }}>Design review</p>
      </div>
    </main>
  )
}
