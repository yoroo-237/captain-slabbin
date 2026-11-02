// Telegram account of the captures, connected by the super admin from Admin → Settings:
// API ID and hash (my.telegram.org), phone number, code received in Telegram, and the
// two-step password if there is one. The session is kept in the database, encrypted
// with a key derived from JWT_SECRET (a new JWT_SECRET means connecting again).

import crypto from 'node:crypto'
import path from 'node:path'
import express from 'express'
import { prisma } from './db.js'
import { runPython, captureDir } from './python.js'

const CONNECT = process.env.CONNECT_SCRIPT || path.join(captureDir, 'connect.py')
const LOGIN_TTL_MS = 10 * 60_000

const key = () => crypto.createHash('sha256').update(`scamwatch-telegram:${process.env.JWT_SECRET || ''}`).digest()
const encrypt = (text) => {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
}
const decrypt = (stored) => {
  const [iv, tag, data] = stored.split('.').map((s) => Buffer.from(s, 'base64'))
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(data), d.final()]).toString('utf8')
}

// Kept in memory: the captures read it for each run
let creds = null
export const telegramCreds = () => creds

export async function loadTelegram() {
  const s = await prisma.setting.findUnique({ where: { id: 1 } })
  creds = null
  if (!s?.tgSession || !s.tgApiId || !s.tgApiHash) return
  try {
    creds = { apiId: s.tgApiId, apiHash: s.tgApiHash, session: decrypt(s.tgSession) }
  } catch {
    console.warn('[telegram] session unreadable (JWT_SECRET changed?): connect the account again in Admin → Settings')
  }
}

const save = async (apiId, apiHash, session, account) => {
  const data = { tgApiId: apiId, tgApiHash: apiHash, tgSession: encrypt(session), tgAccount: account, tgConnectedAt: new Date() }
  await prisma.setting.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } })
  creds = { apiId, apiHash, session }
}

const accountName = (r) => [r.name, r.username && `@${r.username}`].filter(Boolean).join(' ') || r.phone || 'Telegram'

// onConnected: called once a session is saved (captures waiting can start)
export function adminTelegramRouter(onConnected = () => {}) {
  const r = express.Router()
  const logins = new Map() // super admin id -> login in progress

  r.get('/', async (_req, res) => {
    const s = await prisma.setting.findUnique({ where: { id: 1 } })
    res.json({ connected: !!creds, account: creds ? s?.tgAccount : null, apiId: s?.tgApiId ?? null, connectedAt: creds ? s?.tgConnectedAt : null, unreadable: !!s?.tgSession && !creds })
  })

  // Step 1: Telegram sends a code to the account
  r.post('/code', async (req, res) => {
    const apiId = Number(req.body?.apiId)
    const apiHash = String(req.body?.apiHash || '').trim()
    const phone = String(req.body?.phone || '').replace(/[\s.()-]/g, '')
    if (!Number.isInteger(apiId) || apiId <= 0 || !/^[a-f0-9]{32}$/i.test(apiHash)) return res.status(400).json({ error: 'invalid_api' })
    if (!/^\+?\d{6,15}$/.test(phone)) return res.status(400).json({ error: 'invalid_phone' })
    const out = await runPython(CONNECT, [], { input: { step: 'send_code', api_id: apiId, api_hash: apiHash, phone } })
    if (out.error) return res.status(400).json({ error: `tg_${out.error}` })
    logins.set(req.user.id, { apiId, apiHash, phone, session: out.session, phoneCodeHash: out.phone_code_hash, expires: Date.now() + LOGIN_TTL_MS })
    res.json({ ok: true })
  })

  const pending = (req, res) => {
    const l = logins.get(req.user.id)
    if (!l || l.expires < Date.now()) { logins.delete(req.user.id); res.status(400).json({ error: 'login_expired' }); return null }
    return l
  }
  const finish = async (req, res, l, out) => {
    if (out.error) return res.status(400).json({ error: `tg_${out.error}` })
    if (out.need_password) { l.session = out.session; return res.json({ needPassword: true }) }
    logins.delete(req.user.id)
    await save(l.apiId, l.apiHash, out.session, accountName(out))
    onConnected()
    res.json({ ok: true, account: accountName(out) })
  }

  // Step 2: the code received in Telegram
  r.post('/verify', async (req, res) => {
    const l = pending(req, res)
    if (!l) return
    const code = String(req.body?.code || '').replace(/\D/g, '')
    if (!code) return res.status(400).json({ error: 'tg_code_invalid' })
    const out = await runPython(CONNECT, [], {
      input: { step: 'sign_in', api_id: l.apiId, api_hash: l.apiHash, session: l.session, phone: l.phone, code, phone_code_hash: l.phoneCodeHash },
    })
    await finish(req, res, l, out)
  })

  // Step 3, only with two-step verification: the account's password
  r.post('/password', async (req, res) => {
    const l = pending(req, res)
    if (!l) return
    const password = String(req.body?.password || '')
    if (!password) return res.status(400).json({ error: 'tg_password_invalid' })
    const out = await runPython(CONNECT, [], { input: { step: 'password', api_id: l.apiId, api_hash: l.apiHash, session: l.session, password } })
    await finish(req, res, l, out)
  })

  // Signs the session out on Telegram too (best effort), then forgets it
  r.delete('/', async (_req, res) => {
    if (creds) await runPython(CONNECT, [], { input: { step: 'log_out', api_id: creds.apiId, api_hash: creds.apiHash, session: creds.session }, timeoutMs: 30_000 })
    await prisma.setting.updateMany({ where: { id: 1 }, data: { tgSession: null, tgAccount: null, tgConnectedAt: null } })
    creds = null
    res.json({ ok: true })
  })

  return r
}
