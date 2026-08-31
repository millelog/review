import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/comments'
import { addNote, listFeedback, listScopes } from '@/lib/agent'

export const dynamic = 'force-dynamic'

function fail(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status })
  throw error
}

/** Off unless AGENT_API_KEY is set; a 404 rather than a 401 so the route stays invisible. */
function denied(request: NextRequest): Response | null {
  const key = process.env.AGENT_API_KEY
  if (!key) return Response.json({ error: 'not found' }, { status: 404 })
  if (request.headers.get('authorization') !== `Bearer ${key}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  return null
}

export async function GET(request: NextRequest) {
  const no = denied(request)
  if (no) return no
  const q = request.nextUrl.searchParams
  const project = q.get('project')
  const branch = q.get('branch')
  try {
    if (!project || !branch) return Response.json({ projects: listScopes() })
    return Response.json(listFeedback(project, branch, q.get('status') === 'all' ? 'all' : 'open'))
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: NextRequest) {
  const no = denied(request)
  if (no) return no
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  try {
    if (typeof body.project !== 'string' || typeof body.branch !== 'string') {
      throw new ApiError('project and branch are required')
    }
    const note = addNote(body.project, body.branch, body.parent_id, body.body, body.author as string | undefined)
    return Response.json({ note }, { status: 201 })
  } catch (error) {
    return fail(error)
  }
}
