import * as openpgp from 'openpgp';
import { appError } from '../utils/formatters.js';

// PGP public keys that customers encrypt their shipping address to: the website's
// (setting pgp_public_key) and each bot's own (TelegramBot.pgpKey). Only public
// keys are ever stored: the shop decrypts with its private key, outside the site.

// A pasted public key, checked and normalized; '' clears it
export async function readPublicKey(text) {
  const armored = String(text || '').trim();
  if (!armored) return { armored: '', fingerprint: null };
  if (/PRIVATE KEY BLOCK/.test(armored)) {
    throw appError('This is a PRIVATE key: never paste it here. Paste the PUBLIC key (it starts with -----BEGIN PGP PUBLIC KEY BLOCK-----).', 400);
  }
  let key;
  try { key = await openpgp.readKey({ armoredKey: armored }); }
  catch { throw appError('This is not a valid PGP public key. Paste the whole block, from -----BEGIN PGP PUBLIC KEY BLOCK----- to -----END PGP PUBLIC KEY BLOCK-----.', 400); }
  if (key.isPrivate()) throw appError('This is a PRIVATE key: paste the PUBLIC key instead.', 400);
  try { await key.getEncryptionKey(); }
  catch { throw appError('This key cannot encrypt (it is expired, revoked or has no encryption subkey).', 400); }
  return { armored: key.armor().trim(), fingerprint: fingerprintOf(key) };
}

// "ABCD 1234 …" for the admin to compare with their own copy; null if unreadable
export async function keyFingerprint(armored) {
  if (!armored) return null;
  try { return fingerprintOf(await openpgp.readKey({ armoredKey: armored })); } catch { return null; }
}

const fingerprintOf = key => key.getFingerprint().toUpperCase().match(/.{1,4}/g).join(' ');

// A whole ASCII-armored PGP message
// (header lines such as "Version: …" allowed, then base64 and its checksum)
export function isPgpMessage(t) {
  const m = String(t || '').trim().match(/^-----BEGIN PGP MESSAGE-----([\s\S]+)-----END PGP MESSAGE-----$/);
  if (!m) return false;
  const body = m[1].split(/\r?\n/).filter(l => !/^[\w-]+:\s/.test(l)).join('').replace(/\s+/g, '');
  return body.length >= 40 && /^[A-Za-z0-9+/]+=*(=[A-Za-z0-9+/]{4})?$/.test(body);
}
