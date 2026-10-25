import { Router } from 'express';
import { requireAdmin } from '../../middlewares/auth.js';
import { env } from '../../config/env.js';
import { ok } from '../../utils/response.js';
import { appError } from '../../utils/formatters.js';
import {
  telegramStatus, inspectBot, linkBot, brandLinkedBot, changeChat, unlinkBot, sendTelegram,
} from '../../services/telegram.service.js';

// Admin → Settings → Telegram: link a bot by pasting its token, pick the chat,
// optionally apply the shop's look; switch bots or chats later the same way.
// The token is sensitive, so admins only (not moderators).
const r = Router();
r.use(requireAdmin);

// This backend's public address, where Telegram calls the webhook
const publicBase = req => env.publicUrl || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
const tokenOf = body => {
  const t = String(body?.token || '').trim();
  if (!/^\d+:[\w-]{30,}$/.test(t)) throw appError('That does not look like a bot token (it looks like 123456789:AA…)', 400);
  return t;
};

r.get('/', async (req, res) => {
  res.json(ok({ ...(await telegramStatus()), publicBase: publicBase(req) }));
});

r.post('/inspect', async (req, res) => {
  res.json(ok(await inspectBot(tokenOf(req.body), { publicBase: publicBase(req), takeOver: !!req.body.takeOver })));
});

r.post('/link', async (req, res) => {
  const chatId = String(req.body?.chatId || '').trim();
  res.json(ok(await linkBot(tokenOf(req.body), chatId, { brand: !!req.body.brand, publicBase: publicBase(req) })));
});

r.post('/brand', async (req, res) => {
  await brandLinkedBot();
  res.json(ok({ branded: true }));
});

r.post('/chat', async (req, res) => {
  const chatId = String(req.body?.chatId || '').trim();
  if (!chatId) throw appError('Choose a chat', 400);
  res.json(ok(await changeChat(chatId)));
});

r.post('/test', async (req, res) => {
  const sent = await sendTelegram('🔔 Test from the Captain Slabbin admin: notifications reach this chat.');
  if (!sent.delivered) throw appError(sent.reason || 'Could not send', 502);
  res.json(ok(sent));
});

r.post('/unlink', async (req, res) => {
  res.json(ok(await unlinkBot()));
});

export default r;
