import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { notificationController } from '../controllers/notification.controller.js';

const r = Router();

r.use(requireAuth);
r.get('/',            notificationController.list);
r.patch('/read-all',  notificationController.markAllRead);
r.patch('/:id/read',  notificationController.markRead);

export default r;
