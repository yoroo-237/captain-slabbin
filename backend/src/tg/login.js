// Telegram account of a capture profile: status, code, sign-in, sign-out. Every
// function answers with the object the dashboard expects (the old Python helpers' last line).
import fs from 'fs';
import path from 'path';
import { Api } from 'telegram';
import { computeCheck } from 'telegram/Password.js';
import { config, makeClient, requireConfig, sessionsDir, saveSession, dropSession, readSession, errName, rpcMessage, isFlood } from './client.js';

const mask = phone => { const d = String(phone || '').replace(/\D/g, ''); return d.length > 6 ? `+${d.slice(0, 2)} ••• ${d.slice(-4)}` : ''; };
const pendingFile = profile => path.join(sessionsDir(), `${profile}.login.json`);

async function connected(profile) {
  const { client, cfg } = makeClient(profile);
  await Promise.race([client.connect(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 20000))]);
  return { client, cfg };
}
const close = async client => { try { await client.destroy(); } catch { /* already closed */ } };

export async function status(profiles = []) {
  const cfg = config();
  fs.mkdirSync(sessionsDir(), { recursive: true });
  const names = [...new Set([...fs.readdirSync(sessionsDir()).filter(f => f.endsWith('.gram')).map(f => f.slice(0, -5)), ...profiles])].sort();
  const out = [];
  if (cfg.apiId && cfg.apiHash) {
    for (const name of names) {
      const info = { name, authorized: false };
      let digits = '';
      if (readSession(name)) {
        let client;
        try {
          ({ client } = await connected(name));
          if (await client.checkAuthorization()) {
            const me = await client.getMe();
            digits = me.phone || '';
            Object.assign(info, { authorized: true, first_name: me.firstName || '', username: me.username || '', phone: mask(me.phone) });
          }
        } catch (e) { info.error = /timeout/.test(e.message) ? 'Telegram injoignable (délai dépassé).' : `${errName(e)} : ${e.message}`; }
        if (client) await close(client);
      }
      const wanted = cfg.phone.replace(/\D/g, '');
      info.phone_matches = !wanted || !digits || digits === wanted;
      out.push(info);
    }
  }
  return { config: { file: '', exists: false, api: !!(cfg.apiId && cfg.apiHash), phone: mask(cfg.phone), bot: cfg.bot.replace(/^@/, '') },
    sessions_dir: sessionsDir(), profiles: out };
}

export async function sendCode(profile, phone) {
  let client;
  try {
    const cfg = requireConfig();
    phone = phone || cfg.phone;
    if (!phone) return { error: 'Phone number missing.' };
    ({ client } = await connected(profile));
    const sent = await client.sendCode({ apiId: cfg.apiId, apiHash: cfg.apiHash }, phone);
    saveSession(profile, client); // the auth key (and data centre) this code request belongs to
    fs.writeFileSync(pendingFile(profile), JSON.stringify({ phone, hash: sent.phoneCodeHash }), { mode: 0o600 });
    return { sent: true };
  } catch (e) { return loginError(e); } finally { if (client) await close(client); }
}

export async function signIn(profile, { code = '', password = '' } = {}) {
  let client;
  try {
    requireConfig();
    ({ client } = await connected(profile));
    if (!(await client.checkAuthorization())) {
      let pending;
      try { pending = JSON.parse(fs.readFileSync(pendingFile(profile), 'utf8')); } catch { return { error: 'Ask for a code first.' }; }
      let done = false;
      if (code) {
        try {
          await client.invoke(new Api.auth.SignIn({ phoneNumber: pending.phone, phoneCodeHash: pending.hash, phoneCode: String(code).trim() }));
          done = true;
        } catch (e) {
          if (rpcMessage(e) !== 'SESSION_PASSWORD_NEEDED') throw e;
          if (!password) return { need_password: true };
        }
      }
      if (!done) {
        if (!password) return { error: 'Type the code Telegram sent you.' };
        const pwd = await client.invoke(new Api.account.GetPassword());
        await client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pwd, password) }));
      }
    }
    const me = await client.getMe();
    saveSession(profile, client);
    fs.rmSync(pendingFile(profile), { force: true });
    return { ok: true, first_name: me.firstName || '', username: me.username || '' };
  } catch (e) { return loginError(e); } finally { if (client) await close(client); }
}

export async function logout(profile) {
  if (!readSession(profile)) return `Session « ${profile} » déjà déconnectée.`;
  let client;
  try {
    ({ client } = await connected(profile));
    if (await client.checkAuthorization()) await client.invoke(new Api.auth.LogOut());
  } catch { /* the session is dropped anyway */ } finally { if (client) await close(client); }
  dropSession(profile);
  return `Session « ${profile} » fermée.`;
}

function loginError(e) {
  const m = rpcMessage(e);
  if (m === 'PHONE_NUMBER_INVALID') return { error: 'Invalid number (international format, e.g. +33600000000).' };
  if (m === 'PHONE_CODE_INVALID') return { error: 'Wrong code.' };
  if (m === 'PHONE_CODE_EXPIRED') return { error: 'Code expired: ask for a new one.' };
  if (m === 'PASSWORD_HASH_INVALID') return { error: 'Wrong 2FA password.', need_password: true };
  if (isFlood(e)) return { error: `Telegram asks to wait ${e.seconds} s before trying again.` };
  if (/^Configuration manquante/.test(e.message)) return { error: e.message };
  return { error: `${errName(e)} : ${e.message}`.slice(0, 200) };
}
