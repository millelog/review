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
  last_notified_at: string | null
}

export type CommentType = 'comment' | 'change_request'
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
  created_at: string
  notified_at: string | null
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
  revoked_at TEXT,
  last_notified_at TEXT
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
  type TEXT NOT NULL CHECK (type IN ('comment', 'change_request')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  selector TEXT NOT NULL DEFAULT '',
  offset_x REAL NOT NULL DEFAULT 0,
  offset_y REAL NOT NULL DEFAULT 0,
  viewport_width INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  notified_at TEXT
);

CREATE INDEX IF NOT EXISTS comments_scope ON comments (project_id, branch);
CREATE INDEX IF NOT EXISTS comments_parent ON comments (parent_id);
CREATE INDEX IF NOT EXISTS tokens_project ON tokens (project_id);
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
  try {
    db.exec("ALTER TABLE comments ADD COLUMN color TEXT NOT NULL DEFAULT ''")
  } catch {}
  instance = db
  return db
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
