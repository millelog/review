import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

export type Project = {
  id: number
  name: string
  slug: string
  vercel_project: string
  vercel_team: string
  created_at: string
}

export type Token = {
  token: string
  project_id: number
  branch: string
  created_at: string
  revoked_at: string | null
}

import type { CommentType } from './types.ts'
export type { CommentType }
export type CommentStatus = 'open' | 'resolved'

export type Comment = {
  id: number
  token: string
  project_id: number
  branch: string
  path: string
  parent_id: number | null
  author: string
  color: string
  body: string
  type: CommentType
  status: CommentStatus
  selector: string
  offset_x: number
  offset_y: number
  viewport_width: number
  element_text: string
  internal: number
  created_at: string
  notified_at: string | null
  updated_at: string | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  vercel_project TEXT NOT NULL,
  vercel_team TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  branch TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL REFERENCES tokens(token),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  branch TEXT NOT NULL,
  path TEXT NOT NULL,
  parent_id INTEGER REFERENCES comments(id),
  author TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  selector TEXT NOT NULL DEFAULT '',
  offset_x REAL NOT NULL DEFAULT 0,
  offset_y REAL NOT NULL DEFAULT 0,
  viewport_width INTEGER NOT NULL DEFAULT 0,
  element_text TEXT NOT NULL DEFAULT '',
  internal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  notified_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS comments_scope ON comments (project_id, branch);
CREATE INDEX IF NOT EXISTS comments_parent ON comments (parent_id);
CREATE INDEX IF NOT EXISTS tokens_project ON tokens (project_id);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

let instance: Database.Database | null = null

export function getDb(): Database.Database {
  if (instance) return instance
  const path = process.env.DATABASE_PATH ?? './data/review.db'
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  // ponytail: sqlite has no ADD COLUMN IF NOT EXISTS; the throw on an existing column is the check.
  for (const col of [
    "color TEXT NOT NULL DEFAULT ''",
    "element_text TEXT NOT NULL DEFAULT ''",
    'internal INTEGER NOT NULL DEFAULT 0',
    'updated_at TEXT',
  ]) {
    try {
      db.exec(`ALTER TABLE comments ADD COLUMN ${col}`)
    } catch {}
  }
  dropTypeCheck(db)
  instance = db
  return db
}

const COLS =
  'id, token, project_id, branch, path, parent_id, author, color, body, type, status, selector, offset_x, offset_y, viewport_width, element_text, internal, created_at, notified_at, updated_at'

// ponytail: type is validated in createComment, not by CHECK, so adding a type never needs another rebuild.
function dropTypeCheck(db: Database.Database) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'comments'").get() as { sql: string } | undefined
  if (!row?.sql.includes('type IN (')) return
  db.pragma('foreign_keys = OFF')
  db.transaction(() => {
    db.exec('ALTER TABLE comments RENAME TO comments_old')
    db.exec(SCHEMA)
    db.exec(`INSERT INTO comments (${COLS}) SELECT ${COLS} FROM comments_old`)
    db.exec('DROP TABLE comments_old')
    db.exec(SCHEMA) // indexes went with the old table
  })()
  db.pragma('foreign_keys = ON')
}

export type TokenContext = Token & Pick<Project, 'name' | 'slug' | 'vercel_project' | 'vercel_team'>

/** Active (non-revoked) token joined with its project; null if unknown or revoked. */
export function getTokenContext(token: string): TokenContext | null {
  const row = getDb()
    .prepare(
      `SELECT t.*, p.name, p.slug, p.vercel_project, p.vercel_team
       FROM tokens t JOIN projects p ON p.id = t.project_id
       WHERE t.token = ? AND t.revoked_at IS NULL`,
    )
    .get(token) as TokenContext | undefined
  return row ?? null
}
