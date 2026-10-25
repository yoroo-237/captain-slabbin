import crypto from 'crypto';
import { prisma } from '../db.js';
import { walletService } from '../services/wallet.service.js';
import { ok } from '../utils/response.js';
import { env } from '../config/env.js';
import { getTelegramConfig, rememberChat, tg } from '../services/telegram.service.js';
import { menuScreen, shelfScreen } from '../services/telegramCatalog.js';
import * as shop from '../services/telegramShop.js';

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
  // The shop's bot: notifications chat bookkeeping, the catalog, and buying with
  // the wallet in a private chat (see services/telegramShop.js)
  async telegramBot(req, res) {
    const cfg = await getTelegramConfig();
    if (!cfg.token) return res.json(ok('no bot'));
    if (cfg.secret && req.headers['x-telegram-bot-api-secret-token'] !== cfg.secret) return res.status(401).end();
    res.json(ok('received')); // answer Telegram at once; the reply goes out below

    const upd = req.body || {};
    // Remember where the bot is (not where it was just removed from)
    const member = upd.my_chat_member;
    const chat = upd.message?.chat || upd.channel_post?.chat
      || (member && ['member', 'administrator'].includes(member.new_chat_member?.status) ? member.chat : null);
    if (chat) await rememberChat(chat).catch(err => console.error('[Webhook Telegram] remember chat:', err.message));

    const show = (chatId, screen, messageId) => screen && tg(cfg.token, messageId ? 'editMessageText' : 'sendMessage', {
      chat_id: chatId,
      ...(messageId ? { message_id: messageId } : {}),
      text: screen.text,
      parse_mode: 'HTML',
      link_preview_options: screen.image ? { url: screen.image, prefer_large_media: true, show_above_text: true } : { is_disabled: true },
      reply_markup: { inline_keyboard: (screen.keyboard || []).filter(r => r.length) },
    }).catch(err => { if (!/not modified/i.test(err.message)) throw err; });

    // Screens for a private chat; anything that needs an account asks for 21+ first
    const screenFor = async (from, data) => {
      const [kind, a, b] = String(data || '').split(':');
      if (kind === 'age') {
        const user = await shop.openAccount(from);
        const menu = await menuScreen(await shop.accountRow(user));
        return { ...menu, text: `✅ Your account <b>${user.username}</b> is ready.

${menu.text}` };
      }
      const user = await shop.findCustomer(from);
      if (!user) return shop.ageScreen();
      if (!user.isActive) return { text: 'This account is disabled. Message the shop for help.', keyboard: [] };
      switch (kind) {
        case 'cat':  return shelfScreen(a, b, { inBot: true });
        case 'p':    return shop.productScreen(a, b);
        case 'buy':  return shop.buyScreen(user, a, b);
        case 'pay':  return shop.payScreen(user, a, b);
        case 'w':    return shop.walletScreen(user);
        case 'dep':  return shop.depositScreen(user, a);
        case 'o':    return shop.ordersScreen(user);
        default:     return menuScreen(await shop.accountRow(user));
      }
    };

    try {
      const cb = upd.callback_query;
      if (cb) {
        const priv = cb.message?.chat?.type === 'private';
        // A tap on Pay shows "Paying…" at once; the screen follows
        await tg(cfg.token, 'answerCallbackQuery', { callback_query_id: cb.id, ...(String(cb.data).startsWith('pay:') ? { text: 'Paying…' } : {}) }).catch(() => {});
        if (!cb.message) return;
        const [kind, a, b] = String(cb.data || '').split(':');
        // In a group the catalog is read-only and products open on the site
        const screen = priv ? await screenFor(cb.from, cb.data)
          : kind === 'cat' ? await shelfScreen(a, b) : await menuScreen();
        await show(cb.message.chat.id, screen, cb.message.message_id);
        return;
      }

      const msg = upd.message;
      const text = msg?.text?.trim();
      if (!text || !msg.chat?.id) return;
      const priv = msg.chat.type === 'private';
      const [word, payload = ''] = text.split(/\s+/);
      const cmd = word.startsWith('/') ? word.split('@')[0].toLowerCase() : null;
      const site = (env.frontendUrl || '').replace(/\/$/, '');

      if (priv && cmd === '/start' && payload.startsWith('link_')) {
        const r = await shop.connectAccount(msg.from, payload.slice(5));
        if (r.error) return show(msg.chat.id, { text: `⚠️ ${r.error}`, keyboard: [] });
        const menu = await menuScreen(await shop.accountRow(r.user));
        return show(msg.chat.id, { ...menu, text: `✅ Telegram connected to <b>${r.user.username}</b>. Your invoices and updates will come here.

${menu.text}` });
      }
      if (priv && cmd === '/start' && payload.startsWith('p_')) return show(msg.chat.id, await screenFor(msg.from, `p:${payload.slice(2)}:1`));

      if (cmd === '/start' || cmd === '/menu' || cmd === '/categories') {
        await show(msg.chat.id, priv ? await screenFor(msg.from, 'menu') : await menuScreen());
      } else if (cmd === '/deals' || cmd === '/firesale') {
        await show(msg.chat.id, priv ? await screenFor(msg.from, 'cat:fire-sale:1') : await shelfScreen('fire-sale', 1));
      } else if (priv && cmd === '/wallet') {
        await show(msg.chat.id, await screenFor(msg.from, 'w'));
      } else if (priv && cmd === '/orders') {
        await show(msg.chat.id, await screenFor(msg.from, 'o'));
      } else if (cmd === '/shop') {
        await show(msg.chat.id, { text: 'Captain Slabbin: tap below to open the shop.', keyboard: site ? [[{ text: '🛒 Open the shop', url: site }]] : [] });
      } else if (cmd === '/admin' && !priv) {
        await show(msg.chat.id, { text: 'Admin panel:', keyboard: site ? [[{ text: 'Open admin', url: `${site}/admin` }]] : [] });
      } else if (priv) {
        await show(msg.chat.id, await screenFor(msg.from, 'menu'));
      }
      // Ordinary chatter in the shop's group: stay quiet
    } catch (err) {
      console.error('[Webhook Telegram] reply failed:', err.message);
      // Never leave a customer tapping into silence
      const chatId = upd.callback_query?.message?.chat?.id || upd.message?.chat?.id;
      const priv = (upd.callback_query?.message?.chat || upd.message?.chat)?.type === 'private';
      if (chatId && priv) await tg(cfg.token, 'sendMessage', { chat_id: chatId, text: 'Something went wrong on our side. Please try again in a moment.', reply_markup: { inline_keyboard: [[{ text: '‹ Shop', callback_data: 'menu' }]] } }).catch(() => {});
    }
  },
};
