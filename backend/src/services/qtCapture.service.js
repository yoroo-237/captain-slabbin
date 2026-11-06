// Captain Slabbin's own capture of @QTMARKETBOT (Admin → Bot captures). Independent of the
// bots platform: its own engine (src/tg, run as a child process), its own Telegram sessions
// and captures (backend/data), its own journal. The capture walks the bot up to the quantity
// selection and also reads its profile (photo, name, description, commands); then the
// "QT Market" style is made from it and applied to the Telegram bot picked.
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import { prisma } from '../db.js';
import { tenantOfStaff } from '../tenant.js';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = path.resolve(process.env.QT_CAPTURE_DIR || path.join(BACKEND, 'data'));
export const SOURCE_BOT = 'QTMARKETBOT';
const STYLE_NAME = 'QT Market';
const PROFILE = 'explorer';
const PHONE = /^\+?[0-9 ]{6,20}$/;
const bad = msg => Object.assign(new Error(msg), { status: 400 });

const sessionsOf = userId => path.join(DATA, 'sessions', `u${Number(userId)}`);
const capturesOf = userId => path.join(DATA, 'captures', `u${Number(userId)}`);
const captureDir = userId => path.join(capturesOf(userId), SOURCE_BOT.toLowerCase());
const stopFile = userId => path.join(capturesOf(userId), '.stop');

// ---- Telegram API keys: the same ones the dashboard already keeps on the account ----
const cipherKey = () => crypto.createHash('sha256').update(`tg-api:${env.jwtSecret}`).digest();
function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString('base64url')).join('.');
}
function unseal(sealed) {
  try {
    const [iv, tag, data] = String(sealed).split('.').map(x => Buffer.from(x, 'base64url'));
    const d = crypto.createDecipheriv('aes-256-gcm', cipherKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch { return ''; }
}
const keysOf = userId => prisma.user.findUnique({ where: { id: Number(userId) }, select: { tgApiId: true, tgApiHash: true } });

export async function apiKeys(userId) {
  const u = await keysOf(userId);
  return { apiId: u?.tgApiId || '', configured: !!(u?.tgApiId && unseal(u.tgApiHash)) };
}
export async function setApiKeys(userId, { apiId, apiHash } = {}) {
  const id = String(apiId || '').trim();
  const hash = String(apiHash || '').trim().toLowerCase();
  if (!/^\d{3,12}$/.test(id)) throw bad('api_id: a number (my.telegram.org, API development tools).');
  if (!/^[0-9a-f]{32}$/.test(hash)) throw bad('api_hash: 32 characters (digits and letters a to f).');
  await prisma.user.update({ where: { id: Number(userId) }, data: { tgApiId: id, tgApiHash: seal(hash) } });
  return apiKeys(userId);
}

async function childEnv(userId) {
  const u = await keysOf(userId);
  const hash = u?.tgApiId ? unseal(u.tgApiHash) : '';
  await fs.mkdir(sessionsOf(userId), { recursive: true });
  return { ...process.env, TG_SESSIONS_DIR: sessionsOf(userId), API_ID: hash ? u.tgApiId : '', API_HASH: hash, PHONE: '', BOT_USERNAME: '' };
}

// ---- a task at a time per member, with its journal -------------------------------
const spaces = new Map();
const ws = userId => {
  const id = Number(userId);
  if (!spaces.has(id)) spaces.set(id, { task: null, log: [] });
  return spaces.get(id);
};
const say = (userId, line) => { const w = ws(userId); w.log.push(line); if (w.log.length > 600) w.log.shift(); };
const busy = userId => { if (ws(userId).task) throw Object.assign(new Error('A task is running: wait for it to end.'), { status: 409 }); };

function run(userId, name, args, vars, then = null) {
  busy(userId);
  const w = ws(userId);
  const child = spawn(process.execPath, args, { cwd: BACKEND, env: vars, windowsHide: true });
  w.task = { name, child };
  const feed = stream => {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      const parts = (rest + chunk).split(/\r?\n/);
      rest = parts.pop();
      parts.filter(Boolean).forEach(l => say(userId, l));
    });
    stream.on('end', () => { if (rest) say(userId, rest); rest = ''; });
  };
  feed(child.stdout);
  feed(child.stderr);
  const done = (line, code) => {
    if (w.task?.child !== child) return;
    clearTimeout(w.task.killTimer);
    const stopped = !!w.task.killTimer || !!w.task.stopped;
    say(userId, line);
    w.task = null;
    if (then && !stopped) Promise.resolve().then(() => then(code)).catch(e => say(userId, `-- ${e.message}`));
  };
  child.on('error', e => done(`Cannot start: ${e.message}`, -1));
  child.on('close', code => done(`-- finished (code ${code})`, code));
}

// A short call of the engine whose last line is JSON (status, sign-in)
function call(args, vars, input = '', timeoutMs = 60000) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: BACKEND, env: vars, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.on('error', e => { clearTimeout(timer); resolve({ error: `Cannot start: ${e.message}` }); });
    child.on('close', () => {
      clearTimeout(timer);
      let r;
      try { r = JSON.parse(out.trim().split('\n').pop()); } catch { r = { error: err.trim().split('\n').pop() || 'The engine failed.' }; }
      if (/^Configuration manquante/.test(r.error || '')) r.error = 'Enter your Telegram API keys first (api_id and api_hash).';
      if (r.config) delete r.config.file;
      delete r.sessions_dir;
      resolve(r);
    });
    child.stdin.end(input);
  });
}

// ---- Telegram account -------------------------------------------------------------
export async function account(userId) { return call(['src/tg/cli.js', 'status', PROFILE], await childEnv(userId)); }

export async function sendCode(userId, phone) {
  const p = String(phone || '').trim();
  if (!PHONE.test(p)) throw bad('Invalid number (international format, e.g. +33600000000).');
  busy(userId);
  return call(['src/tg/cli.js', 'login', 'send', p.replace(/ /g, ''), '--profile', PROFILE], await childEnv(userId));
}

export async function signIn(userId, { code, password } = {}) {
  busy(userId);
  const secret = { code: String(code || '').replace(/\D/g, '').slice(0, 12), password: password ? String(password).slice(0, 256) : '' };
  return call(['src/tg/cli.js', 'login', 'code', '--profile', PROFILE], await childEnv(userId), JSON.stringify(secret));
}

export async function signOut(userId) {
  run(userId, 'sign-out', ['src/tg/cli.js', 'logout', '--profile', PROFILE], await childEnv(userId));
  return state(userId);
}

// ---- capture, then style, then application to a bot -------------------------------
export async function summary(userId) {
  try {
    const dir = captureDir(userId);
    const data = JSON.parse(await fs.readFile(path.join(dir, 'data.json'), 'utf8'));
    let queued = 0;
    try { queued = JSON.parse(await fs.readFile(path.join(dir, 'state.json'), 'utf8')).queue.length; } catch { /* none */ }
    const stat = await fs.stat(path.join(dir, 'data.json'));
    const p = data.profile || {};
    return { screens: data.screens.length, steps: data.steps.length, queued, updated: stat.mtime.toISOString(),
      profile: { photo: !!p.photo, description: !!p.description, commands: (p.commands || []).length } };
  } catch { return null; }
}

export async function state(userId) {
  const w = ws(userId);
  return { running: !!w.task, task: w.task?.name || null, log: w.log.slice(-200), capture: await summary(userId), source: SOURCE_BOT };
}

// Empties the journal; a running task keeps going and writes on
export async function clearLog(userId) { ws(userId).log = []; return state(userId); }

// `botId` is optional: without it the style is made and no bot is touched
export async function apply(user, { botId = null, fresh = false } = {}) {
  const userId = Number(user.sub);
  const wanted = botId === null || botId === '' ? null : Number(botId);
  if (wanted !== null && !Number.isInteger(wanted)) throw bad('Pick a valid Telegram bot.');
  busy(userId);
  const bot = wanted === null ? null : await prisma.telegramBot.findUnique({ where: { id: wanted }, select: { id: true, username: true } });
  if (wanted !== null && !bot) throw bad('Bot not found.');
  await fs.mkdir(capturesOf(userId), { recursive: true });
  await fs.rm(stopFile(userId), { force: true });
  const args = ['src/tg/cli.js', 'explore', SOURCE_BOT, '--captures-dir', capturesOf(userId), '--stop-file', stopFile(userId),
    '--profile', PROFILE, '--max-actions', '20000', ...(fresh === true ? ['--fresh'] : [])];
  say(userId, `== Capture of @${SOURCE_BOT} up to the quantity selection, then the "${STYLE_NAME}" style is ${bot ? `applied to @${bot.username || bot.id}` : 'made (no bot picked)'}`);
  run(userId, 'capture', args, await childEnv(userId), async code => {
    if (code !== 0) { say(userId, '-- Capture incomplete: no style was applied.'); return; }
    const tenant = tenantOfStaff(user);
    run(userId, 'style', ['scripts/import-bot-capture.js', captureDir(userId), '--name', STYLE_NAME, ...(bot ? ['--apply-to', String(bot.id)] : []), '--refresh-bots'],
      { ...process.env, TENANT_ID: tenant ? String(tenant) : '' });
  });
  return state(userId);
}

// Stops after the current action; what was captured is kept
export async function stop(userId) {
  const { task } = ws(userId);
  if (task && !task.killTimer) {
    await fs.mkdir(capturesOf(userId), { recursive: true });
    if (task.name === 'capture') { await fs.writeFile(stopFile(userId), ''); say(userId, 'Stop requested: finishing the current action…'); }
    task.stopped = true;
    task.killTimer = setTimeout(() => task.child.kill(), task.name === 'capture' ? 20000 : 0);
  }
  return state(userId);
}
