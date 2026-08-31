import type { NextRequest } from 'next/server'
import { ApiError, deleteOwnComment, editOwnComment, toggleStatus } from '@/lib/comments'

export const dynamic = 'force-dynamic'

function fail(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status })
  throw error
}

// A body means "edit"; no body still means "toggle resolved", which is how the resolve button calls it.
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const payload = await request.json().catch(() => null)
  try {
    return Response.json({
      comment: payload?.body
        ? editOwnComment(payload.token ?? '', Number(id), payload.author ?? '', payload.body)
        : toggleStatus(Number(id)),
    })
  } catch (error) {
    return fail(error)
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const q = request.nextUrl.searchParams
  try {
    deleteOwnComment(q.get('token') ?? '', Number(id), q.get('author') ?? '')
    return new Response(null, { status: 204 })
  } catch (error) {
    return fail(error)
  }
}
