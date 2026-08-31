// Agent-facing reads: feedback by project+branch, shaped so a coding agent can find the element in source.
import { getDb } from './db.ts'
import type { Comment, Project } from './db.ts'
import { ApiError, createComment, threadsFor } from './comments.ts'
import { previewSize, previewUrl } from './preview.ts'

export const AGENT_AUTHOR = 'Claude (agent)'

type AgentComment = {
  id: number
  parent_id: number | null
  author: string
  body: string
  type: string
  status: string
  internal: boolean
  created_at: string
}

export type AgentThread = AgentComment & {
  path: string
  url: string
  selector: string
  element_text: string
  preview_size: ReturnType<typeof previewSize>
  replies: AgentComment[]
}

/** Any live link for the scope — its token also addresses the staff copy of the review page. */
function liveToken(projectId: number, branch: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT token FROM tokens WHERE project_id = ? AND branch = ? AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(projectId, branch) as { token: string } | undefined
  return row?.token ?? null
}

function project(slug: string): Project {
  const row = getDb().prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as Project | undefined
  if (!row) throw new ApiError(`unknown project "${slug}"`, 404)
  return row
}

/** Every project with its live branches and open/total counts — how an agent finds its slug. */
export function listScopes() {
  const projects = getDb().prepare('SELECT * FROM projects ORDER BY name').all() as Project[]
  const counts = getDb()
    .prepare(
      `SELECT t.project_id, t.branch,
              (SELECT COUNT(*) FROM comments c
                WHERE c.project_id = t.project_id AND c.branch = t.branch AND c.internal = 0) AS total,
              (SELECT COUNT(*) FROM comments c
                WHERE c.project_id = t.project_id AND c.branch = t.branch AND c.internal = 0 AND c.status = 'open') AS open
       FROM tokens t WHERE t.revoked_at IS NULL GROUP BY t.project_id, t.branch`,
    )
    .all() as { project_id: number; branch: string; total: number; open: number }[]

  return projects.map((p) => ({
    slug: p.slug,
    name: p.name,
    vercel_project: p.vercel_project,
    branches: counts
      .filter((c) => c.project_id === p.id)
      .map((c) => ({ branch: c.branch, open: c.open, total: c.total })),
  }))
}

function shape(c: Comment): AgentComment {
  return {
    id: c.id,
    parent_id: c.parent_id,
    author: c.author,
    body: c.body,
    type: c.type,
    status: c.status,
    internal: !!c.internal,
    created_at: c.created_at,
  }
}

export function listFeedback(slug: string, branch: string, status: 'open' | 'all' = 'open') {
  const p = project(slug)
  const base = previewUrl(p.vercel_project, branch, p.vercel_team)
  const threads = threadsFor(p.id, branch, true)
    .filter((t) => status === 'all' || t.status === 'open')
    .map((t) => ({
      ...shape(t),
      path: t.path,
      url: base + t.path,
      selector: t.selector,
      element_text: t.element_text,
      preview_size: previewSize(t.viewport_width),
      replies: t.replies.map(shape),
    })) as AgentThread[]
  const token = liveToken(p.id, branch)
  return {
    project: p.name,
    slug: p.slug,
    branch,
    preview_url: base,
    staff_url: token ? `${process.env.APP_URL ?? 'https://review.cascadeonline.dev'}/admin/r/${token}` : null,
    threads,
  }
}

/** A staff-only note on a thread: what the agent changed. Never shown on the client link. */
export function addNote(slug: string, branch: string, parentId: unknown, body: unknown, author?: string): Comment {
  const p = project(slug)
  const parent = getDb()
    .prepare('SELECT * FROM comments WHERE id = ? AND project_id = ? AND branch = ?')
    .get(Number(parentId), p.id, branch) as Comment | undefined
  if (!parent) throw new ApiError('parent comment not found on that project/branch', 404)
  if (parent.parent_id !== null) throw new ApiError('note on the thread root, not on a reply')

  // createComment posts as a token; the parent's may be revoked, so take any live one for the scope.
  const live = liveToken(p.id, branch)
  if (!live) throw new ApiError('no live review link for that project/branch', 404)

  return createComment(
    {
      token: live,
      path: parent.path,
      author: (typeof author === 'string' && author.trim()) || AGENT_AUTHOR,
      body: typeof body === 'string' ? body : '',
      parent_id: parent.id,
    },
    { internal: true },
  )
}
