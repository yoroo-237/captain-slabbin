import { prisma } from '../db.js';
import { notificationService } from './notification.service.js';
import { formatTxnId, formatOrderNumber, appError } from '../utils/formatters.js';
import * as balanceService from './balance.service.js';
import { getCachedUsdPrices } from './price.service.js';
import { priceCart } from './pricing.service.js';
import { notifyWalletOrder } from './telegram.service.js';

export const orderService = {
  // No customer details are required: the Telegram username/ID is optional (saved
  // to the profile when given at checkout). Delivery is an option: with it the
  // customer gives a US address, shipping is charged and the address goes on the
  // invoice; without it, nothing is asked and the shop arranges it on Telegram.
  async createOrder(userId, { items, paymentMethod, payCurrency, telegram, delivery }) {
    if (!items?.length)     throw appError('Cart is empty', 400);

    let shipTo = null;
    if (delivery) {
      const d = Object.fromEntries(['name', 'street', 'apt', 'city', 'state', 'zip'].map(k => [k, String(delivery[k] || '').trim().slice(0, 120)]));
      if (!d.name || !d.street || !d.city || !/^[A-Z]{2}$/.test(d.state) || !/^\d{5}(-\d{4})?$/.test(d.zip)) {
        throw appError('Please complete the delivery address (name, street, city, state and 5-digit ZIP).', 400);
      }
      shipTo = { name: d.name, address: `${d.street}${d.apt ? `, ${d.apt}` : ''}, ${d.city}, ${d.state} ${d.zip}, US` };
    }

    const handle = String(telegram || '').trim().replace(/^@/, '').slice(0, 64);
    if (handle) {
      await prisma.user.updateMany({ where: { id: userId, telegramHandle: null }, data: { telegramHandle: handle } });
    }

    const { lines, shippingFee, total: totalAmount } = await priceCart(items, { delivery: !!shipTo });
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
      notifyWalletOrder(result, buyer, payments).catch(() => null),
      prisma.siteSetting.findUnique({ where: { key: 'telegram_username' } }),
      balanceService.getUserBalance(userId),
    ]);
    const shopUsername = contact?.value?.replace(/^@/, '').trim();
    return {
      order: result, payments, newBalance: balance,
      invoice: invoice && {
        text: invoice.text,
        delivered: invoice.delivered,
        shopTelegramUrl: shopUsername ? `https://t.me/${shopUsername}?text=${encodeURIComponent(invoice.text)}` : null,
      },
    };
  },
};
