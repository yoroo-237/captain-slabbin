import { AsyncLocalStorage } from 'async_hooks';
import { prisma } from '../db.js';

// A bot's style: its Telegram profile, the copy of every screen, button labels,
// images and custom pages. Styles live in BotStyle.look and are edited in
// Admin → Telegram → Styles; whatever a style leaves out falls back to the shop's
// own look below, so an empty style is the Captain Slabbin bot.
//
// The bot answering an update is carried through the request (withBot), so
// screens read look() and activeBot() instead of passing them everywhere.

export const COMMANDS = [
  { command: 'start', description: 'Browse the shelves' },
  { command: 'deals', description: 'Fire Sale deals' },
  { command: 'wallet', description: 'Balance and add funds' },
  { command: 'orders', description: 'Your orders and tracking' },
  { command: 'shop', description: 'Open the website' },
];

export const DEFAULT_LOOK = {
  profile: {
    name: 'Captain Slabbin',
    shortDescription: '🏴‍☠️ Top shelf. Delivered. Browse, buy and pay with crypto right here. 21+',
    description: [
      '🏴‍☠️ CAPTAIN SLABBIN', 'Top shelf. Delivered.', '',
      '🛒 Browse the shelves and the Fire Sale', '💰 Pay from your crypto wallet in one tap', '📦 Track your orders, right here', '',
      'No name or email to type: your account is your Telegram. Adults 21+ only.', '',
      'Tap START to come aboard.',
    ].join('\n'),
    menuButton: 'Open shop',
    photo: null, // JPG url; null = the shop's own picture
    commands: COMMANDS,
  },
  // Telegram HTML (<b>, <i>, <u>, <s>, <code>, <blockquote>, <a href>)
  texts: {
    header: '🏴‍☠️ <b>CAPTAIN SLABBIN</b>\n<i>Top shelf. Delivered.</i>',
    welcome: [
      '🏴‍☠️ <b>WELCOME ABOARD</b>',
      '<i>Captain Slabbin · Top shelf. Delivered.</i>',
      '',
      'Browse the shelves, buy and pay right here. Your account is your Telegram: no name, email or password to type.',
      '',
      '🔞 Everything here is for adults <b>21 and over</b>.',
      '',
      'Already have an account on the site? Open <b>Account → Profile</b> there and tap <b>Connect Telegram</b>.',
    ].join('\n'),
    menuIntro: 'Pick a shelf. You pay from your wallet in one tap and the crew takes it from there.',
    menuIntroGuest: 'Pick a shelf. Products open on the site, where you pay with crypto in one tap.',
    restocking: 'The shelves are being restocked. Check back soon.',
    delivery: '🚚 <b>Delivery</b>: the crew messages you right here after payment to arrange it. For shipping to an address, order on the site.',
    paidNote: '🏴‍☠️ The crew has your invoice and will message you here to arrange delivery.',
    walletIntro: 'Add funds in the coin you like. Your balance updates by itself, and I message you here the moment it lands.',
    noOrders: 'No orders yet. Pick a shelf and buy in two taps.',
    // "commands" layout only; {menu} and {shelf} are filled in
    start: 'Hello and Welcome :)\n\nSelect {menu} to start your order.',
    shelfIntro: 'Enjoy the wide variety of {shelf}',
    customOrder: 'Send your custom order in one message: products, quantities and anything we should know. The crew answers you right here.',
    customOrderSent: '✅ Custom order received. The crew answers you right here.',
  },
  labels: {
    ageButton: '✅ I am 21 or older, let me in',
    fireSale: '🔥 FIRE SALE',
    wallet: '💰 Wallet',
    orders: '📦 My orders',
    account: '👤 My account on the site',
    openShop: '🌐 Open the shop',
    onSite: '🌐 On the site',
    buy: '🛒 BUY',
    keepShopping: '🛒 Keep shopping',
    allShelves: '‹ All shelves',
    rating: '☀️',
  },
  rule: '━━━━━━━━━━━━━━━━',
  upperTitles: true,
  // Image urls; null = the shop's own art (frontend/public/brand/bot)
  images: { banner: null, wallet: null, orders: null, start: null, menu: null, shelves: {} },
  // Custom screens: [{ key, html, image, buttons: [[{ text, action }]] }]
  // action: page:<key> | menu | deals | cat:<slug> | wallet | orders | site | url:<https://…>
  pages: [],
  home: '', // page /start opens ('' = the shelves menu)
  // buttons: the shelves as buttons, edited in place (the shop's own bot)
  // commands: a menu board navigated with typed commands (services/telegramCommands.js)
  layout: 'buttons',
  prefix: 'shop',                         // menu command, and the start of shelf commands
  customOrderCommand: 'create_custom_order',
};

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// Defaults under the style: objects merge key by key, anything else replaces
export function mergeLook(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = isObj(base[k]) && isObj(v) ? mergeLook(base[k], v) : v;
  }
  return out;
}

export const lookOf = style => mergeLook(DEFAULT_LOOK, style?.look);

const store = new AsyncLocalStorage();
export const look = () => store.getStore()?.look || DEFAULT_LOOK;
export const activeBot = () => store.getStore()?.bot || null;

// Runs fn as `bot` (a TelegramBot row, its style included or not)
export async function withBot(bot, fn) {
  const style = bot?.style !== undefined ? bot.style
    : bot?.styleId ? await prisma.botStyle.findUnique({ where: { id: bot.styleId } }) : null;
  return store.run({ bot, look: lookOf(style) }, fn);
}

export const title = s => look().upperTitles ? String(s).toUpperCase() : String(s);
