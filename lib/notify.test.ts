import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'review-')), 'test.db')
const { getDb } = await import('./db.ts')
const { createComment } = await import('./comments.ts')
const { notify } = await import('./notify.ts')

const db = getDb()
const projectId = Number(
  db
    .prepare('INSERT INTO projects (name, slug, vercel_project, vercel_team) VALUES (?, ?, ?, ?)')
    .run('Acme', 'acme', 'acme-site', 'cascade').lastInsertRowid,
)
db.prepare('INSERT INTO tokens (token, project_id, branch) VALUES (?, ?, ?)').run('tok11111', projectId, 'feature/x')

const sent: { subject: string; text: string }[] = []
const send = async (subject: string, text: string) => void sent.push({ subject, text })
const post = (body: string) => createComment({ token: 'tok11111', path: '/', author: 'Dana', body })
const unnotified = () =>
  (db.prepare("SELECT COUNT(*) AS n FROM comments WHERE notified_at IS NULL").get() as { n: number }).n
/** Pretends the debounce window has elapsed. */
const expireWindow = () =>
  db.prepare("UPDATE tokens SET last_notified_at = datetime('now', '-11 minutes') WHERE token = ?").run('tok11111')

test('first comment notifies immediately', async () => {
  post('one')
  assert.equal(await notify('tok11111', send), true)
  assert.equal(sent.length, 1)
  assert.match(sent[0].subject, /^1 new comment on Acme\/feature\/x$/)
  assert.match(sent[0].text, /\/r\/tok11111/)
  assert.equal(unnotified(), 0)
})

test('a burst inside the window sends one email covering all of it', async () => {
  post('two')
  post('three')
  post('four')
  for (let i = 0; i < 3; i++) assert.equal(await notify('tok11111', send), false)
  assert.equal(sent.length, 1, 'still debounced')
  assert.equal(unnotified(), 3)

  expireWindow()
  assert.equal(await notify('tok11111', send), true)
  assert.equal(sent.length, 2)
  assert.equal(sent[1].subject, '3 new comments on Acme/feature/x')
  for (const body of ['two', 'three', 'four']) assert.match(sent[1].text, new RegExp(body))
  assert.equal(unnotified(), 0)
})

test('nothing to say means no email', async () => {
  expireWindow()
  assert.equal(await notify('tok11111', send), false)
  assert.equal(sent.length, 2)
})

test('a failed send leaves the comments unnotified for the next run', async () => {
  post('five')
  expireWindow()
  const boom = async () => {
    throw new Error('sendgrid down')
  }
  assert.equal(await notify('tok11111', boom), false)
  assert.equal(unnotified(), 1)

  expireWindow()
  assert.equal(await notify('tok11111', send), true)
  assert.equal(sent.at(-1)!.subject, '1 new comment on Acme/feature/x')
  assert.equal(unnotified(), 0)
})
