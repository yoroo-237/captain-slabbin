import { prisma } from '../db.js';
import { ok } from '../utils/response.js';

export const notificationController = {
  async list(req, res) {
    const notifications = await prisma.notification.findMany({
      where:   { userId: req.user.sub },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
    const unread = notifications.filter(n => !n.isRead).length;
    res.json(ok({ notifications, unread }));
  },

  async markRead(req, res) {
    await prisma.notification.updateMany({
      where: { id: parseInt(req.params.id, 10), userId: req.user.sub },
      data:  { isRead: true },
    });
    res.json(ok({ read: true }));
  },

  async markAllRead(req, res) {
    const { count } = await prisma.notification.updateMany({
      where: { userId: req.user.sub, isRead: false },
      data:  { isRead: true },
    });
    res.json(ok({ updated: count }));
  },
};
