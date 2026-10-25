import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { escapeHtml } from './telegram.service.js';

// The shop's catalog inside Telegram: /start shows the shelves as buttons, a
// shelf lists its products (8 per page), and every screen can go back. In a
// private chat a product opens in the bot (photo, quantity, buy); in a group it
// opens on the site. Screens are edited in place, so the chat doesn't fill up.
//
// Look: the site's art direction carried over. Each screen opens on an image
// from the site (the shop banner, the shelf's own banner, the product photo),
// titles are in capitals like the site's Anton headings, and prices lead.

const PAGE = 8;
const FIRE = 'fire-sale';

const site = () => (env.frontendUrl || '').replace(/\/$/, '');
export const money = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const productLink = p => `${site()}/p/${encodeURIComponent((p.sku || p.slug).toLowerCase())}`;
const shopButton = () => site().startsWith('http') ? [{ text: '🌐 Open the shop', url: site() }] : [];

// Images served by the storefront (frontend/public/brand/bot). Telegram shows
// them above the text; without an https site there is simply no image.
export const art = file => site().startsWith('https://') ? `${site()}/brand/bot/${file}` : null;
const SHELF_ART = {
  flower: 'cat-flower', concentrates: 'cat-concentrates', moonrocks: 'cat-moonrocks',
  disposables: 'cat-disposables', prerolls: 'cat-prerolls', edibles: 'cat-edibles',
  mush: 'cat-shrooms', [FIRE]: 'cat-captains-chest',
};
// A shelf's banner: the one uploaded in Admin → Categories, else the original art
export const shelfArt = (slug, imageUrl) =>
  (imageUrl?.startsWith('http') && imageUrl) || (SHELF_ART[slug] ? art(`cats/${SHELF_ART[slug]}.jpg`) : null) || art('banner.jpg');

export const RULE = '━━━━━━━━━━━━━━━━';
const unit = p => p.unitLabel ? ` <i>${escapeHtml(p.unitLabel)}</i>` : '';
export const salePct = p => p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price)
  ? Math.round((1 - Number(p.price) / Number(p.compareAtPrice)) * 100) : 0;

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

// account: { rows, balance } for a customer in a private chat
export async function menuScreen(account = null) {
  const { fire, cats } = await shelves();
  const rows = [];
  if (fire) rows.push([{ text: `🔥 FIRE SALE · ${fire} deals`, callback_data: `cat:${FIRE}:1` }]);
  for (let i = 0; i < cats.length; i += 2) {
    rows.push(cats.slice(i, i + 2).map(c => ({ text: `${c.name.toUpperCase()} · ${c.count}`, callback_data: `cat:${c.slug}:1` })));
  }
  rows.push(...(account?.rows || []));
  if (!account) rows.push(shopButton());
  return {
    text: [
      '🏴‍☠️ <b>CAPTAIN SLABBIN</b>',
      '<i>Top shelf. Delivered.</i>',
      '',
      cats.length
        ? (account ? 'Pick a shelf. You pay from your wallet in one tap and the crew takes it from there.' : 'Pick a shelf. Products open on the site, where you pay with crypto in one tap.')
        : 'The shelves are being restocked. Check back soon.',
      ...(account ? ['', `💰 Wallet  <b>${money(account.balance)}</b>`] : []),
    ].join('\n'),
    keyboard: rows.filter(r => r.length),
    image: art('banner.jpg'),
  };
}

export async function shelfScreen(slug, page = 1, { inBot = false } = {}) {
  const where = { isActive: true };
  let title, image;
  if (slug === FIRE) {
    where.compareAtPrice = { not: null };
    title = '🔥 FIRE SALE';
    image = shelfArt(FIRE);
  } else {
    const cat = await prisma.category.findUnique({ where: { slug }, include: { children: { select: { id: true } } } });
    if (!cat) return menuScreen();
    where.categoryId = { in: [cat.id, ...cat.children.map(c => c.id)] };
    title = cat.name.toUpperCase();
    image = shelfArt(slug, cat.imageUrl);
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
    const pct = salePct(p);
    const deal = pct ? `  <s>${money(p.compareAtPrice)}</s>  🔥 −${pct}%` : '';
    const stock = p.stock <= 0 ? '  ·  <i>sold out</i>' : p.stock <= 5 ? `  ·  only ${p.stock} left` : '';
    return `▸ <b>${escapeHtml(p.name)}</b>\n    ${money(p.price)}${unit(p)}${deal}${stock}`;
  });

  const label = p => `${p.stock <= 0 ? '✖️ ' : ''}${p.name}  ·  ${money(p.price)}`;
  const rows = inBot
    ? products.map(p => [{ text: label(p), callback_data: `p:${p.id}:1` }])
    : site().startsWith('http') ? products.map(p => [{ text: label(p), url: productLink(p) }]) : [];
  const nav = [];
  if (page > 1) nav.push({ text: '‹ Previous', callback_data: `cat:${slug}:${page - 1}` });
  if (pages > 1) nav.push({ text: `${page} / ${pages}`, callback_data: `cat:${slug}:${page}` });
  if (page < pages) nav.push({ text: 'Next ›', callback_data: `cat:${slug}:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: '‹ All shelves', callback_data: 'menu' }, ...(inBot ? [] : shopButton())]);

  return {
    text: [
      `<b>${escapeHtml(title)}</b>  ·  ${total} in stock`,
      RULE,
      ...(lines.length ? lines : ['Nothing here right now.']),
      ...(inBot && lines.length ? ['', 'Tap a product to see it and buy.'] : []),
    ].join('\n'),
    keyboard: rows,
    image,
  };
}

// Commands every linked bot gets, whether or not the shop's look is applied
export const COMMANDS = [
  { command: 'start', description: 'Browse the shelves' },
  { command: 'deals', description: 'Fire Sale deals' },
  { command: 'wallet', description: 'Balance and add funds' },
  { command: 'orders', description: 'Your orders and tracking' },
  { command: 'shop', description: 'Open the website' },
];
