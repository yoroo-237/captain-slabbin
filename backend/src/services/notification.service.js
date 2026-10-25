import { dmUser } from './telegram.service.js';
import { prisma } from '../db.js';

export const notificationService = {
  async createWelcomeNotifications(userId) {
    await prisma.notification.createMany({
      data: [
        {
          userId,
          type:    'welcome',
          title:   'Welcome to BOTB!',
          message: 'Your account has been created. Explore our catalog.',
          link:    '/',
        },
        {
          userId,
          type:    'welcome',
          title:   'Fund your account',
          message: 'Add credits via crypto to place your first order.',
          link:    '/wallet',
        },
        {
          userId,
          type:    'welcome',
          title:   'Delivery via Telegram',
          message: 'Delivery is coordinated via Telegram after your order is confirmed.',
        },
      ],
    });
  },

  async create(userId, { type, title, message, link = null }) {
    return prisma.notification.create({
      data: { userId, type, title, message, link },
    });
  },

  async notifyOrder(userId, orderNumber) {
    await this.create(userId, {
      type:    'order',
      title:   'Order confirmed',
      message: `Your order ${orderNumber} has been placed successfully.`,
      link:    '/orders',
    });
  },

  async notifyDeposit(userId, currency, usdAmount, cryptoAmount = null) {
    // Customers on the bot hear about it there too (best-effort)
    dmUser(userId, `💰 <b>Deposit received</b>: ${cryptoAmount != null ? `${cryptoAmount} ${currency} ≈ ` : ''}$${Number(usdAmount).toFixed(2)} added to your wallet.`,
      [{ text: '🛒 Shop now', callback_data: 'menu' }, { text: '💰 Wallet', callback_data: 'w' }]).catch(() => {});
    await this.create(userId, {
      type:    'deposit',
      title:   'Deposit confirmed',
      message: cryptoAmount != null
        ? `${cryptoAmount} ${currency} (≈ $${Number(usdAmount).toFixed(2)}) has been added to your balance.`
        : `Your ${currency} deposit of $${Number(usdAmount).toFixed(2)} has been credited.`,
      link:    '/wallet',
    });
  },
};
