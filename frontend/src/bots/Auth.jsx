import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../utils/api.js'
import { useApp } from '../context/AppContext.jsx'
import { STAFF_ROLES } from '../utils/roles.js'

// Staff only: a customer account is turned away
export function LoginScreen() {
  const { user, login, loadingAuth } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const to = location.state?.from ? location.state.from.pathname + (location.state.from.search || '') : '/admin'
  if (!loadingAuth && user && STAFF_ROLES.includes(user.role)) return <Navigate to={to} replace />

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(form) })
      if (!STAFF_ROLES.includes(data.user?.role)) throw new Error('Ce compte n’a pas accès au dashboard.')
      login(data.accessToken, data.refreshToken, data.user)
      navigate(to, { replace: true })
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="bp bp-login">
      <form className="panel" onSubmit={submit}>
        <span className="brand"><span className="brand-mark" aria-hidden="true"><img src="/logo-mko-192.png" alt="" width="39" height="39" /></span>
          <span>Bots<small>Plateforme des bots Telegram</small></span></span>
        <h1>Connexion</h1>
        {error && <div className="alert" role="alert"><span>{error}</span></div>}
        <label className="field">Identifiant
          <input autoComplete="username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required />
        </label>
        <label className="field">Mot de passe
          <input type="password" autoComplete="current-password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
        </label>
        <button className="btn primary wide" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'} <span className="arrow" aria-hidden="true">→</span></button>
      </form>
    </div>
  )
}

// /admin-tg: the staff buttons of the bots' notifications sign in with Telegram
export function StaffTelegram() {
  const { login, loadUserData } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const to = /^\/admin(\/|$)/.test(q.get('to') || '') ? q.get('to') : '/admin'
    const data = Object.fromEntries([...q].filter(([k]) => k !== 'to'))
    const token = localStorage.getItem('token')
    fetch('/api/auth/telegram-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ data }),
    }).then(async r => {
      const d = await r.json().catch(() => ({}))
      if (r.ok) { const s = d.data || d; login(s.accessToken, s.refreshToken, s.user); await loadUserData(); return navigate(to, { replace: true }) }
      // Not linked yet: sign in once, then come back here to link this Telegram account
      if (d.needLogin) return navigate('/login', { replace: true, state: { from: { pathname: location.pathname, search: location.search } } })
      setError(d.message || d.error || 'Cette connexion n’a pas marché.')
    }).catch(() => setError('Le serveur ne répond pas. Réessayez.'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="bp bp-login">
      <div className="panel">
        {error ? <><div className="alert" role="alert"><span>{error}</span></div><a className="btn" href="/login">Se connecter</a></> : <p className="muted">Ouverture du dashboard…</p>}
      </div>
    </div>
  )
}
