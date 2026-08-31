import { getDb } from './db.ts'

/** Sends one email; `thread` is the Message-ID replies chain onto. Swappable in tests. */
export type Send = (subject: string, text: string, thread: string) => Promise<void>

type Row = { author: string; path: string; body: string; type: string }
type RecapRow = Row & { name: string; branch: string; token: string }

const TYPE_LABEL: Record<string, string> = { comment: 'comment', change_request: 'change request', copy: 'content' }
const LA = 'America/Los_Angeles'
const QUIET_MINUTES = 30
const RECAP_HOUR = 15

const appUrl = () => process.env.APP_URL ?? 'https://review.cascadeonline.dev'
const host = () => new URL(appUrl()).host
const laDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: LA })
// h23, not hour12:false: V8 has returned "24" at midnight with the latter.
const laHour = (d: Date) => Number(d.toLocaleTimeString('en-US', { timeZone: LA, hourCycle: 'h23', hour: '2-digit' }))
const fromSql = (s: string) => new Date(s.replace(' ', 'T') + 'Z')
const line = (r: Row) => `[${TYPE_LABEL[r.type] ?? 'comment'}] ${r.author}: ${r.body}`

async function sendGrid(subject: string, text: string, thread: string): Promise<void> {
  const key = process.env.SENDGRID_API_KEY
  const to = process.env.NOTIFY_EMAIL
  if (!key || !to) throw new Error('SENDGRID_API_KEY and NOTIFY_EMAIL must be set')
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.NOTIFY_FROM ?? to },
      subject,
      headers: { 'In-Reply-To': thread, References: thread },
      content: [{ type: 'text/plain', value: text }],
    }),
  })
  if (!res.ok) throw new Error(`sendgrid ${res.status}: ${await res.text()}`)
}

/**
 * Emails every unnotified comment on the token as one message in the token's thread.
 * Resolves to true when a mail was sent. Never throws: failures log and retry on the next sweep.
 */
export async function notify(token: string, send: Send = sendGrid): Promise<boolean> {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, author, path, body, type FROM comments WHERE token = ? AND notified_at IS NULL ORDER BY path, id')
    .all(token) as (Row & { id: number })[]
  if (!rows.length) return false
  const { name, branch } = db
    .prepare('SELECT p.name, t.branch FROM tokens t JOIN projects p ON p.id = t.project_id WHERE t.token = ?')
    .get(token) as { name: string; branch: string }

  const n = rows.length
  const text = [
    `${n} new comment${n === 1 ? '' : 's'} — ${appUrl()}/r/${token}`,
    ...rows.map((r) => `\n${r.path}\n${line(r)}`),
  ].join('\n')

  try {
    await send(`Feedback: ${name}/${branch}`, text, `<review-${token}@${host()}>`)
  } catch (error) {
    console.error('notify: send failed', error)
    return false
  }
  const mark = db.prepare("UPDATE comments SET notified_at = datetime('now') WHERE id = ?")
  for (const r of rows) mark.run(r.id)
  return true
}

function formatRecap(rows: RecapRow[]): string {
  const out: string[] = []
  let scope = '', path = ''
  for (const r of rows) {
    const s = `${r.name}/${r.branch}`
    if (s !== scope) out.push(`\n== ${s} — ${appUrl()}/r/${r.token}`), (scope = s), (path = '')
    if (r.path !== path) out.push(`  ${r.path}`), (path = r.path)
    out.push(`  ${line(r)}`)
  }
  return out.join('\n').trim()
}

/** Runs every minute: session-end emails for quiet tokens, then the once-a-day recap after 3pm Pacific. */
export async function sweep(send: Send = sendGrid, now = new Date()): Promise<void> {
  const db = getDb()
  const due = db
    .prepare(
      `SELECT token FROM comments WHERE notified_at IS NULL GROUP BY token HAVING MAX(created_at) <= datetime('now', ?)`,
    )
    .all(`-${QUIET_MINUTES} minutes`) as { token: string }[]
  for (const { token } of due) await notify(token, send)

  const last =
    (db.prepare("SELECT value FROM kv WHERE key = 'recap_at'").get() as { value: string } | undefined)?.value ??
    (db.prepare("SELECT datetime(?, '-1 day') AS v").get(now.toISOString()) as { v: string }).v
  if (laHour(now) < RECAP_HOUR || laDate(fromSql(last)) === laDate(now)) return

  const rows = db
    .prepare(
      `SELECT p.name, c.branch, c.token, c.path, c.author, c.body, c.type FROM comments c
       JOIN projects p ON p.id = c.project_id WHERE c.created_at > ? ORDER BY p.name, c.branch, c.path, c.id`,
    )
    .all(last) as RecapRow[]
  const day = now.toLocaleDateString('en-US', { timeZone: LA, weekday: 'short', month: 'short', day: 'numeric' })
  // A throw here skips the upsert, so the next sweep retries the recap.
  if (rows.length) await send(`Feedback recap — ${day.replace(',', '')}`, formatRecap(rows), `<review-recap@${host()}>`)
  db.prepare("INSERT INTO kv VALUES ('recap_at', datetime(?)) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    now.toISOString(),
  )
}
