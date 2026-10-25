import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { escapeHtml, botUsername } from './telegram.service.js';
import { getUserBalance, getCommissionPct } from './balance.service.js';
import { orderService } from './order.service.js';
import { walletService } from './wallet.service.js';
import { notificationService } from './notification.service.js';
import { art, shelfArt, salePct, RULE } from './telegramCatalog.js';

// Buying inside Telegram, with nothing to type: the customer's account is their
// Telegram identity (opened from the bot after a 21+ confirmation, or an
// existing site account connected with one tap), they pick a product and a
// quantity, and pay from their wallet. Funds are added from the bot too, and
// the bot messages them when a deposit lands or their order ships.

const site = () => (env.frontendUrl || '').replace(/\/$/, '');
const money = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const productLink = p => `${site()}/p/${encodeURIComponent((p.sku || p.slug).toLowerCase())}`;
const hasSite = () => site().startsWith('http');
const MAX_QTY = 99;
const COINS = ['BTC', 'LTC', 'ETH', 'DOGE', 'XMR'];

// Accounts opened from the bot have no password until the customer sets one
export const NO_PASSWORD = '!telegram';

export const findCustomer = from => prisma.user.findUnique({ where: { telegramId: String(from.id) } });

// ─── Accounts ────────────────────────────────────────────────────────────────

// Site usernames: letters, digits, . _ - ; the Telegram @username when free
async function freeUsername(from) {
  const base = String(from.username || '').replace(/[^\w.-]/g, '').slice(0, 24) || `captain${String(from.id).slice(-6)}`;
  for (let i = 0; i < 20; i++) {
    const name = i ? `${base}${Math.floor(Math.random() * 900 + 100)}` : base;
    if (base.length >= 3 && !(await prisma.user.findUnique({ where: { username: name } }))) return name;
  }
  return `captain${crypto.randomBytes(4).toString('hex')}`;
}

// After "I'm 21 or older": the account exists from now on, tied to this Telegram user
export async function openAccount(from) {
  const existing = await findCustomer(from);
  if (existing) return existing;
  const open = await prisma.siteSetting.findUnique({ where: { key: 'registration_open' } });
  if (open?.value === 'false') throw new Error('New accounts are closed right now.');
  const user = await prisma.user.create({
    data: {
      username:       await freeUsername(from),
      passwordHash:   NO_PASSWORD, // signs in from the bot; a password can be set later in My account
      telegramId:     String(from.id),
      telegramHandle: from.username || String(from.id),
    },
  });
  await notificationService.createWelcomeNotifications(user.id).catch(() => {});
  return user;
}

// One-tap sign-in on the site from the bot (10 minutes, single purpose)
export const siteLoginUrl = user => `${site()}/tg-login?t=${jwt.sign({ tgLogin: user.id }, env.jwtSecret, { expiresIn: '10m' })}`;

// "Connect Telegram" on the site: t.me/<bot>?start=link_<token>
export async function connectUrl(userId) {
  const name = await botUsername();
  if (!name) return null;
  const t = jwt.sign({ tgLink: userId }, env.jwtSecret, { expiresIn: '30m' });
  return `https://t.me/${name}?start=link_${t}`;
}

// /start link_<token>: ties this Telegram user to the site account. An account the
// bot opened earlier for the same person is folded away if it was never used.
export async function connectAccount(from, token) {
  let userId;
  try { userId = jwt.verify(token, env.jwtSecret).tgLink; } catch { /* expired */ }
  if (!userId) return { error: 'This link has expired. Tap "Connect Telegram" on the site again.' };
  const tid = String(from.id);
  const other = await prisma.user.findUnique({ where: { telegramId: tid }, include: { _count: { select: { orders: true, deposits: true } } } });
  if (other && other.id !== userId) {
    if (other._count.orders || other._count.deposits) {
      return { error: `This Telegram is already tied to the account ${other.username}, which has orders or deposits. Message the shop to merge them.` };
    }
    await prisma.user.update({ where: { id: other.id }, data: { telegramId: null, isActive: false } });
  }
  const user = await prisma.user.update({ where: { id: userId }, data: { telegramId: tid, telegramHandle: from.username || tid } });
  return { user };
}

// ─── Screens ─────────────────────────────────────────────────────────────────

export function ageScreen() {
  return {
    text: [
      '🏴‍☠️ <b>WELCOME ABOARD</b>',
      '<i>Captain Slabbin · Top shelf. Delivered.</i>',
      '',
      'Browse the shelves, buy and pay right here. Your account is your Telegram: no name, email or password to type.',
      '',
      '🔞 Everything here is for adults <b>21 and over</b>.',
      '',
      'Already have an account on the site? Open <b>Account → Profile</b> there and tap <b>Connect Telegram</b>.',
    ].join('\n'),
    keyboard: [[{ text: '✅ I am 21 or older, let me in', callback_data: 'age' }]],
    image: art('banner.jpg'),
  };
}

// The customer's own buttons under the menu, and their balance for the header
export async function accountRow(user) {
  const { balance } = await getUserBalance(user.id);
  const rows = [[{ text: '💰 Wallet', callback_data: 'w' }, { text: '📦 My orders', callback_data: 'o' }]];
  if (hasSite()) rows.push([{ text: '👤 My account on the site', url: siteLoginUrl(user) }]);
  return { rows, balance };
}

const firstImage = p => {
  const img = (p.images || []).find(i => i.mediaType !== 'video') || null;
  if (!img) return null;
  return img.url.startsWith('http') ? img.url : (env.publicUrl ? `${env.publicUrl.replace(/\/$/, '')}${img.url}` : null);
};

export async function productScreen(id, qty = 1) {
  const p = await prisma.product.findFirst({
    where: { id: Number(id), isActive: true },
    include: { images: { orderBy: { position: 'asc' } }, category: { include: { parent: true } }, brand: true },
  });
  if (!p) return { text: 'This product is no longer available.', keyboard: [[{ text: '‹ All shelves', callback_data: 'menu' }]], image: art('banner.jpg') };
  const max = Math.min(MAX_QTY, Math.max(1, p.stock));
  qty = Math.min(Math.max(1, Number(qty) || 1), max);
  const shelf = p.category?.parent || p.category;
  const pct = salePct(p);
  const stock = p.stock <= 0 ? '✖️ Sold out' : p.stock <= 5 ? `⚠️ Only ${p.stock} left` : '✅ In stock';
  const desc = p.description ? escapeHtml(p.description.length > 700 ? p.description.slice(0, 700) + '…' : p.description) : null;

  const rows = [];
  if (p.stock > 0) {
    rows.push([
      { text: '➖', callback_data: `p:${p.id}:${Math.max(1, qty - 1)}` },
      { text: `QTY ${qty}`, callback_data: `p:${p.id}:${qty}` },
      { text: '➕', callback_data: `p:${p.id}:${Math.min(max, qty + 1)}` },
    ]);
    rows.push([{ text: `🛒 BUY ${qty}  ·  ${money(Number(p.price) * qty)}`, callback_data: `buy:${p.id}:${qty}` }]);
  }
  rows.push([
    { text: `‹ ${shelf ? shelf.name : 'All shelves'}`, callback_data: shelf ? `cat:${shelf.slug}:1` : 'menu' },
    ...(hasSite() ? [{ text: '🌐 On the site', url: productLink(p) }] : []),
  ]);

  const meta = [p.category?.name, p.brand?.name].filter(Boolean).map(escapeHtml).join('  ·  ');
  return {
    text: [
      `<b>${escapeHtml(p.name.toUpperCase())}</b>`,
      ...(meta ? [meta] : []),
      RULE,
      `💵 <b>${money(p.price)}</b>${p.unitLabel ? ` <i>${escapeHtml(p.unitLabel)}</i>` : ''}${pct ? `   <s>${money(p.compareAtPrice)}</s>  🔥 <b>−${pct}%</b>` : ''}`,
      stock,
      ...(desc ? ['', `<blockquote expandable>${desc}</blockquote>`] : []),
    ].join('\n'),
    keyboard: rows,
    image: firstImage(p) || shelfArt(shelf?.slug, shelf?.imageUrl),
  };
}

export async function buyScreen(user, id, qty) {
  const p = await prisma.product.findFirst({ where: { id: Number(id), isActive: true } });
  if (!p) return productScreen(id, qty);
  qty = Math.min(Math.max(1, Number(qty) || 1), Math.max(1, p.stock));
  const total = Number(p.price) * qty;
  const { balance } = await getUserBalance(user.id);
  const enough = balance >= total;
  return {
    text: [
      '🧾 <b>CHECKOUT</b>',
      RULE,
      `${qty} × ${escapeHtml(p.name)}`,
      `<b>Total  ${money(total)}</b>`,
      '',
      '🚚 <b>Delivery</b>: the crew messages you right here after payment to arrange it. For shipping to an address, order on the site.',
      '',
      `💰 Wallet  <b>${money(balance)}</b>`,
      ...(enough ? [] : [`⚠️ <b>${money(total - balance)}</b> missing: add funds, then come back.`]),
    ].join('\n'),
    keyboard: [
      enough
        ? [{ text: `✅ PAY ${money(total)} FROM MY WALLET`, callback_data: `pay:${p.id}:${qty}` }]
        : [{ text: '➕ Add funds', callback_data: 'w' }],
      [{ text: '‹ Back', callback_data: `p:${p.id}:${qty}` }],
    ],
  };
}

// One payment at a time per customer: a double tap never makes two orders
const paying = new Set();

export async function payScreen(user, id, qty) {
  if (paying.has(user.id)) return null;
  paying.add(user.id);
  try {
    const { order, payments, newBalance } = await orderService.createOrder(user.id, {
      items: [{ productId: Number(id), quantity: Number(qty) }],
      paymentMethod: 'wallet',
    });
    return {
      text: [
        '✅ <b>PAID</b>',
        `Order <code>${escapeHtml(order.orderNumber)}</code>`,
        RULE,
        ...order.items.map(i => `${i.quantity} × ${escapeHtml(i.name)}  ·  ${money(Number(i.price) * i.quantity)}`),
        `<b>Total  ${money(order.totalAmount)}</b>`,
        `<i>Paid ${payments.map(p => `${p.amount} ${p.currency}`).join(' + ')}</i>`,
        '',
        '🏴‍☠️ The crew has your invoice and will message you here to arrange delivery.',
        `💰 Wallet  <b>${money(newBalance)}</b>`,
      ].join('\n'),
      keyboard: [[{ text: '📦 My orders', callback_data: 'o' }, { text: '🛒 Keep shopping', callback_data: 'menu' }]],
    };
  } catch (err) {
    return {
      text: `⚠️ <b>NOT PAID</b>\n${escapeHtml(err.message || 'The payment did not go through.')}`,
      keyboard: [[{ text: '‹ Back', callback_data: `buy:${id}:${qty}` }]],
    };
  } finally {
    paying.delete(user.id);
  }
}

const COIN_ICON = { BTC: '🟠', LTC: '🔵', ETH: '🟣', DOGE: '🟡', XMR: '🟤' };

export async function walletScreen(user) {
  const { balance, holdings } = await getUserBalance(user.id);
  const lines = (holdings || []).filter(h => Number(h.amount) > 0)
    .map(h => `${COIN_ICON[h.currency] || '•'} ${h.amount} ${h.currency}  ·  ${money(h.usd || 0)}`);
  return {
    text: [
      '💰 <b>WALLET</b>',
      RULE,
      `Balance  <b>${money(balance)}</b>`,
      ...lines,
      '',
      'Add funds in the coin you like. Your balance updates by itself, and I message you here the moment it lands.',
    ].join('\n'),
    keyboard: [
      COINS.slice(0, 3).map(c => ({ text: `${COIN_ICON[c]} ${c}`, callback_data: `dep:${c}` })),
      COINS.slice(3).map(c => ({ text: `${COIN_ICON[c]} ${c}`, callback_data: `dep:${c}` })),
      [{ text: '📦 My orders', callback_data: 'o' }, { text: '‹ Shop', callback_data: 'menu' }],
    ],
    image: art('wallet.jpg'),
  };
}

export async function depositScreen(user, currency) {
  if (!COINS.includes(currency)) return walletScreen(user);
  try {
    const dep = await walletService.createDeposit(user.id, currency);
    const [min, pct] = await Promise.all([
      prisma.siteSetting.findUnique({ where: { key: 'min_deposit' } }),
      getCommissionPct(),
    ]);
    const hours = Math.max(1, Math.round((new Date(dep.expiresAt) - Date.now()) / 3600000));
    return {
      text: [
        `${COIN_ICON[currency]} <b>ADD FUNDS · ${currency}</b>`,
        RULE,
        `Send ${currency} to this address (tap it to copy):`,
        '',
        `<code>${escapeHtml(dep.address)}</code>`,
        '',
        ...(min?.value ? [`▸ Minimum ${money(min.value)}`] : []),
        ...(Number(pct) > 0 ? [`▸ ${pct}% network & service fee taken from the deposit`] : []),
        `▸ Valid for ${hours} hours`,
        currency === 'XMR' ? '▸ Checked by hand, usually within a few hours' : '▸ Credited automatically after network confirmation',
        '',
        'I message you here as soon as it is credited.',
      ].join('\n'),
      keyboard: [[{ text: '‹ Wallet', callback_data: 'w' }]],
    };
  } catch (err) {
    return { text: `⚠️ ${escapeHtml(err.message)}`, keyboard: [[{ text: '‹ Wallet', callback_data: 'w' }]] };
  }
}

const STATUS = { processing: '⏳ Processing', shipped: '🚚 Shipped', delivered: '✅ Delivered', cancelled: '✖️ Cancelled', refunded: '↩️ Refunded' };

export async function ordersScreen(user) {
  const orders = await prisma.order.findMany({ where: { userId: user.id }, orderBy: { placedAt: 'desc' }, take: 5, include: { items: true } });
  return {
    text: [
      '📦 <b>YOUR ORDERS</b>',
      RULE,
      ...(orders.length
        ? [orders.map(o => [
            `<b>${escapeHtml(o.orderNumber)}</b>  ·  ${money(o.totalAmount)}`,
            STATUS[o.status] || escapeHtml(o.status),
            `<i>${o.items.map(i => `${i.quantity} × ${escapeHtml(i.name)}`).join(', ')}</i>`,
            ...(o.trackingNumber ? [`Tracking <code>${escapeHtml(o.trackingNumber)}</code>${o.carrier ? ` · ${escapeHtml(o.carrier)}` : ''}`] : []),
          ].join('\n')).join('\n\n')]
        : ['No orders yet. Pick a shelf and buy in two taps.']),
    ].join('\n'),
    keyboard: [[{ text: '💰 Wallet', callback_data: 'w' }, { text: '‹ Shop', callback_data: 'menu' }]],
    image: art('orders.jpg'),
  };
}
