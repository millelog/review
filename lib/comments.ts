import { getDb, getTokenContext } from './db.ts'
import { COMMENT_TYPES } from './types.ts'
import type { Comment, CommentType } from './db.ts'
import { AVATAR_COLORS } from './brand.ts'

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
  color?: string
  body: string
  type?: CommentType
  parent_id?: number | null
  selector?: string
  element_text?: string
  offset_x?: number
  offset_y?: number
  viewport_width?: number
}

function str(value: unknown, field: string): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) throw new ApiError(`${field} is required`)
  return s
}

// `internal` is an argument, not a body field: the public POST route hands us unfiltered JSON.
export function createComment(input: NewComment, opts: { internal?: boolean } = {}): Comment {
  const ctx = getTokenContext(input.token)
  if (!ctx) throw new ApiError('invalid or revoked token', 404)

  const author = str(input.author, 'author')
  const body = str(input.body, 'body')
  const type: CommentType = COMMENT_TYPES.includes(input.type as CommentType) ? (input.type as CommentType) : 'comment'

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
         (token, project_id, branch, path, parent_id, author, color, body, type, selector, element_text,
          offset_x, offset_y, viewport_width, internal, notified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .get(
      input.token,
      ctx.project_id,
      ctx.branch,
      input.path || '/',
      parentId,
      author,
      AVATAR_COLORS.includes(input.color ?? '') ? input.color : '',
      body,
      type,
      input.selector ?? '',
      input.element_text ?? '',
      input.offset_x ?? 0,
      input.offset_y ?? 0,
      input.viewport_width ?? 0,
      opts.internal ? 1 : 0,
      // pre-marked as notified so agent notes never reach the client-link digest
      opts.internal ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
    ) as Comment
}

/** Threaded comments for the token's project+branch — independent of which token created them. */
export function listThreads(token: string, includeInternal = false): Thread[] {
  const ctx = getTokenContext(token)
  if (!ctx) throw new ApiError('invalid or revoked token', 404)
  return threadsFor(ctx.project_id, ctx.branch, includeInternal)
}

/** Shared thread assembly; agent reads come in by project+branch, with no token at all. */
export function threadsFor(projectId: number, branch: string, includeInternal = false): Thread[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM comments WHERE project_id = ? AND branch = ?${includeInternal ? '' : ' AND internal = 0'} ORDER BY id`,
    )
    .all(projectId, branch) as Comment[]

  const roots = new Map<number, Thread>()
  for (const row of rows) if (row.parent_id === null) roots.set(row.id, { ...row, replies: [] })
  for (const row of rows) if (row.parent_id !== null) roots.get(row.parent_id)?.replies.push(row)
  return [...roots.values()]
}

/** Deletes a comment and, when it is a thread root, its replies. Admin path — no ownership check. */
export function removeComment(id: number): void {
  const res = getDb().prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').run(id, id)
  if (!res.changes) throw new ApiError('comment not found', 404)
}

// ponytail: the author name is the only identity a link-only reviewer has — it stops accidents, not
// spoofing. Anyone with the link can already post under any name; add a per-browser key if that changes.
export function deleteOwnComment(token: string, id: number, author: string): void {
  const ctx = getTokenContext(token)
  if (!ctx) throw new ApiError('invalid or revoked token', 404)
  const row = getDb()
    .prepare('SELECT author FROM comments WHERE id = ? AND project_id = ? AND branch = ?')
    .get(id, ctx.project_id, ctx.branch) as Pick<Comment, 'author'> | undefined
  if (!row) throw new ApiError('comment not found', 404)
  if (row.author !== str(author, 'author')) throw new ApiError('you can only delete your own comments', 403)
  removeComment(id)
}

/** Same ownership rule as delete: an in-place body rewrite, stamped so the UI can show "edited". */
export function editOwnComment(token: string, id: number, author: string, body: string): Comment {
  const ctx = getTokenContext(token)
  if (!ctx) throw new ApiError('invalid or revoked token', 404)
  const row = getDb()
    .prepare('SELECT author FROM comments WHERE id = ? AND project_id = ? AND branch = ?')
    .get(id, ctx.project_id, ctx.branch) as Pick<Comment, 'author'> | undefined
  if (!row) throw new ApiError('comment not found', 404)
  if (row.author !== str(author, 'author')) throw new ApiError('you can only edit your own comments', 403)
  return getDb()
    .prepare("UPDATE comments SET body = ?, updated_at = datetime('now') WHERE id = ? RETURNING *")
    .get(str(body, 'body'), id) as Comment
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
