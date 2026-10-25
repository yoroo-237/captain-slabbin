import { prisma } from '../../db.js';
import { ok } from '../../utils/response.js';
import { parsePaginationParams, buildPagination } from '../../utils/pagination.js';
import { appError } from '../../utils/formatters.js';
import { dmUser, escapeHtml } from '../../services/telegram.service.js';

const STATUS_TEXT = { processing: 'is being prepared', shipped: 'has shipped', delivered: 'was delivered', cancelled: 'was cancelled', refunded: 'was refunded' };

// Customers on the bot get each status change of their order there (best-effort)
function tellCustomer(order) {
  const tracking = order.trackingNumber ? `
Tracking: <code>${escapeHtml(order.trackingNumber)}</code>${order.carrier ? ` (${escapeHtml(order.carrier)})` : ''}` : '';
  dmUser(order.userId, `📦 Your order <b>${escapeHtml(order.orderNumber)}</b> ${STATUS_TEXT[order.status] || `is now ${escapeHtml(order.status)}`}.${tracking}`,
    [{ text: '📦 My orders', callback_data: 'o' }]).catch(() => {});
}

const VALID_STATUSES = ['processing', 'shipped', 'delivered', 'cancelled', 'refunded'];

export const adminOrdersController = {
  async list(req, res) {
    const { page, limit, skip } = parsePaginationParams(req.query);
    const { search, status, paymentMethod } = req.query;

    const where = {};
    if (status)        where.status        = status;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { name:        { contains: search, mode: 'insensitive' } },
        { user:        { username: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where, skip, take: limit,
        orderBy: { placedAt: 'desc' },
        include: { user: { select: { id: true, username: true } }, items: true },
      }),
      prisma.order.count({ where }),
    ]);
    res.json(ok({ orders, pagination: buildPagination(page, limit, total) }));
  },

  async getOne(req, res) {
    const order = await prisma.order.findUniqueOrThrow({
      where:   { id: parseInt(req.params.id, 10) },
      include: {
        user:  { select: { id: true, username: true, telegramHandle: true } },
        items: { include: { product: { select: { slug: true, images: { take: 1 } } } } },
        transaction: true,
      },
    });
    res.json(ok(order));
  },

  async updateStatus(req, res) {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      throw appError(`Invalid status. Valid values: ${VALID_STATUSES.join(', ')}`, 400);
    }
    const order = await prisma.order.update({
      where: { id: parseInt(req.params.id, 10) },
      data:  { status },
    });
    tellCustomer(order);
    res.json(ok(order));
  },

  async updateTracking(req, res) {
    const { trackingNumber, carrier } = req.body;
    if (!trackingNumber) throw appError('trackingNumber is required', 400);
    const order = await prisma.order.update({
      where: { id: parseInt(req.params.id, 10) },
      data:  { trackingNumber: trackingNumber.trim(), carrier: carrier?.trim() || null, status: 'shipped' },
    });
    tellCustomer(order);
    res.json(ok(order));
  },
};
