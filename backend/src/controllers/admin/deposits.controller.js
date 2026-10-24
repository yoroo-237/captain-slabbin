import axios from 'axios';
import { JsonRpcProvider, formatEther } from 'ethers';
import { prisma } from '../../db.js';
import { env } from '../../config/env.js';
import { walletService } from '../../services/wallet.service.js';
import { cryptoService } from '../../services/crypto.service.js';
import { getUsdPrice, PRICE_SOURCE } from '../../services/price.service.js';
import { ok } from '../../utils/response.js';
import { parsePaginationParams, buildPagination } from '../../utils/pagination.js';
import { appError } from '../../utils/formatters.js';

const BLOCKCYPHER_CHAIN = { BTC: 'btc/main', LTC: 'ltc/main', DOGE: 'doge/main' };
const usd = (amount, price) => (amount != null && price ? parseFloat((amount * price).toFixed(2)) : null);

// Decimal columns arrive as strings — the dashboard works with numbers
function serialize(d) {
  return {
    ...d,
    amountExpected: d.amountExpected != null ? Number(d.amountExpected) : null,
    amountReceived: Number(d.amountReceived),
    usdCredited:    Number(d.usdCredited),
    netAmount:      Number(d.netAmount),
    // The commission belongs to the super admin's reserve — not exposed here
    commissionPct: undefined, commissionAmount: undefined, reserveSweptAt: undefined, reserveSweepTx: undefined,
  };
}

async function findDeposit(req) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw appError('Invalid deposit ID', 400);
  const deposit = await prisma.deposit.findUnique({
    where:   { id },
    include: { user: { select: { id: true, username: true } } },
  });
  if (!deposit) throw appError('Deposit not found', 404);
  return deposit;
}

export const adminDepositsController = {
  async list(req, res) {
    const { page, limit, skip } = parsePaginationParams(req.query);
    const { status, currency } = req.query;

    const where = {};
    if (status)   where.status   = status;
    if (currency) where.currency = currency.toUpperCase();

    const [deposits, total] = await Promise.all([
      prisma.deposit.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, username: true } } },
      }),
      prisma.deposit.count({ where }),
    ]);
    res.json(ok({ deposits: deposits.map(serialize), pagination: buildPagination(page, limit, total) }));
  },

  async confirm(req, res) {
    const id          = parseInt(req.params.id, 10);
    const { amount, usdAmount, note } = req.body;

    // `amount` is the crypto actually received. `usdAmount` is still accepted and
    // converted at the current price for older clients.
    let qty = parseFloat(amount);
    if (!(qty > 0) && parseFloat(usdAmount) > 0) {
      const d = await prisma.deposit.findUniqueOrThrow({ where: { id } });
      const price = await getUsdPrice(d.currency);
      if (!price) throw appError(`${d.currency} price unavailable — enter the crypto amount received instead`, 503);
      qty = parseFloat(usdAmount) / price;
    }
    if (!(qty > 0)) throw appError('amount (crypto received) must be a positive number', 400);

    const txn = await walletService.confirmDeposit(id, qty, note?.trim() || null);
    res.json(ok({ message: 'Deposit confirmed and balance credited', transaction: txn }));
  },

  async expire(req, res) {
    const id = parseInt(req.params.id, 10);
    const deposit = await prisma.deposit.findUniqueOrThrow({ where: { id } });

    if (!['awaiting', 'partial'].includes(deposit.status)) {
      throw appError(`Only awaiting or partial deposits can be expired (this one is ${deposit.status})`, 409);
    }

    if (deposit.hookId && BLOCKCYPHER_CHAIN[deposit.currency]) {
      await cryptoService.deleteBlockcypherHook(deposit.hookId, deposit.currency);
    }

    const updated = await prisma.deposit.update({
      where: { id },
      data:  { status: 'expired' },
    });
    res.json(ok(serialize(updated)));
  },

  // USD value, at the current price, of what was expected and of what was recorded
  // as received — next to what was actually credited to the customer.
  async usdValue(req, res) {
    const d        = await findDeposit(req);
    const price    = await getUsdPrice(d.currency);
    const expected = d.amountExpected != null ? Number(d.amountExpected) : null;
    const received = Number(d.amountReceived);

    res.json(ok({
      depositId:      d.id,
      currency:       d.currency,
      price,
      priceSource:    price ? PRICE_SOURCE : null,
      expectedAmount: expected,
      expectedUsd:    usd(expected, price),
      receivedAmount: received,
      receivedUsd:    usd(received, price),
      usdCredited:    Number(d.usdCredited),
      status:         d.status,
    }));
  },

  // Live balance of the deposit address on its blockchain (independent of the database).
  async onchain(req, res) {
    const d = await findDeposit(req);
    if (!d.address || d.address === 'pending') throw appError('This deposit has no address yet', 422);
    if (d.currency === 'XMR') {
      throw appError('XMR deposits share a single wallet address — check the balance in your Monero wallet.', 422);
    }

    let onchain;
    try {
      if (BLOCKCYPHER_CHAIN[d.currency]) {
        if (!env.blockcypherToken) throw appError('BLOCKCYPHER_TOKEN not configured', 500);
        const { data } = await axios.get(
          `https://api.blockcypher.com/v1/${BLOCKCYPHER_CHAIN[d.currency]}/addrs/${d.address}/balance?token=${env.blockcypherToken}`,
          { timeout: 10000 },
        );
        const coins = v => (v || 0) / 1e8;
        onchain = {
          confirmed:     coins(data.balance),
          unconfirmed:   coins(data.unconfirmed_balance),
          total:         coins(data.final_balance),
          totalReceived: coins(data.total_received),
          totalSent:     coins(data.total_sent),
          txCount:       data.final_n_tx ?? data.n_tx ?? 0,
          source:        'BlockCypher',
        };
      } else {
        if (!env.alchemy.apiKey) throw appError('ALCHEMY_API_KEY not configured', 500);
        const provider = new JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${env.alchemy.apiKey}`);
        const [wei, txCount] = await Promise.all([provider.getBalance(d.address), provider.getTransactionCount(d.address)]);
        const eth = Number(formatEther(wei));
        onchain = { confirmed: eth, unconfirmed: 0, total: eth, totalReceived: null, totalSent: null, txCount, source: 'Alchemy' };
      }
    } catch (err) {
      if (err.status) throw err;
      throw appError(`On-chain lookup failed: ${err.response?.data?.error || err.message}`, 502);
    }

    const price = await getUsdPrice(d.currency);
    res.json(ok({
      depositId:        d.id,
      currency:         d.currency,
      address:          d.address,
      ...onchain,
      price,
      totalUsd:         usd(onchain.total, price),
      totalReceivedUsd: usd(onchain.totalReceived, price),
      recordedReceived: Number(d.amountReceived),
      usdCredited:      Number(d.usdCredited),
    }));
  },

  // Checks that the address stored for a BTC/LTC/DOGE deposit is still the one the
  // current HD seed derives — if not, sweeps cannot sign for it.
  async verifyAddress(req, res) {
    const d = await findDeposit(req);
    if (!BLOCKCYPHER_CHAIN[d.currency]) {
      throw appError('Address verification only applies to BTC / LTC / DOGE deposits', 422);
    }
    const { address: derivedAddress } = await cryptoService.deriveUtxoKey(d.currency, d.id);
    res.json(ok({
      depositId:     d.id,
      currency:      d.currency,
      storedAddress: d.address,
      derivedAddress,
      match:         d.address === derivedAddress,
      user:          d.user,
    }));
  },

  async cleanup(req, res) {
    const result = await walletService.cleanupExpiredDeposits();
    res.json(ok({
      message: `${result.cleaned} expired deposit(s) cleaned up and BlockCypher forwards deleted`,
      cleaned: result.cleaned,
    }));
  },

  async purgeBlockcypher(req, res) {
    const result = await cryptoService.purgeAllBlockcypherForwards(['BTC', 'LTC', 'DOGE']);
    res.json(ok({
      message: `BlockCypher purge complete: ${result.deleted} forward(s) deleted, ${result.failed} failed`,
      ...result,
    }));
  },

  async reregisterWebhook(req, res) {
    const id      = parseInt(req.params.id, 10);
    const deposit = await prisma.deposit.findUniqueOrThrow({ where: { id } });

    if (!['BTC', 'LTC', 'DOGE'].includes(deposit.currency)) {
      throw appError('Webhook re-registration only applies to BTC/LTC/DOGE deposits', 400);
    }
    if (!deposit.address) throw appError('Deposit has no address yet', 400);

    const CHAIN_MAP = { BTC: 'btc/main', LTC: 'ltc/main', DOGE: 'doge/main' };
    const hookId = await cryptoService._registerAddressWebhook(CHAIN_MAP[deposit.currency], deposit.address);

    await prisma.deposit.update({ where: { id }, data: { hookId } });
    res.json(ok({ message: hookId ? 'Webhook registered' : 'BlockCypher registration failed (check PUBLIC_URL)', hookId }));
  },
};
