import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'review-')), 'test.db')
const { getDb } = await import('./db.ts')
const { createComment, toggleStatus } = await import('./comments.ts')
const { sweep } = await import('./notify.ts')
const { addNote } = await import('./agent.ts')

const db = getDb()
const projectId = Number(
  db
    .prepare('INSERT INTO projects (name, slug, vercel_project, vercel_team) VALUES (?, ?, ?, ?)')
    .run('Acme', 'acme', 'acme-site', 'cascade').lastInsertRowid,
)
db.prepare('INSERT INTO tokens (token, project_id, branch) VALUES (?, ?, ?)').run('tok11111', projectId, 'feature/x')

type Mail = { subject: string; text: string; html: string; thread: string }
const sent: Mail[] = []
const send = async (mail: Mail) => void sent.push(mail)
const boom = async () => {
  throw new Error('sendgrid down')
}
const post = (body: string) => createComment({ token: 'tok11111', path: '/', author: 'Dana', body })
const backdate = (body: string, minutes: number) =>
  db.prepare("UPDATE comments SET created_at = datetime('now', ?) WHERE body = ?").run(`-${minutes} minutes`, body)
const unnotified = () =>
  (db.prepare('SELECT COUNT(*) AS n FROM comments WHERE notified_at IS NULL').get() as { n: number }).n
const fromSql = (s: string) => new Date(s.replace(' ', 'T') + 'Z')
const recapAt = () => (db.prepare("SELECT value FROM kv WHERE key = 'recap_at'").get() as { value: string } | undefined)?.value

// Fixed offsets keep these on today's LA date whether or not DST is in effect.
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
const morning = new Date(`${today}T09:00:00-08:00`)
const afternoon = new Date(`${today}T16:30:00-08:00`)
const nextDay = new Date(afternoon.getTime() + 86_400_000)

test('a fresh comment is not sent: the session may still be going', async () => {
  post('one')
  await sweep(send, morning)
  assert.equal(sent.length, 0)
  assert.equal(unnotified(), 1)
})

test('2 quiet hours ends the session and sends one threaded email', async () => {
  backdate('one', 121)
  await sweep(send, morning)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].subject, 'Feedback: Acme/feature/x')
  assert.equal(sent[0].thread, '<review-tok11111@review.cascadeonline.dev>')
  assert.match(sent[0].text, /1 new comment/)
  assert.match(sent[0].text, /one/)
  // The URL is an anchor href in the HTML part, not bare text in the copy.
  assert.match(sent[0].html, /<a href="https:\/\/review\.cascadeonline\.dev\/r\/tok11111"[^>]*>Open review<\/a>/)
  assert.equal(unnotified(), 0)
})

test('one fresh comment holds the whole batch until the session ends', async () => {
  post('two')
  post('three')
  post('four')
  backdate('two', 180)
  backdate('three', 150)
  await sweep(send, morning)
  assert.equal(sent.length, 1, 'still an active session')
  assert.equal(unnotified(), 3)

  backdate('four', 121)
  await sweep(send, morning)
  assert.equal(sent.length, 2)
  assert.match(sent[1].text, /^Acme\/feature\/x — 3 new comments/)
  for (const body of ['two', 'three', 'four']) assert.match(sent[1].text, new RegExp(body))
  assert.equal(unnotified(), 0)
})

test('a failed send leaves the comments unnotified for the next sweep', async () => {
  post('five')
  backdate('five', 121)
  await sweep(boom, morning)
  assert.equal(unnotified(), 1)
  await sweep(send, morning)
  assert.equal(sent.at(-1)!.text.includes('five'), true)
  assert.equal(unnotified(), 0)
})

test('the afternoon recap goes out once a day and covers everything', async () => {
  await sweep(send, morning)
  assert.equal(recapAt(), undefined, 'not before 3pm')

  await sweep(send, afternoon)
  const recap = sent.at(-1)!
  assert.match(recap.subject, /^Feedback recap — \w{3} \w{3} \d+$/)
  assert.equal(recap.thread, '<review-recap@review.cascadeonline.dev>')
  assert.match(recap.text, /Acme\/feature\/x/)
  assert.match(recap.html, /<a href="https:\/\/review\.cascadeonline\.dev\/r\/tok11111"/)
  for (const body of ['one', 'two', 'three', 'four', 'five']) assert.match(recap.text, new RegExp(body))
  const count = sent.length

  await sweep(send, afternoon)
  assert.equal(sent.length, count, 'same day: no second recap')
})

test('the next recap only covers comments since the last one, and stays silent when empty', async () => {
  const first = recapAt()!
  // Pin the earlier comments before the first recap; their real created_at depends on when the suite runs.
  db.prepare("UPDATE comments SET created_at = datetime(?, '-1 minute')").run(afternoon.toISOString())
  post('six')
  db.prepare("UPDATE comments SET created_at = datetime(?, '+1 minute') WHERE body = 'six'").run(afternoon.toISOString())
  await sweep(send, nextDay)
  const recap = sent.at(-1)!
  assert.match(recap.subject, /^Feedback recap/)
  assert.match(recap.text, /six/)
  assert.doesNotMatch(recap.text, /five/)

  const count = sent.length
  const dayAfter = new Date(nextDay.getTime() + 86_400_000)
  await sweep(send, dayAfter)
  assert.equal(sent.length, count, 'nothing new: no email')
  assert.notEqual(recapAt(), first)
  assert.notEqual(recapAt(), undefined)
})

test('comment bodies are escaped into the HTML part', async () => {
  // Earlier tests leave rows dated into the future, which would hold this token's session open.
  db.prepare("UPDATE comments SET notified_at = datetime('now') WHERE notified_at IS NULL").run()
  createComment({ token: 'tok11111', path: '/<img>', author: 'Mal <x>', body: '<script>alert(1)</script> & "quotes"' })
  backdate('<script>alert(1)</script> & "quotes"', 121)
  await sweep(send, morning)
  const mail = sent.at(-1)!
  assert.doesNotMatch(mail.html, /<script>/)
  assert.match(mail.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quotes&quot;/)
  assert.match(mail.html, /Mal &lt;x&gt;/)
  assert.match(mail.html, /\/&lt;img&gt;/)
})

test('replies nest under their parent, chronologically, with the element quoted', async () => {
  db.prepare("UPDATE comments SET notified_at = datetime('now') WHERE notified_at IS NULL").run()
  const root = createComment({
    token: 'tok11111',
    path: '/pricing',
    author: 'Dana',
    body: 'headline too long',
    type: 'change_request',
    element_text: 'Ship faster, review sooner',
  })
  createComment({ token: 'tok11111', path: '/pricing', author: 'Sam', body: 'cut to six words', parent_id: root.id })
  addNote('acme', 'feature/x', root.id, 'shortened the headline')
  for (const body of ['headline too long', 'cut to six words']) backdate(body, 121)

  await sweep(send, morning)
  const mail = sent.at(-1)!
  assert.match(mail.text, /2 new comments/)
  assert.match(mail.text, /\/pricing\n {2}"Ship faster, review sooner"\n {2}\[change request\] Dana: headline too long\n {4}↳ \[comment\] Sam: cut to six words/)
  // The reply renders inside the indented rail that follows its root.
  assert.match(mail.html, /Dana<\/span>.*headline too long.*border-left:2px solid #e4e4e7.*Sam<\/span>.*cut to six words/s)
  // Agent notes are pre-notified, so the session digest never carries them.
  assert.doesNotMatch(mail.text, /shortened the headline/)
})

test('a reply whose parent was already emailed brings the parent along as context', async () => {
  const root = db.prepare("SELECT id FROM comments WHERE body = 'headline too long'").get() as { id: number }
  createComment({ token: 'tok11111', path: '/pricing', author: 'Kim', body: 'and make it bold', parent_id: root.id })
  backdate('and make it bold', 121)

  await sweep(send, morning)
  const mail = sent.at(-1)!
  assert.match(mail.text, /1 new comment\b/, 'the context parent is not counted as new')
  assert.match(mail.text, / {2}Dana \(earlier\): headline too long\n {4}↳ \[comment\] Kim: and make it bold/)
  assert.match(mail.html, /&middot; earlier/)
})

test('the recap collapses agent notes into their thread and marks resolved threads', async () => {
  const root = db.prepare("SELECT id FROM comments WHERE body = 'headline too long'").get() as { id: number }
  toggleStatus(root.id)
  const last = recapAt()!
  // Pin everything in this scenario just after the last recap so the window picks it up.
  db.prepare("UPDATE comments SET created_at = datetime(?, '+1 minute'), notified_at = datetime('now') WHERE id >= ?").run(last, root.id)

  const after = new Date(fromSql(last).getTime() + 86_400_000)
  await sweep(send, after)
  const recap = sent.at(-1)!
  assert.match(recap.subject, /^Feedback recap/)
  assert.match(recap.text, / {2}\[change request\] Dana \(resolved\): headline too long/)
  assert.match(recap.text, /↳ \[agent note\] Claude \(agent\): shortened the headline/)
  assert.match(recap.html, /<details[^>]*><summary[^>]*>Agent note &middot; Claude \(agent\)<\/summary>/)
  assert.match(recap.html, />Resolved</)
})
