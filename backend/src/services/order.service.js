import { prisma } from '../db.js';
import { notificationService } from './notification.service.js';
import { formatTxnId, formatOrderNumber, appError } from '../utils/formatters.js';
import * as balanceService from './balance.service.js';
import { getCachedUsdPrices } from './price.service.js';
import { priceCart } from './pricing.service.js';
import { notifyWalletOrder } from './telegram.service.js';

export const orderService = {
  async createOrder(userId, { items, shippingAddress, paymentMethod, name, email, payCurrency }) {
    if (!items?.length)     throw appError('Cart is empty', 400);
    if (!shippingAddress)   throw appError('Shipping address is required', 400);
    if (!paymentMethod)     throw appError('Payment method is required', 400);
    if (!name?.trim())      throw appError('Name is required', 400);

    const { lines, shippingFee, total: totalAmount } = await priceCart(items);
    const orderItems = lines.map(({ productId, name, price, quantity }) => ({ productId, name, price, quantity }));

    // Freeze the conversion now: these prices and quantities are what the order
    // costs in crypto, whatever the market does afterwards.
    const holdings = await balanceService.getHoldings(userId);
    const prices   = await getCachedUsdPrices(holdings.map(h => h.currency));
    if (holdings.length && !holdings.some(h => prices[h.currency])) {
      throw appError('Live prices are unavailable right now — please try again in a minute.', 503);
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
      for (const p of payments) await balanceService.debit(tx, userId, p.currency, p.amount);
      // Take the stock; the guard makes two concurrent orders unable to oversell
      for (const item of orderItems) {
        const { count } = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data:  { stock: { decrement: item.quantity } },
        });
        if (count === 0) throw appError(`"${item.name}" just sold out — please review your cart.`, 409);
      }
      await tx.user.update({
        where: { id: userId },
        data:  { totalSpent: { increment: totalAmount } },
      });

      const order = await tx.order.create({
        data: {
          orderNumber:    'TEMP',
          userId,
          paymentMethod,
          totalAmount,
          shippingFee,
          shippingAddress: shippingAddress.trim(),
          name:            name.trim(),
          email:           email?.trim() || null,
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
    const buyer = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, telegramHandle: true } });
    notifyWalletOrder(result, buyer, payments).catch(() => {});

    const { balance } = await balanceService.getUserBalance(userId);
    return { order: result, payments, newBalance: balance };
  },
};
