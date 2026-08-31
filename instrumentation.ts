export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { sweep } = await import('./lib/notify.ts')
  // Chained timeout, not setInterval: sweeps never overlap, so mark-after-send can't double-send.
  const loop = () => void sweep().catch(console.error).finally(() => setTimeout(loop, 60_000))
  setTimeout(loop, 60_000)
}
