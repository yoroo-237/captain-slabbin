import { useState } from 'react'
import { adminFetch } from '../pages/admin/utils/api.js'
import { useApp } from '../context/AppContext.jsx'

// Mon compte: the signed-in member changes their sign-in name and password
// (kept across redeploys: the seed never overwrites them)
export default function MyAccount() {
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
      setMsg({ name: { ok: `Identifiant changé : ${r.username}. Utilisez-le à la prochaine connexion.` } })
    } catch (err) { setMsg({ name: { error: err.message } }) } finally { setBusy('') }
  }

  async function savePassword(e) {
    e.preventDefault()
    if (pw.newPassword !== pw.confirm) { setMsg({ pw: { error: 'Les deux nouveaux mots de passe ne sont pas identiques.' } }); return }
    setBusy('pw'); setMsg({})
    try {
      await adminFetch('/profile/password', { method: 'PUT', body: JSON.stringify({ currentPassword: pw.currentPassword, newPassword: pw.newPassword }) })
      setPw({ currentPassword: '', newPassword: '', confirm: '' })
      setMsg({ pw: { ok: 'Mot de passe changé.' } })
    } catch (err) { setMsg({ pw: { error: err.message } }) } finally { setBusy('') }
  }

  const Note = ({ m }) => (m ? <div className={`alert ${m.ok ? 'ok' : ''}`} role="status"><span>{m.ok || m.error}</span></div> : null)
  return (
    <>
      <header className="hero">
        <p className="mono muted">Compte · {user?.role}</p>
        <h1>Mon <em className="serif accent">compte</em></h1>
        <p className="lead muted">Connecté en tant que {user?.username}. Votre identifiant et votre mot de passe servent à vous connecter au dashboard.</p>
      </header>
      <div className="layout" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <form className="panel" onSubmit={saveUsername}>
          <h2><span className="idx">01</span>Identifiant</h2>
          <div className="signin">
            <Note m={msg.name} />
            <label className="field">Nouvel identifiant
              <input value={name.username} onChange={e => setName(n => ({ ...n, username: e.target.value }))} autoComplete="username" required minLength={3} />
            </label>
            <label className="field">Mot de passe actuel
              <input type="password" value={name.currentPassword} onChange={e => setName(n => ({ ...n, currentPassword: e.target.value }))} autoComplete="current-password" required />
            </label>
            <p className="small muted">Lettres, chiffres, . _ - ; 3 caractères au moins.</p>
            <button className="btn primary" disabled={busy === 'name' || name.username === user?.username}>{busy === 'name' ? '…' : 'Changer l’identifiant'}</button>
          </div>
        </form>
        <form className="panel" onSubmit={savePassword}>
          <h2><span className="idx">02</span>Mot de passe</h2>
          <div className="signin">
            <Note m={msg.pw} />
            <label className="field">Mot de passe actuel
              <input type="password" value={pw.currentPassword} onChange={e => setPw(p => ({ ...p, currentPassword: e.target.value }))} autoComplete="current-password" required />
            </label>
            <label className="field">Nouveau mot de passe
              <input type="password" value={pw.newPassword} onChange={e => setPw(p => ({ ...p, newPassword: e.target.value }))} autoComplete="new-password" required minLength={8} />
            </label>
            <label className="field">Nouveau mot de passe, encore
              <input type="password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} autoComplete="new-password" required minLength={8} />
            </label>
            <p className="small muted">8 caractères au moins.</p>
            <button className="btn primary" disabled={busy === 'pw'}>{busy === 'pw' ? '…' : 'Changer le mot de passe'}</button>
          </div>
        </form>
      </div>
    </>
  )
}
