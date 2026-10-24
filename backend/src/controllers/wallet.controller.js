import { getUserBalance } from '../services/balance.service.js';
import { getCachedUsdPrices } from '../services/price.service.js';
import { walletService } from '../services/wallet.service.js';
import { cryptoService } from '../services/crypto.service.js';
import { prisma } from '../db.js';
import { ok } from '../utils/response.js';
import { parsePaginationParams, buildPagination } from '../utils/pagination.js';

export const walletController = {
  async getWallet(req, res) {
    const data = await walletService.getWalletInfo(req.user.sub);
    res.json(ok(data));
  },

  async getBalance(req, res) {
    const { balance, holdings } = await getUserBalance(req.user.sub);
    res.json(ok({ balance, holdings }));
  },

  // Live prices used to value balances — polled by the client to keep it current
  async getPrices(req, res) {
    res.json(ok({ prices: await getCachedUsdPrices(), pricedAt: new Date().toISOString() }));
  },

  async getDeposits(req, res) {
    const { page, limit, skip } = parsePaginationParams(req.query);
    const [deposits, total] = await Promise.all([
      prisma.deposit.findMany({
        where:   { userId: req.user.sub },
        skip, take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.deposit.count({ where: { userId: req.user.sub } }),
    ]);
    res.json(ok({ deposits, pagination: buildPagination(page, limit, total) }));
  },

  async getDeposit(req, res) {
    const deposit = await prisma.deposit.findFirstOrThrow({
      where: { id: parseInt(req.params.id, 10), userId: req.user.sub },
    });
    res.json(ok(deposit));
  },

  async createDeposit(req, res) {
    const { currency } = req.body;
    if (!currency) {
      return res.status(400).json({ success: false, error: 'currency is required' });
    }
    const deposit = await walletService.createDeposit(req.user.sub, currency.toUpperCase());
    res.status(201).json(ok(deposit));
  },

  async checkDeposit(req, res) {
    const depositId = parseInt(req.params.id, 10);

    // Load deposit — must belong to this user
    const deposit = await prisma.deposit.findFirst({
      where: { id: depositId, userId: req.user.sub },
    });
    if (!deposit) return res.status(404).json({ success: false, error: 'Deposit not found' });

    // Already confirmed or expired — return as-is
    if (!['awaiting', 'partial'].includes(deposit.status)) {
      return res.json(ok({ deposit, blockchainResult: null }));
    }

    const result = await cryptoService.checkDepositOnChain(deposit);

    if (result.confirmed) {
      await walletService.confirmDeposit(deposit.id, result.cryptoAmount);
    }

    const updated = await prisma.deposit.findUnique({ where: { id: deposit.id } });
    res.json(ok({ deposit: updated, blockchainResult: result }));
  },

  async getTransactions(req, res) {
    const { page, limit, skip } = parsePaginationParams(req.query);
    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where:   { userId: req.user.sub },
        skip, take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.transaction.count({ where: { userId: req.user.sub } }),
    ]);
    res.json(ok({ transactions, pagination: buildPagination(page, limit, total) }));
  },
};
