import { Router } from 'express';
import { prisma } from '../db.js';
import { ok } from '../utils/response.js';

// Shelf navigation: top-level categories with their sub-shelves and product counts.
// "fire-sale" is a virtual shelf of every product with a strike-through price.
const r = Router();

r.get('/', async (req, res) => {
  const [cats, counts, saleCount] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }], include: { children: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } } }),
    prisma.product.groupBy({ by: ['categoryId'], where: { isActive: true }, _count: { _all: true } }),
    prisma.product.count({ where: { isActive: true, compareAtPrice: { not: null } } }),
  ]);
  const countOf = Object.fromEntries(counts.map(c => [c.categoryId, c._count._all]));
  const shelves = cats.filter(c => !c.parentId).map(c => ({
    slug: c.slug, name: c.name, imageUrl: c.imageUrl,
    count: (countOf[c.id] || 0) + c.children.reduce((s, ch) => s + (countOf[ch.id] || 0), 0),
    children: c.children.map(ch => ({ slug: ch.slug, name: ch.name, count: countOf[ch.id] || 0 })),
  }));
  res.json(ok({ fireSale: saleCount, categories: shelves }));
});

export default r;
