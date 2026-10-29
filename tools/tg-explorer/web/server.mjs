// Local server of the capture UI: starts explore.py / login.py / the backend imports
// and streams their output. Listens on 127.0.0.1 only; it drives a personal Telegram session.
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.resolve(HERE, '..');
const BACKEND = path.resolve(TOOL, '..', '..', 'backend');
const DIST = path.join(HERE, 'ui', 'dist');
const PORT = Number(process.env.PORT) || 5174;
const WINDOWS = process.platform === 'win32';
const CACHE = path.join(TOOL, '.cache');
// The tool's own Python env (created by lancer.bat / lancer.sh), else the system one
const VENV_PY = path.join(TOOL, '.venv', WINDOWS ? 'Scripts\\python.exe' : 'bin/python');
const PYTHON = process.env.PYTHON || (existsSync(VENV_PY) ? VENV_PY : WINDOWS ? 'python' : 'python3');
const CAPTURES = path.resolve(process.env.CAPTURES_DIR || path.join(TOOL, 'captures'));
// Children keep their caches inside the tool folder too
const CHILD_ENV = { ...process.env, PYTHON, PYTHONIOENCODING: 'utf-8', PYTHONPYCACHEPREFIX: path.join(CACHE, 'pycache'),
  PIP_CACHE_DIR: path.join(CACHE, 'pip'), npm_config_cache: path.join(CACHE, 'npm') };
const STOP_FILE = path.join(CAPTURES, '.stop');
const IMAGE = /\.(jpe?g|png|webp|gif)$/i;
const IMPORTS = { style: 'import-bot-capture.js', products: 'import-products-from-capture.js' };
const BOT = /^[A-Za-z][A-Za-z0-9_]{2,63}$/;
const REGEX = /^[^\r\n]{0,200}$/;
const PROFILE = /^[\w-]{1,40}$/;
const STYLE = /^[\w .'-]{1,60}$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon' };

// ---- the one running task ---------------------------------------------------
let task = null; // { name, child }
const log = [];
const clients = new Set();

function emit(event, data) {
  if (event === 'line') { log.push(data); if (log.length > 3000) log.shift(); }
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
const state = () => ({ running: !!task, name: task?.name || null });

function run(name, cmd, args, cwd) {
  if (task) throw Object.assign(new Error('Une tâche est déjà en cours.'), { status: 409 });
  emit('line', `$ ${[cmd, ...args].join(' ')}`);
  const child = spawn(cmd, args, { cwd, env: CHILD_ENV, windowsHide: true });
  task = { name, child };
  // A chunk can end mid-line: keep the tail until the next one
  const feed = (stream) => {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      const parts = (rest + chunk).split(/\r?\n/);
      rest = parts.pop();
      parts.filter(Boolean).forEach((l) => emit('line', l));
    });
    stream.on('end', () => { if (rest) emit('line', rest); rest = ''; });
  };
  feed(child.stdout);
  feed(child.stderr);
  const done = (line) => {
    if (task?.child !== child) return; // 'error' and 'close' can both fire
    clearTimeout(task.killTimer);
    emit('line', line); task = null; emit('state', state());
  };
  child.on('error', (err) => done(`Impossible de lancer : ${err.message}`));
  child.on('close', (code) => done(`-- terminé (code ${code})`));
  emit('state', state());
}

// ---- account ----------------------------------------------------------------
// status.py reads the same .env / sessions as explore.py and login.py (through a copy
// of the session, so it can run while they use it): the page shows what they will use.
function readAccount(profile) {
  return new Promise((resolve) => {
    const args = ['status.py', ...(profile ? ['--profile', profile] : [])];
    const child = spawn(PYTHON, args, { cwd: TOOL, env: CHILD_ENV, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 60000);
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: `Impossible de lancer ${PYTHON} : ${e.message}` }); });
    child.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out)); } catch { resolve({ error: (err.trim().split('\n').pop() || 'status.py a échoué.') }); }
    });
  });
}

// ---- captures ---------------------------------------------------------------
async function listCaptures() {
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
        ignored: (data.ignored || []).length, queued, cover: media.find((m) => IMAGE.test(m)) || null, updated: stat.mtime.toISOString() });
    } catch { /* not a capture */ }
  }
  return out;
}

// ---- http -------------------------------------------------------------------
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (c) => {
    raw += c;
    if (raw.length > 1e5) { reject(Object.assign(new Error('Requête trop grande.'), { status: 413 })); req.destroy(); }
  });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(Object.assign(e, { status: 400 })); } });
});
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

function exploreArgs(b) {
  const bots = (Array.isArray(b.bots) ? b.bots : [])
    .map((x) => String(x).trim().replace(/^(https?:\/\/)?(t|telegram)\.me\//, '').split('?')[0].replace(/\/+$/, '').replace(/^@/, ''));
  if (!bots.length || !bots.every((x) => BOT.test(x))) throw bad('Noms de bots invalides.');
  const args = ['-u', 'explore.py', ...bots, '--captures-dir', CAPTURES, '--stop-file', STOP_FILE];
  const num = (key, flag, min, max, label) => {
    if (b[key] === undefined || b[key] === '') return;
    const n = Number(b[key]);
    if (!Number.isFinite(n) || n < min || n > max) throw bad(`${label} : entre ${min} et ${max}.`);
    args.push(flag, String(n));
  };
  num('wait', '--wait', 0.5, 60, 'Attente');
  num('maxActions', '--max-actions', 1, 20000, 'Actions max');
  if (b.profile) { if (!PROFILE.test(b.profile)) throw bad('Profil invalide.'); args.push('--profile', b.profile); }
  for (const [key, flag] of [['skip', '--skip'], ['allow', '--allow']]) {
    for (const v of String(b[key] || '').split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (!REGEX.test(v)) throw bad(`${key} invalide.`);
      args.push(flag, v);
    }
  }
  for (const [key, flag] of [['fresh', '--fresh'], ['noMedia', '--no-media'], ['noCommands', '--no-commands'], ['strict', '--strict']]) if (b[key]) args.push(flag);
  return args;
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/captures') return json(res, 200, await listCaptures());
  if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, state());
  if (req.method === 'GET' && url.pathname === '/api/account') {
    const profile = url.searchParams.get('profile');
    if (profile && !PROFILE.test(profile)) throw bad('Profil invalide.');
    return json(res, 200, await readAccount(profile));
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: init\ndata: ${JSON.stringify({ state: state(), log })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method !== 'POST') return json(res, 404, { error: 'Introuvable' });
  const body = await readBody(req);
  if (url.pathname === '/api/explore') { run('Exploration', PYTHON, exploreArgs(body), TOOL); return json(res, 202, state()); }
  if (url.pathname === '/api/stop') {
    if (task && !task.killTimer) {
      // explore.py stops after the current action and writes the capture; a hard kill
      // (the only option on Windows) would lose everything since the last save
      const { child } = task;
      if (task.name === 'Exploration') {
        await fs.mkdir(CAPTURES, { recursive: true });
        await fs.writeFile(STOP_FILE, '');
        emit('line', "Arrêt demandé : fin de l'action en cours…");
      }
      task.killTimer = setTimeout(() => child.kill(), task.name === 'Exploration' ? 20000 : 0);
    }
    return json(res, 200, state());
  }
  if (url.pathname === '/api/login') {
    // Needs a real console to type the Telegram code. connexion.bat is called by a
    // relative name (cwd = TOOL) and finds Python itself: no path to quote for cmd.exe,
    // whatever folder the tool was copied to.
    const profile = body.profile && PROFILE.test(body.profile) ? body.profile : 'explorer';
    if (!WINDOWS) {
      throw bad(`Ouvrez un terminal dans ${TOOL} et lancez : ${PYTHON} login.py --profile ${profile}`);
    }
    spawn('cmd.exe', ['/c', 'start', 'Connexion Telegram', 'cmd', '/k', 'connexion.bat', profile],
      { cwd: TOOL, env: CHILD_ENV, detached: true, stdio: 'ignore' }).unref();
    return json(res, 202, { ok: true });
  }
  if (url.pathname === '/api/logout') {
    if (!PROFILE.test(String(body.profile))) throw bad('Profil invalide.');
    run('Déconnexion', PYTHON, ['-u', 'login.py', '--profile', body.profile, '--logout'], TOOL);
    return json(res, 202, state());
  }
  if (url.pathname === '/api/import') {
    if (!IMPORTS[body.kind] || !BOT.test(String(body.bot))) throw bad('Import invalide.');
    const dir = path.join(CAPTURES, body.bot.toLowerCase());
    await fs.access(path.join(dir, 'data.json')).catch(() => { throw bad('Capture introuvable.'); });
    // Style: the information pages and pictures go into an existing style (its shelves,
    // texts and checkout are kept); no style name = a new "Imported bot" style
    const style = String(body.style || '').trim();
    if (style && !STYLE.test(style)) throw bad('Nom de style invalide.');
    const extra = body.kind === 'style' && style ? ['--merge-into', style] : [];
    run(`Import ${body.kind}`, 'node', [path.join('scripts', IMPORTS[body.kind]), dir, ...extra, ...(body.dry === false ? [] : ['--dry'])], BACKEND);
    return json(res, 202, state());
  }
  return json(res, 404, { error: 'Introuvable' });
}

async function serveFile(res, root, rel) {
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
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
    res.writeHead(200, { 'content-type': type, 'content-length': stat.size });
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404); res.end('Introuvable'); }
}

const server = http.createServer(async (req, res) => {
  try {
    // Only this machine's own pages may call the API (DNS-rebinding / cross-site guard)
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (host !== '127.0.0.1' && host !== 'localhost') { res.writeHead(403); return res.end(); }
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) { res.writeHead(403); return res.end(); }

    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/')) return await api(req, res, url);
    if (pathname.startsWith('/captures/')) return await serveFile(res, CAPTURES, pathname.slice('/captures/'.length));
    if (!(await fs.stat(DIST).catch(() => null))) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end("L'interface n'est pas construite : lancez « npm run build » dans tools/tg-explorer/web.");
    }
    const exists = await fs.stat(path.join(DIST, pathname)).then((s) => s.isFile()).catch(() => false);
    return await serveFile(res, DIST, exists ? pathname.slice(1) : 'index.html');
  } catch (err) {
    json(res, err.status || 500, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Capture de bots : http://127.0.0.1:${PORT}  (captures : ${CAPTURES})`));
