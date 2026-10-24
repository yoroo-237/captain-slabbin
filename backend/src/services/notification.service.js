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
