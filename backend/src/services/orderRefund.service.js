import { prisma } from '../db.js';
import { appError, formatTxnId } from '../utils/formatters.js';
import * as balanceService from './balance.service.js';
import { cryptoService } from './crypto.service.js';
import { dmUser, escapeHtml } from './telegram.service.js';

// Refunds of the bot's orders that an admin approves: a payment after the 30 minutes, a short
// payment on an order that expired, a surplus. A request takes its amount off the customer's
// holding at once (so it cannot be spent meanwhile) and gives it back if it is rejected.

// The refund address the customer gave at checkout, kept in the order's notes
const addressOf = note => /Refund address \([A-Z]+\):\s*(\S+)/.exec(note || '')?.[1] || null;

export const orderRefundService = {
  async request({ userId, orderId = null, depositId, currency, amount, reason }) {
    const qty = balanceService.round8(Number(amount));
    if (!(qty > 0)) return null;
    const order = orderId ? await prisma.order.findUnique({ where: { id: orderId }, select: { orderNumber: true, note: true } }) : null;
    const req = await prisma.$transaction(async (tx) => {
      // The money is on the customer's holding: it leaves it now (never below what is there)
      const row = await tx.walletHolding.findUnique({ where: { userId_currency: { userId, currency } } });
      const held = row ? parseFloat(row.amount) : 0;
      const take = Math.min(qty, held);
      if (!(take > 0)) return null;
      await balanceService.debit(tx, userId, currency, take);
      return tx.refundRequest.create({ data: { userId, orderId, depositId, currency, amount: take, address: addressOf(order?.note), reason } });
    });
    if (req) {
      dmUser(userId, `↩️ A refund of <code>${req.amount} ${currency}</code>${order ? ` for <b>${escapeHtml(order.orderNumber)}</b>` : ''} was requested (${escapeHtml(reason)}). The shop approves it, then it is sent to your refund address.`).catch(() => {});
    }
    return req;
  },

  list(status) {
    return prisma.refundRequest.findMany({
      where: status ? { status } : {}, orderBy: { id: 'desc' }, take: 200,
      include: { user: { select: { id: true, username: true } } },
    });
  },

  // Approve: the refund is sent from the deposit address. XMR (no key here) is sent by hand
  // from the shop's wallet, then marked as sent.
  async approve(id) {
    const { count } = await prisma.refundRequest.updateMany({ where: { id, status: 'pending' }, data: { status: 'sending', error: null } });
    if (!count) throw appError('This refund is not waiting for approval', 409);
    const req = await prisma.refundRequest.findUniqueOrThrow({ where: { id } });
    let txHash;
    try {
      if (!req.address) throw appError('No refund address on this order: ask the customer for one', 400);
      if (req.currency === 'XMR') {
        await prisma.refundRequest.update({ where: { id }, data: { status: 'manual' } });
        return { status: 'manual', address: req.address, amount: req.amount };
      }
      const dep = await prisma.deposit.findUniqueOrThrow({ where: { id: req.depositId } });
      // What is left on a swept address is the reserve's commission, not this refund's money
      if (dep.shopSweptAt) throw appError('This deposit was already swept: send the refund by hand, or reject it', 409);
      ({ txHash } = await cryptoService.refundFromDeposit(dep, req.amount, req.address));
    } catch (err) {
      // Nothing was sent: back to pending, with the reason, to retry or reject
      await prisma.refundRequest.update({ where: { id }, data: { status: 'pending', error: String(err.response?.data?.error || err.message).slice(0, 500) } });
      throw err;
    }
    // The money has left: whatever happens now, it never goes back to pending (a retry would send it twice)
    try {
      await this.finish(req, txHash);
    } catch (err) {
      await prisma.refundRequest.update({ where: { id }, data: { txHash, error: `Sent, but not recorded: ${err.message}`.slice(0, 500) } }).catch(() => {});
      throw err;
    }
    return { status: 'refunded', txHash };
  },

  // A refund sent by hand (XMR): the admin gives the transaction id
  async markSent(id, txHash) {
    const req = await prisma.refundRequest.findUnique({ where: { id } });
    if (!req || req.status !== 'manual') throw appError('This refund is not waiting to be sent by hand', 409);
    await this.finish(req, String(txHash || '').trim().slice(0, 200) || null);
    return { status: 'refunded' };
  },

  async finish(req, txHash) {
    await prisma.$transaction(async (tx) => {
      // Guarded by its status: a double click or a reject at the same moment cannot also go through
      const { count } = await tx.refundRequest.updateMany({ where: { id: req.id, status: req.status }, data: { status: 'refunded', txHash, decidedAt: new Date() } });
      if (!count) throw appError('This refund was already handled', 409);
      await tx.transaction.create({
        data: {
          frontendId: formatTxnId(), userId: req.userId, type: 'adjustment', amount: 0, currency: req.currency,
          cryptoAmount: -req.amount, status: 'confirmed',
          note: `Refund to ${req.address}${txHash ? ` (${txHash})` : ''}${req.orderId ? ` · order #${req.orderId}` : ''}: ${req.reason}`,
        },
      });
    });
    dmUser(req.userId, `✅ <b>Refund sent</b>\n<code>${req.amount} ${req.currency}</code> to <code>${escapeHtml(req.address)}</code>.`).catch(() => {});
  },

  async reject(id) {
    const req = await prisma.refundRequest.findUnique({ where: { id } });
    if (!req || !['pending', 'manual'].includes(req.status)) throw appError('This refund can no longer be rejected', 409);
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.refundRequest.updateMany({ where: { id, status: req.status }, data: { status: 'rejected', decidedAt: new Date() } });
      if (count) await balanceService.credit(tx, req.userId, req.currency, Number(req.amount));
    });
    return { status: 'rejected' };
  },
};
