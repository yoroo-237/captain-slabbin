import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { adminFetch } from '../pages/admin/utils/api.js'

// Captures: what tg-explorer does on a PC, run by the bots platform's server.
// The platform's Telegram account browses a bot and records its screens, buttons
// and pictures; the capture then gives a style and products to this platform.
const api = (path, body) => adminFetch(`/admin/capture${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })

const DEFAULTS = { profile: 'explorer', wait: '2.5', maxActions: '200', skip: '', allow: '',
  fresh: false, noMedia: false, noCommands: false, strict: false }

// Same rules as the server: @bot, bot, t.me/bot?start=x all give 'bot'
const BOT = /^[A-Za-z][A-Za-z0-9_]{2,63}$/
const normalizeBot = x => x.trim().replace(/^(https?:\/\/)?(t|telegram)\.me\//, '').split('?')[0].replace(/\/+$/, '').replace(/^@/, '')

// The running task's output, live. EventSource cannot send the admin's token, so
// the stream is read with fetch; it reconnects after a drop.
function useTask() {
  const [state, setState] = useState({ running: false, name: null })
  const [lines, setLines] = useState([])
  const onDone = useRef(() => {})
  const running = useRef(false)
  useEffect(() => {
    let alive = true
    let ctrl
    const apply = s => {
      if (running.current && !s.running) onDone.current()
      running.current = s.running
      setState(s)
    }
    const handle = (event, data) => {
      if (event === 'init') { apply(data.state); setLines(data.log) }
      if (event === 'line') setLines(l => [...l.slice(-2999), data])
      if (event === 'state') apply(data)
    }
    async function connect() {
      while (alive) {
        ctrl = new AbortController()
        try {
          const res = await fetch('/api/admin/capture/events', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, signal: ctrl.signal })
          // An expired token: any API call renews it, then the stream starts again
          if (res.status === 401) await api('/state').catch(() => {})
          if (!res.ok || !res.body) throw new Error(String(res.status))
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
          let buf = ''
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buf += value
            let cut
            while ((cut = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, cut)
              buf = buf.slice(cut + 2)
              const event = /^event: (.*)$/m.exec(block)?.[1]
              const data = /^data: (.*)$/m.exec(block)?.[1]
              if (event && data) handle(event, JSON.parse(data))
            }
          }
        } catch { /* dropped or token refreshed: try again */ }
        if (alive) await new Promise(r => setTimeout(r, 3000))
      }
    }
    connect()
    return () => { alive = false; ctrl?.abort() }
  }, [])
  return { state, lines, onDone }
}

const lineKind = l => (l.startsWith('$ ') ? 'cmd'
  : /^-- terminé \(code 0\)/.test(l) ? 'ok'
  : /^-- terminé|erreur|error|impossible|inaccessible|traceback/i.test(l) ? 'err'
  : /^==|^Rapport|^Reprise|Arrêt demandé/.test(l) ? 'info' : '')

function Console({ lines }) {
  const box = useRef(null)
  const stick = useRef(true)
  // Follow the output only while the reader is at the bottom
  useLayoutEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight }, [lines])
  const onScroll = () => { const el = box.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24 }
  return (
    <div className="console" ref={box} onScroll={onScroll} role="log" aria-live="polite">
      {lines.length
        ? lines.map((l, i) => <div key={i} className={`ln ${lineKind(l)}`}>{l}</div>)
        : <div className="ln empty">La sortie des tâches apparaît ici.</div>}
    </div>
  )
}

function Toggle({ checked, onChange, children }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="track" aria-hidden="true" />
      <span>{children}</span>
    </label>
  )
}

// The signed-in staff member's own Telegram API keys (my.telegram.org): needed
// once, before their Telegram account can be connected
function ApiKeys({ keys, onSaved, setError }) {
  const [open, setOpen] = useState(false)
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setApiId(keys?.apiId || '') }, [keys])
  if (!keys) return null
  const editing = open || !keys.configured
  const save = async e => {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      await adminFetch('/admin/capture/api-keys', { method: 'PUT', body: JSON.stringify({ apiId, apiHash }) })
      setApiHash(''); setOpen(false); onSaved()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  if (!editing) {
    return (
      <p className="small muted">Clés API Telegram : api_id <b style={{ color: 'var(--text)' }}>{keys.apiId}</b>, api_hash enregistré.
        <button className="link" onClick={() => setOpen(true)}>Changer</button></p>
    )
  }
  return (
    <form className="signin" onSubmit={save}>
      <p className="small muted">
        Vos clés API Telegram, une seule fois : sur <a href="https://my.telegram.org" target="_blank" rel="noreferrer">my.telegram.org</a>,
        connectez-vous avec votre numéro, ouvrez « API development tools », créez une application (nom libre),
        puis copiez « App api_id » et « App api_hash ». Elles restent sur votre compte du dashboard.
      </p>
      <div className="row3">
        <label className="field">api_id<input inputMode="numeric" value={apiId} onChange={e => setApiId(e.target.value)} required /></label>
        <label className="field">api_hash<input autoComplete="off" spellCheck="false" value={apiHash} onChange={e => setApiHash(e.target.value)} required /></label>
      </div>
      <div className="actions">
        <button className="btn primary sm" disabled={saving}>{saving ? '…' : 'Enregistrer les clés'}</button>
        {keys.configured && <button type="button" className="btn sm" onClick={() => setOpen(false)}>Annuler</button>}
      </div>
    </form>
  )
}

// The staff member's Telegram account: phone, then the code Telegram sends to
// the app, then the 2FA password when the account has one
function Account({ account, checking, profile, setProfile, busy, onCheck, onSignedIn, setError }) {
  const cfg = account?.config
  const current = account?.profiles?.find(p => p.name === profile)
  const others = (account?.profiles || []).filter(p => p.name !== profile)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [stage, setStage] = useState('phone') // phone | code | password
  const [working, setWorking] = useState(false)
  const step = async fn => { setError(''); setWorking(true); try { await fn() } catch (e) { setError(e.message) } finally { setWorking(false) } }

  const send = () => step(async () => {
    const r = await api('/account/send-code', { profile, phone })
    if (r.error) throw new Error(r.error)
    setStage('code')
  })
  const signIn = () => step(async () => {
    const r = await api('/account/sign-in', { profile, code, password })
    if (r.need_password) setStage('password')
    if (r.error) throw new Error(r.error)
    if (r.ok) { setStage('phone'); setCode(''); setPassword(''); onSignedIn() }
  })
  const signOut = () => step(async () => {
    if (!window.confirm(`Fermer la session « ${profile} » ? Il faudra se reconnecter (code Telegram) pour capturer avec ce profil.`)) return
    await api('/account/sign-out', { profile })
  })

  return (
    <div className="account">
      {account?.error && <p className="bad small">{account.error}</p>}

      <div className={`who ${current?.authorized ? 'ok' : ''}`}>
        <span className="avatar" aria-hidden="true">{current?.authorized ? (current.first_name || '?').slice(0, 1) : '–'}</span>
        <div className="who-text">
          {checking && !current ? <b>Vérification…</b>
            : current?.authorized ? <><b>{current.first_name}</b>{current.username && <span className="muted"> @{current.username}</span>}
                <div className="small muted">{current.phone} · profil « {profile} »</div></>
            : <><b>Non connecté</b><div className="small muted">{current?.error || `Aucune session pour le profil « ${profile} ».`}</div></>}
        </div>
        <div className="actions">
          <button className="btn sm" onClick={onCheck} disabled={checking} title="Relire la session">{checking ? '…' : '↻'}</button>
          {current?.authorized && <button className="btn sm" disabled={busy || working} onClick={signOut}>Changer de compte</button>}
        </div>
      </div>

      {!current?.authorized && cfg?.api && (
        <div className="signin">
          {stage === 'phone' && (
            <div className="row">
              <label className="field">Numéro du compte Telegram
                <input inputMode="tel" placeholder="+33600000000" value={phone} onChange={e => setPhone(e.target.value)} />
              </label>
              <button className="btn primary" disabled={working || busy || !phone} onClick={send}>{working ? '…' : 'Recevoir le code'}</button>
            </div>
          )}
          {stage === 'code' && (
            <div className="row">
              <label className="field">Code reçu dans Telegram
                <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} autoFocus />
              </label>
              <button className="btn primary" disabled={working || !code} onClick={signIn}>{working ? '…' : 'Valider'}</button>
            </div>
          )}
          {stage === 'password' && (
            <div className="row">
              <label className="field">Mot de passe 2FA du compte
                <input type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} autoFocus />
              </label>
              <button className="btn primary" disabled={working || !password} onClick={signIn}>{working ? '…' : 'Valider'}</button>
            </div>
          )}
          {stage !== 'phone' && <button className="link small" style={{ justifySelf: 'start' }} onClick={() => setStage('phone')}>Recommencer avec un autre numéro</button>}
          <p className="muted small">
            Telegram envoie le code dans son application (téléphone ou Desktop), pas par SMS. La session reste sur le serveur
            de la plateforme, à votre nom : les autres admins ne l'utilisent pas.
          </p>
        </div>
      )}

      <div className="profile-row">
        <label className="field" style={{ maxWidth: 240 }}>Profil de session
          <input value={profile} onChange={e => { setProfile(e.target.value); setStage('phone') }} list="profiles" spellCheck="false" />
        </label>
        <datalist id="profiles">{(account?.profiles || []).map(p => <option key={p.name} value={p.name} />)}</datalist>
        {others.length > 0 && (
          <p className="small muted">Autres sessions : {others.map(p => (
            <button key={p.name} className="link" onClick={() => setProfile(p.name)}>
              {p.name}{p.authorized ? ` (${p.first_name})` : ' (déconnectée)'}
            </button>
          ))}</p>
        )}
      </div>
    </div>
  )
}

function CaptureCard({ c, files, busy, onResume, onImport, onRemove }) {
  const updated = new Date(c.updated).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
  const report = `${files}/${c.name}/report.html`
  return (
    <article className="card">
      <a className="cover" href={report} target="_blank" rel="noreferrer" aria-label={`Rapport de @${c.name}`}>
        {c.cover ? <img src={`${files}/${c.name}/media/${encodeURIComponent(c.cover)}`} alt="" loading="lazy" /> : <span>@{c.name.slice(0, 2)}</span>}
      </a>
      <div className="card-body">
        <div className="card-title">
          <h3>@{c.name}</h3>
          <time className="mono muted" dateTime={c.updated}>{updated}</time>
        </div>
        <ul className="stats">
          <li><b>{c.screens}</b> écrans</li>
          <li><b>{c.images}</b> images</li>
          <li><b>{c.steps}</b> actions</li>
          {c.ignored > 0 && <li title="Actions ignorées par la liste d'exclusion"><b>{c.ignored}</b> ignorées</li>}
          {c.queued > 0 && <li className="warn"><b>{c.queued}</b> en attente</li>}
        </ul>
        <div className="actions">
          <a className="btn sm" href={report} target="_blank" rel="noreferrer">Rapport <span className="arrow" aria-hidden="true">↗</span></a>
          {c.queued > 0 && <button className="btn sm" disabled={busy} onClick={() => onResume(c.name)}>Reprendre</button>}
          <span className="spacer" />
          <button className="btn sm" disabled={busy} onClick={() => onRemove(c.name)} title="Supprimer la capture">×</button>
        </div>
        <div className="actions">
          <button className="btn sm" disabled={busy} onClick={() => onImport(c.name, 'style')}>Importer le style</button>
          <button className="btn sm" disabled={busy} onClick={() => onImport(c.name, 'products')}>Importer les produits</button>
        </div>
      </div>
    </article>
  )
}

export default function CapturePage() {
  const { state, lines, onDone } = useTask()
  const [bots, setBots] = useState('')
  const [opts, setOpts] = useState(DEFAULTS)
  const [captures, setCaptures] = useState([])
  const [filesKey, setFilesKey] = useState('')
  const [styles, setStyles] = useState([])
  const [dry, setDry] = useState(true)
  const [style, setStyle] = useState('')
  const [catalog, setCatalog] = useState('')
  const [error, setError] = useState('')
  const set = key => e => setOpts(o => ({ ...o, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const refresh = useCallback(() => api('/captures').then(d => { setCaptures(d.captures); setFilesKey(d.key) }).catch(e => setError(e.message)), [])
  const loadStyles = useCallback(() => adminFetch('/admin/telegram').then(d => setStyles(d.styles || [])).catch(() => {}), [])
  useEffect(() => { refresh(); loadStyles() }, [refresh, loadStyles])

  // ---- account: the session explore.py will use ----
  const [account, setAccount] = useState(null)
  const [keys, setKeys] = useState(null)
  const [checking, setChecking] = useState(false)
  const profileRef = useRef(opts.profile)
  profileRef.current = opts.profile
  const checkAccount = useCallback(async () => {
    setChecking(true)
    try {
      const a = await api(`/account?profile=${encodeURIComponent(profileRef.current || 'explorer')}`)
      setAccount(a)
      if (a.config?.bot) setBots(b => b || a.config.bot)
      return a
    } catch (e) { setError(e.message); return null } finally { setChecking(false) }
  }, [])
  const loadKeys = useCallback(() => api('/api-keys').then(setKeys).catch(e => setError(e.message)), [])
  useEffect(() => { checkAccount(); loadKeys() }, [checkAccount, loadKeys])
  useEffect(() => { onDone.current = () => { refresh(); checkAccount(); loadStyles() } }, [onDone, refresh, checkAccount, loadStyles])

  const parsed = useMemo(() => bots.split(/\s+/).filter(Boolean).map(raw => {
    const name = normalizeBot(raw)
    return { raw, name, ok: BOT.test(name) }
  }), [bots])
  const invalid = parsed.filter(b => !b.ok).length

  const guard = fn => async (...args) => {
    setError('')
    try { await fn(...args) } catch (e) { setError(e.message) }
  }
  const resume = guard(name => api('/explore', { ...opts, fresh: false, bots: [name] }))
  const explore = guard(async () => {
    if (opts.fresh && !window.confirm('Tout recommencer efface les captures existantes de ces bots et rejoue toutes les actions. Continuer ?')) return
    await api('/explore', { ...opts, bots: parsed.map(b => b.name) })
  })
  const current = account?.profiles?.find(p => p.name === opts.profile)
  const connected = !!current?.authorized
  const stop = guard(() => api('/stop', {}))
  const remove = guard(async name => {
    if (!window.confirm(`Supprimer la capture de @${name} (écrans, images, file d'attente) ? Ce qui a déjà été importé reste.`)) return
    await adminFetch(`/admin/capture/captures/${encodeURIComponent(name)}`, { method: 'DELETE' })
    refresh()
  })
  const importCapture = guard(async (bot, kind) => {
    const source = (catalog || bot).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
    const target = kind === 'style' ? (style ? `les pages du style « ${style} »` : 'un nouveau style « Imported bot »') : `les produits dans le catalogue « ${source} »`
    if (!dry && !window.confirm(`Importer ${target} depuis @${bot} (écriture réelle) ?`)) return
    await api('/import', { bot, kind, dry, style: kind === 'style' ? style : '', catalog: source })
  })

  const busy = state.running
  const files = `/api/capture-files/${filesKey}`
  return (
    <>
      <header className="hero">
        <p className="mono muted">Bots · Telegram · Captures</p>
        <h1>Capture de <em className="serif accent">bots</em></h1>
        <p className="lead muted">Parcourt un bot avec le compte Telegram de la plateforme, enregistre ses écrans, ses boutons et ses images, puis applique son style et ses produits à vos bots.</p>
        <span className={`status ${busy ? 'on' : ''}`} role="status" style={{ justifySelf: 'start' }}>
          <span className="pulse" aria-hidden="true" />{busy ? `${state.name} en cours` : 'Inactif'}
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
          <h2><span className="idx">01</span>Nouvelle capture</h2>

          <div className="step">
            <span className="num">1</span>
            <div className="step-body">
              <h3>Votre compte Telegram</h3>
              <ApiKeys keys={keys} setError={setError} onSaved={() => { loadKeys(); checkAccount() }} />
              {keys?.configured && <Account account={account} checking={checking} profile={opts.profile} busy={busy} setError={setError}
                setProfile={v => setOpts(o => ({ ...o, profile: v }))} onCheck={checkAccount} onSignedIn={checkAccount} />}
            </div>
          </div>

          <div className="step">
            <span className="num">2</span>
            <div className="step-body">
              <h3>Bots à parcourir</h3>
              <label className="field">
                <span className="sr">Bots</span>
                <textarea rows="3" value={bots} onChange={e => setBots(e.target.value)} spellCheck="false"
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
                <label className="field">Attente (s)<input type="number" min="0.5" max="60" step="0.5" value={opts.wait} onChange={set('wait')} /></label>
                <label className="field">Actions max<input type="number" min="1" max="20000" value={opts.maxActions} onChange={set('maxActions')} /></label>
              </div>

              <div className="toggles">
                <Toggle checked={opts.fresh} onChange={set('fresh')}>Tout recommencer (sinon une capture existante reprend là où elle s'est arrêtée, sans rejouer ce qui est fait)</Toggle>
                <Toggle checked={opts.noMedia} onChange={set('noMedia')}>Sans images</Toggle>
                <Toggle checked={opts.noCommands} onChange={set('noCommands')}>Sans commandes trouvées dans les textes</Toggle>
                <Toggle checked={opts.strict} onChange={set('strict')}>Mode strict (ignorer achats, paiements, panier, commandes, dépôt…)</Toggle>
              </div>

              <details className="advanced">
                <summary>Options avancées</summary>
                <p className="muted small">
                  Par défaut, seul ce qui supprime, vide ou retire est ignoré (delete, remove, clear, withdraw,
                  supprimer, retirer, vider, effacer). Achats, panier, paiements et confirmations sont joués :
                  activez le mode strict si le bot a un vrai solde.
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
              : <button className="btn primary wide" disabled={!parsed.length || invalid > 0 || !connected} onClick={explore}>
                  {parsed.length > 1 ? `Explorer ${parsed.length} bots` : 'Explorer'}
                  {connected && current.first_name ? ` avec ${current.first_name}` : ''}
                  <span className="arrow" aria-hidden="true">→</span>
                </button>}
            {invalid > 0 && <p className="hint bad">{invalid} nom{invalid > 1 ? 's' : ''} invalide{invalid > 1 ? 's' : ''}.</p>}
            {!busy && account && !connected && <p className="hint muted">Connectez d'abord un compte (étape 1).</p>}
          </div>
        </section>

        <section className="panel journal dark">
          <div className="row-head">
            <h2><span className="idx">02</span>Journal</h2>
            {busy && <span className="mono" style={{ color: 'var(--muted-dark)' }}>{state.name}</span>}
          </div>
          <Console lines={lines} />
        </section>
      </div>

      <section className="panel">
        <div className="row-head">
          <h2><span className="idx">03</span>Captures <span className="count">{captures.length}</span></h2>
          <div className="mode" role="radiogroup" aria-label="Mode des imports">
            <button role="radio" aria-checked={dry} className={dry ? 'sel' : ''} onClick={() => setDry(true)}>Essai</button>
            <button role="radio" aria-checked={!dry} className={!dry ? 'sel real' : ''} onClick={() => setDry(false)}>Écriture réelle</button>
          </div>
          <button className="btn" onClick={refresh}>Actualiser</button>
        </div>
        <p className={`small mode-note ${dry ? 'muted' : 'bad'}`}>
          {dry ? 'Imports en essai : le journal montre ce qui serait fait, rien n’est écrit.'
            : 'Les imports écrivent dans la base de la plateforme. Une confirmation est demandée.'}
        </p>
        <div className="import-opts">
          <label className="field">« Importer le style » met à jour
            <select value={style} onChange={e => setStyle(e.target.value)}>
              <option value="">Un nouveau style « Imported bot »</option>
              {styles.map(s => <option key={s.id} value={s.name}>Le style « {s.name} »</option>)}
            </select>
          </label>
          <label className="field">« Importer les produits » dans le catalogue
            <input value={catalog} onChange={e => setCatalog(e.target.value)} placeholder="vide = le nom du bot capturé" spellCheck="false" />
          </label>
        </div>
        <p className="small muted">
          {style ? `Seules les pages d'information et les images d'accueil et de menu de « ${style} » sont remplacées ; rayons, textes et panier restent. Une clé PGP de la capture n'est jamais copiée.`
            : 'Crée ou remplace entièrement le style « Imported bot ».'}
          {' '}Le style s'applique ensuite à un bot dans l'onglet Bots ; un catalogue se donne à un bot par son style.
        </p>
        {captures.length === 0
          ? <div className="empty-state" style={{ marginTop: 18 }}>Aucune capture pour l'instant. Lancez une exploration ci-dessus.</div>
          : <div className="cards">{captures.map(c => (
            <CaptureCard key={c.name} c={c} files={files} busy={busy} onResume={resume} onImport={importCapture} onRemove={remove} />
          ))}</div>}
      </section>
    </>
  )
}
