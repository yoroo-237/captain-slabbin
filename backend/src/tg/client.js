// Telegram user client for the bot captures (GramJS). Replaces tools/tg-explorer's
// Python/Telethon: same keys (API_ID, API_HASH), one session per profile, kept as a
// string in <TG_SESSIONS_DIR>/<profile>.gram (a secret: it is being logged in).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const sessionsDir = () => path.resolve(process.env.TG_SESSIONS_DIR || path.join(BACKEND, 'data', 'sessions'));
export const sessionFile = profile => path.join(sessionsDir(), `${profile}.gram`);

export function config() {
  return { apiId: String(process.env.API_ID || '').trim(), apiHash: String(process.env.API_HASH || '').trim(),
    phone: String(process.env.PHONE || '').trim(), bot: String(process.env.BOT_USERNAME || '').trim() };
}

export function requireConfig() {
  const c = config();
  if (!c.apiId || !c.apiHash) throw new Error('Configuration manquante : API_ID, API_HASH');
  if (!/^\d+$/.test(c.apiId)) throw new Error('Configuration manquante : API_ID (doit être un nombre)');
  return { ...c, apiId: Number(c.apiId) };
}

export function readSession(profile) {
  try { return fs.readFileSync(sessionFile(profile), 'utf8').trim(); } catch { return ''; }
}
export function saveSession(profile, client) {
  fs.mkdirSync(sessionsDir(), { recursive: true });
  fs.writeFileSync(sessionFile(profile), client.session.save(), { mode: 0o600 });
}
export const dropSession = profile => fs.rmSync(sessionFile(profile), { force: true });

export function makeClient(profile, options = {}) {
  const c = requireConfig();
  const client = new TelegramClient(new StringSession(readSession(profile)), c.apiId, c.apiHash,
    { connectionRetries: 10, retryDelay: 5000, ...options });
  // GramJS logs every connection detail by default: errors only
  client.setLogLevel?.('error');
  return { client, cfg: c };
}

export const normalizeBot = name => String(name).trim().replace(/^https?:\/\//, '').replace(/^(t|telegram)\.me\//, '')
  .split('?')[0].replace(/^\/+|\/+$/g, '').replace(/^@/, '');

// ---- errors: Telethon's names, so captures keep the same `error` values ------
export const rpcMessage = e => String(e?.errorMessage || '');
export const isFlood = e => typeof e?.seconds === 'number' && /FLOOD/.test(rpcMessage(e));
export const isRpc = e => !!rpcMessage(e);
export function errName(e) {
  if (isFlood(e)) return 'FloodWaitError';
  const m = rpcMessage(e);
  if (m) return `${m.toLowerCase().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}Error`;
  return e?.constructor?.name || 'Error';
}
const NET = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH'];
export const isNet = e => !isRpc(e) && (NET.includes(e?.code) || /connection|socket|network|not connected|timed? ?out/i.test(String(e?.message || '')));
