// Bot captures on the bots platform: what tools/tg-explorer does on a PC, run by
// the server. One task at a time (an exploration, a sign-out or an import) whose
// output is streamed to the dashboard. Each staff member browses with their own
// Telegram account: their API keys (my.telegram.org) are kept on their account,
// their sessions in their own folder of the server's volume (TG_SESSIONS_DIR).
// Only admins reach any of this.
import crypto from 'crypto';
import fs from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import { prisma } from '../db.js';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = path.resolve(env.capture.toolDir || path.join(BACKEND, '..', 'tools', 'tg-explorer'));
const CAPTURES = path.resolve(env.capture.capturesDir || path.join(TOOL, 'captures'));
const SESSIONS = path.resolve(env.capture.sessionsDir || path.join(TOOL, 'sessions'));
const WINDOWS = process.platform === 'win32';
const VENV_PY = path.join(TOOL, '.venv', WINDOWS ? 'Scripts\\python.exe' : 'bin/python');
const PYTHON = env.capture.python || (existsSync(VENV_PY) ? VENV_PY : WINDOWS ? 'python' : 'python3');
const CHILD_ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1',
  TG_SESSIONS_DIR: SESSIONS, TG_CACHE_DIR: path.join(CAPTURES, '.cache'), PYTHONPYCACHEPREFIX: path.join(CAPTURES, '.cache', 'pycache') };
const STOP_FILE = path.join(CAPTURES, '.stop');
const IMAGE = /\.(jpe?g|png|webp|gif)$/i;
const IMPORTS = { style: 'import-bot-capture.js', products: 'import-products-from-capture.js' };
const BOT = /^[A-Za-z][A-Za-z0-9_]{2,63}$/;
const REGEX = /^[^\r\n]{0,200}$/;
const PROFILE = /^[\w-]{1,40}$/;
const STYLE = /^[\w .'-]{1,60}$/;
const PHONE = /^\+?[0-9 ]{6,20}$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4' };

const bad = msg => Object.assign(new Error(msg), { status: 400 });
const profileOf = p => { const v = String(p || 'explorer'); if (!PROFILE.test(v)) throw bad('Profil invalide.'); return v; };
export const normalizeBot = x => String(x).trim().replace(/^(https?:\/\/)?(t|telegram)\.me\//, '').split('?')[0].replace(/\/+$/, '').replace(/^@/, '');

// ---- the one running task ---------------------------------------------------
let task = null; // { name, child, killTimer }
const log = [];
const clients = new Set();

function emit(event, data) {
  if (event === 'line') { log.push(data); if (log.length > 3000) log.shift(); }
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
export const state = () => ({ running: !!task, name: task?.name || null });

function run(name, cmd, args, cwd, childEnv = CHILD_ENV) {
  if (task) throw Object.assign(new Error('Une tâche est déjà en cours.'), { status: 409 });
  emit('line', `$ ${[path.basename(cmd), ...args].join(' ')}`);
  const child = spawn(cmd, args, { cwd, env: childEnv, windowsHide: true });
  task = { name, child };
  // A chunk can end mid-line: keep the tail until the next one
  const feed = stream => {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      const parts = (rest + chunk).split(/\r?\n/);
      rest = parts.pop();
      parts.filter(Boolean).forEach(l => emit('line', l));
    });
    stream.on('end', () => { if (rest) emit('line', rest); rest = ''; });
  };
  feed(child.stdout);
  feed(child.stderr);
  const done = line => {
    if (task?.child !== child) return; // 'error' and 'close' can both fire
    clearTimeout(task.killTimer);
    emit('line', line); task = null; emit('state', state());
  };
  child.on('error', err => done(`Impossible de lancer : ${err.message}`));
  child.on('close', code => done(`-- terminé (code ${code})`));
  emit('state', state());
}

// The live output: what ran so far, then each new line (Server-Sent Events)
export function subscribe(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(`event: init\ndata: ${JSON.stringify({ state: state(), log })}\n\n`);
  clients.add(res);
  const beat = setInterval(() => res.write(': beat\n\n'), 25000); // keeps proxies from closing it
  req.on('close', () => { clearInterval(beat); clients.delete(res); });
}

// A short Python helper (status, sign-in): its last line is JSON
function pyJson(args, childEnv, input = '', timeoutMs = 60000) {
  return new Promise(resolve => {
    const child = spawn(PYTHON, args, { cwd: TOOL, env: childEnv, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.on('error', e => { clearTimeout(timer); resolve({ error: `Impossible de lancer ${PYTHON} : ${e.message}` }); });
    child.on('close', () => {
      clearTimeout(timer);
      const last = out.trim().split('\n').pop();
      let result;
      try { result = JSON.parse(last); } catch { result = { error: err.trim().split('\n').pop() || 'Le script a échoué.' }; }
      // The Telegram API keys are typed in the page here, not in a .env
      if (/^Configuration manquante/.test(result.error || '')) result.error = 'Entrez d’abord vos clés API Telegram (api_id et api_hash).';
      if (result.config) delete result.config.file; // the server's own paths are of no use in the page
      resolve(result);
    });
    child.stdin.end(input);
  });
}

// ---- each staff member's Telegram API keys ----------------------------------
// The api_hash is encrypted with a key derived from JWT_SECRET (a new secret
// means typing the keys again)
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
  if (!id && !hash) {
    await prisma.user.update({ where: { id: Number(userId) }, data: { tgApiId: null, tgApiHash: null } });
    return apiKeys(userId);
  }
  if (!/^\d{3,12}$/.test(id)) throw bad('api_id : un nombre (my.telegram.org, API development tools).');
  if (!/^[0-9a-f]{32}$/.test(hash)) throw bad('api_hash : 32 caractères (chiffres et lettres de a à f).');
  await prisma.user.update({ where: { id: Number(userId) }, data: { tgApiId: id, tgApiHash: seal(hash) } });
  return apiKeys(userId);
}

// What the Python scripts get for one staff member: their keys, their sessions
async function userEnv(userId) {
  const u = await keysOf(userId);
  const sessions = path.join(SESSIONS, `u${Number(userId)}`);
  await fs.mkdir(sessions, { recursive: true });
  const out = { ...CHILD_ENV, TG_SESSIONS_DIR: sessions };
  delete out.API_ID; delete out.API_HASH; delete out.PHONE;
  const hash = u?.tgApiId ? unseal(u.tgApiHash) : '';
  if (hash) Object.assign(out, { API_ID: u.tgApiId, API_HASH: hash });
  return out;
}

// ---- Telegram account (the user session that browses the bots) -------------
export async function account(userId, profile) {
  const a = await pyJson(['status.py', '--profile', profileOf(profile)], await userEnv(userId));
  delete a.sessions_dir;
  return a;
}

export async function sendCode(userId, profile, phone) {
  const p = String(phone || '').trim();
  if (!PHONE.test(p)) throw bad('Numéro invalide (format international, ex. +33600000000).');
  if (task) throw Object.assign(new Error('Une tâche est en cours : attendez sa fin.'), { status: 409 });
  return pyJson(['weblogin.py', 'send', '--profile', profileOf(profile), '--phone', p.replace(/ /g, '')], await userEnv(userId));
}

export async function signIn(userId, profile, { code, password } = {}) {
  if (task) throw Object.assign(new Error('Une tâche est en cours : attendez sa fin.'), { status: 409 });
  const secret = { code: String(code || '').replace(/\D/g, '').slice(0, 12), password: password ? String(password).slice(0, 256) : '' };
  return pyJson(['weblogin.py', 'code', '--profile', profileOf(profile)], await userEnv(userId), JSON.stringify(secret));
}

export async function signOut(userId, profile) {
  run('Déconnexion', PYTHON, ['-u', 'login.py', '--profile', profileOf(profile), '--logout'], TOOL, await userEnv(userId));
  return state();
}

// ---- explorations -----------------------------------------------------------
function exploreArgs(b) {
  const bots = (Array.isArray(b.bots) ? b.bots : []).map(normalizeBot);
  if (!bots.length || !bots.every(x => BOT.test(x))) throw bad('Noms de bots invalides.');
  const args = ['-u', 'explore.py', ...bots, '--captures-dir', CAPTURES, '--stop-file', STOP_FILE, '--profile', profileOf(b.profile)];
  const num = (key, flag, min, max, label) => {
    if (b[key] === undefined || b[key] === '') return;
    const n = Number(b[key]);
    if (!Number.isFinite(n) || n < min || n > max) throw bad(`${label} : entre ${min} et ${max}.`);
    args.push(flag, String(n));
  };
  num('wait', '--wait', 0.5, 60, 'Attente');
  num('maxActions', '--max-actions', 1, 20000, 'Actions max');
  for (const [key, flag] of [['skip', '--skip'], ['allow', '--allow']]) {
    for (const v of String(b[key] || '').split('\n').map(s => s.trim()).filter(Boolean)) {
      if (!REGEX.test(v)) throw bad(`${key} invalide.`);
      args.push(flag, v);
    }
  }
  for (const [key, flag] of [['fresh', '--fresh'], ['noMedia', '--no-media'], ['noCommands', '--no-commands'], ['strict', '--strict']]) if (b[key]) args.push(flag);
  return args;
}

export async function explore(userId, body) {
  const args = exploreArgs(body);
  await fs.mkdir(CAPTURES, { recursive: true });
  await fs.rm(STOP_FILE, { force: true });
  run('Exploration', PYTHON, args, TOOL, await userEnv(userId));
  return state();
}

// explore.py stops after the current action and writes the capture; a hard kill
// would lose everything since its last save
export async function stop() {
  if (task && !task.killTimer) {
    const { child } = task;
    if (task.name === 'Exploration') {
      await fs.mkdir(CAPTURES, { recursive: true });
      await fs.writeFile(STOP_FILE, '');
      emit('line', "Arrêt demandé : fin de l'action en cours…");
    }
    task.killTimer = setTimeout(() => child.kill(), task.name === 'Exploration' ? 20000 : 0);
  }
  return state();
}

// ---- captures ---------------------------------------------------------------
const captureDir = bot => {
  if (!BOT.test(String(bot))) throw bad('Capture invalide.');
  return path.join(CAPTURES, String(bot).toLowerCase());
};

export async function listCaptures() {
  let names = [];
  try { names = await fs.readdir(CAPTURES); } catch { return []; }
  const out = [];
  for (const name of names.sort()) {
    const dir = path.join(CAPTURES, name);
    try {
      const data = JSON.parse(await fs.readFile(path.join(dir, 'data.json'), 'utf8'));
      const media = await fs.readdir(path.join(dir, 'media')).catch(() => []);
      const stat = await fs.stat(path.join(dir, 'data.json'));
      let queued = 0;
      try { queued = JSON.parse(await fs.readFile(path.join(dir, 'state.json'), 'utf8')).queue.length; } catch { /* no state */ }
      out.push({ name, screens: data.screens.length, steps: data.steps.length, images: media.length,
        ignored: (data.ignored || []).length, queued, cover: media.find(m => IMAGE.test(m) || !path.extname(m)) || null, updated: stat.mtime.toISOString() });
    } catch { /* not a capture */ }
  }
  return out;
}

export async function removeCapture(bot) {
  if (task) throw Object.assign(new Error('Une tâche est en cours : attendez sa fin.'), { status: 409 });
  await fs.rm(captureDir(bot), { recursive: true, force: true });
}

// Style: the information pages and pictures go into an existing style (its shelves,
// texts and checkout are kept); no style name = a new "Imported bot" style.
// Products: into a catalog (`source`), matched by name, images uploaded once.
export async function importCapture({ bot, kind, dry, style, catalog }) {
  if (!IMPORTS[kind]) throw bad('Import invalide.');
  const dir = captureDir(bot);
  await fs.access(path.join(dir, 'data.json')).catch(() => { throw bad('Capture introuvable.'); });
  const extra = [];
  if (kind === 'style') {
    const s = String(style || '').trim();
    if (s && !STYLE.test(s)) throw bad('Nom de style invalide.');
    if (s) extra.push('--merge-into', s);
  } else {
    const source = String(catalog || bot).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
    if (!source) throw bad('Catalogue invalide.');
    extra.push('--source', source);
  }
  run(`Import ${kind === 'style' ? 'du style' : 'des produits'}`, process.execPath,
    [path.join('scripts', IMPORTS[kind]), dir, ...extra, ...(dry === false ? [] : ['--dry'])], BACKEND);
  return state();
}

// ---- capture files (report, images) -----------------------------------------
// <img> and report links cannot send the admin's token: they carry a signed key
// in the path instead, valid a few hours, so the report's relative links work too
const sign = exp => crypto.createHmac('sha256', env.jwtSecret).update(`capture-files:${exp}`).digest('base64url').slice(0, 32);
export function filesKey() {
  const exp = Math.floor(Date.now() / 1000) + 6 * 3600;
  return `${exp}.${sign(exp)}`;
}
export function checkFilesKey(key) {
  const [exp, sig] = String(key || '').split('.');
  if (!/^\d+$/.test(exp || '') || Number(exp) < Date.now() / 1000) return false;
  const want = Buffer.from(sign(exp));
  const got = Buffer.from(String(sig || ''));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export async function sendFile(res, rel) {
  const file = path.resolve(CAPTURES, rel);
  if (!file.startsWith(CAPTURES + path.sep) || /[\\/]\.(cache|stop)/.test(file.slice(CAPTURES.length))) { res.status(403); return res.end(); }
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
    // Captured media have no extension: sniff the common image types
    let type = TYPES[path.extname(file).toLowerCase()];
    if (!type) {
      const head = Buffer.alloc(12);
      const fh = await fs.open(file, 'r');
      await fh.read(head, 0, 12, 0);
      await fh.close();
      type = head[0] === 0xff ? 'image/jpeg' : head.toString('latin1', 1, 4) === 'PNG' ? 'image/png'
        : head.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : 'application/octet-stream';
    }
    res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'cache-control': 'private, max-age=600',
      // The report is the bot's own content: it may show, never run script against this origin
      'content-security-policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' });
    createReadStream(file).pipe(res);
  } catch { res.status(404).end('Introuvable'); }
}
