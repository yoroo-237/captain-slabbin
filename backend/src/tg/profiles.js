// The capture engine serves two bots only, each with its own rules, and nothing else:
//   · @QTMARKETBOT          (the QT Market bot)
//   · Captain Slabbin's bot (its username is CAPTAIN_BOT_USERNAME)
// The two profiles are independent: nothing is inherited from one to the other and
// there is no fallback. A bot that matches neither is refused; a rule is changed in
// one profile without touching the other.
import { normalizeBot } from './client.js';

// A literal on purpose: no shared helper builds both profiles
const QT_MARKET = {
  id: 'qtmarket',
  label: 'QT Market',
  bot: () => 'QTMARKETBOT',
  // Only what destroys or empties something; --strict narrows to the wide list
  skip: 'delete|remove|clear|empty|withdraw|supprimer|retirer|vider|effacer',
  skipStrict: 'buy|pay|checkout|order|confirm|cart|purchase|delete|remove|cancel|withdraw|deposit|acheter|payer|commander|panier|supprimer|annuler',
  // QT Market has no +/- : a product page carries its quantity tiers as buttons
  // ("1x—$10.50", "25x—$250.00", "1/2LB—$…", "(5x Total)—$…"), and pressing one puts the
  // product in the cart. That page is the quantity screen: it is captured, and the walk
  // goes on around it (Back, Previous/Next, reviews, the vendor's /v_… page) but never
  // presses a tier.
  quantity: { tier: /—\s*\$\s*\d/, plus: null, minus: null, word: null, follow: true },
  // Buttons the walk never presses: the quantity tiers and what comes after them (cart
  // lines, notes, shipping, vouchers). Changes and added steps are made by hand, in the check.
  manual: /—\s*\$\s*\d|^\W*remove product from cart|^\W*add product notes|^\W*enter shipping details|^\W*apply vouchers?/i,
  // What is typed when the bot asks a question
  asks: [[/quantit|how many|amount of|combien/i, '1'], [/post ?code|zip/i, '10001'], [/\bcity\b|ville/i, 'New York'], [/\bstate\b|r[ée]gion/i, 'NY'],
    [/address|street|adresse|\brue\b/i, '1 Test Street'], [/\bname\b|\bnom\b/i, 'Test'], [/e-?mail/i, 'test@example.com'],
    [/phone|t[ée]l[ée]phone/i, '+10000000000'], [/voucher|coupon|promo/i, 'TEST']],
};

const CAPTAIN = {
  id: 'captain',
  label: 'Captain Slabbin',
  bot: () => normalizeBot(process.env.CAPTAIN_BOT_USERNAME || ''),
  skip: 'delete|remove|clear|empty|withdraw|supprimer|retirer|vider|effacer',
  skipStrict: 'buy|pay|checkout|order|confirm|cart|purchase|delete|remove|cancel|withdraw|deposit|acheter|payer|commander|panier|supprimer|annuler',
  quantity: { tier: null, follow: false, plus: /^\W*(➕|\+|＋|plus)\W*$/i, minus: /^\W*(➖|-|−|–|minus)\W*$/i, word: /quantit|\bqty\b|\bpcs\b|how many|combien/i },
  manual: null,
  asks: [[/quantit|how many|amount of|combien/i, '1'], [/post ?code|zip/i, '10001'], [/\bcity\b|ville/i, 'New York'], [/\bstate\b|r[ée]gion/i, 'NY'],
    [/address|street|adresse|\brue\b/i, '1 Test Street'], [/\bname\b|\bnom\b/i, 'Test'], [/e-?mail/i, 'test@example.com'],
    [/phone|t[ée]l[ée]phone/i, '+10000000000'], [/voucher|coupon|promo/i, 'TEST']],
};

export const PROFILES = [QT_MARKET, CAPTAIN];

// The profile of a bot, or an error: never a default one
export function profileOf(name) {
  const bot = normalizeBot(name).toLowerCase();
  const p = bot && PROFILES.find(x => x.bot().toLowerCase() === bot);
  if (p) return p;
  const known = PROFILES.map(x => x.bot()).filter(Boolean).map(b => `@${b}`).join(', ');
  const missing = PROFILES.some(x => !x.bot()) ? ' (CAPTAIN_BOT_USERNAME is not set)' : '';
  throw Object.assign(new Error(`@${bot || name} cannot be captured: this engine only serves ${known}${missing}.`), { status: 400 });
}
export const isCapturable = name => { try { profileOf(name); return true; } catch { return false; } };
