import { isAddress } from 'ethers';
import { prisma } from '../../db.js';
import { cryptoService } from '../../services/crypto.service.js';
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

// Marks each swept share on its deposit and logs it. A share that went along
// because the other one was below dust settles the other side too.
async function record(kind, currency, results, destination, userId) {
  const now = new Date();
  for (const r of results) {
    if (r.status === 'empty' && r.settle) {
      await prisma.deposit.update({ where: { id: r.depositId }, data: { shopSweptAt: now, shopSweepTx: 'empty' } });
      continue;
    }
    if (r.status !== 'swept') continue;

    const mine  = kind === 'shop' ? { shopSweptAt: now, shopSweepTx: r.txHash } : { reserveSweptAt: now, reserveSweepTx: r.txHash };
    const other = kind === 'shop' ? { reserveSweptAt: now, reserveSweepTx: 'dust' } : { shopSweptAt: now, shopSweepTx: 'dust' };
    await prisma.deposit.update({ where: { id: r.depositId }, data: { ...mine, ...(r.settlesOther ? other : {}) } });

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

function summarize(kind, currency, results) {
  const swept   = results.filter(r => r.status === 'swept');
  const skipped = results.filter(r => r.status !== 'swept' && r.status !== 'empty');
  const total   = swept.reduce((s, r) => s + Number(r.amount || 0), 0);
  return {
    kind, currency,
    swept:   swept.length,
    results: swept.map(({ settle, settlesOther, commissionPct, ...r }) => r),
    skipped,
    total:   total.toFixed(8).replace(/\.?0+$/, '') || '0',
  };
}

async function sweep(kind, currency, req) {
  const destination = await getDestination(kind, currency);
  const results = await withLock(currency, () => currency === 'ETH'
    ? cryptoService.sweepEthShare(kind, destination)
    : cryptoService.sweepUtxoShare(kind, currency, destination));
  await record(kind, currency, results, destination, req.user.sub);
  return summarize(kind, currency, results);
}

// Unswept amounts per currency, as recorded when each deposit was credited
async function pendingTotals(kind) {
  const field = kind === 'shop' ? 'netAmount' : 'commissionAmount';
  const rows = await prisma.deposit.groupBy({
    by: ['currency'],
    where: kind === 'shop'
      ? { status: 'confirmed', shopSweptAt: null }
      : { status: 'confirmed', reserveSweptAt: null, commissionAmount: { gt: 0 } },
    _sum:   { [field]: true },
    _count: { _all: true },
  });
  return rows.map(r => ({ currency: r.currency, amount: Number(r._sum[field] || 0), deposits: r._count._all }));
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
    res.json(ok({ pending: await pendingTotals('shop') }));
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
