import type { NextRequest } from 'next/server'
import { ApiError, toggleStatus } from '@/lib/comments'

export const dynamic = 'force-dynamic'

export async function PATCH(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    return Response.json({ comment: toggleStatus(Number(id)) })
  } catch (error) {
    if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
}
