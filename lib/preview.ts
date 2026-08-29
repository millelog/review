// Vercel branch alias: {project}-git-{branch}-{team}.vercel.app
// ponytail: aliases over 63 chars are truncated by Vercel; documented, not solved (v1).
export function slugBranch(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Which preview frame a comment was left in, from the width it recorded. Null for pre-tracking rows. */
export function previewSize(width: number): 'mobile' | 'tablet' | 'desktop' | null {
  if (!width) return null
  if (width <= 430) return 'mobile'
  if (width <= 820) return 'tablet'
  return 'desktop'
}

export function previewUrl(vercelProject: string, branch: string, vercelTeam: string): string {
  return `https://${vercelProject}-git-${slugBranch(branch)}-${vercelTeam}.vercel.app`
}
