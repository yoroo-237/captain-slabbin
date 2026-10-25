import bcrypt from 'bcrypt';
import { appError } from '../utils/formatters.js';
import { getUserBalance } from '../services/balance.service.js';
import { prisma } from '../db.js';
import { ok } from '../utils/response.js';
import { getUserTier } from '../utils/formatters.js';
import { signAccessToken } from '../utils/jwt.js';
import { connectUrl } from '../services/telegramShop.js';

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
      select: { ...PROFILE_SELECT, telegramId: true, passwordHash: true },
    });
    const { passwordHash, telegramId, ...rest } = user;
    const { balance } = await getUserBalance(user.id);
    res.json(ok({ ...rest, telegramConnected: !!telegramId, hasPassword: !passwordHash.startsWith('!'), balance, tier: getUserTier(user.totalSpent) }));
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
    // An account opened from the Telegram bot sets its first password without one
    if (!user.passwordHash.startsWith('!') && !(await bcrypt.compare(String(currentPassword || ''), user.passwordHash))) throw appError('Current password is incorrect', 400);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(String(newPassword), 12) } });
    res.json(ok({ message: 'Password updated' }));
  },

  // New sign-in name, confirmed with the current password. Returns a fresh
  // access token since the old one carries the old username.
  async changeUsername(req, res) {
    const username = String(req.body?.username || '').trim();
    if (username.length < 3) throw appError('Username too short (min 3 characters)', 400);
    if (!/^[A-Za-z0-9_.-]+$/.test(username)) throw appError('Letters, numbers, . _ - only', 400);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });
    if (!user.passwordHash.startsWith('!') && !(await bcrypt.compare(String(req.body?.currentPassword || ''), user.passwordHash))) throw appError('Current password is incorrect', 400);
    if (username !== user.username && await prisma.user.findUnique({ where: { username } })) throw appError('That username is taken', 409);
    const updated = await prisma.user.update({ where: { id: user.id }, data: { username } });
    const accessToken = signAccessToken({ sub: updated.id, role: updated.role, username: updated.username });
    res.json(ok({ username: updated.username, accessToken }));
  },

  // "Connect Telegram": a t.me link that ties this account to the customer's
  // Telegram in one tap (the bot then sends invoices and updates there)
  async telegramLink(req, res) {
    const url = await connectUrl(req.user.sub);
    if (!url) throw appError('The shop has no Telegram bot yet.', 503);
    res.json(ok({ url }));
  },

  async telegramUnlink(req, res) {
    await prisma.user.update({ where: { id: req.user.sub }, data: { telegramId: null } });
    res.json(ok({ telegramConnected: false }));
  },
};
