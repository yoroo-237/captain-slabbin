import { env } from '../../config/env.js';
import { withTenant } from '../../tenant.js';
import { isAddress } from 'ethers';
import { prisma } from '../../db.js';
import { cryptoService, shopOwed, reserveOwed } from '../../services/crypto.service.js';
import { walletService } from '../../services/wallet.service.js';
import { getCachedUsdPrice } from '../../services/price.service.js';
import { ok } from '../../utils/response.js';
import { appError } from '../../utils/formatters.js';

// The commission is deducted from each customer deposit when it is credited
// (wallet.service) and belongs to the super admin's reserve fund. Two separate
// sweeps collect the funds left on the deposit addresses:
//   - admin:       the customer-credited share → the site's address (Settings → Crypto)
//   - super admin: the commission              → the reserve address of the currency
// Admins have no view of the commission. Reserve settings live in SiteSetting
// under "super_" keys, which the generic settings endpoints never expose or accept.

const DEFAULT_PCT = 10;

const COMMISSION_KEYS = {
  pct:  'super_sweep_commission_pct',
  BTC:  'super_btc_commission_address',
  LTC:  'super_ltc_commission_address',
  DOGE: 'super_doge_commission_address',
  ETH:  'super_eth_commission_address',
};

// Request body field → currency
const BODY_FIELDS = {
  btcCommissionAddress:  'BTC',
  ltcCommissionAddress:  'LTC',
  dogeCommissionAddress: 'DOGE',
  ethCommissionAddress:  'ETH',
};

const UTXO_CURRENCIES = ['BTC', 'LTC', 'DOGE'];

// One sweep per currency at a time: a double click (or the admin and super admin
// sweeping together) must not build two transactions spending the same outputs.
const running = new Set();

async function readCommission() {
  const rows = await prisma.siteSetting.findMany({ where: { key: { in: Object.values(COMMISSION_KEYS) } } });
  const map  = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const pct  = map[COMMISSION_KEYS.pct] != null ? Number(map[COMMISSION_KEYS.pct]) : DEFAULT_PCT;
  return {
    commissionPct:         Number.isFinite(pct) ? pct : DEFAULT_PCT,
    btcCommissionAddress:  map[COMMISSION_KEYS.BTC]  || '',
    ltcCommissionAddress:  map[COMMISSION_KEYS.LTC]  || '',
    dogeCommissionAddress: map[COMMISSION_KEYS.DOGE] || '',
    ethCommissionAddress:  map[COMMISSION_KEYS.ETH]  || '',
  };
}

const isSuper = req => req.user.role === 'superadmin';
const redactLog = ({ commissionAddress, commissionTxHash, commissionAmount, commissionPct, ...log }) => log;

async function getDestination(kind, currency) {
  if (kind === 'reserve') {
    const address = (await readCommission())[`${currency.toLowerCase()}CommissionAddress`];
    if (!address) throw appError(`${currency} reserve address not configured — set it in the super admin panel.`, 400);
    return address;
  }
  const setting = await prisma.siteSetting.findUnique({ where: { key: `${currency.toLowerCase()}_address` } });
  const destination = setting?.value?.trim();
  if (!destination) throw appError(`${currency} destination address not configured (Admin → Settings → Crypto)`, 400);
  return destination;
}

async function withLock(currency, fn) {
  if (running.has(currency)) throw appError(`A ${currency} sweep is already running — wait for it to finish.`, 409);
  running.add(currency);
  try { return await fn(); }
  finally { running.delete(currency); }
}

// Marks each swept share on its deposit and logs it. What a side took is kept in its
// *SweptAmount (a customer can pay the same address again later). A share that went along
// because the other one was below dust settles the other side too; a partial sweep (a USD
// amount was chosen) leaves the deposit open for the rest. Guarded by the amount received:
// a payment credited meanwhile keeps the deposit open for that new share.
async function record(kind, currency, results, destination, userId) {
  const now = new Date();
  const side = (k, tx, dep) => k === 'shop'
    ? { shopSweptAt: now, shopSweepTx: tx, shopSweptAmount: dep.netAmount }
    : { reserveSweptAt: now, reserveSweepTx: tx, reserveSweptAmount: dep.commissionAmount };
  const settle = async (r, data) => {
    const { count } = await prisma.deposit.updateMany({ where: { id: r.depositId, amountReceived: r.dep.amountReceived }, data });
    if (!count) {
      const amounts = Object.fromEntries(Object.entries(data).filter(([k]) => k.endsWith('SweptAmount')));
      await prisma.deposit.update({ where: { id: r.depositId }, data: amounts });
    }
  };
  for (const r of results) {
    if (r.status === 'empty' && r.settle) {
      // Really empty (an older sweep emptied it): both sides settled, out of the Pending
      await settle(r, { ...side('shop', 'empty', r.dep), ...side('reserve', 'empty', r.dep) });
      continue;
    }
    if (r.status !== 'swept') continue;

    if (r.partial) {
      const field = kind === 'shop' ? 'shopSweptAmount' : 'reserveSweptAmount';
      await prisma.deposit.update({
        where: { id: r.depositId },
        data: { [field]: { increment: Math.round(Number(r.taken) * 1e8) / 1e8 }, [kind === 'shop' ? 'shopSweepTx' : 'reserveSweepTx']: r.txHash },
      });
    } else {
      await settle(r, { ...side(kind, r.txHash, r.dep), ...(r.settlesOther ? side(kind === 'shop' ? 'reserve' : 'shop', 'dust', r.dep) : {}) });
    }

    const amount = Number(r.amount);
    await prisma.sweepLog.create({
      data: {
        kind, currency,
        commissionPct:     r.commissionPct || 0,
        totalAmount:       amount,
        mainAmount:        kind === 'shop' ? amount : 0,
        mainAddress:       kind === 'shop' ? destination : '',
        mainTxHash:        kind === 'shop' ? r.txHash || null : null,
        commissionAmount:  kind === 'reserve' ? amount : 0,
        commissionAddress: kind === 'reserve' ? destination : '',
        commissionTxHash:  kind === 'reserve' ? r.txHash || null : null,
        addressCount:      1,
        triggeredBy:       userId,
      },
    }).catch(err => console.error(`[Sweep] Failed to log ${kind} ${currency} sweep ${r.txHash}:`, err.message));
  }
}

function summarize(kind, currency, results, extra = {}) {
  const swept   = results.filter(r => r.status === 'swept');
  const skipped = results.filter(r => r.status !== 'swept' && !(r.status === 'empty' && !r.settle))
    .filter(r => r.status !== 'swept')
    .map(r => (r.status === 'empty' ? { ...r, reason: 'empty (settled)' } : r))
    .map(({ dep, settle, ...r }) => r);
  const total   = swept.reduce((s, r) => s + Number(r.amount || 0), 0);
  return {
    kind, currency,
    swept:   swept.length,
    results: swept.map(({ settle, settlesOther, commissionPct, dep, taken, ...r }) => r),
    skipped,
    total:   total.toFixed(8).replace(/\.?0+$/, '') || '0',
    ...extra,
    ...(extra.price ? { totalUsd: Math.round(total * extra.price * 100) / 100 } : {}),
  };
}

// Bots platform: the super admin's "shop" sweep is their own shop's (owner 0),
// never the other owners' customers; the reserve sweep stays platform-wide
const ownShop = (req, kind, fn) => (env.platform === 'bots' && kind === 'shop' && isSuper(req) ? withTenant(0, fn) : fn());

async function sweep(kind, currency, req) {
  return ownShop(req, kind, () => sweepAs(kind, currency, req));
}

// An amount to sweep chosen in USD, turned into the coin at the current price; null = all owed
async function budgetFor(currency, usd) {
  if (usd == null || usd === '') return null;
  const value = Number(usd);
  if (!(value > 0)) throw appError('The amount to sweep must be a positive USD amount.', 400);
  const price = await getCachedUsdPrice(currency);
  if (!price) throw appError(`The ${currency} price is unavailable right now: sweep everything, or try again in a minute.`, 503);
  return { usd: value, price, coins: Math.floor(value / price * 1e8) / 1e8 };
}

// Deposits not validated yet (awaiting, partial, or expired in the last 30 days) whose address
// already received payments: credited to the customer first, so a sweep never leaves them out
// (and never takes money that was not credited).
async function creditUnvalidated(currency) {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const open = await prisma.deposit.findMany({
    where: {
      currency, address: { not: 'pending' },
      OR: [{ status: { in: ['awaiting', 'partial'] } }, { status: 'expired', createdAt: { gt: since } }],
    },
    orderBy: { id: 'asc' },
  });
  let n = 0;
  for (const d of open) {
    try { if ((await walletService.syncDeposit(d)).credited > 0) n++; }
    catch (e) { console.warn(`[Sweep] could not read deposit #${d.id}:`, e.message); }
  }
  return n;
}

// Credits the payments made to an address since it was read, then reloads the deposit
const refresh = async dep => {
  await walletService.syncDeposit(dep).catch(e => console.warn(`[Sweep] could not read deposit #${dep.id}:`, e.message));
  return prisma.deposit.findUniqueOrThrow({ where: { id: dep.id } });
};

async function sweepAs(kind, currency, req) {
  const destination = await getDestination(kind, currency);
  const budget = await budgetFor(currency, req.body?.usd);
  const results = await withLock(currency, async () => {
    const creditedFirst = currency === 'XMR' ? 0 : await creditUnvalidated(currency);
    const opts = { refresh, budget: budget?.coins ?? null };
    const list = currency === 'ETH'
      ? await cryptoService.sweepEthShare(kind, destination, opts)
      : await cryptoService.sweepUtxoShare(kind, currency, destination, opts);
    list.creditedFirst = creditedFirst;
    return list;
  });
  await record(kind, currency, results, destination, req.user.sub);
  return summarize(kind, currency, results, {
    creditedFirst: results.creditedFirst,
    ...(budget ? { requestedUsd: budget.usd, requested: budget.coins.toFixed(8).replace(/\.?0+$/, ''), price: budget.price } : {}),
  });
}

// What each side is still owed per currency (only what was not swept yet)
async function pendingTotals(kind) {
  const rows = await prisma.deposit.findMany({
    where: kind === 'shop'
      ? { status: 'confirmed', shopSweptAt: null }
      : { status: 'confirmed', reserveSweptAt: null, commissionAmount: { gt: 0 } },
    select: { currency: true, netAmount: true, shopSweptAmount: true, commissionAmount: true, reserveSweptAmount: true },
  });
  const by = {};
  for (const d of rows) {
    const owed = kind === 'shop' ? shopOwed(d) : reserveOwed(d);
    by[d.currency] = by[d.currency] || { currency: d.currency, amount: 0, deposits: 0 };
    by[d.currency].amount = Math.round((by[d.currency].amount + owed) * 1e8) / 1e8;
    by[d.currency].deposits++;
  }
  return Object.values(by);
}

export const sweepController = {
  async getCommission(req, res) {
    res.json(ok(await readCommission()));
  },

  async updateCommission(req, res) {
    const { commissionPct } = req.body;
    const updates = {};

    if (commissionPct !== undefined) {
      const pct = Number(commissionPct);
      if (!Number.isFinite(pct) || pct < 0 || pct >= 100) throw appError('commissionPct must be a number from 0 to 99', 400);
      updates[COMMISSION_KEYS.pct] = String(pct);
    }

    for (const [field, currency] of Object.entries(BODY_FIELDS)) {
      if (req.body[field] === undefined) continue;
      const value = String(req.body[field]).trim();
      if (value) {
        const valid = currency === 'ETH' ? isAddress(value) : cryptoService.isValidUtxoAddress(currency, value);
        if (!valid) throw appError(`Invalid ${currency} reserve address`, 400);
      }
      updates[COMMISSION_KEYS[currency]] = value;
    }

    await prisma.$transaction(
      Object.entries(updates).map(([key, value]) =>
        prisma.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
      )
    );
    res.json(ok(await readCommission()));
  },

  async listLogs(req, res) {
    const logs = await prisma.sweepLog.findMany({
      where:   isSuper(req) ? {} : { kind: { in: ['shop', 'legacy'] } },
      orderBy: { createdAt: 'desc' },
      take:    200,
      include: { triggeredByUser: { select: { id: true, username: true } } },
    });
    res.json(ok({ logs: isSuper(req) ? logs : logs.map(redactLog) }));
  },

  // ─── Admin: customer-credited share ──────────────────────────────────────────
  async sweepUtxo(req, res) {
    const currency = req.params.currency?.toUpperCase();
    if (!UTXO_CURRENCIES.includes(currency)) throw appError('Unsupported currency for sweep', 400);
    res.json(ok(await sweep('shop', currency, req)));
  },

  async sweepEth(req, res) {
    res.json(ok(await sweep('shop', 'ETH', req)));
  },

  async shopPending(req, res) {
    res.json(ok({ pending: await ownShop(req, 'shop', () => pendingTotals('shop')) }));
  },

  // ─── Super admin: deposit commissions ────────────────────────────────────────
  async sweepReserveUtxo(req, res) {
    const currency = req.params.currency?.toUpperCase();
    if (!UTXO_CURRENCIES.includes(currency)) throw appError('Unsupported currency for sweep', 400);
    res.json(ok(await sweep('reserve', currency, req)));
  },

  async sweepReserveEth(req, res) {
    res.json(ok(await sweep('reserve', 'ETH', req)));
  },

  async reservePending(req, res) {
    const [pending, collected] = await Promise.all([
      pendingTotals('reserve'),
      prisma.deposit.groupBy({
        by: ['currency'], where: { status: 'confirmed', commissionAmount: { gt: 0 } },
        _sum: { commissionAmount: true },
      }),
    ]);
    res.json(ok({
      pending,
      collected: collected.map(r => ({ currency: r.currency, amount: Number(r._sum.commissionAmount || 0) })),
    }));
  },
};
