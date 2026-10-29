// Merges the copies of a product that earlier imports of a capture created (one per
// /p code: those codes change with every session), keeping the oldest one.
//
//   node scripts/dedupe-capture-products.js [--source qt] [--dry]
//
// The kept product takes a shelf or a photo it lacks from a copy; Telegram carts
// pointing at a copy point at it. A copy with orders or reviews is hidden
// (isActive false) so its history stays; any other copy is deleted.
import { prisma } from '../src/db.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const source = (args.includes('--source') ? args[args.indexOf('--source') + 1] : 'qt').toLowerCase().replace(/[^a-z0-9]/g, '') || 'qt';

const products = await prisma.product.findMany({
  where: { source },
  orderBy: { id: 'asc' },
  include: { images: { orderBy: { position: 'asc' } }, _count: { select: { orderItems: true, reviews: true } } },
});
const groups = new Map();
for (const p of products) {
  const k = p.name.trim().toLowerCase();
  groups.set(k, [...(groups.get(k) || []), p]);
}

const keptOf = new Map(); // copy id → kept id
let hidden = 0, deleted = 0;
for (const [, [kept, ...copies]] of groups) {
  if (!copies.length) continue;
  for (const c of copies) keptOf.set(c.id, kept.id);
  if (dry) continue;
  const shelf = kept.categoryId ?? copies.find(c => c.categoryId)?.categoryId ?? null;
  await prisma.product.update({ where: { id: kept.id }, data: { categoryId: shelf, isActive: true } });
  const photo = !kept.images.length && copies.flatMap(c => c.images)[0];
  if (photo) await prisma.productImage.create({ data: { productId: kept.id, url: photo.url, thumbnail: photo.thumbnail, position: 0 } });
  for (const c of copies) {
    if (c._count.orderItems || c._count.reviews) { await prisma.product.update({ where: { id: c.id }, data: { isActive: false } }); hidden++; }
    else { await prisma.product.delete({ where: { id: c.id } }); deleted++; }
  }
}

// Telegram carts: lines of a copy go to the kept product
let carts = 0;
const users = await prisma.user.findMany({ where: { NOT: { telegramCart: { equals: [] } } }, select: { id: true, telegramCart: true } });
for (const u of users) {
  if (!Array.isArray(u.telegramCart) || !u.telegramCart.some(i => keptOf.has(i.productId))) continue;
  carts++;
  if (!dry) await prisma.user.update({ where: { id: u.id }, data: { telegramCart: u.telegramCart.map(i => ({ ...i, productId: keptOf.get(i.productId) ?? i.productId })) } });
}

const names = [...groups.values()].filter(g => g.length > 1).length;
console.log(`${source}: ${products.length} products, ${groups.size} names, ${names} with copies (${keptOf.size} copies), carts moved: ${carts}.`);
console.log(dry ? 'Dry run: nothing written.' : `Copies deleted: ${deleted}, hidden (orders or reviews): ${hidden}.`);
await prisma.$disconnect();
