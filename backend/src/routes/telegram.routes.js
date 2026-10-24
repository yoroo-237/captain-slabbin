import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { requireGate } from '../middlewares/gate.js';
import { priceCart } from '../services/pricing.service.js';
import { buildInvoice, sendTelegram, formatTelegramContact } from '../services/telegram.service.js';
import { ok } from '../utils/response.js';
import { appError } from '../utils/formatters.js';

const r = Router();

// Signed-in customers are optional here: the invoice works for guests too.
function optionalUser(req) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  try { return jwt.verify(h.slice(7), env.jwtSecret); } catch { return null; }
}

// Public shop contact used by the "Send on Telegram" button
r.get('/contact', async (req, res) => {
  const row = await prisma.siteSetting.findUnique({ where: { key: 'telegram_username' } });
  const username = row?.value?.replace(/^@/, '').trim() || '';
  res.json(ok({ username, url: username ? `https://t.me/${username}` : null }));
});

// Prices the cart, posts the invoice to the shop's Telegram chat and returns
// the text so the customer can also send or copy it. When the customer is
// signed in and has a Telegram username/ID on their profile, it is included.
r.post('/invoice', requireGate, async (req, res) => {
  const { items, contact, note, telegram } = req.body || {};
  if (contact && String(contact).length > 200) throw appError('Contact is too long', 400);
  if (note && String(note).length > 500) throw appError('Note is too long (500 characters max)', 400);

  const priced = await priceCart(items);
  const auth = optionalUser(req);
  const user = auth
    ? await prisma.user.findUnique({ where: { id: auth.sub }, select: { id: true, username: true, telegramHandle: true } })
    : null;
  // A guest may type their Telegram username; a signed-in customer's profile wins
  const handle = user?.telegramHandle || (telegram ? String(telegram).slice(0, 64) : null);

  const code = 'TG-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const { text, html } = buildInvoice({
    code,
    items:       priced.lines,
    subtotal:    priced.subtotal,
    shippingFee: priced.shippingFee,
    total:       priced.total,
    customer:    user?.username,
    telegram:    formatTelegramContact(handle),
    contact:     contact?.trim(),
    note:        note?.trim(),
  });

  const sent = await sendTelegram(html);
  const invoice = await prisma.telegramInvoice.create({
    data: {
      code, userId: user?.id ?? null, telegramHandle: handle, contact: contact?.trim() || null, note: note?.trim() || null,
      items: priced.lines, subtotal: priced.subtotal, shippingFee: priced.shippingFee, total: priced.total,
      text, delivered: sent.delivered,
    },
  });

  const contactRow = await prisma.siteSetting.findUnique({ where: { key: 'telegram_username' } });
  const shopUsername = contactRow?.value?.replace(/^@/, '').trim() || '';
  res.status(201).json(ok({
    code: invoice.code,
    text,
    total: priced.total,
    delivered: sent.delivered,
    shopTelegramUrl: shopUsername ? `https://t.me/${shopUsername}?text=${encodeURIComponent(text)}` : null,
    includesTelegram: !!handle,
  }));
});

export default r;
