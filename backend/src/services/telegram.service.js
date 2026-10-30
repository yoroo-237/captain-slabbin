import axios from 'axios';
import crypto from 'crypto';
import { readFile, readdir } from 'fs/promises';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { lookOf, isShopStyle } from './telegramStyle.js';
import { pushStaff } from './push.service.js';
import { readPublicKey, keyFingerprint } from './pgp.service.js';
import { staffButton, staffLoginEnabled, siteDomain } from './staffLogin.service.js';

// The shop's Telegram bots. Several can be linked from Admin → Telegram; they all
// sell the same shop, each with its own style (services/telegramStyle.js) and
// shelves. The primary bot posts the staff notifications (paid-order invoices,
// new customer messages) to the shop's chat; a customer hears from the bot they
// last used. Every send is best-effort: a Telegram outage must never block an order.

// Where the single bot used to live (before TelegramBot); kept private, never read back
const LEGACY = { token: 'telegram_bot_token', chatId: 'telegram_chat_id', secret: 'telegram_webhook_secret', seen: 'telegram_seen_chats', branded: 'telegram_branded', post: 'telegram_post_chat_id' };
// Never sent to the admin UI by the generic settings endpoint
export const TELEGRAM_PRIVATE_KEYS = [...Object.values(LEGACY), 'telegram_reader_api_id', 'telegram_reader_api_hash', 'telegram_reader_session'];

async function setting(key) {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  return row?.value?.trim() || '';
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

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// One Bot API call; throws with Telegram's own message on failure
export async function tg(token, method, payload = {}) {
  try {
    const { data } = await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, { timeout: 10000 });
    return data.result;
  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 404) {
      throw fail('Telegram refused this token. Copy it again from @BotFather, all of it (numbers:letters).');
    }
    const msg = err.response?.data?.description || err.message;
    throw fail(`Telegram: ${msg}`, 502);
  }
}

// ─── Bots ────────────────────────────────────────────────────────────────────

export const primaryBot = () => prisma.telegramBot.findFirst({ where: { isPrimary: true }, include: { style: true } });
export const findBot = id => prisma.telegramBot.findUnique({ where: { id: Number(id) || 0 }, include: { style: true } });
async function botOrFail(id) {
  const bot = await findBot(id);
  if (!bot) throw fail('This bot is no longer linked.', 404);
  return bot;
}

// The style every shop starts with: empty, so it is exactly the default look
async function defaultStyle() {
  return await prisma.botStyle.findFirst({ where: { source: null }, orderBy: { id: 'asc' } })
    || prisma.botStyle.create({ data: { name: 'Captain Slabbin', look: {} } });
}

// At startup: the style a bot gets when linked. The primary bot itself is never
// created here: it is linked by hand from the admin (Telegram bot page).
export async function ensureDefaultStyle() {
  await defaultStyle();
}

// Styles shipped with the code (prisma/presets/*.json: { name, source, look }):
// created at startup when no style has that name, never overwritten, so the
// admin can edit them freely.
export async function ensurePresetStyles() {
  const dir = new URL('../../prisma/presets/', import.meta.url);
  let files = [];
  try { files = (await readdir(dir)).filter(f => f.endsWith('.json')); } catch { return; }
  for (const f of files) {
    try {
      const { name, source = null, look } = JSON.parse(await readFile(new URL(f, dir), 'utf8'));
      if (name && look && !(await prisma.botStyle.findFirst({ where: { name } }))) {
        await prisma.botStyle.create({ data: { name, source, look } });
        console.log(`[Telegram] style "${name}" added`);
      }
    } catch (err) { console.error(`[Telegram] style preset ${f}:`, err.message); }
  }
}

const chatOf = c => ({ id: String(c.id), type: c.type, title: c.title || (c.username ? `@${c.username}` : [c.first_name, c.last_name].filter(Boolean).join(' ')) });

// buttons: [{ text, url | callback_data }], one row under the message
export async function sendAs(bot, chatId, html, buttons) {
  if (!bot) return { delivered: false, reason: 'No Telegram bot linked' };
  if (!chatId) return { delivered: false, reason: 'No Telegram chat chosen' };
  try {
    const body = { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true };
    if (buttons?.length) body.reply_markup = { inline_keyboard: [buttons] };
    await tg(bot.token, 'sendMessage', body);
    return { delivered: true };
  } catch (err) {
    console.error(`[Telegram] @${bot.username} sendMessage failed:`, err.message);
    return { delivered: false, reason: err.message };
  }
}

// Staff notifications: the primary bot, in the shop's chat
export async function sendTelegram(html, buttons, chatOverride) {
  const bot = await primaryBot();
  return sendAs(bot, chatOverride || bot?.chatId, html, buttons);
}

// Chats a bot was seen in through its webhook, newest first (max 10). A primary
// bot with no staff chat yet adopts the first group or channel it's added to.
export async function rememberChat(bot, chat) {
  const c = chatOf(chat);
  const seen = [c, ...(bot.seenChats || []).filter(x => x.id !== c.id)].slice(0, 10);
  const adopt = bot.isPrimary && !bot.chatId && c.type !== 'private';
  await prisma.telegramBot.update({ where: { id: bot.id }, data: { seenChats: seen, ...(adopt ? { chatId: c.id } : {}) } });
  if (adopt) await sendAs(bot, c.id, "✅ This chat will receive the shop's paid orders and customer messages.");
}

const webhookBase = base => `${base.replace(/\/$/, '')}/api/webhooks/telegram-bot`;
const webhookUrl = (base, bot) => `${webhookBase(base)}/${bot.id}`;
const UPDATES = ['message', 'channel_post', 'my_chat_member', 'callback_query'];

// Commands and, on an HTTPS site, the menu button, in the bot's style
async function installNavigation(bot) {
  const { profile } = lookOf(bot.style);
  const site = (env.frontendUrl || '').replace(/\/$/, '');
  await tg(bot.token, 'setMyCommands', { commands: profile.commands });
  // The website button only for a style that links to the website; otherwise the plain commands menu
  const menu_button = site.startsWith('https://') && env.platform !== 'bots' && lookOf(bot.style).siteLinks !== false
    ? { type: 'web_app', text: profile.menuButton, web_app: { url: site } }
    : { type: 'commands' };
  await tg(bot.token, 'setChatMenuButton', { menu_button });
}

// What the admin sees: every bot with its state, and the styles to choose from
export async function telegramStatus() {
  const [bots, styles] = await Promise.all([
    prisma.telegramBot.findMany({ orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], include: { style: true, _count: { select: { users: true } } } }),
    prisma.botStyle.findMany({ orderBy: { id: 'asc' }, select: { id: true, name: true, source: true, look: true } }),
  ]);
  const rows = await Promise.all(bots.map(async bot => {
    const base = {
      id: bot.id, username: bot.username, name: bot.name, isPrimary: bot.isPrimary,
      chatId: bot.chatId, chat: bot.seenChats.find(c => c.id === bot.chatId) || null,
      postChatId: bot.postChatId, seenChats: bot.seenChats, shelves: bot.shelves,
      styleId: bot.styleId, customers: bot._count.users,
      pgpKey: bot.pgpKey, pgpFingerprint: await keyFingerprint(bot.pgpKey),
    };
    try {
      const [me, hook] = await Promise.all([tg(bot.token, 'getMe'), tg(bot.token, 'getWebhookInfo')]);
      if (me.username !== bot.username || me.first_name !== bot.name) {
        await prisma.telegramBot.update({ where: { id: bot.id }, data: { username: me.username, name: me.first_name } });
      }
      if (hook.url && bot.secret && !(hook.allowed_updates || []).includes('callback_query')) {
        await tg(bot.token, 'setWebhook', { url: hook.url, secret_token: bot.secret, allowed_updates: UPDATES });
        await installNavigation(bot);
      }
      return { ...base, username: me.username, name: me.first_name, webhook: { url: hook.url || null, lastError: hook.last_error_message || null } };
    } catch (err) {
      return { ...base, error: err.message };
    }
  }));
  // (a style's look can be large: only the catalog it sells goes to the admin)
  return {
    bots: rows, styles: styles.map(({ look, ...s }) => ({ ...s, catalog: look?.catalog || null })),
    staffLogin: { enabled: await staffLoginEnabled(), domain: siteDomain() },
  };
}

// Step 1: check a token before linking it. Lists the chats the bot has seen so
// the admin can pick the shop's chat. Telegram only allows that while the bot
// has no webhook, so a bot wired to another app is reported (takeOver frees it).
export async function inspectBot(token, { publicBase, takeOver = false } = {}) {
  const me = await tg(token, 'getMe');
  const bot = { username: me.username, name: me.first_name };
  const linked = await prisma.telegramBot.findUnique({ where: { token } });
  if (linked) return { bot, alreadyLinked: true, busyElsewhere: null, chats: linked.seenChats };
  let hook = await tg(token, 'getWebhookInfo');
  const ours = publicBase && hook.url?.startsWith(webhookBase(publicBase));
  if (hook.url && !ours) {
    if (!takeOver) return { bot, busyElsewhere: hook.url, chats: [] };
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
  }
  return { bot, busyElsewhere: null, chats };
}

// Step 2: link it. Saves the bot, installs its webhook (HTTPS only: on a local
// http:// backend notifications still work, the catalog just doesn't reply),
// applies the chosen style and, for the primary bot, says hello in the staff
// chat. The first bot linked is the primary one.
export async function linkBot(token, chatId, { styleId = null, primary = false, publicBase }) {
  const me = await tg(token, 'getMe');
  if (await prisma.telegramBot.findUnique({ where: { token } })) throw fail(`@${me.username} is already linked.`);
  const first = !(await prisma.telegramBot.count());
  const isPrimary = first || primary;
  const secret = crypto.randomBytes(24).toString('hex');
  if (isPrimary) await prisma.telegramBot.updateMany({ data: { isPrimary: false } });
  const bot = await prisma.telegramBot.create({
    data: { token, username: me.username, name: me.first_name, secret, isPrimary, chatId: isPrimary ? chatId || '' : '', seenChats: [] },
  });

  let webhook = null;
  if (publicBase?.startsWith('https://')) {
    webhook = webhookUrl(publicBase, bot);
    // Without its webhook the bot can't answer: undo the link so the admin can simply retry
    try { await tg(token, 'setWebhook', { url: webhook, secret_token: secret, allowed_updates: UPDATES }); }
    catch (err) { await prisma.telegramBot.delete({ where: { id: bot.id } }); throw err; }
  }
  // The bot works without its profile: a refused style is reported, the link stays
  let styleError = null;
  try {
    if (styleId) await applyStyle(bot.id, styleId);
    else await installNavigation({ ...bot, style: null });
  } catch (err) { styleError = err.message; console.error(`[Telegram] @${me.username} style:`, err.message); }

  const result = { bot: { id: bot.id, username: me.username, name: me.first_name }, webhook, isPrimary, styleError, helloDelivered: false, helloError: null };
  if (!isPrimary) return result;
  if (!chatId) return { ...result, waitingForChat: true };
  const site = (env.frontendUrl || '').replace(/\/$/, '');
  const hello = await sendAs(bot, chatId, `✅ <b>${escapeHtml(me.first_name)}</b> is now linked to the shop. Paid orders and customer messages will appear here.`, site ? [await staffButton('Open the dashboard', `${site}/admin`)] : null);
  return { ...result, helloDelivered: hello.delivered, helloError: hello.reason || null };
}

// A style's profile pushed to Telegram: name, descriptions, commands, menu
// button and photo. styleId null only detaches the style (profile left as is).
export async function applyStyle(botId, styleId) {
  const style = styleId ? await prisma.botStyle.findUnique({ where: { id: Number(styleId) } }) : null;
  if (styleId && !style) throw fail('This style no longer exists.', 404);
  const bot = await prisma.telegramBot.update({ where: { id: Number(botId) }, data: { styleId: style?.id || null }, include: { style: true } });
  if (!style) return bot;
  const { profile } = lookOf(style);
  // Telegram rate-limits renames hard (one per several minutes): only rename when it changes
  const name = profile.name.slice(0, 64);
  if ((await tg(bot.token, 'getMyName').catch(() => null))?.name !== name) await tg(bot.token, 'setMyName', { name });
  await tg(bot.token, 'setMyShortDescription', { short_description: profile.shortDescription.slice(0, 120) });
  await tg(bot.token, 'setMyDescription', { description: profile.description.slice(0, 512) });
  await installNavigation(bot);
  // Telegram's refusal is reported, not hidden: the admin must know the photo didn't change
  let photo = 'none', photoError = null;
  try { photo = await setStylePhoto(bot.id); } catch (err) { photoError = err.message; console.error(`[Telegram] @${bot.username} photo:`, err.message); }
  return Object.assign(bot, { photo, photoError });
}

// The profile photo of the bot's style: its own picture; the shop's picture only for
// the shop's own style, never another brand's. 'none' when the style has no photo.
export async function setStylePhoto(botId) {
  const bot = await botOrFail(botId);
  const { profile } = lookOf(bot.style);
  if (profile.photo) {
    let data;
    try { ({ data } = await axios.get(profile.photo, { responseType: 'arraybuffer', timeout: 15000 })); }
    catch (err) { throw fail(`The style's photo could not be downloaded (${err.message}).`, 502); }
    await setBotPhoto(bot.id, Buffer.from(data));
    return 'style';
  }
  if (isShopStyle(bot.style)) { await setBotPhoto(bot.id, null); return 'shop'; }
  return 'none';
}

export async function setPrimary(botId) {
  await botOrFail(botId);
  await prisma.$transaction([
    prisma.telegramBot.updateMany({ data: { isPrimary: false } }),
    prisma.telegramBot.update({ where: { id: Number(botId) }, data: { isPrimary: true } }),
  ]);
}

// Staff chat of the primary bot, picked among the chats it has been seen in
export async function changeChat(botId, chatId) {
  const bot = await botOrFail(botId);
  await prisma.telegramBot.update({ where: { id: bot.id }, data: { chatId } });
  return sendAs(bot, chatId, '✅ Shop notifications will now be posted here.');
}

export async function setPostChat(botId, chatId) {
  await prisma.telegramBot.update({ where: { id: (await botOrFail(botId)).id }, data: { postChatId: chatId || '' } });
}

// Top-level shelves this bot shows ([] = all)
export async function setShelves(botId, slugs) {
  const clean = [...new Set((Array.isArray(slugs) ? slugs : []).map(s => String(s).trim()).filter(Boolean))];
  await prisma.telegramBot.update({ where: { id: (await botOrFail(botId)).id }, data: { shelves: clean } });
  return clean;
}

// The PGP public key this bot's customers encrypt their address to ('' = none:
// the style's key page is used, if it holds one)
export async function setPgpKey(botId, text) {
  const { armored, fingerprint } = await readPublicKey(text);
  await prisma.telegramBot.update({ where: { id: (await botOrFail(botId)).id }, data: { pgpKey: armored } });
  return { pgpKey: armored, pgpFingerprint: fingerprint };
}

// Unlink: stop the webhook and forget the bot (its own profile is left as is).
// Removing the primary bot hands the role to the oldest one left.
export async function unlinkBot(botId) {
  const bot = await botOrFail(botId);
  try { await tg(bot.token, 'deleteWebhook'); } catch { /* token may be revoked already */ }
  await prisma.telegramBot.delete({ where: { id: bot.id } });
  if (bot.isPrimary) {
    const next = await prisma.telegramBot.findFirst({ orderBy: { createdAt: 'asc' } });
    if (next) await prisma.telegramBot.update({ where: { id: next.id }, data: { isPrimary: true } });
  }
  // Forget the old single-bot settings too
  await prisma.siteSetting.deleteMany({ where: { key: { in: [LEGACY.token, LEGACY.secret] } } });
  return {};
}

// ─── Notifications ───────────────────────────────────────────────────────────

const money = n => `$${Number(n).toFixed(2)}`;
// A deep link into this site's own admin panel, opened from the inline button
// on a Telegram notification
const adminLink = path => env.frontendUrl ? `${env.frontendUrl.replace(/\/$/, '')}/admin${path}` : null;

// Every order is paid in the app; its invoice then goes to Telegram: posted to the
// shop's chat here (with a button straight to the order in admin), and returned
// as plain text so the customer can send it too.
export async function notifyWalletOrder(order, user, payments, { channel = 'site' } = {}) {
  const telegram = formatTelegramContact(user.telegramHandle);
  const paid = (payments || []).map(p => `${p.amount} ${p.currency}`).join(' + ') || 'wallet';
  const lines = (order.items || []).map(i => `• ${i.quantity} × ${i.name}: ${money(Number(i.price) * i.quantity)}`);
  const text = [
    `PAID ORDER ${order.orderNumber}`,
    ...lines,
    order.shippingAddress
      ? `Delivery: ${Number(order.shippingFee) > 0 ? money(order.shippingFee) : 'Free'}`
      : 'Delivery: none (to arrange on Telegram)',
    order.voucherCode ? `Voucher ${order.voucherCode}: -${money(order.discount)}` : null,
    `Total: ${money(order.totalAmount)}, paid ${paid}`,
    `Account: ${user.username}`,
    telegram ? `Telegram: ${telegram}` : null,
    // (an encrypted address stays on the order: too long for a link the customer sends)
    order.shippingAddress ? (/^-----BEGIN PGP MESSAGE/.test(order.shippingAddress) ? 'Ship to: PGP encrypted address, on the order' : `Ship to: ${order.name}\n${order.shippingAddress}`) : null,
  ].filter(Boolean).join('\n');
  const link = adminLink(`/orders/${order.id}`);
  pushStaff({ title: `Paid order ${order.orderNumber}`, body: `${money(order.totalAmount)} · ${user.username}`, url: `/admin/orders/${order.id}`, tag: `order-${order.id}` });
  const via = user.telegramBotId ? await findBot(user.telegramBotId) : null;
  const sent = await sendTelegram([
    `✅ <b>Paid order ${escapeHtml(order.orderNumber)}</b> (wallet)`,
    ...lines.map(escapeHtml),
    order.voucherCode ? `🎟 Voucher ${escapeHtml(order.voucherCode)}: −${money(order.discount)}` : null,
    `<b>Total: ${money(order.totalAmount)}</b> · paid ${escapeHtml(paid)}`,
    `👤 ${escapeHtml(user.username)}`,
    telegram ? `✈️ Telegram: ${escapeHtml(telegram)}` : '✈️ Telegram: not on profile',
    via && !via.isPrimary ? `🤖 Customer of @${escapeHtml(via.username)}` : null,
    // An encrypted address can be longer than a Telegram message: it is read on the order
    order.shippingAddress
      ? `📦 <b>Ship to:</b> ${/^-----BEGIN PGP MESSAGE/.test(order.shippingAddress) ? '🔒 PGP encrypted address, decrypt it on the order' : `${escapeHtml(order.name)}\n${escapeHtml(order.shippingAddress)}`}${Number(order.shippingFee) > 0 ? ` · ${money(order.shippingFee)}` : ' · free shipping'}`
      : '📦 No delivery, arrange on Telegram',
    order.note ? `📝 <b>Notes:</b>\n${escapeHtml(order.note)}` : null,
  ].filter(Boolean).join('\n'), link ? [await staffButton('📦 Open order', link)] : null);
  // An order placed on the website: its receipt also goes to the customer's own
  // Telegram, through the bot they use (the bot shows its own receipt already)
  const receipt = channel === 'site' ? await dmUser(user.id, [
    `✅ <b>Order ${escapeHtml(order.orderNumber)} is paid</b>`,
    '',
    ...lines.map(escapeHtml),
    order.voucherCode ? `🎟 ${escapeHtml(order.voucherCode)}: −${money(order.discount)}` : null,
    order.shippingAddress ? `Shipping: ${Number(order.shippingFee) > 0 ? money(order.shippingFee) : 'free'}` : 'No delivery: we arrange it with you here.',
    `<b>Total: ${money(order.totalAmount)}</b> · paid ${escapeHtml(paid)}`,
    '',
    'We have your order and message you here about the delivery.',
  ].filter(v => v !== null).join('\n'), (env.frontendUrl || '').startsWith('https://') ? [{ text: '📦 Track my order', url: `${env.frontendUrl.replace(/\/$/, '')}/account/orders` }] : null) : null;
  return { text, delivered: sent.delivered, receiptDelivered: !!receipt?.delivered };
}

export async function notifyNewMessage(user, body) {
  const telegram = formatTelegramContact(user.telegramHandle);
  const preview = body.length > 400 ? body.slice(0, 400) + '…' : body;
  const link = adminLink(`/messages/${user.id}`);
  pushStaff({ title: `Message from ${user.username}`, body: preview.slice(0, 140), url: `/admin/messages/${user.id}`, tag: `message-${user.id}` });
  return sendTelegram([
    `💬 <b>New message from ${escapeHtml(user.username)}</b>`,
    telegram ? `✈️ ${escapeHtml(telegram)}` : null,
    escapeHtml(preview),
  ].filter(Boolean).join('\n'), link ? [await staffButton('💬 Reply in admin', link)] : null);
}

// ─── Customers on the bot ────────────────────────────────────────────────────

// A private message to a customer whose account is tied to Telegram, through
// the bot they last used (a bot can only write to people who started it).
// Silent no-op for everyone else.
export async function dmUser(userId, html, buttons) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramId: true, telegramBot: true } });
  if (!user?.telegramId) return { delivered: false, reason: 'No Telegram on this account' };
  return sendAs(user.telegramBot || await primaryBot(), user.telegramId, html, buttons);
}

// The primary bot's @username, for t.me links
export async function botUsername() {
  return (await primaryBot())?.username || null;
}

// ─── Posting products ────────────────────────────────────────────────────────

// A product card (photo, price, buttons to buy in the bot or open it on the
// site) in the chat each bot posts products to (or only `botId`'s). Returns how
// many bots posted it; a bot whose shelves leave the product out is skipped.
export async function postProduct(productId, { botId } = {}) {
  const bots = await prisma.telegramBot.findMany({ where: { postChatId: { not: '' }, ...(botId ? { id: Number(botId) } : {}) }, include: { style: true } });
  if (!bots.length) return 0;
  const p = await prisma.product.findFirst({
    where: { id: Number(productId), isActive: true },
    include: { images: { orderBy: { position: 'asc' } }, category: { include: { parent: true } } },
  });
  if (!p) return 0;
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
  const shelf = (p.category?.parent || p.category)?.slug;

  let posted = 0;
  for (const bot of bots) {
    const { labels, catalog: botCatalog, siteLinks } = lookOf(bot.style);
    // A bot only announces products of the catalog it sells
    if ((botCatalog || null) !== (p.source || null)) continue;
    if (bot.shelves.length && !bot.shelves.includes(shelf)) continue;
    const buttons = [
      { text: '🛒 Buy in the bot', url: `https://t.me/${bot.username}?start=p_${p.id}` },
      ...(site.startsWith('http') && env.platform !== 'bots' && siteLinks !== false ? [{ text: labels.onSite, url: `${site}/p/${encodeURIComponent((p.sku || p.slug).toLowerCase())}` }] : []),
    ];
    const markup = { inline_keyboard: [buttons] };
    try {
      if (photo) {
        try {
          await tg(bot.token, 'sendPhoto', { chat_id: bot.postChatId, photo, caption, parse_mode: 'HTML', reply_markup: markup });
          posted++;
          continue;
        } catch (err) { console.error(`[Telegram] @${bot.username} sendPhoto failed, posting text:`, err.message); }
      }
      await tg(bot.token, 'sendMessage', { chat_id: bot.postChatId, text: caption, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: markup });
      posted++;
    } catch (err) { console.error(`[Telegram] @${bot.username} post product:`, err.message); }
  }
  return posted;
}

// ─── Recreating one of the shop's bots ───────────────────────────────────────

// A style from a bot the shop owns, read with its token through the Bot API:
// name, descriptions, commands, menu button and profile photo. Read-only: the
// bot keeps its webhook and keeps running wherever it runs. Screens are not
// readable this way (Telegram keeps no history for bots); they are rebuilt as
// pages in the style editor.
export async function styleFromBot(token, { publicBase } = {}) {
  const me = await tg(token, 'getMe');
  const [name, desc, short, commands, menu] = await Promise.all([
    tg(token, 'getMyName').catch(() => null),
    tg(token, 'getMyDescription').catch(() => null),
    tg(token, 'getMyShortDescription').catch(() => null),
    tg(token, 'getMyCommands').catch(() => []),
    tg(token, 'getChatMenuButton').catch(() => null),
  ]);
  let photo = null;
  try {
    const pics = await tg(token, 'getUserProfilePhotos', { user_id: me.id, limit: 1 });
    const biggest = pics.photos?.[0]?.at(-1);
    if (biggest) {
      const file = await tg(token, 'getFile', { file_id: biggest.file_id });
      const { data } = await axios.get(`https://api.telegram.org/file/bot${token}/${file.file_path}`, { responseType: 'arraybuffer', timeout: 15000 });
      const { uploadToCloudinary } = await import('../middlewares/upload.js');
      photo = (await uploadToCloudinary(Buffer.from(data), 'image/jpeg', 'captain-slabbin/bots', publicBase)).url;
    }
  } catch (err) { console.error(`[Telegram] @${me.username} photo:`, err.message); }

  const look = {
    profile: {
      name: name?.name || me.first_name,
      shortDescription: short?.short_description || '',
      description: desc?.description || '',
      ...(commands?.length ? { commands: commands.map(c => ({ command: c.command, description: c.description })) } : {}),
      ...(menu?.type === 'web_app' && menu.text ? { menuButton: menu.text } : {}),
      photo,
    },
  };
  return prisma.botStyle.create({ data: { name: `@${me.username}`, look, source: `@${me.username}` } });
}

// ─── Bot profile photo ───────────────────────────────────────────────────────

// The shop's default bot picture (frontend/public/brand/bot/avatar.jpg)
const DEFAULT_PHOTO = new URL('../../assets/bot-avatar.jpg', import.meta.url);

// setMyProfilePhoto only takes a freshly uploaded JPG (multipart)
export async function setBotPhoto(botId, jpg) {
  const bot = await botOrFail(botId);
  const buffer = jpg || await readFile(DEFAULT_PHOTO);
  const form = new FormData();
  form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://pic' }));
  form.append('pic', new Blob([buffer], { type: 'image/jpeg' }), 'photo.jpg');
  const res = await fetch(`https://api.telegram.org/bot${bot.token}/setMyProfilePhoto`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw fail(`Telegram: ${data.description || res.status}`, 502);
}

