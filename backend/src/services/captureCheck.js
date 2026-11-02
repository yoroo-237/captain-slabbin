// Fidelity check of a capture, crossroad by crossroad. A crossroad is a captured
// screen with buttons to follow; each of its routes (a button, a typed text) is
// either captured (it opened a screen that was saved), played without a new
// screen (an alert, the same screen), still queued, failed, left out on purpose
// (skip list, a twin of a route already played) or missing. Then, when a replica
// style of the bot is given, whether each route is in that style: the screen's page
// exists, the button is on it and leads to a page that exists.
import { keptScreens, pageKeys, targetOf, stepLabel, isBack, PERSONAL } from './captureMap.js';

const ROUTE = new Set(['callback', 'keyboard']);
const LINK = new Set(['url', 'login_url', 'web_app', 'copy', 'switch_inline', 'pay', 'request_contact', 'request_location', 'request_poll', 'request_users', 'request_chat']);
// A label without its numbers: « Page 1 of 3 » and « Page 2 of 3 » are the same route
const norm = label => String(label || '').replace(/\d+(?:[.,]\d+)?/g, '#').trim();
const titleOf = s => (String(s.raw || '').split('\n').map(l => l.trim()).find(Boolean) || (s.media ? `(${s.media_type || 'media'})` : '(no text)')).slice(0, 90);
const COVERED = new Set(['captured', 'end', 'equivalent']);

export function checkCapture(data, state = {}, style = null) {
  const screens = data.screens || [];
  const steps = data.steps || [];
  const ignored = new Set(data.ignored || []);
  const paths = state.paths || {};
  const origin = state.origin || {};
  // What is still queued: [kind, msg, data (base64), label] for a button
  const queued = (state.queue || []).map(a => (a[0] === 'cb' ? { label: `[${a[3]}]`, from: origin[a[2]] } : a[0] === 'goto' ? { label: `[${a[3]}]`, from: a[1] } : { label: a[1] }));
  const okNorm = new Set(steps.filter(st => !st.error).map(st => norm(st.action)));

  // The replica: its pages by key, and the page key of each captured screen
  const pages = new Map((style?.look?.pages || []).map(p => [p.key, p]));
  const keyOf = pageKeys(keptScreens(screens));
  const byKey = new Map(screens.map(s => [s.key, s]));
  const onPage = (page, text) => (page?.buttons || []).flat().find(b => b.text === text)
    || (page?.keyboard?.rows || []).flat().find(b => b.text === text);
  function inReplica(s, b, route) {
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

  const crossroads = [];
  for (const s of [...screens].sort((a, b) => a.order - b.order)) {
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
        else if (ignored.has(b.text) || ignored.has(label)) route.status = 'ignored';
        else if (tried.some(st => !st.error)) { route.status = 'end'; route.alert = tried.find(st => st.alert)?.alert || null; }
        else if (queued.some(q => q.label === label && (!q.from || q.from === s.key))) route.status = 'pending';
        else if (tried.length) { route.status = 'failed'; route.error = tried[tried.length - 1].error; }
        else if (okNorm.has(norm(label)) || isBack(b)) route.status = 'equivalent';
        // What can be run again: a typed text, or a button of a screen whose way is known
        if (!COVERED.has(route.status) && route.status !== 'ignored') {
          if (b.kind === 'keyboard') route.retry = { text: b.text };
          else if (paths[s.key]) route.retry = { screen: s.key, label: b.text };
        }
      }
      route.replica = inReplica(s, b, route);
      routes.push(route);
    }
    if (!routes.length) continue;
    crossroads.push({
      key: s.key, order: s.order, title: titleOf(s), media: s.media || null,
      personal: PERSONAL.test(s.raw || s.html || ''),
      path: (paths[s.key] || []).map(([, value]) => value),
      page: style ? (pages.has(keyOf.get(s.key)) ? keyOf.get(s.key) : null) : undefined,
      routes,
    });
  }

  // The bot's command menu: each command opened a screen, or not
  const commands = (data.profile?.commands || []).map(c => {
    const cmd = `/${String(c.command || c).replace(/^\//, '')}`;
    const opened = screens.some(s => (s.sources || []).includes(cmd));
    const tried = steps.filter(st => st.action === cmd);
    const status = opened ? 'captured' : tried.some(st => !st.error) ? 'end' : tried.length ? 'failed' : 'missing';
    const page = style ? [...keyOf].find(([k]) => (byKey.get(k)?.sources || []).includes(cmd))?.[1] : null;
    return { command: cmd, description: c.description || '', status, ...(COVERED.has(status) ? {} : { retry: { cmd } }),
      ...(style ? { replica: page && pages.has(page) ? 'copied' : opened ? 'not_copied' : null } : {}) };
  });

  const all = crossroads.flatMap(c => c.routes);
  const count = st => all.filter(r => r.status === st).length;
  const routes = all.filter(r => ROUTE.has(r.kind) && !['disabled', 'ignored'].includes(r.status));
  const covered = routes.filter(r => COVERED.has(r.status)).length + commands.filter(c => COVERED.has(c.status)).length;
  const total = routes.length + commands.length;
  const summary = {
    crossroads: crossroads.length, screens: screens.length, routes: total, covered,
    coverage: total ? Math.round((covered / total) * 100) : 100,
    captured: count('captured'), end: count('end'), equivalent: count('equivalent'), pending: count('pending'),
    failed: count('failed') + commands.filter(c => c.status === 'failed').length,
    missing: count('missing') + commands.filter(c => c.status === 'missing').length,
    ignored: count('ignored'), links: count('link'),
    retryable: all.filter(r => r.retry).length + commands.filter(c => c.retry).length,
  };
  if (style) {
    const judged = [...all, ...commands].filter(r => r.replica);
    const copied = judged.filter(r => r.replica === 'copied').length;
    summary.replica = {
      style: { id: style.id, name: style.name }, pages: pages.size,
      missingPages: crossroads.filter(c => !c.personal && !c.page).length,
      copied, notCopied: judged.filter(r => r.replica === 'not_copied' || r.replica === 'no_page').length,
      broken: judged.filter(r => r.replica === 'broken').length,
      fidelity: judged.length ? Math.round((copied / judged.length) * 100) : 100,
    };
  }
  return { bot: data.bot, summary, crossroads, commands };
}
