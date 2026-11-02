import { useState } from 'react'
import { api } from './api.js'

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
