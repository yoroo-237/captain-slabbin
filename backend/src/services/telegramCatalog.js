import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { escapeHtml } from './telegram.service.js';

// The shop's catalog inside Telegram: /start shows the shelves as buttons, a
// shelf lists its products (8 per page), and every screen can go back. In a
// private chat a product opens in the bot (photo, quantity, buy); in a group it
// opens on the site. Screens are edited in place, so the chat doesn't fill up.

const PAGE = 8;
const FIRE = 'fire-sale';

const site = () => (env.frontendUrl || '').replace(/\/$/, '');
const money = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const productLink = p => `${site()}/p/${encodeURIComponent((p.sku || p.slug).toLowerCase())}`;
const shopButton = () => site().startsWith('http') ? [{ text: '🛒 Open the shop', url: site() }] : [];

// Top-level shelves with how many active products each holds (sub-shelves included)
async function shelves() {
  const cats = await prisma.category.findMany({
    where: { parentId: null },
    orderBy: { position: 'asc' },
    include: { children: { select: { id: true } } },
  });
  const counts = await prisma.product.groupBy({ by: ['categoryId'], where: { isActive: true }, _count: true });
  const byId = new Map(counts.map(c => [c.categoryId, c._count]));
  const fire = await prisma.product.count({ where: { isActive: true, compareAtPrice: { not: null } } });
  return {
    fire,
    cats: cats
      .map(c => ({ slug: c.slug, name: c.name, count: [c.id, ...c.children.map(k => k.id)].reduce((s, id) => s + (byId.get(id) || 0), 0) }))
      .filter(c => c.count > 0),
  };
}

// extraRows: the customer's wallet/orders/account buttons in a private chat
export async function menuScreen(extraRows = []) {
  const { fire, cats } = await shelves();
  const rows = [];
  if (fire) rows.push([{ text: `🔥 Fire Sale (${fire})`, callback_data: `cat:${FIRE}:1` }]);
  for (let i = 0; i < cats.length; i += 2) {
    rows.push(cats.slice(i, i + 2).map(c => ({ text: `${c.name} (${c.count})`, callback_data: `cat:${c.slug}:1` })));
  }
  rows.push(...extraRows);
  if (!extraRows.length) rows.push(shopButton());
  return {
    text: cats.length
      ? `🏴‍☠️ <b>Captain Slabbin</b>\nPick a shelf to see what's in stock.${extraRows.length ? ' Buy right here and pay from your wallet.' : ' Tap a product to open it on the site.'}`
      : '🏴‍☠️ <b>Captain Slabbin</b>\nThe shelves are being restocked. Check back soon.',
    keyboard: rows.filter(r => r.length),
  };
}

export async function shelfScreen(slug, page = 1, { inBot = false } = {}) {
  const where = { isActive: true };
  let title;
  if (slug === FIRE) {
    where.compareAtPrice = { not: null };
    title = '🔥 Fire Sale';
  } else {
    const cat = await prisma.category.findUnique({ where: { slug }, include: { children: { select: { id: true } } } });
    if (!cat) return menuScreen();
    where.categoryId = { in: [cat.id, ...cat.children.map(c => c.id)] };
    title = cat.name;
  }
  const total = await prisma.product.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  page = Math.min(Math.max(1, Number(page) || 1), pages);
  const products = await prisma.product.findMany({
    where,
    orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
    skip: (page - 1) * PAGE,
    take: PAGE,
  });

  const lines = products.map(p => {
    const was = p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price) ? ` <s>${money(p.compareAtPrice)}</s>` : '';
    const unit = p.unitLabel ? ` ${escapeHtml(p.unitLabel)}` : '';
    const stock = p.stock <= 0 ? ' · <i>sold out</i>' : p.stock <= 5 ? ` · only ${p.stock} left` : '';
    return `• <b>${escapeHtml(p.name)}</b>: ${money(p.price)}${was}${unit}${stock}`;
  });

  const rows = inBot
    ? products.map(p => [{ text: `${p.name} · ${money(p.price)}`, callback_data: `p:${p.id}:1` }])
    : site().startsWith('http') ? products.map(p => [{ text: `${p.name} · ${money(p.price)}`, url: productLink(p) }]) : [];
  const nav = [];
  if (page > 1) nav.push({ text: '‹ Previous', callback_data: `cat:${slug}:${page - 1}` });
  if (page < pages) nav.push({ text: 'Next ›', callback_data: `cat:${slug}:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: '‹ All shelves', callback_data: 'menu' }, ...shopButton()]);

  return {
    text: [
      `<b>${escapeHtml(title)}</b>${pages > 1 ? `  ·  page ${page}/${pages}` : ''}`,
      '',
      ...(lines.length ? lines : ['Nothing here right now.']),
    ].join('\n'),
    keyboard: rows,
  };
}

// Commands every linked bot gets, whether or not the shop's look is applied
export const COMMANDS = [
  { command: 'start', description: 'Browse the shop' },
  { command: 'deals', description: 'Fire Sale deals' },
  { command: 'wallet', description: 'Balance and add funds' },
  { command: 'orders', description: 'Your orders' },
  { command: 'shop', description: 'Open the storefront' },
];
