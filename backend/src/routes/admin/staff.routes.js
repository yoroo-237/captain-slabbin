import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../../db.js';
import { env } from '../../config/env.js';
import { requireSuperAdmin } from '../../middlewares/auth.js';
import { ok, fail } from '../../utils/response.js';
import { appError } from '../../utils/formatters.js';

// Admin → Users (bots platform, super admin only): the owners of the platform.
// Each owner runs their own shop (own bots, catalog, customers, wallet sweeps);
// a disabled owner can no longer sign in and their bots stop answering staff.
const r = Router();
r.use((req, res, next) => (env.platform === 'bots' ? next() : res.status(404).json(fail('Bots platform only'))));
r.use(requireSuperAdmin);

const ROLES = ['admin', 'superadmin'];
const SELECT = { id: true, username: true, role: true, isActive: true, lastLoginAt: true, createdAt: true, tenantId: true };

function checkName(v) {
  const username = String(v || '').trim();
  if (username.length < 3) throw appError('Username too short (at least 3 characters).', 400);
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) throw appError('Username: letters, numbers, . _ - only.', 400);
  return username;
}
function checkPassword(v) {
  if (String(v || '').length < 8) throw appError('Password: at least 8 characters.', 400);
  return String(v);
}
const taken = async (username, id) => {
  const other = await prisma.user.findUnique({ where: { username } });
  if (other && other.id !== id) throw appError('This username is taken.', 409);
};

r.get('/', async (req, res) => {
  const staff = await prisma.user.findMany({ where: { role: { in: ROLES } }, select: SELECT, orderBy: { createdAt: 'asc' } });
  // What each owner runs: bots and customers
  const ids = staff.map(s => s.id);
  const [bots, customers] = await Promise.all([
    prisma.telegramBot.groupBy({ by: ['tenantId'], where: { tenantId: { in: [0, ...ids] } }, _count: { _all: true } }),
    prisma.user.groupBy({ by: ['tenantId'], where: { role: 'customer', tenantId: { in: [0, ...ids] } }, _count: { _all: true } }),
  ]);
  const count = (rows, t) => rows.find(x => x.tenantId === t)?._count._all || 0;
  res.json(ok({ staff: staff.map(s => {
    const t = s.role === 'superadmin' ? 0 : s.id;
    return { ...s, bots: count(bots, t), customers: count(customers, t), me: s.id === Number(req.user.sub) };
  }) }));
});

r.post('/', async (req, res) => {
  const username = checkName(req.body?.username);
  const password = checkPassword(req.body?.password);
  const role = ROLES.includes(req.body?.role) ? req.body.role : 'admin';
  await taken(username);
  const user = await prisma.user.create({ data: { username, role, passwordHash: await bcrypt.hash(password, 12) } });
  // An owner's shop is their own id; the super admins share the platform's (0)
  const saved = await prisma.user.update({ where: { id: user.id }, data: { tenantId: role === 'superadmin' ? 0 : user.id }, select: SELECT });
  res.status(201).json(ok({ user: saved }));
});

r.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || !ROLES.includes(user.role)) throw appError('Account not found.', 404);
  const me = id === Number(req.user.sub);
  const data = {};
  if (req.body?.username !== undefined) { data.username = checkName(req.body.username); await taken(data.username, id); }
  if (req.body?.password) data.passwordHash = await bcrypt.hash(checkPassword(req.body.password), 12);
  if (req.body?.isActive !== undefined) {
    if (me && !req.body.isActive) throw appError('You cannot disable your own account.', 400);
    data.isActive = !!req.body.isActive;
  }
  if (req.body?.role !== undefined) {
    if (!ROLES.includes(req.body.role)) throw appError('Invalid role.', 400);
    if (me && req.body.role !== user.role) throw appError('You cannot change your own role.', 400);
    // The shop follows the role: an owner keeps their own, a super admin has the platform's
    if (req.body.role !== user.role) { data.role = req.body.role; data.tenantId = req.body.role === 'superadmin' ? 0 : id; }
  }
  const saved = await prisma.user.update({ where: { id }, data, select: SELECT });
  res.json(ok({ user: saved }));
});

export default r;
