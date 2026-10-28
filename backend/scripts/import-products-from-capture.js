// Creates the shop's shelves and products from a capture of a bot (data.json + media/).
//
//   node scripts/import-products-from-capture.js <capture folder> [--source qt] [--stock 100] [--dry]
//
// Everything created carries a `source` (default "qt"): shelves are stored as
// "<source>-<name>" so they never clash with the shop's own, and only the bots whose
// style names that catalog show them. The website never lists them.
// Shelves come from the commands the capture opened (menu order, sub-shelves under
// the shelf that lists them); each product screen becomes a product with its
// description, photo and its priced packs ("1x" $8.50, "25x" $200…) in `options`.
// A product is found again by its slug, so running this twice updates instead of
// duplicating. Stock isn't in a capture: every product gets --stock (default 100).
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../src/db.js';
import { env } from '../src/config/env.js';
import { uploadToCloudinary } from '../src/middlewares/upload.js';
import { cmdName } from '../src/services/telegramCommands.js';

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const dry = args.includes('--dry');
const source = (args.includes('--source') ? args[args.indexOf('--source') + 1] : 'qt').toLowerCase().replace(/[^a-z0-9]/g, '') || 'qt';
const stock = args.includes('--stock') ? Math.max(0, parseInt(args[args.indexOf('--stock') + 1], 10) || 0) : 100;
if (!dir) { console.error('Usage: node scripts/import-products-from-capture.js <capture folder> [--stock 100] [--dry]'); process.exit(1); }

const { screens, steps } = JSON.parse(await fs.readFile(path.join(dir, 'data.json'), 'utf8'));
const byKey = new Map(screens.map(s => [s.key, s]));
const INFO = /^\/(v_\w+_(refunds|shipping|create_custom_order|clearance_rack_x)|about_\w+|pgp_\w+|orders|start)$/;
const prefixOf = screens.map(s => (s.sources || []).find(x => /^\/v_\w+$/.test(x))).find(Boolean)?.slice(1) || 'v_shop';
const shelfCmd = x => new RegExp(`^/${prefixOf}_\\w+$`).test(x) && !INFO.test(x);
const slugOf = cmd => cmdName(cmd.slice(prefixOf.length + 2));

// "Label:\n/command" → Label (also "Label - note")
function labelFor(cmd, texts) {
  for (const t of texts) {
    const lines = t.split('\n');
    const i = lines.findIndex(l => l.trim().split(/\s+/)[0] === cmd);
    for (let j = i - 1; i > 0 && j >= 0; j--) {
      const l = lines[j].trim();
      if (l) return l.replace(/:\s*$/, '').replace(/\s+-\s+.*$/, '').trim();
    }
  }
  return slugOf(cmd).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Shelves: tree and which product groups sit on which shelf ───────────────

const menu = screens.find(s => (s.sources || []).includes(`/${prefixOf}`));
const firstScreenOf = new Map();           // shelf command → its first screen
const groupShelf = new Map();              // product group code → shelf command
const isListing = s => s && /^\/p\d+_\w+\s*$/m.test(s.raw) && !(s.sources || []).some(x => /^\/p\d+_/.test(x));
// The crawl isn't strictly shelf by shelf (after a Back it paginates older shelves),
// so a page of a listing takes the shelf of a page already known in the same step
// (Telegram edits the message in place: the step shows the new page and the old
// one), else the shelf of the previous paginated step.
const groupsOf = s => isListing(s) ? [...s.raw.matchAll(/^\/p\d+_(\w+)\s*$/gm)].map(m => m[1]) : [];
const isBack = a => /^\[(⇇|⇆|⇇ Back|⇆ Back)\]$/.test(a);
let last = null;
for (const st of steps) {
  if (isBack(st.action) || /^\/p\d+_/.test(st.action)) continue;
  const groups = [...new Set((st.screens || []).flatMap(k => groupsOf(byKey.get(k))))];
  if (shelfCmd(st.action)) {
    last = st.action;
    firstScreenOf.set(last, byKey.get((st.screens || [])[0]));
    for (const g of groupsOf(byKey.get((st.screens || [])[0]))) if (!groupShelf.has(g)) groupShelf.set(g, last);
    continue;
  }
  if (!groups.length) continue;
  const known = groups.find(g => groupShelf.has(g));
  const shelf = known ? groupShelf.get(known) : last;
  if (!shelf) continue;
  last = shelf;
  for (const g of groups) if (!groupShelf.has(g)) groupShelf.set(g, shelf);
}
const topCmds = [...(menu?.raw || '').matchAll(/^\/(\w+)/gm)].map(m => `/${m[1]}`).filter(shelfCmd);
const childrenOf = new Map();
for (const [cmd, s] of firstScreenOf) {
  const subs = [...(s?.raw || '').matchAll(/^\/(\w+)/gm)].map(m => `/${m[1]}`).filter(c => shelfCmd(c) && c !== cmd);
  if (subs.length) childrenOf.set(cmd, subs);
}
const allShelves = [...new Set([...topCmds, ...childrenOf.keys(), ...[...childrenOf.values()].flat(), ...groupShelf.values()])];
const texts = [menu?.raw, ...[...firstScreenOf.values()].map(s => s?.raw)].filter(Boolean);
const parentOf = new Map([...childrenOf].flatMap(([p, subs]) => subs.map(c => [c, p])));

// ─── Products ────────────────────────────────────────────────────────────────

const SUP = { '⁰': 0, '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9 };
const priceOf = text => {
  const m = text.match(/\$(\d[\d,]*)([⁰¹²³⁴⁵⁶⁷⁸⁹]{2})?/);
  return m ? Number(m[1].replace(/,/g, '')) + (m[2] ? [...m[2]].reduce((n, c) => n * 10 + SUP[c], 0) / 100 : 0) : null;
};

const products = [];
const seen = new Set();
for (const s of [...screens].sort((a, b) => a.order - b.order)) {
  const cmd = (s.sources || []).find(x => /^\/p\d+_\w+$/.test(x));
  if (!cmd || seen.has(cmd)) continue;
  seen.add(cmd);
  const group = cmd.split('_')[1];
  const lines = s.raw.split('\n');
  const name = lines[0].trim();
  const from = lines.findIndex(l => new RegExp(`^\\s*/${prefixOf}\\s*$`).test(l));
  const to = lines.findIndex(l => l.trim().startsWith('🛒'));
  const description = from >= 0 ? lines.slice(from + 1, to > from ? to : undefined).join('\n').trim() : '';
  const options = (s.buttons || []).flat().map(b => {
    const m = b.text.match(/^(.+?)\s*—\s*\$/);
    const price = m && priceOf(b.text);
    return m && price != null ? { label: m[1].trim(), price } : null;
  }).filter(Boolean);
  products.push({ cmd, group, name, description, options, media: s.media, shelf: groupShelf.get(group) || null });
}
const usable = products.filter(p => p.name && p.options.length);

console.log(`Shelves: ${allShelves.length} (${topCmds.length} on the menu), products found: ${products.length}, with a price: ${usable.length}`);
for (const c of allShelves) console.log(`  ${parentOf.has(c) ? '   └' : ' '} ${labelFor(c, texts)}  [${source}-${slugOf(c)}]  ${products.filter(p => p.shelf === c).length} products`);
const skipped = products.filter(p => !usable.includes(p));
if (skipped.length) console.log(`Without a name or price (skipped): ${skipped.map(p => p.cmd).join(' ')}`);
const orphans = usable.filter(p => !p.shelf);
if (orphans.length) console.log(`Without a shelf (created with no category): ${orphans.length}`);
if (dry) { console.log('Dry run: nothing written.'); process.exit(0); }

// Photos, uploaded once each
const media = new Map();
async function imageUrl(file) {
  if (!file) return null;
  if (media.has(file)) return media.get(file);
  let url = null;
  try {
    const buf = await fs.readFile(path.join(dir, 'media', file));
    url = (await uploadToCloudinary(buf, 'image/jpeg', 'captain-slabbin/products', env.publicUrl)).url;
  } catch (err) { console.error(`image ${file}:`, err.message); }
  media.set(file, url);
  return url;
}

// Shelves first (parents before children)
const categoryId = new Map();
let position = 0;
for (const cmd of [...allShelves].sort((a, b) => Number(parentOf.has(a)) - Number(parentOf.has(b)))) {
  const data = { name: labelFor(cmd, texts), parentId: parentOf.has(cmd) ? categoryId.get(parentOf.get(cmd)) ?? null : null, position: position++, source };
  const slug = `${source}-${slugOf(cmd)}`;
  const cat = await prisma.category.upsert({ where: { slug }, update: data, create: { ...data, slug } });
  categoryId.set(cmd, cat.id);
}

let created = 0, updated = 0;
for (const p of usable) {
  const slug = `${cmdName(p.name).slice(0, 60)}-${p.group.toLowerCase()}${p.cmd.match(/^\/p(\d+)_/)[1]}`;
  const data = {
    name: p.name.slice(0, 200), description: p.description || null, price: p.options[0].price, unitLabel: p.options[0].label,
    options: p.options, stock, isActive: true, source, categoryId: p.shelf ? categoryId.get(p.shelf) ?? null : null,
  };
  const existing = await prisma.product.findUnique({ where: { slug }, include: { images: true } });
  const product = existing
    ? await prisma.product.update({ where: { id: existing.id }, data })
    : await prisma.product.create({ data: { ...data, slug } });
  if (!existing?.images.length) {
    const url = await imageUrl(p.media);
    if (url) await prisma.productImage.create({ data: { productId: product.id, url, thumbnail: url, position: 0 } });
  }
  existing ? updated++ : created++;
}
console.log(`Products: ${created} created, ${updated} updated. Shelves: ${categoryId.size}.`);
await prisma.$disconnect();
