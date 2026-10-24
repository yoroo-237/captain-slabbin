import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { fail } from '../utils/response.js';

// The storefront sits behind an access password (and a 21+ confirmation).
// Passing the gate returns a signed token the client sends as X-Gate-Token on
// catalog requests. Signed-in users don't need it — they passed the gate to sign up.

const GATE_TTL = '30d';

export async function getSitePassword() {
  const row = await prisma.siteSetting.findUnique({ where: { key: 'site_password' } });
  return row?.value?.trim() || env.sitePassword;
}

export function signGateToken() {
  return jwt.sign({ gate: true }, env.jwtSecret, { expiresIn: GATE_TTL });
}

function hasValidGate(req) {
  const token = req.headers['x-gate-token'];
  if (token) {
    try { if (jwt.verify(token, env.jwtSecret).gate) return true; } catch { /* fall through */ }
  }
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try { jwt.verify(auth.slice(7), env.jwtSecret); return true; } catch { /* fall through */ }
  }
  return false;
}

export async function requireGate(req, res, next) {
  // An empty password in Admin → Settings turns the gate off
  if (!(await getSitePassword())) return next();
  if (hasValidGate(req)) return next();
  res.status(401).json({ ...fail('Enter the shop password to continue'), gate: true });
}
