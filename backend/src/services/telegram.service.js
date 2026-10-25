import axios from 'axios';
import crypto from 'crypto';
import { prisma } from '../db.js';
import { env } from '../config/env.js';

// Posts shop notifications (paid-order invoices, new customer messages) to the
// shop's Telegram chat through a bot, and links/brands that bot.
//
// The bot is managed from Admin → Settings → Telegram: paste a token, pick the
// chat, choose whether to apply the shop's look. Token, chat and webhook secret
// live in site settings (telegram_bot_token, telegram_chat_id,
// telegram_webhook_secret); the TELEGRAM_* env vars are only a fallback.
// Every send is best-effort: a Telegram outage must never block an order.

const KEYS = { token: 'telegram_bot_token', chatId: 'telegram_chat_id', secret: 'telegram_webhook_secret', seen: 'telegram_seen_chats', branded: 'telegram_branded' };
// Never sent to the admin UI by the generic settings endpoint
export const TELEGRAM_PRIVATE_KEYS = [KEYS.token, KEYS.secret, KEYS.seen];

async function setting(key) {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  return row?.value?.trim() || '';
}
const save = (key, value) => prisma.siteSetting.upsert({ where: { key }, update: { value: String(value) }, create: { key, value: String(value) } });

export async function getTelegramConfig() {
  const [token, chatId, secret, branded] = await Promise.all([setting(KEYS.token), setting(KEYS.chatId), setting(KEYS.secret), setting(KEYS.branded)]);
  return {
    token: token || env.telegram.botToken,
    chatId: chatId || env.telegram.chatId,
    secret: secret || env.telegram.webhookSecret,
    branded: branded === 'true',
  };
}

// Telegram HTML mode only needs these three escaped
export const escapeHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// "@name" for usernames, the raw value for numeric ids
export function formatTelegramContact(handle) {
  const h = String(handle || '').trim();
  if (!h) return null;
  if (/^-?\d+$/.test(h)) return `ID ${h} (tg://user?id=${h})`;
  return '@' + h.replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '');
}

// One Bot API call; throws with Telegram's own message on failure
export async function tg(token, method, payload = {}) {
  try {
    const { data } = await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, { timeout: 10000 });
    return data.result;
  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 404) {
      throw Object.assign(new Error('Telegram refused this token. Copy it again from @BotFather, all of it (numbers:letters).'), { status: 400 });
    }
    const msg = err.response?.data?.description || err.message;
    throw Object.assign(new Error(`Telegram: ${msg}`), { status: 502 });
  }
}

// A deep link into this site's own admin panel, opened from the inline button
// on a Telegram notification
const adminLink = path => env.frontendUrl ? `${env.frontendUrl.replace(/\/$/, '')}/admin${path}` : null;

// buttons: [{ text, url }] — one row, rendered under the message
export async function sendTelegram(html, buttons, chatOverride) {
  const cfg = await getTelegramConfig();
  if (!cfg.token) return { delivered: false, reason: 'No Telegram bot linked' };
  const chatId = chatOverride || cfg.chatId;
  if (!chatId) return { delivered: false, reason: 'No Telegram chat chosen' };
  try {
    const body = { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true };
    if (buttons?.length) body.reply_markup = { inline_keyboard: [buttons] };
    await tg(cfg.token, 'sendMessage', body);
    return { delivered: true };
  } catch (err) {
    console.error('[Telegram] sendMessage failed:', err.message);
    return { delivered: false, reason: err.message };
  }
}

// ─── Linking a bot (Admin → Settings → Telegram) ─────────────────────────────

const chatOf = c => ({ id: String(c.id), type: c.type, title: c.title || (c.username ? `@${c.username}` : [c.first_name, c.last_name].filter(Boolean).join(' ')) });

// Chats this bot was seen in through the webhook, newest first (max 10)
export async function rememberChat(chat) {
  let list = [];
  try { list = JSON.parse(await setting(KEYS.seen) || '[]'); } catch { /* reset */ }
  const c = chatOf(chat);
  list = [c, ...list.filter(x => x.id !== c.id)].slice(0, 10);
  await save(KEYS.seen, JSON.stringify(list));
}

const webhookUrl = base => `${base.replace(/\/$/, '')}/api/webhooks/telegram-bot`;

// What the admin sees: the linked bot (if any) and where it posts
export async function telegramStatus() {
  const cfg = await getTelegramConfig();
  let seen = [];
  try { seen = JSON.parse(await setting(KEYS.seen) || '[]'); } catch { /* none */ }
  if (!cfg.token) return { linked: false, seenChats: seen };
  try {
    const [me, hook] = await Promise.all([tg(cfg.token, 'getMe'), tg(cfg.token, 'getWebhookInfo')]);
    return {
      linked: true,
      bot: { username: me.username, name: me.first_name },
      chatId: cfg.chatId,
      chat: seen.find(c => c.id === String(cfg.chatId)) || null,
      branded: cfg.branded,
      webhook: { url: hook.url || null, lastError: hook.last_error_message || null },
      seenChats: seen,
    };
  } catch (err) {
    return { linked: true, error: err.message, chatId: cfg.chatId, seenChats: seen };
  }
}

// Step 1: check a token before linking it. Lists the chats the bot has seen so
// the admin can pick the shop's chat. Telegram only allows that while the bot
// has no webhook, so a bot wired to another app is reported (takeOver frees it).
export async function inspectBot(token, { publicBase, takeOver = false } = {}) {
  const me = await tg(token, 'getMe');
  let hook = await tg(token, 'getWebhookInfo');
  const ours = publicBase && hook.url === webhookUrl(publicBase);
  if (hook.url && !ours) {
    if (!takeOver) return { bot: { username: me.username, name: me.first_name }, busyElsewhere: hook.url, chats: [] };
    await tg(token, 'deleteWebhook');
    hook = { url: '' };
  }
  let chats = [];
  if (!hook.url) {
    const updates = await tg(token, 'getUpdates', { allowed_updates: ['message', 'channel_post', 'my_chat_member'] });
    const map = new Map();
    for (const u of updates) {
      const c = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
      if (c) map.set(String(c.id), chatOf(c));
    }
    chats = [...map.values()];
  } else {
    try { chats = JSON.parse(await setting(KEYS.seen) || '[]'); } catch { /* none */ }
  }
  return { bot: { username: me.username, name: me.first_name }, busyElsewhere: null, chats };
}

const BRAND = (siteUrl) => [
  ['setMyName', { name: 'Captain Slabbin' }],
  ['setMyShortDescription', { short_description: 'Order notifications for the Captain Slabbin shop.' }],
  ['setMyDescription', { description: 'Posts paid orders and customer messages from the Captain Slabbin shop. For support, message the shop from your account on the site.' }],
  ['setMyCommands', { commands: [
    { command: 'shop', description: 'Open the storefront' },
    { command: 'admin', description: 'Open the admin panel' },
  ] }],
  ...(siteUrl?.startsWith('https://') ? [['setChatMenuButton', { menu_button: { type: 'web_app', text: 'Open shop', web_app: { url: siteUrl } } }]] : []),
];

// Step 2: link it. Saves token + chat, installs the webhook (HTTPS only — on a
// local http:// backend notifications still work, commands just don't reply),
// applies the shop's look if asked, and says hello in the chosen chat.
export async function linkBot(token, chatId, { brand = false, publicBase }) {
  if (!chatId) throw Object.assign(new Error('Choose the chat the bot should post to'), { status: 400 });
  const me = await tg(token, 'getMe');
  const secret = crypto.randomBytes(24).toString('hex');
  let webhook = null;
  if (publicBase?.startsWith('https://')) {
    await tg(token, 'setWebhook', { url: webhookUrl(publicBase), secret_token: secret, allowed_updates: ['message', 'my_chat_member'] });
    webhook = webhookUrl(publicBase);
  }
  const site = (env.frontendUrl || '').replace(/\/$/, '');
  if (brand) for (const [method, payload] of BRAND(site)) await tg(token, method, payload);

  await Promise.all([save(KEYS.token, token), save(KEYS.chatId, chatId), save(KEYS.secret, secret), save(KEYS.branded, brand ? 'true' : 'false')]);

  const hello = await sendTelegram(`✅ <b>${escapeHtml(me.first_name)}</b> is now linked to the shop. Paid orders and customer messages will appear here.`, site ? [{ text: 'Open admin', url: `${site}/admin` }] : null, chatId);
  return { bot: { username: me.username, name: me.first_name }, webhook, branded: brand, helloDelivered: hello.delivered, helloError: hello.reason || null };
}

// Brand (or re-brand) the linked bot without relinking it
export async function brandLinkedBot() {
  const cfg = await getTelegramConfig();
  if (!cfg.token) throw Object.assign(new Error('No bot linked'), { status: 400 });
  for (const [method, payload] of BRAND((env.frontendUrl || '').replace(/\/$/, ''))) await tg(cfg.token, method, payload);
  await save(KEYS.branded, 'true');
}

// Point the linked bot at another chat it has been seen in
export async function changeChat(chatId) {
  await save(KEYS.chatId, chatId);
  return sendTelegram('✅ Shop notifications will now be posted here.', null, chatId);
}

// Unlink: stop the webhook and forget the bot (its own profile is left as is)
export async function unlinkBot() {
  const cfg = await getTelegramConfig();
  const own = await setting(KEYS.token);
  if (own) { try { await tg(own, 'deleteWebhook'); } catch { /* token may be revoked already */ } }
  await prisma.siteSetting.deleteMany({ where: { key: { in: [KEYS.token, KEYS.secret, KEYS.branded] } } });
  return { stillFromEnv: !!(env.telegram.botToken && !own && cfg.token) };
}

// ─── Notifications ───────────────────────────────────────────────────────────

const money = n => `$${Number(n).toFixed(2)}`;

// Every order is paid in the app; its invoice then goes to Telegram: posted to the
// shop's chat here (with a button straight to the order in admin), and returned
// as plain text so the customer can send it too.
export async function notifyWalletOrder(order, user, payments) {
  const telegram = formatTelegramContact(user.telegramHandle);
  const paid = (payments || []).map(p => `${p.amount} ${p.currency}`).join(' + ') || 'wallet';
  const lines = (order.items || []).map(i => `• ${i.quantity} × ${i.name}: ${money(Number(i.price) * i.quantity)}`);
  const text = [
    `PAID ORDER ${order.orderNumber}`,
    ...lines,
    order.shippingAddress
      ? `Delivery: ${Number(order.shippingFee) > 0 ? money(order.shippingFee) : 'Free'}`
      : 'Delivery: none (to arrange on Telegram)',
    `Total: ${money(order.totalAmount)}, paid ${paid}`,
    `Account: ${user.username}`,
    telegram ? `Telegram: ${telegram}` : null,
    order.shippingAddress ? `Ship to: ${order.name}\n${order.shippingAddress}` : null,
  ].filter(Boolean).join('\n');
  const link = adminLink(`/orders/${order.id}`);
  const sent = await sendTelegram([
    `✅ <b>Paid order ${escapeHtml(order.orderNumber)}</b> (wallet)`,
    ...lines.map(escapeHtml),
    `<b>Total: ${money(order.totalAmount)}</b> · paid ${escapeHtml(paid)}`,
    `👤 ${escapeHtml(user.username)}`,
    telegram ? `✈️ Telegram: ${escapeHtml(telegram)}` : '✈️ Telegram: not on profile',
    order.shippingAddress
      ? `📦 <b>Ship to:</b> ${escapeHtml(order.name)}\n${escapeHtml(order.shippingAddress)}${Number(order.shippingFee) > 0 ? ` · ${money(order.shippingFee)}` : ' · free shipping'}`
      : '📦 No delivery, arrange on Telegram',
  ].join('\n'), link ? [{ text: '📦 Open order', url: link }] : null);
  return { text, delivered: sent.delivered };
}

export async function notifyNewMessage(user, body) {
  const telegram = formatTelegramContact(user.telegramHandle);
  const preview = body.length > 400 ? body.slice(0, 400) + '…' : body;
  const link = adminLink(`/messages/${user.id}`);
  return sendTelegram([
    `💬 <b>New message from ${escapeHtml(user.username)}</b>`,
    telegram ? `✈️ ${escapeHtml(telegram)}` : null,
    escapeHtml(preview),
  ].filter(Boolean).join('\n'), link ? [{ text: '💬 Reply in admin', url: link }] : null);
}
