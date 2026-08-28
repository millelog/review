import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'review-')), 'test.db')
const { getTokenContext } = await import('./db.ts')
const { listProjects, createProject, mintToken, revokeToken } = await import('./admin.ts')
const { createComment } = await import('./comments.ts')

test('create project, mint token, revoke, counts', () => {
  const p = createProject({ name: 'Acme', slug: 'acme', vercel_project: 'acme-site', vercel_team: 'cascade' })
  assert.equal(p.slug, 'acme')

  assert.throws(() => createProject({ name: 'Dup', slug: 'acme', vercel_project: 'x', vercel_team: 'y' }), /taken/)
  assert.throws(() => createProject({ name: ' ', slug: 'b', vercel_project: 'x', vercel_team: 'y' }), /name/)

  const t = mintToken(p.id, 'feature/x')
  assert.ok(t.token.length >= 8)
  assert.equal(getTokenContext(t.token)?.branch, 'feature/x')
  assert.notEqual(mintToken(p.id, 'main').token, t.token)
  assert.throws(() => mintToken(999, 'main'), /unknown project/)

  createComment({ token: t.token, path: '/', author: 'Dana', body: 'one' })
  const open = createComment({ token: t.token, path: '/', author: 'Dana', body: 'two' })
  createComment({ token: t.token, path: '/', author: 'Dana', body: 'three', parent_id: open.id })

  const [row] = listProjects()
  assert.equal(row.total_comments, 3)
  assert.equal(row.open_comments, 3)
  assert.equal(row.tokens.length, 2)

  revokeToken(t.token)
  assert.equal(getTokenContext(t.token), null)
  assert.throws(() => revokeToken(t.token), /already revoked/)
})
