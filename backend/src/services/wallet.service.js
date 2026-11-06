import { env } from '../config/env.js';
import { currentTenant, withTenant } from '../tenant.js';
import { prisma } from '../db.js';
import { cryptoService } from './crypto.service.js';
import { notificationService } from './notification.service.js';
import { formatTxnId, getUserTier, getCashbackRate, appError } from '../utils/formatters.js';
import * as balanceService from './balance.service.js';
import { getCachedUsdPrice } from './price.service.js';

export const walletService = {
  async getWalletInfo(userId) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const settings = await prisma.siteSetting.findMany({
      where: { key: { in: ['points_rate'] } },
    });
    const pointsRate = parseFloat(settings.find(s => s.key === 'points_rate')?.value || '0.5');

    const tier         = getUserTier(user.totalSpent);
    const cashbackRate = getCashbackRate(tier);

    const tierLimits = { basic: 1000, preferred: 2000, gold: 5000, platinum: null };
    const limit      = tierLimits[tier];
    const remaining  = limit !== null ? Math.max(0, limit - Number(user.totalSpent)) : null;

    const [{ balance, holdings, pricesComplete }, commissionPct] = await Promise.all([
      balanceService.getUserBalance(userId),
      balanceService.getCommissionPct(),
    ]);

    return {
      balance,          // USD, live: Σ holding × current price
      holdings,         // [{ currency, amount, price, usd }]
      pricesComplete,
      pricedAt:   new Date().toISOString(),
      commissionPct,    // deducted from each deposit, shown before the customer tops up
      points:     user.points,
      totalSpent: Number(user.totalSpent),
      tier,
      cashback:   cashbackRate * 100,
      pointsRate,
      remaining,
    };
  },

  // `orderId` / `minutes` / `expected`: a bot order's own deposit (30-minute window,
  // the gross amount asked for); without them, a wallet top-up.
  async createDeposit(userId, currency, { orderId = null, minutes = null, expected = null } = {}) {
    const validCurrencies = ['BTC', 'LTC', 'DOGE', 'ETH', 'XMR'];
    if (!validCurrencies.includes(currency)) throw appError('Unsupported currency', 400);

    const settings = await prisma.siteSetting.findMany({
      where: { key: { in: ['deposit_expiry_hours'] } },
    });
    const expiryHours = parseInt(settings.find(s => s.key === 'deposit_expiry_hours')?.value || '12', 10);
    const expiresAt   = new Date(Date.now() + (minutes ? minutes * 60 * 1000 : expiryHours * 60 * 60 * 1000));

    const deposit = await prisma.deposit.create({
      data: { userId, currency, expiresAt, orderId, amountExpected: expected },
    });

    let addrResult;
    try {
      addrResult = await cryptoService.generateAddress(currency, deposit.id);
    } catch (err) {
      await prisma.deposit.delete({ where: { id: deposit.id } }).catch(() => {});
      throw err;
    }

    const { address, hookId = null, ethIndex = null } = addrResult;

    return prisma.deposit.update({
      where: { id: deposit.id },
      data:  { address, hookId, ethIndex },
    });
  },

  // Credits a deposit from the crypto amount actually received. The commission is
  // taken here: the customer's holding grows by the net amount only, and the
  // commission stays on the deposit address for the super admin's reserve sweep.
  // The USD price is informative only, so a missing price never blocks a credit.
  // `opts.cumulative`: the amount is the address's total received so far (a bot order's payments add up);
  // `opts.txHash`: the one transaction it comes from, counted once.
  async confirmDeposit(depositId, cryptoAmount, note = null, opts = {}) {
    // A blockchain webhook has no owner in context: credit as the customer's owner
    // (bots platform), so their notifications go through that owner's bots
    if (env.platform === 'bots' && currentTenant() === null) {
      const owner = await prisma.deposit.findUnique({ where: { id: depositId }, select: { user: { select: { tenantId: true } } } });
      if (owner) return withTenant(owner.user.tenantId, () => this.confirmDeposit(depositId, cryptoAmount, note, opts));
    }
    const gross = balanceService.round8(Number(cryptoAmount));
    if (!(gross > 0)) throw appError('Received amount must be positive', 400);

    const deposit = await prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
    if (deposit.orderId) return this.receiveOrderPayment(deposit, gross, opts, note);
    if (deposit.status === 'confirmed') throw appError('This deposit is already confirmed', 409);

    const price = await getCachedUsdPrice(deposit.currency);
    const pct   = await balanceService.getCommissionPct();
    const { commission, net } = balanceService.splitDeposit(gross, pct);
    const netUsd = price ? balanceService.round2(net * price) : 0;

    const txn = await prisma.$transaction(async (tx) => {
      // Claim the deposit atomically: the webhook and the customer's on-chain check
      // can confirm the same deposit concurrently — only one of them may credit it.
      const { count } = await tx.deposit.updateMany({
        where: { id: depositId, status: { not: 'confirmed' } },
        data:  {
          status: 'confirmed', confirmedAt: new Date(),
          amountReceived: gross, usdCredited: netUsd,
          commissionPct: pct, commissionAmount: commission, netAmount: net,
        },
      });
      if (count === 0) throw appError('This deposit is already confirmed', 409);

      const txn = await tx.transaction.create({
        data: {
          frontendId:   formatTxnId(),
          userId:       deposit.userId,
          type:         'deposit',
          amount:       netUsd,
          currency:     deposit.currency,
          cryptoAmount: net,
          rate:         price || null,
          status:       'confirmed',
          note:         note || `${gross} ${deposit.currency} received, ${pct/10}% deposit fee (${commission} ${deposit.currency})`,
        },
      });

      await tx.deposit.update({
        where: { id: depositId },
        data:  { transactionId: txn.id },
      });

      await balanceService.credit(tx, deposit.userId, deposit.currency, net);
      return txn;
    });

    await notificationService.notifyDeposit(deposit.userId, deposit.currency, netUsd, net);
    return txn;
  },

  // A bot order's deposit: several payments add up. Each one is credited (net of the commission)
  // as it arrives; once the order has what it needs, settlePendingOrder takes its price.
  async receiveOrderPayment(deposit, gross, { cumulative = false, txHash = null } = {}, note = null) {
    if (txHash && Array.isArray(deposit.txSeen) && deposit.txSeen.includes(txHash)) return null;
    const delta = balanceService.round8(cumulative ? gross - Number(deposit.amountReceived) : gross);
    if (!(delta > 0)) return null;
    const price = await getCachedUsdPrice(deposit.currency);
    const pct   = await balanceService.getCommissionPct();
    const { commission, net } = balanceService.splitDeposit(delta, pct);
    const netUsd = price ? balanceService.round2(net * price) : 0;

    const txn = await prisma.$transaction(async (tx) => {
      // Guarded by the amount read above: two reports of the same payment credit it once
      const { count } = await tx.deposit.updateMany({
        where: { id: deposit.id, amountReceived: deposit.amountReceived },
        data: {
          amountReceived: { increment: delta }, commissionAmount: { increment: commission }, netAmount: { increment: net },
          usdCredited: { increment: netUsd }, commissionPct: pct,
          ...(deposit.status === 'awaiting' ? { status: 'partial' } : {}),
          ...(txHash ? { txSeen: [...(Array.isArray(deposit.txSeen) ? deposit.txSeen : []), txHash] } : {}),
        },
      });
      if (count === 0) return null;
      const t = await tx.transaction.create({
        data: {
          frontendId: formatTxnId(), userId: deposit.userId, type: 'deposit', amount: netUsd, currency: deposit.currency,
          cryptoAmount: net, rate: price || null, status: 'confirmed',
          note: note || `${delta} ${deposit.currency} received for an order, ${pct}% deposit fee (${commission} ${deposit.currency})`,
        },
      });
      if (!deposit.transactionId) await tx.deposit.update({ where: { id: deposit.id }, data: { transactionId: t.id } });
      await balanceService.credit(tx, deposit.userId, deposit.currency, net);
      return t;
    });
    if (!txn) return null;
    const fresh = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    const { orderService } = await import('./order.service.js');
    await orderService.settlePendingOrder(deposit.orderId, { currency: deposit.currency, net: Number(fresh.netAmount), deltaNet: net, depositId: deposit.id });
    return txn;
  },

  async cleanupExpiredDeposits() {
    const lapsed = await prisma.deposit.findMany({
      where: {
        status:    { in: ['awaiting', 'partial'] },
        expiresAt: { lt: new Date() },
      },
    });
    // An order still awaiting payment is about to be cancelled, which keeps its deposit watched
    // for 24 hours: expired now, a late payment would never be seen, nor refunded
    const orderIds = lapsed.map(d => d.orderId).filter(Boolean);
    const open = orderIds.length
      ? await prisma.order.findMany({ where: { id: { in: orderIds }, status: 'awaiting_payment' }, select: { id: true } })
      : [];
    const openIds = new Set(open.map(o => o.id));
    const toExpire = lapsed.filter(d => !openIds.has(d.orderId));

    if (toExpire.length === 0) return { cleaned: 0 };

    // Delete BlockCypher forwards for BTC/LTC/DOGE (fire-and-forget, errors are logged internally)
    await Promise.allSettled(
      toExpire
        .filter(d => d.hookId && ['BTC', 'LTC', 'DOGE'].includes(d.currency))
        .map(d => cryptoService.deleteBlockcypherHook(d.hookId, d.currency))
    );

    await prisma.deposit.updateMany({
      where: { id: { in: toExpire.map(d => d.id) } },
      data:  { status: 'expired' },
    });

    return { cleaned: toExpire.length };
  },

  // Credits or debits a customer's crypto holding. `amount` is in crypto, or in
  // USD when unit === 'usd' (converted at the current price).
  async adjustBalance(userId, type, amount, reason, currency, unit = 'crypto') {
    if (!['credit', 'debit'].includes(type)) throw appError('Invalid type: use "credit" or "debit"', 400);
    if (!reason || !reason.trim())           throw appError('Reason is required', 400);
    if (!balanceService.CURRENCIES.includes(currency)) {
      throw appError(`currency must be one of ${balanceService.CURRENCIES.join(', ')}`, 400);
    }

    const price = await getCachedUsdPrice(currency);
    let qty = Number(amount);
    if (unit === 'usd') {
      if (!price) throw appError(`${currency} price unavailable — enter the amount in ${currency}`, 503);
      qty = qty / price;
    }
    qty = balanceService.round8(qty);
    if (!(qty > 0)) throw appError('Amount must be positive', 400);

    const usd = price ? balanceService.round2(qty * price) : 0;

    return prisma.$transaction(async (tx) => {
      if (type === 'credit') await balanceService.credit(tx, userId, currency, qty);
      else await balanceService.debit(tx, userId, currency, qty);

      return tx.transaction.create({
        data: {
          frontendId:   formatTxnId(),
          userId,
          type:         'adjustment',
          amount:       type === 'credit' ? usd : -usd,
          currency,
          cryptoAmount: type === 'credit' ? qty : -qty,
          rate:         price || null,
          status:       'confirmed',
          note:         reason.trim(),
        },
      });
    });
  },
};
