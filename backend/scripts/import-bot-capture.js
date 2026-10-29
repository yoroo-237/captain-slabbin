// Turns a capture of a bot (data.json + media/) into a style made of pages.
//
//   node scripts/import-bot-capture.js <capture folder> [--name "QT Market"] [--dry]
//   node scripts/import-bot-capture.js <capture folder> --merge-into "QT Market" [--pages a,b,c] [--dry]
//
// The second form keeps the shop's catalog and payments: it only copies the
// information pages (--pages, command names) and the welcome/menu pictures into
// an existing style, whose shelves, products and checkout stay the shop's own.

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

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const dry = args.includes('--dry');
const opt = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const mergeInto = opt('--merge-into');
const only = new Set((opt('--pages') || 'about_qtetra,v_qtetra_refunds,v_qtetra_shipping,pgp_qtetra').split(',').map(cmdName));
const name = opt('--name') || 'Imported bot';
if (!dir) { console.error('Usage: node scripts/import-bot-capture.js <capture folder> [--name "Style name"] [--dry]'); process.exit(1); }

const { bot, screens } = JSON.parse(await fs.readFile(path.join(dir, 'data.json'), 'utf8'));
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
const startScreen = screens.find(s => (s.sources || []).includes('/start'));
const menuScreen = screens.find(s => (s.sources || []).some(x => x === '/v_qtetra')) || startScreen;
const menuKey = menuScreen && keyOf.get(menuScreen.key);

// Telethon's HTML → what the Bot API accepts: no custom emoji links, real newlines
const clean = html => String(html || '')
  .replace(/<a href="tg:\/\/emoji\?id=\d+">(.*?)<\/a>/gs, '$1')
  .replace(/<br\s*\/?>/gi, '\n')
  .slice(0, 4000);

// The screen a callback button opens: the nearest later screen that was reached
// by clicking a button with that label
function targetOf(screen, button) {
  const label = `[${button.text}]`;
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
const NO_KEY = '<b>Our PGP key</b>\n\nPaste your PGP public key here (Admin, Telegram bots, Styles, this style, Pages). Until then, customers send their address in plain text.';

const stats = { pages: 0, images: 0, back: 0, linked: 0, dropped: 0 };
const pages = [];
for (const s of [...screens].sort((a, b) => a.order - b.order)) {
  const rows = [];
  for (const row of s.buttons || []) {
    const out = [];
    for (const b of row) {
      if (b.kind !== 'callback' && b.kind !== 'url') { stats.dropped++; continue; }
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
  pages.push({ key: keyOf.get(s.key), html, media: s.media, buttons: rows });
  stats.pages++;
}
// The image of each page kept: all of them for a new style, the chosen ones when merging
async function withImages(list) {
  const out = [];
  for (const { media: file, ...pg } of list) out.push({ ...pg, image: await imageUrl(file) }); // one at a time: uploads.json is written after each
  return out;
}

console.log(`@${bot}: ${stats.pages} pages, ${stats.images} with an image, ${stats.back} back buttons, ${stats.linked} linked buttons, ${stats.dropped} dropped${stats.keys ? `, PGP key left out of ${stats.keys}` : ''}`);
if (dry && !mergeInto) { console.log('Dry run: nothing written.'); process.exit(0); }

if (mergeInto) {
  const style = await prisma.botStyle.findFirst({ where: { name: mergeInto } });
  if (!style) { console.error(`No style called "${mergeInto}".`); process.exit(1); }
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
  if (dry) { console.log(`Dry run: nothing written. Images to upload: ${media.stats.uploaded}${pictures.length ? `; ${pictures.join(', ')}` : ''}.`); process.exit(0); }
  await prisma.botStyle.update({
    where: { id: style.id },
    data: { look: { ...old, images, pages: [...kept, ...chosen.map(pg => ({ ...pg, title: titles[pg.key] || pg.key, buttons: pg.buttons.length ? pg.buttons : [[{ text: '⇆ Back', action: 'menu' }]] }))] } },
  });
  console.log(`Style "${mergeInto}": ${chosen.length} information pages copied, pictures: ${pictures.join(', ') || 'unchanged'}. Images: ${media.stats.uploaded} uploaded, ${media.stats.reused} already online. Catalog and payments stay the shop's.`);
  await prisma.$disconnect();
  process.exit(0);
}

const home = startScreen ? keyOf.get(startScreen.key) : '';
const look = { pages: await withImages(pages), home, upperTitles: false };
const existing = await prisma.botStyle.findFirst({ where: { name } });
const data = { name, look, source: `@${bot}` };
const style = existing
  ? await prisma.botStyle.update({ where: { id: existing.id }, data })
  : await prisma.botStyle.create({ data });
console.log(`Style "${name}" ${existing ? 'updated' : 'created'} (id ${style.id}). Open it in Admin → Telegram bots → Styles.`);
await prisma.$disconnect();
