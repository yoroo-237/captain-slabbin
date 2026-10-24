import { prisma } from '../../db.js';
import { ok } from '../../utils/response.js';

const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

function getSince(period) {
  const days = PERIOD_DAYS[period] || 30;
  const d    = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

export const analyticsController = {
  async get(req, res) {
    const period = req.query.period || '30d';
    const since  = getSince(period);

    const [
      revAgg, orderCount, newUsersCount, avgOrderAgg, depositAgg,
      ordersStatusRaw, topProductsRaw,
      depositsByCurrencyRaw, revenueByMethodRaw,
    ] = await Promise.all([
      prisma.transaction.aggregate({ where: { type: 'purchase', status: 'confirmed', createdAt: { gte: since } }, _sum:  { amount: true } }),
      prisma.order.count({ where: { placedAt: { gte: since } } }),
      prisma.user.count({ where: { createdAt: { gte: since } } }),
      prisma.order.aggregate({ where: { placedAt: { gte: since } }, _avg: { totalAmount: true } }),
      prisma.deposit.aggregate({ where: { status: 'confirmed', confirmedAt: { gte: since } }, _sum: { usdCredited: true } }),
      prisma.order.groupBy({ by: ['status'], _count: { id: true }, where: { placedAt: { gte: since } } }),
      prisma.orderItem.groupBy({ by: ['productId', 'name'], _sum: { quantity: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 10 }),
      prisma.deposit.groupBy({ by: ['currency'], _sum: { usdCredited: true }, where: { status: 'confirmed', confirmedAt: { gte: since } } }),
      prisma.order.groupBy({ by: ['paymentMethod'], _sum: { totalAmount: true }, where: { placedAt: { gte: since } } }),
    ]);

    // Charts via SQL raw pour groupBy date
    const [revenueChart, ordersChart, newUsersChart, walletFlow, topCategories] = await Promise.all([
      prisma.$queryRaw`
        SELECT TO_CHAR("createdAt", 'YYYY-MM-DD') as date, ABS(SUM(amount))::float as revenue
        FROM "Transaction" WHERE type='purchase' AND "createdAt" >= ${since}
        GROUP BY TO_CHAR("createdAt", 'YYYY-MM-DD') ORDER BY date`,

      prisma.$queryRaw`
        SELECT TO_CHAR("placedAt", 'YYYY-MM-DD') as date, COUNT(*)::int as count
        FROM "Order" WHERE "placedAt" >= ${since}
        GROUP BY TO_CHAR("placedAt", 'YYYY-MM-DD') ORDER BY date`,

      prisma.$queryRaw`
        SELECT TO_CHAR("createdAt", 'YYYY-MM-DD') as date, COUNT(*)::int as count
        FROM "User" WHERE "createdAt" >= ${since}
        GROUP BY TO_CHAR("createdAt", 'YYYY-MM-DD') ORDER BY date`,

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
        WHERE t.type = 'purchase' AND t."createdAt" >= ${since}
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
      revenueChart,
      ordersChart,
      newUsersChart,
      walletFlow,
      ordersStatusChart: Object.fromEntries(ordersStatusRaw.map(s => [s.status, s._count.id])),
      topProducts:       topProductsRaw.map(p => ({ name: p.name, sold: Number(p._sum.quantity || 0) })),
      topCategories,
      depositsByCurrency: depositsByCurrencyRaw.map(d => ({ currency: d.currency, value: Number(d._sum.usdCredited || 0) })),
      revenueByMethod:    revenueByMethodRaw.map(r => ({ method: r.paymentMethod, revenue: Number(r._sum.totalAmount || 0) })),
    }));
  },
};
