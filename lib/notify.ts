import { getDb } from './db.ts'

export type Mail = { subject: string; text: string; html: string; thread: string }
/** Sends one email; `thread` is the Message-ID replies chain onto. Swappable in tests. */
export type Send = (mail: Mail) => Promise<void>

type Row = {
  id: number
  parent_id: number | null
  author: string
  path: string
  body: string
  type: string
  status: string
  internal: number
  element_text: string
}
type RecapRow = Row & { name: string; branch: string; token: string }
/** A thread root with its replies in order; `context` marks a parent pulled in from an earlier email. */
type Node = Row & { replies: Row[]; context?: boolean }

const COLS = 'id, parent_id, author, path, body, type, status, internal, element_text'
const C_COLS = COLS.split(', ')
  .map((c) => `c.${c}`)
  .join(', ')

const TYPE: Record<string, { label: string; fg: string; bg: string }> = {
  comment: { label: 'Comment', fg: '#3f3f46', bg: '#f4f4f5' },
  change_request: { label: 'Change request', fg: '#9a3412', bg: '#ffedd5' },
  copy: { label: 'Content', fg: '#1e40af', bg: '#dbeafe' },
}
const LA = 'America/Los_Angeles'
const QUIET_MINUTES = 120
const RECAP_HOUR = 15
const QUOTE_MAX = 80
const CONTEXT_MAX = 140

const appUrl = () => process.env.APP_URL ?? 'https://review.cascadeonline.dev'
const host = () => new URL(appUrl()).host
const laDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: LA })
// h23, not hour12:false: V8 has returned "24" at midnight with the latter.
const laHour = (d: Date) => Number(d.toLocaleTimeString('en-US', { timeZone: LA, hourCycle: 'h23', hour: '2-digit' }))
const fromSql = (s: string) => new Date(s.replace(' ', 'T') + 'Z')
const type = (t: string) => TYPE[t] ?? TYPE.comment
const plural = (n: number) => `${n} new comment${n === 1 ? '' : 's'}`
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

// Comment bodies, authors and paths are client input, so everything interpolated into HTML goes through this.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Path-grouped threads: replies chronological under their root. A reply whose parent went out in an
 * earlier email pulls that parent in as muted context, so the batch never opens mid-conversation.
 */
function group(rows: Row[]): { path: string; threads: Node[] }[] {
  const byId = new Map<number, Node>()
  for (const r of rows) if (r.parent_id === null) byId.set(r.id, { ...r, replies: [] })

  const missing = [...new Set(rows.map((r) => r.parent_id).filter((id): id is number => id !== null && !byId.has(id)))]
  if (missing.length) {
    const parents = getDb()
      .prepare(`SELECT ${COLS} FROM comments WHERE id IN (${missing.map(() => '?').join(',')})`)
      .all(...missing) as Row[]
    for (const p of parents) byId.set(p.id, { ...p, replies: [], context: true })
  }

  const seen = new Set<number>()
  const threads: Node[] = []
  for (const r of rows) {
    const root = byId.get(r.parent_id ?? r.id)
    if (!root) {
      threads.push({ ...r, replies: [] }) // parent vanished (deleted): render it flat rather than drop it
      continue
    }
    if (!seen.has(root.id)) {
      seen.add(root.id)
      threads.push(root)
    }
    if (r.parent_id !== null) root.replies.push(r)
  }

  const out: { path: string; threads: Node[] }[] = []
  for (const t of threads) {
    t.replies.sort((a, b) => a.id - b.id)
    const last = out.at(-1)
    if (last?.path === t.path) last.threads.push(t)
    else out.push({ path: t.path, threads: [t] })
  }
  return out
}

const chip = (label: string, fg: string, bg: string) =>
  `<span style="background:${bg};color:${fg};font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;padding:2px 7px;border-radius:4px">${label}</span>`

const bodyHtml = (s: string) => esc(s).replace(/\n/g, '<br>')

// ponytail: <details> is the whole collapse mechanism. Gmail strips the tag and shows the note inline —
// acceptable, it is still muted and still inside its thread.
const noteHtml = (r: Row) =>
  `<details style="margin:0 0 12px">` +
  `<summary style="cursor:pointer;color:#71717a;font-size:13px">Agent note &middot; ${esc(r.author)}</summary>` +
  `<div style="color:#71717a;font-size:14px;margin:6px 0 0">${bodyHtml(r.body)}</div></details>`

function commentHtml(r: Row, ctx = false): string {
  if (r.internal) return noteHtml(r)
  const t = type(r.type)
  const head = ctx
    ? `<span style="font-weight:600;color:#a1a1aa">${esc(r.author)}</span><span style="color:#a1a1aa;font-size:13px"> &middot; earlier</span>`
    : chip(t.label, t.fg, t.bg) +
      `<span style="font-weight:600;margin-left:8px">${esc(r.author)}</span>` +
      (r.status === 'resolved' ? ` ${chip('Resolved', '#52525b', '#e4e4e7')}` : '')
  return (
    `<div style="margin:0 0 12px"><div style="margin:0 0 4px">${head}</div>` +
    `<div style="color:${ctx ? '#a1a1aa' : '#3f3f46'}">${bodyHtml(ctx ? clip(r.body, CONTEXT_MAX) : r.body)}</div></div>`
  )
}

function threadHtml(t: Node): string {
  const quote = t.element_text.trim()
  return (
    `<div style="margin:0 0 24px">` +
    (quote
      ? `<div style="color:#a1a1aa;font-size:13px;font-style:italic;margin:0 0 6px">&ldquo;${esc(clip(quote, QUOTE_MAX))}&rdquo;</div>`
      : '') +
    commentHtml(t, t.context) +
    (t.replies.length
      ? `<div style="border-left:2px solid #e4e4e7;padding-left:14px;margin-left:4px">${t.replies.map((r) => commentHtml(r)).join('')}</div>`
      : '') +
    `</div>`
  )
}

/** Threads under monospace path headers. */
function commentsHtml(rows: Row[]): string {
  return group(rows)
    .map(
      ({ path, threads }) =>
        `<div style="margin:0 0 22px">` +
        `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#71717a;padding-bottom:7px;border-bottom:1px solid #e4e4e7;margin-bottom:12px">${esc(path)}</div>` +
        threads.map(threadHtml).join('') +
        `</div>`,
    )
    .join('')
}

function line(r: Row, indent: string, ctx = false): string {
  const tag = ctx ? '' : r.internal ? '[agent note] ' : `[${type(r.type).label.toLowerCase()}] `
  const suffix = ctx ? ' (earlier)' : r.status === 'resolved' ? ' (resolved)' : ''
  const body = ctx ? clip(r.body, CONTEXT_MAX) : r.body
  return `${indent}${tag}${r.author}${suffix}: ${body.replace(/\n/g, `\n${' '.repeat(indent.length + 2)}`)}`
}

/** Plain-text counterpart of commentsHtml. */
function pathBlocks(rows: Row[]): string[] {
  const out: string[] = []
  for (const { path, threads } of group(rows)) {
    if (out.length) out.push('')
    out.push(path)
    for (const t of threads) {
      if (t.element_text.trim()) out.push(`  "${clip(t.element_text.trim(), QUOTE_MAX)}"`)
      out.push(line(t, '  ', t.context))
      for (const r of t.replies) out.push(line(r, '    ↳ '))
    }
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
    .prepare(`SELECT ${COLS} FROM comments WHERE token = ? AND notified_at IS NULL ORDER BY path, id`)
    .all(token) as Row[]
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
      `SELECT p.name, c.branch, c.token, ${C_COLS} FROM comments c
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
