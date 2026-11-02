import { useEffect, useState } from 'react'
import { messages } from './i18n.js'
import { api, session, MAX_BATCH, SPREAD_MINUTES } from './api.js'
import Admin from './Admin.jsx'
import Auth from './Auth.jsx'
import Wallet from './Wallet.jsx'

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
  const [route, setRoute] = useState(currentRoute)

  const [user, setUser] = useState(null)
  const [wallet, setWallet] = useState(null)
  const [pricing, setPricing] = useState(null)

  const [target, setTarget] = useState('')
  const [status, setStatus] = useState({ state: 'idle', message: '' })
  const [batch, setBatch] = useState(1)
  const [spread, setSpread] = useState(0)

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
  const submit = async (e, count = 1, spreadMinutes = 0) => {
    e?.preventDefault()
    if (!user) return go('login')
    setStatus({ state: 'sending', message: '' })
    try {
      const r = await api('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ target, lang, count, spreadMinutes: count > 1 ? spreadMinutes : 0 }),
      })
      const done = r.scheduled
        ? t.thanksSpread(count, r.scheduled, r.intervalMinutes, r.tokensSpent)
        : count > 1 ? t.thanksBatch(count, r.tokensSpent) : r.tokensSpent ? t.thanksPaid(r.tokensSpent) : t.thanks
      setStatus({ state: 'ok', message: r.capturing ? `${done} ${t.capturing}` : done })
      setTarget('')
      // Back to one report at once, so the next send is never a batch by accident
      setBatch(1); setSpread(0)
      loadTargets(query); loadStats(); reloadWallet()
    } catch (err) {
      setStatus({ state: 'error', message: t.errors[err.code] || t.error, code: err.code })
    }
  }

  const isSuper = user?.role === 'superadmin'
  const cost = isSuper ? 0 : pricing?.reportCostTokens ?? 1
  const short = user && wallet && cost > 0 && wallet.tokens < cost
  const shortBatch = user && wallet && cost > 0 && wallet.tokens < cost * batch
  const sending = status.state === 'sending'

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
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={t.targetHint} required />
        </label>

        <p className="hint">{t.captureHint}</p>

        <button className="primary" disabled={status.state === 'sending' || short}>
          {status.state === 'sending' ? t.sending : user ? t.submitCost(cost) : t.loginAndReport}
        </button>
        {/* Batch: 1 to MAX_BATCH reports on the same account, the server checks the limit */}
        <div className="batch">
          <div className="stepper" role="group" aria-label={t.batchCount}>
            <button type="button" onClick={() => setBatch((n) => Math.max(1, n - 1))} disabled={batch <= 1} aria-label={t.batchLess}>−</button>
            <input
              type="number" min="1" max={MAX_BATCH} step="1" inputMode="numeric" value={batch} aria-label={t.batchCount}
              onChange={(e) => setBatch(Math.min(MAX_BATCH, Math.max(1, Math.trunc(Number(e.target.value)) || 1)))}
            />
            <button type="button" onClick={() => setBatch((n) => Math.min(MAX_BATCH, n + 1))} disabled={batch >= MAX_BATCH} aria-label={t.batchMore}>+</button>
          </div>
          <button
            type="button"
            className="ghost"
            disabled={sending || shortBatch}
            onClick={(e) => { if (e.currentTarget.form.reportValidity()) submit(null, batch, spread) }}
          >
            {user ? t.batchSend(batch, cost * batch) : t.loginAndReport}
          </button>
        </div>
        {batch > 1 && (
          <label className="spread">
            {t.spreadLabel}
            <select value={spread} onChange={(e) => setSpread(Number(e.target.value))}>
              {SPREAD_MINUTES.map((m) => <option key={m} value={m}>{t.spreadOptions[m]}</option>)}
            </select>
            {spread > 0 && <span className="hint">{t.spreadHint(batch, Math.round(spread / batch))}</span>}
          </label>
        )}
        {status.message && (
          <p className={`msg ${status.state}`}>
            {status.message}
            {status.code === 'insufficient_tokens' && <> <a href="#wallet" className="link">{t.wallet.topUp}</a></>}
          </p>
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
