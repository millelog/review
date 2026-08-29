import { listProjects } from '@/lib/admin'
import { LOGO } from '@/lib/brand'
import { addProject, addToken, deleteComment, revoke } from './actions'
import CopyLink from './copy'

export const dynamic = 'force-dynamic'

export default async function Admin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  const projects = listProjects()
  const base = process.env.APP_URL ?? 'https://review.cascadeonline.dev'

  return (
    <main style={S.page}>
      <img src={LOGO} alt="Cascade Online" height={22} style={{ display: 'block', marginBottom: 20 }} />
      <h1 style={S.h1}>Review admin</h1>
      {error ? <p style={S.error}>{error}</p> : null}

      {projects.length === 0 ? <p style={S.muted}>No projects yet.</p> : null}
      {projects.map((p) => (
        <section key={p.id} style={S.card}>
          <div style={S.row}>
            <strong>{p.name}</strong>
            <span style={S.muted}>{p.slug}</span>
            <span style={S.spacer} />
            <span style={S.muted}>
              {p.open_comments} open / {p.total_comments} total
            </span>
          </div>
          <div style={S.muted}>
            {p.vercel_project} · {p.vercel_team}
          </div>

          <ul style={S.list}>
            {p.tokens.map((t) => (
              <li key={t.token} style={S.row}>
                <code style={t.revoked_at ? S.dead : undefined}>
                  {base}/r/{t.token}
                </code>
                <span style={S.muted}>{t.branch}</span>
                <span style={S.spacer} />
                {t.revoked_at ? (
                  <span style={S.muted}>revoked</span>
                ) : (
                  <>
                    <CopyLink url={`${base}/r/${t.token}`} />
                    <form action={revoke}>
                      <input type="hidden" name="token" value={t.token} />
                      <button style={S.button}>Revoke</button>
                    </form>
                  </>
                )}
              </li>
            ))}
          </ul>

          <form action={addToken} style={S.row}>
            <input type="hidden" name="project_id" value={p.id} />
            <input name="branch" placeholder="branch (e.g. feature/pricing)" required style={S.input} />
            <button style={S.primary}>Generate link</button>
          </form>

          {p.comments.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ ...S.muted, cursor: 'pointer' }}>
                Comments ({p.comments.length})
              </summary>
              <ul style={S.list}>
                {p.comments.map((c) => (
                  <li key={c.id} style={{ ...S.row, alignItems: 'flex-start' }}>
                    <span style={S.muted}>
                      {c.branch} {c.path}
                      {c.parent_id ? ' · reply' : ''}
                    </span>
                    <span style={S.body}>
                      <strong>{c.author}:</strong> {c.body}
                    </span>
                    <span style={S.muted}>{c.status}</span>
                    <form action={deleteComment}>
                      <input type="hidden" name="id" value={c.id} />
                      <button style={S.button}>Delete</button>
                    </form>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      ))}

      <section style={S.card}>
        <strong>Add project</strong>
        <form action={addProject} style={S.form}>
          <input name="name" placeholder="Name" required style={S.input} />
          <input name="slug" placeholder="slug" required style={S.input} />
          <input name="vercel_project" placeholder="vercel project" required style={S.input} />
          <input name="vercel_team" placeholder="vercel team" required style={S.input} />
          <button style={S.primary}>Add</button>
        </form>
      </section>
    </main>
  )
}

const S = {
  page: { padding: 32, maxWidth: 860, margin: '0 auto', fontSize: 14 },
  h1: { fontSize: 20, margin: '0 0 16px' },
  error: { padding: '8px 12px', borderRadius: 8, background: '#4a1f1f', color: '#ff9d9d' },
  card: {
    border: '1px solid var(--divider)',
    background: 'var(--card)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  row: { display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' },
  form: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  list: { listStyle: 'none', padding: 0, margin: '10px 0' },
  muted: { color: '#9a9a9a', fontSize: 13 },
  body: { flex: '1 1 240px', minWidth: 0, fontSize: 13, overflowWrap: 'anywhere' },
  dead: { textDecoration: 'line-through', color: '#777' },
  spacer: { flex: 1 },
  input: {
    padding: '6px 10px',
    fontSize: 13,
    borderRadius: 8,
    background: '#262626',
    color: '#fff',
    border: '1px solid var(--divider)',
  },
  button: {
    padding: '5px 12px',
    fontSize: 13,
    borderRadius: 100,
    border: '1px solid var(--divider)',
    background: 'transparent',
    color: '#fff',
    cursor: 'pointer',
  },
  primary: {
    padding: '5px 14px',
    fontSize: 13,
    fontWeight: 700,
    borderRadius: 100,
    border: 0,
    background: 'var(--teal)',
    color: 'var(--dark)',
    cursor: 'pointer',
  },
} satisfies Record<string, React.CSSProperties>
