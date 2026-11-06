// Walks a Telegram bot with a user account and records its screens (texts, buttons,
// pictures). Port of tools/tg-explorer/explore.py, run by the backend itself: same
// files (data.json, check.json, state.json, media/, report.html), so captures made
// by the Python tool are resumed as they are.
//
// The walk goes down every button, keyboard text and command it finds, EXCEPT past the
// quantity screen of a product (the +/- screen where an amount is chosen): the capture
// stops there. Whatever follows (changing the quantity, add to cart, checkout…) is
// added by hand, as routes picked or typed in the check (--retry): those are played, and
// what they open is recorded, but the walk does not go further on its own.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Api } from 'telegram';
import { checkCapture } from '../services/captureCheck.js';
import { errName, isFlood, isNet, isRpc, rpcMessage } from './client.js';
import { profileOf } from './profiles.js';

// What is skipped, what counts as the quantity screen and what is typed to a question
// come from the bot's own profile (profiles.js): two bots, two independent rule sets.
// By default only what destroys or empties something is skipped; a purchase, payment,
// cart or checkout is played (the account has no linked card); --strict narrows.
const COMMAND = /(?<![\w/])\/[A-Za-z][A-Za-z0-9_]{0,31}/g;
// A way back leads to a screen already seen: each back label is played once
const BACK = /^\W*(⇇|⇆|<<?\s*back\b|back\b)/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
const SAVE_EVERY = 10;
const RECONNECT_TRIES = 20, RECONNECT_WAIT = 30; // seconds between two tries when the network is down
// An action that never ends is dropped after this delay: the capture goes on
const STEP_TIMEOUT = 120;

const sleep = s => new Promise(r => setTimeout(r, s * 1000));
const b64 = buf => Buffer.from(buf).toString('base64');
const txt = v => (typeof v === 'string' ? v : v?.text || '');
const norm = label => String(label || '').trim().replace(/\d+(?:[.,]\d+)?/g, '#');
const sha12 = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const kindOf = k => k?.className || '';

// JSON the way Python writes it (", " and ": "): screen keys stay the same as the
// Python tool's, so a resumed capture does not see its screens twice
function pyDumps(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(pyDumps).join(', ')}]`;
  if (typeof v === 'object') return `{${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}: ${pyDumps(x)}`).join(', ')}}`;
  return String(v);
}

class RouteLost extends Error {}

const labelOf = a => (a[0] === 'cb' || a[0] === 'goto' ? `[${a[3]}]` : a[1]);
const same = (a, b) => !!a && !!b && Buffer.compare(a, b) === 0;

// The message's text as Telegram HTML (bold, italic, links…) from its entities
export function toHtml(text, entities) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tags = [];
  for (const e of entities || []) {
    if (!e.length) continue;
    let open = null, close = null;
    switch (e.className) {
      case 'MessageEntityBold': open = '<b>'; close = '</b>'; break;
      case 'MessageEntityItalic': open = '<i>'; close = '</i>'; break;
      case 'MessageEntityUnderline': open = '<u>'; close = '</u>'; break;
      case 'MessageEntityStrike': open = '<s>'; close = '</s>'; break;
      case 'MessageEntityBlockquote': open = '<blockquote>'; close = '</blockquote>'; break;
      case 'MessageEntityCode': open = '<code>'; close = '</code>'; break;
      case 'MessageEntityPre': open = e.language ? `<pre><code class="language-${esc(e.language)}">` : '<pre>'; close = e.language ? '</code></pre>' : '</pre>'; break;
      case 'MessageEntityTextUrl': open = `<a href="${String(e.url).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`; close = '</a>'; break;
      case 'MessageEntityMentionName': open = `<a href="tg://user?id=${e.userId}">`; close = '</a>'; break;
      case 'MessageEntitySpoiler': open = '<tg-spoiler>'; close = '</tg-spoiler>'; break;
      case 'MessageEntityCustomEmoji': open = `<tg-emoji emoji-id="${e.documentId}">`; close = '</tg-emoji>'; break;
      default: continue;
    }
    tags.push({ start: e.offset, end: e.offset + e.length, open, close });
  }
  let out = '';
  for (let i = 0; i <= text.length; i++) {
    // Closings first (innermost first), then openings (outermost first)
    for (const t of tags.filter(x => x.end === i).sort((a, b) => b.start - a.start)) out += t.close;
    for (const t of tags.filter(x => x.start === i).sort((a, b) => b.end - a.end)) out += t.open;
    if (i < text.length) out += esc(text[i]);
  }
  return out;
}

function sniffExt(buf, doc) {
  const h = buf.subarray(0, 16);
  if (h[0] === 0xff && h[1] === 0xd8) return '.jpg';
  if (h.toString('latin1', 1, 4) === 'PNG') return '.png';
  if (h.toString('latin1', 0, 3) === 'GIF') return '.gif';
  if (h.toString('latin1', 0, 4) === 'RIFF' && h.toString('latin1', 8, 12) === 'WEBP') return '.webp';
  if (h.toString('latin1', 4, 8) === 'ftyp') return '.mp4';
  if (h[0] === 0x1a && h[1] === 0x45) return '.webm';
  if (h.toString('latin1', 0, 4) === 'OggS') return '.oga';
  if (h.toString('latin1', 0, 4) === '%PDF') return '.pdf';
  if (h.toString('latin1', 0, 3) === 'ID3') return '.mp3';
  if (h[0] === 0x1f && h[1] === 0x8b) return '.tgs';
  const name = (doc?.attributes || []).find(a => a.className === 'DocumentAttributeFilename')?.fileName || '';
  return path.extname(name);
}

export class Explorer {
  constructor(client, peer, out, args) {
    Object.assign(this, { client, peer, out, args });
    this.rules = profileOf(args.bot); // throws for any other bot: no fallback
    const parts = args.noDefaultSkip ? [] : [args.strict ? this.rules.skipStrict : this.rules.skip];
    parts.push(...args.skip);
    this.skip = parts.length ? new RegExp(parts.join('|'), 'i') : null;
    this.allow = args.allow.length ? new RegExp(args.allow.join('|'), 'i') : null;
    this.mediaDir = path.join(out, 'media');
    if (!args.noMedia) fs.mkdirSync(this.mediaDir, { recursive: true });
    this.screens = new Map();
    this.steps = [];
    this.ignored = [];
    this.queue = [];
    this.seen = new Set();       // JSON of [kind, value] or ["btn", screen, label]
    this.perPrefix = {};
    this.mediaCache = {};
    this.lastId = 0;
    this.profile = {};
    this.buttonScreen = {};      // a button's data (base64) → the screen (up to its numbers) that carries it
    this.answered = new Set();
    this.retried = new Set();
    this.joined = [];
    this.inline = null;
    this.labelResults = {};
    this.skippedKnown = 0;
    this.paths = {};
    this.origin = {};
    this.templates = new Set();
    this.manual = new WeakSet(); // actions added by hand: played, never followed
    this.token = 0;
  }

  log(...a) { console.log(...a); }
  stopRequested() { return !!this.args.stopFile && fs.existsSync(this.args.stopFile); }
  seenKey(...k) { return JSON.stringify(k); }
  isSkipped(label) { return !!this.skip && this.skip.test(label || '') && !(this.allow && this.allow.test(label)); }

  // ---- action queue ---------------------------------------------------
  enqueue(action) {
    const kind = action[0];
    let key = kind === 'cb' ? this.seenKey('cb', action[2]) : this.seenKey('send', action[1]);
    const label = kind === 'cb' ? action[action.length - 1] : action[1];
    if (this.seen.has(key)) return;
    // Quantity tiers and what follows them: played by hand only, never by the walk
    if (this.rules.manual?.test(label || '')) { this.seen.add(key); return; }
    if (kind === 'cb') {
      // The same button on the same screen (new data at each display): once
      const btn = this.seenKey('btn', this.buttonScreen[action[2]] ?? null, norm(label));
      if (this.seen.has(btn)) return;
      this.seen.add(btn);
      // A button found everywhere that already led twice to the same screen will again
      const known = this.labelResults[norm(label)];
      if (known && known.played >= 2 && known.screens.length === 1) { this.skippedKnown++; return; }
      if (BACK.test(label || '')) {
        const back = this.seenKey('back', label.trim());
        if (this.seen.has(back)) return;
        key = back;
      }
    }
    // A "✅" button can hide confirm_order: its data is filtered too
    const tested = kind === 'cb' ? `${label} ${Buffer.from(action[2], 'base64').toString('utf8')}` : label;
    if (this.isSkipped(tested)) { this.seen.add(key); this.ignored.push(label); return; }
    if (kind === 'cmd') {
      if (this.args.noCommands) return;
      const prefix = action[1].replace(/\d+$/, '');
      if (this.args.maxPerPrefix && (this.perPrefix[prefix] || 0) >= this.args.maxPerPrefix) return;
      this.perPrefix[prefix] = (this.perPrefix[prefix] || 0) + 1;
    }
    this.seen.add(key);
    // "back" keys replace the callback key in `seen`, as in the Python tool: the callback too
    if (kind === 'cb') this.seen.add(this.seenKey('cb', action[2]));
    this.queue.push(action);
  }

  // ---- one message ----------------------------------------------------
  async getMsg(id) {
    const r = await this.client.getMessages(this.peer, { ids: [id] });
    const m = r?.[0];
    return m && m.className === 'Message' ? m : null;
  }

  async saveMedia(msg) {
    if (this.args.noMedia || !msg.media || ['MessageMediaWebPage', 'MessageMediaEmpty'].includes(msg.media.className)) return null;
    if (msg.file?.size && msg.file.size > this.args.maxMediaMb * 1024 * 1024) return null;
    const id = String((msg.photo || msg.document)?.id ?? msg.id);
    if (!(id in this.mediaCache)) {
      let name = null;
      try {
        const buf = await this.client.downloadMedia(msg, {});
        if (buf && buf.length) { name = id + sniffExt(buf, msg.document); fs.writeFileSync(path.join(this.mediaDir, name), buf); }
      } catch { /* a media that cannot be downloaded is left out */ }
      this.mediaCache[id] = name;
    }
    return this.mediaCache[id];
  }

  // One keyboard cell, whatever the button type; only callbacks and keyboard texts are played
  describeButton(b, markup) {
    const cell = { text: b.text };
    const name = kindOf(b);
    const style = b.style;
    if (style) {
      for (const [flag, color] of [['bgDanger', 'danger'], ['bgSuccess', 'success'], ['bgPrimary', 'primary']]) if (style[flag]) { cell.style = color; break; }
      if (style.icon) cell.icon = String(style.icon);
    }
    if (b.disabled) cell.disabled = true;
    if (name.includes('Callback') && b.data) {
      cell.kind = 'callback';
      cell.data = Buffer.from(b.data).toString('utf8');
      if (b.requiresPassword) cell.password = true;
      return [cell, ['cb', null, b64(b.data), b.text]];
    }
    if (name.includes('WebView')) return [Object.assign(cell, { kind: 'web_app', url: b.url || '' }), null];
    if (name.includes('UrlAuth')) return [Object.assign(cell, { kind: 'login_url', url: b.url || '' }), null];
    if (name.includes('Url') && b.url !== undefined) return [Object.assign(cell, { kind: 'url', url: b.url }), null];
    if (name.includes('Copy')) return [Object.assign(cell, { kind: 'copy', copy: b.copyText || '' }), null];
    if (name.includes('SwitchInline')) return [Object.assign(cell, { kind: 'switch_inline', query: b.query || '', same_chat: !!b.samePeer }), null];
    if (name.includes('RequestPhone')) return [Object.assign(cell, { kind: 'request_contact' }), null];
    if (name.includes('RequestGeoLocation')) return [Object.assign(cell, { kind: 'request_location' }), null];
    if (name.includes('RequestPoll')) return [Object.assign(cell, { kind: 'request_poll', quiz: !!b.quiz }), null];
    if (name.includes('RequestPeer')) {
      const peer = kindOf(b.peerType);
      return [Object.assign(cell, { kind: /Chat|Broadcast/.test(peer) ? 'request_chat' : 'request_users' }), null];
    }
    if (name.includes('Game')) return [Object.assign(cell, { kind: 'game' }), null];
    if (name.includes('Buy')) return [Object.assign(cell, { kind: 'pay' }), null];
    if (name.includes('UserProfile')) return [Object.assign(cell, { kind: 'user_profile', user_id: b.userId !== undefined ? String(b.userId) : null }), null];
    if (markup.className === 'ReplyKeyboardMarkup' && name === 'KeyboardButton') { cell.kind = 'keyboard'; return [cell, ['text', b.text]]; }
    cell.kind = name;
    return [cell, null];
  }

  // A captcha or a question: the bot waits for a text
  promptAnswer(text, markupInfo) {
    const raw = text || '';
    let m = raw.match(/(-?\d+)\s*([+\-x×*/÷])\s*(-?\d+)\s*(?:=|\?|$)/);
    if (m && /captcha|solve|r[ée]sou|calcul|human|humain|=|\?/i.test(raw)) {
      const a = Number(m[1]), b = Number(m[3]);
      const value = { '+': a + b, '-': a - b, x: a * b, '×': a * b, '*': a * b }[m[2]] ?? (b ? Math.floor(a / b) : undefined);
      if (value !== undefined) return String(value);
    }
    m = raw.match(/(?:code|captcha|enter|type|tape[zr]?|saisi[sr]|recopie[zr]?)\W{0,12}[«"'`]?([A-Za-z0-9]{4,10})[»"'`]?\b/i);
    if (m && /captcha|code|v[ée]rif|human|humain/i.test(raw)) return m[1];
    const forced = markupInfo?.type === 'force_reply';
    if (forced || /\b(send|enter|type|reply|write|provide|input|solve|answer|envoye[zr]|entre[zr]|tape[zr]|[ée]cri(?:s|vez)|r[ée]ponde[zr]|r[ée]sou[ds])\b/i.test(raw)) {
      for (const [pattern, answer] of this.rules.asks) if (pattern.test(`${raw} ${markupInfo?.placeholder || ''}`)) return answer;
      if (forced) return '1';
    }
    return null;
  }

  async handleGate(key, msg, rows) {
    if (this.answered.has(key)) return;
    const answer = this.promptAnswer(msg.message, this.describeMarkup(msg.replyMarkup));
    if (answer !== null) {
      this.answered.add(key);
      this.queue.unshift(['text', answer]);
      this.log(`  question ou captcha détecté : réponse « ${answer} » envoyée ensuite`);
    }
    if (this.args.noJoin || !/\b(join|subscribe|rejoin|abonne)/i.test(msg.message || '')) return;
    const links = rows.flat().filter(c => c.kind === 'url').map(c => c.url || '');
    links.push(...(msg.message || '').match(/(?:https?:\/\/)?t\.me\/[^\s)\]]+/g) || []);
    for (const link of links) {
      const m = link.match(/t\.me\/(?:joinchat\/|\+)([\w-]+)|t\.me\/([A-Za-z][\w]{3,31})(?:[/?]|$)/);
      if (!m) continue;
      const target = m[1] || m[2];
      if (this.joined.includes(target) || ['share', 'addstickers', this.args.bot.toLowerCase()].includes(target.toLowerCase())) continue;
      try {
        if (m[1]) await this.client.invoke(new Api.messages.ImportChatInvite({ hash: target }));
        else await this.client.invoke(new Api.channels.JoinChannel({ channel: await this.client.getInputEntity(target) }));
        this.joined.push(target);
        this.log(`  canal rejoint (exigé par le bot) : ${target}`);
        await sleep(this.args.wait);
      } catch (e) {
        if (rpcMessage(e) === 'USER_ALREADY_PARTICIPANT') this.joined.push(target);
        else if (isRpc(e)) this.log(`  impossible de rejoindre ${target} : ${errName(e)}`);
        else throw e;
      }
    }
  }

  // Inline mode (@bot …): what the bot offers for an empty search and a few of its own words
  async readInline() {
    try {
      const me = await this.client.getEntity(this.peer);
      if (!me.botInlinePlaceholder) return;
      const words = [...new Set([...this.screens.values()].slice(0, 5).flatMap(s => s.raw.match(/[A-Za-z]{4,}/g) || []))].slice(0, 3);
      const results = [], seen = new Set();
      for (const q of ['', ...words]) {
        let found;
        try { found = await this.client.invoke(new Api.messages.GetInlineBotResults({ bot: this.peer, peer: new Api.InputPeerSelf(), query: q, offset: '' })); } catch (e) { if (isRpc(e)) continue; throw e; }
        for (const r of (found.results || []).slice(0, 20)) {
          const id = r.id || r.title;
          if (seen.has(id)) continue;
          seen.add(id);
          results.push({ query: q, title: r.title || '', description: r.description || '', text: r.sendMessage?.message || '', url: r.url ?? null });
        }
      }
      this.inline = { placeholder: me.botInlinePlaceholder, results: results.slice(0, 60) };
      this.log(`Mode inline : ${results.length} résultat(s) lu(s)`);
    } catch (e) {
      if (!isRpc(e)) throw e;
      this.log(`Mode inline illisible (${errName(e)}).`);
    }
  }

  describeMarkup(markup) {
    switch (markup?.className) {
      case 'ReplyKeyboardMarkup': return { type: 'keyboard', resize: !!markup.resize, one_time: !!markup.singleUse, persistent: !!markup.persistent, placeholder: markup.placeholder || '' };
      case 'ReplyKeyboardForceReply': return { type: 'force_reply', placeholder: markup.placeholder || '' };
      case 'ReplyKeyboardHide': return { type: 'remove_keyboard' };
      default: return null;
    }
  }

  // What the message carries besides its text; the album it belongs to
  describeContent(msg) {
    const m = msg.media, out = {};
    switch (m?.className) {
      case 'MessageMediaPoll': out.poll = { question: txt(m.poll.question), options: m.poll.answers.map(a => txt(a.text)), quiz: !!m.poll.quiz, multiple: !!m.poll.multipleChoice }; break;
      case 'MessageMediaInvoice': out.invoice = { title: m.title, description: m.description, currency: m.currency, amount: Number(m.totalAmount), test: !!m.test }; break;
      case 'MessageMediaVenue': out.venue = { title: m.title, address: m.address, lat: m.geo?.lat ?? null, long: m.geo?.long ?? null }; break;
      case 'MessageMediaGeo': case 'MessageMediaGeoLive': out.location = { lat: m.geo?.lat ?? null, long: m.geo?.long ?? null, live: m.className === 'MessageMediaGeoLive' }; break;
      case 'MessageMediaContact': out.contact = { name: [m.firstName, m.lastName].filter(Boolean).join(' '), phone: m.phoneNumber }; break;
      case 'MessageMediaDice': out.dice = { emoji: m.emoticon, value: m.value }; break;
      case 'MessageMediaPaidMedia': out.paid_media = { stars: m.starsAmount !== undefined ? Number(m.starsAmount) : null, count: (m.extendedMedia || []).length }; break;
      default:
    }
    if (msg.groupedId) out.album = String(msg.groupedId);
    return out;
  }

  mediaType(msg) {
    if (msg.photo) return 'photo';
    for (const kind of ['sticker', 'gif', 'videoNote', 'video', 'voice', 'audio', 'document']) {
      if (msg[kind]) return kind === 'gif' ? 'animation' : kind === 'videoNote' ? 'video_note' : kind;
    }
    return null;
  }

  // The screen without its numbers: "5.00 pcs [£35.00]" and "6.00 pcs [£42.00]" are one screen
  template(html, rows) {
    const labels = rows.map(row => row.map(c => c.text || ''));
    return sha12(pyDumps([html, labels]).replace(/\d+(?:[.,]\d+)?/g, '#'));
  }

  // The amount screen of a product: a + and a − button, or a quantity word with one of them
  isQuantity(rows, raw) {
    const labels = rows.flat().map(c => String(c.text || '').trim());
    const q = this.rules.quantity;
    if (q.tier && labels.some(l => q.tier.test(l))) return true;
    if (!q.plus || !q.minus) return false;
    const plus = labels.some(l => q.plus.test(l)), minus = labels.some(l => q.minus.test(l));
    return (plus && minus) || (!!q.word && q.word.test(raw || '') && (plus || minus));
  }

  async capture(msg, source, route = null, follow = true) {
    const rows = [], children = [];
    const markup = msg.replyMarkup;
    const hasKeys = ['ReplyInlineMarkup', 'ReplyKeyboardMarkup'].includes(markup?.className);
    const text = toHtml(msg.message || '', msg.entities);
    let tkeyNow = null;
    if (hasKeys) tkeyNow = this.template(text, markup.rows.map(r => r.buttons.map(b => ({ text: b.text }))));
    if (hasKeys) {
      for (const row of markup.rows) {
        const cells = [];
        for (const b of row.buttons) {
          const [cell, child] = this.describeButton(b, markup);
          if (child && child[0] === 'cb') { child[1] = msg.id; this.buttonScreen[child[2]] = tkeyNow; }
          if (child) children.push(child);
          cells.push(cell);
        }
        rows.push(cells);
      }
    }
    const media = await this.saveMedia(msg);
    const markupInfo = this.describeMarkup(markup);
    // What the screen shows, without the buttons' hidden data (many bots put a token there
    // that changes at each display: the same screen would look new each time)
    const shown = rows.map(row => row.map(c => { const { data, ...rest } = c; return rest; }));
    const key = sha12(pyDumps([text, shown, media]));
    if (!this.screens.has(key)) {
      const tkey = this.template(text, rows);
      const repeat = this.templates.has(tkey);
      this.templates.add(tkey);
      if (route && !(key in this.paths)) this.paths[key] = route;
      const screen = {
        key, order: this.screens.size + 1, message_id: msg.id,
        date: new Date(msg.date * 1000).toISOString().replace('.000Z', '+00:00'),
        html: text, raw: msg.message || '', media, media_type: media ? this.mediaType(msg) : null, markup: markupInfo,
        ...this.describeContent(msg), buttons: rows, sources: [source],
      };
      // Where the walk stops: the quantity screen, and whatever a hand-added step opens
      const quantity = this.isQuantity(rows, msg.message);
      if (quantity) screen.stop = 'quantity';
      else if (!follow) screen.stop = 'manual';
      this.screens.set(key, screen);
      if (quantity) this.log('  écran de quantité : les paliers et ce qui suit se font à la main');
      // A quantity screen is followed only when the bot's profile says so (QT Market: yes,
      // around its tiers); a hand-added step's screen never is
      const walk = !screen.stop || (screen.stop === 'quantity' && this.rules.quantity.follow);
      if (!repeat && walk) await this.handleGate(key, msg, rows);
      if (!repeat && walk) {
        for (const child of children) {
          if (child[0] === 'cb') this.origin[child[2]] = key;
          this.enqueue(child);
        }
        for (const cmd of (msg.message || '').match(COMMAND) || []) this.enqueue(['cmd', cmd]);
      } else if (screen.stop && !walk) {
        // Still known as the carrier of its buttons: a hand-added step plays them from here
        for (const child of children) if (child[0] === 'cb') this.origin[child[2]] = key;
      }
    } else if (!this.screens.get(key).sources.includes(source)) this.screens.get(key).sources.push(source);
    return key;
  }

  // ---- execution ------------------------------------------------------
  hasCallback(msg, data) {
    if (msg?.replyMarkup?.className !== 'ReplyInlineMarkup') return false;
    return msg.replyMarkup.rows.some(r => r.buttons.some(b => b.data && same(Buffer.from(b.data), data)));
  }

  // Telegram refuses a callback missing from the message's current keyboard (DATA_INVALID):
  // when the message changed, a recent message that still carries the button is looked for
  async buttonMessage(msgId, data) {
    if (this.hasCallback(await this.getMsg(msgId), data)) return msgId;
    for (const recent of await this.client.getMessages(this.peer, { limit: 30 })) {
      if (recent.className === 'Message' && !recent.out && this.hasCallback(recent, data)) return recent.id;
    }
    return msgId;
  }

  // The buttons of the bot's latest messages, in one request
  async recentButtons(limit = 10) {
    const out = [];
    for (const recent of await this.client.getMessages(this.peer, { limit })) {
      if (recent.className !== 'Message' || recent.out || recent.replyMarkup?.className !== 'ReplyInlineMarkup') continue;
      out.push([recent.id, recent.replyMarkup.rows.flatMap(r => r.buttons.map(b => [b.text, b.data ? Buffer.from(b.data) : null]))]);
    }
    return out;
  }

  // In buttons already read: by data, by label, then by label up to its numbers
  pick(shown, label, data = null) {
    const tests = [(t, d) => (data && same(d, data)) || (label && t === label), (t) => label && norm(t) === norm(label)];
    for (const test of tests) for (const [msgId, buttons] of shown) for (const [text, d] of buttons) if (d && test(text, d)) return [msgId, d];
    return null;
  }

  async findButton(label, data = null, limit = 10) { return this.pick(await this.recentButtons(limit), label, data); }

  async waitButton(label, data = null, timeout = 6.0) {
    let waited = 0;
    for (;;) {
      const found = await this.findButton(label, data);
      if (found || waited >= timeout) return found;
      await sleep(1.5);
      waited += 1.5;
    }
  }

  // The bot replaced the screen that carried this button: the way to it is played again
  // (/start, then the buttons), without recording those screens
  goBackTo(data, label) { return this.reach(this.origin[b64(data)], label, data); }

  async reach(screen, label, data = null) {
    const way = this.paths[screen];
    if (!way) return null;
    const shown = await this.recentButtons();
    const here = this.pick(shown, label, data);
    if (here) return here;
    // From the last crossroad still on screen, not from /start
    let i = 0;
    for (let j = way.length - 1; j >= 0; j--) if (way[j][0] === 'cb' && this.pick(shown, way[j][1])) { i = j; break; }
    this.log(`  retour sur l'écran du bouton [${label}] (${way.length - i} étape(s)${i ? ` sur ${way.length}` : ''})`);
    let found = await this.replay(way, i, data, label);
    if (!found && i) { this.log(`  carrefour périmé : chemin complet (${way.length} étape(s))`); found = await this.replay(way, 0, data, label); }
    if (!found) this.log(`  écran du bouton [${label}] introuvable après le retour`);
    return found;
  }

  async replay(way, i, data, label) {
    while (i < way.length) {
      const [kind, value] = way[i];
      if (kind === 'cmd' || kind === 'text') {
        await this.client.sendMessage(this.peer, { message: value });
        i++;
        await sleep(Math.min(this.args.wait, 1.5));
        continue;
      }
      let shown = await this.recentButtons();
      if (this.pick(shown, label, data)) break;
      const found = this.pick(shown, value) || await this.waitButton(value, null, 4.5);
      if (!found) {
        // A step that no longer shows (terms accepted, age confirmed…): on to the next visible one
        let later = null;
        shown = await this.recentButtons();
        for (let j = i + 1; j < way.length; j++) if (way[j][0] === 'cb' && this.pick(shown, way[j][1])) { later = j; break; }
        if (later === null) break;
        i = later;
        continue;
      }
      try {
        await this.client.invoke(new Api.messages.GetBotCallbackAnswer({ peer: this.peer, msgId: found[0], data: found[1] }));
      } catch (e) {
        if (!isRpc(e)) throw e;
        if (isFlood(e)) throw e;
        if (rpcMessage(e) !== 'BOT_RESPONSE_TIMEOUT') this.log(`  étape [${value}] refusée (${errName(e)})`);
      }
      i++;
      await sleep(Math.min(this.args.wait, 1.5));
    }
    const latest = await this.client.getMessages(this.peer, { limit: 1 });
    if (latest?.length) this.lastId = Math.max(this.lastId, latest[0].id);
    return this.waitButton(label, data);
  }

  async callback(msgId, data) {
    try {
      const answer = await this.client.invoke(new Api.messages.GetBotCallbackAnswer({ peer: this.peer, msgId, data }));
      return answer.message || (answer.url ? `url: ${answer.url}` : null);
    } catch (e) {
      // The click went, the bot just did not confirm in time: it often edits the message anyway
      if (rpcMessage(e) === 'BOT_RESPONSE_TIMEOUT') return null;
      throw e;
    }
  }

  async perform(action) {
    if (action[0] === 'cmd' || action[0] === 'text') {
      await this.client.sendMessage(this.peer, { message: action[1] });
      return [null, null];
    }
    if (action[0] === 'goto') {
      const [, screen, , label] = action;
      const found = await this.reach(screen, label);
      if (!found) throw new RouteLost(label);
      const [msgId, data] = found;
      this.seen.add(this.seenKey('cb', b64(data)));
      this.origin[b64(data)] = screen;
      return [await this.callback(msgId, data), msgId];
    }
    let [, msgId, dataB64, label] = action;
    let data = Buffer.from(dataB64, 'base64');
    msgId = await this.buttonMessage(msgId, data);
    if (!this.hasCallback(await this.getMsg(msgId), data)) {
      const found = await this.goBackTo(data, label);
      if (found) [msgId, data] = found;
    }
    return [await this.callback(msgId, data), msgId];
  }

  async step(action, token) {
    const label = labelOf(action);
    const manual = this.manual.has(action);
    let error = null, alert = null, pressed = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        [alert, pressed] = await this.perform(action);
        break;
      } catch (e) {
        if (e instanceof RouteLost) { error = 'RouteLost'; break; }
        if (isFlood(e) || !isRpc(e)) throw e; // Telegram's pause is waited out in run(), outside the per-action delay
        // Stale button, mute bot, deleted message…: noted, on to the next
        error = errName(e);
        if (action[0] === 'cb' && ['DATA_INVALID', 'MESSAGE_ID_INVALID'].includes(rpcMessage(e)) && !this.retried.has(action[2])) {
          this.retried.add(action[2]); // once more at the end of the queue: the screen may be found by then
          this.queue.push(action);
          error += ' (nouvel essai plus tard)';
        }
        break;
      }
    }
    await sleep(this.args.wait);
    if (token !== this.token) return; // abandoned after its delay

    // The way to the screens obtained: the button's screen, plus that button
    let start = null, way;
    if (action[0] === 'cb') start = this.origin[action[2]] ?? null;
    else if (action[0] === 'goto') start = action[1];
    if (start !== null || action[0] === 'cb' || action[0] === 'goto') {
      const base = this.paths[start];
      way = base !== undefined ? [...base, ['cb', action[3]]] : null;
    } else way = [[action[0] === 'text' ? 'text' : 'cmd', action[1]]];

    const keys = [];
    const fresh = await this.client.getMessages(this.peer, { minId: this.lastId, limit: 50 });
    for (const msg of [...fresh].reverse()) {
      this.lastId = Math.max(this.lastId, msg.id);
      if (msg.className === 'Message' && !msg.out) keys.push(await this.capture(msg, label, way, !manual));
    }
    // The message the bot edited in place (a button under it was pressed): the app shows
    // the new screen in that same message
    let editedKey = null;
    if (pressed) {
      const edited = await this.getMsg(pressed);
      if (edited) { editedKey = await this.capture(edited, label, way, !manual); keys.push(editedKey); }
    }
    if ((action[0] === 'cb' || action[0] === 'goto') && !error) {
      const known = (this.labelResults[norm(action[3])] ||= { played: 0, screens: [] });
      known.played++;
      for (const k of keys) if (!known.screens.includes(k)) known.screens.push(k);
    }
    const step = { action: label, alert, error, screens: keys };
    if (start) step.from = start;
    // The button's exact callback data, as a screen's button data (utf-8): the replica graph
    // matches a button to its edge with it. Only inline taps carry data.
    if (action[0] === 'cb') step.data = Buffer.from(action[2], 'base64').toString('utf8');
    if (editedKey && !keys.slice(0, -1).includes(editedKey)) step.edited = editedKey;
    this.steps.push(step);
    this.log(`${String(this.steps.length).padStart(4)}  ${label.slice(0, 60).padEnd(60)} -> ${keys.length} écran(s)${error ? `  ${error}` : ''}${manual ? '  (à la main)' : ''}`);
  }

  async withTimeout(action) {
    const token = ++this.token;
    let timer;
    const limit = new Promise((_, no) => { timer = setTimeout(() => no(Object.assign(new Error('timeout'), { stepTimeout: true })), STEP_TIMEOUT * 1000); });
    try { await Promise.race([this.step(action, token), limit]); } finally { clearTimeout(timer); }
  }

  async run() {
    if (!this.steps.length) {
      const latest = await this.client.getMessages(this.peer, { limit: 1 });
      this.lastId = latest?.[0]?.id || 0;
      for (const cmd of this.args.start) this.enqueue(['cmd', cmd]);
    } else if (!this.queue.length) {
      // Commands left unanswered (timeout, Telegram pause): played again
      let failed = this.steps.filter(s => ['Timeout', 'FloodWaitError'].includes(s.error) && !s.action.startsWith('[')).map(s => s.action);
      if (!this.screens.size) failed = [...this.args.start, ...failed];
      for (const v of new Set(failed)) this.queue.push(['cmd', v]);
      if (this.queue.length) this.log(`${this.queue.length} commande(s) restée(s) sans réponse : rejouée(s).`);
      else this.log('Capture déjà complète : rien à rejouer (--fresh pour tout recommencer).');
    }
    const done = this.steps.length;
    while (this.queue.length && this.steps.length - done < this.args.maxActions) {
      if (this.stopRequested()) { this.log('Arrêt demandé.'); break; }
      const action = this.queue.shift();
      try {
        await this.withTimeout(action);
      } catch (e) {
        if (isFlood(e)) {
          // Telegram's pause: the action goes back to the front, the capture is saved, and the
          // walk resumes by itself when the pause ends
          this.queue.unshift(action);
          this.saveState();
          if (!(await this.floodPause(e.seconds))) { this.log('Arrêt demandé pendant la pause : relancez (sans « Tout recommencer ») pour reprendre ici.'); break; }
          continue;
        }
        if (e.stepTimeout) {
          const label = labelOf(action);
          this.steps.push({ action: label, alert: null, error: 'Timeout', screens: [] });
          this.log(`${String(this.steps.length).padStart(4)}  ${label.slice(0, 60).padEnd(60)} -> sans réponse après ${STEP_TIMEOUT}s : passée`);
          continue;
        }
        if (isNet(e)) {
          // Network down: the action goes back to the front, the capture is saved, then the
          // connection is waited for instead of stopping
          this.queue.unshift(action);
          this.saveState();
          this.log(`Connexion perdue (${errName(e)}) : capture enregistrée, nouvel essai en cours…`);
          if (!(await this.reconnect())) { this.log('Pas de réseau depuis plusieurs minutes : arrêt. Relancez pour reprendre là où le parcours s\'est arrêté.'); break; }
          continue;
        }
        // An error on one action must not stop the whole capture
        const label = labelOf(action);
        this.steps.push({ action: label, alert: null, error: errName(e), screens: [] });
        this.log(`${String(this.steps.length).padStart(4)}  ${label.slice(0, 60).padEnd(60)} -> erreur ${errName(e)} : ${String(e.message).slice(0, 80)} (action passée)`);
        continue;
      }
      if (this.steps.length % SAVE_EVERY === 0) this.saveState();
    }
    if (this.skippedKnown) this.log(`${this.skippedKnown} bouton(s) déjà connus non rejoués (ils mènent toujours au même écran).`);
    if (this.queue.length) this.log(`${this.queue.length} action(s) non jouée(s) : relancez pour continuer là où le parcours s'est arrêté.`);
  }

  async floodPause(seconds) {
    const until = new Date(Date.now() + seconds * 1000).toTimeString().slice(0, 5);
    this.log(`  pause imposée par Telegram : ${seconds}s, reprise vers ${until} (capture enregistrée)`);
    let left = seconds + 2;
    while (left > 0) {
      if (this.stopRequested()) return false;
      await sleep(Math.min(30, left));
      left -= 30;
      if (left > 0 && left % 300 < 30) this.log(`  … encore ${Math.floor(left / 60)} min de pause imposée`);
    }
    this.log('  pause terminée : le parcours reprend');
    return true;
  }

  // The routes picked in the check (a button of a screen: go back to that screen and press
  // it; a command; a text). Picked or typed by hand (manual): played first, and what they
  // open is recorded without the walk following it.
  addRetries(items, manual = false) {
    let added = 0;
    for (const item of [...items].reverse()) {
      let action;
      if (this.screens.has(item.screen) && item.label) action = ['goto', item.screen, null, item.label];
      else if (String(item.cmd || '').startsWith('/')) action = ['cmd', item.cmd];
      else if (item.text) action = ['text', item.text];
      else continue;
      if (manual) this.manual.add(action);
      this.queue.unshift(action);
      added++;
    }
    this.log(`${added} route(s) à relancer, jouées en premier${manual ? ' (à la main : la capture ne va pas plus loin à partir d\'elles)' : ''}.`);
  }

  // What the completion may play: the same limits as the walk. Quantity tiers and what follows
  // them are hand-only, and so are the buttons of a stop screen the walk does not go around.
  completable(item) {
    if (this.rules.manual?.test(item.label ?? item.text ?? '')) return false;
    const stop = this.screens.get(item.screen)?.stop;
    return !stop || (stop === 'quantity' && this.rules.quantity.follow);
  }

  // After the walk: the routes are analysed and the missing or failed ones played again, in
  // --complete passes at most. Each route is replayed once; a second failure stays "failed".
  async complete() {
    const tried = new Set();
    for (let n = 1; n <= this.args.complete; n++) {
      if (this.stopRequested() || this.queue.length) return; // the next run goes on with the queue first
      const report = this.check();
      const s = report.summary;
      const items = retryItems(report).filter(it => this.completable(it) && !tried.has(JSON.stringify(it)));
      if (!items.length) { this.log(`Chemins : ${s.covered}/${s.routes} couverts (${s.coverage} %), rien à compléter.`); return; }
      this.log(`Complétion ${n}/${this.args.complete} : ${s.covered}/${s.routes} chemins couverts, ${items.length} à relancer.`);
      items.forEach(it => tried.add(JSON.stringify(it)));
      this.addRetries(items);
      await this.run();
    }
    const s = this.check().summary;
    this.log(`Chemins après complétion : ${s.covered}/${s.routes} couverts (${s.coverage} %).`);
  }

  async reconnect(tries = RECONNECT_TRIES) {
    for (let i = 0; i < tries; i++) {
      if (this.stopRequested()) return false;
      await sleep(RECONNECT_WAIT);
      try {
        if (!this.client.connected) await this.client.connect();
        await this.client.getMe();
        this.log('Connexion rétablie : le parcours continue.');
        return true;
      } catch (e) {
        if (!isNet(e)) throw e;
        this.log(`  toujours pas de réseau (${i + 1}/${tries}) : ${errName(e)}`);
      }
    }
    return false;
  }

  // ---- resume ---------------------------------------------------------
  saveState() {
    const seen = [], seenButtons = [];
    for (const s of this.seen) { const k = JSON.parse(s); (k.length === 3 ? seenButtons : seen).push(k); }
    const state = { queue: this.queue, seen, seen_buttons: seenButtons, per_prefix: this.perPrefix, media_cache: this.mediaCache,
      last_id: this.lastId, ignored: this.ignored, paths: this.paths, origin: this.origin, label_results: this.labelResults };
    fs.writeFileSync(path.join(this.out, 'state.json'), JSON.stringify(state));
    this.writeData();
  }

  loadState() {
    const stateFile = path.join(this.out, 'state.json'), dataFile = path.join(this.out, 'data.json');
    if (!(fs.existsSync(stateFile) && fs.existsSync(dataFile))) { this.log('Rien à reprendre : nouveau parcours.'); return; }
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    this.steps = data.steps;
    this.profile = data.profile || {};
    this.inline = data.inline || null;
    this.joined = data.joined || [];
    this.screens = new Map(data.screens.map(s => [s.key, s]));
    this.perPrefix = state.per_prefix;
    this.mediaCache = state.media_cache;
    this.lastId = state.last_id;
    this.ignored = state.ignored;
    this.paths = state.paths || {};
    this.origin = state.origin || {};
    this.labelResults = state.label_results || {};
    this.templates = new Set([...this.screens.values()].map(s => this.template(s.html || '', s.buttons || [])));
    for (const [kind, value] of state.seen) this.seen.add(this.seenKey(kind, value));
    for (const item of state.seen_buttons || []) this.seen.add(JSON.stringify(item));
    // A queue saved by an old version keeps a back per screen: one per label
    const played = new Set(this.steps.map(s => s.action));
    let dropped = 0;
    for (const action of state.queue) {
      if (action[0] === 'cb' && BACK.test(action[3] || '')) {
        const key = this.seenKey('back', action[3].trim());
        if (this.seen.has(key) || played.has(`[${action[3]}]`)) { dropped++; continue; }
        this.seen.add(key);
      }
      this.queue.push(action);
    }
    this.log(`Reprise : ${this.steps.length} actions déjà jouées, ${this.queue.length} en attente${dropped ? ` (${dropped} retours en double retirés)` : ''}.`);
  }

  // What the bot shows of itself: name, description, menu commands, photo. Used by the replica.
  async readProfile() {
    try {
      const full = await this.client.invoke(new Api.users.GetFullUser({ id: this.peer }));
      const user = full.users?.[0] || {};
      const info = full.fullUser.botInfo;
      let photo = null, introPhoto = null;
      if (!this.args.noMedia) {
        const save = async (buf, name) => { if (!buf?.length) return null; const file = name + sniffExt(buf); fs.writeFileSync(path.join(this.mediaDir, file), buf); return file; };
        try { photo = await save(await this.client.downloadProfilePhoto(this.peer, { isBig: true }), 'profile'); } catch { /* no photo */ }
        // The picture shown above the description, before /start
        if (info?.descriptionPhoto) try { introPhoto = await save(await this.client.downloadMedia(info.descriptionPhoto, {}), 'intro'); } catch { /* none */ }
      }
      const menu = info?.menuButton;
      this.profile = {
        name: [user.firstName, user.lastName].filter(Boolean).join(' '), username: user.username || '', about: full.fullUser.about || '',
        description: info?.description || '',
        commands: (info?.commands || []).map(c => ({ command: c.command, description: c.description })),
        photo, intro_photo: introPhoto,
        // Button left of the input field: the command list or a web app
        menu_button: menu && menu.url !== undefined ? { text: menu.text || '', url: menu.url || '' } : null,
      };
      this.log(`Profil : ${this.profile.name} · ${this.profile.commands.length} commande(s)${photo ? ' · photo' : ''}${introPhoto ? ' · image d’accueil' : ''}`);
    } catch (e) {
      if (!isRpc(e)) throw e;
      this.log(`Profil du bot illisible (${errName(e)}) : la capture continue sans.`);
    }
  }

  // ---- outputs --------------------------------------------------------
  data() {
    return { bot: this.args.bot, profile: this.profile, inline: this.inline, joined: this.joined, steps: this.steps,
      ignored: [...new Set(this.ignored)].sort(), screens: [...this.screens.values()].sort((a, b) => a.order - b.order) };
  }

  check() { return checkCapture(this.data(), { paths: this.paths, origin: this.origin, queue: this.queue }); }

  writeData() {
    const data = this.data();
    fs.writeFileSync(path.join(this.out, 'data.json'), JSON.stringify(data, null, 2));
    fs.writeFileSync(path.join(this.out, 'check.json'), JSON.stringify(this.check(), null, 2));
  }

  write() {
    this.saveState();
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const screens = [...this.screens.values()].sort((a, b) => a.order - b.order);
    const cards = screens.map(s => {
      let img = '';
      if (s.media && IMAGE_EXT.test(s.media)) img = `<img src="media/${esc(s.media)}" alt="">`;
      else if (s.media) img = `<p class="file">Fichier : <a href="media/${esc(s.media)}">${esc(s.media)}</a></p>`;
      const buttons = s.buttons.map(row => `<div class="row">${row.map(c => `<span class="btn ${esc(c.kind)}" title="${esc(c.data || c.url || '')}">${esc(c.text)}</span>`).join('')}</div>`).join('');
      const stop = s.stop === 'quantity' ? ' · arrêt : quantité' : s.stop === 'manual' ? ' · à la main' : '';
      return `<section id="s${s.order}"><header>#${s.order} · via ${esc(s.sources.join(', '))}${stop}</header>${img}<div class="text">${s.html.replace(/\n/g, '<br>')}</div><div class="kb">${buttons}</div></section>`;
    }).join('');
    const ignored = [...new Set(this.ignored)].sort();
    const skipped = ignored.length ? `<section><header>Actions ignorées (${ignored.length})</header><div class="text">${esc(ignored.join(' · '))}</div></section>` : '';
    const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Parcours @${esc(this.args.bot)}</title><style>
body{margin:0;background:#0e1621;color:#e9eef3;font:15px/1.45 system-ui,sans-serif}
main{max-width:560px;margin:0 auto;padding:16px}
h1{font-size:18px} section{background:#182533;border-radius:12px;margin:0 0 18px;overflow:hidden}
header{font-size:12px;color:#7f91a4;padding:8px 12px} img{display:block;width:100%}
.text{padding:10px 12px;word-wrap:break-word} .text a{color:#6ab2f2}
.kb{padding:0 6px 6px} .row{display:flex;gap:4px;margin-top:4px}
.btn{flex:1;text-align:center;background:#2b5278;border-radius:6px;padding:7px 4px;font-size:13px}
.btn.url::after{content:" ↗"} .btn.keyboard{background:#26313d} .file{padding:0 12px}
</style></head><body><main><h1>@${esc(this.args.bot)} : ${screens.length} écrans, ${this.steps.length} actions</h1>
${cards}${skipped}</main></body></html>`;
    fs.writeFileSync(path.join(this.out, 'report.html'), page);
  }
}

// The routes to play again, in the screens' order, then the menu commands. The completion
// leaves out those that are played by hand only (Explorer.completable).
export function retryItems(report) {
  const items = report.crossroads.flatMap(c => c.routes.filter(r => r.retry).map(r => r.retry));
  items.push(...report.commands.filter(c => c.retry).map(c => c.retry));
  return [...new Map(items.map(i => [JSON.stringify(i), i])).values()];
}

export async function exploreBot(client, name, args) {
  profileOf(name); // before anything is created or connected: only the two bots
  const out = args.out ? path.resolve(args.out) : path.join(path.resolve(args.capturesDir), name.toLowerCase());
  fs.mkdirSync(out, { recursive: true });
  args = { ...args, bot: name };
  this_log(`== @${name} -> ${out}`);
  const entity = await client.getEntity(name);
  const explorer = new Explorer(client, await client.getInputEntity(entity), out, args);
  // An existing capture is resumed: what was played is not played again
  if (!args.fresh) explorer.loadState();
  if (args.retry) explorer.addRetries(JSON.parse(fs.readFileSync(args.retry, 'utf8')), true);
  await explorer.readProfile();
  try {
    await explorer.run();
    await explorer.complete();
    if (!args.noInline) await explorer.readInline();
  } finally {
    explorer.write();
    this_log(`Rapport : ${path.join(out, 'report.html')}`);
  }
  return explorer.queue.length; // actions left: the capture is saved but not finished
}
const this_log = (...a) => console.log(...a);
