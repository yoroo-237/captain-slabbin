import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../middlewares/auth.js';
import { notifyNewMessage } from '../services/telegram.service.js';
import { ok } from '../utils/response.js';
import { appError } from '../utils/formatters.js';

// Customer side of the internal messaging: one thread per customer with the shop.
const r = Router();
r.use(requireAuth);

const MAX_LEN = 2000;
const SELECT = { id: true, body: true, isStaff: true, readAt: true, createdAt: true };

r.get('/', async (req, res) => {
  const messages = await prisma.message.findMany({
    where: { userId: req.user.sub }, orderBy: { createdAt: 'asc' }, take: 500, select: SELECT,
  });
  // Opening the thread reads the staff replies
  await prisma.message.updateMany({ where: { userId: req.user.sub, isStaff: true, readAt: null }, data: { readAt: new Date() } });
  res.json(ok({ messages }));
});

r.get('/unread', async (req, res) => {
  const count = await prisma.message.count({ where: { userId: req.user.sub, isStaff: true, readAt: null } });
  res.json(ok({ count }));
});

r.post('/', async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) throw appError('Message is empty', 400);
  if (body.length > MAX_LEN) throw appError(`Message is too long (${MAX_LEN} characters max)`, 400);

  const message = await prisma.message.create({
    data: { userId: req.user.sub, senderId: req.user.sub, isStaff: false, body }, select: SELECT,
  });
  const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { id: true, username: true, telegramHandle: true } });
  notifyNewMessage(user, body).catch(() => {});
  res.status(201).json(ok({ message }));
});

export default r;
