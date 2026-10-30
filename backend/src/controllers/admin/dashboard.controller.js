import { prisma } from '../../db.js';
import { ok } from '../../utils/response.js';
import { shopWhere, orderShopWhere, itemShopWhere, customerShopWhere } from '../../utils/shops.js';

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

// Rows summed per day ('YYYY-MM-DD'), oldest first
function perDay(rows, dateOf, valueOf, key) {
  const days = new Map();
  for (const r of rows) {
    const d = dateOf(r).toISOString().slice(0, 10);
    days.set(d, (days.get(d) || 0) + valueOf(r));
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, [key]: v }));
}

export const dashboardController = {
  // ?shop=site | <catalog> | all: the figures of one shop. A shop's revenue and
  // orders are those holding its products, its customers are who ordered there.
  // Tickets belong to no shop and stay the same in every view.
  async get(req, res) {
    const shop   = req.query.shop;
    const today  = startOfToday();
    const month  = startOfMonth();
    const week   = daysAgo(7);
    const days30 = daysAgo(30);
    const days7  = daysAgo(7);

    const orders    = orderShopWhere(shop);
    const sales     = { type: 'purchase', status: 'confirmed', ...(Object.keys(orders).length ? { order: orders } : {}) };
    const customers = customerShopWhere(shop);
    const products  = { isActive: true, ...shopWhere(shop) };

    const [
      totalRev, todayRev, weekRev, monthRev,
      totalOrders, todayOrders, pendingOrders, shippedOrders,
      totalUsers, todayUsers,
      totalProducts, lowStockCount,
      openTickets, urgentTickets,
      recentOrders, lowStockProducts, recentTickets,
      ordersStatusRaw, topProductsRaw,
      revenueRows, newUserRows,
    ] = await Promise.all([
      prisma.transaction.aggregate({ where: sales,                                 _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { ...sales, createdAt: { gte: today } }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { ...sales, createdAt: { gte: week  } }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { ...sales, createdAt: { gte: month } }, _sum: { amount: true } }),
      prisma.order.count({ where: orders }),
      prisma.order.count({ where: { ...orders, placedAt: { gte: today } } }),
      prisma.order.count({ where: { ...orders, status: 'processing' } }),
      prisma.order.count({ where: { ...orders, status: 'shipped'    } }),
      prisma.user.count({ where: customers }),
      prisma.user.count({ where: { ...customers, createdAt: { gte: today } } }),
      prisma.product.count({ where: products }),
      prisma.product.count({ where: { ...products, stock: { lte: 10, gt: 0 } } }),
      prisma.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
      prisma.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] }, priority: 'urgent' } }),
      prisma.order.findMany({
        where:   orders,
        take:    10,
        orderBy: { placedAt: 'desc' },
        include: { user: { select: { username: true } }, items: { take: 1, select: { product: { select: { source: true } } } } },
      }),
      prisma.product.findMany({
        where:   { ...products, stock: { lte: 10, gt: 0 } },
        take:    5,
        orderBy: { stock: 'asc' },
        select:  { id: true, name: true, stock: true, source: true, images: { take: 1, orderBy: { position: 'asc' } } },
      }),
      prisma.supportTicket.findMany({
        where:   { status: 'open', assignedTo: null },
        take:    5,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true } } },
      }),
      prisma.order.groupBy({ by: ['status'], where: orders, _count: { id: true } }),
      prisma.orderItem.groupBy({
        by:      ['productId', 'name'],
        where:   itemShopWhere(shop),
        _sum:    { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take:    5,
      }),
      // Revenue chart: last 30 days
      prisma.transaction.findMany({
        where:  { type: 'purchase', createdAt: { gte: days30 }, ...(Object.keys(orders).length ? { order: orders } : {}) },
        select: { createdAt: true, amount: true },
      }),
      // New customers: last 7 days
      prisma.user.findMany({ where: { ...customers, createdAt: { gte: days7 } }, select: { createdAt: true } }),
    ]);

    const revenueChart  = perDay(revenueRows, r => r.createdAt, r => Math.abs(Number(r.amount || 0)), 'revenue');
    const newUsersChart = perDay(newUserRows, u => u.createdAt, () => 1, 'users');

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
      recentOrders: recentOrders.map(({ items, ...o }) => ({
        ...o,
        source: items[0]?.product?.source ?? null,
        total: Number(o.totalAmount || 0),
      })),
      lowStockProducts,
      recentTickets,
    }));
  },
};
