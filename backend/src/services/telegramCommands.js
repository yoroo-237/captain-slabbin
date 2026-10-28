import { prisma } from '../db.js';
import { escapeHtml } from './telegram.service.js';
import { look, activeBot } from './telegramStyle.js';
import { money, shelfArt, image } from './telegramCatalog.js';

// The "commands" layout: a menu-board bot navigated with typed commands, like a
// classic Telegram shop. /start welcomes and points to the menu command; the
// menu lists the shop's terms, then every shelf and page as a command
// (/<prefix>_flower, /about…); a shelf lists 5 products with their rating,
// sales and /p<id> command, with arrows to page and buttons to the neighbouring
// shelves. Products, checkout, wallet and orders are the shop's usual screens.

const PAGE = 5;
const FIRE = 'fire-sale';

// Command names: lowercase letters, digits and _ only
export const cmdName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
export const prefix = () => cmdName(look().prefix) || 'shop';
const shelfCmd = slug => `/${prefix()}_${cmdName(slug)}`.slice(0, 33);
const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

async function visibleShelves() {
  const only = activeBot()?.shelves || [];
  return prisma.category.findMany({
    where: { parentId: null, ...(only.length ? { slug: { in: only } } : {}) },
    orderBy: { position: 'asc' },
    include: { children: { select: { id: true } } },
  });
}

// Shelves holding at least one active product, in menu order
async function shelvesWithStock() {
  const cats = await visibleShelves();
  const counts = await prisma.product.groupBy({ by: ['categoryId'], where: { isActive: true }, _count: true });
  const byId = new Map(counts.map(c => [c.categoryId, c._count]));
  return cats.filter(c => [c.id, ...c.children.map(k => k.id)].some(id => byId.get(id)));
}

// ─── Screens ─────────────────────────────────────────────────────────────────

export function startScreen() {
  const { texts } = look();
  return {
    text: fill(texts.start, { menu: `/${prefix()}` }),
    keyboard: [[{ text: '⇆ Back', callback_data: 'menu' }]],
    image: look().images.start || image('banner', 'banner.jpg'),
  };
}

export async function menuBoard(account = null) {
  const { texts } = look();
  const cats = await shelvesWithStock();
  const fire = await prisma.product.count({ where: { isActive: true, compareAtPrice: { not: null } } });
  const pages = (look().pages || []).filter(p => p.title);
  const block = (label, cmd) => `${escapeHtml(label)}:\n${cmd}`;
  const lines = [
    texts.menuIntro,
    ...(account ? ['', `💰 Wallet  <b>${money(account.balance)}</b>  /wallet`] : []),
    ...(cmdName(look().customOrderCommand) ? ['', block('Custom Order', `/${cmdName(look().customOrderCommand)}`)] : []),
    '',
    block('Previous Orders', '/orders'),
    ...(fire ? ['', block(look().labels.fireSale, shelfCmd(FIRE))] : []),
    ...cats.flatMap(c => ['', block(c.name, shelfCmd(c.slug))]),
    ...pages.flatMap(p => ['', block(p.title, `/${cmdName(p.key)}`)]),
  ];
  return {
    text: lines.join('\n').slice(0, 4000),
    keyboard: account?.rows || [],
    image: look().images.menu || image('banner', 'banner.jpg'),
  };
}

// Approved reviews average and units sold, per product
async function stats(ids) {
  const [rates, sold] = await Promise.all([
    prisma.review.groupBy({ by: ['productId'], where: { productId: { in: ids }, isApproved: true }, _avg: { rating: true } }),
    prisma.orderItem.groupBy({ by: ['productId'], where: { productId: { in: ids }, order: { status: { notIn: ['cancelled', 'refunded'] } } }, _sum: { quantity: true } }),
  ]);
  return {
    rate: new Map(rates.map(r => [r.productId, r._avg.rating])),
    sold: new Map(sold.map(s => [s.productId, s._sum.quantity || 0])),
  };
}

const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const firstImage = p => {
  const img = (p.images || []).find(i => i.mediaType !== 'video');
  return img?.url?.startsWith('http') ? img.url : null;
};

export async function shelfBoard(slug, page = 1) {
  const { texts, labels } = look();
  const cats = await shelvesWithStock();
  const where = { isActive: true };
  let name, art;
  if (slug === FIRE) {
    where.compareAtPrice = { not: null };
    name = labels.fireSale;
    art = shelfArt(FIRE);
  } else {
    const cat = cats.find(c => c.slug === slug);
    if (!cat) return menuBoard();
    where.categoryId = { in: [cat.id, ...cat.children.map(c => c.id)] };
    name = cat.name;
    art = shelfArt(slug, cat.imageUrl);
  }
  const total = await prisma.product.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  page = Math.min(Math.max(1, Number(page) || 1), pages);
  const products = await prisma.product.findMany({
    where, orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * PAGE, take: PAGE,
    include: { images: { orderBy: { position: 'asc' }, take: 1 } },
  });
  const { rate, sold } = await stats(products.map(p => p.id));

  const items = products.map(p => {
    const sub = [p.badge, p.description?.split('\n')[0]].filter(Boolean).join(' | ');
    const r = rate.get(p.id);
    const deal = p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price) ? ` <s>${money(p.compareAtPrice)}</s>` : '';
    return [
      `<b>${escapeHtml(p.name)}</b>`,
      ...(sub ? [`<i>${escapeHtml(short(sub, 44))}</i>`] : []),
      `${money(p.price)}${deal}${p.unitLabel ? ` ${escapeHtml(p.unitLabel)}` : ''}${p.stock <= 0 ? '  ·  sold out' : ''}`,
      `${r ? `${labels.rating}<code>${r.toFixed(1)}</code> ` : ''}(${sold.get(p.id) || 0} <i>purchases</i>)`,
      `/p${p.id}`,
    ].join('\n');
  });

  const go = n => `cat:${slug}:${n}`;
  const nav = [{ text: '⇆ Back', callback_data: 'menu' }];
  if (page > 1) nav.push({ text: '<<', callback_data: go(1) }, { text: '<', callback_data: go(page - 1) });
  if (page < pages) nav.push({ text: '>', callback_data: go(page + 1) }, { text: `${pages} >>`, callback_data: go(pages) });
  else if (pages > 1) nav.push({ text: String(page), callback_data: go(page) });
  // The shelves on either side, to walk the menu without going back
  const i = cats.findIndex(c => c.slug === slug);
  const side = i < 0 ? [] : [cats[i - 1], cats[i + 1]].filter(Boolean);

  return {
    text: [fill(texts.shelfIntro, { shelf: escapeHtml(name.toLowerCase()) }), '', ...(items.length ? [items.join('\n\n')] : ['Nothing here right now.'])].join('\n'),
    keyboard: [nav, side.map(c => ({ text: c.name, callback_data: `cat:${c.slug}:1` }))],
    image: (products[0] && firstImage(products[0])) || art,
  };
}

// ─── Typed commands ──────────────────────────────────────────────────────────

// A typed command as the screen it opens (same codes as the buttons), or null
export async function resolveCommand(cmd) {
  const c = cmd.replace(/^\//, '');
  const pre = prefix();
  if (c === pre) return 'menu';
  if (/^p\d+$/.test(c)) return `p:${c.slice(1)}:1`;
  if (c === 'orders') return 'o';
  if (c === 'wallet') return 'w';
  if (c === cmdName(look().customOrderCommand) || c === `${pre}_create_custom_order`) return 'co';
  const page = (look().pages || []).find(p => cmdName(p.key) === c);
  if (page) return `pg:${page.key}`;
  if (c.startsWith(`${pre}_`)) {
    const rest = c.slice(pre.length + 1);
    if (rest === cmdName(FIRE)) return `cat:${FIRE}:1`;
    const shelf = (await visibleShelves()).find(s => cmdName(s.slug) === rest);
    if (shelf) return `cat:${shelf.slug}:1`;
  }
  return null;
}

// ─── Custom orders ───────────────────────────────────────────────────────────

// After the custom order command, the customer's next message (within 15
// minutes) goes to the shop's inbox as their order request
const waiting = new Map(); // telegram user id → expiry
export function customOrderScreen(from) {
  waiting.set(String(from.id), Date.now() + 15 * 60_000);
  return { text: look().texts.customOrder, keyboard: [[{ text: '⇆ Back', callback_data: 'menu' }]] };
}
export function takesCustomOrder(from) {
  const until = waiting.get(String(from.id));
  waiting.delete(String(from.id));
  return !!until && until > Date.now();
}
