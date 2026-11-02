import { useEffect, useState } from 'react'
import { messages } from './i18n.js'
import {
  api, session, readAsDataUrl, minWithProof,
  MAX_BATCH, SPREAD_STEP, MAX_SPREAD, MAX_FILES, MAX_BYTES, MAX_TOTAL_BYTES, MEDIA_ACCEPT,
} from './api.js'
import Admin from './Admin.jsx'
import Auth from './Auth.jsx'
import Wallet from './Wallet.jsx'
import { Progress, ProofPreview } from './Proof.jsx'

// Proof of each report of a send: media files and/or a message link, never shared
const emptyItems = () => Array.from({ length: MAX_BATCH }, () => ({ files: [], link: '' }))
const itemHasProof = (item, i, capture) => item.files.length > 0 || !!item.link.trim() || (i === 0 && capture)
// Files checked before sending (the server checks the bytes again): kind and size
const fileError = (files, maxFiles) => {
  if (files.length > maxFiles) return 'too_many_files'
  for (const f of files) {
    const kind = f.type.split('/')[0]
    const limit = MAX_BYTES[kind] ?? (/\.(ogg|oga|opus)$/i.test(f.name) ? MAX_BYTES.audio : null)
    if (!limit) return 'invalid_file'
    if (f.size > limit) return 'file_too_large'
  }
  return null
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const CAPTURE_POLL_MS = 1500
const CAPTURE_WAIT_MS = 5 * 60_000
// Spread period: always a multiple of SPREAD_STEP minutes, the nearest one
const snapSpread = (m) => Math.min(MAX_SPREAD, Math.max(0, Math.round(m / SPREAD_STEP) * SPREAD_STEP))
const fmtMinutes = (m) => (Number.isInteger(m) ? String(m) : m.toFixed(1))

const initialLang = () => {
  try {
    const saved = localStorage.getItem('lang')
    if (saved === 'fr' || saved === 'en') return saved
  } catch {}
  return navigator.language?.startsWith('fr') ? 'fr' : 'en'
}

const ROUTES = ['wallet', 'login', 'admin']
const currentRoute = () => {
  const r = window.location.hash.replace(/^#/, '')
  return ROUTES.includes(r) ? r : ''
}
const go = (route) => { window.location.hash = route }

export default function App() {
  const [lang, setLang] = useState(initialLang)
  const t = messages[lang]
  // Dates are written in the page language (captured messages, history)
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  const [route, setRoute] = useState(currentRoute)

  const [user, setUser] = useState(null)
  const [wallet, setWallet] = useState(null)
  const [pricing, setPricing] = useState(null)

  const [target, setTarget] = useState('')
  const [status, setStatus] = useState({ state: 'idle', message: '' })
  const [batch, setBatch] = useState(1)
  const [spread, setSpread] = useState(0)
  const [withProof, setWithProof] = useState(true)
  const [items, setItems] = useState(emptyItems)
  const [flow, setFlow] = useState(null) // progress of the report being sent
  const [proof, setProof] = useState(null) // capture shown under the bar

  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState([])
  const [stats, setStats] = useState({ targets: 0, reports: 0 })

  const changeLang = (l) => {
    setLang(l)
    document.documentElement.lang = l
    try { localStorage.setItem('lang', l) } catch {}
  }

  const reloadWallet = () => api('/api/wallet').then(setWallet).catch(() => {})

  const logout = () => {
    session.set(''); setUser(null); setWallet(null)
    if (['wallet', 'admin'].includes(currentRoute())) go('')
  }

  const signedIn = ({ token, user: u }) => {
    session.set(token); setUser(u)
    go(u.role === 'superadmin' ? 'admin' : '')
  }

  useEffect(() => {
    const onHash = () => setRoute(currentRoute())
    window.addEventListener('hashchange', onHash)
    window.addEventListener('scamwatch:logout', logout)
    if (session.token) api('/api/auth/me').then((r) => setUser(r.user)).catch(() => {})
    api('/api/pricing').then(setPricing).catch(() => {})
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('scamwatch:logout', logout)
    }
  }, [])

  useEffect(() => { if (user) reloadWallet() }, [user?.id])

  const loadTargets = (q = '') =>
    api(`/api/targets?q=${encodeURIComponent(q)}`).then(setTargets).catch(() => {})
  const loadStats = () => api('/api/stats').then(setStats).catch(() => {})

  useEffect(() => { loadTargets(); loadStats() }, [])

  // Debounced search
  useEffect(() => {
    const id = setTimeout(() => loadTargets(query), 250)
    return () => clearTimeout(id)
  }, [query])

  // Only the account: the server captures it and gives the report its type
  // count: 1 from the main button, 1 to MAX_BATCH from the batch button
  // spreadMinutes: the batch spread over a period (first report now, the others at a regular interval)
  const step = (patch) => setFlow((f) => ({ ...f, ...patch }))
  const fail = (code) => {
    step({ state: 'error', detail: '' })
    setStatus({ state: 'error', message: t.errors[code] || t.error, code })
  }
  const sent = (r, count = 1) => {
    const done = r.scheduled
      ? t.thanksSpread(count, r.scheduled, r.intervalMinutes, r.tokensSpent)
      : count > 1 ? t.thanksBatch(count, r.tokensSpent) : r.tokensSpent ? t.thanksPaid(r.tokensSpent) : t.thanks
    step({ state: 'ok', detail: r.withProof ? t.flow.sentWithProof(t.types[r.type] || r.type) : r.capturing ? t.capturing : '' })
    setStatus({ state: 'ok', message: done })
    setTarget('')
    // Back to one report at once, so the next send is never a batch by accident
    setBatch(1); setSpread(0); setItems(emptyItems())
    loadTargets(query); loadStats(); reloadWallet()
  }

  const setItem = (i, patch) => setItems((all) => all.map((it, j) => (j === i ? { ...it, ...patch } : it)))
  const pickFiles = (i, list) => {
    const files = [...list]
    const code = fileError(files, maxMedia)
    if (code) return setStatus({ state: 'error', message: t.errors[code] || t.error, code })
    setStatus({ state: 'idle', message: '' })
    setItem(i, { files })
  }
  // One entry per report: its own media (base64) and link
  const payloadItems = (count) => Promise.all(items.slice(0, count).map(async (it) => ({
    proofUrl: it.link.trim() || undefined,
    files: await Promise.all(it.files.map(readAsDataUrl)),
  })))

  // Without proof: sent and paid at once, the type comes later from a capture in the background.
  // count: 1 from the main button, 1 to MAX_BATCH from the batch button
  // spreadMinutes: the batch spread over a period (first report now, the others at a regular interval)
  const sendPlain = async (count = 1, spreadMinutes = 0) => {
    setFlow({ mode: 'plain', at: 0, state: 'run', detail: t.flow.sending })
    try {
      const r = await api('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ target, lang, items: await payloadItems(count), spreadMinutes: count > 1 ? spreadMinutes : 0 }),
      })
      sent(r, count)
    } catch (err) { fail(err.code) }
  }

  // With proof: the server captures the account, the form follows the capture,
  // shows it, then sends and pays the report (or the batch) with it
  const sendWithProof = async (count = 1, spreadMinutes = 0) => {
    setFlow({ mode: 'proof', at: 0, state: 'run', detail: t.flow.checking })
    try {
      const { captureId } = await api('/api/captures', { method: 'POST', body: JSON.stringify({ target }) })
      const start = Date.now()
      let c
      for (;;) {
        c = await api(`/api/captures/${captureId}`)
        if (c.status !== 'pending') break
        step({ at: 1, detail: c.ahead > 0 ? t.flow.queued(c.ahead) : t.flow.capturing })
        if (Date.now() - start > CAPTURE_WAIT_MS) return fail('capture_slow')
        await sleep(CAPTURE_POLL_MS)
      }
      if (c.status === 'failed') {
        step({ at: 1 })
        return fail(`capture_${c.error}`)
      }
      setProof(c)
      step({ at: 2, detail: t.flow.typeFound(t.types[c.detectedType] || c.detectedType) })
      await sleep(700) // time to read the type before the payment step
      step({ at: 3, detail: t.flow.sending })
      sent(await api('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ target, lang, captureId, items: await payloadItems(count), spreadMinutes: count > 1 ? spreadMinutes : 0 }),
      }), count)
    } catch (err) { fail(err.code) }
  }

  const submit = (e) => {
    e?.preventDefault()
    if (!user) return go('login')
    setStatus({ state: 'idle', message: '' }); setProof(null)
    return proofOn ? sendWithProof(batch, snapSpread(spread)) : sendPlain(batch, snapSpread(spread))
  }

  const isSuper = user?.role === 'superadmin'
  const cost = isSuper ? 0 : pricing?.reportCostTokens ?? 1
  const short = user && wallet && cost > 0 && wallet.tokens < cost
  const shortBatch = user && wallet && cost > 0 && wallet.tokens < cost * batch
  const sending = flow?.state === 'run'
  const proofAvailable = !!pricing?.proofCapture
  const proofOn = withProof && proofAvailable
  const limit = pricing?.maxReportsNoProof ?? 1
  // Media limits set by the super admin: files per report, MB for the whole send
  const maxMedia = pricing?.maxMediaPerReport ?? MAX_FILES
  const maxSendMb = pricing?.maxSendMb ?? MAX_TOTAL_BYTES / 1024 / 1024
  // Each report its own proof; in a batch at least a third carry one, within the size limit
  const used = items.slice(0, batch)
  const proofsNeeded = minWithProof(batch)
  const proofsGiven = used.filter((it, i) => itemHasProof(it, i, proofOn)).length
  const proofMissing = proofsGiven < proofsNeeded
  const tooHeavy = used.reduce((sum, it) => sum + it.files.reduce((s, f) => s + f.size, 0), 0) > maxSendMb * 1024 * 1024

  // Same form on the home page and in the super admin space
  const reportCard = (
    <section className="card">
      <h2>{t.reportTitle}</h2>
      <p className="cost">
        {isSuper ? t.costSuper : cost > 0 ? t.costLine(cost) : t.costFree}
        {user && wallet && cost > 0 && <span> · {t.balanceShort(wallet.tokens)}</span>}
      </p>
      {!user && (
        <p className="msg info">{t.loginToReport} <a href="#login" className="link">{t.auth.login}</a></p>
      )}
      {short && (
        <p className="msg error">{t.errors.insufficient_tokens} <a href="#wallet" className="link">{t.wallet.topUp}</a></p>
      )}
      <form onSubmit={submit}>
        <label>
          {t.target}
          <input
            value={target} placeholder={t.targetHint} required disabled={sending}
            onChange={(e) => { setTarget(e.target.value); if (flow?.state !== 'run') { setFlow(null); setProof(null); setStatus({ state: 'idle', message: '' }) } }}
          />
        </label>

        {/* With or without proof: the proof is a capture of the account taken now, before payment */}
        <label className="check">
          <input type="checkbox" checked={proofOn} disabled={!proofAvailable || sending} onChange={(e) => setWithProof(e.target.checked)} />
          <span>
            <b>{t.withProof}</b>
            <small>
              {!proofAvailable ? t.proofOff : proofOn ? t.withProofHint : t.noProofHint(isSuper ? 0 : limit)}
            </small>
          </span>
        </label>

        {/* Number of reports: 1 to MAX_BATCH on the same account, each with its own proof below */}
        {(
          <div className="spread">
            <span className="field-label">{t.batchCount}</span>
            <div className="stepper" role="group" aria-label={t.batchCount}>
              <button type="button" onClick={() => setBatch((n) => Math.max(1, n - 1))} disabled={batch <= 1 || sending} aria-label={t.batchLess}>−</button>
              <input
                type="number" min="1" max={MAX_BATCH} step="1" inputMode="numeric" value={batch} aria-label={t.batchCount} disabled={sending}
                onChange={(e) => setBatch(Math.min(MAX_BATCH, Math.max(1, Math.trunc(Number(e.target.value)) || 1)))}
              />
              <button type="button" onClick={() => setBatch((n) => Math.min(MAX_BATCH, n + 1))} disabled={batch >= MAX_BATCH || sending} aria-label={t.batchMore}>+</button>
            </div>
          </div>
        )}

        {/* The proof of each report: media and/or the link of a forwarded message, never shared */}
        <div className="proof-slots">
          {used.map((it, i) => (
            <fieldset key={i} className={`proof-slot ${itemHasProof(it, i, proofOn) ? 'on' : ''}`} disabled={sending}>
              <legend>{batch > 1 ? t.proofSlot(i + 1) : t.proofSlotOne}</legend>
              {i === 0 && proofOn && <small className="hint">{t.proofSlotCapture}</small>}
              <label className="file">
                <span>{t.proofFiles}</span>
                <input type="file" multiple accept={MEDIA_ACCEPT} onChange={(e) => { pickFiles(i, e.target.files); e.target.value = '' }} />
                <small className="hint">{it.files.length ? t.proofFilesPicked(it.files.map((f) => f.name)) : t.proofFilesHint(maxMedia, maxSendMb)}</small>
              </label>
              {it.files.length > 0 && <button type="button" className="link" onClick={() => setItem(i, { files: [] })}>{t.proofFilesClear}</button>}
              {/* With the capture, the first report's proof is the capture, not a link */}
              {!(i === 0 && proofOn) && (
                <label>
                  <span>{t.proofLink}</span>
                  <input type="url" value={it.link} placeholder="https://t.me/…" onChange={(e) => setItem(i, { link: e.target.value })} />
                </label>
              )}
            </fieldset>
          ))}
          {batch > 1 && (
            <p className={`hint ${proofMissing ? 'warn' : ''}`}>{t.proofNeeded(proofsNeeded, batch, proofsGiven)}</p>
          )}
          {tooHeavy && <p className="hint warn">{t.sendTooHeavy(maxSendMb)}</p>}
        </div>

        {batch > 1 && (
          // Period in minutes, by steps of SPREAD_STEP (0 = all at once)
          <div className="spread">
            <span className="field-label">{t.spreadLabel}</span>
            <div className="stepper" role="group" aria-label={t.spreadLabel}>
              <button type="button" onClick={() => setSpread((m) => Math.max(0, snapSpread(m) - SPREAD_STEP))} disabled={spread <= 0 || sending} aria-label={t.spreadLess}>−</button>
              <input
                className="wide" type="number" min="0" max={MAX_SPREAD} step={SPREAD_STEP} inputMode="numeric" value={spread} aria-label={t.spreadLabel} disabled={sending}
                onChange={(e) => setSpread(Math.min(MAX_SPREAD, Math.max(0, Math.trunc(Number(e.target.value)) || 0)))}
                onBlur={() => setSpread(snapSpread)}
              />
              <span className="unit">min</span>
              <button type="button" onClick={() => setSpread((m) => Math.min(MAX_SPREAD, snapSpread(m) + SPREAD_STEP))} disabled={spread >= MAX_SPREAD || sending} aria-label={t.spreadMore}>+</button>
            </div>
            <span className="hint">{snapSpread(spread) > 0 ? t.spreadHint(batch, snapSpread(spread), fmtMinutes(snapSpread(spread) / batch)) : t.spreadNow}</span>
          </div>
        )}

        {/* The only send button, for the number chosen above */}
        <button className="primary" disabled={sending || shortBatch || proofMissing || tooHeavy}>
          {sending ? t.flow.running
            : !user ? t.loginAndReport
            : proofOn ? t.submitProof(batch, cost * batch)
            : batch > 1 ? t.batchSend(batch, cost * batch) : t.submitCost(cost)}
        </button>
        {flow && <Progress t={t} flow={flow} />}
        {proof && <ProofPreview t={t} lang={lang} capture={proof} />}
        {status.message && (
          <p className={`msg ${status.state}`}>
            {status.message}
            {status.code === 'insufficient_tokens' && <> <a href="#wallet" className="link">{t.wallet.topUp}</a></>}
          </p>
        )}
        {/* The proof could not be taken or is already known: the report can still go without it */}
        {status.state === 'error' && flow?.mode === 'proof' && (status.code?.startsWith('capture_') || status.code === 'duplicate_proof') && (
          <button type="button" className="ghost" onClick={() => { setWithProof(false); setStatus({ state: 'idle', message: '' }); setProof(null); sendPlain(batch, snapSpread(spread)) }}>
            {t.flow.sendPlain(batch, cost * batch)}
          </button>
        )}
      </form>
    </section>
  )

  return (
    <>
    <header className="topbar">
      <div className="topbar-inner">
        <a href="#" className="brand" aria-label={t.title}>
          <span className="brand-mark" aria-hidden="true"><img src="/logo-mko-192.png" alt="" width="39" height="39" /></span>
          <span>{t.title}<small>{t.brandSub}</small></span>
        </a>
        <nav className="nav">
          {user ? (
            <>
              <a href="#" className={`pill ${route === '' ? 'on' : ''}`}>{t.submit}</a>
              <a href="#wallet" className={`pill ${route === 'wallet' ? 'on' : ''}`}>
                {wallet && !isSuper ? `${wallet.tokens} ${t.wallet.tokens}` : t.wallet.title}
              </a>
              {user.role === 'superadmin' && <a href="#admin" className={`pill ${route === 'admin' ? 'on' : ''}`}>{t.admin.title}</a>}
              <button className="pill" onClick={logout} title={user.username}>{t.auth.logout}</button>
            </>
          ) : (
            <a href="#login" className={`pill ${route === 'login' ? 'on' : ''}`}>{t.auth.login}</a>
          )}
          <div className="lang">
            {['en', 'fr'].map((l) => (
              <button key={l} className={l === lang ? 'on' : ''} onClick={() => changeLang(l)}>{l.toUpperCase()}</button>
            ))}
          </div>
        </nav>
      </div>
    </header>

    <div className="page">
      {route === 'admin' && <Admin t={t} lang={lang} user={user} reportCard={reportCard} />}
      {route === 'login' && (user ? <section className="card narrow"><p className="muted">{t.auth.signedInAs(user.username)}</p></section> : <Auth t={t} onDone={signedIn} />)}
      {route === 'wallet' && (user ? <Wallet t={t} lang={lang} wallet={wallet} reloadWallet={reloadWallet} exempt={isSuper} /> : <Auth t={t} onDone={signedIn} />)}

      {route === '' && (
        <>
        <section className="hero">
          <span className="mono accent">{t.heroKicker}</span>
          <h1>{t.heroA} <span className="serif accent">{t.heroB}</span></h1>
          <p className="lead">{t.heroLead}</p>
        </section>
        <main>
          {reportCard}

          <section className="card">
            <h2>{t.reported}</h2>
            <p className="muted">{t.stats(stats.targets, stats.reports)}</p>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              aria-label={t.search}
            />
            <ul className="list">
              {targets.length === 0 && <li className="muted">{t.none}</li>}
              {targets.map((x) => (
                <li key={x.id}>
                  <span className="name">
                    {x.username ? `@${x.username}` : `ID ${x.tgId}`}
                    {x.status === 'confirmed' && <span className="badge confirmed">{t.statuses.confirmed}</span>}
                  </span>
                  <span className="count">{t.reports(x.reportCount)}</span>
                </li>
              ))}
            </ul>
          </section>
        </main>
        </>
      )}
    </div>
    </>
  )
}
