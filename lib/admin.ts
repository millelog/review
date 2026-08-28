import { randomBytes } from 'node:crypto'
import { getDb } from './db.ts'
import type { Project, Token } from './db.ts'
import { ApiError } from './comments.ts'

export type ProjectRow = Project & { open_comments: number; total_comments: number; tokens: Token[] }

export function listProjects(): ProjectRow[] {
  const db = getDb()
  const projects = db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM comments c WHERE c.project_id = p.id) AS total_comments,
              (SELECT COUNT(*) FROM comments c WHERE c.project_id = p.id AND c.status = 'open') AS open_comments
       FROM projects p ORDER BY p.name`,
    )
    .all() as Omit<ProjectRow, 'tokens'>[]
  const tokens = db.prepare('SELECT * FROM tokens ORDER BY created_at DESC').all() as Token[]
  return projects.map((p) => ({ ...p, tokens: tokens.filter((t) => t.project_id === p.id) }))
}

function str(value: unknown, field: string): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) throw new ApiError(`${field} is required`)
  return s
}

export function createProject(input: {
  name: unknown
  slug: unknown
  vercel_project: unknown
  vercel_team: unknown
}): Project {
  const name = str(input.name, 'name')
  const slug = str(input.slug, 'slug')
  const vercelProject = str(input.vercel_project, 'vercel project')
  const vercelTeam = str(input.vercel_team, 'vercel team')
  if (getDb().prepare('SELECT 1 FROM projects WHERE slug = ?').get(slug)) {
    throw new ApiError(`slug "${slug}" is already taken`, 409)
  }
  return getDb()
    .prepare(
      `INSERT INTO projects (name, slug, vercel_project, vercel_team) VALUES (?, ?, ?, ?) RETURNING *`,
    )
    .get(name, slug, vercelProject, vercelTeam) as Project
}

export function mintToken(projectId: unknown, branch: unknown): Token {
  const id = Number(projectId)
  if (!Number.isInteger(id) || !getDb().prepare('SELECT 1 FROM projects WHERE id = ?').get(id)) {
    throw new ApiError('unknown project', 404)
  }
  return getDb()
    .prepare('INSERT INTO tokens (token, project_id, branch) VALUES (?, ?, ?) RETURNING *')
    .get(randomBytes(6).toString('base64url'), id, str(branch, 'branch')) as Token
}

export function revokeToken(token: unknown): void {
  const res = getDb()
    .prepare(`UPDATE tokens SET revoked_at = datetime('now') WHERE token = ? AND revoked_at IS NULL`)
    .run(str(token, 'token'))
  if (!res.changes) throw new ApiError('unknown or already revoked token', 404)
}
