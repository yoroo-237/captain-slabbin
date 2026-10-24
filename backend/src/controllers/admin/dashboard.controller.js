import { prisma } from '../../db.js';
import { ok } from '../../utils/response.js';

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export const dashboardController = {
  async get(req, res) {
    const today  = startOfToday();
    const month  = startOfMonth();
    const week   = daysAgo(7);
    const days30 = daysAgo(30);
    const days7  = daysAgo(7);

    const [
      totalRev, todayRev, weekRev, monthRev,
      totalOrders, todayOrders, pendingOrders, shippedOrders,
      totalUsers, todayUsers,
      totalProducts, lowStockCount,
      openTickets, urgentTickets,
      recentOrders, lowStockProducts, recentTickets,
      ordersStatusRaw, topProductsRaw,
    ] = await Promise.all([
      prisma.transaction.aggregate({ where: { type: 'purchase', status: 'confirmed' },                               _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { type: 'purchase', status: 'confirmed', createdAt: { gte: today  } }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { type: 'purchase', status: 'confirmed', createdAt: { gte: week   } }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { type: 'purchase', status: 'confirmed', createdAt: { gte: month  } }, _sum: { amount: true } }),
      prisma.order.count(),
      prisma.order.count({ where: { placedAt: { gte: today } } }),
      prisma.order.count({ where: { status: 'processing'  } }),
      prisma.order.count({ where: { status: 'shipped'     } }),
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.product.count({ where: { isActive: true } }),
      prisma.product.count({ where: { isActive: true, stock: { lte: 10, gt: 0 } } }),
      prisma.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
      prisma.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] }, priority: 'urgent' } }),
      prisma.order.findMany({
        take:    10,
        orderBy: { placedAt: 'desc' },
        include: { user: { select: { username: true } } },
      }),
      prisma.product.findMany({
        where:   { isActive: true, stock: { lte: 10, gt: 0 } },
        take:    5,
        orderBy: { stock: 'asc' },
        select:  { id: true, name: true, stock: true, images: { take: 1, orderBy: { position: 'asc' } } },
      }),
      prisma.supportTicket.findMany({
        where:   { status: 'open', assignedTo: null },
        take:    5,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true } } },
      }),
      prisma.order.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.orderItem.groupBy({
        by:      ['productId', 'name'],
        _sum:    { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take:    5,
      }),
    ]);

    // Revenue chart — last 30 days
    const revenueChartRaw = await prisma.$queryRaw`
      SELECT TO_CHAR("createdAt", 'YYYY-MM-DD') as date,
             ABS(SUM(amount))::float             as revenue
      FROM   "Transaction"
      WHERE  type = 'purchase'
        AND  "createdAt" >= ${days30}
      GROUP  BY TO_CHAR("createdAt", 'YYYY-MM-DD')
      ORDER  BY date
    `;

    // New users — last 7 days
    const newUsersChartRaw = await prisma.$queryRaw`
      SELECT TO_CHAR("createdAt", 'YYYY-MM-DD') as date,
             COUNT(*)::int                       as users
      FROM   "User"
      WHERE  "createdAt" >= ${days7}
      GROUP  BY TO_CHAR("createdAt", 'YYYY-MM-DD')
      ORDER  BY date
    `;

    // Convert BigInt values from raw queries to numbers
    const revenueChart  = revenueChartRaw.map(r => ({ date: r.date, revenue: Number(r.revenue || 0) }));
    const newUsersChart = newUsersChartRaw.map(r => ({ date: r.date, users: Number(r.users || 0) }));

    // ordersStatusChart as array [{name, value}] for PieChart
    const ordersStatusChart = ordersStatusRaw.map(s => ({
      name:  s.status,
      value: s._count.id,
    }));

    res.json(ok({
      stats: {
        totalRevenue:    Math.abs(Number(totalRev._sum.amount   || 0)),
        totalOrders,
        pendingOrders,
        shippedOrders,
        totalUsers,
        totalProducts,
        openTickets,
        revenueThisMonth: Math.abs(Number(monthRev._sum.amount || 0)),
        // extras
        revenueToday:    Math.abs(Number(todayRev._sum.amount  || 0)),
        revenueThisWeek: Math.abs(Number(weekRev._sum.amount   || 0)),
        urgentTickets,
        todayOrders,
        todayUsers,
        lowStockCount,
      },
      charts: {
        revenueChart,
        ordersStatusChart,
        newUsersChart,
        topProducts: topProductsRaw.map(p => ({
          name:  p.name,
          sales: Number(p._sum.quantity || 0),
        })),
      },
      recentOrders: recentOrders.map(o => ({
        ...o,
        total: Number(o.totalAmount || 0),
      })),
      lowStockProducts,
      recentTickets,
    }));
  },
};
