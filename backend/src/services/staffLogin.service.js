import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { appError } from '../utils/formatters.js';

// Staff buttons on Telegram notifications (Open order, Reply in admin…) can sign
// the person who taps them straight into the dashboard: a `login_url` button makes
// Telegram send their account (id, name, auth_date) signed with the bot's token
// (https://core.telegram.org/widgets/login#checking-authorization). A Telegram
// account works only once linked to a staff account, by signing in normally the
// first time; customers and unknown accounts get the sign-in page.

const STAFF = ['moderator', 'admin', 'superadmin'];
const MAX_AGE_S = 24 * 3600;

export async function staffLoginEnabled() {
  const row = await prisma.siteSetting.findUnique({ where: { key: 'telegram_staff_login' } });
  return row?.value === 'true';
}

export const siteDomain = () => { try { return new URL(env.frontendUrl).hostname; } catch { return ''; } };

// A staff button: signs in through Telegram when it is on, else a plain link
export async function staffButton(text, url) {
  if (!url?.startsWith('https://') || !(await staffLoginEnabled())) return { text, url };
  const { pathname, search } = new URL(url);
  const site = env.frontendUrl.replace(/\/$/, '');
  return { text, login_url: { url: `${site}/admin-tg?to=${encodeURIComponent(pathname + search)}` } };
}

// The Telegram account in `data`, when one of the linked bots signed it
async function telegramAccount(data) {
  const { hash, ...fields } = Object.fromEntries(Object.entries(data || {}).filter(([k]) => ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash'].includes(k)).map(([k, v]) => [k, String(v)]));
  if (!hash || !fields.id || !fields.auth_date) return null;
  if (Math.abs(Date.now() / 1000 - Number(fields.auth_date)) > MAX_AGE_S) return null;
  const check = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const bots = await prisma.telegramBot.findMany({ select: { token: true } });
  const signed = bots.some(({ token }) => {
    const secret = crypto.createHash('sha256').update(token).digest();
    const expected = crypto.createHmac('sha256', secret).update(check).digest('hex');
    return expected.length === hash.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash));
  });
  return signed ? fields.id : null;
}

// The staff account behind a signed Telegram login. `bearer`: the site's own token
// when the person is signed in already, to link this Telegram account to them.
export async function staffFromTelegram(data, bearer) {
  const telegramId = await telegramAccount(data);
  if (!telegramId) throw appError('This Telegram sign-in is invalid or too old. Tap the button in Telegram again.', 401);
  let user = await prisma.user.findUnique({ where: { staffTelegramId: telegramId } });
  if (!user && bearer) {
    let me = null;
    try { me = jwt.verify(bearer, env.jwtSecret); } catch { /* not signed in */ }
    const account = me && await prisma.user.findUnique({ where: { id: me.sub } });
    if (account && STAFF.includes(account.role)) {
      user = await prisma.user.update({ where: { id: account.id }, data: { staffTelegramId: telegramId } });
    }
  }
  if (!user) throw Object.assign(appError('Sign in once with your admin account: your Telegram is then linked to it.', 401), { needLogin: true });
  if (!user.isActive || !STAFF.includes(user.role)) throw appError('This account has no access to the dashboard.', 403);
  return user;
}
