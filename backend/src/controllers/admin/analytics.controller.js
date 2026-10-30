import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { ok } from '../../utils/response.js';
import { orderShopWhere, itemShopWhere, customerShopWhere, shopSource } from '../../utils/shops.js';

const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

function getSince(period) {
  const days = PERIOD_DAYS[period] || 30;
  const d    = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Rows summed per day ('YYYY-MM-DD'), oldest first
function perDay(rows, dateOf, valueOf, key) {
  const days = new Map();
  for (const r of rows) {
    const d = dateOf(r).toISOString().slice(0, 10);
    days.set(d, (days.get(d) || 0) + valueOf(r));
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, [key]: v }));
}

export const analyticsController = {
  // ?shop=site | <catalog> | all: sales, orders and customers of one shop (see
  // the dashboard). Deposits fill the one wallet every shop is paid from, so
  // they and the wallet flow stay the same in every view.
  async get(req, res) {
    const period = req.query.period || '30d';
    const since  = getSince(period);
    const shop   = req.query.shop;

    const orders    = { ...orderShopWhere(shop), placedAt: { gte: since } };
    const ofShop    = Object.keys(orderShopWhere(shop)).length ? { order: orderShopWhere(shop) } : {};
    const sales     = { type: 'purchase', createdAt: { gte: since }, ...ofShop };
    const newUsers  = { ...customerShopWhere(shop), createdAt: { gte: since } };
    const source    = shopSource(shop);
    const inShop    = source === undefined ? Prisma.empty
      : source === null ? Prisma.sql`AND p.source IS NULL` : Prisma.sql`AND p.source = ${source}`;

    const [
      revAgg, orderCount, newUsersCount, avgOrderAgg, depositAgg,
      ordersStatusRaw, topProductsRaw,
      depositsByCurrencyRaw, revenueByMethodRaw,
      revenueRows, orderRows, userRows,
    ] = await Promise.all([
      prisma.transaction.aggregate({ where: { ...sales, status: 'confirmed' }, _sum: { amount: true } }),
      prisma.order.count({ where: orders }),
      prisma.user.count({ where: newUsers }),
      prisma.order.aggregate({ where: orders, _avg: { totalAmount: true } }),
      prisma.deposit.aggregate({ where: { status: 'confirmed', confirmedAt: { gte: since } }, _sum: { usdCredited: true } }),
      prisma.order.groupBy({ by: ['status'], _count: { id: true }, where: orders }),
      prisma.orderItem.groupBy({ by: ['productId', 'name'], where: itemShopWhere(shop), _sum: { quantity: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 10 }),
      prisma.deposit.groupBy({ by: ['currency'], _sum: { usdCredited: true }, where: { status: 'confirmed', confirmedAt: { gte: since } } }),
      prisma.order.groupBy({ by: ['paymentMethod'], _sum: { totalAmount: true }, where: orders }),
      prisma.transaction.findMany({ where: sales, select: { createdAt: true, amount: true } }),
      prisma.order.findMany({ where: orders, select: { placedAt: true } }),
      prisma.user.findMany({ where: newUsers, select: { createdAt: true } }),
    ]);

    const [walletFlow, topCategories] = await Promise.all([
      prisma.$queryRaw`
        SELECT TO_CHAR("createdAt", 'YYYY-MM-DD') as date,
               SUM(CASE WHEN type='deposit' THEN amount ELSE 0 END)::float as deposits,
               ABS(SUM(CASE WHEN type='purchase' THEN amount ELSE 0 END))::float as purchases
        FROM "Transaction" WHERE "createdAt" >= ${since}
        GROUP BY TO_CHAR("createdAt", 'YYYY-MM-DD') ORDER BY date`,

      prisma.$queryRaw`
        SELECT c.name, SUM(oi.price * oi.quantity)::float as revenue
        FROM "Transaction" t
        JOIN "Order" o ON t."orderId" = o.id
        JOIN "OrderItem" oi ON oi."orderId" = o.id
        JOIN "Product" p ON oi."productId" = p.id
        JOIN "Category" c ON p."categoryId" = c.id
        WHERE t.type = 'purchase' AND t."createdAt" >= ${since} ${inShop}
        GROUP BY c.name ORDER BY revenue DESC LIMIT 10`,
    ]);

    res.json(ok({
      summary: {
        revenue:       Math.abs(Number(revAgg._sum.amount        || 0)),
        orders:        orderCount,
        newUsers:      newUsersCount,
        avgOrderValue: Number(avgOrderAgg._avg.totalAmount        || 0),
        totalDeposits: Number(depositAgg._sum.usdCredited         || 0),
      },
      revenueChart:  perDay(revenueRows, r => r.createdAt, r => Math.abs(Number(r.amount || 0)), 'revenue'),
      ordersChart:   perDay(orderRows, o => o.placedAt, () => 1, 'count'),
      newUsersChart: perDay(userRows, u => u.createdAt, () => 1, 'count'),
      walletFlow,
      ordersStatusChart: Object.fromEntries(ordersStatusRaw.map(s => [s.status, s._count.id])),
      topProducts:       topProductsRaw.map(p => ({ name: p.name, sold: Number(p._sum.quantity || 0) })),
      topCategories,
      depositsByCurrency: depositsByCurrencyRaw.map(d => ({ currency: d.currency, value: Number(d._sum.usdCredited || 0) })),
      revenueByMethod:    revenueByMethodRaw.map(r => ({ method: r.paymentMethod, revenue: Number(r._sum.totalAmount || 0) })),
    }));
  },
};
