import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminFetch } from './utils/api.js'
import StatusBadge from '../../components/admin/StatusBadge.jsx'
import Pagination from '../../components/admin/Pagination.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { isAdmin } from '../../utils/roles.js'
import { askConfirm, showMessage } from './dialog'

// Roles the current account may hand out (mirrors assertCanAssignRole in the backend)
function roleOptions(actor) {
  if (actor?.role === 'superadmin') return ['customer', 'moderator', 'admin', 'superadmin']
  if (isAdmin(actor)) return ['customer', 'moderator', 'admin']
  return ['customer']
}
const roleLabel = r => (r === 'superadmin' ? 'Super Admin' : r.charAt(0).toUpperCase() + r.slice(1))

function CreateUserModal({ actor, onClose, onCreated }) {
  const [form, setForm] = useState({ username: '', password: '', role: 'customer' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await adminFetch('/admin/users', { method: 'POST', body: JSON.stringify(form) })
      onCreated()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal">
        <button className="admin-modal-close" onClick={onClose}>×</button>
        <h2 className="admin-modal-title">Create User</h2>
        {error && <div style={{ color: '#dc3545', marginBottom: '12px', fontSize: '0.875rem' }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="admin-form-group">
            <label className="admin-label">Username</label>
            <input className="admin-input" required value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
          </div>
          <div className="admin-form-group">
            <label className="admin-label">Password</label>
            <input className="admin-input" type="password" required value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          </div>
          <div className="admin-form-group">
            <label className="admin-label">Role</label>
            <select className="admin-select" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {roleOptions(actor).map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </div>
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="admin-btn admin-btn-primary" disabled={loading}>
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function AdminUsers() {
  const navigate = useNavigate()
  const { user: actor } = useApp()
  const [users, setUsers] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [tier, setTier] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const requestIdRef = useRef(0)

  // Debounce search input before it triggers a fetch
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  const fetchUsers = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 20 })
      if (search) params.set('search', search)
      if (tier) params.set('tier', tier)
      const data = await adminFetch(`/admin/users?${params}`)
      if (requestId !== requestIdRef.current) return
      setUsers(data.users || data || [])
      setTotalPages(data.pagination?.totalPages || data.totalPages || 1)
    } catch {
      if (requestId === requestIdRef.current) setUsers([])
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [page, search, tier])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  async function handleRoleChange(userId, newRole) {
    try {
      await adminFetch(`/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify({ role: newRole }) })
    } catch (err) {
      showMessage(err.message)
    }
    fetchUsers()
  }

  async function handleBanToggle(user) {
    if (!(await askConfirm(`${user.isActive ? 'Ban' : 'Unban'} ${user.username}?`, { okLabel: user.isActive ? 'Ban' : 'Unban', danger: user.isActive }))) return
    try {
      await adminFetch(`/admin/users/${user.id}/ban`, { method: 'PATCH' })
      fetchUsers()
    } catch (err) {
      showMessage(err.message)
    }
  }

  async function handleDelete(user) {
    if (!(await askConfirm(`Delete ${user.username} permanently? This cannot be undone.`, { okLabel: 'Delete', danger: true }))) return
    try {
      await adminFetch(`/admin/users/${user.id}`, { method: 'DELETE' })
      fetchUsers()
    } catch (err) {
      showMessage(err.message)
    }
  }

  function formatDate(str) {
    if (!str) return '—'
    return new Date(str).toLocaleDateString()
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Users</h1>
          <p className="admin-page-subtitle">Manage user accounts</p>
        </div>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowCreate(true)}>
          + Create User
        </button>
      </div>

      <div className="admin-filters">
        <input
          className="admin-filter-input"
          placeholder="Search username…"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
        />
        <select className="admin-filter-select" value={tier} onChange={e => { setTier(e.target.value); setPage(1) }}>
          <option value="">All Tiers</option>
          <option value="basic">Basic</option>
          <option value="preferred">Preferred</option>
          <option value="gold">Gold</option>
          <option value="platinum">Platinum</option>
        </select>
        <button className="admin-filter-btn" onClick={fetchUsers}>Refresh</button>
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Tier</th>
                <th>Balance</th>
                <th>Orders</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j}><span className="admin-skel" style={{ width: '80px', height: '16px' }} /></td>
                    ))}
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr><td colSpan={8} className="admin-table-empty">No data found.</td></tr>
              ) : users.map(u => (
                <tr key={u.id}>
                  <td>
                    <div className="admin-flex">
                      <div className="admin-avatar">{u.username?.charAt(0)?.toUpperCase()}</div>
                      <span>{u.username}</span>
                    </div>
                  </td>
                  <td>
                    {roleOptions(actor).includes(u.role) && u.id !== actor?.id ? (
                      <select
                        className="admin-select"
                        style={{ padding: '2px 6px', fontSize: '0.75rem', height: 'auto' }}
                        value={u.role}
                        onChange={e => handleRoleChange(u.id, e.target.value)}
                      >
                        {roleOptions(actor).map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                      </select>
                    ) : (
                      <StatusBadge type="role" value={u.role} />
                    )}
                  </td>
                  <td><StatusBadge type="tier" value={u.tier} /></td>
                  <td>${Number(u.balance || 0).toFixed(2)}</td>
                  <td>{u._count?.orders ?? '—'}</td>
                  <td>
                    <span style={{ color: u.isActive ? '#28a745' : '#dc3545', fontWeight: 600, fontSize: '0.8rem' }}>
                      {u.isActive ? 'Active' : 'Banned'}
                    </span>
                  </td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td>
                    <div className="admin-flex" style={{ gap: '4px', flexWrap: 'wrap' }}>
                      <button
                        className="admin-btn admin-btn-secondary admin-btn-sm"
                        onClick={() => navigate(`/admin/users/${u.id}`)}
                      >
                        View
                      </button>
                      <button
                        className={'admin-btn admin-btn-sm ' + (u.isActive ? 'admin-btn-danger' : 'admin-btn-success')}
                        onClick={() => handleBanToggle(u)}
                      >
                        {u.isActive ? 'Ban' : 'Unban'}
                      </button>
                      <button
                        className="admin-btn admin-btn-sm"
                        style={{ background: '#6c757d', color: '#fff', border: 'none' }}
                        onClick={() => handleDelete(u)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>

      {showCreate && (
        <CreateUserModal actor={actor} onClose={() => setShowCreate(false)} onCreated={fetchUsers} />
      )}
    </div>
  )
}
