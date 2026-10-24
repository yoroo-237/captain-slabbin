import bcrypt from 'bcrypt';
import { prisma } from '../../db.js';
import { walletService } from '../../services/wallet.service.js';
import { getUserBalance, getBalancesForUsers } from '../../services/balance.service.js';
import { ok } from '../../utils/response.js';
import { parsePaginationParams, buildPagination } from '../../utils/pagination.js';
import { getUserTier, appError } from '../../utils/formatters.js';

const VALID_ROLES = ['customer', 'moderator', 'admin', 'superadmin'];
const isAdminRole = role => ['admin', 'superadmin'].includes(role);

// Who may give `role` to an account: staff roles need an admin, and only a super
// admin can create another super admin (or demote one).
function assertCanAssignRole(actor, role) {
  if (!VALID_ROLES.includes(role)) throw appError(`Invalid role. Valid values: ${VALID_ROLES.join(', ')}`, 400);
  if (role === 'superadmin' && actor.role !== 'superadmin') throw appError('Only a super admin can grant the super admin role', 403);
  if (role !== 'customer' && !isAdminRole(actor.role)) throw appError('Only an admin can grant staff roles', 403);
}

// A super admin account can only be modified by a super admin.
async function assertCanModify(actor, userId) {
  const target = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
  if (target.role === 'superadmin' && actor.role !== 'superadmin') {
    throw appError('This account can only be modified by a super admin', 403);
  }
  return target;
}

export const adminUsersController = {
  async list(req, res) {
    const { page, limit, skip } = parsePaginationParams(req.query);
    const { search, tier, role, isActive, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const where = {};
    if (search)               where.username = { contains: search.trim(), mode: 'insensitive' };
    if (role)                 where.role     = role;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    if (tier) {
      const ranges = {
        basic:     { gte: 0,    lte: 999.99  },
        preferred: { gte: 1000, lte: 1999.99 },
        gold:      { gte: 2000, lte: 4999.99 },
        platinum:  { gte: 5000             },
      };
      if (ranges[tier]) where.totalSpent = ranges[tier];
    }

    // Balances are live crypto valuations, so they can't be sorted in the database
    const VALID_SORTS = ['createdAt', 'username', 'totalSpent', 'lastLoginAt'];
    const orderBy = {
      [VALID_SORTS.includes(sortBy) ? sortBy : 'createdAt']: sortOrder === 'asc' ? 'asc' : 'desc',
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where, skip, take: limit, orderBy,
        select: {
          id: true, username: true, role: true, isActive: true,
          totalSpent: true, points: true,
          createdAt: true, lastLoginAt: true,
          _count: { select: { orders: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const balances = await getBalancesForUsers(users.map(u => u.id));
    const mapped = users.map(u => ({ ...u, balance: balances[u.id] || 0, tier: getUserTier(u.totalSpent) }));
    res.json(ok({ users: mapped, pagination: buildPagination(page, limit, total) }));
  },

  async create(req, res) {
    const { username, password, role = 'customer' } = req.body;
    if (!username?.trim()) throw appError('Username is required', 400);
    if (!password || password.length < 6) throw appError('Password is required (min 6 characters)', 400);
    assertCanAssignRole(req.user, role);

    const exists = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (exists) throw appError('Username already taken', 409);

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { username: username.trim(), passwordHash, role },
    });
    res.status(201).json(ok({ id: user.id, username: user.username, role: user.role }));
  },

  async getOne(req, res) {
    const id = parseInt(req.params.id, 10);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id },
      include: {
        orders:       { take: 5, orderBy: { placedAt: 'desc' },    include: { items: true } },
        transactions: { take: 5, orderBy: { createdAt: 'desc' } },
        deposits:     { take: 5, orderBy: { createdAt: 'desc' } },
        tickets:      { take: 3, orderBy: { createdAt: 'desc' } },
        apiKeys:      {          orderBy: { createdAt: 'desc' } },
      },
    });
    const { passwordHash: _, ...safe } = user;
    const wallet = await getUserBalance(id);
    res.json(ok({ ...safe, balance: wallet.balance, holdings: wallet.holdings, tier: getUserTier(user.totalSpent) }));
  },

  async update(req, res) {
    const id = parseInt(req.params.id, 10);
    const { username, role, isActive, markupPct } = req.body;
    const target = await assertCanModify(req.user, id);
    if (role !== undefined && role !== target.role) assertCanAssignRole(req.user, role);
    const data = {};
    if (username  !== undefined) data.username  = username.trim();
    if (role      !== undefined) data.role      = role;
    if (isActive  !== undefined) data.isActive  = Boolean(isActive);
    if (markupPct !== undefined) data.markupPct = parseFloat(markupPct);
    const user = await prisma.user.update({ where: { id }, data });
    res.json(ok({ id: user.id, username: user.username, role: user.role }));
  },

  async ban(req, res) {
    const id   = parseInt(req.params.id, 10);
    await assertCanModify(req.user, id);
    if (id === req.user.sub) throw appError('You cannot ban your own account', 400);
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    const updated = await prisma.user.update({
      where: { id },
      data:  { isActive: !user.isActive },
    });
    res.json(ok({ isActive: updated.isActive, message: updated.isActive ? 'Account reactivated' : 'Account banned' }));
  },

  async setPassword(req, res) {
    const id = parseInt(req.params.id, 10);
    const { password } = req.body;
    if (!password || password.length < 6) throw appError('Password too short (min 6 characters)', 400);
    await assertCanModify(req.user, id);
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { id }, data: { passwordHash } });
    res.json(ok({ message: 'Password updated' }));
  },

  async adjustWallet(req, res) {
    const id = parseInt(req.params.id, 10);
    const { type, amount, usdAmount, reason, currency } = req.body;
    await assertCanModify(req.user, id);
    const inUsd = !(parseFloat(amount) > 0) && parseFloat(usdAmount) > 0;
    const txn = await walletService.adjustBalance(
      id, type, parseFloat(inUsd ? usdAmount : amount), reason, String(currency || '').toUpperCase(), inUsd ? 'usd' : 'crypto'
    );
    const wallet = await getUserBalance(id);
    res.json(ok({ transaction: txn, newBalance: wallet.balance, holdings: wallet.holdings }));
  },

  async remove(req, res) {
    const id = parseInt(req.params.id, 10);
    await assertCanModify(req.user, id);
    if (id === req.user.sub) throw appError('You cannot delete your own account', 400);

    await prisma.$transaction(async (tx) => {
      // Nullify Deposit→Transaction FK before deleting transactions
      await tx.deposit.updateMany({ where: { userId: id }, data: { transactionId: null } });

      await tx.ticketMessage.deleteMany({ where: { userId: id } });
      await tx.supportTicket.deleteMany({ where: { userId: id } });
      await tx.review.deleteMany({ where: { userId: id } });
      await tx.notification.deleteMany({ where: { userId: id } });
      await tx.apiKey.deleteMany({ where: { userId: id } });
      await tx.deposit.deleteMany({ where: { userId: id } });
      await tx.transaction.deleteMany({ where: { userId: id } });
      await tx.order.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
    });

    res.json(ok({ message: 'User deleted' }));
  },
};
