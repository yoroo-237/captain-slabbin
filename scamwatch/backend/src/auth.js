// User accounts: username + password, a signed token in the Authorization header.
// The super admin (MKO) is created once, at the first start, from SUPERADMIN_USERNAME
// and SUPERADMIN_PASSWORD (the password never lives in the code). After that the account
// is kept as it is in the database: its password is changed from the site.
// Lost password: RESET_SUPERADMIN_PASSWORD=true puts the variable's password back.

import crypto from 'node:crypto'
import { promisify } from 'node:util'
import express from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from './db.js'

const scrypt = promisify(crypto.scrypt)
const USERNAME = /^[a-z0-9_]{3,32}$/
const TOKEN_TTL = '7d'

const secret = () => {
  const s = process.env.JWT_SECRET
  if (!s || s.length < 16) throw Object.assign(new Error('JWT_SECRET missing or too short'), { status: 503, code: 'auth_not_configured' })
  return s
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const key = await scrypt(password, salt, 64)
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`
}

export async function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split(':')
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), 64)
  const expected = Buffer.from(keyHex, 'hex')
  return expected.length === key.length && crypto.timingSafeEqual(expected, key)
}

const sign = (user) => jwt.sign({ sub: user.id, role: user.role, username: user.username }, secret(), { expiresIn: TOKEN_TTL })
const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role })

// Sets req.user when a valid token is sent, refuses otherwise
export async function requireUser(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '')
  if (!token) return res.status(401).json({ error: 'login_required' })
  let payload
  try { payload = jwt.verify(token, secret()) } catch (err) {
    if (err.code === 'auth_not_configured') throw err
    return res.status(401).json({ error: 'login_required' })
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, username: true, role: true, isActive: true } })
  if (!user || !user.isActive) return res.status(401).json({ error: 'login_required' })
  req.user = user
  next()
}

export function requireSuper(req, res, next) {
  requireUser(req, res, () => (req.user.role === 'superadmin' ? next() : res.status(403).json({ error: 'forbidden' }))).catch(next)
}

export async function bootstrapSuperadmin() {
  const username = process.env.SUPERADMIN_USERNAME?.trim().toLowerCase()
  const password = process.env.SUPERADMIN_PASSWORD
  if (!username || !password) return console.warn('[auth] SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD not set: no super admin account')

  const reset = process.env.RESET_SUPERADMIN_PASSWORD === 'true'
  if (!reset && await prisma.user.findUnique({ where: { username }, select: { id: true } })) {
    return console.log(`[auth] super admin "${username}" already exists, kept as is`)
  }
  const passwordHash = await hashPassword(password)
  await prisma.user.upsert({
    where: { username },
    update: { passwordHash, role: 'superadmin', isActive: true },
    create: { username, passwordHash, role: 'superadmin' },
  })
  console.log(`[auth] super admin "${username}" ${reset ? 'password reset from the variables' : 'created'}`)
}

// Wrong passwords per IP: 10 tries, then blocked 15 minutes
const failures = new Map()
const BLOCK_MS = 15 * 60 * 1000

export function authRouter(hashIp) {
  const r = express.Router()

  r.post('/register', async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase()
    const password = String(req.body?.password || '')
    if (!USERNAME.test(username)) return res.status(400).json({ error: 'invalid_username' })
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'weak_password' })
    if (await prisma.user.findUnique({ where: { username }, select: { id: true } })) return res.status(409).json({ error: 'username_taken' })

    const user = await prisma.user.create({ data: { username, passwordHash: await hashPassword(password) } })
    res.status(201).json({ token: sign(user), user: publicUser(user) })
  })

  r.post('/login', async (req, res) => {
    const key = hashIp(req.ip)
    const now = Date.now()
    const f = failures.get(key)
    if (f && f.until > now && f.count >= 10) return res.status(429).json({ error: 'too_many_attempts' })

    const username = String(req.body?.username || '').trim().toLowerCase()
    const user = username && await prisma.user.findUnique({ where: { username } })
    const ok = user && user.isActive && await verifyPassword(String(req.body?.password || ''), user.passwordHash)
    if (!ok) {
      failures.set(key, { count: f && f.until > now ? f.count + 1 : 1, until: now + BLOCK_MS })
      return res.status(401).json({ error: 'wrong_credentials' })
    }
    failures.delete(key)
    res.json({ token: sign(user), user: publicUser(user) })
  })

  r.get('/me', requireUser, (req, res) => res.json({ user: publicUser(req.user) }))

  // Any signed-in user, the super admin included, changes their own password
  r.post('/password', requireUser, async (req, res) => {
    const current = String(req.body?.current || '')
    const next = String(req.body?.next || '')
    if (next.length < 8 || next.length > 200) return res.status(400).json({ error: 'weak_password' })
    const user = await prisma.user.findUnique({ where: { id: req.user.id } })
    if (!(await verifyPassword(current, user.passwordHash))) return res.status(401).json({ error: 'wrong_password' })
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } })
    res.json({ ok: true })
  })

  return r
}
