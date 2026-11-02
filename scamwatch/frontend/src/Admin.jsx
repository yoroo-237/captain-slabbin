import { useEffect, useState } from 'react'
import { api, safeLink } from './api.js'

const FILTERS = ['pending', 'confirmed', 'rejected', 'all']

const readKey = () => {
  try { return sessionStorage.getItem('adminKey') || '' } catch { return '' }
}

// Screenshots need the admin header, so they are fetched as blobs
function Screenshot({ id, adminKey, alt }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let url
    let alive = true
    fetch(`/api/admin/evidence/${id}`, { headers: { Authorization: `Bearer ${adminKey}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (b && alive) { url = URL.createObjectURL(b); setSrc(url) } })
      .catch(() => {})
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [id, adminKey])
  if (!src) return <span className="shot placeholder" />
  return <a href={src} target="_blank" rel="noreferrer"><img className="shot" src={src} alt={alt} /></a>
}

// How many reports without evidence one person can send for the same account
function Settings({ t, call }) {
  const [max, setMax] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    call('/api/admin/settings').then((s) => setMax(String(s.maxReportsNoProof))).catch(() => {})
  }, [])

  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const s = await call('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ maxReportsNoProof: Number(max) }) })
      setMax(String(s.maxReportsNoProof))
      setMsg({ ok: true, text: t.admin.saved })
    } catch (err) {
      setMsg({ ok: false, text: t.admin.errors[err.code] || t.error })
    } finally { setBusy(false) }
  }

  return (
    <section className="card settings">
      <h2>{t.admin.settings}</h2>
      <form onSubmit={save}>
        <label>
          {t.admin.maxNoProof}
          <input type="number" min="0" max="1000" step="1" value={max} onChange={(e) => setMax(e.target.value)} required />
        </label>
        <button className="primary" disabled={busy}>{t.admin.save}</button>
      </form>
      <p className="hint">{t.admin.maxNoProofHint}</p>
      {msg && <p className={`msg ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</p>}
    </section>
  )
}

export default function Admin({ t, lang }) {
  const [adminKey, setAdminKey] = useState(readKey)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [filter, setFilter] = useState('pending')
  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState([])
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)

  const call = (url, options = {}) =>
    api(url, { ...options, headers: { Authorization: `Bearer ${adminKey}` } }).catch((err) => {
      if (err.code === 'unauthorized') logout()
      throw err
    })

  const logout = () => {
    try { sessionStorage.removeItem('adminKey') } catch {}
    setAdminKey(''); setTargets([]); setSelected(null)
  }

  const login = async (e) => {
    e.preventDefault()
    setAuthError('')
    try {
      await api('/api/admin/targets?status=pending', { headers: { Authorization: `Bearer ${password}` } })
      try { sessionStorage.setItem('adminKey', password) } catch {}
      setAdminKey(password); setPassword('')
    } catch (err) {
      setAuthError(t.admin.errors[err.code] || t.error)
    }
  }

  const loadTargets = () => {
    const status = filter === 'all' ? '' : filter
    return call(`/api/admin/targets?status=${status}&q=${encodeURIComponent(query)}`).then(setTargets).catch(() => {})
  }
  const open = (id) => call(`/api/admin/targets/${id}`).then(setSelected).catch(() => {})

  useEffect(() => {
    if (!adminKey) return
    const id = setTimeout(loadTargets, 250)
    return () => clearTimeout(id)
  }, [adminKey, filter, query])

  const setStatus = async (status) => {
    setBusy(true)
    try {
      await call(`/api/admin/targets/${selected.id}/status`, { method: 'POST', body: JSON.stringify({ status }) })
      await open(selected.id)
      await loadTargets()
    } catch {} finally { setBusy(false) }
  }

  const name = (x) => (x.username ? `@${x.username}` : `ID ${x.tgId}`)
  const date = (d) => new Date(d).toLocaleString(lang)

  if (!adminKey) {
    return (
      <section className="card narrow">
        <h2>{t.admin.title}</h2>
        <form onSubmit={login}>
          <label>
            {t.admin.password}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </label>
          <button className="primary">{t.admin.login}</button>
          {authError && <p className="msg error">{authError}</p>}
        </form>
      </section>
    )
  }

  return (
    <div className="admin">
      <Settings t={t} call={call} />

      <section className="card">
        <div className="row">
          <h2>{t.admin.title}</h2>
          <button className="link" onClick={logout}>{t.admin.logout}</button>
        </div>
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
                <span className={`badge ${x.status}`}>{t.statuses[x.status]}</span> {x.reportCount} {t.reports}
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
              <span className={`badge ${selected.status}`}>{t.statuses[selected.status]}</span>
            </div>
            <p className="muted">{selected.reportCount} {t.reports}</p>
            <div className="actions">
              <button className="primary" disabled={busy || selected.status === 'confirmed'} onClick={() => setStatus('confirmed')}>{t.admin.confirm}</button>
              <button className="danger" disabled={busy || selected.status === 'rejected'} onClick={() => setStatus('rejected')}>{t.admin.reject}</button>
              <button className="ghost" disabled={busy || selected.status === 'pending'} onClick={() => setStatus('pending')}>{t.admin.reset}</button>
            </div>

            <ul className="reports">
              {selected.reports.map((r) => (
                <li key={r.id}>
                  <div className="row muted">
                    <span>{t.types[r.type] || r.type}</span>
                    <span>{date(r.createdAt)}</span>
                  </div>
                  {r.description && <p className="desc">{r.description}</p>}
                  {r.proofUrl && (safeLink(r.proofUrl)
                    ? <a href={safeLink(r.proofUrl)} target="_blank" rel="noopener noreferrer nofollow">{r.proofUrl}</a>
                    : <span className="muted">{r.proofUrl}</span>)}
                  {r.evidence.length > 0 && (
                    <div className="shots">
                      {r.evidence.map((ev) => <Screenshot key={ev.id} id={ev.id} adminKey={adminKey} alt={t.admin.screenshot} />)}
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
