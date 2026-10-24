import { prisma } from '../db.js';
import { getCachedUsdPrices, CURRENCIES } from './price.service.js';

// Customer balances are crypto quantities (WalletHolding), already net of the
// deposit commission. Their USD value is never stored: it is amount × live price.

export const round8 = n => Math.round(n * 1e8) / 1e8;
const ceil8  = n => Math.ceil(n * 1e8 - 1e-6) / 1e8;
export const round2 = n => Math.round(n * 100) / 100;

export async function getHoldings(userId, client = prisma) {
  const rows = await client.walletHolding.findMany({ where: { userId } });
  return rows
    .map(r => ({ currency: r.currency, amount: parseFloat(r.amount) }))
    .filter(r => r.amount > 0);
}

// Holdings valued at live prices. A holding whose price is unavailable is listed
// with usd: null and left out of the total rather than counted as zero silently.
export async function valueHoldings(holdings, prices = null) {
  const p = prices || await getCachedUsdPrices(holdings.map(h => h.currency));
  const lines = holdings.map(h => ({
    currency: h.currency,
    amount:   h.amount,
    price:    p[h.currency] ?? null,
    usd:      p[h.currency] ? round2(h.amount * p[h.currency]) : null,
  }));
  const balance = round2(lines.reduce((s, l) => s + (l.usd || 0), 0));
  return { balance, holdings: lines, pricesComplete: lines.every(l => l.price != null) };
}

export async function getUserBalance(userId) {
  return valueHoldings(await getHoldings(userId));
}

// Live USD balances for many users at once (admin lists).
export async function getBalancesForUsers(userIds) {
  if (!userIds.length) return {};
  const rows = await prisma.walletHolding.findMany({ where: { userId: { in: userIds }, amount: { gt: 0 } } });
  const prices = await getCachedUsdPrices(rows.map(r => r.currency));
  const out = Object.fromEntries(userIds.map(id => [id, 0]));
  for (const r of rows) {
    const price = prices[r.currency];
    if (price) out[r.userId] = round2(out[r.userId] + parseFloat(r.amount) * price);
  }
  return out;
}

export async function credit(tx, userId, currency, amount) {
  return tx.walletHolding.upsert({
    where:  { userId_currency: { userId, currency } },
    update: { amount: { increment: round8(amount) } },
    create: { userId, currency, amount: round8(amount) },
  });
}

export async function debit(tx, userId, currency, amount) {
  const row = await tx.walletHolding.findUnique({ where: { userId_currency: { userId, currency } } });
  if (!row || parseFloat(row.amount) + 1e-9 < amount) {
    throw Object.assign(new Error(`Insufficient ${currency} balance.`), { status: 422 });
  }
  return tx.walletHolding.update({
    where: { id: row.id },
    data:  { amount: { decrement: round8(amount) } },
  });
}

// Works out which crypto pays a USD amount at the given (frozen) prices.
// With `payCurrency` only that holding is used; otherwise the largest holdings
// (by USD value) are used first. Returns [{ currency, amount, rate, usd }].
export function allocateUsd(holdings, prices, usdTotal, payCurrency = null) {
  let candidates = holdings.filter(h => h.amount > 0 && prices[h.currency]);
  if (payCurrency) candidates = candidates.filter(h => h.currency === payCurrency);
  candidates.sort((a, b) => b.amount * prices[b.currency] - a.amount * prices[a.currency]);

  const allocations = [];
  let remaining = round2(usdTotal);
  for (const h of candidates) {
    if (remaining <= 0) break;
    const rate = prices[h.currency];
    const holdingUsd = h.amount * rate;
    if (holdingUsd + 0.005 >= remaining) {
      // Round the crypto up so the shop is never short-changed, capped at the holding.
      const amount = Math.min(h.amount, ceil8(remaining / rate));
      allocations.push({ currency: h.currency, amount, rate, usd: remaining });
      remaining = 0;
    } else {
      const usd = round2(holdingUsd);
      allocations.push({ currency: h.currency, amount: h.amount, rate, usd });
      remaining = round2(remaining - usd);
    }
  }
  if (remaining > 0) {
    throw Object.assign(
      new Error(payCurrency ? `Insufficient ${payCurrency} balance.` : 'Insufficient balance.'),
      { status: 422 }
    );
  }
  return allocations;
}

export async function getCommissionPct(client = prisma) {
  const row = await client.siteSetting.findUnique({ where: { key: 'super_sweep_commission_pct' } });
  const pct = row?.value != null ? Number(row.value) : 10;
  return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : 10;
}

// Splits a received crypto amount into the customer's credit and the commission.
export function splitDeposit(gross, pct) {
  const commission = round8(gross * pct / 100);
  return { commission, net: round8(gross - commission) };
}

export { CURRENCIES };
