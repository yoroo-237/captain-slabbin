import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../utils/api.js'
import { useApp } from '../context/AppContext.jsx'
import { STAFF_ROLES } from '../utils/roles.js'
import { L } from './i18n.js'
import { LangSwitch } from './BotsLayout.jsx'

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
      if (!STAFF_ROLES.includes(data.user?.role)) throw new Error(L('Ce compte n’a pas accès au dashboard.', 'This account has no access to the dashboard.'))
      login(data.accessToken, data.refreshToken, data.user)
      navigate(to, { replace: true })
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="bp bp-login">
      <form className="panel" onSubmit={submit}>
        <span className="brand"><span className="brand-mark" aria-hidden="true"><img src="/logo-mko-192.png" alt="" width="39" height="39" /></span>
          <span>Bots<small>{L('Plateforme des bots Telegram', 'Telegram bots platform')}</small></span></span>
        <LangSwitch />
        <h1>{L('Connexion', 'Sign in')}</h1>
        {error && <div className="alert" role="alert"><span>{error}</span></div>}
        <label className="field">{L('Identifiant', 'Username')}
          <input autoComplete="username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required />
        </label>
        <label className="field">{L('Mot de passe', 'Password')}
          <input type="password" autoComplete="current-password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
        </label>
        <button className="btn primary wide" disabled={busy}>{busy ? L('Connexion…', 'Signing in…') : L('Se connecter', 'Sign in')} <span className="arrow" aria-hidden="true">→</span></button>
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
      setError(d.message || d.error || L('Cette connexion n’a pas marché.', 'This sign-in did not work.'))
    }).catch(() => setError(L('Le serveur ne répond pas. Réessayez.', 'The server is not answering. Try again.')))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="bp bp-login">
      <div className="panel">
        {error ? <><div className="alert" role="alert"><span>{error}</span></div><a className="btn" href="/login">{L('Se connecter', 'Sign in')}</a></> : <p className="muted">{L('Ouverture du dashboard…', 'Opening the dashboard…')}</p>}
      </div>
    </div>
  )
}
