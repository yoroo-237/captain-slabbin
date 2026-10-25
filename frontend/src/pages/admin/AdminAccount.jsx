import { useState } from 'react'
import { adminFetch } from './utils/api.js'
import { useApp } from '../../context/AppContext.jsx'

// My account: the signed-in staff member changes their own username and
// password. Both are kept across redeploys (the seed never overwrites them).
export default function AdminAccount() {
  const { user, loadUserData } = useApp()
  const [name, setName] = useState({ username: user?.username || '', currentPassword: '' })
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [msg, setMsg] = useState({})
  const [busy, setBusy] = useState('')

  async function saveUsername(e) {
    e.preventDefault()
    setBusy('name'); setMsg({})
    try {
      const r = await adminFetch('/profile/username', { method: 'PUT', body: JSON.stringify(name) })
      localStorage.setItem('token', r.accessToken)
      await loadUserData()
      setName(n => ({ ...n, currentPassword: '' }))
      setMsg({ name: { ok: `Username changed to ${r.username}. Use it next time you sign in.` } })
    } catch (err) { setMsg({ name: { error: err.message } }) }
    finally { setBusy('') }
  }

  async function savePassword(e) {
    e.preventDefault()
    if (pw.newPassword !== pw.confirm) { setMsg({ pw: { error: 'The two new passwords do not match.' } }); return }
    setBusy('pw'); setMsg({})
    try {
      await adminFetch('/profile/password', { method: 'PUT', body: JSON.stringify({ currentPassword: pw.currentPassword, newPassword: pw.newPassword }) })
      setPw({ currentPassword: '', newPassword: '', confirm: '' })
      setMsg({ pw: { ok: 'Password changed.' } })
    } catch (err) { setMsg({ pw: { error: err.message } }) }
    finally { setBusy('') }
  }

  const Alert = ({ m }) => m ? <div className={'admin-alert ' + (m.ok ? 'admin-alert-success' : 'admin-alert-error')}>{m.ok || m.error}</div> : null

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">My account</h1>
          <p className="admin-page-subtitle">Signed in as {user?.username} · {user?.role}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16, maxWidth: 560 }}>
        <form className="admin-card" onSubmit={saveUsername}>
          <h2 className="admin-card-title">Username</h2>
          <Alert m={msg.name} />
          <div className="admin-form-group">
            <label className="admin-label">New username</label>
            <input className="admin-input" autoComplete="username" value={name.username} onChange={e => setName(n => ({ ...n, username: e.target.value }))} />
            <div className="admin-text-muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>Letters, numbers, . _ - only, at least 3 characters.</div>
          </div>
          <div className="admin-form-group">
            <label className="admin-label">Current password</label>
            <input className="admin-input" type="password" autoComplete="current-password" value={name.currentPassword} onChange={e => setName(n => ({ ...n, currentPassword: e.target.value }))} />
          </div>
          <button className="admin-btn admin-btn-primary" disabled={busy === 'name' || !name.currentPassword || name.username.trim() === user?.username}>
            {busy === 'name' ? 'Saving…' : 'Change username'}
          </button>
        </form>

        <form className="admin-card" onSubmit={savePassword}>
          <h2 className="admin-card-title">Password</h2>
          <Alert m={msg.pw} />
          <div className="admin-form-group">
            <label className="admin-label">Current password</label>
            <input className="admin-input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={e => setPw(p => ({ ...p, currentPassword: e.target.value }))} />
          </div>
          <div className="admin-form-group">
            <label className="admin-label">New password</label>
            <input className="admin-input" type="password" autoComplete="new-password" value={pw.newPassword} onChange={e => setPw(p => ({ ...p, newPassword: e.target.value }))} />
            <div className="admin-text-muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>At least 8 characters.</div>
          </div>
          <div className="admin-form-group">
            <label className="admin-label">Confirm new password</label>
            <input className="admin-input" type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
          </div>
          <button className="admin-btn admin-btn-primary" disabled={busy === 'pw' || !pw.currentPassword || pw.newPassword.length < 8}>
            {busy === 'pw' ? 'Saving…' : 'Change password'}
          </button>
        </form>
      </div>
    </div>
  )
}
