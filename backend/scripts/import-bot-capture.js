// Turns a capture of a bot (data.json + media/) into a style made of pages.
//
//   node scripts/import-bot-capture.js <capture folder> [--name "Réplique @bot"] [--apply-to <bot id>] [--dry]
//   node scripts/import-bot-capture.js <capture folder> --merge-into "QT Market" [--pages a,b,c] [--apply-to <bot id>] [--dry]
//
// The first form is a replica of the captured bot: its screens as pages, browsed
// without an account like the original, its command menu, its /start screen as
// home. Never its identity: the bot it is applied to (--apply-to) keeps its own
// name, descriptions and photo, and anti-phishing screens are left out.
// The second form keeps the shop's catalog and payments: it only copies the
// information pages (--pages, command names) and the welcome/menu pictures into an existing style, whose shelves,
// products and checkout stay the shop's own.

// Each captured screen becomes a page of the style: its text, its image and its
// buttons. A screen opened by a typed command is keyed by that command, so the
// command works as typed in the bot (/v_shop_flower, /p0_14Dhh…); the screen
// opened by /start becomes the style's home page. Buttons that go back lead to
// the menu page, buttons that open another captured screen link to it, anything
// else (pagination that edits in place, payments) is dropped and counted.
// Re-running with the same name replaces that style's pages.
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../src/db.js';
import { cmdName } from '../src/services/telegramCommands.js';
import { captureMedia } from './capture-media.js';
import { applyStyle } from '../src/services/telegram.service.js';
import { currentTenant } from '../src/tenant.js';

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const dry = args.includes('--dry');
const opt = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const mergeInto = opt('--merge-into');
const applyTo = Number(opt('--apply-to')) || null;
if (!dir) { console.error('Usage: node scripts/import-bot-capture.js <capture folder> [--name "Style name"] [--apply-to <bot id>] [--dry]'); process.exit(1); }

const { bot, screens: captured, profile = {} } = JSON.parse(await fs.readFile(path.join(dir, 'data.json'), 'utf8'));
// Anti-phishing screens ("your secret phrase…") hold the capturing account's own
// secret: never copied, every customer of the replica would see it
const PERSONAL = /secret phrase|phrase secr[eè]te|scam ?bot|phishing/i;
const screens = captured.filter(s => !PERSONAL.test(s.raw || s.html || ''));
const personal = captured.length - screens.length;
const name = (opt('--name') || `Réplique @${bot}`).slice(0, 60);
const byKey = new Map(screens.map(s => [s.key, s]));
const isBack = b => /⇇|⇆|^\W*back\b/i.test(b.text) || /^\/back_/.test(b.data || '');
const commandOf = s => (s.sources || []).find(x => x.startsWith('/'));

// Page keys: the command that opens the screen, else s_<screen key>; unique, 32 chars max
const keyOf = new Map();
const used = new Set();
for (const s of [...screens].sort((a, b) => a.order - b.order)) {
  const cmd = commandOf(s);
  let key = cmd ? cmdName(cmd) : `s_${s.key.slice(0, 10)}`;
  if (!key) key = `s_${s.key.slice(0, 10)}`;
  for (let i = 2; used.has(key); i++) key = `${key.slice(0, 29)}_${i}`;
  used.add(key);
  keyOf.set(s.key, key);
}
// /start can send several messages: home is the one that carries the menu (most buttons)
const startScreen = screens.filter(s => (s.sources || []).includes('/start'))
  .sort((a, b) => (b.buttons || []).flat().length - (a.buttons || []).flat().length || a.order - b.order)[0];
// The menu: what /menu opens, else the first screen of a short /v_… command (QT-like
// bots), else the /start screen
const menuScreen = screens.find(s => (s.sources || []).includes('/menu'))
  || screens.find(s => (s.sources || []).some(x => /^\/v_[a-z0-9]+$/i.test(x)))
  || startScreen;
const menuKey = menuScreen && keyOf.get(menuScreen.key);
// --merge-into copies these information pages (default: QT Market's)
const only = new Set((opt('--pages') || 'about_qtetra,v_qtetra_refunds,v_qtetra_shipping,pgp_qtetra').split(',').map(cmdName));
// Text a customer types (a reply-keyboard button) that opens a screen
const typedOf = s => (s.sources || []).filter(x => !x.startsWith('/') && !x.startsWith('['));

// Telethon's HTML → what the Bot API accepts: no custom emoji links, real newlines
const clean = html => String(html || '')
  .replace(/<a href="tg:\/\/emoji\?id=\d+">(.*?)<\/a>/gs, '$1')
  .replace(/<br\s*\/?>/gi, '\n')
  .slice(0, 4000);

// The screen a button opens: the nearest later screen that was reached by clicking
// a button with that label ([label]), or by sending its text (reply keyboard)
function targetOf(screen, button) {
  const label = button.kind === 'keyboard' ? button.text : `[${button.text}]`;
  const later = screens.filter(s => s.order > screen.order && (s.sources || []).includes(label));
  return later.sort((a, b) => a.order - b.order)[0] || null;
}

// Images, uploaded once each (across imports too: see capture-media.js), and only
// those of the pages kept
const media = await captureMedia(dir, 'captain-slabbin/bots', { dry });
const imageUrl = async file => (await media.url(file)) || '';
// Another shop's PGP key is never copied: customers would encrypt their address for them
const PGP_KEY = /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?(-----END PGP PUBLIC KEY BLOCK-----|$)/g;
const hasKey = html => /BEGIN PGP PUBLIC KEY BLOCK/.test(html || '');
const keyBody = k => k.replace(/<[^>]+>|-----[^-]+-----|\s+/g, '');
const capturedKeys = new Set();
const blank = html => !String(html || '').replace(/<[^>]+>|[{}\s]/g, '');
// A key that is the captured bot's own (also when an earlier import copied it in)
const othersKey = html => (String(html || '').match(PGP_KEY) || []).some(k => capturedKeys.has(keyBody(k)));
const NO_KEY = '<b>Our PGP key</b>\n\nSet the PGP public key on each bot (Admin, Telegram bot, Bots) or paste it here. Until then this page is hidden and customers send their address in plain text.';

const stats = { pages: 0, images: 0, back: 0, linked: 0, dropped: 0 };
const pages = [];
for (const s of [...screens].sort((a, b) => a.order - b.order)) {
  const rows = [];
  for (const row of s.buttons || []) {
    const out = [];
    for (const b of row) {
      // A link stays a link
      if (b.kind === 'url' && /^https?:\/\//.test(b.url || '')) { out.push({ text: b.text, action: `url:${b.url}` }); stats.linked++; continue; }
      if (b.kind !== 'callback' && b.kind !== 'keyboard') { stats.dropped++; continue; }
      if (isBack(b)) { if (mergeInto) { out.push({ text: b.text, action: 'menu' }); stats.back++; } else if (menuKey) { out.push({ text: b.text, action: `page:${menuKey}` }); stats.back++; } else stats.dropped++; continue; }
      const target = targetOf(s, b);
      if (target && keyOf.get(target.key) !== keyOf.get(s.key) && (!mergeInto || only.has(keyOf.get(target.key)))) { out.push({ text: b.text, action: `page:${keyOf.get(target.key)}` }); stats.linked++; }
      else stats.dropped++;
    }
    if (out.length) rows.push(out);
  }
  if (s.media) stats.images++;
  let html = clean(s.html || s.raw);
  if (hasKey(html)) {
    for (const k of html.match(PGP_KEY)) capturedKeys.add(keyBody(k));
    const rest = html.replace(PGP_KEY, '');
    // Only the frame of the key left (<pre><code>, a stray "{}"): the page is the placeholder
    html = blank(rest) ? NO_KEY : rest.trim();
    stats.keys = (stats.keys || 0) + 1;
  }
  const triggers = typedOf(s);
  pages.push({ key: keyOf.get(s.key), html, media: s.media, buttons: rows, ...(triggers.length ? { triggers } : {}) });
  stats.pages++;
}
// The image of each page kept: all of them for a new style, the chosen ones when merging
async function withImages(list) {
  const out = [];
  for (const { media: file, ...pg } of list) out.push({ ...pg, image: await imageUrl(file) }); // one at a time: uploads.json is written after each
  return out;
}

console.log(`@${bot}: ${stats.pages} pages, ${stats.images} with an image, ${stats.back} back buttons, ${stats.linked} linked buttons, ${stats.dropped} dropped${stats.keys ? `, PGP key left out of ${stats.keys}` : ''}`);
console.log(`Profile: ${profile.name || '(not captured: explore the bot again to read it)'}${profile.commands?.length ? `, ${profile.commands.length} commands` : ''}${profile.photo ? ', photo' : ''}`);

// The bot the style goes to, checked before anything is written (an owner's own bots only)
const target = applyTo ? await prisma.telegramBot.findUnique({ where: { id: applyTo } }) : null;
if (applyTo && !target) { console.error(`Bot #${applyTo} not found among your bots.`); process.exit(1); }
async function applied(style) {
  if (!target) return;
  if (dry) { console.log(`Would apply the style to @${target.username}.`); return; }
  await applyStyle(target.id, style.id);
  console.log(`Style applied to @${target.username}: screens and commands (the bot keeps its own name and photo).`);
}

if (mergeInto) {
  // Your own style first; a shared preset of the platform is read-only for an owner
  const style = await prisma.botStyle.findFirst({ where: { name: mergeInto }, orderBy: { tenantId: 'desc' } });
  if (!style) { console.error(`No style called "${mergeInto}".`); process.exit(1); }
  if (currentTenant() && style.tenantId !== currentTenant()) { console.error(`"${mergeInto}" is a shared style of the platform: pick one of your own styles, or make a replica.`); process.exit(1); }
  const old = style.look || {};
  const before = new Map((old.pages || []).map(pg => [pg.key, pg]));
  const picked = pages.filter(pg => only.has(pg.key));
  const missing = [...only].filter(k => !picked.some(pg => pg.key === k));
  // A key page keeps the shop's own key; the captured bot's key (left out above) never
  // stays, even when an earlier import had copied it in
  for (const pg of picked) {
    const was = before.get(pg.key)?.html;
    if (hasKey(was) && !othersKey(was)) pg.html = was;
    else if (pg.html === NO_KEY && !hasKey(was) && !blank(was)) pg.html = was;
  }
  const changed = picked.filter(pg => (before.get(pg.key)?.html || '') !== pg.html).map(pg => pg.key);
  console.log(`Pages changed in "${mergeInto}": ${changed.length ? changed.join(', ') : 'none'}${missing.length ? `; not found in the capture: ${missing.join(', ')}` : ''}`);
  const chosen = await withImages(picked);
  const kept = (old.pages || []).filter(pg => !only.has(pg.key));
  const titles = Object.fromEntries((old.pages || []).map(pg => [pg.key, pg.title]));
  // Welcome and menu pictures follow the capture, unless one was chosen by hand in the admin
  const images = { ...(old.images || {}) };
  const pictures = [];
  for (const [slot, screen] of [['start', startScreen], ['menu', menuScreen]]) {
    if (!screen?.media) continue;
    const current = images[slot];
    if (current && !media.isCaptured(current) && !current.includes('/captain-slabbin/bots/')) { pictures.push(`${slot} kept (set by hand)`); continue; }
    await media.adopt(current, screen.media);
    const url = await imageUrl(screen.media);
    if (url && url !== current) { images[slot] = url; pictures.push(`${slot} updated`); }
  }
  if (dry) { await applied(style); console.log(`Dry run: nothing written. Images to upload: ${media.stats.uploaded}${pictures.length ? `; ${pictures.join(', ')}` : ''}.`); process.exit(0); }
  const updated = await prisma.botStyle.update({
    where: { id: style.id },
    data: { look: { ...old, images, pages: [...kept, ...chosen.map(pg => ({ ...pg, title: titles[pg.key] || pg.key, buttons: pg.buttons.length ? pg.buttons : [[{ text: '⇆ Back', action: 'menu' }]] }))] } },
  });
  console.log(`Style "${mergeInto}": ${chosen.length} information pages copied, pictures: ${pictures.join(', ') || 'unchanged'}. Images: ${media.stats.uploaded} uploaded, ${media.stats.reused} already online. Catalog and payments stay the shop's.`);
  await applied(updated);
  await prisma.$disconnect();
  process.exit(0);
}

// The replica: browsed without an account like the original (commands layout),
// /start opens its first screen, typed commands open their pages, its profile
// and command menu are the original's
const home = startScreen ? keyOf.get(startScreen.key) : '';
// Without the captured profile: the commands the start and menu screens offer
// (not the hundreds of product commands), else the first few commands seen
const offered = [startScreen, menuScreen].filter(Boolean).flatMap(sc => String(sc.raw || sc.html || '').match(/(?<![\w/])\/[A-Za-z][A-Za-z0-9_]{0,31}/g) || []);
const product = c => /^\/p\d*_/.test(c);
const pageCommands = [...new Set((offered.length ? offered : screens.map(commandOf)).filter(c => c && c !== '/start' && !product(c)))].slice(0, 15)
  .map(c => ({ command: cmdName(c), description: cmdName(c) }));
const commands = (profile.commands?.length ? profile.commands : pageCommands)
  .map(c => ({ command: cmdName(c.command).slice(0, 32), description: String(c.description || c.command).slice(0, 256) }))
  .filter(c => /^[a-z0-9_]{1,32}$/.test(c.command));
const look = {
  layout: 'commands', siteLinks: false, upperTitles: false, home,
  pages: await withImages(pages),
  // Screens and commands only: the bot it is applied to keeps its own name,
  // descriptions and photo (a copied identity would pass for the other seller)
  replica: true,
  ...(commands.length ? { profile: { commands } } : {}),
};
console.log(`Replica "${name}": ${look.pages.length} pages, home ${home || '(none)'}, ${commands.length} commands${personal ? `, ${personal} anti-phishing screen(s) left out` : ''}. The bot keeps its own name and photo.`);
if (dry) { await applied({ id: 0 }); console.log('Dry run: nothing written.'); process.exit(0); }
const existing = await prisma.botStyle.findFirst({ where: { name }, orderBy: { tenantId: 'desc' } });
const mine = existing && (!currentTenant() || existing.tenantId === currentTenant()) ? existing : null;
const data = { name, look, source: `@${bot}`, capture: { bot, profile } };
const style = mine
  ? await prisma.botStyle.update({ where: { id: mine.id }, data })
  : await prisma.botStyle.create({ data });
console.log(`Style "${name}" ${mine ? 'updated' : 'created'} (id ${style.id}).`);
await applied(style);
await prisma.$disconnect();
