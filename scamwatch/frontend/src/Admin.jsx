import { useEffect, useState } from 'react'
import { api, session, safeLink, fmtCrypto, fmtUsd } from './api.js'
import { PasswordCard } from './Auth.jsx'
import { Screenshot, Transcript } from './Proof.jsx'

const FILTERS = ['pending', 'confirmed', 'rejected', 'all']
const TABS = ['moderation', 'report', 'wallet', 'whitelist', 'settings']
const RESERVE = ['BTC', 'LTC', 'DOGE', 'ETH', 'XMR']
const SWEEPABLE = ['BTC', 'LTC', 'DOGE', 'ETH']

const name = (x) => (x.username ? `@${x.username}` : `ID ${x.tgId}`)


// What the server saw of the account; the type of the reports comes from it
function CapturePanel({ t, target, busy, onRecapture }) {
  const c = target.capture
  const running = target.capturing || c?.status === 'pending'
  return (
    <div className="capture">
      <div className="row">
        <h3>{t.admin.capture}</h3>
        {target.captureEnabled && (
          <button className="ghost small" disabled={busy || running} onClick={onRecapture}>{t.admin.recapture}</button>
        )}
      </div>
      {!target.captureEnabled && !c && <p className="hint">{t.admin.captureOff}</p>}
      {running && <p className="hint">{t.admin.captureRunning}</p>}
      {!running && !c && target.captureEnabled && <p className="hint">{t.admin.captureNone}</p>}
      {!running && c?.status === 'failed' && <p className="msg error">{t.admin.captureFailed(c.error)}</p>}
      {c?.status === 'done' && (
        <div className="capture-body">
          {c.hasPhoto && <Screenshot path={`/api/admin/captures/${c.id}/photo`} alt={c.title} />}
          <div className="capture-text">
            <p className="name">
              {c.title || name(target)}
              {c.kind && <span className="badge">{t.admin.kinds[c.kind] || c.kind}</span>}
              <span className="badge confirmed">{t.types[c.detectedType] || c.detectedType}</span>
            </p>
            {c.about && <p className="desc">{c.about}</p>}
            <Transcript t={t} capture={c} limit={12} />
          </div>
        </div>
      )}
    </div>
  )
}

function Moderation({ t, lang }) {
  const [filter, setFilter] = useState('pending')
  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState([])
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)

  const loadTargets = () => {
    const status = filter === 'all' ? '' : filter
    return api(`/api/admin/targets?status=${status}&q=${encodeURIComponent(query)}`).then(setTargets).catch(() => {})
  }
  const open = (id) => api(`/api/admin/targets/${id}`).then(setSelected).catch(() => {})

  useEffect(() => {
    const id = setTimeout(loadTargets, 250)
    return () => clearTimeout(id)
  }, [filter, query])

  const act = async (fn) => {
    setBusy(true)
    try { await fn(); await open(selected.id); await loadTargets() } catch {} finally { setBusy(false) }
  }
  const setStatus = (status) => act(() => api(`/api/admin/targets/${selected.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }))
  // While the account is being captured, the detail refreshes until the type is in
  useEffect(() => {
    if (!selected || !(selected.capturing || selected.capture?.status === 'pending')) return
    const id = setTimeout(() => open(selected.id), 4000)
    return () => clearTimeout(id)
  }, [selected])

  const recapture = () => act(() => api(`/api/admin/targets/${selected.id}/capture`, { method: 'POST' }))
  const protect = () => act(() => api('/api/admin/whitelist', { method: 'POST', body: JSON.stringify({ target: selected.username || selected.tgId }) }))

  const date = (d) => new Date(d).toLocaleString(lang)

  return (
    <div className="admin">
      <section className="card">
        <div className="tabs">
          {FILTERS.map((f) => (
            <button key={f} className={f === filter ? 'on' : ''} onClick={() => setFilter(f)}>{t.admin.filters[f]}</button>
          ))}
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.searchPlaceholder} aria-label={t.search} />
        <ul className="list">
          {targets.length === 0 && <li className="muted">{t.none}</li>}
          {targets.map((x) => (
            <li key={x.id} className={`clickable ${selected?.id === x.id ? 'active' : ''}`} onClick={() => open(x.id)}>
              <span className="name">{name(x)}</span>
              <span className="count">
                <span className={`badge ${x.status}`}>{t.statuses[x.status]}</span> {t.reports(x.reportCount)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        {!selected && <p className="muted">{t.admin.pick}</p>}
        {selected && (
          <>
            <div className="row">
              <h2>{name(selected)}</h2>
              <span>
                {selected.whitelisted && <span className="badge protected">{t.admin.protected}</span>}
                <span className={`badge ${selected.status}`}>{t.statuses[selected.status]}</span>
              </span>
            </div>
            <p className="muted">{t.reports(selected.reportCount)}</p>
            <div className="actions">
              <button className="primary" disabled={busy || selected.status === 'confirmed'} onClick={() => setStatus('confirmed')}>{t.admin.confirm}</button>
              <button className="danger" disabled={busy || selected.status === 'rejected'} onClick={() => setStatus('rejected')}>{t.admin.reject}</button>
              <button className="ghost" disabled={busy || selected.status === 'pending'} onClick={() => setStatus('pending')}>{t.admin.reset}</button>
              {!selected.whitelisted && <button className="ghost" disabled={busy} onClick={protect}>{t.admin.addWhitelist}</button>}
            </div>

            <CapturePanel t={t} target={selected} busy={busy} onRecapture={recapture} />

            <ul className="reports">
              {selected.reports.map((r) => (
                <li key={r.id}>
                  <div className="row muted">
                    <span>
                      {r.captured ? t.types[r.type] || r.type : t.admin.waitingType}{r.user ? ` · ${r.user.username}` : ''}
                      {' '}<span className={`badge ${r.captureId ? 'confirmed' : ''}`}>{r.captureId ? t.admin.withProof(r.captureId) : t.admin.noProof}</span>
                    </span>
                    <span>{date(r.createdAt)}</span>
                  </div>
                  {r.description && <p className="desc">{r.description}</p>}
                  {r.proofUrl && (safeLink(r.proofUrl)
                    ? <a href={safeLink(r.proofUrl)} target="_blank" rel="noopener noreferrer nofollow">{r.proofUrl}</a>
                    : <span className="muted">{r.proofUrl}</span>)}
                  {r.evidence.length > 0 && (
                    <div className="shots">
                      {r.evidence.map((ev) => <Screenshot key={ev.id} id={ev.id} alt={t.admin.screenshot} />)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}

function WalletAdmin({ t, lang }) {
  const [overview, setOverview] = useState(null)
  const [reserve, setReserve] = useState({})
  const [deposits, setDeposits] = useState([])
  const [depFilter, setDepFilter] = useState('awaiting')
  const [sweeps, setSweeps] = useState([])
  const [amounts, setAmounts] = useState({})
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState('')

  const load = () => {
    api('/api/admin/wallet/overview').then((o) => {
      setOverview(o)
      setReserve((r) => (Object.keys(r).length ? r : { ...o.reserveAddresses, XMR: o.xmrAddress || '' }))
    }).catch(() => {})
    api('/api/admin/wallet/sweeps').then(setSweeps).catch(() => {})
  }
  const loadDeposits = () => api(`/api/admin/wallet/deposits?status=${depFilter}`).then(setDeposits).catch(() => {})

  useEffect(load, [])
  useEffect(() => { loadDeposits() }, [depFilter])

  const run = async (key, fn, okText) => {
    setBusy(key); setMsg(null)
    try {
      const r = await fn()
      setMsg({ ok: true, text: typeof okText === 'function' ? okText(r) : okText })
      load(); loadDeposits()
    } catch (err) {
      setMsg({ ok: false, text: t.admin.errors[err.code] || t.error })
    } finally { setBusy('') }
  }

  const saveReserve = (e) => {
    e.preventDefault()
    run('reserve', () => api('/api/admin/wallet/reserve', { method: 'PUT', body: JSON.stringify(reserve) }), t.admin.saved)
  }
  const sweep = (c) => run(`sweep${c}`, () => api(`/api/admin/wallet/sweep/${c}`, { method: 'POST' }), (r) => t.admin.swept(r.swept, r.total, c))
  const confirm = (d) => run(`dep${d.id}`, () => api(`/api/admin/wallet/deposits/${d.id}/confirm`, { method: 'POST', body: JSON.stringify({ amount: Number(amounts[d.id]) }) }), t.admin.saved)

  const unswept = Object.fromEntries((overview?.unswept || []).map((u) => [u.currency, u]))
  const date = (d) => new Date(d).toLocaleString(lang)

  return (
    <div className="admin">
      <section className="card full">
        <h2>{t.admin.funds}</h2>
        <p className="muted">{overview ? t.admin.usersCount(overview.users) : ''}</p>
        <div className="stats">
          {(overview?.collected || []).map((c) => (
            <div key={c.currency} className="stat">
              <span className="muted">{c.currency}</span>
              <strong>{fmtCrypto(c.amount)}</strong>
              <span className="hint">{t.admin.collected(fmtUsd(c.usd))}</span>
            </div>
          ))}
          {overview && overview.collected.length === 0 && <p className="muted">{t.admin.noFunds}</p>}
        </div>
        {msg && <p className={`msg ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</p>}
      </section>

      <section className="card">
        <h2>{t.admin.reserve}</h2>
        <form onSubmit={saveReserve}>
          {RESERVE.map((c) => (
            <label key={c}>
              {c}
              <input value={reserve[c] || ''} onChange={(e) => setReserve({ ...reserve, [c]: e.target.value })} placeholder={t.admin.reservePlaceholder} />
            </label>
          ))}
          <p className="hint">{t.admin.reserveHint}</p>
          <button className="primary" disabled={busy === 'reserve'}>{t.admin.save}</button>
        </form>
      </section>

      <section className="card">
        <h2>{t.admin.sweep}</h2>
        <ul className="list">
          {SWEEPABLE.map((c) => (
            <li key={c}>
              <span className="name">{c}</span>
              <span className="count">
                {unswept[c] ? t.admin.toSweep(fmtCrypto(unswept[c].amount), unswept[c].deposits) : t.admin.nothing}
                <button className="ghost small" disabled={!!busy || !unswept[c]} onClick={() => sweep(c)}>
                  {busy === `sweep${c}` ? '...' : t.admin.sweepNow}
                </button>
              </span>
            </li>
          ))}
        </ul>
        <p className="hint">{t.admin.sweepHint}</p>
        {sweeps.length > 0 && (
          <>
            <h3>{t.admin.sweepLog}</h3>
            <ul className="reports">
              {sweeps.slice(0, 20).map((s) => (
                <li key={s.id}>
                  <div className="row"><span className="name">{fmtCrypto(s.amount)} {s.currency}</span><span className="muted">{date(s.createdAt)}</span></div>
                  <span className="mono muted">{s.txHash}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card full">
        <div className="row">
          <h2>{t.admin.deposits}</h2>
          <div className="tabs">
            {['awaiting', 'partial', 'confirmed', 'expired'].map((s) => (
              <button key={s} className={s === depFilter ? 'on' : ''} onClick={() => setDepFilter(s)}>{t.wallet.depositStatus[s]}</button>
            ))}
          </div>
        </div>
        <ul className="reports">
          {deposits.length === 0 && <li className="muted">{t.none}</li>}
          {deposits.map((d) => (
            <li key={d.id}>
              <div className="row">
                <span className="name">#{d.id} · {d.username} · {d.currency}</span>
                <span className="muted">{date(d.createdAt)}</span>
              </div>
              <span className="mono muted">{d.address}</span>
              {d.status === 'confirmed' && (
                <span className="hint">{fmtCrypto(d.amountReceived)} {d.currency} · {fmtUsd(d.usdCredited)} · {d.sweptAt ? t.admin.sweptAt(date(d.sweptAt)) : t.admin.notSwept}</span>
              )}
              {['awaiting', 'partial'].includes(d.status) && (
                <div className="inline">
                  <input type="number" min="0" step="any" placeholder={t.admin.received(d.currency)}
                    value={amounts[d.id] || ''} onChange={(e) => setAmounts({ ...amounts, [d.id]: e.target.value })} />
                  <button className="ghost small" disabled={!!busy || !(Number(amounts[d.id]) > 0)} onClick={() => confirm(d)}>{t.admin.confirmDeposit}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Whitelist({ t, lang }) {
  const [entries, setEntries] = useState([])
  const [target, setTarget] = useState('')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState(null)

  const load = () => api('/api/admin/whitelist').then(setEntries).catch(() => {})
  useEffect(() => { load() }, [])

  const add = async (e) => {
    e.preventDefault()
    setMsg(null)
    try {
      await api('/api/admin/whitelist', { method: 'POST', body: JSON.stringify({ target, note }) })
      setTarget(''); setNote(''); load()
    } catch (err) {
      setMsg(t.admin.errors[err.code] || t.errors[err.code] || t.error)
    }
  }
  const remove = async (id) => { await api(`/api/admin/whitelist/${id}`, { method: 'DELETE' }).catch(() => {}); load() }

  return (
    <div className="admin">
      <section className="card">
        <h2>{t.admin.whitelist}</h2>
        <p className="hint">{t.admin.whitelistHint}</p>
        <form onSubmit={add}>
          <label>
            {t.target}
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={t.targetHint} required />
          </label>
          <label>
            {t.admin.note}
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
          </label>
          <button className="primary">{t.admin.add}</button>
          {msg && <p className="msg error">{msg}</p>}
        </form>
      </section>
      <section className="card">
        <ul className="list">
          {entries.length === 0 && <li className="muted">{t.admin.whitelistEmpty}</li>}
          {entries.map((x) => (
            <li key={x.id}>
              <span className="name">
                {name(x)}
                {x.note && <span className="hint">{x.note}</span>}
              </span>
              <span className="count">
                <span className="hint">{new Date(x.createdAt).toLocaleDateString(lang)}</span>
                <button className="link" onClick={() => remove(x.id)}>{t.admin.remove}</button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Settings({ t }) {
  const [values, setValues] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { api('/api/admin/settings').then(setValues).catch(() => {}) }, [])

  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      setValues(await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(values) }))
      setMsg({ ok: true, text: t.admin.saved })
    } catch (err) {
      setMsg({ ok: false, text: t.admin.errors[err.code] || t.error })
    } finally { setBusy(false) }
  }

  if (!values) return <section className="card"><p className="muted">...</p></section>
  const field = (key, props) => (
    <label key={key}>
      {t.admin.fields[key]}
      <input type="number" required value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} {...props} />
      <span className="hint">{t.admin.fieldHints[key]}</span>
    </label>
  )

  return (
    <section className="card narrow-wide">
      <h2>{t.admin.settings}</h2>
      <form onSubmit={save}>
        {field('tokenPriceUsd', { min: 0.01, step: 0.01 })}
        {field('reportCostTokens', { min: 0, step: 1 })}
        {field('maxReportsNoProof', { min: 0, max: 1000, step: 1 })}
        {field('depositExpiryHours', { min: 1, max: 168, step: 1 })}
        <button className="primary" disabled={busy}>{t.admin.save}</button>
        {msg && <p className={`msg ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</p>}
      </form>
    </section>
  )
}

// Telegram account of the captures: API keys and phone, then the code Telegram sends,
// then the two-step password if the account has one. The server keeps the session.
function TelegramCard({ t, lang }) {
  const [info, setInfo] = useState(null)
  const [step, setStep] = useState('creds') // creds | code | password
  const [form, setForm] = useState({ apiId: '', apiHash: '', phone: '', code: '', password: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api('/api/admin/telegram').then((r) => { setInfo(r); if (r.apiId) setForm((f) => ({ ...f, apiId: f.apiId || String(r.apiId) })) }).catch(() => {})
  useEffect(() => { load() }, [])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const call = async (url, body, next) => {
    setBusy(true); setMsg(null)
    try {
      const r = await api(url, { method: 'POST', body: JSON.stringify(body) })
      if (r.needPassword) setStep('password')
      else if (r.account) { setMsg({ ok: true, text: t.admin.tg.done }); setStep('creds'); setForm((f) => ({ ...f, code: '', password: '' })); load() }
      else setStep(next)
    } catch (err) {
      setMsg({ ok: false, text: t.admin.errors[err.code] || t.error })
    } finally { setBusy(false) }
  }
  const submit = (e) => {
    e.preventDefault()
    if (step === 'creds') return call('/api/admin/telegram/code', { apiId: form.apiId, apiHash: form.apiHash, phone: form.phone }, 'code')
    if (step === 'code') return call('/api/admin/telegram/verify', { code: form.code })
    return call('/api/admin/telegram/password', { password: form.password })
  }
  const disconnect = async () => {
    if (!window.confirm(t.admin.tg.confirmDisconnect)) return
    setBusy(true); setMsg(null)
    try { await api('/api/admin/telegram', { method: 'DELETE' }); await load() } catch {} finally { setBusy(false) }
  }

  if (!info) return <section className="card"><p className="muted">...</p></section>
  return (
    <section className="card">
      <h2>{t.admin.tg.title}</h2>
      <p className="hint">{t.admin.tg.intro}</p>
      {info.connected ? (
        <div className="tg-connected">
          <p className="msg ok">
            {t.admin.tg.connected(info.account)}
            {info.connectedAt && <> · {t.admin.tg.since(new Date(info.connectedAt).toLocaleDateString(lang))}</>}
          </p>
          <button className="ghost" disabled={busy} onClick={disconnect}>{t.admin.tg.disconnect}</button>
        </div>
      ) : (
        <form onSubmit={submit}>
          {info.unreadable && <p className="msg error">{t.admin.tg.unreadable}</p>}
          {step === 'creds' && (
            <>
              <p className="hint">{t.admin.tg.help}</p>
              <label>{t.admin.tg.apiId}<input value={form.apiId} onChange={set('apiId')} inputMode="numeric" required autoComplete="off" /></label>
              <label>{t.admin.tg.apiHash}<input value={form.apiHash} onChange={set('apiHash')} required autoComplete="off" spellCheck="false" /></label>
              <label>
                {t.admin.tg.phone}
                <input value={form.phone} onChange={set('phone')} type="tel" placeholder="+33612345678" required autoComplete="off" />
                <span className="hint">{t.admin.tg.phoneHint}</span>
              </label>
            </>
          )}
          {step === 'code' && (
            <label>
              {t.admin.tg.code}
              <input value={form.code} onChange={set('code')} inputMode="numeric" autoComplete="one-time-code" required autoFocus />
              <span className="hint">{t.admin.tg.codeHint}</span>
            </label>
          )}
          {step === 'password' && (
            <label>{t.admin.tg.password}<input type="password" value={form.password} onChange={set('password')} autoComplete="off" required autoFocus /></label>
          )}
          <button className="primary" disabled={busy}>{busy ? '...' : step === 'creds' ? t.admin.tg.sendCode : t.admin.tg.verify}</button>
          {step !== 'creds' && <button type="button" className="ghost" disabled={busy} onClick={() => { setStep('creds'); setMsg(null) }}>{t.admin.tg.restart}</button>}
        </form>
      )}
      {msg && <p className={`msg ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</p>}
    </section>
  )
}

// reportCard: the report form of the home page, so the super admin reports from here too
export default function Admin({ t, lang, user, reportCard }) {
  const [tab, setTab] = useState('moderation')

  if (!user) return <section className="card narrow"><p className="muted">{t.admin.signInFirst}</p><a className="link" href="#login">{t.auth.login}</a></section>
  if (user.role !== 'superadmin') return <section className="card narrow"><p className="muted">{t.admin.forbidden}</p></section>

  return (
    <>
      <div className="tabs page-tabs">
        {TABS.map((x) => <button key={x} className={x === tab ? 'on' : ''} onClick={() => setTab(x)}>{t.admin.tabs[x]}</button>)}
      </div>
      {tab === 'moderation' && <Moderation t={t} lang={lang} />}
      {tab === 'report' && <div className="narrow-wide">{reportCard}</div>}
      {tab === 'wallet' && <WalletAdmin t={t} lang={lang} />}
      {tab === 'whitelist' && <Whitelist t={t} lang={lang} />}
      {tab === 'settings' && (
        <div className="admin">
          <Settings t={t} />
          <div className="stack"><TelegramCard t={t} lang={lang} /><PasswordCard t={t} /></div>
        </div>
      )}
    </>
  )
}
