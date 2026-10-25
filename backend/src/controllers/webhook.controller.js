import crypto from 'crypto';
import { prisma } from '../db.js';
import { walletService } from '../services/wallet.service.js';
import { ok } from '../utils/response.js';
import { env } from '../config/env.js';
import { getTelegramConfig, rememberChat, tg } from '../services/telegram.service.js';

export const webhookController = {
  // BlockCypher webhook — BTC, LTC, DOGE (confirmed-tx on HD wallet address)
  async blockcypher(req, res) {
    const body = req.body;
    const { address, confirmations } = body;

    if (!address) return res.json(ok('No address in payload'));
    if ((confirmations || 0) < 1) return res.json(ok('Awaiting confirmation'));

    const deposit = await prisma.deposit.findFirst({
      where: { address, status: { in: ['awaiting', 'partial'] } },
    });

    if (!deposit) return res.json(ok('No deposit found for this address'));

    // Sum satoshis received at our address from the transaction outputs
    const outputs = body.outputs || [];
    const satoshis = outputs
      .filter(o => Array.isArray(o.addresses) && o.addresses.includes(address))
      .reduce((sum, o) => sum + (o.value || 0), 0);

    const cryptoAmount = satoshis / 1e8; // satoshis → BTC/LTC/DOGE

    if (cryptoAmount <= 0) {
      console.warn(`[Webhook BlockCypher] Zero value for deposit #${deposit.id}`);
      return res.json(ok('Zero value received'));
    }

    // Credited in crypto (net of the deposit commission) — no price needed
    await walletService.confirmDeposit(deposit.id, cryptoAmount);

    console.log(`[Webhook BlockCypher] Deposit #${deposit.id} auto-confirmed: ${cryptoAmount} ${deposit.currency}`);
    res.json(ok('Deposit auto-confirmed'));
  },

  // Alchemy webhook — ETH
  async alchemy(req, res) {
    const sigHeader = req.headers['x-alchemy-signature'];
    if (env.alchemy.signingKey && sigHeader) {
      const hmac     = crypto.createHmac('sha256', env.alchemy.signingKey);
      const rawBody  = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
      hmac.update(rawBody);
      const expected = hmac.digest('hex');
      if (sigHeader !== expected) {
        console.warn('[Webhook Alchemy] Invalid signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    let body;
    try {
      body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
    } catch {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const activities = body?.event?.activity || [];

    for (const transfer of activities) {
      const toAddress = transfer.toAddress?.toLowerCase();
      if (!toAddress) continue;
      // Only native ETH — an ERC-20 transfer to the same address is not an ETH deposit
      if (transfer.asset && transfer.asset !== 'ETH') continue;

      const deposit = await prisma.deposit.findFirst({
        where: { address: { equals: toAddress, mode: 'insensitive' }, currency: 'ETH', status: { in: ['awaiting', 'partial'] } },
      });

      if (!deposit) continue;

      // Alchemy reports `value` in ETH, not USD — convert at the live price
      const ethAmount = parseFloat(transfer.value || 0);
      if (!(ethAmount > 0)) {
        await prisma.deposit.update({ where: { id: deposit.id }, data: { status: 'partial' } });
        continue;
      }

      await walletService.confirmDeposit(deposit.id, ethAmount);
      console.log(`[Webhook Alchemy] Deposit #${deposit.id} confirmed: ${ethAmount} ETH`);
    }

    res.json(ok('Processed'));
  },

  // Telegram webhook — the linked bot's updates. Remembers the chats it is added
  // to (so Admin → Telegram can switch chat) and answers /shop and /admin.
  // Linked from Admin → Settings → Telegram, which hands Telegram a secret
  // token; every call is checked against it.
  async telegramBot(req, res) {
    const cfg = await getTelegramConfig();
    if (!cfg.token) return res.json(ok('no bot'));
    if (cfg.secret && req.headers['x-telegram-bot-api-secret-token'] !== cfg.secret) return res.status(401).end();

    const upd = req.body || {};
    const chat = upd.message?.chat || upd.my_chat_member?.chat;
    if (chat) await rememberChat(chat).catch(() => {});

    const msg = upd.message;
    const text = msg?.text?.trim();
    if (!text || !msg.chat?.id) return res.json(ok('ignored'));

    const site = (env.frontendUrl || '').replace(/\/$/, '');
    let reply;
    if (text.startsWith('/start') || text.startsWith('/shop')) {
      reply = { text: 'Captain Slabbin: tap below to open the shop.', button: site ? { text: 'Open shop', url: site } : null };
    } else if (text.startsWith('/admin')) {
      reply = { text: 'Admin panel:', button: site ? { text: 'Open admin', url: `${site}/admin` } : null };
    } else if (msg.chat.type === 'private') {
      reply = { text: 'This bot only posts shop notifications. For support, message the shop from your account on the site.' };
    } else {
      // Ordinary chatter in the shop's group: stay quiet
      return res.json(ok('ignored'));
    }

    try {
      await tg(cfg.token, 'sendMessage', {
        chat_id: msg.chat.id,
        text: reply.text,
        ...(reply.button ? { reply_markup: { inline_keyboard: [[reply.button]] } } : {}),
      });
    } catch (err) {
      console.error('[Webhook Telegram] reply failed:', err.message);
    }
    res.json(ok('handled'));
  },
};
