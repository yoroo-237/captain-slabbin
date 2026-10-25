import crypto from 'crypto';
import { Router } from 'express';
import { getSitePassword, signGateToken } from '../middlewares/gate.js';
import { ok, fail } from '../utils/response.js';
import { prisma } from '../db.js';

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

// The gate is a 21+ and bot check more than a secret: by default the visitor is
// told which word to type. Admin → Settings can hide it to make it a real password.
r.get('/', async (req, res) => {
  const password = await getSitePassword();
  const shown = await prisma.siteSetting.findUnique({ where: { key: 'gate_show_password' } });
  res.json(ok({ enabled: !!password, word: password && shown?.value !== 'false' ? password.trim().toUpperCase() : null }));
});

r.post('/', gateLimiter, async (req, res) => {
  const { password, ageConfirmed } = req.body || {};
  const expected = await getSitePassword();
  if (!expected) return res.json(ok({ token: signGateToken() }));
  if (!ageConfirmed) return res.status(400).json(fail('Please confirm you are 21 or older.'));
  if (!password || !sameText(password, expected)) return res.status(401).json(fail('Incorrect password.'));
  res.json(ok({ token: signGateToken() }));
});

export default r;
