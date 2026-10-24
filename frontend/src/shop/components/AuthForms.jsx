import { useState } from 'react'
import { apiFetch } from '../../utils/api.js'
import { useApp } from '../../context/AppContext.jsx'

// Sign-in and create-account forms, used on their own pages and inline at checkout.

export function SignInForm({ onDone }) {
  const { login, loadUserData } = useApp()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(form) })
      login(data.accessToken, data.refreshToken, data.user)
      await loadUserData()
      onDone?.(data.user)
    } catch (err) {
      setError(err.message === 'Invalid credentials' ? 'Wrong username or password.' : err.message)
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} noValidate>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="si-user">Username</label>
        <input id="si-user" className="input" autoComplete="username" required value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
      </div>
      <div className="field">
        <label htmlFor="si-pass">Password</label>
        <input id="si-pass" className="input" type="password" autoComplete="current-password" required value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
      </div>
      <button className="btn btn-primary btn-block" disabled={busy || !form.username || !form.password}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  )
}

export function CreateAccountForm({ onDone, submitLabel = 'Create account' }) {
  const { login, loadUserData } = useApp()
  const [form, setForm] = useState({ username: '', password: '', confirm: '', telegramHandle: '' })
  const [touched, setTouched] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const errors = {
    username: form.username.trim().length < 3 ? 'At least 3 characters' : !/^[A-Za-z0-9_.-]+$/.test(form.username.trim()) ? 'Letters, numbers, . _ - only' : '',
    password: form.password.length < 8 ? 'At least 8 characters' : '',
    confirm:  form.confirm !== form.password ? 'Passwords don’t match' : '',
  }
  const valid = !errors.username && !errors.password && !errors.confirm
  const show = k => touched[k] && errors[k]
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const blur = k => () => setTouched(t => ({ ...t, [k]: true }))

  async function submit(e) {
    e.preventDefault()
    setTouched({ username: true, password: true, confirm: true })
    if (!valid) return
    setBusy(true); setError('')
    try {
      const data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username: form.username.trim(), password: form.password, telegramHandle: form.telegramHandle.trim() || undefined }),
      })
      login(data.accessToken, data.refreshToken, data.user)
      await loadUserData()
      onDone?.(data.user)
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} noValidate>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="ca-user">Username</label>
        <input id="ca-user" className={'input' + (show('username') ? ' invalid' : '')} autoComplete="username" value={form.username} onChange={set('username')} onBlur={blur('username')} />
        {show('username') ? <span className="error">{errors.username}</span> : <span className="hint">No email or real name needed.</span>}
      </div>
      <div className="row-2">
        <div className="field">
          <label htmlFor="ca-pass">Password</label>
          <input id="ca-pass" className={'input' + (show('password') ? ' invalid' : '')} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} onBlur={blur('password')} />
          {show('password') && <span className="error">{errors.password}</span>}
        </div>
        <div className="field">
          <label htmlFor="ca-confirm">Confirm password</label>
          <input id="ca-confirm" className={'input' + (show('confirm') ? ' invalid' : '')} type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} onBlur={blur('confirm')} />
          {show('confirm') && <span className="error">{errors.confirm}</span>}
        </div>
      </div>
      <div className="field">
        <label htmlFor="ca-tg">Telegram username <span className="muted">(optional)</span></label>
        <input id="ca-tg" className="input" placeholder="@username" autoComplete="off" value={form.telegramHandle} onChange={set('telegramHandle')} />
        <span className="hint">Added to your orders so we can reach you fast.</span>
      </div>
      <p className="hint" style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Save your password somewhere safe — without an email we can’t send a reset link.</p>
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating…' : submitLabel}</button>
    </form>
  )
}
