import { Router } from 'express';
import { requireAdmin } from '../../middlewares/auth.js';
import { env } from '../../config/env.js';
import { prisma } from '../../db.js';
import { ok } from '../../utils/response.js';
import { appError } from '../../utils/formatters.js';
import {
  telegramStatus, inspectBot, linkBot, applyStyle, setPrimary, changeChat, unlinkBot, sendTelegram,
  setPostChat, setShelves, postProduct, setBotPhoto, setStylePhoto, styleFromBot, findBot,
} from '../../services/telegram.service.js';
import { DEFAULT_LOOK } from '../../services/telegramStyle.js';

// Admin → Telegram: link several bots by pasting their tokens, choose the
// primary one (staff notifications) and its chat, give each bot a style and its
// shelves; write styles. Tokens are sensitive, so admins only (not moderators).
const r = Router();
r.use(requireAdmin);

// This backend's public address, where Telegram calls the webhooks
const publicBase = req => env.publicUrl || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
const tokenOf = body => {
  const t = String(body?.token || '').trim();
  if (!/^\d+:[\w-]{30,}$/.test(t)) throw appError('That does not look like a bot token (it looks like 123456789:AA…)', 400);
  return t;
};
const chatOf = body => String(body?.chatId || '').trim();

r.get('/', async (req, res) => {
  res.json(ok({ ...(await telegramStatus()), publicBase: publicBase(req) }));
});

r.post('/inspect', async (req, res) => {
  res.json(ok(await inspectBot(tokenOf(req.body), { publicBase: publicBase(req), takeOver: !!req.body.takeOver })));
});

r.post('/link', async (req, res) => {
  res.json(ok(await linkBot(tokenOf(req.body), chatOf(req.body), {
    styleId: Number(req.body?.styleId) || null, primary: !!req.body?.primary, publicBase: publicBase(req),
  })));
});

r.post('/test', async (req, res) => {
  const sent = await sendTelegram('🔔 Test from the shop admin: notifications reach this chat.');
  if (!sent.delivered) throw appError(sent.reason || 'Could not send', 502);
  res.json(ok(sent));
});

// ─── One bot ─────────────────────────────────────────────────────────────────

r.post('/bots/:id/style', async (req, res) => {
  const bot = await applyStyle(req.params.id, Number(req.body?.styleId) || null);
  res.json(ok({ styleId: Number(req.body?.styleId) || null, photo: bot.photo || 'none', photoError: bot.photoError || null }));
});

r.post('/bots/:id/primary', async (req, res) => {
  await setPrimary(req.params.id);
  res.json(ok({ primary: true }));
});

r.post('/bots/:id/chat', async (req, res) => {
  if (!chatOf(req.body)) throw appError('Choose a chat', 400);
  res.json(ok(await changeChat(req.params.id, chatOf(req.body))));
});

// Where new products are announced ('' = nowhere)
r.post('/bots/:id/post-chat', async (req, res) => {
  await setPostChat(req.params.id, chatOf(req.body));
  res.json(ok({ postChatId: chatOf(req.body) }));
});

r.post('/bots/:id/shelves', async (req, res) => {
  res.json(ok({ shelves: await setShelves(req.params.id, req.body?.shelves) }));
});

r.post('/bots/:id/unlink', async (req, res) => {
  res.json(ok(await unlinkBot(req.params.id)));
});

// Bot profile photo: the shop's picture, or a JPG sent as a data URL
r.post('/bots/:id/photo', async (req, res) => {
  // The photo written in the bot's style
  if (req.body?.fromStyle) {
    const photo = await setStylePhoto(req.params.id);
    if (photo === 'none') throw appError('This style has no profile photo: add one under Styles → Profile photo.', 400);
    return res.json(ok({ photo }));
  }
  const data = String(req.body?.image || '');
  let jpg = null;
  if (data) {
    const m = /^data:image\/jpe?g;base64,(.+)$/.exec(data);
    if (!m) throw appError('The photo must be a JPG.', 400);
    jpg = Buffer.from(m[1], 'base64');
    if (jpg.length > 5 * 1024 * 1024) throw appError('The photo must be under 5 MB.', 400);
  }
  await setBotPhoto(req.params.id, jpg);
  res.json(ok({ photo: true }));
});

// Post one product now (Admin → Products): every bot with a products chat
r.post('/post-product/:id', async (req, res) => {
  if (!(await postProduct(req.params.id))) throw appError('Choose where a bot posts products in Admin → Telegram first.', 400);
  res.json(ok({ posted: true }));
});

// ─── Styles ──────────────────────────────────────────────────────────────────

r.get('/styles/defaults', (req, res) => res.json(ok({ look: DEFAULT_LOOK })));

r.get('/styles/:id', async (req, res) => {
  res.json(ok({ style: await prisma.botStyle.findUniqueOrThrow({ where: { id: Number(req.params.id) } }) }));
});

const styleData = body => {
  const name = String(body?.name || '').trim();
  if (!name) throw appError('Give the style a name', 400);
  const look = body?.look && typeof body.look === 'object' ? body.look : {};
  if (JSON.stringify(look).length > 200_000) throw appError('This style is too large', 400);
  return { name: name.slice(0, 80), look };
};

// A new style read from one of the shop's own bots, read-only: a linked bot
// (botId) or any bot by its token
r.post('/styles/import', async (req, res) => {
  const linked = req.body?.botId ? await findBot(req.body.botId) : null;
  if (req.body?.botId && !linked) throw appError('This bot is no longer linked.', 404);
  const token = linked ? linked.token : tokenOf(req.body);
  res.status(201).json(ok({ style: await styleFromBot(token, { publicBase: publicBase(req) }) }));
});

r.post('/styles', async (req, res) => {
  res.status(201).json(ok({ style: await prisma.botStyle.create({ data: styleData(req.body) }) }));
});

// Saving a style re-applies it to the bots that use it
r.put('/styles/:id', async (req, res) => {
  const style = await prisma.botStyle.update({ where: { id: Number(req.params.id) }, data: styleData(req.body), include: { bots: { select: { id: true } } } });
  const failed = [];
  for (const b of style.bots) await applyStyle(b.id, style.id).catch(err => failed.push(err.message));
  res.json(ok({ style, reapplied: style.bots.length - failed.length, failed }));
});

r.delete('/styles/:id', async (req, res) => {
  await prisma.botStyle.delete({ where: { id: Number(req.params.id) } });
  res.json(ok({ deleted: true }));
});

export default r;
