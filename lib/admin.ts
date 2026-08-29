import { randomBytes } from 'node:crypto'
import { getDb } from './db.ts'
import type { Comment, Project, Token } from './db.ts'
import { ApiError } from './comments.ts'
import { slugBranch } from './preview.ts'

export type ProjectRow = Project & {
  open_comments: number
  total_comments: number
  tokens: Token[]
  comments: Comment[]
}

export function listProjects(): ProjectRow[] {
  const db = getDb()
  const projects = db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM comments c WHERE c.project_id = p.id) AS total_comments,
              (SELECT COUNT(*) FROM comments c WHERE c.project_id = p.id AND c.status = 'open') AS open_comments
       FROM projects p ORDER BY p.name`,
    )
    .all() as Omit<ProjectRow, 'tokens' | 'comments'>[]
  const tokens = db.prepare('SELECT * FROM tokens ORDER BY created_at DESC').all() as Token[]
  const comments = db.prepare('SELECT * FROM comments ORDER BY id DESC').all() as Comment[]
  return projects.map((p) => ({
    ...p,
    tokens: tokens.filter((t) => t.project_id === p.id),
    comments: comments.filter((c) => c.project_id === p.id),
  }))
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
  const project = getDb().prepare('SELECT slug FROM projects WHERE id = ?').get(id) as
    | Pick<Project, 'slug'>
    | undefined
  if (!Number.isInteger(id) || !project) throw new ApiError('unknown project', 404)
  const name = str(branch, 'branch')
  // readable link, unguessable tail: /r/acme-feature-pricing-Xk29fa
  const token = `${slugBranch(project.slug)}-${slugBranch(name)}-${randomBytes(6).toString('base64url')}`
  return getDb()
    .prepare('INSERT INTO tokens (token, project_id, branch) VALUES (?, ?, ?) RETURNING *')
    .get(token, id, name) as Token
}

export function revokeToken(token: unknown): void {
  const res = getDb()
    .prepare(`UPDATE tokens SET revoked_at = datetime('now') WHERE token = ? AND revoked_at IS NULL`)
    .run(str(token, 'token'))
  if (!res.changes) throw new ApiError('unknown or already revoked token', 404)
}
