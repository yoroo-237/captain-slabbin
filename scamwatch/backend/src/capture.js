// Capture of reported accounts: the server looks at the account with the ScamWatch
// Telegram account (capture/capture.py) and the report type comes from what it saw.
// Two uses:
// - report with proof: the form asks for a capture, follows it, then sends the report
//   with it (proofCapture). The capture is the proof and gives the type.
// - report without proof: the report is accepted at once and a capture in the background
//   fills the type of every report still waiting (requestCapture).
// Captures run one at a time (Telegram limits the pace). Each one is a Capture row
// created when it is queued, so its progress can be followed by its id.

import crypto from 'node:crypto'
import path from 'node:path'
import { prisma } from './db.js'
import { detectType } from './detect.js'
import { runPython, captureDir } from './python.js'
import { telegramCreds } from './telegram.js'

const SCRIPT = process.env.CAPTURE_SCRIPT || path.join(captureDir, 'capture.py')
const TIMEOUT_MS = 180_000 // a bot conversation: /start, then up to 8 buttons pressed
const REUSE_MS = 24 * 3600_000 // type of a report without proof
const PROOF_REUSE_MS = 10 * 60_000 // a proof is a fresh look at the account
export const PROOF_VALID_MS = 60 * 60_000 // a finished proof must be sent within this time
const MAX_PHOTO = 2 * 1024 * 1024
const MAX_TEXTS = 150
const MAX_MESSAGES = 200
const MAX_MEDIA = 20
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// The Telegram account is connected from Admin → Settings
export const captureEnabled = () => !!telegramCreds()

const queue = [] // capture ids, oldest first
let running = false
let current = null

const runScript = (ref) => {
  const c = telegramCreds()
  if (!c) return Promise.resolve({ error: 'not_configured' })
  return runPython(SCRIPT, [ref], { env: { TG_API_ID: String(c.apiId), TG_API_HASH: c.apiHash, TG_SESSION: c.session }, timeoutMs: TIMEOUT_MS })
}

// Every text the capture gathered, for the type detection
const textOf = (c) => [c.title, c.about, ...(Array.isArray(c.texts) ? c.texts : [])].filter(Boolean).join('\n')

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

// Same account content = same hash, whenever it was captured: texts and images only,
// not message ids or dates (a bot answers /start with new ids each time)
const hashOf = (d, media) => sha(JSON.stringify([d.kind, d.title, d.about, d.texts, d.photo ? sha(d.photo) : null, media.map((m) => m.sha256)]))

// Images of the messages, as the script sent them (base64), checked
const mediaOf = (list) => (Array.isArray(list) ? list : []).slice(0, MAX_MEDIA).map((m, position) => {
  const data = m?.data ? Buffer.from(String(m.data), 'base64') : null
  if (!data?.length || data.length > MAX_PHOTO || !MEDIA_TYPES.includes(m.mime)) return null
  return { position, messageId: Number.isInteger(m.message) ? m.message : null, mime: m.mime, size: data.length, sha256: sha(data), data }
}).filter(Boolean)

// Conversation or history, kept to known fields (shown in the admin and the proof preview)
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u.slice(0, 500) : undefined)
const messagesOf = (list, positions) => (Array.isArray(list) ? list : []).slice(0, MAX_MESSAGES).map((m) => ({
  id: Number.isInteger(m?.id) ? m.id : null,
  date: typeof m?.date === 'string' ? m.date.slice(0, 40) : null,
  from: m?.from === 'me' ? 'me' : 'them',
  text: String(m?.text || '').slice(0, 4000),
  buttons: (Array.isArray(m?.buttons) ? m.buttons : []).slice(0, 20).map((b) => ({ text: String(b?.text || '').slice(0, 200), url: httpUrl(b?.url) })),
  media: (Array.isArray(m?.media) ? m.media : []).filter((i) => positions.has(i)),
  ...(m?.edited ? { edited: true } : {}),
}))

// What a bot capture covered of the bot's buttons (capture.py), kept to known counts
const ROUTE_COUNTS = ['total', 'covered', 'ended', 'failed', 'missing', 'passes']
const routesOf = (r) => (r && typeof r === 'object'
  ? Object.fromEntries(ROUTE_COUNTS.map((k) => [k, Number.isInteger(r[k]) && r[k] >= 0 ? Math.min(r[k], 10000) : 0]))
  : undefined)

// Gives the capture's type to the reports of this account that do not have one yet
async function applyCapture(capture) {
  const type = capture.detectedType || 'other'
  await prisma.report.updateMany({ where: { targetId: capture.targetId, captured: false }, data: { type, detectedType: type, captured: true } })
}

async function runCapture(captureId) {
  const row = await prisma.capture.findUnique({ where: { id: captureId }, include: { target: true } })
  if (!row || row.status !== 'pending') return
  const { target } = row
  const ref = target.username || target.tgId
  const r = await runScript(ref)

  if (r.error) {
    await prisma.capture.update({ where: { id: row.id }, data: { status: 'failed', error: String(r.error).slice(0, 40), finishedAt: new Date() } })
    console.warn(`[capture] ${ref}: ${r.error}`)
    // Flood wait: Telegram asks to slow down, the queue pauses that long (capped at 10 min)
    if (r.error === 'flood_wait') await new Promise((ok) => setTimeout(ok, Math.min(Number(r.seconds) || 60, 600) * 1000))
    return
  }

  const texts = (Array.isArray(r.texts) ? r.texts : []).map((t) => String(t).slice(0, 4000)).slice(0, MAX_TEXTS)
  const photo = r.photo ? Buffer.from(r.photo, 'base64') : null
  const media = mediaOf(r.media)
  const data = {
    status: 'done', kind: r.kind || null, title: String(r.title || '').slice(0, 200), about: String(r.about || '').slice(0, 1000),
    texts, messages: messagesOf(r.messages, new Set(media.map((m) => m.position))),
    routes: routesOf(r.routes),
    photo: photo && photo.length <= MAX_PHOTO ? photo : null, finishedAt: new Date(),
  }
  data.detectedType = detectType(textOf(data)).type
  data.contentHash = hashOf(data, media)

  // The capture tells what the account really is, and its numeric ID never changes
  const update = { kind: data.kind || target.kind }
  if (r.id && !target.tgId && !(await prisma.target.findUnique({ where: { tgId: String(r.id) }, select: { id: true } }))) update.tgId = String(r.id)
  // All at once: a capture seen "done" always has its type on the reports
  const type = data.detectedType || 'other'
  await prisma.$transaction([
    prisma.capture.update({ where: { id: row.id }, data }),
    prisma.captureMedia.createMany({ data: media.map((m) => ({ ...m, captureId: row.id })) }),
    prisma.target.update({ where: { id: target.id }, data: update }),
    prisma.report.updateMany({ where: { targetId: target.id, captured: false }, data: { type, detectedType: type, captured: true } }),
  ])
}

async function work() {
  if (running) return
  running = true
  try {
    while (queue.length) {
      current = queue.shift()
      try { await runCapture(current) } catch (err) { console.error('[capture]', err.message) }
    }
  } finally { running = false; current = null }
}

// Queues a capture of the account, or returns the one already waiting
async function enqueue(targetId) {
  const pending = await prisma.capture.findFirst({ where: { targetId, status: 'pending' }, orderBy: { id: 'desc' }, select: { id: true } })
  const id = pending?.id ?? (await prisma.capture.create({ data: { targetId } })).id
  if (!queue.includes(id) && current !== id) queue.push(id)
  work()
  return id
}

// Report without proof, after it is saved. Returns true when a recent capture already gave the type.
export async function requestCapture(targetId) {
  const recent = await prisma.capture.findFirst({
    where: { targetId, status: 'done', finishedAt: { gte: new Date(Date.now() - REUSE_MS) } },
    orderBy: { finishedAt: 'desc' },
  })
  if (recent) { await applyCapture(recent); return true }
  if (!captureEnabled()) return false
  await enqueue(targetId)
  return false
}

// Report with proof, before it is sent: a capture of a few minutes ago is reused,
// otherwise a new one is queued. Returns the capture id to follow.
export async function proofCapture(targetId) {
  const recent = await prisma.capture.findFirst({
    where: { targetId, status: 'done', finishedAt: { gte: new Date(Date.now() - PROOF_REUSE_MS) } },
    orderBy: { finishedAt: 'desc' }, select: { id: true },
  })
  return recent ? recent.id : enqueue(targetId)
}

// The super admin asks for a fresh capture (account changed, previous capture failed)
export async function recapture(targetId) {
  if (!captureEnabled()) return false
  await enqueue(targetId)
  return true
}

// Captures waiting before this one (0 = running now or next)
export const queuedAhead = (captureId) => {
  if (current === captureId) return 0
  const i = queue.indexOf(captureId)
  return i < 0 ? 0 : i + (current ? 1 : 0)
}

// At start: captures cut by the restart go back in the queue, and accounts whose reports
// still wait for a type get one
export async function resumeCaptures() {
  if (!captureEnabled()) {
    await prisma.capture.updateMany({ where: { status: 'pending' }, data: { status: 'failed', error: 'not_configured', finishedAt: new Date() } })
    return console.warn('[capture] no Telegram account connected (Admin → Settings): reports keep the type "other", no proof capture')
  }
  const pending = await prisma.capture.findMany({ where: { status: 'pending' }, orderBy: { id: 'asc' }, select: { id: true } })
  for (const { id } of pending) if (!queue.includes(id)) queue.push(id)
  work()
  const waiting = await prisma.report.findMany({ where: { captured: false }, distinct: ['targetId'], select: { targetId: true } })
  for (const { targetId } of waiting) await requestCapture(targetId)
  if (pending.length || waiting.length) console.log(`[capture] ${pending.length} capture(s) resumed, ${waiting.length} account(s) waiting for a type`)
}
