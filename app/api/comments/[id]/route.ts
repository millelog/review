import type { NextRequest } from 'next/server'
import { ApiError, deleteOwnComment, toggleStatus } from '@/lib/comments'

export const dynamic = 'force-dynamic'

function fail(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status })
  throw error
}

export async function PATCH(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    return Response.json({ comment: toggleStatus(Number(id)) })
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
