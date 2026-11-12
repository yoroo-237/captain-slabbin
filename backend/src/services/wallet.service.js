import { env } from '../config/env.js';
import { currentTenant, withTenant } from '../tenant.js';
import { prisma } from '../db.js';
import { cryptoService } from './crypto.service.js';
import { notificationService } from './notification.service.js';
import { formatTxnId, getUserTier, getCashbackRate, appError } from '../utils/formatters.js';
import * as balanceService from './balance.service.js';
import { getCachedUsdPrice } from './price.service.js';

const CHAIN_HOOK = ['BTC', 'LTC', 'DOGE'];

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

  // Credits one payment received on a deposit address (the crypto amount actually received).
  // The commission is taken here: the customer's holding grows by the net amount only, and
  // the commission stays on the address for the super admin's reserve sweep.
  //  - a top-up's first payment confirms it;
  //  - any later payment (the customer sent to the same address again), and every payment of
  //    an order's deposit, is credited on its own by receivePayment.
  // `opts.txHash`: the transaction it comes from, counted once whatever reports it (webhook,
  // the customer's check, the admin's Check chain, a sweep). `opts.adminId`: entered by hand.
  // No minimum and no maximum: every payment received is credited.
  async confirmDeposit(depositId, cryptoAmount, note = null, opts = {}) {
    // A blockchain webhook has no owner in context: credit as the customer's owner
    // (bots platform), so their notifications go through that owner's bots
    if (env.platform === 'bots' && currentTenant() === null) {
      const owner = await prisma.deposit.findUnique({ where: { id: depositId }, select: { user: { select: { tenantId: true } } } });
      if (owner) return withTenant(owner.user.tenantId, () => this.confirmDeposit(depositId, cryptoAmount, note, opts));
    }
    const gross = balanceService.round8(Number(cryptoAmount));
    if (!(gross > 0)) throw appError('Received amount must be positive', 400);
    const { txHash = null, adminId = null } = opts;

    const deposit = await prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
    const seen = Array.isArray(deposit.txSeen) ? deposit.txSeen : [];
    if (txHash && seen.includes(txHash)) return null;

    const firstTopUp = !deposit.orderId && Number(deposit.amountReceived) === 0
      && (['awaiting', 'partial'].includes(deposit.status) || ((adminId || txHash) && deposit.status === 'expired'));
    if (!firstTopUp) {
      // A confirmed top-up only takes payments seen on the blockchain (with their hash):
      // an amount typed by hand on it could credit a payment twice
      if (!deposit.orderId && !txHash) throw appError('This deposit is already confirmed', 409);
      return this.receivePayment(deposit, gross, { txHash, adminId }, note);
    }

    const price = await getCachedUsdPrice(deposit.currency);
    const pct   = await balanceService.getCommissionPct();
    const { commission, net } = balanceService.splitDeposit(gross, pct);
    const netUsd = price ? balanceService.round2(net * price) : 0;

    const txn = await prisma.$transaction(async (tx) => {
      // Claimed atomically: the webhook and the customer's check may confirm it at the same time
      const { count } = await tx.deposit.updateMany({
        where: { id: depositId, status: deposit.status, amountReceived: 0 },
        data:  {
          status: 'confirmed', confirmedAt: new Date(),
          amountReceived: gross, usdCredited: netUsd,
          commissionPct: pct, commissionAmount: commission, netAmount: net,
          ...(txHash ? { txSeen: [...seen, txHash] } : {}),
        },
      });
      if (count === 0) return null;

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
    if (!txn) {
      // Someone else confirmed it meanwhile: this payment may still be a new one
      if (txHash) return this.confirmDeposit(depositId, gross, note, opts);
      throw appError('This deposit is already confirmed', 409);
    }

    await notificationService.notifyDeposit(deposit.userId, deposit.currency, netUsd, net);
    return txn;
  },

  // One more payment on a deposit: an order's (its payments add up) or a top-up the customer
  // paid again. Credited to the customer's holding net of the commission; an order is then
  // settled, or refunded if it is already closed. If the address was already swept, the
  // sweeps are reopened for the new share only (what they took is kept in *SweptAmount).
  async receivePayment(deposit, gross, { txHash = null, adminId = null } = {}, note = null) {
    const seen = Array.isArray(deposit.txSeen) ? deposit.txSeen : [];
    if (txHash && seen.includes(txHash)) return null;
    const delta = balanceService.round8(gross);
    if (!(delta > 0)) return null;
    // Expired: only a payment proven on the blockchain (its hash) or entered by an admin
    if (deposit.status === 'expired' && !adminId && !txHash) throw appError('This deposit expired', 409);
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
          ...(['awaiting', 'expired'].includes(deposit.status) ? { status: deposit.orderId ? 'partial' : 'confirmed' } : {}),
          ...(txHash ? { txSeen: [...seen, txHash] } : {}),
          // Swept before: everything that was there is gone, the new shares are to sweep
          ...(deposit.shopSweptAt ? { shopSweptAt: null, shopSweptAmount: deposit.netAmount } : {}),
          ...(deposit.reserveSweptAt ? { reserveSweptAt: null, reserveSweptAmount: deposit.commissionAmount } : {}),
        },
      });
      if (count === 0) return null;
      const t = await tx.transaction.create({
        data: {
          frontendId: formatTxnId(), userId: deposit.userId, type: 'deposit', amount: netUsd, currency: deposit.currency,
          cryptoAmount: net, rate: price || null, status: 'confirmed',
          note: note || `${delta} ${deposit.currency} received ${deposit.orderId ? 'for an order' : 'again on deposit #' + deposit.id}, ${pct}% deposit fee (${commission} ${deposit.currency})`,
        },
      });
      if (!deposit.transactionId) await tx.deposit.update({ where: { id: deposit.id }, data: { transactionId: t.id } });
      await balanceService.credit(tx, deposit.userId, deposit.currency, net);
      return t;
    });
    if (!txn) {
      // The deposit changed meanwhile (another payment credited): try again on fresh data
      const fresh = await prisma.deposit.findUnique({ where: { id: deposit.id } });
      if (txHash && fresh && !(fresh.txSeen || []).includes(txHash)) return this.receivePayment(fresh, gross, { txHash, adminId }, note);
      return null;
    }
    if (deposit.orderId) {
      const fresh = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
      const { orderService } = await import('./order.service.js');
      await orderService.settlePendingOrder(deposit.orderId, { currency: deposit.currency, net: Number(fresh.netAmount), deltaNet: net, depositId: deposit.id });
    } else {
      await notificationService.notifyDeposit(deposit.userId, deposit.currency, netUsd, net);
    }
    return txn;
  },

  // Looks at the blockchain for every payment made to a deposit address and credits the ones
  // not counted yet. Deposits credited before payments were tracked by transaction have an
  // empty txSeen: their oldest payments, up to the amount already credited, are marked as
  // counted (not credited again). Returns { credited, pending, found, failed }.
  async syncDeposit(depositOrId) {
    let dep = typeof depositOrId === 'object' ? depositOrId : await prisma.deposit.findUnique({ where: { id: depositOrId } });
    if (!dep || dep.currency === 'XMR' || !dep.address || dep.address === 'pending') return { credited: 0, pending: false, found: 0, failed: [] };
    // Bots platform: read and credit as the customer's owner
    if (env.platform === 'bots' && currentTenant() === null) {
      const owner = await prisma.deposit.findUnique({ where: { id: dep.id }, select: { user: { select: { tenantId: true } } } });
      if (owner) return withTenant(owner.user.tenantId, () => this.syncDeposit(dep.id));
    }

    const { payments, pending } = await cryptoService.incomingPayments(dep);
    let seen = Array.isArray(dep.txSeen) ? dep.txSeen : [];
    if (!seen.length && Number(dep.amountReceived) > 0) {
      let acc = 0;
      const baseline = [];
      for (const p of payments) {
        if (acc + p.amount > Number(dep.amountReceived) + 1e-8) break;
        acc += p.amount;
        baseline.push(p.hash);
      }
      if (baseline.length) {
        await prisma.deposit.updateMany({ where: { id: dep.id, amountReceived: dep.amountReceived }, data: { txSeen: baseline } });
        seen = baseline;
      }
    }

    let credited = 0;
    const failed = [];
    for (const p of payments) {
      if (seen.includes(p.hash)) continue;
      try {
        if (await this.confirmDeposit(dep.id, p.amount, null, { txHash: p.hash })) credited++;
      } catch (e) {
        console.warn(`[Deposits] payment ${p.hash} on deposit #${dep.id} not credited:`, e.message);
        failed.push({ hash: p.hash, amount: p.amount, reason: e.message });
      }
      dep = await prisma.deposit.findUnique({ where: { id: dep.id } });
      seen = Array.isArray(dep.txSeen) ? dep.txSeen : [];
    }
    return { credited, pending, found: payments.length, failed };
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

    // A paid address keeps its BlockCypher hook 7 days, to see a payment sent to it again;
    // after that the hook is released (the customer's Check, Check chain or a sweep still find it)
    const stale = await prisma.deposit.findMany({
      where: { status: 'confirmed', hookId: { not: null }, confirmedAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
    });
    if (stale.length) {
      await Promise.allSettled(stale.filter(d => CHAIN_HOOK.includes(d.currency)).map(d => cryptoService.deleteBlockcypherHook(d.hookId, d.currency)));
      await prisma.deposit.updateMany({ where: { id: { in: stale.map(d => d.id) } }, data: { hookId: null } });
    }

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
