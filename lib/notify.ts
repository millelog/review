import { getDb } from './db.ts'

export type Mail = { subject: string; text: string; html: string; thread: string }
/** Sends one email; `thread` is the Message-ID replies chain onto. Swappable in tests. */
export type Send = (mail: Mail) => Promise<void>

type Row = { author: string; path: string; body: string; type: string }
type RecapRow = Row & { name: string; branch: string; token: string }

const TYPE: Record<string, { label: string; fg: string; bg: string }> = {
  comment: { label: 'Comment', fg: '#3f3f46', bg: '#f4f4f5' },
  change_request: { label: 'Change request', fg: '#9a3412', bg: '#ffedd5' },
  copy: { label: 'Content', fg: '#1e40af', bg: '#dbeafe' },
}
const LA = 'America/Los_Angeles'
const QUIET_MINUTES = 120
const RECAP_HOUR = 15

const appUrl = () => process.env.APP_URL ?? 'https://review.cascadeonline.dev'
const host = () => new URL(appUrl()).host
const laDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: LA })
// h23, not hour12:false: V8 has returned "24" at midnight with the latter.
const laHour = (d: Date) => Number(d.toLocaleTimeString('en-US', { timeZone: LA, hourCycle: 'h23', hour: '2-digit' }))
const fromSql = (s: string) => new Date(s.replace(' ', 'T') + 'Z')
const type = (t: string) => TYPE[t] ?? TYPE.comment
const plural = (n: number) => `${n} new comment${n === 1 ? '' : 's'}`

// Comment bodies, authors and paths are client input, so everything interpolated into HTML goes through this.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const line = (r: Row) => `  [${type(r.type).label.toLowerCase()}] ${r.author}: ${r.body.replace(/\n/g, '\n    ')}`

/** Groups a path-ordered run of comments under monospace path headers. */
function commentsHtml(rows: Row[]): string {
  let out = ''
  let path: string | null = null
  for (const r of rows) {
    if (r.path !== path) {
      if (path !== null) out += '</div>'
      out +=
        `<div style="margin:0 0 22px">` +
        `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#71717a;padding-bottom:7px;border-bottom:1px solid #e4e4e7;margin-bottom:12px">${esc(r.path)}</div>`
      path = r.path
    }
    const t = type(r.type)
    out +=
      `<div style="margin:0 0 14px">` +
      `<div style="margin:0 0 4px"><span style="background:${t.bg};color:${t.fg};font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;padding:2px 7px;border-radius:4px">${t.label}</span>` +
      `<span style="font-weight:600;margin-left:8px">${esc(r.author)}</span></div>` +
      `<div style="color:#3f3f46">${esc(r.body).replace(/\n/g, '<br>')}</div>` +
      `</div>`
  }
  return out + (path !== null ? '</div>' : '')
}

/** Plain-text counterpart of commentsHtml. */
function pathBlocks(rows: Row[]): string[] {
  const out: string[] = []
  let path: string | null = null
  for (const r of rows) {
    if (r.path !== path) {
      out.push(`${path === null ? '' : '\n'}${r.path}`)
      path = r.path
    }
    out.push(line(r))
  }
  return out
}

const shell = (inner: string) =>
  `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#18181b;max-width:640px">${inner}</div>`

const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:500">${label}</a>`

const scopeLine = (name: string, branch: string) => `${esc(name)} <span style="color:#a1a1aa">/</span> ${esc(branch)}`

async function sendGrid({ subject, text, html, thread }: Mail): Promise<void> {
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
      // Off, or SendGrid rewrites every link through u<id>.ct.sendgrid.net, which reads as phishing.
      tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } },
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
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
    .prepare(
      'SELECT id, author, path, body, type FROM comments WHERE token = ? AND notified_at IS NULL ORDER BY path, id',
    )
    .all(token) as (Row & { id: number })[]
  if (!rows.length) return false
  const { name, branch } = db
    .prepare('SELECT p.name, t.branch FROM tokens t JOIN projects p ON p.id = t.project_id WHERE t.token = ?')
    .get(token) as { name: string; branch: string }

  const link = `${appUrl()}/r/${token}`
  const text = [`${name}/${branch} — ${plural(rows.length)}`, '', ...pathBlocks(rows), '', link].join('\n')
  const html = shell(
    `<p style="margin:0 0 2px;font-size:17px;font-weight:600">${scopeLine(name, branch)}</p>` +
      `<p style="margin:0 0 24px;color:#71717a;font-size:14px">${plural(rows.length)}</p>` +
      commentsHtml(rows) +
      `<p style="margin:26px 0 0">${button(link, 'Open review')}</p>`,
  )

  try {
    await send({ subject: `Feedback: ${name}/${branch}`, text, html, thread: `<review-${token}@${host()}>` })
  } catch (error) {
    console.error('notify: send failed', error)
    return false
  }
  const mark = db.prepare("UPDATE comments SET notified_at = datetime('now') WHERE id = ?")
  for (const r of rows) mark.run(r.id)
  return true
}

/** One section per review link. Keyed by token, which already pins project and branch. */
function recapBody(rows: RecapRow[]): { text: string; html: string } {
  const groups = new Map<string, RecapRow[]>()
  for (const r of rows) {
    const group = groups.get(r.token)
    if (group) group.push(r)
    else groups.set(r.token, [r])
  }
  const text: string[] = []
  let html = ''
  for (const group of groups.values()) {
    const { name, branch, token } = group[0]
    const link = `${appUrl()}/r/${token}`
    text.push(`${name}/${branch} — ${plural(group.length)}`, ...pathBlocks(group), '', link, '')
    html +=
      `<div style="margin:0 0 34px">` +
      `<p style="margin:0 0 4px;font-size:16px;font-weight:600">${scopeLine(name, branch)}</p>` +
      `<p style="margin:0 0 18px;font-size:14px"><span style="color:#71717a">${plural(group.length)}</span>` +
      ` &middot; <a href="${link}" style="color:#18181b">Open review</a></p>` +
      commentsHtml(group) +
      `</div>`
  }
  return { text: text.join('\n').trim(), html }
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
  const day = now
    .toLocaleDateString('en-US', { timeZone: LA, weekday: 'short', month: 'short', day: 'numeric' })
    .replace(',', '')
  // A throw here skips the upsert, so the next sweep retries the recap.
  if (rows.length) {
    const { text, html } = recapBody(rows)
    await send({
      subject: `Feedback recap — ${day}`,
      text: `${plural(rows.length)} since the last recap\n\n${text}`,
      html: shell(
        `<p style="margin:0 0 2px;font-size:17px;font-weight:600">Feedback recap</p>` +
          `<p style="margin:0 0 28px;color:#71717a;font-size:14px">${day} &middot; ${plural(rows.length)} since the last recap</p>` +
          html,
      ),
      thread: `<review-recap@${host()}>`,
    })
  }
  db.prepare("INSERT INTO kv VALUES ('recap_at', datetime(?)) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    now.toISOString(),
  )
}
