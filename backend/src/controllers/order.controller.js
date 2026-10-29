import { orderService } from '../services/order.service.js';
import { prisma } from '../db.js';
import { ok } from '../utils/response.js';
import { parsePaginationParams, buildPagination } from '../utils/pagination.js';

export const orderController = {
  async create(req, res) {
    // Only what the website's checkout sends: the bot-only fields (a shipping fee of
    // its own, a catalog) are never taken from a customer's request
    const { items, paymentMethod, payCurrency, telegram, delivery, note, refund } = req.body || {};
    const result = await orderService.createOrder(req.user.sub, { items, paymentMethod, payCurrency, telegram, delivery, note, refund, channel: 'site' });
    res.status(201).json(ok(result));
  },

  async list(req, res) {
    const { page, limit, skip } = parsePaginationParams(req.query);
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where:   { userId: req.user.sub },
        skip, take: limit,
        orderBy: { placedAt: 'desc' },
        include: { items: true },
      }),
      prisma.order.count({ where: { userId: req.user.sub } }),
    ]);
    res.json(ok({ orders, pagination: buildPagination(page, limit, total) }));
  },

  async getOne(req, res) {
    const order = await prisma.order.findFirstOrThrow({
      where:   { id: parseInt(req.params.id, 10), userId: req.user.sub },
      include: {
        items: {
          include: { product: { select: { slug: true, images: { take: 1, orderBy: { position: 'asc' } } } } },
        },
      },
    });
    res.json(ok(order));
  },
};
