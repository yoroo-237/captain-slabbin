import { prisma } from '../db.js';
import { escapeHtml } from './telegram.service.js';
import { look, activeBot, catalog } from './telegramStyle.js';
import { money, shelfArt, image } from './telegramCatalog.js';
import { getUserBalance } from './balance.service.js';
import { orderService } from './order.service.js';
import { priceCart } from './pricing.service.js';
import { checkVoucher, voucherLabel } from './voucher.service.js';

// The "commands" layout: a menu-board bot navigated with typed commands, like a
// classic Telegram shop (modelled on the bots it was copied from).
//   /start      welcome, pointing to the menu command
//   /<prefix>   the menu board: the shop's terms, then every shelf and page as a command
//   a shelf     its sub-shelves, or 5 products a page with rating, sales and /p<id>
//   a product   rating out of 10, sales, its priced packs as buttons that fill the
//               cart, product notes, reviews, previous / next product of the shelf
//   /cart       the cart (with the style's minimum order), then checkout like the
//               original: voucher code, recipient name, street, full shipping
//               details (PGP encrypted or plain), a summary, paid from the wallet
// Browsing needs no account; the cart, the wallet and orders ask for 21+ first.

const PAGE = 5;
const FIRE = 'fire-sale';
const MAX_QTY = 99;

// Command names: lowercase letters, digits and _ only
export const cmdName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
export const prefix = () => cmdName(look().prefix) || 'shop';
// A shelf of another catalog is stored as "<source>-<name>" (so it never clashes with the shop's own); its command is the name
export const shortSlug = cat => cat.source && cat.slug.startsWith(`${cat.source}-`) ? cat.slug.slice(cat.source.length + 1) : cat.slug;
const shelfCmd = cat => `/${prefix()}_${cmdName(typeof cat === 'string' ? cat : shortSlug(cat))}`.slice(0, 33);
const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
// The style's shop username ({handle} in texts and product descriptions), else the bot's own
export const handle = () => {
  const h = String(look().texts.handle || activeBot()?.username || '').trim().replace(/^@/, '');
  return h ? `@${escapeHtml(h)}` : '';
};
const withHandle = s => fill(s, { handle: handle() });
const back = (callback_data, text = look().labels.back) => ({ text, callback_data });

// "$7²⁵": the price as the buttons show it
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export const priceTag = v => {
  const cents = Math.round(Number(v) * 100);
  return `$${Math.floor(cents / 100)}${String(cents % 100).padStart(2, '0').replace(/\d/g, d => SUP[d])}`;
};
// Ratings are stored out of 5 and shown out of 10, as suns (half sun from .5)
const out10 = r => { const v = Math.round(r * 20) / 10; return Number.isInteger(v) ? String(v) : v.toFixed(1); };
const suns = r => {
  const n = r; const full = Math.floor(n); const half = n - full >= 0.5 ? 1 : 0;
  return '☀️'.repeat(full) + (half ? '🌤' : '') + '☁️'.repeat(5 - full - half);
};
const short = (s, n) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);
const firstImage = p => {
  const img = (p.images || []).find(i => i.mediaType !== 'video');
  return img?.url?.startsWith('http') ? img.url : null;
};
const optionsOf = p => Array.isArray(p.options) && p.options.length ? p.options : [{ label: '1x', price: Number(p.price) }];

// ─── Shelves ─────────────────────────────────────────────────────────────────

// Every shelf of the bot's catalog (sub-shelves included); a bot limited to some
// shelves keeps those and their sub-shelves
async function allShelves() {
  const only = activeBot()?.shelves || [];
  const cats = await prisma.category.findMany({
    where: { source: catalog() },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    include: { children: { orderBy: [{ position: 'asc' }, { id: 'asc' }] }, parent: true },
  });
  if (!only.length) return cats;
  return cats.filter(c => only.includes(c.slug) || only.includes(c.parent?.slug));
}
const topShelves = cats => cats.filter(c => !c.parentId);

// ─── Screens ─────────────────────────────────────────────────────────────────

export function startScreen() {
  return {
    text: fill(look().texts.start, { menu: `/${prefix()}` }),
    keyboard: [[back('menu')]],
    image: look().images.start || image('banner', 'banner.jpg'),
  };
}

export async function menuBoard() {
  const { texts, labels } = look();
  const cats = topShelves(await allShelves());
  const fire = await prisma.product.count({ where: { isActive: true, source: catalog(), compareAtPrice: { not: null } } });
  const pages = (look().pages || []).filter(p => p.title);
  const block = (label, cmd) => `<b>${escapeHtml(label)}:</b>\n<b>${cmd}</b>`;
  const custom = cmdName(look().customOrderCommand);
  const lines = [
    texts.menuIntro,
    ...(custom ? ['', block('Custom Order', `/${custom}`)] : []),
    '', block('Previous Orders', '/orders'),
    '', block('Your Cart', '/cart'),
    '', block('Wallet', '/wallet'),
    ...(fire ? ['', block(labels.fireSale, shelfCmd(FIRE))] : []),
    ...cats.flatMap(c => ['', block(c.name, shelfCmd(c))]),
    ...pages.flatMap(p => ['', block(p.title, `/${cmdName(p.key)}`)]),
  ];
  return {
    text: lines.join('\n').slice(0, 4000),
    keyboard: [[back('home')]],
    image: look().images.menu || image('banner', 'banner.jpg'),
  };
}

// Approved reviews (average out of 5, count) and units sold, per product
async function stats(ids) {
  const [rates, sold] = await Promise.all([
    prisma.review.groupBy({ by: ['productId'], where: { productId: { in: ids }, isApproved: true }, _avg: { rating: true }, _count: true }),
    prisma.orderItem.groupBy({ by: ['productId'], where: { productId: { in: ids }, order: { status: { notIn: ['cancelled', 'refunded'] } } }, _sum: { quantity: true } }),
  ]);
  return {
    rate: new Map(rates.map(r => [r.productId, { avg: r._avg.rating, count: r._count }])),
    sold: new Map(sold.map(s => [s.productId, s._sum.quantity || 0])),
  };
}

// Products of a shelf in alphabetical order, as the menu-board bots list them
const shelfOrder = [{ isFeatured: 'desc' }, { name: 'asc' }];

export async function shelfBoard(slug, page = 1) {
  const { texts, labels } = look();
  const cats = await allShelves();
  const where = { isActive: true, source: catalog() };
  let cat = null, art;
  if (slug === FIRE) {
    where.compareAtPrice = { not: null };
    art = shelfArt(FIRE);
  } else {
    cat = cats.find(c => c.slug === slug);
    if (!cat) return menuBoard();
    art = shelfArt(slug, cat.imageUrl);
  }
  const up = cat?.parentId ? `cat:${cat.parent.slug}:1` : 'menu';

  // A shelf made of sub-shelves lists them, under its name
  if (cat?.children.length) {
    return {
      // titled by the shelf's own code, like the original (flower_types -> FLOWER TYPES)
      text: [`<b><u>${escapeHtml(shortSlug(cat).replace(/_/g, ' ').toUpperCase())}:</u></b>`, '', cat.children.map(k => `<b>${escapeHtml(k.name)}</b>\n${shelfCmd(k)}`).join('\n\n')].join('\n'),
      keyboard: [[back(up)]],
      image: look().listImages ? art : null,
    };
  }
  if (cat) where.categoryId = cat.id;

  const total = await prisma.product.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  page = Math.min(Math.max(1, Number(page) || 1), pages);
  const products = await prisma.product.findMany({
    where, orderBy: shelfOrder, skip: (page - 1) * PAGE, take: PAGE,
    include: { images: { orderBy: { position: 'asc' }, take: 1 } },
  });
  const { rate, sold } = await stats(products.map(p => p.id));

  const items = products.map(p => {
    const sub = p.description?.split('\n').map(l => l.trim()).find(Boolean)?.replace(/\{handle\}/g, handle().replace(/&amp;/g, '&'));
    const r = rate.get(p.id);
    return [
      `<b>${escapeHtml(p.name)}</b>`,
      ...(sub && sub !== p.name ? [`<i>${escapeHtml(short(sub, 40))}</i>`] : []),
      ...(look().listPrices ? [`${money(p.price)}${p.unitLabel ? ` ${escapeHtml(p.unitLabel)}` : ''}${p.stock <= 0 ? '  ·  sold out' : ''}`] : []),
      `${r ? `${labels.rating}<code>${out10(r.avg)}</code> ` : ''}(<code>${sold.get(p.id) || 0}</code> <i>purchases</i>)`,
      `/p${p.id}`,
    ].join('\n');
  });

  // Paging like the original: ⇇ Back · > · N >>, then ⇇ · << · < · page · > · N >>
  const go = n => `cat:${slug}:${n}`;
  const nav = [];
  if (pages === 1) nav.push(back(up));
  else if (page === 1) nav.push(back(up), { text: '>', callback_data: go(2) }, { text: `${pages} >>`, callback_data: go(pages) });
  else {
    nav.push(back(up, '⇇'), { text: '<<', callback_data: go(1) }, { text: '<', callback_data: go(page - 1) }, { text: String(page), callback_data: go(page) });
    if (page < pages) nav.push({ text: '>', callback_data: go(page + 1) }, { text: `${pages} >>`, callback_data: go(pages) });
  }
  const rows = [nav];
  // The shelves on either side (styles that want them)
  if (look().shelfNeighbors && cat) {
    const level = cats.filter(c => c.parentId === cat.parentId);
    const i = level.findIndex(c => c.id === cat.id);
    const side = [level[i - 1], level[i + 1]].filter(Boolean);
    if (side.length) rows.push(side.map(c => ({ text: c.name, callback_data: `cat:${c.slug}:1` })));
  }

  return {
    text: [fill(texts.shelfIntro, { shelf: escapeHtml((cat?.name || labels.fireSale).toLowerCase()), slug: escapeHtml(cat ? shortSlug(cat) : FIRE) }), '', ...(items.length ? [items.join('\n\n')] : ['Nothing here right now.'])].join('\n'),
    keyboard: rows,
    image: look().listImages ? (products[0] && firstImage(products[0])) || art : null,
  };
}

// ─── Cart ────────────────────────────────────────────────────────────────────

const cartOf = user => (Array.isArray(user?.telegramCart) ? user.telegramCart : []);
const saveCart = (user, items) => prisma.user.update({ where: { id: user.id }, data: { telegramCart: items } }).then(u => { user.telegramCart = u.telegramCart; });

// ─── Product ─────────────────────────────────────────────────────────────────

export async function productBoard(user, id) {
  const { texts, labels } = look();
  const p = await prisma.product.findFirst({
    where: { id: Number(id), isActive: true, source: catalog() },
    include: { images: { orderBy: { position: 'asc' } }, category: { include: { parent: true } } },
  });
  if (!p) return { text: 'This product is no longer available.', keyboard: [[back('menu')]] };
  const opts = optionsOf(p);
  const { rate, sold } = await stats([p.id]);
  const r = rate.get(p.id);
  const mine = cartOf(user).filter(i => i.productId === p.id);
  const inCart = mine.reduce((s, i) => s + Number(opts[i.option]?.price || 0) * i.qty, 0);

  // Previous / next product of the same shelf, in the shelf's order
  const ids = p.categoryId
    ? (await prisma.product.findMany({ where: { categoryId: p.categoryId, isActive: true, source: catalog() }, orderBy: shelfOrder, select: { id: true } })).map(x => x.id)
    : [];
  const at = ids.indexOf(p.id);
  const nav = [back(p.category ? `cat:${p.category.slug}:${Math.floor(Math.max(0, at) / PAGE) + 1}` : 'menu')];
  if (at > 0) nav.push({ text: labels.previous, callback_data: `p:${ids[at - 1]}` });
  if (at >= 0 && at < ids.length - 1) nav.push({ text: labels.next, callback_data: `p:${ids[at + 1]}` });

  const rows = [nav];
  if (p.stock > 0) for (let i = 0; i < opts.length; i += 2) rows.push(opts.slice(i, i + 2).map((o, j) => ({ text: `${o.label}—${priceTag(o.price)}`, callback_data: `add:${p.id}:${i + j}` })));
  if (mine.length) {
    rows.push([{ text: labels.removeFromCart, callback_data: `rm:${p.id}` }]);
    rows.push([{ text: labels.addNotes, callback_data: `note:${p.id}` }]);
  }
  if (r?.count) rows.push([{ text: fill(labels.reviews, { n: r.count }), callback_data: `rv:${p.id}:0` }]);

  const desc = p.description ? withHandle(escapeHtml(p.description.length > 900 ? p.description.slice(0, 900) + '…' : p.description)) : '';
  const notes = mine.map(i => i.note).filter(Boolean);
  return {
    text: [
      `<b>${escapeHtml(p.name)}</b>`,
      ...(r ? [`${suns(r.avg)} <code>${out10(r.avg)}/10</code>`] : []),
      `<code>${sold.get(p.id) || 0}</code> <i>purchases</i>`,
      ...(texts.vendorLine ? [withHandle(texts.vendorLine)] : []),
      `  /${prefix()}`,
      ...(desc ? ['', desc] : []),
      '',
      ...(p.stock <= 0 ? ['✖️ <b>Sold out</b>'] : []),
      mine.length
        ? [fill(texts.inCart, { total: money(inCart) }), ...mine.map(i => `• ${escapeHtml(opts[i.option]?.label || '')} ×${i.qty}`), ...(notes.length ? [`📝 <i>${escapeHtml(notes.join(' · '))}</i>`] : [])].join('\n')
        : texts.notInCart,
    ].join('\n'),
    keyboard: rows,
    image: firstImage(p),
  };
}

// A tap on a priced pack: one more of it in the cart
export async function addToCart(user, id, option) {
  const p = await prisma.product.findFirst({ where: { id: Number(id), isActive: true, source: catalog() } });
  const opt = Number(option) || 0;
  if (p && optionsOf(p)[opt]) {
    const items = cartOf(user).map(i => ({ ...i }));
    const line = items.find(i => i.productId === p.id && i.option === opt);
    if (line) line.qty = Math.min(MAX_QTY, Math.max(1, p.stock), line.qty + 1);
    else items.push({ productId: p.id, option: opt, qty: 1 });
    await saveCart(user, items);
  }
  return productBoard(user, id);
}

export async function removeFromCart(user, id) {
  await saveCart(user, cartOf(user).filter(i => i.productId !== Number(id)));
  return productBoard(user, id);
}

// ─── Waiting for a typed answer (product notes, custom order) ────────────────

const waiting = new Map(); // telegram user id → { kind, productId, until }
// Any tap clears it, so a later message is never taken for an old question
export const clearWaiting = from => waiting.delete(String(from.id));
const ask = (from, kind, extra = {}) => waiting.set(String(from.id), { kind, ...extra, until: Date.now() + 15 * 60_000 });
export function takeWaiting(from) {
  const w = waiting.get(String(from.id));
  waiting.delete(String(from.id));
  return w && w.until > Date.now() ? w : null;
}

export async function noteScreen(from, user, id) {
  const p = await prisma.product.findFirst({ where: { id: Number(id), source: catalog() }, select: { id: true, name: true } });
  if (!p) return productBoard(user, id);
  waiting.set(String(from.id), { kind: 'note', productId: p.id, until: Date.now() + 15 * 60_000 });
  return { text: fill(look().texts.notesPrompt, { product: escapeHtml(p.name) }), keyboard: [[{ text: '< Cancel', callback_data: `p:${p.id}` }]] };
}

// The typed note goes on every line of that product in the cart
export async function saveNote(user, productId, text) {
  const note = String(text).slice(0, 300);
  await saveCart(user, cartOf(user).map(i => i.productId === productId ? { ...i, note } : i));
  return productBoard(user, productId);
}

// After the custom order command (styles without a "Custom Order" product), the
// customer's next message (within 15 minutes) goes to the shop's inbox
export function customOrderScreen(from) {
  waiting.set(String(from.id), { kind: 'custom', until: Date.now() + 15 * 60_000 });
  return { text: look().texts.customOrder, keyboard: [[back('menu')]] };
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

const monthYear = d => new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

export async function reviewsBoard(id, index = 0) {
  const p = await prisma.product.findFirst({ where: { id: Number(id), source: catalog() }, select: { id: true, name: true } });
  if (!p) return { text: 'This product is no longer available.', keyboard: [[back('menu')]] };
  const reviews = await prisma.review.findMany({ where: { productId: p.id, isApproved: true }, orderBy: { createdAt: 'desc' }, include: { user: { select: { username: true, telegramHandle: true } } } });
  if (!reviews.length) return productBoard(null, id);
  const i = Math.min(Math.max(0, Number(index) || 0), reviews.length - 1);
  const rv = reviews[i];
  const who = rv.user?.telegramHandle && !/^\d+$/.test(rv.user.telegramHandle) ? `@${escapeHtml(rv.user.telegramHandle.replace(/^@/, ''))}` : escapeHtml(rv.user?.username || 'Anonymous');
  const nav = [back(`p:${p.id}`)];
  if (i > 0) nav.push({ text: '< Newer', callback_data: `rv:${p.id}:${i - 1}` });
  if (i < reviews.length - 1) nav.push({ text: 'Older >', callback_data: `rv:${p.id}:${i + 1}` });
  return {
    text: [
      `<b>${escapeHtml(p.name)}</b> – ☀️<code>${out10(rv.rating)}/10</code>`,
      `/p${p.id}`,
      ...(look().texts.vendorLine ? [withHandle(look().texts.vendorLine)] : []),
      '',
      ...(rv.comment ? [`<blockquote>${escapeHtml(rv.comment)}</blockquote>`] : []),
      `<i>--- 💬 <u>Review</u> by ${who} in ${monthYear(rv.createdAt)}</i>`,
    ].join('\n'),
    keyboard: [nav],
  };
}

// ─── Cart screen and checkout ────────────────────────────────────────────────

// The style's minimum order: { first, next } (the first order, then every later one)
async function minimumFor(user) {
  const m = look().minimums;
  if (!m) return 0;
  const done = await prisma.order.count({ where: { userId: user.id, status: { notIn: ['cancelled', 'refunded'] } } });
  return Number(done ? m.next : m.first) || 0;
}

async function cartLines(user) {
  const items = cartOf(user);
  const products = await prisma.product.findMany({ where: { id: { in: items.map(i => i.productId) }, isActive: true, source: catalog() } });
  const byId = new Map(products.map(p => [p.id, p]));
  return items.map(i => {
    const p = byId.get(i.productId);
    const o = p && optionsOf(p)[i.option];
    return p && o ? { ...i, product: p, label: o.label, price: Number(o.price), total: Number(o.price) * i.qty } : null;
  }).filter(Boolean);
}

export async function cartBoard(user) {
  const { texts } = look();
  const lines = await cartLines(user);
  if (!lines.length) return { text: fill(texts.cartEmpty, { menu: `/${prefix()}` }), keyboard: [[back('menu')]] };
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const [{ balance }, minimum] = await Promise.all([getUserBalance(user.id), minimumFor(user)]);
  const below = minimum && subtotal < minimum;
  const rows = [];
  if (below) rows.push([back('menu', `🛒 Add ${money(minimum - subtotal)} more`)]);
  else rows.push([{ text: look().labels.checkout, callback_data: 'ck' }]);
  rows.push([{ text: '🗑 Empty cart', callback_data: 'cclr' }, back('menu')]);
  return {
    text: [
      texts.cartTitle,
      '',
      ...lines.map(l => `<b>${escapeHtml(l.product.name)}</b>\n• ${escapeHtml(l.label)} ×${l.qty} — ${money(l.total)}  /p${l.product.id}${l.note ? `\n📝 <i>${escapeHtml(l.note)}</i>` : ''}`),
      '',
      `<b>Total  ${money(subtotal)}</b>`,
      ...(below ? [`⚠️ Minimum order <b>${money(minimum)}</b>${minimum === Number(look().minimums?.first) ? ' on a first order' : ''}.`] : []),
      `💰 Wallet  <b>${money(balance)}</b>`,
    ].join('\n'),
    keyboard: rows,
  };
}

// ─── Checkout: voucher, shipping details, summary ────────────────────────────

const checkoutOf = user => (user?.telegramCheckout && typeof user.telegramCheckout === 'object' ? user.telegramCheckout : {});
const saveCheckout = (user, patch) => prisma.user.update({ where: { id: user.id }, data: { telegramCheckout: { ...checkoutOf(user), ...patch } } })
  .then(u => { user.telegramCheckout = u.telegramCheckout; });
const subtotalOf = lines => Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;
const cancel = () => back('cart', look().labels.cancel);
const errorLine = e => (e ? [`❗️<b>ERROR:</b>\n${escapeHtml(e)}`, ''] : []);

// A whole ASCII-armored PGP message
// (header lines such as "Version: …" allowed, then base64 and its checksum)
function isPgp(t) {
  const m = t.trim().match(/^-----BEGIN PGP MESSAGE-----([\s\S]+)-----END PGP MESSAGE-----$/);
  if (!m) return false;
  const body = m[1].split(/\r?\n/).filter(l => !/^[\w-]+:\s/.test(l)).join('').replace(/\s+/g, '');
  return body.length >= 40 && /^[A-Za-z0-9+/]+=*(=[A-Za-z0-9+/]{4})?$/.test(body);
}

// The style's PGP key page, when it holds a public key: addresses may then be encrypted to it
function pgpCommand() {
  const page = (look().pages || []).find(p => p.key === look().pgpPage);
  return page && /BEGIN PGP PUBLIC KEY BLOCK/.test(page.html || '') ? `/${cmdName(page.key)}` : null;
}

// Shown first, like the original: the voucher on the cart, and a code to type
export async function voucherScreen(from, user, error = null) {
  const { texts, labels } = look();
  const lines = await cartLines(user);
  if (!lines.length) return cartBoard(user);
  const code = checkoutOf(user).voucher;
  let applied = null;
  if (code) {
    try { applied = await checkVoucher(code, subtotalOf(lines), catalog()); }
    catch { await saveCheckout(user, { voucher: null }); }
  }
  ask(from, 'voucher');
  const rows = [[{ text: labels.continue, callback_data: 'ckship' }]];
  if (applied) rows.push([{ text: labels.removeVoucher, callback_data: 'ckvrm' }]);
  rows.push([back('cart')]);
  return {
    text: [
      ...errorLine(error),
      texts.vouchersTitle,
      '',
      applied ? `🎟 <b>${escapeHtml(applied.voucher.code)}</b>: ${voucherLabel(applied.voucher)} (−${money(applied.discount)})` : texts.noVouchers,
      '',
      texts.voucherAsk,
    ].join('\n'),
    keyboard: rows,
  };
}

export async function applyVoucher(from, user, text) {
  const lines = await cartLines(user);
  if (!lines.length) return cartBoard(user);
  try {
    const { voucher } = await checkVoucher(text, subtotalOf(lines), catalog());
    await saveCheckout(user, { voucher: voucher.code });
    return voucherScreen(from, user);
  } catch (err) {
    return voucherScreen(from, user, err.message);
  }
}

export async function removeVoucher(from, user) {
  await saveCheckout(user, { voucher: null });
  return voucherScreen(from, user);
}

export function shipNameScreen(from, user) {
  ask(from, 'shipName');
  const rows = [];
  if (checkoutOf(user).last?.address) rows.push([{ text: look().labels.reuseShipping, callback_data: 'ckreuse' }]);
  rows.push([cancel()]);
  return { text: [look().texts.shipTitle, '', look().texts.shipName].join('\n'), keyboard: rows };
}

export async function saveShipName(from, user, text) {
  await saveCheckout(user, { name: text.slice(0, 120) });
  return shipStreetScreen(from, user);
}

function shipStreetScreen(from, user) {
  ask(from, 'shipStreet');
  return {
    text: [look().texts.shipTitle, '', 'Recipient Full Name:', `  ${escapeHtml(checkoutOf(user).name || '')}`, '', look().texts.shipStreet].join('\n'),
    keyboard: [[cancel()]],
  };
}

export async function saveShipStreet(from, user, text) {
  await saveCheckout(user, { street: text.slice(0, 200) });
  return shipAddressScreen(from, user);
}

function shipAddressScreen(from, user, error = null) {
  ask(from, 'shipAddr');
  const pgp = pgpCommand();
  const { texts } = look();
  return {
    text: [...errorLine(error), texts.shipTitle, '', pgp ? fill(texts.shipAddressPgp, { pgp }) : texts.shipAddress].join('\n'),
    keyboard: [[cancel()]],
  };
}

// The full shipping details: a PGP message when the style has a key (plain text too,
// unless the style requires PGP), else plain text
export async function saveShipAddress(from, user, text) {
  const { texts } = look();
  const t = String(text).trim();
  const looksPgp = /BEGIN PGP/.test(t);
  if (looksPgp && !isPgp(t)) return shipAddressScreen(from, user, texts.pgpInvalid);
  if (!looksPgp && pgpCommand() && look().pgpAddress === 'required') return shipAddressScreen(from, user, texts.pgpInvalid);
  if (!looksPgp && t.split('\n').filter(l => l.trim()).length < 2) return shipAddressScreen(from, user, texts.shipAddressShort);
  const c = checkoutOf(user);
  const address = t.slice(0, 6000);
  await saveCheckout(user, { address, last: { name: c.name, street: c.street, address } });
  return summaryScreen(user);
}

export async function reuseShipping(user) {
  const { last } = checkoutOf(user);
  if (last?.address) await saveCheckout(user, { name: last.name, street: last.street, address: last.address });
  return summaryScreen(user);
}

// What the order costs with the voucher and the style's shipping fee (else the shop's)
async function priced(user, lines) {
  const subtotal = subtotalOf(lines);
  const fixed = look().shippingFee;
  const shippingFee = fixed != null && fixed !== '' ? Math.max(0, Number(fixed) || 0)
    : (await priceCart(lines.map(l => ({ productId: l.productId, quantity: l.qty, option: l.option })), { delivery: true })).shippingFee;
  let offer = null;
  const code = checkoutOf(user).voucher;
  if (code) {
    try { offer = await checkVoucher(code, subtotal, catalog()); }
    catch { await saveCheckout(user, { voucher: null }); }
  }
  const discount = offer?.discount || 0;
  return { subtotal, shippingFee, offer, discount, total: Math.round((subtotal - discount + shippingFee) * 100) / 100 };
}

const shownAddress = c => [
  escapeHtml(c.name || ''),
  escapeHtml(c.street || ''),
  /BEGIN PGP/.test(c.address || '') ? '🔒 <i>PGP encrypted shipping details</i>' : escapeHtml(c.address || ''),
].filter(Boolean).join('\n');

export async function summaryScreen(user) {
  const { texts, labels } = look();
  const lines = await cartLines(user);
  if (!lines.length) return cartBoard(user);
  const minimum = await minimumFor(user);
  if (minimum && subtotalOf(lines) < minimum) return cartBoard(user);
  const c = checkoutOf(user);
  const ready = c.name && c.address;
  const [{ subtotal, shippingFee, offer, discount, total }, { balance }] = await Promise.all([priced(user, lines), getUserBalance(user.id)]);
  const enough = balance >= total;
  const rows = [];
  if (!ready) rows.push([{ text: labels.continue, callback_data: 'ckship' }]);
  else if (enough) rows.push([{ text: `✅ PAY ${money(total)} FROM MY WALLET`, callback_data: 'cpay' }]);
  else rows.push([{ text: '➕ Add funds', callback_data: 'w' }]);
  rows.push([{ text: labels.changeShipping, callback_data: 'ckship' }, { text: labels.vouchers, callback_data: 'ck' }]);
  rows.push([back('cart')]);
  return {
    text: [
      texts.checkoutTitle,
      '',
      ...lines.map(l => `<b>${escapeHtml(l.product.name)}</b>\n• ${escapeHtml(l.label)} ×${l.qty} — ${money(l.total)}${l.note ? `\n📝 <i>${escapeHtml(l.note)}</i>` : ''}`),
      '',
      `Products  ${money(subtotal)}`,
      ...(offer ? [`🎟 ${escapeHtml(offer.voucher.code)}  −${money(discount)}`] : []),
      `Shipping  ${shippingFee > 0 ? money(shippingFee) : 'free'}`,
      `<b>Total  ${money(total)}</b>`,
      '',
      `📦 <b>Ship to:</b>\n${ready ? shownAddress(c) : '<i>no shipping details yet</i>'}`,
      '',
      `💰 Wallet  <b>${money(balance)}</b>`,
      ...(ready && !enough ? [`⚠️ <b>${money(total - balance)}</b> missing: add funds, then come back to /cart.`] : []),
    ].join('\n'),
    keyboard: rows,
  };
}

export async function clearCart(user) {
  await saveCart(user, []);
  return cartBoard(user);
}

// One payment at a time per customer: a double tap never makes two orders
const paying = new Set();

export async function cartPay(user) {
  if (paying.has(user.id)) return null;
  paying.add(user.id);
  try {
    const lines = await cartLines(user);
    if (!lines.length) return cartBoard(user);
    const minimum = await minimumFor(user);
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    if (minimum && subtotal < minimum) return cartBoard(user);
    const c = checkoutOf(user);
    if (!c.name || !c.address) return summaryScreen(user);
    const { shippingFee } = await priced(user, lines);
    // The product notes travel with the order, so the shop's notification shows them
    const notes = [...new Set(lines.filter(l => l.note).map(l => `${l.product.name}: ${l.note}`))];
    const { order, payments, newBalance } = await orderService.createOrder(user.id, {
      items: lines.map(l => ({ productId: l.productId, quantity: l.qty, option: l.option })),
      paymentMethod: 'wallet',
      note: notes.join('\n') || null,
      shipping: { name: c.name, address: [c.street, c.address].filter(Boolean).join('\n'), fee: shippingFee },
      voucher: c.voucher || null,
      source: catalog(),
    });
    await saveCart(user, []);
    // The next order starts afresh; these details are offered again ("reuse")
    await saveCheckout(user, { voucher: null, name: null, street: null, address: null });
    return {
      text: [
        '✅ <b>PAID</b>',
        `Order <code>${escapeHtml(order.orderNumber)}</code>`,
        '',
        ...order.items.map(i => `${i.quantity} × ${escapeHtml(i.name)}  ·  ${money(Number(i.price) * i.quantity)}`),
        ...(order.voucherCode ? [`🎟 ${escapeHtml(order.voucherCode)}  −${money(order.discount)}`] : []),
        `Shipping  ${Number(order.shippingFee) > 0 ? money(order.shippingFee) : 'free'}`,
        `<b>Total  ${money(order.totalAmount)}</b>`,
        `<i>Paid ${payments.map(p => `${p.amount} ${p.currency}`).join(' + ')}</i>`,
        '',
        look().texts.paidNote,
        `💰 Wallet  <b>${money(newBalance)}</b>`,
      ].join('\n'),
      keyboard: [[{ text: '📦 Previous orders', callback_data: 'o' }, back('menu')]],
    };
  } catch (err) {
    return { text: `⚠️ <b>NOT PAID</b>\n${escapeHtml(err.message || 'The payment did not go through.')}`, keyboard: [[back('ck', '‹ Checkout')]] };
  } finally {
    paying.delete(user.id);
  }
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
  if (c === 'cart') return 'cart';
  if (c === cmdName(look().customOrderCommand) || c === `${pre}_create_custom_order` || c === 'create_custom_order') {
    // A catalog with a "Custom Order" product opens it (amounts + notes), like the original
    const product = catalog() && await prisma.product.findFirst({ where: { source: catalog(), isActive: true, name: { equals: 'Custom Order', mode: 'insensitive' } }, select: { id: true } });
    return product ? `p:${product.id}:1` : 'co';
  }
  const page = (look().pages || []).find(p => cmdName(p.key) === c);
  if (page) return `pg:${page.key}`;
  if (c.startsWith(`${pre}_`)) {
    const rest = c.slice(pre.length + 1);
    if (rest === cmdName(FIRE)) return `cat:${FIRE}:1`;
    const shelf = (await allShelves()).find(s => cmdName(shortSlug(s)) === rest);
    if (shelf) return `cat:${shelf.slug}:1`;
  }
  return null;
}
