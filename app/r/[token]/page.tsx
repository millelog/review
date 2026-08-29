import { notFound } from 'next/navigation'
import { getTokenContext } from '@/lib/db'
import { previewUrl } from '@/lib/preview'
import { LOGO } from '@/lib/brand'
import Shell from './shell'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ctx = getTokenContext(token)
  if (!ctx) return { title: 'Review' }
  const title = `${ctx.name} - Review`
  const description = `Preview the new ${ctx.name} site and leave feedback right on the page.`
  return {
    title,
    description,
    openGraph: { title, description, images: [LOGO], siteName: 'Cascade Online Design', type: 'website' },
    twitter: { card: 'summary', title, description, images: [LOGO] },
  }
}

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ctx = getTokenContext(token)
  if (!ctx) notFound()

  return (
    <Shell
      token={token}
      project={ctx.name}
      branch={ctx.branch}
      // ponytail: PREVIEW_OVERRIDE points the iframe at a local fake site for browser tests.
      src={process.env.PREVIEW_OVERRIDE ?? previewUrl(ctx.vercel_project, ctx.branch, ctx.vercel_team)}
    />
  )
}
