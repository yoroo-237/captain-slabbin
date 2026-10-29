import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const post = async (url, body = {}) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
};

const DEFAULTS = { profile: 'explorer', wait: '2.5', maxActions: '200', skip: '', allow: '',
  resume: false, noMedia: false, noCommands: false };

// Same rules as server.mjs: @bot, bot, t.me/bot?start=x all give 'bot'
const BOT = /^[A-Za-z][A-Za-z0-9_]{2,63}$/;
const normalizeBot = (x) => x.trim().replace(/^(https?:\/\/)?(t|telegram)\.me\//, '').split('?')[0].replace(/\/+$/, '').replace(/^@/, '');

function useTask() {
  const [state, setState] = useState({ running: false, name: null });
  const [lines, setLines] = useState([]);
  const onDone = useRef(() => {});
  const running = useRef(false);
  useEffect(() => {
    const es = new EventSource('/api/events');
    const apply = (s) => {
      if (running.current && !s.running) onDone.current();
      running.current = s.running;
      setState(s);
    };
    es.addEventListener('init', (e) => { const d = JSON.parse(e.data); apply(d.state); setLines(d.log); });
    es.addEventListener('line', (e) => setLines((l) => [...l.slice(-2999), JSON.parse(e.data)]));
    es.addEventListener('state', (e) => apply(JSON.parse(e.data)));
    return () => es.close();
  }, []);
  return { state, lines, onDone };
}

const lineKind = (l) => (l.startsWith('$ ') ? 'cmd'
  : /^-- terminé \(code 0\)/.test(l) ? 'ok'
  : /^-- terminé|erreur|error|impossible|inaccessible|traceback/i.test(l) ? 'err'
  : /^==|^Rapport|^Reprise|Arrêt demandé/.test(l) ? 'info' : '');

function Console({ lines }) {
  const box = useRef(null);
  const stick = useRef(true);
  // Follow the output only while the reader is at the bottom
  useLayoutEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [lines]);
  const onScroll = () => { const el = box.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; };
  return (
    <div className="console" ref={box} onScroll={onScroll} role="log" aria-live="polite">
      {lines.length
        ? lines.map((l, i) => <div key={i} className={`ln ${lineKind(l)}`}>{l}</div>)
        : <div className="ln empty">La sortie des tâches apparaît ici.</div>}
    </div>
  );
}

function Toggle({ checked, onChange, children }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="track" aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}

function CaptureCard({ c, busy, onResume, onImport }) {
  const updated = new Date(c.updated).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  return (
    <article className="card">
      <a className="cover" href={`/captures/${c.name}/report.html`} target="_blank" rel="noreferrer" aria-label={`Rapport de @${c.name}`}>
        {c.cover ? <img src={`/captures/${c.name}/media/${encodeURIComponent(c.cover)}`} alt="" loading="lazy" /> : <span>@{c.name.slice(0, 2)}</span>}
      </a>
      <div className="card-body">
        <div className="card-title">
          <h3>@{c.name}</h3>
          <time className="muted" dateTime={c.updated}>{updated}</time>
        </div>
        <ul className="stats">
          <li><b>{c.screens}</b> écrans</li>
          <li><b>{c.images}</b> images</li>
          <li><b>{c.steps}</b> actions</li>
          {c.ignored > 0 && <li title="Actions ignorées par la liste d'exclusion"><b>{c.ignored}</b> ignorées</li>}
          {c.queued > 0 && <li className="warn"><b>{c.queued}</b> en attente</li>}
        </ul>
        <div className="actions">
          <a className="btn sm" href={`/captures/${c.name}/report.html`} target="_blank" rel="noreferrer">Rapport ↗</a>
          {c.queued > 0 && <button className="btn sm" disabled={busy} onClick={() => onResume(c.name)}>Reprendre</button>}
          <span className="spacer" />
          <button className="btn sm" disabled={busy} onClick={() => onImport(c.name, 'style')}>Importer style</button>
          <button className="btn sm" disabled={busy} onClick={() => onImport(c.name, 'products')}>Importer produits</button>
        </div>
      </div>
    </article>
  );
}

export default function App() {
  const { state, lines, onDone } = useTask();
  const [bots, setBots] = useState('');
  const [opts, setOpts] = useState(DEFAULTS);
  const [captures, setCaptures] = useState([]);
  const [dry, setDry] = useState(true);
  const [error, setError] = useState('');
  const set = (key) => (e) => setOpts((o) => ({ ...o, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const refresh = useCallback(() => fetch('/api/captures').then((r) => r.json()).then(setCaptures).catch(() => {}), []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { onDone.current = refresh; }, [onDone, refresh]);

  const parsed = useMemo(() => bots.split(/\s+/).filter(Boolean).map((raw) => {
    const name = normalizeBot(raw);
    return { raw, name, ok: BOT.test(name) };
  }), [bots]);
  const invalid = parsed.filter((b) => !b.ok).length;

  const guard = (fn) => async (...args) => {
    setError('');
    try { await fn(...args); } catch (e) { setError(e.message); }
  };
  const explore = guard(() => post('/api/explore', { ...opts, bots: parsed.map((b) => b.name) }));
  const resume = guard((name) => post('/api/explore', { ...opts, resume: true, bots: [name] }));
  const login = guard(() => post('/api/login', { profile: opts.profile }));
  const stop = guard(() => post('/api/stop'));
  const importCapture = guard(async (bot, kind) => {
    if (!dry && !window.confirm(`Importer « ${kind === 'style' ? 'style' : 'produits'} » de @${bot} dans la base du backend (écriture réelle) ?`)) return;
    await post('/api/import', { bot, kind, dry });
  });

  const busy = state.running;
  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Capture de bots Telegram</h1>
          <p className="muted">Parcourt un bot avec votre compte et enregistre ses écrans, boutons et images.</p>
        </div>
        <span className={`status ${busy ? 'on' : ''}`} role="status">
          <span className="dot" aria-hidden="true" />{busy ? `${state.name} en cours…` : 'Inactif'}
        </span>
      </header>

      {error && (
        <div className="alert" role="alert">
          <span>{error}</span>
          <button className="close" onClick={() => setError('')} aria-label="Fermer">×</button>
        </div>
      )}

      <div className="layout">
        <section className="panel">
          <h2>Nouvelle capture</h2>

          <div className="step">
            <span className="num">1</span>
            <div className="step-body">
              <div className="step-head">
                <h3>Connexion Telegram</h3>
                <button className="btn" onClick={login}>Se connecter</button>
              </div>
              <p className="muted small">Une fois par profil. Une console Windows s'ouvre pour taper le code reçu : il ne passe pas par cette page.</p>
            </div>
          </div>

          <div className="step">
            <span className="num">2</span>
            <div className="step-body">
              <h3>Bots à parcourir</h3>
              <label className="field">
                <span className="sr">Bots</span>
                <textarea rows="3" value={bots} onChange={(e) => setBots(e.target.value)} spellCheck="false"
                  placeholder={'QTMARKETBOT\n@AutreBot ou https://t.me/AutreBot'} />
              </label>
              {parsed.length > 0 && (
                <ul className="chips" aria-label="Bots reconnus">
                  {parsed.map((b, i) => (
                    <li key={i} className={b.ok ? '' : 'bad'} title={b.ok ? b.raw : 'Nom de bot invalide'}>@{b.name || b.raw}</li>
                  ))}
                </ul>
              )}

              <div className="row3">
                <label className="field">Profil<input value={opts.profile} onChange={set('profile')} /></label>
                <label className="field">Attente (s)<input type="number" min="0.5" max="60" step="0.5" value={opts.wait} onChange={set('wait')} /></label>
                <label className="field">Actions max<input type="number" min="1" max="5000" value={opts.maxActions} onChange={set('maxActions')} /></label>
              </div>

              <div className="toggles">
                <Toggle checked={opts.resume} onChange={set('resume')}>Reprendre les captures existantes</Toggle>
                <Toggle checked={opts.noMedia} onChange={set('noMedia')}>Sans images</Toggle>
                <Toggle checked={opts.noCommands} onChange={set('noCommands')}>Sans commandes trouvées dans les textes</Toggle>
              </div>

              <details className="advanced">
                <summary>Options avancées</summary>
                <p className="muted small">
                  Par défaut, rien qui ressemble à un achat, un paiement, un panier ou une suppression n'est joué
                  (buy, pay, order, cart, confirm, delete, cancel, panier, payer…).
                </p>
                <label className="field">Ignorer en plus (regex, une par ligne)
                  <textarea rows="2" value={opts.skip} onChange={set('skip')} spellCheck="false" />
                </label>
                <label className="field">Autoriser malgré les exclusions (regex, une par ligne)
                  <textarea rows="2" value={opts.allow} onChange={set('allow')} spellCheck="false" placeholder="^/cart$" />
                </label>
              </details>
            </div>
          </div>

          <div className="run">
            {busy
              ? <button className="btn danger wide" onClick={stop}>Arrêter</button>
              : <button className="btn primary wide" disabled={!parsed.length || invalid > 0} onClick={explore}>
                  {parsed.length > 1 ? `Explorer ${parsed.length} bots` : 'Explorer'}
                </button>}
            {invalid > 0 && <p className="hint bad">{invalid} nom{invalid > 1 ? 's' : ''} invalide{invalid > 1 ? 's' : ''}.</p>}
          </div>
        </section>

        <section className="panel journal">
          <div className="row-head">
            <h2>Journal</h2>
            {busy && <span className="muted small">{state.name}</span>}
          </div>
          <Console lines={lines} />
        </section>
      </div>

      <section className="panel">
        <div className="row-head">
          <h2>Captures <span className="count">{captures.length}</span></h2>
          <div className="mode" role="radiogroup" aria-label="Mode des imports">
            <button role="radio" aria-checked={dry} className={dry ? 'sel' : ''} onClick={() => setDry(true)}>Essai</button>
            <button role="radio" aria-checked={!dry} className={!dry ? 'sel real' : ''} onClick={() => setDry(false)}>Écriture réelle</button>
          </div>
          <button className="btn" onClick={refresh}>Actualiser</button>
        </div>
        <p className={`small mode-note ${dry ? 'muted' : 'bad'}`}>
          {dry ? 'Imports en essai (--dry) : rien n\'est écrit dans la base du backend.'
            : 'Les imports écrivent dans la base du backend. Une confirmation est demandée.'}
        </p>
        {captures.length === 0
          ? <div className="empty-state">Aucune capture pour l'instant. Lancez une exploration ci-dessus.</div>
          : <div className="cards">{captures.map((c) => (
            <CaptureCard key={c.name} c={c} busy={busy} onResume={resume} onImport={importCapture} />
          ))}</div>}
      </section>
    </div>
  );
}
