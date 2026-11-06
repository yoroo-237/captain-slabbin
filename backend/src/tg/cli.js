// Command line of the capture engine (copy of tools/tg-explorer, run by Captain Slabbin itself).
//   node src/tg/cli.js explore <bot> [--complete N] [--wait S] [--max-actions N] [--fresh] [--no-media] …
//   node src/tg/cli.js login send <+phone> | login code <code> [password] | status | logout
// Reads API_ID, API_HASH (and PHONE) from backend/.env. Captures go to
// <--captures-dir> (default backend/data/captures), sessions to TG_SESSIONS_DIR (default backend/data/sessions).
// The walk records every product and its place in the bot, and stops at the quantity selection.
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeClient, normalizeBot } from './client.js';
import { exploreBot } from './explore.js';
import { profileOf } from './profiles.js';
import * as login from './login.js';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [cmd, ...rest] = process.argv.slice(2);

function options(list) {
  const o = { _: [], skip: [], allow: [], start: [] };
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const next = () => list[++i];
    switch (a) {
      case '--profile': o.profile = next(); break;
      case '--captures-dir': o.capturesDir = next(); break;
      case '--out': o.out = next(); break;
      case '--wait': o.wait = num(next(), 2.5); break;
      case '--max-actions': o.maxActions = num(next(), 200); break;
      case '--max-per-prefix': o.maxPerPrefix = num(next(), 0); break;
      case '--max-media-mb': o.maxMediaMb = num(next(), 20); break;
      case '--complete': o.complete = num(next(), 3); break;
      case '--start': o.start.push(next()); break;
      case '--skip': o.skip.push(next()); break;
      case '--allow': o.allow.push(next()); break;
      case '--retry': o.retry = next(); break;
      case '--stop-file': o.stopFile = next(); break;
      case '--fresh': o.fresh = true; break;
      case '--strict': o.strict = true; break;
      case '--no-media': o.noMedia = true; break;
      case '--no-commands': o.noCommands = true; break;
      case '--no-join': o.noJoin = true; break;
      case '--no-inline': o.noInline = true; break;
      case '--no-default-skip': o.noDefaultSkip = true; break;
      default: throw new Error(`Option inconnue : ${a}`);
    }
  }
  return o;
}

async function explore(list) {
  const o = options(list);
  if (o._.length !== 1) throw new Error('Un seul bot à la fois : explore <bot>');
  const name = normalizeBot(o._[0]);
  profileOf(name); // QT Market or Captain Slabbin's bot only
  const profile = o.profile || 'explorer';
  const { client } = makeClient(profile, { connectionRetries: 10, retryDelay: 5000 });
  await client.connect();
  if (!(await client.checkAuthorization())) throw new Error(`Profil « ${profile} » non connecté : node src/tg/cli.js login send <+numéro>`);
  try {
    const left = await exploreBot(client, name, {
      capturesDir: path.resolve(o.capturesDir || path.join(BACKEND, 'data', 'captures')), out: o.out, retry: o.retry, stopFile: o.stopFile,
      wait: o.wait ?? 2.5, maxActions: o.maxActions ?? 200, maxPerPrefix: o.maxPerPrefix ?? 0, maxMediaMb: o.maxMediaMb ?? 20,
      complete: o.complete ?? 3, start: o.start.length ? o.start : ['/start'], skip: o.skip, allow: o.allow,
      fresh: !!o.fresh, strict: !!o.strict, noMedia: !!o.noMedia, noCommands: !!o.noCommands, noJoin: !!o.noJoin,
      noInline: !!o.noInline, noDefaultSkip: !!o.noDefaultSkip,
    });
    // Network lost, action limit…: a failing exit, so that no style is made from half a capture
    if (left) throw new Error(`Capture inachevée : ${left} action(s) restante(s).`);
  } finally { try { await client.destroy(); } catch { /* closed */ } }
}

async function main() {
  const print = r => console.log(JSON.stringify(r));
  if (cmd === 'explore') return explore(rest);
  if (cmd === 'status') return print(await login.status(rest));
  if (cmd === 'logout') return print(await login.logout(options(rest).profile || 'explorer'));
  if (cmd === 'login') {
    const [sub, ...a] = rest;
    const o = options(a);
    const profile = o.profile || 'explorer';
    if (sub === 'send') return print(await login.sendCode(profile, o._[0]));
    if (sub === 'code') { // the code and password come on stdin, never on the command line
      let raw = '';
      for await (const chunk of process.stdin) raw += chunk;
      let secret = {};
      try { secret = JSON.parse(raw || '{}'); } catch { /* none */ }
      return print(await login.signIn(profile, { code: secret.code || o._[0] || '', password: secret.password || o._[1] || '' }));
    }
  }
  throw new Error('Commandes : explore <bot> | login send <+numéro> | login code <code> [mot de passe] | status | logout');
}

main().then(() => process.exit(0), e => { console.error(e.message); process.exit(1); });
