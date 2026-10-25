import { Router } from 'express';

import authRoutes         from './auth.routes.js';
import profileRoutes      from './profile.routes.js';
import walletRoutes       from './wallet.routes.js';
import orderRoutes        from './order.routes.js';
import productRoutes      from './product.routes.js';
import notificationRoutes from './notification.routes.js';
import ticketRoutes       from './ticket.routes.js';
import apikeyRoutes       from './apikey.routes.js';
import contentRoutes      from './content.routes.js';
import reviewRoutes       from './review.routes.js';
import webhookRoutes      from './webhook.routes.js';
import adminRoutes        from './admin/index.js';
import gateRoutes         from './gate.routes.js';
import telegramRoutes     from './telegram.routes.js';
import messageRoutes      from './message.routes.js';
import categoryRoutes     from './category.routes.js';
import { requireGate }    from '../middlewares/gate.js';

const router = Router();

router.use('/auth',          authRoutes);
router.use('/profile',       profileRoutes);
router.use('/wallet',        walletRoutes);
router.use('/orders',        orderRoutes);
router.use('/gate',          gateRoutes);
router.use('/products',      requireGate, productRoutes);
router.use('/categories',    requireGate, categoryRoutes);
router.use('/telegram',      telegramRoutes);
router.use('/messages',      messageRoutes);
router.use('/notifications', notificationRoutes);
router.use('/tickets',       ticketRoutes);
router.use('/api-keys',      apikeyRoutes);
router.use('/content',       contentRoutes);
router.use('/reviews',       reviewRoutes);
router.use('/webhooks',      webhookRoutes);
router.use('/admin',         adminRoutes);

export default router;
