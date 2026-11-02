// How a capture (tools/tg-explorer data.json) maps onto a replica style: which
// screens are kept, the page key of each screen, the screen each button opens.
// Shared by the import (scripts/import-bot-capture.js) and the fidelity check
// (captureCheck.js), so both see the same pages.
import { cmdName } from './telegramCommands.js';

// Anti-phishing screens ("your secret phrase…") hold the capturing account's own
// secret: never copied, every customer of the replica would see it
export const PERSONAL = /secret phrase|phrase secr[eè]te|scam ?bot|phishing/i;
export const keptScreens = captured => captured.filter(s => !PERSONAL.test(s.raw || s.html || ''));

export const isBack = b => /⇇|⇆|^\W*back\b/i.test(b.text) || /^\/back_/.test(b.data || '');
export const commandOf = s => (s.sources || []).find(x => x.startsWith('/'));
// Text a customer types (a reply-keyboard button) that opens a screen
export const typedOf = s => (s.sources || []).filter(x => !x.startsWith('/') && !x.startsWith('['));
// The label a step of the capture carries for this button: [text], or the typed text
export const stepLabel = b => (b.kind === 'keyboard' ? b.text : `[${b.text}]`);

// Page keys: the command that opens the screen, else s_<screen key>; unique, 32 chars max
export function pageKeys(screens) {
  const keyOf = new Map();
  const used = new Set();
  for (const s of [...screens].sort((a, b) => a.order - b.order)) {
    const cmd = commandOf(s);
    let key = (cmd && cmdName(cmd)) || `s_${s.key.slice(0, 10)}`;
    for (let i = 2; used.has(key); i++) key = `${key.slice(0, 29)}_${i}`;
    used.add(key);
    keyOf.set(s.key, key);
  }
  return keyOf;
}

// The screen a button opens: the nearest later screen that was reached by clicking
// a button with that label ([label]), or by sending its text (reply keyboard)
export function targetOf(screens, screen, button) {
  const label = stepLabel(button);
  const later = screens.filter(s => s.order > screen.order && (s.sources || []).includes(label));
  return later.sort((a, b) => a.order - b.order)[0] || null;
}
