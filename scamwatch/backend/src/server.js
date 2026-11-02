import 'dotenv/config'
import 'express-async-errors'
import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { PrismaClient } from '@prisma/client'
import { detectType, TYPES } from './detect.js'
import { parseTarget } from './target.js'
import { decodeFiles, proofUrlHash, sha256 } from './proof.js'

const prisma = new PrismaClient()
const app = express()
const here = path.dirname(fileURLToPath(import.meta.url))
const SALT = process.env.IP_SALT || 'scamwatch'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
const STATUSES = ['pending', 'confirmed', 'rejected']

app.set('trust proxy', 1)
app.use(cors())

// Reports carry screenshots (base64), every other route stays small
const smallJson = express.json({ limit: '100kb' })
const reportJson = express.json({ limit: '13mb' })
app.use((req, res, next) => (req.path === '/api/reports' ? reportJson : smallJson)(req, res, next))

const hashIp = (ip) => crypto.createHash('sha256').update(`${SALT}:${ip}`).digest('hex')

// Used until the admin saves the settings once
const DEFAULT_SETTINGS = { maxReportsNoProof: 1 }
const MAX_REPORTS_LIMIT = 1000
const getSettings = async () =>
  (await prisma.setting.findUnique({ where: { id: 1 }, select: { maxReportsNoProof: true } })) || DEFAULT_SETTINGS

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// Live preview of the detected type while the user types
app.post('/api/detect', (req, res) => {
  const { description = '', proofUrl = '' } = req.body || {}
  res.json(detectType(description, proofUrl))
})

// An account can be reported again and again, as long as each report brings
// evidence (link or screenshot) never sent for this account. Without evidence,
// a limited number of reports per person and account (set in the moderation space).
app.post('/api/reports', async (req, res) => {
  const { target: rawTarget, description = '', proofUrl, type, lang, files } = req.body || {}

  const target = parseTarget(rawTarget)
  if (!target) return res.status(400).json({ error: 'invalid_target' })

  const decoded = decodeFiles(files)
  if (decoded.error) return res.status(400).json({ error: decoded.error })

  const cleanDescription = String(description).trim().slice(0, 2000)
  const cleanProof = proofUrl ? String(proofUrl).trim().slice(0, 500) : null
  if (cleanProof && !/^https?:\/\//i.test(cleanProof)) return res.status(400).json({ error: 'invalid_proof' })
  const urlHash = proofUrlHash(cleanProof)
  const ipHash = hashIp(req.ip)
  const detected = detectType(cleanDescription, cleanProof || '')
  const finalType = TYPES.includes(type) ? type : detected.type

  // Le compte signalé est identifié par son @username s'il en a un, sinon par son ID Telegram numérique
  const where = target.username ? { username: target.username } : { tgId: target.tgId }
  // Ce compte a-t-il déjà été signalé au moins une fois ? (on ne récupère que l'id, rien d'autre)
  const existing = await prisma.target.findUnique({ where, select: { id: true } })

  // Les contrôles anti-doublon ne servent que si le compte est déjà connu :
  // pour un compte nouveau, aucun signalement antérieur ne peut entrer en conflit
  if (existing) {
    // Cas 1 : signalement SANS preuve (ni lien, ni capture d'écran).
    // Le nombre de signalements sans preuve autorisés par personne et par compte est fixé
    // par l'admin (maxReportsNoProof, 0 = illimité).
    // La "personne" est reconnue par ipHash : l'IP hachée avec un sel (on ne stocke jamais l'IP en clair).
    if (!urlHash && decoded.files.length === 0) {
      const { maxReportsNoProof } = await getSettings()
      if (maxReportsNoProof > 0) {
        // On ne compte que les signalements sans preuve de cette IP pour ce compte
        const sent = await prisma.report.count({
          where: { targetId: existing.id, ipHash, proofHash: null, evidence: { none: {} } },
        })
        // Limite atteinte : refus avec 409 (Conflict)
        if (sent >= maxReportsNoProof) return res.status(409).json({ error: 'already_reported' })
      }
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

  let saved
  try {
    saved = await prisma.$transaction(async (tx) => {
      const t = await tx.target.upsert({
        where,
        update: { reportCount: { increment: 1 } },
        create: { ...target, reportCount: 1 },
      })
      await tx.report.create({
        data: {
          targetId: t.id,
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
      return t
    })
  } catch (err) {
    // Same evidence sent twice at the same moment: the unique index refuses the second one
    if (err.code === 'P2002') return res.status(409).json({ error: 'duplicate_proof' })
    throw err
  }

  res.status(201).json({ ok: true, targetId: saved.id, type: finalType, reportCount: saved.reportCount })
})

// Public list: rejected accounts are hidden, confirmed ones come first
app.get('/api/targets', async (req, res) => {
  const q = String(req.query.q || '').trim().replace(/^@/, '').toLowerCase()
  const search = q ? { OR: [{ username: { contains: q } }, { tgId: q }] } : {}
  const targets = await prisma.target.findMany({
    where: { ...search, status: { not: 'rejected' } },
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
  if (!target || target.status === 'rejected') return res.status(404).json({ error: 'not_found' })

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

// --- Admin: check the evidence, confirm or reject an account ---------------

// Wrong passwords per IP: 10 tries, then blocked 15 minutes
const failures = new Map()
const BLOCK_MS = 15 * 60 * 1000

app.use('/api/admin', (req, res, next) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'admin_disabled' })

  const key = hashIp(req.ip)
  const now = Date.now()
  const f = failures.get(key)
  if (f && f.until > now && f.count >= 10) return res.status(429).json({ error: 'too_many_attempts' })

  const given = (req.get('authorization') || '').replace(/^Bearer /, '')
  const ok = crypto.timingSafeEqual(Buffer.from(sha256(given), 'hex'), Buffer.from(sha256(ADMIN_PASSWORD), 'hex'))
  if (!ok) {
    failures.set(key, { count: f && f.until > now ? f.count + 1 : 1, until: now + BLOCK_MS })
    return res.status(401).json({ error: 'unauthorized' })
  }
  failures.delete(key)
  next()
})

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
      evidence: { select: { id: true, mime: true, size: true } },
    },
  })
  res.json({ ...target, reports })
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

app.get('/api/admin/settings', async (_req, res) => res.json(await getSettings()))

app.put('/api/admin/settings', async (req, res) => {
  const max = Number((req.body || {}).maxReportsNoProof)
  if (!Number.isInteger(max) || max < 0 || max > MAX_REPORTS_LIMIT) return res.status(400).json({ error: 'invalid_setting' })

  const saved = await prisma.setting.upsert({
    where: { id: 1 },
    update: { maxReportsNoProof: max },
    create: { id: 1, maxReportsNoProof: max },
    select: { maxReportsNoProof: true },
  })
  res.json(saved)
})

// Serves the built frontend when present (production)
const dist = path.resolve(here, '../../frontend/dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'file_too_large' })
  console.error(err)
  res.status(500).json({ error: 'server_error' })
})

const port = process.env.PORT || 4100
app.listen(port, () => console.log(`scamwatch api on :${port}`))
