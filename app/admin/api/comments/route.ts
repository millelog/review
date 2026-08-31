import type { NextRequest } from 'next/server'
import { ApiError, listThreads } from '@/lib/comments'

export const dynamic = 'force-dynamic'

// Staff feed: same threads as the client link plus internal agent notes. Cloudflare Access guards /admin/*.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? ''
  try {
    return Response.json({ comments: listThreads(token, true) })
  } catch (error) {
    if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
}
