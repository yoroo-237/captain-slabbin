import { AsyncLocalStorage } from 'async_hooks';
import { prisma } from '../db.js';
import { env } from '../config/env.js';

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
    vendorLine: '',                         // under a product, e.g. "-- by QueenTetra"
    notInCart: '🛒 <b>This product is not in </b><b>/cart</b>',
    inCart: '🛒 <b>Product total in </b><b>/cart</b><b> — {total}</b>',
    notesPrompt: '✏ <b>SEND ME PRODUCT NOTES for {product}:</b>',
    cartTitle: '🛒 <b>YOUR CART</b>',
    cartEmpty: '🛒 <b>My Cart</b>\n\n <i>Your cart is empty.</i> /start shopping.',
    cartHint: '💡 To remove a product from cart or to change its quantity, press the blue link to the product under its name.',
    ordersTitle: '📆 <b>My Orders</b>',
    noOrdersYet: '<i>You have not made any orders yet.</i>\n<i>/start</i><i> shopping.</i>',
    unknownCommand: 'Sorry, I could not recognize this command.',
    noteNotInCart: 'You cannot edit order notes for this product because it is not added to the cart.',
    // The shop's Telegram username, written wherever a text or a product says {handle}
    // ('' = the bot's own username)
    handle: '',
    // Checkout of the "commands" layout, worded like the original; {pgp} = the key page's command
    shipTitle: '📦 <b>Shipping Details</b>',
    ship_name: '💬 Type in the recipient\'s First and Last Name only (example: John Smith) and hit "send." (Or enter the Business Name).',
    ship_street: '💬 Now send me the Street Address. For example: 2549 Main Street.',
    ship_apt: '💬 Send me Apartment number or PO Box (or n/a):',
    ship_city: '💬 Send me City:',
    ship_state: '💬 Send me State:',
    ship_zip: '💬 Send me Postcode:',
    shipCountry: 'United States',
    shipEditAsk: '💬 Tap what to change:',
    shipAddressPgp: '💡 <b>Important</b> You should encrypt your address with our PGP key {pgp}. Then only we will be able to read your address.\n\nYou can reuse your encrypted address for all your purchases.\n\nFind our PGP key here: {pgp}\n\nEncrypt your shipping details in the format customary to your country. For example:\n\n<code>Emily Watson\n3210 Greenbriar Lane\nUnit 14\nDenver, CO 80205\nUSA</code>\n\n❗️Do NOT encrypt anything but your shipping details.\n\n💬 Send me your encrypted shipping details:',
    pgpInvalid: 'This does not appear to be a valid PGP encrypted message. Please ensure that you have copied the entire message and that it is not too long. Also, make sure that you are only encrypting the shipping details and that no additional text has been included.',
    payTitle: '💳 <b>Payment Method</b>',
    payFromWallet: '💳 <b>Payment Method:</b>\nPaid from your wallet when you place the order.',
    walletShort: '⚠️ Add <b>{missing}</b> to your wallet to place this order.',
    refundAsk: '✏️ <b>SEND ME YOUR {coin} REFUND ADDRESS:</b>',
    coinAsk: '💬 Choose the currency of your refund address:',
    myCartTitle: '🛒 <b>My Cart</b>',
    vendor: '',                             // "(by …)" under each product of My Cart, and on its shipping line
    vouchersTitle: '🛒 <b>Applied Vouchers</b>',
    noVouchers: 'No vouchers applied to your cart yet.',
    voucherAsk: '💬 Enter voucher code:',
    orderNotesAsk: '✏ <b>SEND ME ORDER NOTES:</b>',
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
    back: '⇇ Back',
    previous: '< Previous',
    next: 'Next >',
    removeFromCart: 'Remove Product from Cart',
    addNotes: 'Add Product Notes',
    reviews: '{n} reviews',
    cancel: '< Cancel',
    restart: 'Restart',
    encrypt: 'Encrypt my shipping details',
    ship_name: 'Name',
    ship_street: 'Street Address',
    ship_apt: 'Ap.No. / Po box',
    ship_city: 'City',
    ship_state: 'State',
    ship_zip: 'Postcode',
    toCart: '< Cart',
    enterShipping: 'Enter Shipping Details >',
    placeOrder: '✅ Place Order >',
    addFunds: '💰 Add Funds',
    refundOptional: 'Refund Address (optional)',
    addOrderNotes: 'Add Order Notes',
    editPayment: 'Edit Payment Method',
    emptyCart: 'Empty Cart',
    editShipping: 'Edit Shipping Details',
    applyVouchers: 'Apply Vouchers',
    removeVoucher: 'Remove voucher',
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
  // Which catalog the bot sells: null = the shop's own, or a Category/Product `source` (e.g. 'qt')
  catalog: null,
  // false: no link to the shop's website anywhere in the bot (buttons, menu button, wording)
  siteLinks: true,
  layout: 'buttons',
  prefix: 'shop',                         // menu command, and the start of shelf commands
  customOrderCommand: 'create_custom_order',
  listPrices: true,      // commands layout: a price line under each product of a shelf
  shelfNeighbors: false, // commands layout: buttons to the shelves on either side
  listImages: true,      // commands layout: a picture above a shelf's list (the original menu-board bots show none)
  minimums: null,        // commands layout: minimum cart { first, next } in dollars
  shippingFee: null,     // commands layout: flat shipping in dollars (null = the shop's shipping settings)
  pgpPage: '',           // commands layout: page holding the PGP public key that addresses are encrypted to
  pgpAddress: 'optional', // with a key: 'optional' (plain text accepted too) or 'required'
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

// The shop's own style speaks as the shop (Captain Slabbin). Every other style
// starts from brand-free wording, so a field it leaves empty never makes the bot
// speak as another brand.
export const isShopStyle = style => !style || style.name === 'Captain Slabbin';

export function neutralLook(name) {
  const l = structuredClone(DEFAULT_LOOK);
  const safe = String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  l.siteLinks = false;
  l.profile = { ...l.profile, name, shortDescription: '', description: '', commands: l.profile.commands.filter(c => c.command !== 'shop') };
  l.texts = {
    ...l.texts,
    header: `<b>${safe}</b>`,
    welcome: 'Welcome :)\n\n🔞 Everything here is for adults <b>21 and over</b>.',
    menuIntro: 'Pick a shelf. You pay from your wallet in one tap.',
    menuIntroGuest: 'Pick a shelf.',
    delivery: '🚚 <b>Delivery</b>: we message you right here after payment to arrange it.',
    paidNote: 'We have your invoice and will message you here to arrange delivery.',
    walletIntro: 'Add funds in the coin you like. Your balance updates by itself and you are told here the moment it lands.',
    customOrder: 'Send your custom order in one message: products, quantities and anything we should know. We answer you right here.',
    customOrderSent: '✅ Custom order received. We answer you right here.',
  };
  return l;
}

export const lookOf = style => isShopStyle(style) ? mergeLook(DEFAULT_LOOK, style?.look) : mergeLook(neutralLook(style.name), style.look);

const store = new AsyncLocalStorage();
export const look = () => store.getStore()?.look || DEFAULT_LOOK;
export const activeBot = () => store.getStore()?.bot || null;
export const catalog = () => look().catalog || null;
// The bots platform has no storefront: its bots never link to a website
export const siteLinks = () => env.platform !== 'bots' && look().siteLinks !== false;
// false for any style but the shop's own: it never borrows the shop's pictures
export const isShop = () => store.getStore()?.shop ?? true;

// The PGP key page as the bot shows it: the bot's own key when it has one (on the
// style's key page, added when the style has none); a key page with no key at all
// is left out, so customers never see the "paste your key here" placeholder
const hasPublicKey = html => /BEGIN PGP PUBLIC KEY BLOCK/.test(html || '');
const htmlSafe = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function withBotKey(l, bot) {
  const key = String(bot?.pgpKey || '').trim();
  const pages = l.pages || [];
  if (key) {
    const pageKey = l.pgpPage || 'pgp';
    const page = pages.find(p => p.key === pageKey);
    const title = page?.title || 'Our PGP key';
    const keyed = { buttons: [[{ text: '⇆ Back', action: 'menu' }]], ...page, key: pageKey, title, html: `<b>${htmlSafe(title)}</b>\n\n<pre>${htmlSafe(key)}</pre>` };
    return { ...l, pgpPage: pageKey, pages: page ? pages.map(p => p === page ? keyed : p) : [...pages, keyed] };
  }
  const page = l.pgpPage && pages.find(p => p.key === l.pgpPage);
  return page && !hasPublicKey(page.html) ? { ...l, pages: pages.filter(p => p !== page) } : l;
}

// Runs fn as `bot` (a TelegramBot row, its style included or not)
export async function withBot(bot, fn) {
  const style = bot?.style !== undefined ? bot.style
    : bot?.styleId ? await prisma.botStyle.findUnique({ where: { id: bot.styleId } }) : null;
  return store.run({ bot, look: withBotKey(lookOf(style), bot), shop: isShopStyle(style) }, fn);
}

export const title = s => look().upperTitles ? String(s).toUpperCase() : String(s);
