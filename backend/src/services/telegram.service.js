import axios from 'axios';
import { prisma } from '../db.js';
import { env } from '../config/env.js';

// Posts shop notifications (Telegram invoices, wallet orders, new customer
// messages) to the shop's Telegram chat through a bot. The bot token lives in
// the environment; the chat id can be changed from Admin → Settings → Telegram
// (setting `telegram_chat_id`), falling back to TELEGRAM_CHAT_ID.
// Every call is best-effort: a Telegram outage must never block an order.

async function getChatId() {
  const row = await prisma.siteSetting.findUnique({ where: { key: 'telegram_chat_id' } });
  return row?.value?.trim() || env.telegram.chatId;
}

export function isTelegramConfigured() {
  return !!env.telegram.botToken;
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

export async function sendTelegram(html) {
  if (!isTelegramConfigured()) return { delivered: false, reason: 'TELEGRAM_BOT_TOKEN not set' };
  const chatId = await getChatId();
  if (!chatId) return { delivered: false, reason: 'Telegram chat id not set' };
  try {
    await axios.post(
      `https://api.telegram.org/bot${env.telegram.botToken}/sendMessage`,
      { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true },
      { timeout: 8000 }
    );
    return { delivered: true };
  } catch (err) {
    const reason = err.response?.data?.description || err.message;
    console.error('[Telegram] sendMessage failed:', reason);
    return { delivered: false, reason };
  }
}

const money = n => `$${Number(n).toFixed(2)}`;

// Plain-text invoice the customer can copy, and the HTML version posted to the shop.
export function buildInvoice({ code, items, subtotal, shippingFee, total, customer, telegram, contact, note }) {
  const lines = items.map(i => `• ${i.quantity} × ${i.name}${i.sku ? ` [${i.sku}]` : ''} — ${money(i.price * i.quantity)}`);
  const text = [
    `ORDER ${code}`,
    ...lines,
    `Subtotal: ${money(subtotal)}`,
    `Shipping: ${Number(shippingFee) > 0 ? money(shippingFee) : 'Free'}`,
    `Total: ${money(total)}`,
    customer ? `Account: ${customer}` : 'Guest (no account)',
    telegram ? `Telegram: ${telegram}` : null,
    contact ? `Contact: ${contact}` : null,
    note ? `Note: ${note}` : null,
  ].filter(Boolean).join('\n');

  const html = [
    `🧾 <b>New Telegram order ${escapeHtml(code)}</b>`,
    ...lines.map(escapeHtml),
    `Subtotal: ${money(subtotal)} · Shipping: ${Number(shippingFee) > 0 ? money(shippingFee) : 'Free'}`,
    `<b>Total: ${money(total)}</b>`,
    customer ? `👤 Account: <b>${escapeHtml(customer)}</b>` : '👤 Guest (no account)',
    telegram ? `✈️ Telegram: ${escapeHtml(telegram)}` : '✈️ Telegram: not provided',
    contact ? `📞 Contact: ${escapeHtml(contact)}` : null,
    note ? `📝 ${escapeHtml(note)}` : null,
  ].filter(Boolean).join('\n');

  return { text, html };
}

export async function notifyWalletOrder(order, user, payments) {
  const telegram = formatTelegramContact(user.telegramHandle);
  const paid = (payments || []).map(p => `${p.amount} ${p.currency}`).join(' + ') || 'wallet';
  const items = (order.items || []).map(i => `• ${i.quantity} × ${escapeHtml(i.name)} — ${money(Number(i.price) * i.quantity)}`);
  return sendTelegram([
    `✅ <b>Paid order ${escapeHtml(order.orderNumber)}</b> (wallet)`,
    ...items,
    `<b>Total: ${money(order.totalAmount)}</b> · paid ${escapeHtml(paid)}`,
    `👤 ${escapeHtml(user.username)}`,
    telegram ? `✈️ Telegram: ${escapeHtml(telegram)}` : '✈️ Telegram: not on profile',
    `📦 ${escapeHtml(order.name)} — ${escapeHtml(order.shippingAddress)}`,
  ].join('\n'));
}

export async function notifyNewMessage(user, body) {
  const telegram = formatTelegramContact(user.telegramHandle);
  const preview = body.length > 400 ? body.slice(0, 400) + '…' : body;
  return sendTelegram([
    `💬 <b>New message from ${escapeHtml(user.username)}</b>`,
    telegram ? `✈️ ${escapeHtml(telegram)}` : null,
    escapeHtml(preview),
  ].filter(Boolean).join('\n'));
}
