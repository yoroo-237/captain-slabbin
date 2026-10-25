import { prisma } from '../db.js';
import { ok } from '../utils/response.js';

const PUBLIC_KEYS = [
  'site_name',
  'maintenance_mode',
  'registration_open',
  'shipping_cost',
  'shipping_free_threshold',
  'shipping_deadline_h',
  'shipping_deadline_m',
  'support_phone',
  'signal_url',
  'telegram_username',
  'promo_enabled',
  'promo_headline',
  'contact_email',
  'store_address',
  'store_city',
  'store_state',
  'store_zip',
  'store_hours',
  'announcements',
  'ad_banner',
  'about_text',
];

export const contentController = {
  async getSettings(req, res) {
    const rows = await prisma.siteSetting.findMany({
      where: { key: { in: PUBLIC_KEYS } },
    });
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json(ok({ settings }));
  },

  async getFaq(req, res) {
    const faqs = await prisma.fAQ.findMany({
      where:   { isActive: true },
      orderBy: { position: 'asc' },
    });
    res.json(ok(faqs));
  },

  async getNews(req, res) {
    const news = await prisma.newsArticle.findMany({
      where:   { isPublished: true },
      orderBy: { publishedAt: 'desc' },
      take:    20,
    });
    res.json(ok(news));
  },

  async getGiveaways(req, res) {
    const giveaways = await prisma.giveaway.findMany({
      where:   { status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    res.json(ok(giveaways));
  },
};
