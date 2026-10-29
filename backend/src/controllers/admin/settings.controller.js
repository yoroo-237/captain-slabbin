import { prisma } from '../../db.js';
import { ok } from '../../utils/response.js';
import { appError } from '../../utils/formatters.js';
import { TELEGRAM_PRIVATE_KEYS } from '../../services/telegram.service.js';
import { readPublicKey } from '../../services/pgp.service.js';

const ALLOWED_KEYS = new Set([
  'site_name', 'maintenance_mode', 'registration_open',
  'shipping_cost', 'shipping_free_threshold', 'shipping_deadline_h', 'shipping_deadline_m',
  'points_rate', 'deposit_expiry_hours', 'min_deposit', 'max_deposit',
  'btc_address', 'ltc_address', 'doge_address', 'eth_address', 'xmr_address',
  'btc_hd_seed',
  // Storefront gate, contact & Telegram
  'site_password', 'gate_show_password', 'support_phone', 'signal_url', 'telegram_username',
  'promo_enabled', 'promo_headline',
  // Shop contact & US location, announcement bar, ad banner
  'contact_email', 'store_address', 'store_city', 'store_state', 'store_zip', 'store_hours', 'announcements', 'ad_banner', 'about_text',
  // Website checkout: the PGP public key customers encrypt their address to
  'pgp_public_key',
  // Staff buttons on Telegram notifications sign in with Telegram (needs /setdomain)
  'telegram_staff_login',
]);

const ADMIN_ROLES = ['admin', 'superadmin'];

export const adminSettingsController = {
  async get(req, res) {
    const rows = await prisma.siteSetting.findMany({ orderBy: { key: 'asc' } });
    // "super_" keys (commission sweep) have their own endpoints; the HD seed can
    // move every BTC/LTC/DOGE deposit, so moderators never receive it.
    const visible = rows.filter(r =>
      !r.key.startsWith('super_') && !r.key.startsWith('push_') && !TELEGRAM_PRIVATE_KEYS.includes(r.key) &&
      (r.key !== 'btc_hd_seed' || ADMIN_ROLES.includes(req.user.role))
    );
    const settings = Object.fromEntries(visible.map(r => [r.key, r.value]));
    res.json(ok({ settings }));
  },

  async update(req, res) {
    const entries = Object.entries(req.body).filter(([k]) => ALLOWED_KEYS.has(k));
    if (entries.length === 0) throw appError('No valid keys to update', 400);
    // A public key only, checked (a private key is refused, never stored)
    for (const e of entries) if (e[0] === 'pgp_public_key') e[1] = (await readPublicKey(e[1])).armored;

    await Promise.all(entries.map(([key, value]) =>
      prisma.siteSetting.upsert({
        where:  { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      }),
    ));

    res.json(ok({ updated: entries.map(([k]) => k) }));
  },

  async getSystemStatus(req, res) {
    const checks = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`,
      prisma.siteSetting.count(),
      prisma.user.count(),
    ]);

    res.json(ok({
      database:   checks[0].status === 'fulfilled' ? 'ok' : 'error',
      settings:   checks[1].status === 'fulfilled' ? checks[1].value : 0,
      totalUsers: checks[2].status === 'fulfilled' ? checks[2].value : 0,
      uptime:     process.uptime(),
      nodeVersion: process.version,
      env:         process.env.NODE_ENV,
    }));
  },
};
