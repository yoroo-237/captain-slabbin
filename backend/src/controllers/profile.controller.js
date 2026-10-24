import bcrypt from 'bcrypt';
import { appError } from '../utils/formatters.js';
import { getUserBalance } from '../services/balance.service.js';
import { prisma } from '../db.js';
import { ok } from '../utils/response.js';
import { getUserTier } from '../utils/formatters.js';

const PROFILE_SELECT = {
  id: true, username: true, role: true, bio: true,
  telegramHandle: true, signalDetails: true, sessionDetails: true,
  btcRefundAddress: true, xmrRefundAddress: true,
  points: true, totalSpent: true, markupPct: true,
  avatarUrl: true, hidePrices: true,
  notifOrders: true, notifDeposits: true, notifTickets: true,
  notifNewProducts: true, notifLogins: true,
  tourCompleted: true, lastLoginAt: true, createdAt: true,
};

const EDITABLE_FIELDS = [
  'bio', 'telegramHandle', 'signalDetails', 'sessionDetails',
  'btcRefundAddress', 'xmrRefundAddress',
  'hidePrices', 'notifOrders', 'notifDeposits', 'notifTickets',
  'notifNewProducts', 'notifLogins', 'tourCompleted',
];

export const profileController = {
  async get(req, res) {
    const user = await prisma.user.findUniqueOrThrow({
      where:  { id: req.user.sub },
      select: PROFILE_SELECT,
    });
    const { balance } = await getUserBalance(user.id);
    res.json(ok({ ...user, balance, tier: getUserTier(user.totalSpent) }));
  },

  async update(req, res) {
    const data = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => EDITABLE_FIELDS.includes(k)),
    );
    await prisma.user.update({ where: { id: req.user.sub }, data });
    res.json(ok({ message: 'Profile updated' }));
  },

  async changePassword(req, res) {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) throw appError('New password must be at least 8 characters', 400);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });
    if (!(await bcrypt.compare(String(currentPassword || ''), user.passwordHash))) throw appError('Current password is incorrect', 400);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(String(newPassword), 12) } });
    res.json(ok({ message: 'Password updated' }));
  },
};
