import { withTenant } from '../tenant.js';
import crypto from 'crypto';
import { prisma } from '../db.js';
import { walletService } from '../services/wallet.service.js';
import { cryptoService } from '../services/crypto.service.js';
import { ok } from '../utils/response.js';
import { env } from '../config/env.js';
import { findBot, primaryBot, rememberChat, tg, notifyNewMessage, replyFromStaffChat, claimInbox } from '../services/telegram.service.js';
import { menuScreen, shelfScreen, pageScreen, homeScreen, inlineResults } from '../services/telegramCatalog.js';
import { withBot, look, siteLinks } from '../services/telegramStyle.js';
import * as shop from '../services/telegramShop.js';
import * as board from '../services/telegramCommands.js';
import { resolveCommand, customOrderScreen, takeWaiting, clearWaiting, unknownCommandScreen } from '../services/telegramCommands.js';

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

    // A bot order's payments add up: the address's total received is the amount, whatever
    // the transaction this call reports (so a repeated call never counts twice)
    if (deposit.orderId) {
      const seen = await cryptoService.checkDepositOnChain(deposit);
      if (!seen.confirmed) return res.json(ok('Awaiting confirmation'));
      await walletService.confirmDeposit(deposit.id, seen.cryptoAmount, null, { cumulative: true });
      return res.json(ok('Order payment received'));
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

      await walletService.confirmDeposit(deposit.id, ethAmount, null, { txHash: transfer.hash || null });
      console.log(`[Webhook Alchemy] Deposit #${deposit.id} confirmed: ${ethAmount} ETH`);
    }

    res.json(ok('Processed'));
  },

  // Telegram webhook, one address per linked bot (/telegram-bot/:id; the bare
  // /telegram-bot is the primary bot, linked before there could be several).
  // Every call is checked against the secret handed to Telegram at linking.
  // Each bot answers in its own style: chats bookkeeping, the catalog, custom
  // pages, and buying with the wallet in a private chat (services/telegramShop.js)
  async telegramBot(req, res) {
    const bot = req.params.id ? await findBot(req.params.id) : await primaryBot();
    if (!bot) return res.json(ok('no bot'));
    if (bot.secret && req.headers['x-telegram-bot-api-secret-token'] !== bot.secret) return res.status(401).end();
    res.json(ok('received')); // answer Telegram at once; the reply goes out below
    // As the bot's owner (bots platform): its customers, catalog and settings only
    await withTenant(bot.tenantId, () => withBot(bot, () => answerTelegram(bot, req.body || {})));
  },
};

// Screens a commands-layout bot shows without an account
const BROWSE = new Set(['home', 'menu', 'cat', 'p', 'pg', 'rv']);

// One update, answered as `bot` (inside withBot, so screens use its style)
async function answerTelegram(bot, upd) {
  // Remember where the bot is (not where it was just removed from)
  const member = upd.my_chat_member;
  const chat = upd.message?.chat || upd.channel_post?.chat
    || (member && ['member', 'administrator'].includes(member.new_chat_member?.status) ? member.chat : null);
  if (chat) await rememberChat(bot, chat).catch(err => console.error('[Webhook Telegram] remember chat:', err.message));

  // A screen with a reply keyboard (or a forced reply) is always a new message:
  // Telegram cannot put one on an edited message
  const show = (chatId, screen, messageId) => screen && tg(bot.token, messageId && !screen.reply ? 'editMessageText' : 'sendMessage', {
    chat_id: chatId,
    ...(messageId && !screen.reply ? { message_id: messageId } : {}),
    text: screen.text,
    parse_mode: 'HTML',
    link_preview_options: screen.image ? { url: screen.image, prefer_large_media: true, show_above_text: true } : { is_disabled: true },
    reply_markup: screen.reply || { inline_keyboard: (screen.keyboard || []).filter(r => r.length) },
  }).catch(err => { if (!/not modified/i.test(err.message)) throw err; });

  // Screens for a private chat; anything that needs an account asks for 21+ first
  const screenFor = async (from, data) => {
    const [kind, a, b, c] = String(data || '').split(':');
    if (kind === 'age') {
      const user = await shop.openAccount(from);
      const menu = await menuScreen(await shop.accountRow(user));
      return { ...menu, text: `✅ Your account <b>${user.username}</b> is ready.

${menu.text}` };
    }
    const user = await shop.findCustomer(from);
    // A commands-layout bot can be browsed without an account, like the bots it copies;
    // the cart, the wallet and orders ask for 21+ first
    const commands = look().layout === 'commands';
    if (!user && !(commands && BROWSE.has(kind))) return shop.ageScreen();
    if (user && !user.isActive) return { text: 'This account is disabled. Message the shop for help.', keyboard: [] };
    // Their messages now come from the bot they are using
    if (user && user.telegramBotId !== bot.id) await prisma.user.update({ where: { id: user.id }, data: { telegramBotId: bot.id } }).catch(() => {});
    const account = user && !commands ? await shop.accountRow(user) : null;
    switch (kind) {
      case 'home': return homeScreen(account);
      case 'pg':   return pageScreen(a) || menuScreen(account);
      case 'cat':  return shelfScreen(a, b, { inBot: true, account });
      case 'p':    return commands ? board.productBoard(user, a) : shop.productScreen(a, b, c);
      case 'rv':   return board.reviewsBoard(a, b);
      case 'add':  return board.addToCart(user, a, b);
      case 'rm':   return board.removeFromCart(user, a);
      case 'note': return board.noteScreen(from, user, a);
      case 'cart': return board.cartBoard(user, from);
      case 'cclr': return board.clearCart(user);
      case 'cpay': return board.cartPay(user, from);
      // Checkout: a shipping field, restart, PGP, edit, payment method, vouchers, notes
      case 'ckship': return board.shipScreen(from, user);
      case 'ckf':   return board.shipScreen(from, user, a);
      case 'ckrs':  return board.restartShipping(from, user);
      case 'ckpgp': return board.pgpScreen(from, user);
      case 'ckedit': return board.shipEditScreen(user);
      case 'ckpm':  return board.coinScreen();
      case 'ckcur': return board.pickCoin(from, user, a);
      case 'ck':    return board.voucherScreen(from, user);
      case 'ckvrm': return board.removeVoucher(from, user);
      case 'ckon':  return board.orderNotesScreen(from);
      case 'buy':  return shop.buyScreen(user, a, b, c);
      case 'pay':  return shop.payScreen(user, a, b, c);
      case 'w':    return shop.walletScreen(user);
      case 'dep':  return shop.depositScreen(user, a);
      case 'o':    return commands ? board.ordersBoard(user) : shop.ordersScreen(user);
      case 'ord':  return board.orderScreen(user, a);
      case 'co':   return customOrderScreen(from);
      default:     return menuScreen(account);
    }
  };

  // A staff member linking their own Telegram as this bot's staff chat
  const startText = upd.message?.text?.trim() || ''
  if (upd.message?.chat?.type === 'private' && /^\/start(@\w+)?\s+inbox_/.test(startText)) {
    const r = await claimInbox(bot, upd.message.chat, startText.split(/\s+/)[1].slice(6));
    await tg(bot.token, 'sendMessage', { chat_id: upd.message.chat.id, parse_mode: 'HTML', text: r.error ? `⚠️ ${r.error}`
      : `✅ This chat now receives the orders and customer messages of @${bot.username}.\n\nTo answer a customer, <b>reply</b> to their notification: your answer goes to their own Telegram.` }).catch(() => {});
    return;
  }
  // The staff answering a customer: a reply to a notification in this bot's staff chat
  if (upd.message && String(upd.message.chat?.id) === String(bot.chatId)) {
    try { if (await replyFromStaffChat(bot, upd.message)) return; } catch (err) { console.error('[Webhook Telegram] staff reply:', err.message); }
    // In the staff's private chat, plain text is not a customer message
    if (upd.message.chat.type === 'private' && upd.message.text && !upd.message.text.startsWith('/')) {
      await tg(bot.token, 'sendMessage', { chat_id: upd.message.chat.id, text: 'To answer a customer, reply to their notification (swipe it, or long-press then Reply).' }).catch(() => {});
      return;
    }
  }

  // A customer writing to the shop in the bot (plain text, no command): kept in
  // the admin's Messages and posted to the staff group, where they can be answered
  // (a shop bot asks for 21+ first: only a customer with an account can write;
  // a replica has no such gate and opens the account)
  const toShop = async (m, { open = false } = {}) => {
    const user = (await shop.findCustomer(m.from)) || (open ? await shop.openAccount(m.from).catch(() => null) : null);
    if (!user) return false;
    const body = String(m.text).slice(0, 2000);
    await prisma.message.create({ data: { userId: user.id, senderId: user.id, isStaff: false, body } });
    if (user.telegramBotId !== bot.id) await prisma.user.update({ where: { id: user.id }, data: { telegramBotId: bot.id } }).catch(() => {});
    notifyNewMessage(user, body).catch(() => {});
    await tg(bot.token, 'sendMessage', { chat_id: m.chat.id, reply_to_message_id: m.message_id, text: '✅ Sent to the shop. We answer you right here.' }).catch(() => {});
    return true;
  };

  // A replica of the user's own bot: its captured pages for navigation and the real
  // shop engine for commerce, on the replica's own catalog (look.catalog). Browsing
  // (home, pages, shelves, products) needs no account like the original; the cart,
  // checkout, wallet and orders open one, then run the live cart and a real order.
  if (look().replica) {
    // Inline search (@bot words…): the replica's pages that match
    if (upd.inline_query) {
      await tg(bot.token, 'answerInlineQuery', { inline_query_id: upd.inline_query.id, results: inlineResults(upd.inline_query.query), cache_time: 60 }).catch(() => {});
      return;
    }
    const cbq = upd.callback_query;
    const m = upd.message;
    const chatId = cbq?.message?.chat?.id || m?.chat?.id;
    if (!chatId) return;
    const priv = (cbq?.message || m)?.chat?.type === 'private';
    const home = () => homeScreen(null);
    // Run one screen: a commerce action (not browsing) opens an account first, like
    // the originals; captured pages and browsing need none. Falls back to home.
    const dispatch = async (from, data, messageId) => {
      const kind = String(data || '').split(':')[0];
      if (priv && !BROWSE.has(kind) && kind !== 'co' && kind !== 'age') await shop.openAccount(from).catch(() => null);
      return show(chatId, (await screenFor(from, data)) || home(), messageId);
    };
    if (cbq) {
      const toast = /^(pay:|cpay)/.test(cbq.data) ? 'Paying…' : /^add:/.test(cbq.data) ? 'Added to cart' : null;
      await tg(bot.token, 'answerCallbackQuery', { callback_query_id: cbq.id, ...(toast ? { text: toast } : {}) }).catch(() => {});
      if (!cbq.message) return;
      clearWaiting(cbq.from);
      return dispatch(cbq.from, cbq.data, cbq.message.message_id);
    }
    // What the customer shared with a reply-keyboard button: kept for the shop
    const shared = m && (m.contact ? `📱 Contact shared: ${[m.contact.first_name, m.contact.last_name].filter(Boolean).join(' ')} ${m.contact.phone_number || ''}`.trim()
      : m.location ? `📍 Location shared: https://maps.google.com/?q=${m.location.latitude},${m.location.longitude}`
      : m.users_shared ? `👤 Users shared: ${(m.users_shared.users || []).map(u => u.username ? '@' + u.username : [u.first_name, u.last_name].filter(Boolean).join(' ') || u.user_id).join(', ')}`
      : m.chat_shared ? `👥 Chat shared: ${m.chat_shared.title || m.chat_shared.username || m.chat_shared.chat_id}`
      : m.poll ? `📊 Poll: ${m.poll.question} (${(m.poll.options || []).map(o => o.text).join(' / ')})` : null);
    if (shared && priv) {
      await toShop({ ...m, text: shared }, { open: true });
      return show(chatId, home());
    }
    const text = m?.text?.trim();
    if (!text) return;
    const word = text.split(/\s+/)[0];
    const cmd = word.startsWith('/') ? word.split('@')[0].toLowerCase() : null;
    // A typed answer the checkout asked for (shipping field, voucher, notes, product note)
    const asked = priv && !cmd ? takeWaiting(m.from) : null;
    if (asked) {
      const user = await shop.findCustomer(m.from);
      if (user) {
        if (asked.kind === 'note') return show(chatId, await board.saveNote(user, asked.productId, text));
        if (asked.kind === 'custom') {
          await prisma.message.create({ data: { userId: user.id, senderId: user.id, isStaff: false, body: `Custom order:\n${text.slice(0, 2000)}` } });
          notifyNewMessage(user, `Custom order: ${text.slice(0, 2000)}`).catch(() => {});
          return show(chatId, { text: look().texts.customOrderSent, keyboard: [[{ text: look().labels.back, callback_data: 'menu' }]] });
        }
        const screen = await board.checkoutAnswer(m.from, user, asked, text);
        if (screen) return show(chatId, screen);
      }
    }
    if (cmd === '/start') return dispatch(m.from, 'home');
    // The style's own commands (pages, shelves, /p<id>) and the shop commands
    const typed = cmd && cmd !== '/start' ? await resolveCommand(cmd) : null;
    if (typed) return dispatch(m.from, typed);
    // A reply-keyboard button, or text the original answered: its page
    const trigger = !cmd ? (look().pages || []).find(p => (p.triggers || []).includes(text)) : null;
    if (trigger) return dispatch(m.from, `pg:${trigger.key}`);
    // /wallet, /orders and /cart are already resolved by resolveCommand above
    if (cmd === '/menu' || cmd === '/categories') return dispatch(m.from, 'menu');
    if (cmd === '/deals' || cmd === '/firesale') return dispatch(m.from, 'cat:fire-sale:1');
    // Text that opens no screen is a message to the shop
    if (!cmd && priv && await toShop(m, { open: true })) return;
    return show(chatId, home());
  }

  try {
    const cb = upd.callback_query;
    if (cb) {
      const priv = cb.message?.chat?.type === 'private';
      // A tap on Pay shows "Paying…" at once, a pack "Added to cart"; the screen follows
      const toast = /^(pay:|cpay)/.test(cb.data) ? 'Paying…' : /^add:/.test(cb.data) ? 'Added to cart' : null;
      await tg(bot.token, 'answerCallbackQuery', { callback_query_id: cb.id, ...(toast ? { text: toast } : {}) }).catch(() => {});
      if (!cb.message) return;
      clearWaiting(cb.from);
      const [kind, a, b] = String(cb.data || '').split(':');
      // In a group the catalog is read-only and products open on the site
      const screen = priv ? await screenFor(cb.from, cb.data)
        : kind === 'cat' ? await shelfScreen(a, b) : kind === 'pg' ? pageScreen(a) || await menuScreen() : await menuScreen();
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

    // A typed answer the bot asked for: product notes, or a custom order for the inbox
    const asked = priv && !cmd ? takeWaiting(msg.from) : null;
    if (asked?.kind === 'note') {
      const user = await shop.findCustomer(msg.from);
      if (user) return show(msg.chat.id, await board.saveNote(user, asked.productId, text));
    }
    // Checkout answers: a shipping field, the PGP address, the refund address, a voucher, order notes
    if (asked && asked.kind !== 'note' && asked.kind !== 'custom') {
      const user = await shop.findCustomer(msg.from);
      const screen = user && await board.checkoutAnswer(msg.from, user, asked, text);
      if (screen) return show(msg.chat.id, screen);
    }
    if (asked?.kind === 'custom') {
      const user = await shop.findCustomer(msg.from);
      if (user) {
        const body = text.slice(0, 2000);
        await prisma.message.create({ data: { userId: user.id, senderId: user.id, isStaff: false, body: `Custom order:
${body}` } });
        notifyNewMessage(user, `Custom order: ${body}`).catch(() => {});
        return show(msg.chat.id, { text: look().texts.customOrderSent, keyboard: [[{ text: look().labels.back, callback_data: 'menu' }]] });
      }
    }
    // The style's own commands: menu, shelves, /p<id>, pages, custom order
    const typed = cmd && cmd !== '/start' ? await resolveCommand(cmd) : null;
    // A replica's reply-keyboard button, or text the original answered: its page
    const trigger = priv && !cmd ? (look().pages || []).find(p => (p.triggers || []).includes(text)) : null;

    if (cmd === '/start') {
      await show(msg.chat.id, priv ? await screenFor(msg.from, 'home') : await homeScreen());
    } else if (typed) {
      const [kind, a, b] = typed.split(':');
      await show(msg.chat.id, priv ? await screenFor(msg.from, typed)
        : kind === 'cat' ? await shelfScreen(a, b) : kind === 'pg' ? pageScreen(a) || await menuScreen() : await menuScreen());
    } else if (trigger) {
      await show(msg.chat.id, await screenFor(msg.from, `pg:${trigger.key}`));
    } else if (cmd === '/menu' || cmd === '/categories') {
      await show(msg.chat.id, priv ? await screenFor(msg.from, 'menu') : await menuScreen());
    } else if (cmd === '/deals' || cmd === '/firesale') {
      await show(msg.chat.id, priv ? await screenFor(msg.from, 'cat:fire-sale:1') : await shelfScreen('fire-sale', 1));
    } else if (priv && cmd === '/wallet') {
      await show(msg.chat.id, await screenFor(msg.from, 'w'));
    } else if (priv && cmd === '/orders') {
      await show(msg.chat.id, await screenFor(msg.from, 'o'));
    } else if (cmd === '/shop' && siteLinks()) {
      await show(msg.chat.id, { text: `${look().profile.name}: tap below to open the shop.`, keyboard: site ? [[{ text: look().labels.openShop, url: site }]] : [] });
    } else if (cmd === '/admin' && !priv) {
      await show(msg.chat.id, { text: 'Admin panel:', keyboard: site ? [[{ text: 'Open admin', url: `${site}/admin` }]] : [] });
    } else if (priv && cmd && look().layout === 'commands') {
      // A command the bot doesn't know: the original's error, nothing else
      await show(msg.chat.id, unknownCommandScreen());
    } else if (priv && !cmd && await toShop(msg)) {
      // A plain message: sent to the shop (Messages and the staff group)
    } else if (priv) {
      await show(msg.chat.id, await screenFor(msg.from, 'menu'));
    }
    // Ordinary chatter in the shop's group: stay quiet
  } catch (err) {
    console.error('[Webhook Telegram] reply failed:', err.message);
    // Never leave a customer tapping into silence
    const chatId = upd.callback_query?.message?.chat?.id || upd.message?.chat?.id;
    const priv = (upd.callback_query?.message?.chat || upd.message?.chat)?.type === 'private';
    if (chatId && priv) await tg(bot.token, 'sendMessage', { chat_id: chatId, text: 'Something went wrong on our side. Please try again in a moment.', reply_markup: { inline_keyboard: [[{ text: '‹ Shop', callback_data: 'menu' }]] } }).catch(() => {});
  }
}
