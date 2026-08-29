import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'review-')), 'test.db')
const { getDb } = await import('./db.ts')
const { createComment, listThreads, toggleStatus, deleteOwnComment, removeComment, ApiError } =
  await import('./comments.ts')
const { AVATAR_COLORS } = await import('./brand.ts')

const db = getDb()
const projectId = Number(
  db
    .prepare('INSERT INTO projects (name, slug, vercel_project, vercel_team) VALUES (?, ?, ?, ?)')
    .run('Acme', 'acme', 'acme-site', 'cascade').lastInsertRowid,
)
db.prepare('INSERT INTO tokens (token, project_id, branch) VALUES (?, ?, ?)').run('tok11111', projectId, 'feature/x')
db.prepare('INSERT INTO tokens (token, project_id, branch) VALUES (?, ?, ?)').run('tok22222', projectId, 'feature/x')
db.prepare('INSERT INTO tokens (token, project_id, branch, revoked_at) VALUES (?, ?, ?, ?)').run(
  'dead0000',
  projectId,
  'feature/x',
  '2026-01-01 00:00:00',
)

test('create, thread and resolve', () => {
  const root = createComment({
    token: 'tok11111',
    path: '/pricing',
    author: 'Dana',
    body: 'Make this bigger',
    type: 'change_request',
    selector: '#hero',
    offset_x: 12,
    offset_y: 34,
    viewport_width: 1440,
  })
  assert.equal(root.status, 'open')
  assert.equal(root.branch, 'feature/x')
  assert.equal(root.parent_id, null)

  // a re-minted token on the same branch sees and can reply to prior comments
  const reply = createComment({
    token: 'tok22222',
    path: '/pricing',
    author: 'Sam',
    body: 'Agreed',
    parent_id: root.id,
  })
  assert.equal(reply.type, 'comment')

  const threads = listThreads('tok22222')
  assert.equal(threads.length, 1)
  assert.equal(threads[0].id, root.id)
  assert.deepEqual(
    threads[0].replies.map((r) => r.body),
    ['Agreed'],
  )

  assert.equal(toggleStatus(root.id).status, 'resolved')
  assert.equal(toggleStatus(root.id).status, 'open')
  assert.equal(listThreads('tok11111')[0].replies.length, 1)
})

test('rejects revoked and unknown tokens', () => {
  const bad = { token: 'dead0000', path: '/', author: 'Dana', body: 'hi' }
  assert.throws(() => createComment(bad), (e) => e instanceof ApiError && e.status === 404)
  assert.throws(() => createComment({ ...bad, token: 'nope' }), ApiError)
  assert.throws(() => listThreads('dead0000'), ApiError)
})

test('rejects empty body or author', () => {
  const base = { token: 'tok11111', path: '/', author: 'Dana', body: 'hi' }
  assert.throws(() => createComment({ ...base, body: '  ' }), /body is required/)
  assert.throws(() => createComment({ ...base, author: '' }), /author is required/)
})

test('rejects out-of-scope parent and unknown comment id', () => {
  assert.throws(() => createComment({ token: 'tok11111', path: '/', author: 'D', body: 'x', parent_id: 999 }), ApiError)
  assert.throws(() => toggleStatus(999), ApiError)
})

test('deletes only your own comments, and replies go with their root', () => {
  const root = createComment({ token: 'tok11111', path: '/del', author: 'Dana', body: 'root' })
  const mine = createComment({ token: 'tok11111', path: '/del', author: 'Sam', body: 'mine', parent_id: root.id })
  const theirs = createComment({ token: 'tok11111', path: '/del', author: 'Dana', body: 'theirs', parent_id: root.id })

  assert.throws(
    () => deleteOwnComment('tok11111', theirs.id, 'Sam'),
    (e) => e instanceof ApiError && e.status === 403,
  )
  assert.throws(() => deleteOwnComment('dead0000', mine.id, 'Sam'), ApiError)
  assert.throws(() => deleteOwnComment('tok11111', 999, 'Sam'), ApiError)

  deleteOwnComment('tok11111', mine.id, 'Sam')
  const on = (path: string) => listThreads('tok11111').find((t) => t.path === path && t.id === root.id)
  assert.deepEqual(on('/del')?.replies.map((r) => r.body), ['theirs'])

  removeComment(root.id) // admin delete takes the replies with it
  assert.equal(on('/del'), undefined)
  assert.equal(listThreads('tok11111').filter((t) => t.path === '/del').length, 0)
  assert.throws(() => removeComment(root.id), ApiError)
})

test('keeps palette colours, drops anything else', () => {
  const base = { token: 'tok11111', path: '/', author: 'Dana', body: 'hi' }
  assert.equal(createComment({ ...base, color: AVATAR_COLORS[2] }).color, AVATAR_COLORS[2])
  assert.equal(createComment({ ...base, color: 'url(evil)' }).color, '')
  assert.equal(createComment(base).color, '')
})
