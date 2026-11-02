// Capture of reported accounts: the server looks at the account with the ScamWatch
// Telegram account (capture/capture.py) and the report type comes from what it saw.
// Reports are accepted at once; captures run in the background, one at a time
// (Telegram limits the pace), and fill the type of every report still waiting.
// A capture younger than REUSE_MS is reused instead of asking Telegram again.

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from './db.js'
import { detectType } from './detect.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = process.env.CAPTURE_SCRIPT || path.resolve(here, '../../capture/capture.py')
const PYTHON = process.env.CAPTURE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const TIMEOUT_MS = 120_000
const REUSE_MS = 24 * 3600_000
const MAX_PHOTO = 2 * 1024 * 1024

export const captureEnabled = () => !!(process.env.TG_API_ID && process.env.TG_API_HASH && process.env.TG_SESSION)

const queue = []
let running = false
let current = null

function runScript(ref) {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [SCRIPT, ref], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); resolve({ error: 'timeout' }) }, TIMEOUT_MS)
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', () => { clearTimeout(timer); resolve({ error: 'crashed' }) })
    child.on('close', () => {
      clearTimeout(timer)
      try { resolve(JSON.parse(stdout)) } catch {
        console.error('[capture] script output unreadable:', stderr.slice(-500))
        resolve({ error: 'crashed' })
      }
    })
  })
}

// Every text the capture gathered, for the type detection
const textOf = (c) => [c.title, c.about, ...(Array.isArray(c.texts) ? c.texts : [])].filter(Boolean).join('\n')

// Gives the capture's type to the reports of this account that do not have one yet
async function applyCapture(capture) {
  const type = capture.detectedType || 'other'
  await prisma.report.updateMany({ where: { targetId: capture.targetId, captured: false }, data: { type, detectedType: type, captured: true } })
}

async function captureTarget(targetId) {
  const target = await prisma.target.findUnique({ where: { id: targetId } })
  if (!target) return
  const ref = target.username || target.tgId
  const row = await prisma.capture.create({ data: { targetId } })
  const r = await runScript(ref)

  if (r.error) {
    await prisma.capture.update({ where: { id: row.id }, data: { status: 'failed', error: String(r.error).slice(0, 40), finishedAt: new Date() } })
    console.warn(`[capture] ${ref}: ${r.error}`)
    // Flood wait: Telegram asks to slow down, the queue pauses that long (capped at 10 min)
    if (r.error === 'flood_wait') await new Promise((ok) => setTimeout(ok, Math.min(Number(r.seconds) || 60, 600) * 1000))
    return
  }

  const texts = (Array.isArray(r.texts) ? r.texts : []).map((t) => String(t).slice(0, 4000)).slice(0, 30)
  const photo = r.photo ? Buffer.from(r.photo, 'base64') : null
  const data = {
    status: 'done', kind: r.kind || null, title: String(r.title || '').slice(0, 200), about: String(r.about || '').slice(0, 1000),
    texts, photo: photo && photo.length <= MAX_PHOTO ? photo : null, finishedAt: new Date(),
  }
  data.detectedType = detectType(textOf(data)).type
  const done = await prisma.capture.update({ where: { id: row.id }, data })

  // The capture tells what the account really is, and its numeric ID never changes
  const update = { kind: data.kind || target.kind }
  if (r.id && !target.tgId && !(await prisma.target.findUnique({ where: { tgId: String(r.id) }, select: { id: true } }))) update.tgId = String(r.id)
  await prisma.target.update({ where: { id: targetId }, data: update })
  await applyCapture(done)
}

async function work() {
  if (running) return
  running = true
  try {
    while (queue.length) {
      current = queue.shift()
      try { await captureTarget(current) } catch (err) { console.error('[capture]', err.message) }
    }
  } finally { running = false; current = null }
}

// Called after each report. Returns true when a recent capture already gave the type.
export async function requestCapture(targetId) {
  const recent = await prisma.capture.findFirst({
    where: { targetId, status: 'done', finishedAt: { gte: new Date(Date.now() - REUSE_MS) } },
    orderBy: { finishedAt: 'desc' },
  })
  if (recent) { await applyCapture(recent); return true }
  if (!captureEnabled()) return false
  if (!queue.includes(targetId)) queue.push(targetId)
  work()
  return false
}

// The super admin asks for a fresh capture (account changed, previous capture failed)
export function recapture(targetId) {
  if (!captureEnabled()) return false
  if (!queue.includes(targetId)) queue.push(targetId)
  work()
  return true
}

export const captureQueued = (targetId) => queue.includes(targetId) || current === targetId

// At start, accounts whose reports still wait for a type go back in the queue
export async function resumeCaptures() {
  await prisma.capture.updateMany({ where: { status: 'pending' }, data: { status: 'failed', error: 'interrupted', finishedAt: new Date() } })
  if (!captureEnabled()) return console.warn('[capture] TG_API_ID / TG_API_HASH / TG_SESSION not set: reports keep the type "other"')
  const waiting = await prisma.report.findMany({ where: { captured: false }, distinct: ['targetId'], select: { targetId: true } })
  for (const { targetId } of waiting) await requestCapture(targetId)
  if (waiting.length) console.log(`[capture] ${waiting.length} account(s) queued`)
}
