import webpush from 'web-push';
import { prisma } from '../db.js';
import { env } from '../config/env.js';

// Browser push for the staff: a paid order, a customer message or a new support
// ticket reaches every admin and moderator who enabled notifications in the admin
// header, even with the tab closed. Best-effort like the Telegram posts: a push
// problem must never block an order.
//
// The VAPID key pair identifies this server to the browsers' push services. It
// comes from PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY when set, otherwise
// it is generated once and kept in site settings (never sent to the admin UI).

const STAFF = ['moderator', 'admin', 'superadmin'];
const KEYS = { pub: 'push_vapid_public', priv: 'push_vapid_private' };

const save = (key, value) => prisma.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
const read = async key => (await prisma.siteSetting.findUnique({ where: { key } }))?.value || '';

let ready = null;
function setup() {
  ready ||= (async () => {
    let publicKey = env.push.publicKey || await read(KEYS.pub);
    let privateKey = env.push.privateKey || await read(KEYS.priv);
    if (!publicKey || !privateKey) {
      ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
      await Promise.all([save(KEYS.pub, publicKey), save(KEYS.priv, privateKey)]);
    }
    const site = (env.frontendUrl || '').replace(/\/$/, '');
    webpush.setVapidDetails(site.startsWith('https://') ? site : 'mailto:admin@example.com', publicKey, privateKey);
    return publicKey;
  })().catch(err => { ready = null; throw err; });
  return ready;
}

export const vapidPublicKey = () => setup();

export async function subscribe(userId, subscription, userAgent) {
  const { endpoint, keys } = subscription || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw Object.assign(new Error('Invalid push subscription'), { status: 400 });
  const data = { userId, p256dh: keys.p256dh, auth: keys.auth, userAgent: String(userAgent || '').slice(0, 250) || null };
  await prisma.pushSubscription.upsert({ where: { endpoint }, update: data, create: { endpoint, ...data } });
}

export const unsubscribe = (userId, endpoint) => prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });

const send = async (sub, payload) => {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600, urgency: 'high' });
    return true;
  } catch (err) {
    // The browser forgot this subscription (uninstalled, permission revoked): drop it
    if (err.statusCode === 404 || err.statusCode === 410) await prisma.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } });
    else console.error('[Push] send failed:', err.statusCode || err.message);
    return false;
  }
};

// { title, body, url (admin path, e.g. /admin/orders/3), tag (a newer push with the
// same tag replaces the older one) }. Only to `userId` when given (the test button).
export async function pushStaff({ title, body, url = '/admin', tag }, userId) {
  try {
    await setup();
    const subs = await prisma.pushSubscription.findMany({
      where: { user: { role: { in: STAFF }, isActive: true }, ...(userId ? { userId } : {}) },
    });
    if (!subs.length) return 0;
    const payload = JSON.stringify({ title, body, url, tag });
    const results = await Promise.all(subs.map(s => send(s, payload)));
    return results.filter(Boolean).length;
  } catch (err) {
    console.error('[Push] failed:', err.message);
    return 0;
  }
}
