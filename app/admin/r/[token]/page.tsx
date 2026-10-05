import { notFound } from 'next/navigation'
import { getTokenContext } from '@/lib/db'
import { previewUrl, startUrl } from '@/lib/preview'
import Shell from '@/app/r/[token]/shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Review - staff' }

// Same review shell as /r/{token}, plus internal agent notes. Access-protected by the /admin prefix.
export default async function StaffReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ path?: string | string[] }>
}) {
  const { token } = await params
  const { path } = await searchParams
  const ctx = getTokenContext(token)
  if (!ctx) notFound()

  return (
    <Shell
      token={token}
      project={ctx.name}
      branch={ctx.branch}
      staff
      src={startUrl(process.env.PREVIEW_OVERRIDE ?? previewUrl(ctx.vercel_project, ctx.branch, ctx.vercel_team), path)}
    />
  )
}
