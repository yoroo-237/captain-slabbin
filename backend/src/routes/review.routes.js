import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../middlewares/auth.js';
import { requireGate } from '../middlewares/gate.js';
import { ok } from '../utils/response.js';
import { appError } from '../utils/formatters.js';

// Customer reviews. Only someone who bought the product can review it, and a
// review is only shown once staff approve it (Admin → Reviews). Names are
// shortened so no customer is identifiable.
const r = Router();

const shortName = u => {
  const n = String(u || '').trim()
  return n.length <= 2 ? `${n[0] || 'C'}.` : `${n[0].toUpperCase()}${'•'.repeat(Math.min(4, n.length - 2))}${n[n.length - 1]}`
};
const PUBLIC = {
  id: true, rating: true, comment: true, createdAt: true,
  user: { select: { username: true } },
  product: { select: { id: true, name: true, sku: true, slug: true } },
};
const present = rv => ({
  id: rv.id, rating: rv.rating, comment: rv.comment, createdAt: rv.createdAt,
  author: shortName(rv.user?.username), product: rv.product,
});

// Latest approved reviews (home page testimonials): public, no prices in them
r.get('/', async (req, res) => {
  const reviews = await prisma.review.findMany({
    where: { isApproved: true, comment: { not: null } },
    orderBy: { createdAt: 'desc' }, take: 12, select: PUBLIC,
  });
  res.json(ok(reviews.map(present)));
});

// Approved reviews of one product, with the average
r.get('/product/:productId', requireGate, async (req, res) => {
  const productId = parseInt(req.params.productId, 10);
  const [reviews, agg] = await Promise.all([
    prisma.review.findMany({ where: { productId, isApproved: true }, orderBy: { createdAt: 'desc' }, take: 30, select: PUBLIC }),
    prisma.review.aggregate({ where: { productId, isApproved: true }, _avg: { rating: true }, _count: true }),
  ]);
  res.json(ok({ reviews: reviews.map(present), average: agg._avg.rating, count: agg._count }));
});

async function boughtIt(userId, productId) {
  return !!(await prisma.order.findFirst({
    where: { userId, status: { notIn: ['cancelled', 'refunded'] }, items: { some: { productId } } },
    select: { id: true },
  }));
}

// Can the signed-in customer review this product?
r.get('/can/:productId', requireAuth, async (req, res) => {
  const productId = parseInt(req.params.productId, 10);
  const [bought, mine] = await Promise.all([
    boughtIt(req.user.sub, productId),
    prisma.review.findFirst({ where: { userId: req.user.sub, productId }, select: { id: true, isApproved: true } }),
  ]);
  res.json(ok({ canReview: bought && !mine, reviewed: !!mine, approved: !!mine?.isApproved }));
});

r.post('/', requireAuth, async (req, res) => {
  const productId = parseInt(req.body?.productId, 10);
  const rating = parseInt(req.body?.rating, 10);
  const comment = String(req.body?.comment || '').trim().slice(0, 800) || null;
  if (!productId || !(rating >= 1 && rating <= 5)) throw appError('Choose a rating from 1 to 5 stars.', 400);
  if (!(await boughtIt(req.user.sub, productId))) throw appError('Only customers who bought this product can review it.', 403);
  if (await prisma.review.findFirst({ where: { userId: req.user.sub, productId } })) throw appError('You already reviewed this product.', 409);
  const review = await prisma.review.create({ data: { userId: req.user.sub, productId, rating, comment } });
  res.status(201).json(ok({ id: review.id, pending: true }));
});

export default r;
