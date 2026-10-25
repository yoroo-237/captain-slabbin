import { Router } from 'express';
import { prisma } from '../../db.js';
import { ok } from '../../utils/response.js';
import { appError } from '../../utils/formatters.js';

// Staff side of the internal messaging.
const r = Router();

// One row per customer thread, latest activity first, with unread counts
r.get('/messages', async (req, res) => {
  const latest = await prisma.message.groupBy({
    by: ['userId'], _max: { createdAt: true }, orderBy: { _max: { createdAt: 'desc' } }, take: 200,
  });
  const userIds = latest.map(l => l.userId);
  const [users, unread, lastMessages] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, telegramHandle: true } }),
    prisma.message.groupBy({ by: ['userId'], where: { userId: { in: userIds }, isStaff: false, readAt: null }, _count: { _all: true } }),
    Promise.all(userIds.map(id => prisma.message.findFirst({ where: { userId: id }, orderBy: { createdAt: 'desc' } }))),
  ]);
  const byId = Object.fromEntries(users.map(u => [u.id, u]));
  const unreadBy = Object.fromEntries(unread.map(u => [u.userId, u._count._all]));
  res.json(ok({
    threads: userIds.map((id, i) => ({
      user: byId[id],
      unread: unreadBy[id] || 0,
      last: lastMessages[i] && { body: lastMessages[i].body.slice(0, 140), isStaff: lastMessages[i].isStaff, createdAt: lastMessages[i].createdAt },
    })),
  }));
});

r.get('/messages/unread', async (req, res) => {
  res.json(ok({ count: await prisma.message.count({ where: { isStaff: false, readAt: null } }) }));
});

r.get('/messages/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, username: true, telegramHandle: true } });
  const messages = await prisma.message.findMany({
    where: { userId }, orderBy: { createdAt: 'asc' }, take: 500,
    include: { sender: { select: { username: true } } },
  });
  await prisma.message.updateMany({ where: { userId, isStaff: false, readAt: null }, data: { readAt: new Date() } });
  res.json(ok({ user, messages }));
});

r.post('/messages/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const body = String(req.body?.body || '').trim();
  if (!body) throw appError('Message is empty', 400);
  if (body.length > 2000) throw appError('Message is too long (2000 characters max)', 400);
  await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true } });
  const message = await prisma.message.create({ data: { userId, senderId: req.user.sub, isStaff: true, body } });
  await prisma.notification.create({
    data: { userId, type: 'system', title: 'New message from the shop', message: body.slice(0, 120), link: '/account/messages' },
  }).catch(() => {});
  res.status(201).json(ok({ message }));
});

// ─── Telegram invoices ────────────────────────────────────────────────────────
export default r;
