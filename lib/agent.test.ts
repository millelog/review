import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'review-')), 'test.db')
const { getDb } = await import('./db.ts')
const { createComment, listThreads } = await import('./comments.ts')
const { listScopes, listFeedback, addNote } = await import('./agent.ts')

const db = getDb()
const projectId = Number(
  db
    .prepare('INSERT INTO projects (name, slug, vercel_project, vercel_team) VALUES (?, ?, ?, ?)')
    .run('Acme', 'acme', 'acme-site', 'cascade').lastInsertRowid,
)
db.prepare('INSERT INTO tokens (token, project_id, branch) VALUES (?, ?, ?)').run('tok11111', projectId, 'main')

const root = createComment({
  token: 'tok11111',
  path: '/pricing',
  author: 'Client',
  body: 'This headline is too long',
  type: 'change_request',
  selector: '#hero > h2:nth-child(1)',
  element_text: 'Built for teams that ship',
  viewport_width: 390,
})

test('feedback carries the element handles and a resolvable url', () => {
  const { preview_url, threads } = listFeedback('acme', 'main')
  assert.equal(preview_url, 'https://acme-site-git-main-cascade.vercel.app')
  assert.match(listFeedback('acme', 'main').staff_url!, /\/admin\/r\/tok11111$/)
  assert.equal(threads.length, 1)
  assert.equal(threads[0].url, 'https://acme-site-git-main-cascade.vercel.app/pricing')
  assert.equal(threads[0].element_text, 'Built for teams that ship')
  assert.equal(threads[0].selector, '#hero > h2:nth-child(1)')
  assert.equal(threads[0].preview_size, 'mobile')
})

test('an agent note is staff-only', () => {
  const note = addNote('acme', 'main', root.id, 'Shortened it in components/Hero.tsx:42')
  assert.equal(note.internal, 1)
  assert.notEqual(note.notified_at, null) // never picked up by the client-link digest

  assert.deepEqual(listThreads('tok11111')[0].replies, [])
  assert.equal(listThreads('tok11111', true)[0].replies[0].id, note.id)
  assert.equal(listFeedback('acme', 'main').threads[0].replies[0].internal, true)
})

test('scopes list the branches an agent can query', () => {
  assert.deepEqual(listScopes(), [
    { slug: 'acme', name: 'Acme', vercel_project: 'acme-site', branches: [{ branch: 'main', open: 1, total: 1 }] },
  ])
})

test('rejects an unknown project or a parent outside the scope', () => {
  assert.throws(() => listFeedback('nope', 'main'), /unknown project/)
  assert.throws(() => addNote('acme', 'other', root.id, 'x'), /parent comment not found/)
})
