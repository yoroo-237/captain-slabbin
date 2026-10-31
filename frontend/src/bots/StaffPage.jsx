import { useCallback, useEffect, useState } from 'react'
import { adminFetch } from '../pages/admin/utils/api.js'
import { useUi } from './ui.jsx'

// Utilisateurs (super admin): the owners of the platform. Each owner runs their
// own shop: their bots, styles, captures, catalog, customers, orders and
// withdrawals. Disabling an account shuts it out at once.
const EMPTY = { username: '', password: '', role: 'admin' }
const ROLE = { admin: 'Propriétaire', superadmin: 'Super admin' }
const when = d => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'Jamais')

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
        <h2>{creating ? 'Nouvel utilisateur' : `Modifier ${initial.username}`}</h2>
        <button type="button" className="btn sm" onClick={onClose}>Fermer</button>
      </div>
      <div className="signin">
        {error && <div className="alert" role="alert"><span>{error}</span></div>}
        <div className="import-opts">
          <label className="field">Identifiant<input value={form.username} onChange={set('username')} required minLength={3} autoComplete="off" /></label>
          <label className="field">{creating ? 'Mot de passe' : 'Nouveau mot de passe (vide = inchangé)'}
            <input type="password" value={form.password} onChange={set('password')} required={creating} minLength={8} autoComplete="new-password" />
          </label>
          <label className="field">Rôle
            <select value={form.role} onChange={set('role')} disabled={initial?.me}>
              <option value="admin">Propriétaire : sa propre boutique de bots</option>
              <option value="superadmin">Super admin : voit et gère tout</option>
            </select>
          </label>
        </div>
        <p className="small muted">
          {creating ? 'Donnez-lui son identifiant et son mot de passe : il pourra les changer dans « Mon compte ».'
            : 'Un nouveau mot de passe remplace l’ancien tout de suite.'}
          {' '}Un propriétaire ne voit que ses bots, ses produits, ses clients, ses commandes et ses retraits.
        </p>
        <div className="actions"><button className="btn primary" disabled={saving}>{saving ? '…' : creating ? 'Créer le compte' : 'Enregistrer'}</button></div>
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

  async function toggle(u) {
    const ban = u.isActive
    if (ban && !(await confirm(`Bannir ${u.username} ? Il ne pourra plus se connecter. Ses bots, clients et commandes restent en place.`, { ok: 'Bannir', danger: true }))) return
    setError('')
    try {
      await adminFetch(`/admin/staff/${u.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !ban }) })
      notify(ban ? `${u.username} est banni.` : `${u.username} est réactivé.`, 'ok')
      load()
    } catch (e) { setError(e.message) }
  }

  return (
    <>
      <header className="hero">
        <p className="mono muted">Super admin · Comptes</p>
        <h1>Utili<em className="serif accent">sateurs</em></h1>
        <p className="lead muted">Les propriétaires de la plateforme. Chacun gère sa propre boutique de bots : ses bots, ses styles, ses captures, ses produits, ses clients, ses commandes et ses retraits.</p>
      </header>
      {error && <div className="alert" role="alert"><span>{error}</span><button className="close" onClick={() => setError('')} aria-label="Fermer">×</button></div>}
      {editing && <Editor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      <section className="panel">
        <div className="row-head">
          <h2>Comptes <span className="count">{staff?.length ?? ''}</span></h2>
          <button className="btn primary" onClick={() => setEditing('new')}>Ajouter un utilisateur</button>
        </div>
        {!staff ? <div className="empty-state">Chargement…</div> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Identifiant</th><th>Rôle</th><th>Bots</th><th>Clients</th><th>Dernière connexion</th><th>État</th><th /></tr></thead>
              <tbody>
                {staff.map(u => (
                  <tr key={u.id}>
                    <td><b>{u.username}</b>{u.me && <span className="muted small"> (vous)</span>}</td>
                    <td>{ROLE[u.role] || u.role}</td>
                    <td>{u.bots}</td>
                    <td>{u.customers}</td>
                    <td className="small">{when(u.lastLoginAt)}</td>
                    <td><span className="admin-badge" style={u.isActive ? { background: 'var(--ok-soft)', color: 'var(--ok)' } : { background: 'var(--orange-soft)', color: 'var(--orange)' }}>{u.isActive ? 'Actif' : 'Banni'}</span></td>
                    <td>
                      <div className="actions" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn sm" onClick={() => setEditing(u)}>Modifier</button>
                        {!u.me && <button className={`btn sm ${u.isActive ? 'danger' : ''}`} onClick={() => toggle(u)}>{u.isActive ? 'Bannir' : 'Réactiver'}</button>}
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
