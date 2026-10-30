// Bots platform: every staff member (an "owner") runs their own shop, with their
// own bots, styles, catalog, customers, orders, wallet sweeps and settings. The
// owner of what is being done travels with the request (or the bot update) here,
// and db.js scopes every query to it. The super admin, the site and background
// jobs run without an owner: they see everything.
import { AsyncLocalStorage } from 'async_hooks';
import { env } from './config/env.js';

const store = new AsyncLocalStorage();

// The import scripts run as their own process: the owner comes in TENANT_ID
const fromEnv = () => (Number(process.env.TENANT_ID) > 0 ? Number(process.env.TENANT_ID) : null);

// The owner's id, 0 for the super admin's own shop (its sweeps), or null (no scoping)
export function currentTenant() {
  if (env.platform !== 'bots') return null;
  const s = store.getStore();
  return s ? s.tenant : fromEnv();
}

// A Prisma query only runs once awaited: it is awaited in here, inside the owner's
// context, so `withTenant(t, () => prisma.x.findMany())` is scoped too
export const withTenant = (tenant, fn) => store.run({ tenant: Number.isInteger(Number(tenant)) && Number(tenant) >= 0 && tenant !== null ? Number(tenant) : null }, async () => await fn());
// Lookups that must see every owner (a free username, a token already linked…)
export const unscoped = fn => store.run({ tenant: null }, async () => await fn());

// The owner a signed-in staff member works as: themselves, the super admin no one
export const tenantOfStaff = user => (env.platform === 'bots' && user && user.role !== 'superadmin' ? Number(user.sub ?? user.id) : null);
