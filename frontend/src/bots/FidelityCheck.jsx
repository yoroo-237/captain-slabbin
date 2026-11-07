import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminFetch } from '../pages/admin/utils/api.js'
import { useUi } from './ui.jsx'
import { L } from './i18n.js'

// Fidelity check of a capture, crossroad by crossroad: every route (button, typed
// text, menu command) of every screen with buttons, whether the capture followed
// it and whether the replica style has it. Routes not covered can be picked and run
// again: the capture goes back to their crossroad (the nearest one still shown,
// never all the way from /start when it can avoid it) and presses them.
const STATUS = {
  captured: ['ok', () => L('capturée', 'captured')],
  end: ['ok', () => L('jouée, sans nouvel écran', 'played, no new screen')],
  equivalent: ['mute', () => L('déjà couverte', 'already covered')],
  pending: ['warn', () => L('en attente', 'queued')],
  failed: ['bad', () => L('échouée', 'failed')],
  missing: ['bad', () => L('manquante', 'missing')],
  ignored: ['mute', () => L('exclue', 'skipped')],
  link: ['mute', () => L('lien', 'link')],
  disabled: ['mute', () => L('désactivée', 'disabled')],
}
const REPLICA = {
  copied: ['ok', () => L('copiée', 'copied')],
  not_copied: ['bad', () => L('absente de la réplique', 'not in the replica')],
  broken: ['bad', () => L('lien cassé', 'broken link')],
  no_page: ['bad', () => L('page absente', 'no page')],
  not_in_menu: ['bad', () => L('absente du menu', 'not in the menu')],
}
// What differs between a screen and its page in the replica
const ISSUE = {
  page: () => L('page absente de la réplique', 'no page in the replica'),
  text: () => L('texte différent', 'different text'),
  image: () => L('image manquante', 'picture missing'),
  keyboard: () => L('clavier manquant', 'keyboard missing'),
  reply: () => L('réponse forcée manquante', 'forced reply missing'),
}
const Pill = ({ map, value, title }) => {
  if (!value || !map[value]) return null
  const [tone, label] = map[value]
  return <span className={`fc-pill ${tone}`} title={title || undefined}>{label()}</span>
}
const PROBLEM = new Set(['pending', 'failed', 'missing'])
const isProblem = r => PROBLEM.has(r.status) || ['not_copied', 'broken', 'no_page', 'not_in_menu'].includes(r.replica)
const idOf = (c, r) => `${c?.key || 'cmd'}|${r.label || r.command}`

// `rebuild`: the style the routes run again are rebuilt into once done (the site's
// update page); without it the capture is only completed
export default function FidelityCheck({ bot, busy, tick, onRetried, rebuild }) {
  const { notify } = useUi()
  const [style, setStyle] = useState(rebuild ? String(rebuild) : '')
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [all, setAll] = useState(false)
  const [picked, setPicked] = useState(() => new Map())

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const q = new URLSearchParams({ ...(style ? { style } : {}), ...(rebuild ? { catalog: rebuild } : {}) }).toString()
      const r = await adminFetch(`/admin/capture/captures/${encodeURIComponent(bot)}/check${q ? `?${q}` : ''}`)
      setReport(r); setPicked(new Map())
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [bot, style])
  useEffect(() => { load() }, [load, tick])

  const retryable = useMemo(() => {
    if (!report) return []
    return [...report.crossroads.flatMap(c => c.routes.filter(r => r.retry).map(r => [idOf(c, r), r.retry])),
      ...report.commands.filter(c => c.retry).map(c => [idOf(null, c), c.retry])]
  }, [report])
  const toggle = (id, retry) => setPicked(p => { const n = new Map(p); n.has(id) ? n.delete(id) : n.set(id, retry); return n })
  const pickAll = () => setPicked(p => (p.size === retryable.length ? new Map() : new Map(retryable)))

  async function retry() {
    try {
      await adminFetch(`/admin/capture/captures/${encodeURIComponent(bot)}/retry`, { method: 'POST', body: JSON.stringify({ items: [...picked.values()], ...(rebuild ? { styleId: rebuild } : {}) }) })
      notify(L(`${picked.size} route(s) relancée(s) : suivez le journal plus haut.`, `${picked.size} route(s) run again: follow the journal above.`), 'info')
      setPicked(new Map())
      onRetried?.()
    } catch (e) { notify(e.message, 'err') }
  }

  // The catalog's photos (a style that sells products captured from its bot)
  async function uploadMissing() {
    try {
      await adminFetch(`/admin/capture/styles/${rebuild}/images`, { method: 'POST', body: '{}' })
      notify(L('Import des images lancé : suivez le journal plus haut.', 'Image upload started: follow the journal above.'), 'info')
      onRetried?.()
    } catch (e) { notify(e.message, 'err') }
  }
  const photos = report?.images
  const byStatus = st => (photos?.missing || []).filter(p => p.status === st)

  const s = report?.summary
  const rep = s?.replica
  const shown = report ? report.crossroads.map(c => ({ ...c, routes: all ? c.routes : c.routes.filter(isProblem) })).filter(c => all || c.routes.length || c.issues?.length) : []
  const commands = report ? report.commands.filter(c => all || isProblem(c)) : []

  return (
    <section className="panel fc" id="check">
      <div className="row-head">
        <h2><span className="idx">04</span>{L('Vérification', 'Check')} <span className="count">@{bot}</span></h2>
        <div className="fc-head-actions">
          {report?.styles?.length > 0 && (
            <select value={style || report.summary.replica?.style.id || ''} onChange={e => setStyle(e.target.value)} aria-label={L('Réplique comparée', 'Replica compared')}>
              {report.styles.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          )}
          <button className="btn" onClick={load} disabled={loading}>{loading ? L('Analyse…', 'Checking…') : L('Actualiser', 'Refresh')}</button>
        </div>
      </div>
      <p className="small muted" style={{ marginTop: -8 }}>
        {L('Chaque écran qui a des routes (boutons, textes du clavier, commandes écrites dans le texte) est un carrefour. Pour chaque route : la capture l’a-t-elle suivie, et la réplique l’a-t-elle ? Pour chaque écran : sa page dans la réplique a-t-elle le même texte, la même image, le même clavier ? Cochez les routes à relancer : la capture revient au carrefour le plus proche encore affiché.',
          'Each screen with routes (buttons, keyboard texts, commands written in its text) is a crossroad. For each route: did the capture follow it, and does the replica have it? For each screen: does its page in the replica have the same text, picture and keyboard? Tick the routes to run again: the capture goes back to the nearest crossroad still shown.')}
      </p>
      {error && <div className="alert err">{error}</div>}
      {s && (
        <>
          <div className="fc-tiles">
            <div className={`fc-tile ${s.coverage >= 95 ? 'ok' : s.coverage >= 70 ? 'warn' : 'bad'}`}>
              <b>{s.coverage}%</b><span>{L('routes couvertes', 'routes covered')}</span><small>{s.covered} / {s.routes} · {s.crossroads} {L('carrefours', 'crossroads')} · {s.screens} {L('écrans', 'screens')}</small>
              {s.textCommands > 0 && <small>{L(`dont ${s.textCommands} commandes écrites dans les textes`, `including ${s.textCommands} commands written in texts`)}</small>}
            </div>
            {rep
              ? <div className={`fc-tile ${rep.fidelity >= 95 ? 'ok' : rep.fidelity >= 70 ? 'warn' : 'bad'}`}>
                <b>{rep.fidelity}%</b><span>{L('copié dans la réplique', 'copied in the replica')}</span>
                <small>{rep.copied} {L('routes copiées', 'routes copied')} · {rep.notCopied} {L('absentes', 'missing')} · {rep.broken} {L('cassées', 'broken')}</small>
                <small>{[rep.missingPages && `${rep.missingPages} ${L('pages absentes', 'pages missing')}`, rep.content.text && `${rep.content.text} ${L('textes différents', 'different texts')}`,
                  rep.content.image && `${rep.content.image} ${L('images manquantes', 'pictures missing')}`, rep.content.keyboard && `${rep.content.keyboard} ${L('claviers manquants', 'keyboards missing')}`,
                  rep.content.reply && `${rep.content.reply} ${L('réponses forcées manquantes', 'forced replies missing')}`, !rep.home && L('pas de page d’accueil (/start)', 'no home page (/start)')].filter(Boolean).join(' · ') || L('écrans identiques', 'screens identical')}</small>
              </div>
              : <div className="fc-tile mute"><b>–</b><span>{L('aucune réplique de ce bot', 'no replica of this bot')}</span><small>{L('« Répliquer le bot » pour comparer', '“Replicate the bot” to compare')}</small></div>}
            <ul className="fc-counts">
              <li><Pill map={STATUS} value="captured" /> {s.captured}</li>
              <li><Pill map={STATUS} value="end" /> {s.end}</li>
              <li><Pill map={STATUS} value="equivalent" /> {s.equivalent}</li>
              <li><Pill map={STATUS} value="pending" /> {s.pending}</li>
              <li><Pill map={STATUS} value="failed" /> {s.failed}</li>
              <li><Pill map={STATUS} value="missing" /> {s.missing}</li>
            </ul>
          </div>

          {photos && (
            <div className="fc-photos" style={{ margin: '12px 0' }}>
              <h3 style={{ margin: '0 0 4px' }}>{L('Photos des produits', 'Product photos')} <span className="count">{photos.withPhoto} / {photos.products}</span></h3>
              {photos.missing.length === 0 ? <p className="small muted">{L('Chaque produit du catalogue a sa photo.', 'Every product of the catalog has its photo.')}</p> : (
                <>
                  {byStatus('upload').length > 0 && (
                    <p className="small">
                      <b>{byStatus('upload').length}</b> {L('photo(s) déjà dans la capture, pas encore en ligne :', 'photo(s) already in the capture, not online yet:')} {byStatus('upload').map(p => p.name).join(' · ')}{' '}
                      <button className="btn sm primary" disabled={busy || !rebuild} onClick={uploadMissing}>{L('Les envoyer', 'Upload them')}</button>
                    </p>
                  )}
                  {byStatus('recapture').length > 0 && (
                    <div className="small">
                      <b>{byStatus('recapture').length}</b> {L('page(s) capturée(s) sans image : cochez-les puis « Relancer » pour les capturer à nouveau', 'page(s) captured without their picture: tick them, then “Run again” to capture them again')}
                      <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                        {byStatus('recapture').map(p => (
                          <li key={p.id}>
                            {p.retry ? <input type="checkbox" checked={picked.has(`img|${p.id}`)} onChange={() => toggle(`img|${p.id}`, p.retry)} aria-label={L(`Recapturer ${p.name}`, `Capture ${p.name} again`)} /> : null}{' '}
                            {p.name}{!p.retry && <span className="muted"> · {L('chemin inconnu', 'way unknown')}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {byStatus('absent').length > 0 && (
                    <p className="small muted">
                      <b>{byStatus('absent').length}</b> {L('produit(s) introuvable(s) dans cette capture (retirés du bot, ou pages pas encore atteintes : « Update ») :', 'product(s) not found in this capture (gone from the bot, or pages not reached yet: “Update”):')} {byStatus('absent').map(p => p.name).join(' · ')}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <div className="fc-bar">
            <label className="fc-check"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> {L('Tout afficher (sinon : seulement ce qui manque)', 'Show everything (else: only what is missing)')}</label>
            <span className="spacer" />
            {retryable.length > 0 && <button className="btn sm" onClick={pickAll}>{picked.size === retryable.length ? L('Tout décocher', 'Untick all') : L(`Cocher les ${retryable.length} relançables`, `Tick the ${retryable.length} retryable`)}</button>}
            <button className="btn sm primary" disabled={!picked.size || busy} onClick={retry}>{L(`Relancer ${picked.size || ''} route(s)`, `Run ${picked.size || ''} route(s) again`)}</button>
          </div>

          {shown.length === 0 && commands.length === 0 && <div className="empty-state">{L('Rien ne manque : toutes les routes ont été suivies et copiées.', 'Nothing missing: every route was followed and copied.')}</div>}

          <ol className="fc-list">
            {shown.map(c => (
              <li key={c.key} className="fc-x">
                <div className="fc-x-head">
                  <span className="mono muted">#{c.order}</span>
                  <b>{c.title}</b>
                  {c.personal && <span className="fc-pill mute">{L('jamais copié (anti-hameçonnage)', 'never copied (anti-phishing)')}</span>}
                  {c.leaf && <span className="fc-pill mute">{L('écran final', 'end screen')}</span>}
                  {(c.issues || []).map(i => <span key={i} className="fc-pill bad">{ISSUE[i]?.() || i}</span>)}
                </div>
                {c.path.length > 0 && <div className="fc-path mono">{c.path.join(' › ')}</div>}
                {c.routes.length > 0 && (
                  <ul className="fc-routes">
                    {c.routes.map((r, i) => {
                      const id = idOf(c, r)
                      return (
                        <li key={i}>
                          {r.retry ? <input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id, r.retry)} aria-label={L(`Relancer ${r.label}`, `Run ${r.label} again`)} /> : <span className="fc-nobox" />}
                          <span className={`fc-label${r.kind === 'command' ? ' mono' : ''}`}>{r.kind === 'keyboard' ? '⌨ ' : ''}{r.label}</span>
                          <Pill map={STATUS} value={r.status} title={r.error || r.alert || ''} />
                          {r.target && <span className="fc-target muted">→ {r.target.title}</span>}
                          {!r.retry && PROBLEM.has(r.status) && <span className="small muted">{L('chemin inconnu : relancez la capture', 'way unknown: run the capture again')}</span>}
                          <span className="spacer" />
                          <Pill map={REPLICA} value={r.replica} />
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ol>

          {commands.length > 0 && (
            <div className="fc-x">
              <div className="fc-x-head"><b>{L('Menu des commandes', 'Command menu')}</b></div>
              <ul className="fc-routes">
                {commands.map(c => {
                  const id = idOf(null, c)
                  return (
                    <li key={c.command}>
                      {c.retry ? <input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id, c.retry)} aria-label={L(`Relancer ${c.command}`, `Run ${c.command} again`)} /> : <span className="fc-nobox" />}
                      <span className="fc-label mono">{c.command}</span>
                      <Pill map={STATUS} value={c.status} />
                      {c.description && <span className="fc-target muted">{c.description}</span>}
                      <span className="spacer" />
                      <Pill map={REPLICA} value={c.replica} />
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
