import crypto from 'crypto';
import { Router } from 'express';
import { getSitePassword, signGateToken } from '../middlewares/gate.js';
import { ok, fail } from '../utils/response.js';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { env } from '../config/env.js';

const r = Router();

// Slow down password guessing on the shop gate: 30 attempts per IP per 15 minutes
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 30;
const attempts = new Map(); // ip -> { count, resetAt }

function gateLimiter(req, res, next) {
  const now = Date.now();
  const hit = attempts.get(req.ip);
  if (!hit || hit.resetAt < now) {
    attempts.set(req.ip, { count: 1, resetAt: now + WINDOW_MS });
    if (attempts.size > 10000) for (const [ip, h] of attempts) if (h.resetAt < now) attempts.delete(ip);
    return next();
  }
  if (++hit.count > MAX_ATTEMPTS) return res.status(429).json(fail('Too many attempts — try again in a few minutes.'));
  next();
}

const sameText = (a, b) => {
  const x = Buffer.from(String(a).trim().toUpperCase());
  const y = Buffer.from(String(b).trim().toUpperCase());
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// By default the gate is a 21+ and bot check: each visit gets a random code to
// type, shown on the page and carried back in a signed challenge (nothing stored).
// Unticking "random code" in Admin → Settings asks for the shop password instead.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const CODE_LENGTH = 4;
const CODE_TTL = '30m';

async function randomMode() {
  const row = await prisma.siteSetting.findUnique({ where: { key: 'gate_show_password' } });
  return row?.value !== 'false';
}

function newChallenge() {
  const code = Array.from(crypto.randomBytes(CODE_LENGTH), b => CODE_CHARS[b % CODE_CHARS.length]).join('');
  return { word: code, challenge: jwt.sign({ gateCode: code }, env.jwtSecret, { expiresIn: CODE_TTL }) };
}

r.get('/', async (req, res) => {
  if (!(await getSitePassword())) return res.json(ok({ enabled: false }));
  res.json(ok({ enabled: true, ...((await randomMode()) ? newChallenge() : { word: null }) }));
});

r.post('/', gateLimiter, async (req, res) => {
  const { password, ageConfirmed, challenge } = req.body || {};
  const expected = await getSitePassword();
  if (!expected) return res.json(ok({ token: signGateToken() }));
  if (!ageConfirmed) return res.status(400).json(fail('Please confirm you are 21 or older.'));

  if (await randomMode()) {
    let code;
    try { code = jwt.verify(String(challenge || ''), env.jwtSecret).gateCode; } catch { /* expired or forged */ }
    if (!code) return res.status(401).json({ ...fail('That code has expired, here is a new one.'), ...newChallenge(), expired: true });
    if (!password || !sameText(password, code)) return res.status(401).json(fail(`Type ${code} exactly to enter.`));
    return res.json(ok({ token: signGateToken() }));
  }

  if (!password || !sameText(password, expected)) return res.status(401).json(fail('Incorrect password.'));
  res.json(ok({ token: signGateToken() }));
});

export default r;
