import type { NextRequest } from 'next/server'
import { ApiError, createComment, listThreads } from '@/lib/comments'
import { notify } from '@/lib/notify'

export const dynamic = 'force-dynamic'

function fail(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status })
  throw error
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? ''
  try {
    return Response.json({ comments: listThreads(token) })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const comment = createComment(await request.json().catch(() => ({})))
    void notify(comment.token).catch((error) => console.error('notify failed', error))
    return Response.json({ comment }, { status: 201 })
  } catch (error) {
    return fail(error)
  }
}
