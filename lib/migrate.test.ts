import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

// Pre-migration prod shape: type CHECK present, color added by ALTER so it sits last.
const path = join(mkdtempSync(join(tmpdir(), 'review-')), 'old.db')
const old = new Database(path)
old.exec(`
CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, vercel_project TEXT NOT NULL, vercel_team TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE tokens (token TEXT PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), branch TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), revoked_at TEXT, last_notified_at TEXT);
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL REFERENCES tokens(token), project_id INTEGER NOT NULL REFERENCES projects(id),
  branch TEXT NOT NULL, path TEXT NOT NULL, parent_id INTEGER REFERENCES comments(id), author TEXT NOT NULL, body TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('comment', 'change_request')), status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  selector TEXT NOT NULL DEFAULT '', offset_x REAL NOT NULL DEFAULT 0, offset_y REAL NOT NULL DEFAULT 0, viewport_width INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), notified_at TEXT
);
ALTER TABLE comments ADD COLUMN color TEXT NOT NULL DEFAULT '';
INSERT INTO projects (name, slug, vercel_project, vercel_team) VALUES ('Acme', 'acme', 'acme', 'cascade');
INSERT INTO tokens (token, project_id, branch) VALUES ('tok', 1, 'main');
INSERT INTO comments (token, project_id, branch, path, author, body, type, color, status) VALUES ('tok', 1, 'main', '/', 'Dana', 'root', 'change_request', '#f00', 'resolved');
INSERT INTO comments (token, project_id, branch, path, parent_id, author, body, type) VALUES ('tok', 1, 'main', '/', 1, 'Lee', 'reply', 'comment');
`)
old.close()

process.env.DATABASE_PATH = path
const { getDb } = await import('./db.ts')

test('rebuild drops the type CHECK and keeps every row', () => {
  const db = getDb()
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'comments'").get() as { sql: string }).sql
  assert.ok(!sql.includes('type IN ('))
  const rows = db.prepare('SELECT * FROM comments ORDER BY id').all() as Record<string, unknown>[]
  assert.equal(rows.length, 2)
  assert.deepEqual([rows[0].type, rows[0].color, rows[0].status, rows[1].parent_id], ['change_request', '#f00', 'resolved', 1])
  db.prepare("INSERT INTO comments (token, project_id, branch, path, author, body, type) VALUES ('tok', 1, 'main', '/', 'Dana', 'Final headline', 'copy')").run()
  assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM comments').get(), { n: 3 })
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'comments_scope'").get() !== undefined, true)
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
})
