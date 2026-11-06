// Self-contained checks for the replica pipeline (no DB, no live Telegram, no capture
// files). Run: DATABASE_URL=postgresql://x node backend/scripts/test-replica.mjs
import { buildGraph, keptScreens } from '../src/services/captureMap.js';
import { renderInvoice, extractInvoiceTemplate } from '../src/services/replicaInvoice.js';
import { scanText, reviewCapture } from '../src/services/captureReview.js';
import { mergeReplicaLook } from '../src/services/replicaMerge.js';

let pass = 0, fail = 0;
const check = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`); cond ? pass++ : fail++; };
const page = (k, h) => ({ key: k, html: h, buttons: [] });

// ── Graph ────────────────────────────────────────────────────────────────────
const screens = [
  { key: 'A', order: 1, sources: ['/start'], buttons: [[{ text: 'Menu', kind: 'callback', data: 'm1' }, { text: 'Deals', kind: 'callback', data: 'm2' }], [{ text: 'Secret', kind: 'callback', data: 'sx' }]] },
  { key: 'B', order: 2, sources: ['[Menu]'], buttons: [[{ text: 'Buy', kind: 'callback', data: 'buy1' }, { text: 'Back', kind: 'callback', data: '/back_x' }]] },
  { key: 'D', order: 3, sources: ['[Deals]'], buttons: [] },
  { key: 'C', order: 4, sources: ['[Buy]'], buttons: [] },
  { key: 'P', order: 5, sources: ['[Secret]'], html: 'Your secret phrase is hunter2', buttons: [] },
];
const steps = [
  { from: 'A', action: '[Menu]', data: 'm1', screens: ['B'] },
  { from: 'A', action: '[Deals]', data: 'm2', screens: ['D'] },
  { from: 'A', action: '[Secret]', data: 'sx', screens: ['P'] },
  { from: 'B', action: '[Buy]', data: 'buy1', screens: ['C'] },
  { from: 'B', action: '[Back]', data: '/back_x', edited: 'A', screens: [] },
];
const kept = keptScreens(screens);
const g = buildGraph(kept, steps);
const A = kept.find(s => s.key === 'A'), B = kept.find(s => s.key === 'B');
check('graph: PERSONAL screen dropped', kept.length === 4 && !kept.some(s => s.key === 'P'));
check('graph: edge by data (Menu→B, Deals→D)', g.target(A, A.buttons[0][0]).key === 'B' && g.target(A, A.buttons[0][1]).key === 'D');
check('graph: edge to a dropped screen → null', g.target(A, A.buttons[1][0]) === null);
check('graph: edited (Back→A)', g.target(B, B.buttons[0][1]).key === 'A');
check('graph: old capture (no steps) falls back without crashing', buildGraph(kept, []).hasEdges === false);

// ── Invoice ──────────────────────────────────────────────────────────────────
const invScreens = [{ raw: '🧾 Receipt\n\nBlue Dream ×2 — $70.00\nOG Kush ×1 — $120.00\nShipping: $10.00\nTotal: $200.00\n\nThank you!' }];
const tpl = extractInvoiceTemplate(invScreens);
check('invoice: template extracted (draft)', !!tpl?.template && tpl.draft === true);
const money = v => `$${Number(v || 0).toFixed(2)}`;
const rendered = renderInvoice(tpl, {
  order: 'ORD-1', items: [{ qty: 2, name: 'Blue Dream', price: 35, lineTotal: 70 }, { qty: 1, name: 'OG <x>', price: 120, lineTotal: 120 }],
  subtotal: 190, shipping: 10, total: 200, paid: '0.01 BTC', wallet: 50,
}, money);
check('invoice: renders items + total, escapes html, no leftover tokens',
  /Blue Dream/.test(rendered) && /OG &lt;x&gt;/.test(rendered) && rendered.includes('$200.00') && !/\{[a-z_]+\}/.test(rendered));
check('invoice: no template → null (fallback)', renderInvoice(null, {}) === null);
check('invoice: hand template drops empty voucher line',
  !/🎟/.test(renderInvoice({ template: 'T\n{voucher}\nTotal {total}', item: '{name}' }, { total: 5 }, money)));
check('invoice: template HTML-escaped for parse_mode',
  renderInvoice({ template: 'Terms & Co <x>\n{total}', item: '{name}' }, { total: 5 }, money).includes('Terms &amp; Co &lt;x&gt;'));
check('invoice: extracted template keeps paragraph spacing',
  /\n\n/.test(extractInvoiceTemplate([{ raw: 'Header line\n\nItem ×1 — $5.00\nTotal: $5.00\n\nFooter note' }])?.template || ''));

// ── Personal-info review ──────────────────────────────────────────────────────
check('review: btc + email + handle detected, email≠handle', (() => {
  const k = scanText('pay bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq mail a@b.com dm @Support');
  return k.some(h => h.kind === 'btc') && k.some(h => h.kind === 'email') && k.filter(h => h.kind === 'handle').length === 1;
})());
check('review: price is not a phone', !scanText('Total $10.50 and $4250.00').some(h => h.kind === 'phone'));
check('review: ownerName first + scans screens', (() => {
  const r = reviewCapture({ profile: { name: 'Orig', about: 'dm @orig' }, screens: [{ key: 's', raw: 'send 0x52908400098527886E0F7030069857D2E4169EE7' }] });
  return r[0].kind === 'ownerName' && r.some(x => x.kind === 'eth');
})());

// ── Merge (keep hand edits on re-import) ──────────────────────────────────────
const v1 = mergeReplicaLook({}, { replica: true, home: 'A', catalog: 'c', pages: [page('A', 'Welcome'), page('B', 'Menu')], profile: { name: 'Orig' } });
check('merge: first import stores a fingerprint', !!v1._imported?.pages?.A);
const edited = structuredClone(v1); edited.pages[0].html = 'mine'; edited.profile = { name: 'My Shop' };
const v2 = { replica: true, home: 'A', catalog: 'c', pages: [page('A', 'Welcome v2'), page('C', 'New')], profile: { name: 'Orig v2' } };
const m = mergeReplicaLook(edited, v2);
const byKey = Object.fromEntries(m.pages.map(p => [p.key, p]));
check('merge: edited page kept, new added, unedited-removed dropped', byKey.A.html === 'mine' && byKey.C && !byKey.B);
check('merge: edited profile kept', m.profile.name === 'My Shop');
check('merge: unedited page takes upstream change', mergeReplicaLook(structuredClone(v1), v2).pages.find(p => p.key === 'A').html === 'Welcome v2');
const del = structuredClone(v1); del.pages = del.pages.filter(p => p.key !== 'B');
check('merge: hand-deleted page stays deleted on re-import',
  !mergeReplicaLook(del, { replica: true, home: 'A', catalog: 'c', pages: [page('A', 'Welcome'), page('B', 'Menu')], profile: { name: 'Orig' } }).pages.some(p => p.key === 'B'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
