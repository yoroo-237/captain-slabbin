import { useState } from 'react'
import { adminFetch } from '../pages/admin/utils/api.js'
import { useApp } from '../context/AppContext.jsx'
import { L, LANGS, lang, setLang } from './i18n.js'

// My account: the signed-in member changes their sign-in name, password and
// language (kept across redeploys: the seed never overwrites them)
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
      setMsg({ name: { ok: L(`Identifiant changé : ${r.username}. Utilisez-le à la prochaine connexion.`, `Username changed to ${r.username}. Use it next time you sign in.`) } })
    } catch (err) { setMsg({ name: { error: err.message } }) } finally { setBusy('') }
  }

  async function savePassword(e) {
    e.preventDefault()
    if (pw.newPassword !== pw.confirm) { setMsg({ pw: { error: L('Les deux nouveaux mots de passe ne sont pas identiques.', 'The two new passwords do not match.') } }); return }
    setBusy('pw'); setMsg({})
    try {
      await adminFetch('/profile/password', { method: 'PUT', body: JSON.stringify({ currentPassword: pw.currentPassword, newPassword: pw.newPassword }) })
      setPw({ currentPassword: '', newPassword: '', confirm: '' })
      setMsg({ pw: { ok: L('Mot de passe changé.', 'Password changed.') } })
    } catch (err) { setMsg({ pw: { error: err.message } }) } finally { setBusy('') }
  }

  const Note = ({ m }) => (m ? <div className={`alert ${m.ok ? 'ok' : ''}`} role="status"><span>{m.ok || m.error}</span></div> : null)
  return (
    <>
      <header className="hero">
        <p className="mono muted">{L('Compte', 'Account')} · {user?.role}</p>
        <h1>{L(<>Mon <em className="serif accent">compte</em></>, <>My <em className="serif accent">account</em></>)}</h1>
        <p className="lead muted">{L(`Connecté en tant que ${user?.username}. Votre identifiant et votre mot de passe servent à vous connecter au dashboard.`, `Signed in as ${user?.username}. Your username and password sign you in to the dashboard.`)}</p>
      </header>
      <div className="layout" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <form className="panel" onSubmit={saveUsername}>
          <h2><span className="idx">01</span>{L('Identifiant', 'Username')}</h2>
          <div className="signin">
            <Note m={msg.name} />
            <label className="field">{L('Nouvel identifiant', 'New username')}
              <input value={name.username} onChange={e => setName(n => ({ ...n, username: e.target.value }))} autoComplete="username" required minLength={3} />
            </label>
            <label className="field">{L('Mot de passe actuel', 'Current password')}
              <input type="password" value={name.currentPassword} onChange={e => setName(n => ({ ...n, currentPassword: e.target.value }))} autoComplete="current-password" required />
            </label>
            <p className="small muted">{L('Lettres, chiffres, . _ - ; 3 caractères au moins.', 'Letters, numbers, . _ -; at least 3 characters.')}</p>
            <button className="btn primary" disabled={busy === 'name' || name.username === user?.username}>{busy === 'name' ? '…' : L('Changer l’identifiant', 'Change username')}</button>
          </div>
        </form>
        <form className="panel" onSubmit={savePassword}>
          <h2><span className="idx">02</span>{L('Mot de passe', 'Password')}</h2>
          <div className="signin">
            <Note m={msg.pw} />
            <label className="field">{L('Mot de passe actuel', 'Current password')}
              <input type="password" value={pw.currentPassword} onChange={e => setPw(p => ({ ...p, currentPassword: e.target.value }))} autoComplete="current-password" required />
            </label>
            <label className="field">{L('Nouveau mot de passe', 'New password')}
              <input type="password" value={pw.newPassword} onChange={e => setPw(p => ({ ...p, newPassword: e.target.value }))} autoComplete="new-password" required minLength={8} />
            </label>
            <label className="field">{L('Nouveau mot de passe, encore', 'New password, again')}
              <input type="password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} autoComplete="new-password" required minLength={8} />
            </label>
            <p className="small muted">{L('8 caractères au moins.', 'At least 8 characters.')}</p>
            <button className="btn primary" disabled={busy === 'pw'}>{busy === 'pw' ? '…' : L('Changer le mot de passe', 'Change password')}</button>
          </div>
        </form>
        <section className="panel">
          <h2><span className="idx">03</span>{L('Langue', 'Language')}</h2>
          <div className="signin">
            <p className="small muted" style={{ margin: 0 }}>{L('La langue du dashboard sur cet appareil.', 'The dashboard’s language on this device.')}</p>
            <div className="actions">
              {LANGS.map(l => (
                <button key={l.code} type="button" className={`btn ${lang === l.code ? 'primary' : ''}`} onClick={() => lang !== l.code && setLang(l.code)}>{l.label}</button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
