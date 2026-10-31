import { useCallback, useEffect, useState } from 'react'
import { adminFetch } from '../pages/admin/utils/api.js'
import { useUi } from './ui.jsx'
import { L, locale } from './i18n.js'

// Users (super admin): the owners of the platform. Each owner runs their own
// shop: their bots, styles, captures, catalog, customers, orders and
// withdrawals. Disabling an account shuts it out at once.
const EMPTY = { username: '', password: '', role: 'admin' }
const ROLE = () => ({ admin: L('Propriétaire', 'Owner'), superadmin: 'Super admin' })
const when = d => (d ? new Date(d).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : L('Jamais', 'Never'))

function Editor({ initial, onClose, onSaved }) {
  const creating = !initial
  const [form, setForm] = useState(creating ? EMPTY : { username: initial.username, password: '', role: initial.role })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  async function save(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const body = creating ? form : { username: form.username, role: form.role, ...(form.password ? { password: form.password } : {}) }
      await adminFetch(creating ? '/admin/staff' : `/admin/staff/${initial.id}`, { method: creating ? 'POST' : 'PUT', body: JSON.stringify(body) })
      onSaved()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  return (
    <form className="panel" onSubmit={save} style={{ marginBottom: 16 }}>
      <div className="row-head">
        <h2>{creating ? L('Nouvel utilisateur', 'New user') : L(`Modifier ${initial.username}`, `Edit ${initial.username}`)}</h2>
        <button type="button" className="btn sm" onClick={onClose}>{L('Fermer', 'Close')}</button>
      </div>
      <div className="signin">
        {error && <div className="alert" role="alert"><span>{error}</span></div>}
        <div className="import-opts">
          <label className="field">{L('Identifiant', 'Username')}<input value={form.username} onChange={set('username')} required minLength={3} autoComplete="off" /></label>
          <label className="field">{creating ? L('Mot de passe', 'Password') : L('Nouveau mot de passe (vide = inchangé)', 'New password (empty = unchanged)')}
            <input type="password" value={form.password} onChange={set('password')} required={creating} minLength={8} autoComplete="new-password" />
          </label>
          <label className="field">{L('Rôle', 'Role')}
            <select value={form.role} onChange={set('role')} disabled={initial?.me}>
              <option value="admin">{L('Propriétaire : sa propre boutique de bots', 'Owner: their own shop of bots')}</option>
              <option value="superadmin">{L('Super admin : voit et gère tout', 'Super admin: sees and manages everything')}</option>
            </select>
          </label>
        </div>
        <p className="small muted">
          {creating ? L('Donnez-lui son identifiant et son mot de passe : il pourra les changer dans « Mon compte ».', 'Give them their username and password: they can change both in “My account”.')
            : L('Un nouveau mot de passe remplace l’ancien tout de suite.', 'A new password replaces the old one at once.')}
          {' '}{L('Un propriétaire ne voit que ses bots, ses produits, ses clients, ses commandes et ses retraits.', 'An owner only sees their own bots, products, customers, orders and withdrawals.')}
        </p>
        <div className="actions"><button className="btn primary" disabled={saving}>{saving ? '…' : creating ? L('Créer le compte', 'Create the account') : L('Enregistrer', 'Save')}</button></div>
      </div>
    </form>
  )
}

export default function StaffPage() {
  const { confirm, notify } = useUi()
  const [staff, setStaff] = useState(null)
  const [editing, setEditing] = useState(null) // null | 'new' | user
  const [error, setError] = useState('')
  const load = useCallback(() => adminFetch('/admin/staff').then(d => setStaff(d.staff)).catch(e => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  const roles = ROLE()

  async function toggle(u) {
    const ban = u.isActive
    if (ban && !(await confirm(L(`Bannir ${u.username} ? Il ne pourra plus se connecter. Ses bots, clients et commandes restent en place.`, `Ban ${u.username}? They can no longer sign in. Their bots, customers and orders stay in place.`), { ok: L('Bannir', 'Ban'), danger: true }))) return
    setError('')
    try {
      await adminFetch(`/admin/staff/${u.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !ban }) })
      notify(ban ? L(`${u.username} est banni.`, `${u.username} is banned.`) : L(`${u.username} est réactivé.`, `${u.username} is active again.`), 'ok')
      load()
    } catch (e) { setError(e.message) }
  }

  return (
    <>
      <header className="hero">
        <p className="mono muted">Super admin · {L('Comptes', 'Accounts')}</p>
        <h1>{L(<>Utili<em className="serif accent">sateurs</em></>, <><em className="serif accent">Users</em></>)}</h1>
        <p className="lead muted">{L('Les propriétaires de la plateforme. Chacun gère sa propre boutique de bots : ses bots, ses styles, ses captures, ses produits, ses clients, ses commandes et ses retraits.', 'The owners of the platform. Each one runs their own shop of bots: their bots, styles, captures, products, customers, orders and withdrawals.')}</p>
      </header>
      {error && <div className="alert" role="alert"><span>{error}</span><button className="close" onClick={() => setError('')} aria-label={L('Fermer', 'Close')}>×</button></div>}
      {editing && <Editor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      <section className="panel">
        <div className="row-head">
          <h2>{L('Comptes', 'Accounts')} <span className="count">{staff?.length ?? ''}</span></h2>
          <button className="btn primary" onClick={() => setEditing('new')}>{L('Ajouter un utilisateur', 'Add a user')}</button>
        </div>
        {!staff ? <div className="empty-state">{L('Chargement…', 'Loading…')}</div> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>{L('Identifiant', 'Username')}</th><th>{L('Rôle', 'Role')}</th><th>Bots</th><th>{L('Clients', 'Customers')}</th><th>{L('Dernière connexion', 'Last sign-in')}</th><th>{L('État', 'State')}</th><th /></tr></thead>
              <tbody>
                {staff.map(u => (
                  <tr key={u.id}>
                    <td><b>{u.username}</b>{u.me && <span className="muted small"> {L('(vous)', '(you)')}</span>}</td>
                    <td>{roles[u.role] || u.role}</td>
                    <td>{u.bots}</td>
                    <td>{u.customers}</td>
                    <td className="small">{when(u.lastLoginAt)}</td>
                    <td><span className="admin-badge" style={u.isActive ? { background: 'var(--ok-soft)', color: 'var(--ok)' } : { background: 'var(--orange-soft)', color: 'var(--orange)' }}>{u.isActive ? L('Actif', 'Active') : L('Banni', 'Banned')}</span></td>
                    <td>
                      <div className="actions" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn sm" onClick={() => setEditing(u)}>{L('Modifier', 'Edit')}</button>
                        {!u.me && <button className={`btn sm ${u.isActive ? 'danger' : ''}`} onClick={() => toggle(u)}>{u.isActive ? L('Bannir', 'Ban') : L('Réactiver', 'Reactivate')}</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
