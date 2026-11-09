// Fidelity check of a capture, screen by screen. A crossroad is a captured screen
// with routes to follow: its buttons, the texts of its reply keyboard and the
// commands written in its text (/p178…). Each route is either captured (it opened
// a screen that was saved), played without a new screen (an alert, the same
// screen), still queued, failed, left out on purpose (skip list, the same button
// on the same screen up to its numbers, a button known to always open the same
// screen) or missing. Then, when a replica style of the bot is given, whether the
// style has each screen (its page, text, picture, keyboard) and each route (the
// button is on the page and leads to a page that exists), and the command menu.
import { keptScreens, pageKeys, targetOf, stepLabel, isBack, PERSONAL } from './captureMap.js';
import { cmdName } from './telegramCommands.js';

const ROUTE = new Set(['callback', 'keyboard']);
const LINK = new Set(['url', 'login_url', 'web_app', 'copy', 'switch_inline', 'pay', 'request_contact', 'request_location', 'request_poll', 'request_users', 'request_chat']);
// Same rule as explore.py: a command written in a text
const COMMAND = /(?<![\w/])\/[A-Za-z][A-Za-z0-9_]{0,31}/g;
// A label or a text without its numbers (explore.py's norm and template)
const norm = label => String(label || '').trim().replace(/\d+(?:[.,]\d+)?/g, '#');
const templateOf = s => norm(JSON.stringify([s.html || '', (s.buttons || []).map(r => r.map(b => b.text || ''))]));
const titleOf = s => (String(s.raw || '').split('\n').map(l => l.trim()).find(Boolean) || (s.media ? `(${s.media_type || 'media'})` : '(no text)')).slice(0, 90);
// What a reader sees of a text: no tags, no custom emoji links, spaces collapsed
const plain = html => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const IMAGE_KINDS = new Set(['photo', 'animation', 'sticker', 'video']);
const COVERED = new Set(['captured', 'end', 'equivalent']);
// Never pressed by the capture, so never offered to run again: a product's quantity tiers
// (« 1oz—$50⁰⁰ » puts it in the cart) and what follows them (explore.py's HAND_ONLY)
const HAND_ONLY = /—\s*\$\s*\d|^\W*remove product from cart|^\W*add product notes|^\W*enter shipping details|^\W*apply vouchers?/i;
const PROBLEM = new Set(['pending', 'failed', 'missing']);

export function checkCapture(data, state = {}, style = null) {
  const screens = [...(data.screens || [])].sort((a, b) => a.order - b.order);
  const steps = data.steps || [];
  const ignored = new Set(data.ignored || []);
  const paths = state.paths || {};
  const origin = state.origin || {};
  const labelResults = state.label_results || {};
  // What is still queued: [kind, msg, data (base64), label] for a button
  const queued = (state.queue || []).map(a => (a[0] === 'cb' ? { label: `[${a[3]}]`, from: origin[a[2]] } : a[0] === 'goto' ? { label: `[${a[3]}]`, from: a[1] } : { label: a[1] }));
  const opened = new Set(screens.flatMap(s => s.sources || []));
  const template = new Map(screens.map(s => [s.key, templateOf(s)]));

  // A button counts as covered elsewhere only on the same screen up to its numbers
  // (the explorer plays it once there), or when it always opened the same screen
  const coveredOn = new Map(); // template → set of normalised labels played there
  for (const st of steps) {
    if (st.error || !st.from || !template.has(st.from)) continue;
    const t = template.get(st.from);
    if (!coveredOn.has(t)) coveredOn.set(t, new Set());
    coveredOn.get(t).add(norm(st.action));
  }
  const alwaysSame = b => { const k = labelResults[norm(b.text)]; return k && k.played >= 2 && (k.screens || []).length === 1; };

  // The replica: its pages by key, and the page key of each kept screen
  const pages = new Map((style?.look?.pages || []).map(p => [p.key, p]));
  const keyOf = pageKeys(keptScreens(screens));
  const onPage = (page, text) => (page?.buttons || []).flat().find(b => b.text === text)
    || (page?.keyboard?.rows || []).flat().find(b => b.text === text);
  function routeInReplica(s, b, route) {
    if (!style || PERSONAL.test(s.raw || s.html || '')) return null;
    const page = pages.get(keyOf.get(s.key));
    if (!page) return 'no_page';
    const pb = onPage(page, b.text);
    if (!pb) return route.status === 'captured' || route.status === 'link' ? 'not_copied' : null;
    if (pb.action?.startsWith('page:')) return pages.has(pb.action.slice(5)) ? 'copied' : 'broken';
    // A reply-keyboard text: the page it opens answers to that text (its triggers)
    if (b.kind === 'keyboard' && route.target) {
      const target = pages.get(keyOf.get(route.target.key));
      return target && (target.triggers || []).includes(b.text) ? 'copied' : 'broken';
    }
    return 'copied';
  }
  // A typed command: the page keyed by it (that is how the replica answers it)
  const commandInReplica = (cmd, status) => {
    if (!style) return null;
    if (cmd === '/start') return pages.has(style.look?.home) ? 'copied' : 'no_page';
    return pages.has(cmdName(cmd)) ? 'copied' : status === 'captured' ? 'not_copied' : null;
  };
  // The screen itself in the replica: its page, text, picture, keyboard, forced reply
  function contentIssues(s) {
    if (!style || PERSONAL.test(s.raw || s.html || '')) return [];
    const page = pages.get(keyOf.get(s.key));
    if (!page) return ['page'];
    const out = [];
    const pgp = /BEGIN PGP PUBLIC KEY BLOCK/.test(s.html || '');
    if (!pgp && plain(s.html || s.raw) !== plain(page.html)) out.push('text');
    if (s.media && IMAGE_KINDS.has(s.media_type || 'photo') && !page.image) out.push('image');
    const keyboard = s.markup?.type === 'keyboard' || (s.buttons || []).some(r => r.some(b => b.kind === 'keyboard'));
    if (keyboard && !(page.keyboard?.rows || []).length) out.push('keyboard');
    if (s.markup?.type === 'force_reply' && page.markup?.type !== 'force_reply') out.push('reply');
    return out;
  }
  const commandStatus = cmd => {
    const tried = steps.filter(st => st.action === cmd);
    if (opened.has(cmd)) return { status: 'captured' };
    if (ignored.has(cmd)) return { status: 'ignored' };
    if (tried.some(st => !st.error)) return { status: 'end' };
    if (queued.some(q => q.label === cmd)) return { status: 'pending' };
    if (tried.length) return { status: 'failed', error: tried[tried.length - 1].error };
    return { status: 'missing' };
  };

  const crossroads = [];
  const commandsSeen = new Set();
  for (const s of screens) {
    const routes = [];
    for (const b of (s.buttons || []).flat()) {
      if (!ROUTE.has(b.kind) && !LINK.has(b.kind)) continue;
      const route = { label: b.text, kind: b.kind, status: 'missing' };
      if (LINK.has(b.kind)) route.status = 'link';
      else if (b.disabled) route.status = 'disabled';
      else {
        const label = stepLabel(b);
        const target = targetOf(screens, s, b);
        const tried = steps.filter(st => st.action === label && (!st.from || st.from === s.key));
        if (target) { route.status = 'captured'; route.target = { key: target.key, title: titleOf(target) }; }
        else if (HAND_ONLY.test(b.text || '')) route.status = 'hand';
        else if (ignored.has(b.text) || ignored.has(label)) route.status = 'ignored';
        else if (tried.some(st => !st.error)) { route.status = 'end'; route.alert = tried.find(st => st.alert)?.alert || null; }
        else if (queued.some(q => q.label === label && (!q.from || q.from === s.key))) route.status = 'pending';
        else if (tried.length) { route.status = 'failed'; route.error = tried[tried.length - 1].error; }
        else if (isBack(b) || coveredOn.get(template.get(s.key))?.has(norm(label)) || alwaysSame(b)) route.status = 'equivalent';
        // What can be run again: a typed text, or a button of a screen whose way is known
        if (!COVERED.has(route.status) && !['ignored', 'hand'].includes(route.status)) {
          if (b.kind === 'keyboard') route.retry = { text: b.text };
          else if (paths[s.key]) route.retry = { screen: s.key, label: b.text };
        }
      }
      route.replica = routeInReplica(s, b, route);
      routes.push(route);
    }
    // Commands written in the text: each one is a route too (checked once, where first seen)
    for (const cmd of new Set(String(s.raw || '').match(COMMAND) || [])) {
      if (commandsSeen.has(cmd)) continue;
      commandsSeen.add(cmd);
      const route = { label: cmd, kind: 'command', ...commandStatus(cmd) };
      const target = route.status === 'captured' && screens.find(x => (x.sources || []).includes(cmd));
      if (target) route.target = { key: target.key, title: titleOf(target) };
      if (!COVERED.has(route.status) && route.status !== 'ignored') route.retry = { cmd };
      route.replica = commandInReplica(cmd, route.status);
      routes.push(route);
    }
    const issues = contentIssues(s);
    if (!routes.length && !issues.length) continue;
    crossroads.push({
      key: s.key, order: s.order, title: titleOf(s), media: s.media || null, leaf: !routes.length,
      personal: PERSONAL.test(s.raw || s.html || ''),
      path: (paths[s.key] || []).map(([, value]) => value),
      page: style ? (pages.has(keyOf.get(s.key)) ? keyOf.get(s.key) : null) : undefined,
      issues, routes,
    });
  }

  // The bot's command menu: each command opened a screen, and the replica has it in
  // its menu and as a page
  const menu = new Set((style?.look?.profile?.commands || []).map(c => cmdName(c.command)));
  const commands = (data.profile?.commands || []).map(c => {
    const cmd = `/${String(c.command || c).replace(/^\//, '')}`;
    const st = commandStatus(cmd);
    let replica = null;
    if (style) replica = !menu.has(cmdName(cmd)) ? 'not_in_menu' : commandInReplica(cmd, st.status) || 'copied';
    return { command: cmd, description: c.description || '', ...st, ...(COVERED.has(st.status) || st.status === 'ignored' ? {} : { retry: { cmd } }),
      ...(style ? { replica } : {}) };
  });

  const all = crossroads.flatMap(c => c.routes);
  const count = st => all.filter(r => r.status === st).length + commands.filter(c => c.status === st).length;
  const counted = [...all.filter(r => (ROUTE.has(r.kind) || r.kind === 'command') && !['disabled', 'ignored', 'hand'].includes(r.status)),
    ...commands.filter(c => c.status !== 'ignored')];
  const covered = counted.filter(r => COVERED.has(r.status)).length;
  const summary = {
    crossroads: crossroads.filter(c => !c.leaf).length, screens: screens.length, routes: counted.length, covered,
    coverage: counted.length ? Math.round((covered / counted.length) * 100) : 100,
    captured: count('captured'), end: count('end'), equivalent: count('equivalent'), pending: count('pending'),
    failed: count('failed'), missing: count('missing'), ignored: count('ignored'), hand: count('hand'), links: count('link'),
    textCommands: all.filter(r => r.kind === 'command').length,
    retryable: all.filter(r => r.retry).length + commands.filter(c => c.retry).length,
  };
  if (style) {
    const judged = [...all, ...commands].filter(r => r.replica);
    const copied = judged.filter(r => r.replica === 'copied').length;
    const issues = crossroads.flatMap(c => c.issues.filter(i => i !== 'page'));
    const missingPages = crossroads.filter(c => c.issues.includes('page')).length;
    const kept = keptScreens(screens).length;
    // Each kept screen is one more thing to copy, faithful when it has no issue
    const faithful = kept - crossroads.filter(c => c.issues.length).length;
    const total = judged.length + kept;
    summary.replica = {
      style: { id: style.id, name: style.name }, pages: pages.size, missingPages,
      copied, notCopied: judged.filter(r => ['not_copied', 'no_page', 'not_in_menu'].includes(r.replica)).length,
      broken: judged.filter(r => r.replica === 'broken').length,
      content: { text: issues.filter(i => i === 'text').length, image: issues.filter(i => i === 'image').length,
        keyboard: issues.filter(i => i === 'keyboard').length, reply: issues.filter(i => i === 'reply').length },
      home: !!(style.look?.home && pages.has(style.look.home)),
      fidelity: total ? Math.round(((copied + faithful) / total) * 100) : 100,
    };
  }
  return { bot: data.bot, summary, crossroads, commands };
}
