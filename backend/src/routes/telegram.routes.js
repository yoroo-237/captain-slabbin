import { Router } from 'express';
import { prisma } from '../db.js';
import { ok } from '../utils/response.js';

// Orders are always paid in the app; their invoice goes to Telegram from
// order.service. This only exposes the shop's public Telegram contact.
const r = Router();

r.get('/contact', async (req, res) => {
  const row = await prisma.siteSetting.findUnique({ where: { key: 'telegram_username' } });
  const username = row?.value?.replace(/^@/, '').trim() || '';
  res.json(ok({ username, url: username ? `https://t.me/${username}` : null }));
});

export default r;
