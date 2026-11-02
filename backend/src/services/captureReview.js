// Personal / sensitive information found in a capture that the user will likely want
// to review and replace before the replica goes live: the capture account's own
// secret phrase, phone numbers, emails, @handles, t.me links, crypto addresses, PGP
// blocks and the original owner's name. Detection only — nothing is changed; the
// import stores the list as look.review and the editor shows it for the user to update.

import { PERSONAL } from './captureMap.js';

// Each detector: a label, a regex (global), and a one-line suggestion. Order matters —
// emails are matched before @handles so a handle detector does not split an email.
const DETECTORS = [
  { kind: 'pgp', suggestion: 'Replace with your own PGP key, or remove it.', re: /-----BEGIN PGP (?:PUBLIC KEY BLOCK|MESSAGE|SIGNATURE)-----/g },
  { kind: 'email', suggestion: 'Replace with your own contact, or remove it.', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'tme', suggestion: 'Point it at your own channel or support.', re: /\bt\.me\/[A-Za-z0-9_+/?=&%.-]+/g },
  { kind: 'btc', suggestion: 'Payments go through your wallet — remove this address.', re: /\b(?:bc1[ac-hj-np-z02-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g },
  { kind: 'eth', suggestion: 'Payments go through your wallet — remove this address.', re: /\b0x[a-fA-F0-9]{40}\b/g },
  { kind: 'ltc', suggestion: 'Payments go through your wallet — remove this address.', re: /\b(?:ltc1[ac-hj-np-z02-9]{25,62}|[LM][a-km-zA-HJ-NP-Z1-9]{26,33})\b/g },
  { kind: 'xmr', suggestion: 'Payments go through your wallet — remove this address.', re: /\b4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}\b/g },
  { kind: 'doge', suggestion: 'Payments go through your wallet — remove this address.', re: /\bD[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}\b/g },
  { kind: 'phone', suggestion: 'Replace with your own number, or remove it.', re: /(?<!\d)(?:\+\d[\d\s().-]{7,}\d|\(\d{2,4}\)\s?[\d\s().-]{6,}\d)(?!\d)/g },
  { kind: 'handle', suggestion: 'Replace with your own @username or support.', re: /(?<![\w@/.])@[A-Za-z][A-Za-z0-9_]{3,31}\b/g },
];

// Scan one piece of text; returns [{ kind, value, suggestion }], values trimmed and capped
export function scanText(text) {
  const s = String(text || '');
  const out = [];
  if (PERSONAL.test(s)) out.push({ kind: 'secret', value: '(anti-phishing / secret-phrase screen)', suggestion: "This is the capture account's own secret — set your own, it is left out of the replica." });
  for (const d of DETECTORS) {
    const m = s.match(d.re);
    if (m) for (const v of m) out.push({ kind: d.kind, value: v.trim().slice(0, 120), suggestion: d.suggestion });
  }
  return out;
}

// Review list for a whole capture: the profile and every screen. Deduplicated by
// kind+value, each entry says where it was first seen. Capped so the list stays usable.
export function reviewCapture({ screens = [], profile = {} } = {}, { cap = 80 } = {}) {
  const seen = new Set();
  const review = [];
  const add = (where, hits) => {
    for (const h of hits) {
      const id = `${h.kind}:${h.value}`;
      if (seen.has(id)) continue;
      seen.add(id);
      review.push({ where, ...h });
      if (review.length >= cap) return true;
    }
    return false;
  };

  // The original owner's name is the thing to change first
  if (profile.name) add('profile.name', [{ kind: 'ownerName', value: String(profile.name).slice(0, 120), suggestion: 'This is the original bot name — set your own.' }]);
  for (const [field, text] of [['profile.about', profile.about], ['profile.description', profile.description]]) {
    if (add(field, scanText(text))) return review;
  }
  for (const s of screens) {
    if (add(s.key || s.order || 'screen', scanText(s.raw || s.html))) return review;
  }
  return review;
}
