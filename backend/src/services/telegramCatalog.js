import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { escapeHtml } from './telegram.service.js';
import { look, activeBot, title, isShop, catalog, siteLinks, COMMANDS } from './telegramStyle.js';
import { menuBoard, shelfBoard, startScreen } from './telegramCommands.js';

// The shop's catalog inside Telegram: /start shows the shelves as buttons, a
// shelf lists its products (8 per page), and every screen can go back. In a
// private chat a product opens in the bot (photo, quantity, buy); in a group it
// opens on the site. Screens are edited in place, so the chat doesn't fill up.
//
// Look: the answering bot's style (services/telegramStyle.js), by default the
// site's art direction carried over. Each screen opens on an image (the shop
// banner, the shelf's own banner, the product photo), titles are in capitals
// like the site's Anton headings, and prices lead.

const PAGE = 8;
const FIRE = 'fire-sale';

const site = () => (env.frontendUrl || '').replace(/\/$/, '');
export const money = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const productLink = p => `${site()}/p/${encodeURIComponent((p.sku || p.slug).toLowerCase())}`;
const shopButton = () => site().startsWith('http') && siteLinks() ? [{ text: look().labels.openShop, url: site() }] : [];

// Images served by the storefront (frontend/public/brand/bot). Telegram shows
// them above the text; without an https site there is simply no image.
export const art = file => site().startsWith('https://') ? `${site()}/brand/bot/${file}` : null;
// A screen's image: the style's own, else the shop's art
// (another brand's style falls back to its own banner, never to the shop's pictures)
export const image = (key, file) => look().images[key] || (isShop() ? art(file) : look().images.banner || look().images.start || null);
const SHELF_ART = {
  flower: 'cat-flower', concentrates: 'cat-concentrates', moonrocks: 'cat-moonrocks',
  disposables: 'cat-disposables', prerolls: 'cat-prerolls', edibles: 'cat-edibles',
  mush: 'cat-shrooms', [FIRE]: 'cat-captains-chest',
};
// A shelf's banner: the style's, the one uploaded in Admin → Categories, else the original art
export const shelfArt = (slug, imageUrl) => look().images.shelves?.[slug]
  || (imageUrl?.startsWith('http') && imageUrl) || (isShop() && SHELF_ART[slug] ? art(`cats/${SHELF_ART[slug]}.jpg`) : null) || image('banner', 'banner.jpg');

export const rule = () => look().rule;
const unit = p => p.unitLabel ? ` <i>${escapeHtml(p.unitLabel)}</i>` : '';
export const salePct = p => p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price)
  ? Math.round((1 - Number(p.price) / Number(p.compareAtPrice)) * 100) : 0;

// Top-level shelves this bot shows (all, or the ones picked in Admin → Telegram)
async function visibleShelves() {
  const only = activeBot()?.shelves || [];
  return prisma.category.findMany({
    where: { parentId: null, source: catalog(), ...(only.length ? { slug: { in: only } } : {}) },
    orderBy: { position: 'asc' },
    include: { children: { select: { id: true } } },
  });
}
const idsOf = cats => cats.flatMap(c => [c.id, ...c.children.map(k => k.id)]);
const restricted = () => (activeBot()?.shelves || []).length > 0;

// Visible shelves with how many active products each holds (sub-shelves included)
async function shelves() {
  const cats = await visibleShelves();
  const counts = await prisma.product.groupBy({ by: ['categoryId'], where: { isActive: true, source: catalog() }, _count: true });
  const byId = new Map(counts.map(c => [c.categoryId, c._count]));
  const fire = await prisma.product.count({
    where: { isActive: true, source: catalog(), compareAtPrice: { not: null }, ...(restricted() ? { categoryId: { in: idsOf(cats) } } : {}) },
  });
  return {
    fire,
    cats: cats
      .map(c => ({ slug: c.slug, name: c.name, count: [c.id, ...c.children.map(k => k.id)].reduce((s, id) => s + (byId.get(id) || 0), 0) }))
      .filter(c => c.count > 0),
  };
}

// account: { rows, balance } for a customer in a private chat
export async function menuScreen(account = null) {
  if (look().layout === 'commands') return menuBoard(account);
  const { texts, labels } = look();
  const { fire, cats } = await shelves();
  const rows = [];
  if (fire) rows.push([{ text: `${labels.fireSale} · ${fire} deals`, callback_data: `cat:${FIRE}:1` }]);
  for (let i = 0; i < cats.length; i += 2) {
    rows.push(cats.slice(i, i + 2).map(c => ({ text: `${title(c.name)} · ${c.count}`, callback_data: `cat:${c.slug}:1` })));
  }
  rows.push(...(account?.rows || []));
  if (!account) rows.push(shopButton());
  return {
    text: [
      texts.header,
      '',
      cats.length ? (account ? texts.menuIntro : texts.menuIntroGuest) : texts.restocking,
      ...(account ? ['', `💰 Wallet  <b>${money(account.balance)}</b>`] : []),
    ].join('\n'),
    keyboard: rows.filter(r => r.length),
    image: image('banner', 'banner.jpg'),
  };
}

export async function shelfScreen(slug, page = 1, { inBot = false, account = null } = {}) {
  if (look().layout === 'commands') return shelfBoard(slug, page);
  const { labels } = look();
  const where = { isActive: true, source: catalog() };
  let heading, img;
  if (slug === FIRE) {
    where.compareAtPrice = { not: null };
    if (restricted()) where.categoryId = { in: idsOf(await visibleShelves()) };
    heading = labels.fireSale;
    img = shelfArt(FIRE);
  } else {
    const cat = (await visibleShelves()).find(c => c.slug === slug);
    if (!cat) return menuScreen(account);
    where.categoryId = { in: [cat.id, ...cat.children.map(c => c.id)] };
    heading = title(cat.name);
    img = shelfArt(slug, cat.imageUrl);
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
    : site().startsWith('http') && siteLinks() ? products.map(p => [{ text: label(p), url: productLink(p) }]) : [];
  const nav = [];
  if (page > 1) nav.push({ text: '‹ Previous', callback_data: `cat:${slug}:${page - 1}` });
  if (pages > 1) nav.push({ text: `${page} / ${pages}`, callback_data: `cat:${slug}:${page}` });
  if (page < pages) nav.push({ text: 'Next ›', callback_data: `cat:${slug}:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: labels.allShelves, callback_data: 'menu' }, ...(inBot ? [] : shopButton())]);

  return {
    text: [
      `<b>${escapeHtml(heading)}</b>  ·  ${total} in stock`,
      rule(),
      ...(lines.length ? lines : ['Nothing here right now.']),
      ...(inBot && lines.length ? ['', 'Tap a product to see it and buy.'] : []),
    ].join('\n'),
    keyboard: rows,
    image: img,
  };
}

// ─── Custom pages ────────────────────────────────────────────────────────────

// A style's own screen (written in admin or copied from another bot). Each
// button either opens another page or one of the shop's screens.
export const ACTION_DATA = { menu: 'menu', deals: `cat:${FIRE}:1`, wallet: 'w', orders: 'o' };
function pageButton(b) {
  const a = String(b.action || 'menu');
  if (a.startsWith('url:')) return /^https?:\/\//.test(a.slice(4)) ? { text: b.text, url: a.slice(4) } : null;
  if (a === 'site') return site().startsWith('http') && siteLinks() ? { text: b.text, url: site() } : null;
  if (a.startsWith('page:')) return { text: b.text, callback_data: `pg:${a.slice(5)}`.slice(0, 64) };
  if (a.startsWith('cat:')) return { text: b.text, callback_data: `cat:${a.slice(4)}:1`.slice(0, 64) };
  return { text: b.text, callback_data: ACTION_DATA[a] || 'menu' };
}

// null when the style has no page by that key
export function pageScreen(key) {
  const page = (look().pages || []).find(p => p.key === key);
  if (!page) return null;
  return {
    text: page.html || look().texts.header,
    keyboard: (page.buttons || []).map(row => row.map(pageButton).filter(Boolean)),
    image: page.image || null,
  };
}

// /start: the style's home page when it has one, else the welcome (commands
// layout) or the shelves
export const homeScreen = account => (look().home && pageScreen(look().home))
  || (look().layout === 'commands' ? startScreen() : menuScreen(account));

// Commands every linked bot gets unless its style lists its own
export { COMMANDS };
