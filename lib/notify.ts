import { getDb } from './db.ts'

/** Sends the notification email; swappable in tests. */
export type Send = (subject: string, text: string) => Promise<void>

type Pending = { branch: string; name: string }
type Row = { id: number; author: string; path: string; body: string; type: string }

const appUrl = () => process.env.APP_URL ?? 'https://review.cascadeonline.dev'

// One trailing timer per token, so comments left inside the debounce window still get sent.
const timers = new Map<string, NodeJS.Timeout>()

async function sendGrid(subject: string, text: string): Promise<void> {
  const key = process.env.SENDGRID_API_KEY
  const to = process.env.NOTIFY_EMAIL
  if (!key || !to) throw new Error('SENDGRID_API_KEY and NOTIFY_EMAIL must be set')
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.NOTIFY_FROM ?? to },
      subject,
      content: [{ type: 'text/plain', value: text }],
    }),
  })
  if (!res.ok) throw new Error(`sendgrid ${res.status}: ${await res.text()}`)
}

function schedule(token: string, send: Send): void {
  if (timers.has(token)) return
  const row = getDb()
    .prepare(
      `SELECT CAST((julianday(last_notified_at, '+10 minutes') - julianday('now')) * 86400000 AS INTEGER) AS ms
       FROM tokens WHERE token = ?`,
    )
    .get(token) as { ms: number | null } | undefined
  const timer = setTimeout(() => {
    timers.delete(token)
    void notify(token, send)
  }, Math.max(row?.ms ?? 0, 1000))
  timer.unref()
  timers.set(token, timer)
}

/**
 * Emails every unnotified comment on the token, at most once per 10 minutes.
 * Resolves to true when a mail was sent. Never throws: failures log and retry on the next comment.
 */
export async function notify(token: string, send: Send = sendGrid): Promise<boolean> {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, author, path, body, type FROM comments WHERE token = ? AND notified_at IS NULL ORDER BY id')
    .all(token) as Row[]
  if (!rows.length) return false

  const due = db
    .prepare(
      `SELECT t.branch, p.name FROM tokens t JOIN projects p ON p.id = t.project_id
       WHERE t.token = ? AND (t.last_notified_at IS NULL OR t.last_notified_at <= datetime('now', '-10 minutes'))`,
    )
    .get(token) as Pending | undefined
  if (!due) {
    schedule(token, send)
    return false
  }

  // Claim the window before sending so concurrent creates can't double-send.
  db.prepare("UPDATE tokens SET last_notified_at = datetime('now') WHERE token = ?").run(token)

  const n = rows.length
  const subject = `${n} new comment${n === 1 ? '' : 's'} on ${due.name}/${due.branch}`
  const text = [
    `${appUrl()}/r/${token}`,
    '',
    ...rows.map((r) => `[${r.type === 'change_request' ? 'change request' : 'comment'}] ${r.author} on ${r.path}:\n${r.body}`),
  ].join('\n')

  try {
    await send(subject, text)
  } catch (error) {
    console.error('notify: send failed', error)
    schedule(token, send)
    return false
  }

  const mark = db.prepare("UPDATE comments SET notified_at = datetime('now') WHERE id = ?")
  for (const r of rows) mark.run(r.id)
  return true
}
