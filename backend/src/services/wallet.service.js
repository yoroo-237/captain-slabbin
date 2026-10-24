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

  async createDeposit(userId, currency) {
    const validCurrencies = ['BTC', 'LTC', 'DOGE', 'ETH', 'XMR'];
    if (!validCurrencies.includes(currency)) throw appError('Unsupported currency', 400);

    const settings = await prisma.siteSetting.findMany({
      where: { key: { in: ['deposit_expiry_hours'] } },
    });
    const expiryHours = parseInt(settings.find(s => s.key === 'deposit_expiry_hours')?.value || '12', 10);
    const expiresAt   = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    const deposit = await prisma.deposit.create({
      data: { userId, currency, expiresAt },
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
  async confirmDeposit(depositId, cryptoAmount, note = null) {
    const gross = balanceService.round8(Number(cryptoAmount));
    if (!(gross > 0)) throw appError('Received amount must be positive', 400);

    const deposit = await prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
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
          note:         note || `${gross} ${deposit.currency} received, ${pct}% deposit fee (${commission} ${deposit.currency})`,
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

  async cleanupExpiredDeposits() {
    const toExpire = await prisma.deposit.findMany({
      where: {
        status:    { in: ['awaiting', 'partial'] },
        expiresAt: { lt: new Date() },
      },
    });

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
