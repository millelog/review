'use server'

import { redirect } from 'next/navigation'
import { createProject, mintToken, revokeToken } from '@/lib/admin'

// ponytail: errors round-trip through ?error= instead of useActionState — the page is force-dynamic anyway.
function run(fn: () => void): never {
  try {
    fn()
  } catch (e) {
    redirect(`/admin?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`)
  }
  redirect('/admin')
}

export async function addProject(form: FormData) {
  run(() =>
    createProject({
      name: form.get('name'),
      slug: form.get('slug'),
      vercel_project: form.get('vercel_project'),
      vercel_team: form.get('vercel_team'),
    }),
  )
}

export async function addToken(form: FormData) {
  run(() => mintToken(form.get('project_id'), form.get('branch')))
}

export async function revoke(form: FormData) {
  run(() => revokeToken(form.get('token')))
}
