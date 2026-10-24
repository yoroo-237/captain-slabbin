import { prisma } from '../../db.js';
import { ok } from '../../utils/response.js';
import { parsePaginationParams, buildPagination } from '../../utils/pagination.js';

export const adminTransactionsController = {
  async list(req, res) {
    const { page, limit, skip } = parsePaginationParams(req.query);
    const { search, type, status, currency, dateFrom, dateTo } = req.query;

    const where = {};
    if (type)     where.type     = type;
    if (status)   where.status   = status;
    if (currency) where.currency = currency.toUpperCase();

    if (search) {
      where.user = { username: { contains: search.trim(), mode: 'insensitive' } };
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo)   where.createdAt.lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user:    { select: { id: true, username: true } },
          order:   { select: { orderNumber: true } },
          deposit: { select: { currency: true } },
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json(ok({ transactions, pagination: buildPagination(page, limit, total) }));
  },
};
