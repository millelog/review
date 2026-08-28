import { getDb, getTokenContext } from './db.ts'
import type { Comment, CommentType } from './db.ts'

export class ApiError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export type Thread = Comment & { replies: Comment[] }

export type NewComment = {
  token: string
  path: string
  author: string
  body: string
  type?: CommentType
  parent_id?: number | null
  selector?: string
  offset_x?: number
  offset_y?: number
  viewport_width?: number
}

function str(value: unknown, field: string): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) throw new ApiError(`${field} is required`)
  return s
}

export function createComment(input: NewComment): Comment {
  const ctx = getTokenContext(input.token)
  if (!ctx) throw new ApiError('invalid or revoked token', 404)

  const author = str(input.author, 'author')
  const body = str(input.body, 'body')
  const type: CommentType = input.type === 'change_request' ? 'change_request' : 'comment'

  const parentId = input.parent_id ?? null
  if (parentId !== null) {
    const parent = getDb()
      .prepare('SELECT id FROM comments WHERE id = ? AND project_id = ? AND branch = ?')
      .get(parentId, ctx.project_id, ctx.branch)
    if (!parent) throw new ApiError('parent comment not found', 404)
  }

  return getDb()
    .prepare(
      `INSERT INTO comments
         (token, project_id, branch, path, parent_id, author, body, type, selector, offset_x, offset_y, viewport_width)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .get(
      input.token,
      ctx.project_id,
      ctx.branch,
      input.path || '/',
      parentId,
      author,
      body,
      type,
      input.selector ?? '',
      input.offset_x ?? 0,
      input.offset_y ?? 0,
      input.viewport_width ?? 0,
    ) as Comment
}

/** Threaded comments for the token's project+branch — independent of which token created them. */
export function listThreads(token: string): Thread[] {
  const ctx = getTokenContext(token)
  if (!ctx) throw new ApiError('invalid or revoked token', 404)

  const rows = getDb()
    .prepare(
      'SELECT * FROM comments WHERE project_id = ? AND branch = ? ORDER BY id',
    )
    .all(ctx.project_id, ctx.branch) as Comment[]

  const roots = new Map<number, Thread>()
  for (const row of rows) if (row.parent_id === null) roots.set(row.id, { ...row, replies: [] })
  for (const row of rows) if (row.parent_id !== null) roots.get(row.parent_id)?.replies.push(row)
  return [...roots.values()]
}

/** Flips a comment between open and resolved. */
export function toggleStatus(id: number): Comment {
  const row = getDb()
    .prepare(
      `UPDATE comments SET status = CASE status WHEN 'open' THEN 'resolved' ELSE 'open' END
       WHERE id = ? RETURNING *`,
    )
    .get(id) as Comment | undefined
  if (!row) throw new ApiError('comment not found', 404)
  return row
}
