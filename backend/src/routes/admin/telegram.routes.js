import { Router } from 'express';
import { requireAdmin } from '../../middlewares/auth.js';
import { env } from '../../config/env.js';
import { ok } from '../../utils/response.js';
import { appError } from '../../utils/formatters.js';
import {
  telegramStatus, inspectBot, linkBot, brandLinkedBot, changeChat, unlinkBot, sendTelegram,
  setPostChat, postProduct, setBotPhoto,
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

// Where new products are announced ('' = nowhere)
r.post('/post-chat', async (req, res) => {
  await setPostChat(String(req.body?.chatId || '').trim());
  res.json(ok({ postChatId: String(req.body?.chatId || '').trim() }));
});

// Post one product now (Admin → Products)
r.post('/post-product/:id', async (req, res) => {
  if (!(await postProduct(req.params.id))) throw appError('Choose where products are posted in Admin → Telegram bot first.', 400);
  res.json(ok({ posted: true }));
});

// Bot profile photo: the shop's picture, or a JPG sent as a data URL
r.post('/photo', async (req, res) => {
  const data = String(req.body?.image || '');
  let jpg = null;
  if (data) {
    const m = /^data:image\/jpe?g;base64,(.+)$/.exec(data);
    if (!m) throw appError('The photo must be a JPG.', 400);
    jpg = Buffer.from(m[1], 'base64');
    if (jpg.length > 5 * 1024 * 1024) throw appError('The photo must be under 5 MB.', 400);
  }
  await setBotPhoto(jpg);
  res.json(ok({ photo: true }));
});

export default r;
