// Client-safe: imported by the browser shell, so nothing from node or sqlite belongs here.
export type CommentType = 'comment' | 'change_request' | 'copy'
export const COMMENT_TYPES: CommentType[] = ['comment', 'change_request', 'copy']
