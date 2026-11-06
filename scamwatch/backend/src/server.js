import 'dotenv/config'
import 'express-async-errors'
import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { prisma, getSettings, saveSettings } from './db.js'
import { detectType } from './detect.js'
import { parseTarget } from './target.js'
import { decodeItems, hasProof, minWithProof, MAX_FILES_LIMIT, MAX_TOTAL_BYTES } from './proof.js'
import { authRouter, requireUser, requireSuper, bootstrapSuperadmin } from './auth.js'
import { walletRouter, webhookRouter, adminWalletRouter, startWalletJobs } from './wallet.js'
import { getHoldings, allocateUsd, debit, round2 } from './balance.js'
import { getCachedUsdPrices } from './price.js'
import { requestCapture, proofCapture, recapture, queuedAhead, captureEnabled, resumeCaptures, PROOF_VALID_MS } from './capture.js'
import { startScheduledReports } from './scheduled.js'
import { adminTelegramRouter, loadTelegram } from './telegram.js'

const app = express()
const here = path.dirname(fileURLToPath(import.meta.url))
const SALT = process.env.IP_SALT || 'scamwatch'
const STATUSES = ['pending', 'confirmed', 'rejected']
const MAX_REPORTS_LIMIT = 1000

app.set('trust proxy', 1)
app.use(cors())

// Reports carry media (base64, up to MAX_TOTAL_BYTES raw per send in proof.js),
// Alchemy needs the raw body for its signature, every other route stays small
const smallJson = express.json({ limit: '100kb' })
const reportJson = express.json({ limit: '42mb' })
const rawBody = express.raw({ type: '*/*', limit: '1mb' })
app.use((req, res, next) => {
  if (req.path === '/api/reports') return reportJson(req, res, next)
  if (req.path === '/api/webhooks/alchemy') return rawBody(req, res, next)
  return smallJson(req, res, next)
})

const hashIp = (ip) => crypto.createHash('sha256').update(`${SALT}:${ip}`).digest('hex')

// Liste blanche : un compte y figure par son @username ou par son ID numérique
const whereTarget = (t) => (t.username ? { username: t.username } : { tgId: t.tgId })
const targetKeys = (t) => [t.username && { username: t.username }, t.tgId && { tgId: t.tgId }].filter(Boolean)
// Les deux identifiants comptent, y compris celui que seule la fiche connue du compte possède
// (signalé par @username alors que seul son ID est en liste blanche, et inversement)
const isWhitelisted = async (t) => {
  const known = await prisma.target.findMany({ where: { OR: targetKeys(t) }, select: { username: true, tgId: true } })
  const keys = [t, ...known].flatMap(targetKeys)
  return !!(await prisma.whitelistEntry.findFirst({ where: { OR: keys }, select: { id: true } }))
}

// Filtre Prisma qui écarte les comptes en liste blanche des listes publiques.
// Les champs nuls sont gardés à part : en SQL, "NULL NOT IN (...)" n'est jamais vrai.
async function notWhitelisted() {
  const rows = await prisma.whitelistEntry.findMany({ select: { username: true, tgId: true } })
  const usernames = rows.map((r) => r.username).filter(Boolean)
  const tgIds = rows.map((r) => r.tgId).filter(Boolean)
  const and = []
  if (usernames.length) and.push({ OR: [{ username: null }, { username: { notIn: usernames } }] })
  if (tgIds.length) and.push({ OR: [{ tgId: null }, { tgId: { notIn: tgIds } }] })
  return and.length ? { AND: and } : {}
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.use('/api/auth', authRouter(hashIp))
app.use('/api/wallet', walletRouter())
app.use('/api/webhooks', webhookRouter())

// Live preview of the detected type while the user types
app.post('/api/detect', (req, res) => {
  const { description = '', proofUrl = '' } = req.body || {}
  res.json(detectType(description, proofUrl))
})

// Price of a report, shown before sending
app.get('/api/pricing', async (_req, res) => {
  const s = await getSettings()
  res.json({
    tokenPriceUsd: s.tokenPriceUsd, reportCostTokens: s.reportCostTokens, maxReportsNoProof: s.maxReportsNoProof,
    maxMediaPerReport: s.maxMediaPerReport, maxSendMb: s.maxSendMb, proofCapture: captureEnabled(),
  })
})

// Report with proof, step 1: the server captures the account, the form follows the
// capture (GET below) and then sends the report with its id.
// One capture asked at a time per user, and at most PROOF_PER_HOUR per hour.
const PROOF_PER_HOUR = 20
const proofAsks = new Map() // userId -> [timestamps]
app.post('/api/captures', requireUser, async (req, res) => {
  const target = parseTarget(req.body?.target)
  if (!target) return res.status(400).json({ error: 'invalid_target' })
  if (await isWhitelisted(target)) return res.status(403).json({ error: 'protected_account' })
  if (!captureEnabled()) return res.status(503).json({ error: 'capture_not_configured' })

  const now = Date.now()
  const asks = (proofAsks.get(req.user.id) || []).filter((t) => t > now - 3600_000)
  if (req.user.role !== 'superadmin' && asks.length >= PROOF_PER_HOUR) return res.status(429).json({ error: 'too_many_captures' })
  proofAsks.set(req.user.id, [...asks, now])

  // The account is known from now on, it shows in the lists only once reported (reportCount > 0)
  const t = await prisma.target.upsert({ where: whereTarget(target), update: {}, create: { ...target } })
  res.status(201).json({ captureId: await proofCapture(t.id) })
})

// What the form shows of the capture: the account's public profile, no photo bytes
app.get('/api/captures/:id', requireUser, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' })
  const c = await prisma.capture.findUnique({
    where: { id },
    select: {
      id: true, status: true, error: true, kind: true, title: true, about: true, texts: true, messages: true, detectedType: true, finishedAt: true, photo: true,
      media: { select: { id: true, position: true }, orderBy: { position: 'asc' } },
    },
  })
  if (!c) return res.status(404).json({ error: 'not_found' })
  const texts = Array.isArray(c.texts) ? c.texts : []
  res.json({
    id: c.id, status: c.status, error: c.error, kind: c.kind, title: c.title, about: c.about.slice(0, 300),
    texts: texts.slice(0, 3).map((x) => String(x).slice(0, 200)), textCount: texts.length,
    messages: c.messages, media: c.media,
    detectedType: c.detectedType, finishedAt: c.finishedAt, hasPhoto: !!c.photo,
    ahead: c.status === 'pending' ? queuedAhead(c.id) : 0,
  })
})

// Image of a captured message (photo or video thumbnail)
app.get('/api/captures/media/:id', requireUser, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' })
  const m = await prisma.captureMedia.findUnique({ where: { id }, select: { mime: true, data: true } })
  if (!m) return res.status(404).json({ error: 'not_found' })
  res.set({ 'Content-Type': m.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' })
  res.send(Buffer.from(m.data))
})

app.get('/api/captures/:id/photo', requireUser, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' })
  const c = await prisma.capture.findUnique({ where: { id }, select: { photo: true } })
  if (!c?.photo) return res.status(404).json({ error: 'not_found' })
  res.set({ 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' })
  res.send(Buffer.from(c.photo))
})

// An account can be reported again and again, as long as each report brings
// evidence never sent for this account. Without evidence, a limited number of reports
// per user and account (set in the super admin space).
// Each report costs tokens, taken from the user's wallet.
// items: one entry per report, 1 to MAX_BATCH, each with its own proof: a link (a forwarded
// message's t.me link, for example) and/or media (screenshots, videos, voice messages).
// No proof is shared: the same link or file in two reports is refused, and so is one this
// account has already seen. In a batch, at least a third of the reports carry a proof.
// captureId: a capture of the account taken for this send, the proof of the first report only.
// Older clients send count, proofUrl and files: one report with them, the others without proof.
// spreadMinutes: the batch can be spread over a period, in steps of SPREAD_STEP minutes
// (0 = all at once, up to MAX_SPREAD). The first report goes at once, the others one by one
// at a regular interval; the total stays the number of reports.
const MAX_BATCH = 3
const SPREAD_STEP = 15
const MAX_SPREAD = 1440
app.post('/api/reports', requireUser, async (req, res) => {
  const body = req.body || {}
  const { target: rawTarget, description = '', lang, captureId, spreadMinutes: rawSpread = 0 } = body

  let rawItems = body.items
  if (!Array.isArray(rawItems)) {
    const legacy = Number(body.count ?? 1)
    if (!Number.isInteger(legacy) || legacy < 1 || legacy > MAX_BATCH) return res.status(400).json({ error: 'invalid_count' })
    rawItems = Array.from({ length: legacy }, (_, i) => (i === 0 ? { proofUrl: body.proofUrl, files: body.files } : {}))
  }
  const count = rawItems.length
  if (count < 1 || count > MAX_BATCH) return res.status(400).json({ error: 'invalid_count' })
  const spreadMinutes = Number(rawSpread)
  if (!Number.isInteger(spreadMinutes) || spreadMinutes < 0 || spreadMinutes > MAX_SPREAD || spreadMinutes % SPREAD_STEP) return res.status(400).json({ error: 'invalid_spread' })
  // A single report has nothing to spread
  const later = count > 1 && spreadMinutes > 0 ? count - 1 : 0
  const immediate = count - later
  const intervalMs = later ? (spreadMinutes * 60_000) / count : 0

  const target = parseTarget(rawTarget)
  if (!target) return res.status(400).json({ error: 'invalid_target' })
  if (await isWhitelisted(target)) return res.status(403).json({ error: 'protected_account' })

  // Proofs of each report: links and media checked, none shared between two reports,
  // within the media limits set by the super admin
  const settings = await getSettings()
  const decoded = decodeItems(rawItems, { maxFiles: settings.maxMediaPerReport, maxTotalBytes: settings.maxSendMb * 1024 * 1024 })
  if (decoded.error) return res.status(decoded.error === 'duplicate_proof' ? 409 : 400).json({ error: decoded.error })
  const items = decoded.items

  const cleanDescription = String(description).trim().slice(0, 2000)
  // Le compte signalé est identifié par son @username s'il en a un, sinon par son ID Telegram numérique
  const where = whereTarget(target)
  // Ce compte a-t-il déjà été signalé au moins une fois ? (on ne récupère que l'id, rien d'autre)
  const existing = await prisma.target.findUnique({ where, select: { id: true } })

  // Report with proof: the capture taken for it (POST /api/captures) must be finished,
  // of this account and recent. Its content counts once per account, like a proof link.
  let proof = null
  if (captureId !== undefined && captureId !== null) {
    proof = Number.isInteger(Number(captureId)) && await prisma.capture.findUnique({
      where: { id: Number(captureId) }, select: { id: true, targetId: true, status: true, detectedType: true, contentHash: true, finishedAt: true },
    })
    if (!proof || proof.targetId !== existing?.id || proof.status !== 'done' || !proof.contentHash) return res.status(400).json({ error: 'invalid_capture' })
    if (proof.finishedAt < new Date(Date.now() - PROOF_VALID_MS)) return res.status(400).json({ error: 'capture_expired' })
  }

  // The capture is the first report's proof, in place of a link
  if (proof) {
    if (items[0].urlHash) return res.status(400).json({ error: 'invalid_proof' })
    items[0] = { ...items[0], urlHash: `cap:${proof.contentHash}` }
  }
  // Batch: at least a third of the reports (rounded up) carry their own proof
  const withProof = items.filter(hasProof).length
  if (withProof < minWithProof(count)) return res.status(400).json({ error: 'proof_required', needed: minWithProof(count) })
  const noProof = count - withProof

  const ipHash = hashIp(req.ip)
  // The type comes from the capture of the account: the proof's at once, otherwise filled in
  // once the background capture is done. Until then: what the description says, if a client sent one, otherwise "other".
  const detected = proof ? { type: proof.detectedType || 'other' } : detectType(cleanDescription, items[0].proofUrl || '')
  const finalType = detected.type

  // Cas 1 : signalement SANS preuve (ni lien, ni capture d'écran).
  // Le nombre de signalements sans preuve autorisés par utilisateur et par compte est fixé
  // par le super admin (maxReportsNoProof, 0 = illimité). Dans un lot, seuls les signalements
  // sans preuve (noProof) comptent, y compris sur un compte encore jamais signalé.
  // Le super admin n'a aucune limite ni aucun coût.
  if (req.user.role !== 'superadmin' && noProof > 0 && settings.maxReportsNoProof > 0) {
    // On ne compte que les signalements sans preuve de cet utilisateur pour ce compte,
    // y compris ceux d'un lot étalé qui attendent encore leur heure
    const sent = existing
      ? await prisma.report.count({ where: { targetId: existing.id, userId: req.user.id, proofHash: null, evidence: { none: {} } } })
        + await prisma.scheduledReport.count({ where: { targetId: existing.id, userId: req.user.id, sentAt: null, proofHash: null, evidence: { none: {} } } })
      : 0
    // Limite atteinte : refus avec 409 (Conflict)
    if (sent >= settings.maxReportsNoProof) return res.status(409).json({ error: 'already_reported' })
    // Il reste de la place, mais pas pour tous les signalements sans preuve du lot
    if (sent + noProof > settings.maxReportsNoProof) {
      return res.status(409).json({ error: 'report_limit', remaining: settings.maxReportsNoProof - sent })
    }
  }

  // Les contrôles de preuve déjà vue ne servent que si le compte est déjà connu :
  // pour un compte nouveau, aucun signalement antérieur ne peut entrer en conflit
  if (existing) {
    // Cas 2 : signalements AVEC preuve. On les accepte même si la personne a déjà signalé,
    // à condition que chaque preuve soit nouvelle pour ce compte.
    // seenUrl : un de ces liens ou captures (comparés via leur empreinte) a-t-il déjà été envoyé
    // pour ce compte, ou est-il réservé par un signalement étalé qui attend son heure ?
    const hashes = items.map((it) => it.urlHash).filter(Boolean)
    const seenUrl = hashes.length > 0 && (
      await prisma.report.findFirst({ where: { targetId: existing.id, proofHash: { in: hashes } }, select: { id: true } })
      || await prisma.scheduledReport.findFirst({ where: { targetId: existing.id, sentAt: null, proofHash: { in: hashes } }, select: { id: true } })
    )
    // seenFile : un des médias envoyés (comparés par leur empreinte SHA-256, donc au contenu exact)
    // existe-t-il déjà pour ce compte ? Les médias réservés par un signalement étalé comptent aussi.
    const shas = items.flatMap((it) => it.files.map((f) => f.sha256))
    const seenFile = shas.length > 0 && await prisma.evidence.findFirst({
      where: { targetId: existing.id, sha256: { in: shas } },
      select: { id: true },
    })
    // Une seule preuve déjà vue suffit à refuser tout l'envoi
    if (seenUrl || seenFile) return res.status(409).json({ error: 'duplicate_proof' })
  }

  // Coût du signalement : jetons × prix du jeton, payé en crypto au cours du moment.
  // Le super admin signale sans payer.
  const tokens = req.user.role === 'superadmin' ? 0 : settings.reportCostTokens * count
  const usdCost = round2(tokens * settings.tokenPriceUsd)
  let payments = []
  if (usdCost > 0) {
    const holdings = await getHoldings(prisma, req.user.id)
    const prices = await getCachedUsdPrices(holdings.map((h) => h.currency))
    payments = allocateUsd(holdings, prices, usdCost) // 402 insufficient_tokens si le solde ne suffit pas
  }

  let saved
  try {
    saved = await prisma.$transaction(async (tx) => {
      // Débit d'abord : si le solde a baissé entre-temps, rien n'est enregistré
      for (const p of payments) await debit(tx, req.user.id, p.currency, p.amount)

      const t = await tx.target.upsert({
        where,
        update: { reportCount: { increment: immediate } },
        create: { ...target, reportCount: immediate },
      })
      // Each report with its own proof; the capture belongs to the first one only
      const reports = []
      for (let i = 0; i < immediate; i++) {
        const item = items[i]
        reports.push(await tx.report.create({
          data: {
            targetId: t.id,
            userId: req.user.id,
            type: finalType,
            detectedType: detected.type,
            description: cleanDescription,
            proofUrl: item.proofUrl,
            proofHash: item.urlHash,
            captureId: i === 0 ? proof?.id ?? null : null,
            captured: !!proof,
            lang: lang === 'fr' ? 'fr' : 'en',
            ipHash,
            evidence: { create: item.files.map((f) => ({ ...f, targetId: t.id })) },
          },
        }))
      }
      // The rest of a spread batch: one every intervalMs, sent by scheduled.js. Their proofs
      // are saved now, so no other report can take them before they go.
      const start = Date.now()
      for (let i = 1; i <= later; i++) {
        const item = items[immediate + i - 1]
        await tx.scheduledReport.create({
          data: {
            targetId: t.id, userId: req.user.id, type: finalType, detectedType: detected.type,
            description: cleanDescription, lang: lang === 'fr' ? 'fr' : 'en', ipHash,
            proofUrl: item.proofUrl, proofHash: item.urlHash,
            evidence: { create: item.files.map((f) => ({ ...f, targetId: t.id })) },
            dueAt: new Date(start + i * intervalMs),
          },
        })
      }
      // One payment for the whole batch, linked to its first report
      if (payments.length) {
        const name = target.username ? '@' + target.username : target.tgId
        await tx.transaction.create({
          data: {
            userId: req.user.id, type: 'report', usd: usdCost, tokens, payments,
            reportId: reports[0].id, note: count > 1 ? `${count} reports on ${name}` : `Report on ${name}`,
          },
        })
      }
      return t
    }, { maxWait: 5_000, timeout: 150_000 }) // debits and reports can take a while on a busy database
  } catch (err) {
    // Same evidence sent twice at the same moment: the unique index refuses the second one
    if (err.code === 'P2002') return res.status(409).json({ error: 'duplicate_proof' })
    // Transaction too slow or not started in time: nothing was saved nor debited
    if (err.code === 'P2028') return res.status(503).json({ error: 'try_again' })
    throw err
  }

  // Payment and reports are saved: a capture that fails to start must not look like a failed send,
  // or the user would pay again by retrying. The type stays as it is until a later capture.
  let typed = !!proof
  let captureQueued = !proof && captureEnabled()
  if (!proof) {
    try {
      typed = await requestCapture(saved.id)
    } catch (err) {
      captureQueued = false
      console.error(`[capture] request failed for target ${saved.id}:`, err.message)
    }
  }
  res.status(201).json({
    ok: true, targetId: saved.id, reportCount: saved.reportCount, tokensSpent: tokens, count,
    scheduled: later, intervalMinutes: Math.round(intervalMs / 6_000) / 10,
    type: finalType, withProof: !!proof, proofs: withProof,
    capturing: !typed && captureQueued,
  })
})

// Public list: rejected and whitelisted accounts are hidden, confirmed ones come first
app.get('/api/targets', async (req, res) => {
  const q = String(req.query.q || '').trim().replace(/^@/, '').toLowerCase()
  const search = q ? { OR: [{ username: { contains: q } }, { tgId: q }] } : {}
  const targets = await prisma.target.findMany({
    where: { ...search, ...(await notWhitelisted()), status: { not: 'rejected' }, reportCount: { gt: 0 } },
    // 'confirmed' sorts before 'pending' alphabetically
    orderBy: [{ status: 'asc' }, { reportCount: 'desc' }],
    take: 50,
    select: { id: true, username: true, tgId: true, kind: true, status: true, reportCount: true, createdAt: true },
  })
  res.json(targets)
})

app.get('/api/targets/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' })

  const target = await prisma.target.findUnique({ where: { id } })
  if (!target || !target.reportCount || target.status === 'rejected' || await isWhitelisted(target)) return res.status(404).json({ error: 'not_found' })

  const byType = await prisma.report.groupBy({ by: ['type'], where: { targetId: id }, _count: true })
  const recent = await prisma.report.findMany({
    where: { targetId: id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, type: true, description: true, proofUrl: true, createdAt: true, _count: { select: { evidence: true } } },
  })

  res.json({
    ...target,
    byType: Object.fromEntries(byType.map((r) => [r.type, r._count])),
    recent: recent.map(({ _count, ...r }) => ({ ...r, screenshots: _count.evidence })),
  })
})

app.get('/api/stats', async (_req, res) => {
  // Accounts only captured for a proof that was never sent are not counted
  const [targets, reports] = await Promise.all([prisma.target.count({ where: { reportCount: { gt: 0 } } }), prisma.report.count()])
  res.json({ targets, reports })
})

// --- Super admin: check the evidence, confirm or reject an account ---------

app.use('/api/admin/wallet', adminWalletRouter())
app.use('/api/admin', requireSuper)
// Waiting reports get their capture as soon as the account is connected
app.use('/api/admin/telegram', adminTelegramRouter(() => resumeCaptures().catch((err) => console.error('[capture] resume failed:', err.message))))

app.get('/api/admin/targets', async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : undefined
  const q = String(req.query.q || '').trim().replace(/^@/, '').toLowerCase()
  const targets = await prisma.target.findMany({
    where: { status, reportCount: { gt: 0 }, ...(q ? { OR: [{ username: { contains: q } }, { tgId: q }] } : {}) },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: { id: true, username: true, tgId: true, kind: true, status: true, reportCount: true, updatedAt: true },
  })
  res.json(targets)
})

app.get('/api/admin/targets/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' })

  const target = await prisma.target.findUnique({ where: { id } })
  if (!target) return res.status(404).json({ error: 'not_found' })

  const reports = await prisma.report.findMany({
    where: { targetId: id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, type: true, detectedType: true, captured: true, captureId: true, description: true, proofUrl: true, lang: true, createdAt: true,
      user: { select: { username: true } },
      evidence: { select: { id: true, mime: true, size: true } },
    },
  })
  const capture = await prisma.capture.findFirst({
    where: { targetId: id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, status: true, error: true, kind: true, title: true, about: true, texts: true, messages: true, routes: true, detectedType: true, createdAt: true, finishedAt: true, photo: true,
      media: { select: { id: true, position: true }, orderBy: { position: 'asc' } },
    },
  })
  res.json({
    ...target, whitelisted: await isWhitelisted(target), reports,
    capture: capture && { ...capture, photo: undefined, hasPhoto: !!capture.photo },
    capturing: capture?.status === 'pending', captureEnabled: captureEnabled(),
  })
})

app.get('/api/admin/captures/:id/photo', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' })
  const c = await prisma.capture.findUnique({ where: { id }, select: { photo: true } })
  if (!c?.photo) return res.status(404).json({ error: 'not_found' })
  res.set({ 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' })
  res.send(Buffer.from(c.photo))
})

app.post('/api/admin/targets/:id/capture', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' })
  if (!(await prisma.target.findUnique({ where: { id }, select: { id: true } }))) return res.status(404).json({ error: 'not_found' })
  if (!(await recapture(id))) return res.status(503).json({ error: 'capture_not_configured' })
  res.json({ ok: true })
})

app.get('/api/admin/evidence/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' })

  const file = await prisma.evidence.findUnique({ where: { id }, select: { mime: true, data: true } })
  if (!file) return res.status(404).json({ error: 'not_found' })

  res.set({ 'Content-Type': file.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' })
  res.send(Buffer.from(file.data))
})

app.post('/api/admin/targets/:id/status', async (req, res) => {
  const id = Number(req.params.id)
  const { status } = req.body || {}
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' })
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'invalid_status' })

  const exists = await prisma.target.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return res.status(404).json({ error: 'not_found' })

  const updated = await prisma.target.update({ where: { id }, data: { status } })
  res.json({ ok: true, id: updated.id, status: updated.status })
})

// Settings shown and changed in the super admin space
const adminSettings = async () => {
  const { maxReportsNoProof, maxMediaPerReport, maxSendMb, tokenPriceUsd, reportCostTokens, depositExpiryHours } = await getSettings()
  return { maxReportsNoProof, maxMediaPerReport, maxSendMb, tokenPriceUsd, reportCostTokens, depositExpiryHours }
}

app.get('/api/admin/settings', async (_req, res) => res.json(await adminSettings()))

app.put('/api/admin/settings', async (req, res) => {
  const b = req.body || {}
  const data = {}
  const int = (v, min, max) => Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max
  if (b.maxReportsNoProof !== undefined) {
    if (!int(b.maxReportsNoProof, 0, MAX_REPORTS_LIMIT)) return res.status(400).json({ error: 'invalid_setting' })
    data.maxReportsNoProof = Number(b.maxReportsNoProof)
  }
  // Media limits: never above what the server accepts (proof.js)
  if (b.maxMediaPerReport !== undefined) {
    if (!int(b.maxMediaPerReport, 1, MAX_FILES_LIMIT)) return res.status(400).json({ error: 'invalid_setting' })
    data.maxMediaPerReport = Number(b.maxMediaPerReport)
  }
  if (b.maxSendMb !== undefined) {
    if (!int(b.maxSendMb, 1, MAX_TOTAL_BYTES / 1024 / 1024)) return res.status(400).json({ error: 'invalid_setting' })
    data.maxSendMb = Number(b.maxSendMb)
  }
  if (b.reportCostTokens !== undefined) {
    if (!int(b.reportCostTokens, 0, 10000)) return res.status(400).json({ error: 'invalid_setting' })
    data.reportCostTokens = Number(b.reportCostTokens)
  }
  if (b.depositExpiryHours !== undefined) {
    if (!int(b.depositExpiryHours, 1, 168)) return res.status(400).json({ error: 'invalid_setting' })
    data.depositExpiryHours = Number(b.depositExpiryHours)
  }
  if (b.tokenPriceUsd !== undefined) {
    const p = Number(b.tokenPriceUsd)
    if (!(p >= 0.01 && p <= 10000)) return res.status(400).json({ error: 'invalid_setting' })
    data.tokenPriceUsd = round2(p)
  }
  await saveSettings(data)
  res.json(await adminSettings())
})

// Liste blanche : comptes et bots que les utilisateurs ne peuvent pas signaler
app.get('/api/admin/whitelist', async (_req, res) => {
  res.json(await prisma.whitelistEntry.findMany({ orderBy: { id: 'desc' } }))
})

app.post('/api/admin/whitelist', async (req, res) => {
  const target = parseTarget(req.body?.target)
  if (!target) return res.status(400).json({ error: 'invalid_target' })
  if (await isWhitelisted(target)) return res.status(409).json({ error: 'already_whitelisted' })
  const entry = await prisma.whitelistEntry.create({
    data: { username: target.username, tgId: target.tgId, note: String(req.body?.note || '').trim().slice(0, 200) },
  })
  res.status(201).json(entry)
})

app.delete('/api/admin/whitelist/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' })
  await prisma.whitelistEntry.deleteMany({ where: { id } })
  res.json({ ok: true })
})

// Serves the built frontend when present (production)
const dist = path.resolve(here, '../../frontend/dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'file_too_large' })
  // Errors raised on purpose (insufficient_tokens, wallet_not_configured...) carry their own status
  if (typeof err.code === 'string' && Number.isInteger(err.status) && /^[a-z_]+$/.test(err.code)) {
    return res.status(err.status).json({ error: err.code })
  }
  console.error(err)
  res.status(500).json({ error: 'server_error' })
})

const port = process.env.PORT || 4100
bootstrapSuperadmin()
  .catch((err) => console.error('[auth] super admin not created:', err.message))
  .finally(() => {
    startWalletJobs()
    startScheduledReports((targetId) => requestCapture(targetId).catch(() => {}))
    loadTelegram()
      .then(resumeCaptures)
      .catch((err) => console.error('[capture] resume failed:', err.message))
    app.listen(port, () => console.log(`scamwatch api on :${port}`))
  })
