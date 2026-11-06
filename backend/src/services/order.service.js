import { prisma } from '../db.js';
import { withTenant } from '../tenant.js';
import { notificationService } from './notification.service.js';
import { formatTxnId, formatOrderNumber, appError } from '../utils/formatters.js';
import * as balanceService from './balance.service.js';
import { getCachedUsdPrices, getCachedUsdPrice } from './price.service.js';
import { priceCart } from './pricing.service.js';
import { notifyWalletOrder, dmUser, escapeHtml } from './telegram.service.js';
import { walletService } from './wallet.service.js';
import { cryptoService } from './crypto.service.js';
import { orderRefundService } from './orderRefund.service.js';
import { checkVoucher, useVoucher } from './voucher.service.js';
import { isPgpMessage } from './pgp.service.js';
import { REFUND_COINS, validRefund, refundNote, keepRefundOnAccount } from './refund.service.js';

// The bot's payment window, as in the original: 30 minutes
export const PAY_WINDOW_MIN = 30;
// An order number as a Telegram command: ORD-2026-00012 -> ord_2026_00012
const orderCode = n => String(n).replace(/-/g, '_').toLowerCase();

export const orderService = {
  // No customer details are required: the Telegram username/ID is optional (saved
  // to the profile when given at checkout). Delivery is an option: with it the
  // customer gives a US address, shipping is charged and the address goes on the
  // invoice; without it, nothing is asked and the shop arranges it on Telegram.
  // From a "commands" bot: `shipping` { name, address, fee } is the address as the
  // customer typed it (plain or PGP) and the style's flat fee; `voucher` a code,
  // within the bot's catalog `source`.
  // `refund` { currency, address }: optional, where a refund would be sent (website;
  // the bot puts it in `note` itself). `channel`: 'site' or 'bot', where it was placed.
  async createOrder(userId, { items, paymentMethod, payCurrency, telegram, delivery, note, shipping, voucher, refund, channel = 'site', source = null }) {
    if (!items?.length)     throw appError('Cart is empty', 400);
    let refundLine = null;
    if (refund?.address) {
      const coin = String(refund.currency || '').toUpperCase();
      const address = String(refund.address).trim();
      if (!validRefund(coin, address)) throw appError(`This does not look like a ${REFUND_COINS[coin] || 'crypto'} refund address.`, 400);
      refundLine = refundNote(coin, address);
      await keepRefundOnAccount(userId, coin, address);
    }
    const notes = [note ? String(note).slice(0, 2000) : null, refundLine].filter(Boolean).join('\n') || null;

    let shipTo = null;
    if (delivery?.pgp) {
      // Encrypted in the customer's browser to the shop's key: only the shop can read it
      const message = String(delivery.pgp).trim();
      if (message.length > 6000 || !isPgpMessage(message)) throw appError('The encrypted address is not a valid PGP message. Please try again.', 400);
      shipTo = { name: 'PGP encrypted', address: message };
    } else if (delivery) {
      const d = Object.fromEntries(['name', 'street', 'apt', 'city', 'state', 'zip'].map(k => [k, String(delivery[k] || '').trim().slice(0, 120)]));
      if (!d.name || !d.street || !d.city || !/^[A-Z]{2}$/.test(d.state) || !/^\d{5}(-\d{4})?$/.test(d.zip)) {
        throw appError('Please complete the delivery address (name, street, city, state and 5-digit ZIP).', 400);
      }
      shipTo = { name: d.name, address: `${d.street}${d.apt ? `, ${d.apt}` : ''}, ${d.city}, ${d.state} ${d.zip}, US` };
    }
    if (shipping) {
      const name = String(shipping.name || '').trim().slice(0, 120);
      const address = String(shipping.address || '').trim().slice(0, 6000);
      if (!name || !address) throw appError('Please give your shipping details first.', 400);
      shipTo = { name, address };
    }

    const handle = String(telegram || '').trim().replace(/^@/, '').slice(0, 64);
    if (handle) {
      await prisma.user.updateMany({ where: { id: userId, telegramHandle: null }, data: { telegramHandle: handle } });
    }

    const priced = await priceCart(items, { delivery: !!shipTo });
    const { lines, subtotal } = priced;
    const shippingFee = shipping && shipping.fee != null ? Math.max(0, Number(shipping.fee) || 0) : priced.shippingFee;
    const offer = voucher ? await checkVoucher(voucher, subtotal, source) : null;
    const discount = offer?.discount || 0;
    const totalAmount = Math.round((subtotal - discount + shippingFee) * 100) / 100;
    const orderItems = lines.map(({ productId, name, price, quantity }) => ({ productId, name, price, quantity }));

    // Freeze the conversion now: these prices and quantities are what the order
    // costs in crypto, whatever the market does afterwards.
    const holdings = await balanceService.getHoldings(userId);
    const prices   = await getCachedUsdPrices(holdings.map(h => h.currency));
    if (holdings.length && !holdings.some(h => prices[h.currency])) {
      throw appError('Live prices are unavailable right now. Please try again in a minute.', 503);
    }
    let payments;
    try {
      payments = balanceService.allocateUsd(holdings, prices, totalAmount, payCurrency || null);
    } catch {
      const { balance } = await balanceService.valueHoldings(holdings, prices);
      const scope = payCurrency ? `${payCurrency} ` : '';
      throw appError(`Insufficient ${scope}balance (available: $${balance.toFixed(2)}, required: $${totalAmount.toFixed(2)})`, 402);
    }

    const result = await prisma.$transaction(async (tx) => {
      if (offer) await useVoucher(tx, offer.voucher);
      for (const p of payments) await balanceService.debit(tx, userId, p.currency, p.amount);
      // Take the stock; the guard makes two concurrent orders unable to oversell
      for (const item of orderItems) {
        const { count } = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data:  { stock: { decrement: item.quantity } },
        });
        if (count === 0) throw appError(`"${item.name}" just sold out. Please review your cart.`, 409);
      }
      await tx.user.update({
        where: { id: userId },
        data:  { totalSpent: { increment: totalAmount } },
      });

      const order = await tx.order.create({
        data: {
          orderNumber:    'TEMP',
          userId,
          paymentMethod:   paymentMethod || 'wallet',
          totalAmount,
          shippingFee,
          shippingAddress: shipTo?.address || '',
          name:            shipTo?.name || '',
          email:           null,
          note:            notes,
          voucherCode:     offer?.voucher.code || null,
          discount,
          payments,
          items:           { create: orderItems },
        },
        include: { items: true },
      });

      const updated = await tx.order.update({
        where: { id: order.id },
        data:  { orderNumber: formatOrderNumber(order.id) },
        include: { items: { include: { product: { select: { slug: true } } } } },
      });

      // One transaction per order (orderId is unique): the crypto side is set when
      // a single currency paid; the full split is on the order's `payments`.
      const single = payments.length === 1 ? payments[0] : null;
      await tx.transaction.create({
        data: {
          frontendId:   formatTxnId(),
          userId,
          type:         'purchase',
          amount:       -totalAmount,
          currency:     payments.map(p => p.currency).join('+') || 'USD',
          cryptoAmount: single ? -single.amount : null,
          rate:         single ? single.rate : null,
          status:       'confirmed',
          note:         `Order ${updated.orderNumber} — ${payments.map(p => `${p.amount} ${p.currency} @ $${p.rate}`).join(' + ')}`,
          orderId:      order.id,
        },
      });

      return updated;
    });

    await notificationService.notifyOrder(userId, result.orderNumber);
    const buyer = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, telegramHandle: true } });
    // Paid in the app, invoiced on Telegram (best-effort: never fails the order)
    const [invoice, contact, { balance }] = await Promise.all([
      notifyWalletOrder(result, buyer, payments, { channel }).catch(() => null),
      prisma.siteSetting.findUnique({ where: { key: 'telegram_username' } }),
      balanceService.getUserBalance(userId),
    ]);
    const shopUsername = contact?.value?.replace(/^@/, '').trim();
    return {
      order: result, payments, newBalance: balance,
      invoice: invoice && {
        text: invoice.text,
        delivered: invoice.delivered,
        receiptDelivered: invoice.receiptDelivered,
        shopTelegramUrl: shopUsername ? `https://t.me/${shopUsername}?text=${encodeURIComponent(invoice.text)}` : null,
      },
    };
  },

  // ── Bot checkout: pay the order itself, no wallet ──────────────────────────
  // Place Order creates the order "awaiting_payment" (stock and voucher held), with its
  // own deposit address and the exact crypto amount. The amount asked for covers the
  // price plus the deposit commission, which confirmDeposit takes when the payment lands.
  async placePendingOrder(userId, { items, coin, shipping, voucher, note, source = null }) {
    if (!items?.length) throw appError('Cart is empty', 400);
    if (!(await cryptoService.payableCoins()).includes(coin)) throw appError(`${coin} is not accepted here.`, 400);
    const name = String(shipping?.name || '').trim().slice(0, 120);
    const address = String(shipping?.address || '').trim().slice(0, 6000);
    if (!name || !address) throw appError('Please give your shipping details first.', 400);

    const priced = await priceCart(items, { delivery: true });
    const { lines, subtotal } = priced;
    const shippingFee = shipping.fee != null ? Math.max(0, Number(shipping.fee) || 0) : priced.shippingFee;
    const offer = voucher ? await checkVoucher(voucher, subtotal, source) : null;
    const discount = offer?.discount || 0;
    const totalAmount = Math.round((subtotal - discount + shippingFee) * 100) / 100;
    const orderItems = lines.map(({ productId, name: n, price, quantity }) => ({ productId, name: n, price, quantity }));

    const [price, pct] = await Promise.all([getCachedUsdPrice(coin), balanceService.getCommissionPct()]);
    if (!price) throw appError(`The ${coin} price is unavailable right now. Please try again in a minute.`, 503);
    if (pct >= 100) throw appError('Payments are unavailable right now.', 503);
    // What the order costs in crypto (frozen), and what to send so that it is left after the commission
    const netNeeded = Math.ceil(totalAmount / price * 1e8 - 1e-6) / 1e8;
    const gross = Math.ceil(netNeeded / (1 - pct / 100) * 1e8 - 1e-6) / 1e8;
    const expiresAt = new Date(Date.now() + PAY_WINDOW_MIN * 60 * 1000);

    const order = await prisma.$transaction(async (tx) => {
      if (offer) await useVoucher(tx, offer.voucher);
      for (const item of orderItems) {
        const { count } = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data:  { stock: { decrement: item.quantity } },
        });
        if (count === 0) throw appError(`"${item.name}" just sold out. Please review your cart.`, 409);
      }
      const created = await tx.order.create({
        data: {
          orderNumber: 'TEMP', userId, status: 'awaiting_payment', expiresAt,
          paymentMethod: `crypto:${coin}`, totalAmount, shippingFee,
          shippingAddress: address, name, email: null,
          note: note ? String(note).slice(0, 2000) : null,
          voucherCode: offer?.voucher.code || null, discount,
          payments: [{ currency: coin, amount: netNeeded, rate: price, usd: totalAmount }],
          items: { create: orderItems },
        },
      });
      return tx.order.update({ where: { id: created.id }, data: { orderNumber: formatOrderNumber(created.id) }, include: { items: true } });
    });

    try {
      const deposit = await walletService.createDeposit(userId, coin, { orderId: order.id, minutes: PAY_WINDOW_MIN, expected: gross });
      return { order, deposit, gross, price, pct, expiresAt };
    } catch (err) {
      await this.cancelPendingOrder(order.id, null).catch(() => {});
      throw err;
    }
  },

  // An unpaid order is released: stock back on the shelf, voucher use given back.
  // `why` null = silent (the customer is not told). What was already received is refunded
  // (a request for the admin to approve); the deposit address keeps watching for 24 hours,
  // so that a payment arriving later is seen and refunded too.
  async cancelPendingOrder(orderId, why = 'expired') {
    const done = await prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({ where: { id: orderId, status: 'awaiting_payment' }, data: { status: 'cancelled' } });
      if (!count) return null;
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      for (const i of order.items) if (i.productId) await tx.product.update({ where: { id: i.productId }, data: { stock: { increment: i.quantity } } });
      if (order.voucherCode) await tx.voucher.updateMany({ where: { code: order.voucherCode, uses: { gt: 0 } }, data: { uses: { decrement: 1 } } });
      const dep = await tx.deposit.findUnique({ where: { orderId } });
      if (dep && ['awaiting', 'partial'].includes(dep.status)) await tx.deposit.update({ where: { id: dep.id }, data: { expiresAt: new Date(Date.now() + 24 * 3600 * 1000) } });
      return { order, dep };
    });
    if (!done) return false;
    const { order, dep } = done;
    // Short payment(s) before the end: refunded
    if (dep && Number(dep.netAmount) > 0) {
      await orderRefundService.request({ userId: order.userId, orderId, depositId: dep.id, currency: dep.currency, amount: Number(dep.netAmount), reason: `payment short when the order expired` }).catch(() => {});
    }
    if (why) {
      dmUser(order.userId, `⌛ <b>Order ${escapeHtml(order.orderNumber)} expired</b>\nNo full payment was received within ${PAY_WINDOW_MIN} minutes, so the order was cancelled. A payment detected after this is refunded to your refund address.`,
        [{ text: '🛒 Shop now', callback_data: 'menu' }]).catch(() => {});
    }
    return true;
  },

  // Cancels every awaiting order whose 30 minutes are over (run each minute)
  async expirePendingOrders() {
    const due = await prisma.order.findMany({
      where: { status: 'awaiting_payment', expiresAt: { lt: new Date() } },
      select: { id: true, user: { select: { tenantId: true } } },
    });
    let n = 0;
    for (const { id, user } of due) {
      // As the customer's owner (bots platform): their voucher code, their bots
      const done = await withTenant(user.tenantId, () => this.cancelPendingOrder(id)).catch((err) => {
        console.error(`[Orders] Could not cancel unpaid order #${id}:`, err.message);
        return false;
      });
      if (done) n++;
    }
    return { expired: n };
  },

  // A payment reached the order's deposit (commission already taken, credited to the customer's
  // holding). `net` is everything received so far, `deltaNet` this payment: once the order has
  // what it costs it goes to processing; a payment on a cancelled order, or a surplus, is
  // refunded (a request an admin approves).
  async settlePendingOrder(orderId, { currency, net, deltaNet, depositId }) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return;
    const code = escapeHtml(order.orderNumber);
    if (order.status !== 'awaiting_payment') {
      await orderRefundService.request({ userId: order.userId, orderId, depositId, currency, amount: deltaNet, reason: 'payment after the order expired' }).catch(() => {});
      return;
    }
    const due = order.payments?.[0];
    if (!due) return;
    // Within 1% of the amount asked for: the rate or the network fee moved a little
    if (net + 1e-9 < due.amount * 0.99) {
      const pct = await balanceService.getCommissionPct();
      const rest = Math.ceil((due.amount - net) / (1 - pct / 100) * 1e8) / 1e8;
      dmUser(order.userId, `⚠️ <code>${net} ${currency}</code> received (after the fee) for <b>${code}</b>. Send the rest, <code>${rest.toFixed(8)}</code> ${currency}, to the same address before the order expires.`).catch(() => {});
      return;
    }
    const pay = { ...due, amount: Math.min(due.amount, net) };
    const settled = await prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({ where: { id: orderId, status: 'awaiting_payment' }, data: { status: 'processing', expiresAt: null, payments: [pay] } });
      if (!count) return false;
      await balanceService.debit(tx, order.userId, currency, pay.amount);
      await tx.user.update({ where: { id: order.userId }, data: { totalSpent: { increment: order.totalAmount } } });
      await tx.deposit.updateMany({ where: { orderId }, data: { status: 'confirmed', confirmedAt: new Date() } });
      await tx.transaction.create({
        data: {
          frontendId: formatTxnId(), userId: order.userId, type: 'purchase', amount: -order.totalAmount,
          currency, cryptoAmount: -pay.amount, rate: pay.rate, status: 'confirmed',
          note: `Order ${order.orderNumber} — ${pay.amount} ${currency} @ $${pay.rate}`, orderId: order.id,
        },
      });
      return true;
    });
    if (!settled) return;
    const surplus = balanceService.round8(net - pay.amount);
    if (surplus > due.amount * 0.01) {
      await orderRefundService.request({ userId: order.userId, orderId, depositId, currency, amount: surplus, reason: 'surplus paid on the order' }).catch(() => {});
    }
    const fresh = await prisma.order.findUnique({ where: { id: orderId }, include: { items: { include: { product: { select: { slug: true } } } } } });
    await notificationService.notifyOrder(order.userId, order.orderNumber);
    const buyer = await prisma.user.findUnique({ where: { id: order.userId }, select: { id: true, username: true, telegramHandle: true, telegramBotId: true } });
    await notifyWalletOrder(fresh, buyer, [pay], { channel: 'bot' }).catch(() => null);
    dmUser(order.userId, `✅ <b>Payment received</b>\nOrder <b>${code}</b> is confirmed and being prepared.\nOrder details: /ord_${orderCode(order.orderNumber)}`,
      [{ text: '🛒 Shop now', callback_data: 'menu' }]).catch(() => {});
  },
};
