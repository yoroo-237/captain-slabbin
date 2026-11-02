import { useState } from 'react'
import { api } from './api.js'

// Change one's own password (users and super admin)
export function PasswordCard({ t }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) })
      setCurrent(''); setNext('')
      setMsg({ ok: true, text: t.auth.passwordChanged })
    } catch (err) {
      setMsg({ ok: false, text: t.auth.errors[err.code] || t.error })
    } finally { setBusy(false) }
  }

  return (
    <section className="card">
      <h2>{t.auth.account}</h2>
      <form onSubmit={submit}>
        <label>
          {t.auth.currentPassword}
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label>
          {t.auth.newPassword}
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
          <span className="hint">{t.auth.passwordHint}</span>
        </label>
        <button className="primary" disabled={busy}>{t.auth.changePassword}</button>
        {msg && <p className={`msg ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</p>}
      </form>
    </section>
  )
}

// Sign in or create an account; onDone receives { token, user }
export default function Auth({ t, onDone }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      onDone(await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ username, password }) }))
    } catch (err) {
      setError(t.auth.errors[err.code] || t.error)
    } finally { setBusy(false) }
  }

  return (
    <section className="card narrow">
      <div className="tabs">
        {['login', 'register'].map((m) => (
          <button key={m} type="button" className={m === mode ? 'on' : ''} onClick={() => { setMode(m); setError('') }}>{t.auth[m]}</button>
        ))}
      </div>
      <form onSubmit={submit}>
        <label>
          {t.auth.username}
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required autoFocus />
          {mode === 'register' && <span className="hint">{t.auth.usernameHint}</span>}
        </label>
        <label>
          {t.auth.password}
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 8 : undefined}
          />
          {mode === 'register' && <span className="hint">{t.auth.passwordHint}</span>}
        </label>
        <button className="primary" disabled={busy}>{busy ? t.sending : t.auth[mode]}</button>
        {error && <p className="msg error">{error}</p>}
      </form>
    </section>
  )
}
