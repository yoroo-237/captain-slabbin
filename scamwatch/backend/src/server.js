import 'dotenv/config'
import 'express-async-errors'
import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { prisma, getSettings, saveSettings } from './db.js'
import { detectType, TYPES } from './detect.js'
import { parseTarget } from './target.js'
import { decodeFiles, proofUrlHash } from './proof.js'
import { authRouter, requireUser, requireSuper, bootstrapSuperadmin } from './auth.js'
import { walletRouter, webhookRouter, adminWalletRouter, startWalletJobs } from './wallet.js'
import { getHoldings, allocateUsd, debit, round2 } from './balance.js'
import { getCachedUsdPrices } from './price.js'

const app = express()
const here = path.dirname(fileURLToPath(import.meta.url))
const SALT = process.env.IP_SALT || 'scamwatch'
const STATUSES = ['pending', 'confirmed', 'rejected']
const MAX_REPORTS_LIMIT = 1000

app.set('trust proxy', 1)
app.use(cors())

// Reports carry screenshots (base64), Alchemy needs the raw body for its signature,
// every other route stays small
const smallJson = express.json({ limit: '100kb' })
const reportJson = express.json({ limit: '13mb' })
const rawBody = express.raw({ type: '*/*', limit: '1mb' })
app.use((req, res, next) => {
  if (req.path === '/api/reports') return reportJson(req, res, next)
  if (req.path === '/api/webhooks/alchemy') return rawBody(req, res, next)
  return smallJson(req, res, next)
})

const hashIp = (ip) => crypto.createHash('sha256').update(`${SALT}:${ip}`).digest('hex')

// Liste blanche : un compte y figure par son @username ou par son ID numérique
const whereTarget = (t) => (t.username ? { username: t.username } : { tgId: t.tgId })
const isWhitelisted = async (t) => !!(await prisma.whitelistEntry.findFirst({ where: whereTarget(t), select: { id: true } }))

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
  res.json({ tokenPriceUsd: s.tokenPriceUsd, reportCostTokens: s.reportCostTokens })
})

// An account can be reported again and again, as long as each report brings
// evidence (link or screenshot) never sent for this account. Without evidence,
// a limited number of reports per user and account (set in the super admin space).
// Each report costs tokens, taken from the user's wallet.
app.post('/api/reports', requireUser, async (req, res) => {
  const { target: rawTarget, description = '', proofUrl, type, lang, files } = req.body || {}

  const target = parseTarget(rawTarget)
  if (!target) return res.status(400).json({ error: 'invalid_target' })
  if (await isWhitelisted(target)) return res.status(403).json({ error: 'protected_account' })

  const decoded = decodeFiles(files)
  if (decoded.error) return res.status(400).json({ error: decoded.error })

  const cleanDescription = String(description).trim().slice(0, 2000)
  const cleanProof = proofUrl ? String(proofUrl).trim().slice(0, 500) : null
  if (cleanProof && !/^https?:\/\//i.test(cleanProof)) return res.status(400).json({ error: 'invalid_proof' })
  const urlHash = proofUrlHash(cleanProof)
  const ipHash = hashIp(req.ip)
  const detected = detectType(cleanDescription, cleanProof || '')
  const finalType = TYPES.includes(type) ? type : detected.type
  const settings = await getSettings()

  // Le compte signalé est identifié par son @username s'il en a un, sinon par son ID Telegram numérique
  const where = whereTarget(target)
  // Ce compte a-t-il déjà été signalé au moins une fois ? (on ne récupère que l'id, rien d'autre)
  const existing = await prisma.target.findUnique({ where, select: { id: true } })

  // Les contrôles anti-doublon ne servent que si le compte est déjà connu :
  // pour un compte nouveau, aucun signalement antérieur ne peut entrer en conflit
  if (existing) {
    // Cas 1 : signalement SANS preuve (ni lien, ni capture d'écran).
    // Le nombre de signalements sans preuve autorisés par utilisateur et par compte est fixé
    // par le super admin (maxReportsNoProof, 0 = illimité).
    // Le super admin n'a aucune limite ni aucun coût.
    if (req.user.role !== 'superadmin' && !urlHash && decoded.files.length === 0 && settings.maxReportsNoProof > 0) {
      // On ne compte que les signalements sans preuve de cet utilisateur pour ce compte
      const sent = await prisma.report.count({
        where: { targetId: existing.id, userId: req.user.id, proofHash: null, evidence: { none: {} } },
      })
      // Limite atteinte : refus avec 409 (Conflict)
      if (sent >= settings.maxReportsNoProof) return res.status(409).json({ error: 'already_reported' })
    }

    // Cas 2 : signalement AVEC preuve. On l'accepte même si la personne a déjà signalé,
    // à condition que la preuve soit nouvelle pour ce compte.
    // seenUrl : ce même lien (comparé via son empreinte urlHash) a-t-il déjà été envoyé pour ce compte ?
    // Le "urlHash &&" court-circuite : pas de lien = pas de requête, seenUrl vaut alors null/false.
    const seenUrl = urlHash && await prisma.report.findFirst({ where: { targetId: existing.id, proofHash: urlHash }, select: { id: true } })
    // seenFile : une des captures envoyées (comparées par leur empreinte SHA-256, donc au contenu exact)
    // existe-t-elle déjà pour ce compte ? Même court-circuit si aucune capture.
    const seenFile = decoded.files.length > 0 && await prisma.evidence.findFirst({
      where: { targetId: existing.id, sha256: { in: decoded.files.map((f) => f.sha256) } },
      select: { id: true },
    })
    // Une seule preuve déjà vue suffit à refuser tout le signalement
    if (seenUrl || seenFile) return res.status(409).json({ error: 'duplicate_proof' })
  }

  // Coût du signalement : jetons × prix du jeton, payé en crypto au cours du moment.
  // Le super admin signale sans payer.
  const tokens = req.user.role === 'superadmin' ? 0 : settings.reportCostTokens
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
        update: { reportCount: { increment: 1 } },
        create: { ...target, reportCount: 1 },
      })
      const report = await tx.report.create({
        data: {
          targetId: t.id,
          userId: req.user.id,
          type: finalType,
          detectedType: detected.type,
          description: cleanDescription,
          proofUrl: cleanProof,
          proofHash: urlHash,
          lang: lang === 'fr' ? 'fr' : 'en',
          ipHash,
          evidence: { create: decoded.files.map((f) => ({ ...f, targetId: t.id })) },
        },
      })
      if (payments.length) {
        await tx.transaction.create({
          data: {
            userId: req.user.id, type: 'report', usd: usdCost, tokens, payments,
            reportId: report.id, note: `Report on ${target.username ? '@' + target.username : target.tgId}`,
          },
        })
      }
      return t
    })
  } catch (err) {
    // Same evidence sent twice at the same moment: the unique index refuses the second one
    if (err.code === 'P2002') return res.status(409).json({ error: 'duplicate_proof' })
    throw err
  }

  res.status(201).json({ ok: true, targetId: saved.id, type: finalType, reportCount: saved.reportCount, tokensSpent: tokens })
})

// Public list: rejected and whitelisted accounts are hidden, confirmed ones come first
app.get('/api/targets', async (req, res) => {
  const q = String(req.query.q || '').trim().replace(/^@/, '').toLowerCase()
  const search = q ? { OR: [{ username: { contains: q } }, { tgId: q }] } : {}
  const targets = await prisma.target.findMany({
    where: { ...search, ...(await notWhitelisted()), status: { not: 'rejected' } },
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
  if (!target || target.status === 'rejected' || await isWhitelisted(target)) return res.status(404).json({ error: 'not_found' })

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
  const [targets, reports] = await Promise.all([prisma.target.count(), prisma.report.count()])
  res.json({ targets, reports })
})

// --- Super admin: check the evidence, confirm or reject an account ---------

app.use('/api/admin/wallet', adminWalletRouter())
app.use('/api/admin', requireSuper)

app.get('/api/admin/targets', async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : undefined
  const q = String(req.query.q || '').trim().replace(/^@/, '').toLowerCase()
  const targets = await prisma.target.findMany({
    where: { status, ...(q ? { OR: [{ username: { contains: q } }, { tgId: q }] } : {}) },
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
      id: true, type: true, detectedType: true, description: true, proofUrl: true, lang: true, createdAt: true,
      user: { select: { username: true } },
      evidence: { select: { id: true, mime: true, size: true } },
    },
  })
  res.json({ ...target, whitelisted: await isWhitelisted(target), reports })
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

app.get('/api/admin/settings', async (_req, res) => {
  const { maxReportsNoProof, tokenPriceUsd, reportCostTokens, depositExpiryHours } = await getSettings()
  res.json({ maxReportsNoProof, tokenPriceUsd, reportCostTokens, depositExpiryHours })
})

app.put('/api/admin/settings', async (req, res) => {
  const b = req.body || {}
  const data = {}
  const int = (v, min, max) => Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max
  if (b.maxReportsNoProof !== undefined) {
    if (!int(b.maxReportsNoProof, 0, MAX_REPORTS_LIMIT)) return res.status(400).json({ error: 'invalid_setting' })
    data.maxReportsNoProof = Number(b.maxReportsNoProof)
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
  const { maxReportsNoProof, tokenPriceUsd, reportCostTokens, depositExpiryHours } = await getSettings()
  res.json({ maxReportsNoProof, tokenPriceUsd, reportCostTokens, depositExpiryHours })
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
    app.listen(port, () => console.log(`scamwatch api on :${port}`))
  })
