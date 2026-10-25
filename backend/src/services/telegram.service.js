import axios from 'axios';
import crypto from 'crypto';
import { readFile } from 'fs/promises';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { COMMANDS } from './telegramCatalog.js';

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
export const TELEGRAM_PRIVATE_KEYS = [KEYS.token, KEYS.secret, KEYS.seen, 'telegram_post_chat_id'];

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

// Chats this bot was seen in through the webhook, newest first (max 10).
// A bot linked before it had a chat adopts the first group or channel it's
// added to, so the admin doesn't have to come back and pick it.
export async function rememberChat(chat) {
  let list = [];
  try { list = JSON.parse(await setting(KEYS.seen) || '[]'); } catch { /* reset */ }
  const c = chatOf(chat);
  list = [c, ...list.filter(x => x.id !== c.id)].slice(0, 10);
  await save(KEYS.seen, JSON.stringify(list));
  if (c.type !== 'private' && !(await setting(KEYS.chatId)) && !env.telegram.chatId) {
    await save(KEYS.chatId, c.id);
    await sendTelegram("✅ This chat will receive the shop's paid orders and customer messages.", null, c.id);
  }
}

const webhookUrl = base => `${base.replace(/\/$/, '')}/api/webhooks/telegram-bot`;
const UPDATES = ['message', 'channel_post', 'my_chat_member', 'callback_query'];

// What every linked bot gets, branded or not: the catalog commands and, on an
// HTTPS site, an "Open shop" menu button
async function installNavigation(token) {
  const site = (env.frontendUrl || '').replace(/\/$/, '');
  await tg(token, 'setMyCommands', { commands: COMMANDS });
  if (site.startsWith('https://')) {
    await tg(token, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Open shop', web_app: { url: site } } });
  }
}

// What the admin sees: the linked bot (if any) and where it posts
export async function telegramStatus() {
  const cfg = await getTelegramConfig();
  let seen = [];
  try { seen = JSON.parse(await setting(KEYS.seen) || '[]'); } catch { /* none */ }
  if (!cfg.token) return { linked: false, seenChats: seen };
  try {
    const [me, hook] = await Promise.all([tg(cfg.token, 'getMe'), tg(cfg.token, 'getWebhookInfo')]);
    if (hook.url && cfg.secret && !(hook.allowed_updates || []).includes('callback_query')) {
      await tg(cfg.token, 'setWebhook', { url: hook.url, secret_token: cfg.secret, allowed_updates: UPDATES });
      await installNavigation(cfg.token);
    }
    return {
      linked: true,
      bot: { username: me.username, name: me.first_name },
      chatId: cfg.chatId,
      chat: seen.find(c => c.id === String(cfg.chatId)) || null,
      branded: cfg.branded,
      postChatId: await getPostChat(),
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
    const updates = await tg(token, 'getUpdates', { allowed_updates: UPDATES });
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

const BRAND = () => [
  ['setMyName', { name: 'Captain Slabbin' }],
  ['setMyShortDescription', { short_description: '🏴‍☠️ Top shelf. Delivered. Browse, buy and pay with crypto right here. 21+' }],
  ['setMyDescription', { description: [
    '🏴‍☠️ CAPTAIN SLABBIN', 'Top shelf. Delivered.', '',
    '🛒 Browse the shelves and the Fire Sale', '💰 Pay from your crypto wallet in one tap', '📦 Track your orders, right here', '',
    'No name or email to type: your account is your Telegram. Adults 21+ only.', '',
    'Tap START to come aboard.',
  ].join('\n') }],
];

// Step 2: link it. Saves token (+ chat when one is known), installs the webhook
// (HTTPS only — on a local http:// backend notifications still work, the
// catalog and commands just don't reply), sets the catalog commands, applies the
// shop's look if asked, and says hello in the chosen chat. Without a chat, the
// first group or channel the bot is added to is adopted (rememberChat).
export async function linkBot(token, chatId, { brand = false, publicBase }) {
  const me = await tg(token, 'getMe');
  const secret = crypto.randomBytes(24).toString('hex');
  let webhook = null;
  if (publicBase?.startsWith('https://')) {
    await tg(token, 'setWebhook', { url: webhookUrl(publicBase), secret_token: secret, allowed_updates: UPDATES });
    webhook = webhookUrl(publicBase);
  }
  await installNavigation(token);
  if (brand) for (const [method, payload] of BRAND()) await tg(token, method, payload);

  await Promise.all([save(KEYS.token, token), save(KEYS.chatId, chatId || ''), save(KEYS.secret, secret), save(KEYS.branded, brand ? 'true' : 'false')]);
  if (brand) await setBotPhoto().catch(err => console.error('[Telegram] bot photo:', err.message));
  if (!chatId) return { bot: { username: me.username, name: me.first_name }, webhook, branded: brand, helloDelivered: false, helloError: null, waitingForChat: true };

  const site = (env.frontendUrl || '').replace(/\/$/, '');
  const hello = await sendTelegram(`✅ <b>${escapeHtml(me.first_name)}</b> is now linked to the shop. Paid orders and customer messages will appear here.`, site ? [{ text: 'Open admin', url: `${site}/admin` }] : null, chatId);
  return { bot: { username: me.username, name: me.first_name }, webhook, branded: brand, helloDelivered: hello.delivered, helloError: hello.reason || null };
}

// Brand (or re-brand) the linked bot without relinking it
export async function brandLinkedBot() {
  const cfg = await getTelegramConfig();
  if (!cfg.token) throw Object.assign(new Error('No bot linked'), { status: 400 });
  await installNavigation(cfg.token);
  for (const [method, payload] of BRAND()) await tg(cfg.token, method, payload);
  await setBotPhoto().catch(err => console.error('[Telegram] bot photo:', err.message));
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

// ─── Customers on the bot ────────────────────────────────────────────────────

// A private message to a customer whose account is tied to Telegram (opened or
// connected from the bot). Silent no-op for everyone else.
export async function dmUser(userId, html, buttons) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramId: true } });
  if (!user?.telegramId) return { delivered: false, reason: 'No Telegram on this account' };
  return sendTelegram(html, buttons, user.telegramId);
}

// The linked bot's @username, for t.me links (cached per token)
let usernameCache = { token: null, username: null };
export async function botUsername() {
  const { token } = await getTelegramConfig();
  if (!token) return null;
  if (usernameCache.token !== token) {
    const me = await tg(token, 'getMe');
    usernameCache = { token, username: me.username };
  }
  return usernameCache.username;
}

// ─── Posting products ────────────────────────────────────────────────────────

const POST_KEY = 'telegram_post_chat_id';
export const getPostChat = () => setting(POST_KEY);
export const setPostChat = chatId => save(POST_KEY, chatId || '');

// A product card (photo, price, buttons to buy in the bot or open it on the
// site) in the chat chosen under "Post new products to". Returns false when
// no chat is chosen.
export async function postProduct(productId, chatOverride) {
  const cfg = await getTelegramConfig();
  const chatId = chatOverride || await getPostChat();
  if (!cfg.token || !chatId) return false;
  const p = await prisma.product.findFirst({
    where: { id: Number(productId), isActive: true },
    include: { images: { orderBy: { position: 'asc' } }, category: true },
  });
  if (!p) return false;
  const site = (env.frontendUrl || '').replace(/\/$/, '');
  const img = p.images.find(i => i.mediaType !== 'video');
  const photo = img && (img.url.startsWith('http') ? img.url : env.publicUrl ? `${env.publicUrl.replace(/\/$/, '')}${img.url}` : null);
  const was = p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price) ? ` <s>${money(p.compareAtPrice)}</s>` : '';
  const caption = [
    `🆕 <b>${escapeHtml(p.name)}</b>`,
    p.category ? escapeHtml(p.category.name) : null,
    `<b>${money(p.price)}</b>${was}${p.unitLabel ? ` ${escapeHtml(p.unitLabel)}` : ''}`,
    p.description ? escapeHtml(p.description.length > 300 ? p.description.slice(0, 300) + '…' : p.description) : null,
  ].filter(Boolean).join('\n');
  const name = await botUsername().catch(() => null);
  const buttons = [
    ...(name ? [{ text: '🛒 Buy in the bot', url: `https://t.me/${name}?start=p_${p.id}` }] : []),
    ...(site.startsWith('http') ? [{ text: '🌐 On the site', url: `${site}/p/${encodeURIComponent((p.sku || p.slug).toLowerCase())}` }] : []),
  ];
  const markup = buttons.length ? { inline_keyboard: [buttons] } : undefined;
  if (photo) {
    try {
      await tg(cfg.token, 'sendPhoto', { chat_id: chatId, photo, caption, parse_mode: 'HTML', reply_markup: markup });
      return true;
    } catch (err) { console.error('[Telegram] sendPhoto failed, posting text:', err.message); }
  }
  await tg(cfg.token, 'sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: markup });
  return true;
}

// ─── Bot profile photo ───────────────────────────────────────────────────────

// The shop's default bot picture (frontend/public/brand/bot/avatar.jpg)
const DEFAULT_PHOTO = new URL('../../assets/bot-avatar.jpg', import.meta.url);

// setMyProfilePhoto only takes a freshly uploaded JPG (multipart)
export async function setBotPhoto(jpg) {
  const { token } = await getTelegramConfig();
  if (!token) throw Object.assign(new Error('No bot linked'), { status: 400 });
  const buffer = jpg || await readFile(DEFAULT_PHOTO);
  const form = new FormData();
  form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://pic' }));
  form.append('pic', new Blob([buffer], { type: 'image/jpeg' }), 'photo.jpg');
  const res = await fetch(`https://api.telegram.org/bot${token}/setMyProfilePhoto`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw Object.assign(new Error(`Telegram: ${data.description || res.status}`), { status: 502 });
}
