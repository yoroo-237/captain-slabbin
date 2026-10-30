import { Router } from 'express';
import { requireAuth, requireModerator } from '../../middlewares/auth.js';

import dashboardRoutes    from './dashboard.routes.js';
import usersRoutes        from './users.routes.js';
import ordersRoutes       from './orders.routes.js';
import productsRoutes     from './products.routes.js';
import depositsRoutes     from './deposits.routes.js';
import transactionsRoutes from './transactions.routes.js';
import supportRoutes      from './support.routes.js';
import analyticsRoutes    from './analytics.routes.js';
import settingsRoutes     from './settings.routes.js';
import contentRoutes      from './content.routes.js';
import sweepRoutes        from './sweep.routes.js';
import inboxRoutes        from './inbox.routes.js';
import telegramRoutes     from './telegram.routes.js';
import pushRoutes         from './push.routes.js';
import vouchersRoutes     from './vouchers.routes.js';
import captureRoutes      from './capture.routes.js';
import { prisma }         from '../../db.js';
import { ok }             from '../../utils/response.js';

const r = Router();

// All admin routes require auth + moderator/admin role
r.use(requireAuth, requireModerator);

r.use('/dashboard',    dashboardRoutes);
r.use('/users',        usersRoutes);
r.use('/orders',       ordersRoutes);
r.use('/products',     productsRoutes);
r.use('/deposits',     depositsRoutes);
r.use('/transactions', transactionsRoutes);
r.use('/support',      supportRoutes);
r.use('/analytics',    analyticsRoutes);
r.use('/settings',     settingsRoutes);
r.use('/telegram',     telegramRoutes);
r.use('/push',         pushRoutes);
r.use('/vouchers',     vouchersRoutes);
r.use('/capture',      captureRoutes);

// Counters for the admin menu: what is waiting for staff
r.get('/badges', async (req, res) => {
  const [messages, orders, tickets] = await Promise.all([
    prisma.message.count({ where: { isStaff: false, readAt: null } }),
    prisma.order.count({ where: { status: 'processing' } }),
    prisma.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
  ]);
  res.json(ok({ messages, orders, tickets }));
});
r.use('/',             sweepRoutes);
r.use('/',             inboxRoutes);
r.use('/',             contentRoutes);

export default r;
