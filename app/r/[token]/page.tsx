import { notFound } from 'next/navigation'
import { getTokenContext } from '@/lib/db'
import { previewUrl } from '@/lib/preview'
import Shell from './shell'

export const dynamic = 'force-dynamic'

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ctx = getTokenContext(token)
  if (!ctx) notFound()

  return (
    <Shell
      token={token}
      project={ctx.name}
      branch={ctx.branch}
      src={previewUrl(ctx.vercel_project, ctx.branch, ctx.vercel_team)}
    />
  )
}
