import { PrismaClient } from '@prisma/client';
import { currentTenant } from './tenant.js';

const base = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// ─── Bots platform: one shop per owner (see tenant.js) ───────────────────────
// With an owner in context every query is scoped to them: models that carry a
// tenantId directly, and models that belong to a customer through `user`. Their
// slugs, voucher codes and settings get the owner's prefix, so two owners can
// both have a "flower" shelf or a WELCOME10 code. Without an owner nothing changes.
const OWN = new Set(['User', 'TelegramBot', 'BotStyle', 'Product', 'Category', 'Voucher', 'SweepLog']);
const VIA_USER = new Set(['Order', 'Deposit', 'Transaction', 'SupportTicket', 'Notification', 'Message', 'WalletHolding', 'Review', 'ApiKey', 'PushSubscription']);
const READS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);
const WHERE_OPS = new Set([...READS, 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']);

// Settings every owner shares: the platform's commission, seed, push keys
const GLOBAL_SETTING = k => /^(super_|push_|telegram_reader_)/.test(k) || ['btc_hd_seed', 'site_password', 'gate_show_password'].includes(k)
  || /^telegram_(bot_token|chat_id|webhook_secret|seen_chats|branded|post_chat_id)$/.test(k);
const OWNER_KEY = /^t\d+:/;
// Payout addresses never fall back on another owner's (or the platform's): money
// would go to the wrong wallet
const NO_FALLBACK = k => /_address$/.test(k);

const and = (where, extra) => ({ ...(where || {}), AND: [...(Array.isArray(where?.AND) ? where.AND : where?.AND ? [where.AND] : []), extra] });

function scopeOf(model, t, op) {
  if (model === 'BotStyle') return READS.has(op) ? { tenantId: { in: [0, t] } } : { tenantId: t }; // the shared presets are read-only
  if (OWN.has(model)) return { tenantId: t };
  if (VIA_USER.has(model)) return { user: { tenantId: t } };
  return null;
}

// "flower" → "t5-flower" (equality, in, startsWith); already prefixed values are kept
function prefixed(value, p) {
  const one = v => (typeof v === 'string' && !v.startsWith(p) ? p + v : v);
  if (typeof value === 'string') return one(value);
  if (value && typeof value === 'object') {
    const out = { ...value };
    for (const k of ['equals', 'startsWith', 'not', 'set']) if (typeof out[k] === 'string') out[k] = one(out[k]);
    for (const k of ['in', 'notIn']) if (Array.isArray(out[k])) out[k] = out[k].map(one);
    return out;
  }
  return value;
}
const PREFIXED_FIELDS = { Category: ['slug'], Product: ['slug', 'sku'], Voucher: ['code'] };
const prefixOf = (model, t) => (model === 'Voucher' ? `T${t}-` : `t${t}-`);

function rewriteFields(obj, model, t) {
  const fields = PREFIXED_FIELDS[model];
  if (!t || !fields || !obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const f of fields) if (out[f] != null) out[f] = prefixed(out[f], prefixOf(model, t));
  return out;
}
// Voucher codes read back as the owner typed them
const stripCode = (r, t) => {
  const p = `T${t}-`;
  const one = v => (v && typeof v.code === 'string' && v.code.startsWith(p) ? { ...v, code: v.code.slice(p.length) } : v);
  return Array.isArray(r) ? r.map(one) : one(r);
};

// Settings: the owner's own value ("t5:min_deposit"), else the platform's
async function settingQuery(op, args, query, t) {
  const p = `t${t}:`;
  const mine = k => (typeof k === 'string' && !GLOBAL_SETTING(k) && !k.startsWith(p) ? p + k : k);
  const strip = r => (r && typeof r.key === 'string' && r.key.startsWith(p) ? { ...r, key: r.key.slice(p.length) } : r);
  const key = args.where?.key;
  if (op === 'findUnique' || op === 'findUniqueOrThrow' || op === 'findFirst' || op === 'findFirstOrThrow') {
    if (typeof key === 'string' && !GLOBAL_SETTING(key)) {
      const own = await base.siteSetting.findUnique({ ...args, where: { ...args.where, key: mine(key) } });
      if (own) return strip(own);
      if (NO_FALLBACK(key)) return null;
    }
    return query(args);
  }
  if (op === 'findMany') {
    const keys = Array.isArray(key?.in) ? key.in : null;
    const own = await base.siteSetting.findMany({ ...args, where: { key: keys ? { in: keys.map(mine) } : { startsWith: p } } });
    const shared = (await query(args)).filter(r => !OWNER_KEY.test(r.key) && (GLOBAL_SETTING(r.key) || !NO_FALLBACK(r.key)));
    const mineByKey = new Map(own.map(r => [strip(r).key, strip(r)]));
    return [...shared.filter(r => !mineByKey.has(r.key)), ...mineByKey.values()];
  }
  if (op === 'upsert') {
    const k = mine(key);
    return strip(await query({ ...args, where: { ...args.where, key: k }, create: { ...args.create, key: k } }));
  }
  if (['update', 'delete', 'updateMany', 'deleteMany', 'count'].includes(op) && key !== undefined) {
    const k = typeof key === 'string' ? mine(key) : Array.isArray(key?.in) ? { ...key, in: key.in.map(mine) } : key;
    return query({ ...args, where: { ...args.where, key: k } });
  }
  if (op === 'create') return strip(await query({ ...args, data: { ...args.data, key: mine(args.data?.key) } }));
  return query(args);
}

export const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation: op, args, query }) {
        const t = currentTenant();
        if (t === null) {
          // The super admin's settings list never shows the owners' own values
          if (model === 'SiteSetting' && op === 'findMany') return (await query(args)).filter(r => !OWNER_KEY.test(r.key));
          return query(args);
        }
        // 0: the super admin's own shop (its sweeps): scoped, but the platform's settings and unprefixed names
        if (model === 'SiteSetting') return t ? settingQuery(op, args, query, t) : query(args);
        const a = { ...args };
        if (WHERE_OPS.has(op)) {
          const scope = scopeOf(model, t, op);
          a.where = rewriteFields(a.where, model, t);
          if (scope) a.where = and(a.where, scope);
        }
        // New rows belong to the owner
        const own = OWN.has(model) ? { tenantId: t } : {};
        if (op === 'create') a.data = { ...own, ...rewriteFields(a.data, model, t) };
        if (op === 'createMany') a.data = (Array.isArray(a.data) ? a.data : [a.data]).map(d => ({ ...own, ...rewriteFields(d, model, t) }));
        if (op === 'upsert') { a.create = { ...own, ...rewriteFields(a.create, model, t) }; a.update = rewriteFields(a.update, model, t); }
        if (op === 'update' || op === 'updateMany') a.data = rewriteFields(a.data, model, t);
        const r = await query(a);
        return model === 'Voucher' && t ? stripCode(r, t) : r;
      },
    },
  },
});
