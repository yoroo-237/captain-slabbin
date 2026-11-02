// Wallet: crypto deposits credited as holdings (live USD value, tokens derived from it),
// webhooks, background checks, and the super admin's sweeps to the reserve addresses.

import crypto from 'node:crypto'
import express from 'express'
import { prisma, getSettings } from './db.js'
import { requireUser, requireSuper } from './auth.js'
import { getCachedUsdPrice, getCachedUsdPrices } from './price.js'
import { credit, getHoldings, valueHoldings, tokensFor, round2, round8 } from './balance.js'
import {
  DEPOSIT_CURRENCIES, UTXO_CURRENCIES, generateAddress, deleteHook, checkOnChain,
  sweepUtxo, sweepEth, isValidAddress, fail,
} from './crypto.js'

const OPEN = ['awaiting', 'partial']

export async function walletSummary(userId) {
  const [holdings, settings] = await Promise.all([getHoldings(prisma, userId), getSettings()])
  const prices = await getCachedUsdPrices(holdings.map((h) => h.currency))
  const valued = valueHoldings(holdings, prices)
  return {
    ...valued,
    tokens: tokensFor(valued.balance, settings.tokenPriceUsd),
    tokenPriceUsd: settings.tokenPriceUsd,
    reportCostTokens: settings.reportCostTokens,
  }
}

// Credits what the address really received. Claimed atomically: a webhook and the
// user's own check can confirm the same deposit at the same moment, only one credits.
export async function confirmDeposit(depositId, cryptoAmount, note = null) {
  const amount = round8(Number(cryptoAmount))
  if (!(amount > 0)) throw fail('invalid_amount')

  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } })
  if (!deposit) throw fail('not_found', 404)
  if (deposit.status === 'confirmed') throw fail('already_confirmed', 409)

  const price = await getCachedUsdPrice(deposit.currency)
  const usd = price ? round2(amount * price) : 0

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.deposit.updateMany({
      where: { id: depositId, status: { not: 'confirmed' } },
      data: { status: 'confirmed', confirmedAt: new Date(), amountReceived: amount, usdCredited: usd },
    })
    if (count === 0) throw fail('already_confirmed', 409)

    await credit(tx, deposit.userId, deposit.currency, amount)
    await tx.transaction.create({
      data: {
        userId: deposit.userId, type: 'deposit', currency: deposit.currency,
        cryptoAmount: amount, usd, rate: price || null, depositId,
        note: note || `${amount} ${deposit.currency} received`,
      },
    })
  })
  if (deposit.hookId) deleteHook(deposit.hookId, deposit.currency)
}

// Reads the chain for one open deposit and credits it when funds arrived
async function refreshDeposit(deposit) {
  const result = await checkOnChain(deposit)
  if (result.confirmed) {
    await confirmDeposit(deposit.id, result.cryptoAmount).catch((err) => {
      if (err.code !== 'already_confirmed') throw err
    })
  } else if (result.pending && deposit.status !== 'partial') {
    await prisma.deposit.update({ where: { id: deposit.id }, data: { status: 'partial' } })
  }
  return result
}

// Every 5 minutes: open deposits are checked on-chain (webhooks can be missed),
// expired ones are closed
export function startWalletJobs() {
  const tick = async () => {
    try {
      const now = new Date()
      const expired = await prisma.deposit.findMany({ where: { status: { in: OPEN }, expiresAt: { lt: now } } })
      for (const d of expired) {
        // A last check before closing: funds sent just before the deadline still count
        if (d.currency !== 'XMR') await refreshDeposit(d).catch(() => {})
        const still = await prisma.deposit.updateMany({ where: { id: d.id, status: { in: OPEN } }, data: { status: 'expired' } })
        if (still.count && d.hookId) deleteHook(d.hookId, d.currency)
      }
      const open = await prisma.deposit.findMany({
        where: { status: { in: OPEN }, currency: { not: 'XMR' }, expiresAt: { gte: now } },
        orderBy: { id: 'asc' }, take: 20,
      })
      for (const d of open) await refreshDeposit(d).catch((err) => console.warn(`[wallet] deposit #${d.id}:`, err.message))
    } catch (err) {
      console.error('[wallet] job failed:', err.message)
    }
  }
  setInterval(tick, 5 * 60 * 1000).unref()
  setTimeout(tick, 30 * 1000).unref()
}

const publicDeposit = (d) => ({
  id: d.id, currency: d.currency, address: d.address, status: d.status,
  amountReceived: Number(d.amountReceived), usdCredited: Number(d.usdCredited),
  expiresAt: d.expiresAt, confirmedAt: d.confirmedAt, createdAt: d.createdAt,
})

export function walletRouter() {
  const r = express.Router()
  r.use(requireUser)

  r.get('/', async (req, res) => res.json(await walletSummary(req.user.id)))

  // Live prices, so the page can show how much crypto buys a number of tokens
  r.get('/prices', async (_req, res) => res.json({ prices: await getCachedUsdPrices(DEPOSIT_CURRENCIES) }))

  r.post('/deposits', async (req, res) => {
    const currency = String(req.body?.currency || '').toUpperCase()
    if (!DEPOSIT_CURRENCIES.includes(currency)) return res.status(400).json({ error: 'unsupported_currency' })

    // One open deposit per currency: the same address is shown again
    const open = await prisma.deposit.findFirst({
      where: { userId: req.user.id, currency, status: { in: OPEN }, expiresAt: { gt: new Date() } },
      orderBy: { id: 'desc' },
    })
    if (open) return res.json(publicDeposit(open))

    const settings = await getSettings()
    const deposit = await prisma.deposit.create({
      data: { userId: req.user.id, currency, expiresAt: new Date(Date.now() + settings.depositExpiryHours * 3600 * 1000) },
    })
    try {
      const { address, hookId = null, ethIndex = null } = await generateAddress(currency, deposit.id, settings.xmrAddress)
      const saved = await prisma.deposit.update({ where: { id: deposit.id }, data: { address, hookId, ethIndex } })
      res.status(201).json(publicDeposit(saved))
    } catch (err) {
      await prisma.deposit.delete({ where: { id: deposit.id } }).catch(() => {})
      throw err
    }
  })

  r.get('/deposits', async (req, res) => {
    const deposits = await prisma.deposit.findMany({ where: { userId: req.user.id }, orderBy: { id: 'desc' }, take: 50 })
    res.json(deposits.map(publicDeposit))
  })

  r.post('/deposits/:id/check', async (req, res) => {
    const deposit = await prisma.deposit.findFirst({ where: { id: Number(req.params.id) || 0, userId: req.user.id } })
    if (!deposit) return res.status(404).json({ error: 'not_found' })
    let pending = false
    if (OPEN.includes(deposit.status) && deposit.currency !== 'XMR') pending = !!(await refreshDeposit(deposit)).pending
    const updated = await prisma.deposit.findUnique({ where: { id: deposit.id } })
    res.json({ deposit: publicDeposit(updated), pending })
  })

  r.get('/transactions', async (req, res) => {
    const rows = await prisma.transaction.findMany({ where: { userId: req.user.id }, orderBy: { id: 'desc' }, take: 50 })
    res.json(rows.map((t) => ({
      id: t.id, type: t.type, currency: t.currency, cryptoAmount: t.cryptoAmount != null ? Number(t.cryptoAmount) : null,
      usd: Number(t.usd), tokens: t.tokens, payments: t.payments, note: t.note, createdAt: t.createdAt,
    })))
  })

  return r
}

// Webhooks only say "look at this address": the amount is always read on-chain
export function webhookRouter() {
  const r = express.Router()

  r.post('/blockcypher', async (req, res) => {
    const address = req.body?.address
    res.json({ ok: true })
    if (!address) return
    const deposit = await prisma.deposit.findFirst({ where: { address, status: { in: OPEN }, currency: { in: UTXO_CURRENCIES } } })
    if (deposit) await refreshDeposit(deposit).catch((err) => console.warn('[webhook blockcypher]', err.message))
  })

  // Alchemy: signed with ALCHEMY_SIGNING_KEY (raw body), unsigned calls are refused
  r.post('/alchemy', async (req, res) => {
    const key = process.env.ALCHEMY_SIGNING_KEY?.trim()
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('')
    const sig = String(req.get('x-alchemy-signature') || '')
    const expected = key ? crypto.createHmac('sha256', key).update(raw).digest('hex') : ''
    if (!key || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(401).json({ error: 'invalid_signature' })
    }
    let body
    try { body = JSON.parse(raw.toString()) } catch { return res.status(400).json({ error: 'invalid_payload' }) }
    res.json({ ok: true })

    const addresses = new Set((body?.event?.activity || []).map((a) => a.toAddress?.toLowerCase()).filter(Boolean))
    for (const address of addresses) {
      const deposit = await prisma.deposit.findFirst({
        where: { address: { equals: address, mode: 'insensitive' }, currency: 'ETH', status: { in: OPEN } },
      })
      if (deposit) await refreshDeposit(deposit).catch((err) => console.warn('[webhook alchemy]', err.message))
    }
  })

  return r
}

// --- Super admin: deposits, reserve addresses, sweeps ------------------------

const running = new Set() // one sweep per currency at a time

export function adminWalletRouter() {
  const r = express.Router()
  r.use(requireSuper)

  r.get('/overview', async (_req, res) => {
    const [unswept, collected, users, settings] = await Promise.all([
      prisma.deposit.groupBy({ by: ['currency'], where: { status: 'confirmed', sweptAt: null }, _sum: { amountReceived: true }, _count: { _all: true } }),
      prisma.deposit.groupBy({ by: ['currency'], where: { status: 'confirmed' }, _sum: { amountReceived: true, usdCredited: true } }),
      prisma.user.count({ where: { role: 'user' } }),
      getSettings(),
    ])
    res.json({
      users,
      reserveAddresses: settings.reserveAddresses,
      xmrAddress: settings.xmrAddress,
      unswept: unswept.map((r) => ({ currency: r.currency, amount: Number(r._sum.amountReceived || 0), deposits: r._count._all })),
      collected: collected.map((r) => ({ currency: r.currency, amount: Number(r._sum.amountReceived || 0), usd: Number(r._sum.usdCredited || 0) })),
    })
  })

  r.get('/deposits', async (req, res) => {
    const status = ['awaiting', 'partial', 'confirmed', 'expired'].includes(req.query.status) ? req.query.status : undefined
    const rows = await prisma.deposit.findMany({
      where: { status }, orderBy: { id: 'desc' }, take: 100,
      include: { user: { select: { username: true } } },
    })
    res.json(rows.map((d) => ({ ...publicDeposit(d), username: d.user.username, sweptAt: d.sweptAt, sweepTx: d.sweepTx })))
  })

  // XMR (or a missed payment): the super admin enters what was received
  r.post('/deposits/:id/confirm', async (req, res) => {
    const id = Number(req.params.id)
    const amount = Number(req.body?.amount)
    if (!Number.isInteger(id) || !(amount > 0)) return res.status(400).json({ error: 'invalid_amount' })
    await confirmDeposit(id, amount, `${amount} confirmed by ${req.user.username}`)
    res.json({ ok: true })
  })

  r.put('/reserve', async (req, res) => {
    const settings = await getSettings()
    const next = { ...settings.reserveAddresses }
    for (const currency of ['BTC', 'LTC', 'DOGE', 'ETH']) {
      if (req.body?.[currency] === undefined) continue
      const value = String(req.body[currency]).trim()
      if (value && !isValidAddress(currency, value)) return res.status(400).json({ error: 'invalid_address', currency })
      next[currency] = value
    }
    const xmr = req.body?.XMR !== undefined ? String(req.body.XMR).trim() || null : settings.xmrAddress
    await prisma.setting.upsert({
      where: { id: 1 },
      update: { reserveAddresses: next, xmrAddress: xmr },
      create: { id: 1, reserveAddresses: next, xmrAddress: xmr },
    })
    res.json({ reserveAddresses: next, xmrAddress: xmr })
  })

  r.post('/sweep/:currency', async (req, res) => {
    const currency = String(req.params.currency).toUpperCase()
    if (![...UTXO_CURRENCIES, 'ETH'].includes(currency)) return res.status(400).json({ error: 'unsupported_currency' })
    const destination = (await getSettings()).reserveAddresses[currency]
    if (!destination) return res.status(400).json({ error: 'reserve_not_set' })
    if (running.has(currency)) return res.status(409).json({ error: 'sweep_running' })

    running.add(currency)
    try {
      const deposits = await prisma.deposit.findMany({ where: { currency, status: 'confirmed', sweptAt: null }, orderBy: { id: 'asc' } })
      const results = currency === 'ETH' ? await sweepEth(deposits, destination) : await sweepUtxo(currency, deposits, destination)
      const now = new Date()
      for (const x of results.filter((x) => x.status === 'swept')) {
        await prisma.deposit.update({ where: { id: x.depositId }, data: { sweptAt: now, sweepTx: x.txHash || null } })
        await prisma.sweepLog.create({
          data: { currency, amount: Number(x.amount), address: destination, txHash: x.txHash || null, depositId: x.depositId, triggeredBy: req.user.id },
        }).catch((err) => console.error('[sweep] log failed:', err.message))
      }
      const swept = results.filter((x) => x.status === 'swept')
      res.json({
        currency, swept: swept.length,
        total: swept.reduce((s, x) => s + Number(x.amount), 0).toFixed(8).replace(/\.?0+$/, '') || '0',
        results,
      })
    } finally {
      running.delete(currency)
    }
  })

  r.get('/sweeps', async (_req, res) => {
    const logs = await prisma.sweepLog.findMany({ orderBy: { id: 'desc' }, take: 100 })
    res.json(logs.map((l) => ({ ...l, amount: Number(l.amount) })))
  })

  return r
}
