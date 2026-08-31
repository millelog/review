import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'review-')), 'test.db')
const { getDb } = await import('./db.ts')

test('insert project, token and comment, read back', () => {
  const db = getDb()
  const projectId = Number(
    db
      .prepare('INSERT INTO projects (name, slug, vercel_project, vercel_team) VALUES (?, ?, ?, ?)')
      .run('Acme', 'acme', 'acme-site', 'cascade').lastInsertRowid,
  )
  db.prepare('INSERT INTO tokens (token, project_id, branch) VALUES (?, ?, ?)').run('abcd1234', projectId, 'feature/x')
  db.prepare(
    `INSERT INTO comments (token, project_id, branch, path, author, body, type, selector, offset_x, offset_y, viewport_width)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('abcd1234', projectId, 'feature/x', '/pricing', 'Dana', 'Make this bigger', 'change_request', '#hero', 12, 34, 1440)

  const comment = db.prepare('SELECT * FROM comments WHERE token = ?').get('abcd1234') as Record<string, unknown>
  assert.equal(comment.body, 'Make this bigger')
  assert.equal(comment.type, 'change_request')
  assert.equal(comment.status, 'open')
  assert.equal(comment.parent_id, null)
  assert.equal(comment.notified_at, null)
  assert.equal(comment.viewport_width, 1440)
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal')

  const token = db.prepare('SELECT * FROM tokens WHERE token = ?').get('abcd1234') as Record<string, unknown>
  assert.equal(token.project_id, projectId)
  assert.equal(token.revoked_at, null)
})
