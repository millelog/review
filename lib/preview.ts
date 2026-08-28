// Vercel branch alias: {project}-git-{branch}-{team}.vercel.app
// ponytail: aliases over 63 chars are truncated by Vercel; documented, not solved (v1).
export function slugBranch(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function previewUrl(vercelProject: string, branch: string, vercelTeam: string): string {
  return `https://${vercelProject}-git-${slugBranch(branch)}-${vercelTeam}.vercel.app`
}
