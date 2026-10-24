import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { adminFetch } from './utils/api.js'
import StatusBadge from '../../components/admin/StatusBadge.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { isAdmin } from '../../utils/roles.js'

const TABS = ['Profile', 'Orders', 'Transactions', 'Deposits', 'Tickets', 'API Keys']

function Modal({ title, onClose, children }) {
  return (
    <div className="admin-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal">
        <button className="admin-modal-close" onClick={onClose}>×</button>
        <h2 className="admin-modal-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

export default function AdminUserDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user: actor } = useApp()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('Profile')
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null) // 'password' | 'edit' | 'balance'
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')

  const [passwordForm, setPasswordForm] = useState({ password: '' })
  const [editForm, setEditForm] = useState({})
  const [balanceForm, setBalanceForm] = useState({ type: 'credit', currency: 'BTC', unit: 'crypto', amount: '', reason: '' })

  const fetchUser = useCallback(async () => {
    const data = await adminFetch(`/admin/users/${id}`)
    return data.user || data
  }, [id])

  // Refresh in place (after ban/edit/balance actions) — keeps current data visible while it runs
  const refresh = useCallback(() => {
    fetchUser()
      .then(u => { setUser(u); setEditForm({ username: u.username, role: u.role, markupPct: u.markupPct ?? 0 }) })
      .catch(e => setError(e.message))
  }, [fetchUser])

  useEffect(() => {
    let stale = false
    setLoading(true)
    setUser(null)
    setError('')
    fetchUser()
      .then(u => { if (!stale) { setUser(u); setEditForm({ username: u.username, role: u.role, markupPct: u.markupPct ?? 0 }) } })
      .catch(e => { if (!stale) setError(e.message) })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [fetchUser])

  async function banToggle() {
    if (!confirm(`${user.isActive ? 'Ban' : 'Unban'} ${user.username}?`)) return
    setActionLoading(true)
    try {
      await adminFetch(`/admin/users/${id}/ban`, { method: 'PATCH' })
      refresh()
    } catch (e) {
      alert(e.message)
    } finally {
      setActionLoading(false)
    }
  }

  async function deleteUser() {
    if (!confirm(`Delete ${user.username} permanently? This cannot be undone.`)) return
    setActionLoading(true)
    try {
      await adminFetch(`/admin/users/${id}`, { method: 'DELETE' })
      navigate('/admin/users')
    } catch (e) {
      alert(e.message)
      setActionLoading(false)
    }
  }

  async function setPassword(e) {
    e.preventDefault()
    setActionLoading(true)
    setActionError('')
    try {
      await adminFetch(`/admin/users/${id}/password`, { method: 'PATCH', body: JSON.stringify(passwordForm) })
      setModal(null)
    } catch (e) {
      setActionError(e.message)
    } finally {
      setActionLoading(false)
    }
  }

  async function editUser(e) {
    e.preventDefault()
    setActionLoading(true)
    setActionError('')
    try {
      await adminFetch(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(editForm) })
      setModal(null)
      refresh()
    } catch (e) {
      setActionError(e.message)
    } finally {
      setActionLoading(false)
    }
  }

  async function adjustBalance(e) {
    e.preventDefault()
    setActionLoading(true)
    setActionError('')
    try {
      await adminFetch(`/admin/users/${id}/wallet/adjust`, {
        method: 'POST',
        body: JSON.stringify({
          type:     balanceForm.type,
          currency: balanceForm.currency,
          reason:   balanceForm.reason,
          [balanceForm.unit === 'usd' ? 'usdAmount' : 'amount']: parseFloat(balanceForm.amount),
        }),
      })
      setModal(null)
      refresh()
    } catch (e) {
      setActionError(e.message)
    } finally {
      setActionLoading(false)
    }
  }

  function formatDate(str) {
    if (!str) return '—'
    return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  if (loading) return <div style={{ padding: '40px', color: '#888' }}>Loading…</div>
  if (error)   return <div style={{ color: '#dc3545', padding: '20px' }}>{error}</div>
  if (!user)   return null

  const isBanned = !user.isActive

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <button
            className="admin-btn admin-btn-secondary admin-btn-sm"
            onClick={() => navigate('/admin/users')}
            style={{ marginBottom: '8px' }}
          >
            ← Back to Users
          </button>
          <h1 className="admin-page-title">{user.username}</h1>
          <p className="admin-page-subtitle">
            <StatusBadge type="role" value={user.role} />
            {' '}
            <StatusBadge type="tier" value={user.tier} />
            {' '}
            {isBanned && <span style={{ color: '#dc3545', fontWeight: 700, fontSize: '0.8rem' }}>BANNED</span>}
          </p>
        </div>
        <div className="admin-gap-actions">
          <button
            className="admin-btn admin-btn-secondary admin-btn-sm"
            onClick={() => { setModal('password'); setActionError('') }}
          >
            Set Password
          </button>
          <button
            className="admin-btn admin-btn-secondary admin-btn-sm"
            onClick={() => { setModal('edit'); setActionError('') }}
          >
            Edit User
          </button>
          <button
            className="admin-btn admin-btn-primary admin-btn-sm"
            onClick={() => { setModal('balance'); setActionError(''); setBalanceForm({ type: 'credit', currency: 'BTC', unit: 'crypto', amount: '', reason: '' }) }}
          >
            Adjust Balance
          </button>
          <button
            className={'admin-btn admin-btn-sm ' + (isBanned ? 'admin-btn-success' : 'admin-btn-danger')}
            onClick={banToggle}
            disabled={actionLoading}
          >
            {isBanned ? 'Unban' : 'Ban'}
          </button>
          <button
            className="admin-btn admin-btn-sm"
            style={{ background: '#6c757d', color: '#fff', border: 'none' }}
            onClick={deleteUser}
            disabled={actionLoading}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="admin-tabs">
        {TABS.map(t => (
          <button key={t} className={'admin-tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Profile' && (
        <div className="admin-grid-2">
          <div className="admin-card">
            <h2 className="admin-card-title">Account Info</h2>
            <div className="admin-info-list">
              <div className="admin-info-row"><span className="admin-info-label">Username</span><span className="admin-info-value">{user.username}</span></div>
              <div className="admin-info-row"><span className="admin-info-label">Role</span><span className="admin-info-value"><StatusBadge type="role" value={user.role} /></span></div>
              <div className="admin-info-row"><span className="admin-info-label">Tier</span><span className="admin-info-value"><StatusBadge type="tier" value={user.tier} /></span></div>
              <div className="admin-info-row"><span className="admin-info-label">Balance (live)</span><span className="admin-info-value">${Number(user.balance || 0).toFixed(2)}</span></div>
              {(user.holdings || []).map(h => (
                <div key={h.currency} className="admin-info-row">
                  <span className="admin-info-label" style={{ paddingLeft: 12 }}>{h.currency}</span>
                  <span className="admin-info-value admin-code">{h.amount}{h.usd != null && ` ($${h.usd.toFixed(2)})`}</span>
                </div>
              ))}
              <div className="admin-info-row"><span className="admin-info-label">Total Spent</span><span className="admin-info-value">${Number(user.totalSpent || 0).toFixed(2)}</span></div>
              <div className="admin-info-row"><span className="admin-info-label">Points</span><span className="admin-info-value">{user.points ?? 0}</span></div>
              <div className="admin-info-row"><span className="admin-info-label">Markup %</span><span className="admin-info-value">{user.markupPct ?? 0}</span></div>
              <div className="admin-info-row"><span className="admin-info-label">Status</span><span className="admin-info-value">{isBanned ? <span style={{ color: '#dc3545', fontWeight: 700 }}>Banned</span> : <span style={{ color: '#28a745', fontWeight: 700 }}>Active</span>}</span></div>
              <div className="admin-info-row"><span className="admin-info-label">Joined</span><span className="admin-info-value">{formatDate(user.createdAt)}</span></div>
              <div className="admin-info-row"><span className="admin-info-label">Last Login</span><span className="admin-info-value">{formatDate(user.lastLoginAt)}</span></div>
            </div>
          </div>
          <div className="admin-card">
            <h2 className="admin-card-title">Contact / Profile</h2>
            <div className="admin-info-list">
              <div className="admin-info-row"><span className="admin-info-label">Telegram</span><span className="admin-info-value">{user.telegramHandle || '—'}</span></div>
              <div className="admin-info-row"><span className="admin-info-label">Signal</span><span className="admin-info-value">{user.signalDetails || '—'}</span></div>
              <div className="admin-info-row"><span className="admin-info-label">Session</span><span className="admin-info-value">{user.sessionDetails || '—'}</span></div>
              <div className="admin-info-row"><span className="admin-info-label">BTC Refund</span><span className="admin-info-value"><span className="admin-code">{user.btcRefundAddress || '—'}</span></span></div>
              <div className="admin-info-row"><span className="admin-info-label">XMR Refund</span><span className="admin-info-value"><span className="admin-code">{user.xmrRefundAddress || '—'}</span></span></div>
            </div>
          </div>
        </div>
      )}

      {tab === 'Orders' && (
        <div className="admin-card">
          <h2 className="admin-card-title">Orders</h2>
          <TablePlaceholder
            cols={['Order #', 'Total', 'Status', 'Date']}
            rows={user.orders || []}
            renderRow={o => [
              <span className="admin-code">#{o.orderNumber || o.id}</span>,
              `$${Number(o.totalAmount || 0).toFixed(2)}`,
              <StatusBadge type="status" value={o.status} />,
              formatDate(o.placedAt),
            ]}
          />
        </div>
      )}

      {tab === 'Transactions' && (
        <div className="admin-card">
          <h2 className="admin-card-title">Transactions</h2>
          <TablePlaceholder
            cols={['Type', 'Amount', 'Note', 'Date']}
            rows={user.transactions || []}
            renderRow={t => [
              t.type,
              <span style={{ color: Number(t.amount) >= 0 ? '#28a745' : '#dc3545', fontWeight: 700 }}>
                {Number(t.amount) >= 0 ? '+' : ''}{Number(t.amount).toFixed(2)}
              </span>,
              t.note || '—',
              formatDate(t.createdAt),
            ]}
          />
        </div>
      )}

      {tab === 'Deposits' && (
        <div className="admin-card">
          <h2 className="admin-card-title">Deposits</h2>
          <TablePlaceholder
            cols={['ID', 'Currency', 'USD Credited', 'Status', 'Date']}
            rows={user.deposits || []}
            renderRow={d => [
              <span className="admin-code">#{d.id}</span>,
              d.currency,
              `$${Number(d.usdCredited || 0).toFixed(2)}`,
              <StatusBadge type="deposit" value={d.status} />,
              formatDate(d.createdAt),
            ]}
          />
        </div>
      )}

      {tab === 'Tickets' && (
        <div className="admin-card">
          <h2 className="admin-card-title">Support Tickets</h2>
          <TablePlaceholder
            cols={['Subject', 'Status', 'Priority', 'Date']}
            rows={user.tickets || []}
            renderRow={t => [t.subject, t.status, t.priority, formatDate(t.createdAt)]}
          />
        </div>
      )}

      {tab === 'API Keys' && (
        <div className="admin-card">
          <h2 className="admin-card-title">API Keys</h2>
          <TablePlaceholder
            cols={['Prefix', 'Label', 'Created', 'Last Used']}
            rows={user.apiKeys || []}
            renderRow={k => [
              <span className="admin-code">{k.keyPrefix}</span>,
              k.label || '—',
              formatDate(k.createdAt),
              formatDate(k.lastUsed),
            ]}
          />
        </div>
      )}

      {/* Modal — Set Password */}
      {modal === 'password' && (
        <Modal title="Set Password" onClose={() => setModal(null)}>
          {actionError && <div style={{ color: '#dc3545', marginBottom: '12px' }}>{actionError}</div>}
          <form onSubmit={setPassword}>
            <div className="admin-form-group">
              <label className="admin-label">New Password</label>
              <input
                className="admin-input"
                type="password"
                required
                minLength={6}
                value={passwordForm.password}
                onChange={e => setPasswordForm({ password: e.target.value })}
              />
            </div>
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="admin-btn admin-btn-primary" disabled={actionLoading}>
                {actionLoading ? 'Saving…' : 'Set Password'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal — Edit User */}
      {modal === 'edit' && (
        <Modal title="Edit User" onClose={() => setModal(null)}>
          {actionError && <div style={{ color: '#dc3545', marginBottom: '12px' }}>{actionError}</div>}
          <form onSubmit={editUser}>
            <div className="admin-form-group">
              <label className="admin-label">Username</label>
              <input
                className="admin-input"
                value={editForm.username || ''}
                onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))}
              />
            </div>
            <div className="admin-form-group">
              <label className="admin-label">Role</label>
              <select
                className="admin-select"
                value={editForm.role || 'customer'}
                onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
              >
                {/* The account's current role is always listed so saving never changes it by accident */}
                {[...new Set([
                  ...(actor?.role === 'superadmin' ? ['customer', 'moderator', 'admin', 'superadmin']
                    : isAdmin(actor) ? ['customer', 'moderator', 'admin'] : ['customer']),
                  user.role,
                ])].map(r => <option key={r} value={r}>{r === 'superadmin' ? 'Super Admin' : r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
            <div className="admin-form-group">
              <label className="admin-label">Markup % (prix personnalisé)</label>
              <input
                className="admin-input"
                type="number"
                step="0.01"
                min="0"
                value={editForm.markupPct ?? 0}
                onChange={e => setEditForm(f => ({ ...f, markupPct: e.target.value }))}
              />
            </div>
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="admin-btn admin-btn-primary" disabled={actionLoading}>
                {actionLoading ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal — Adjust Balance */}
      {modal === 'balance' && (
        <Modal title="Adjust Balance" onClose={() => setModal(null)}>
          {actionError && <div style={{ color: '#dc3545', marginBottom: '12px' }}>{actionError}</div>}
          <form onSubmit={adjustBalance}>
            <div className="admin-form-group">
              <label className="admin-label">Type</label>
              <select
                className="admin-select"
                value={balanceForm.type}
                onChange={e => setBalanceForm(f => ({ ...f, type: e.target.value }))}
              >
                <option value="credit">Credit (add funds)</option>
                <option value="debit">Debit (remove funds)</option>
              </select>
            </div>
            <div className="admin-form-group">
              <label className="admin-label">Currency</label>
              <select className="admin-select" value={balanceForm.currency} onChange={e => setBalanceForm(f => ({ ...f, currency: e.target.value }))}>
                {['BTC', 'LTC', 'DOGE', 'ETH', 'XMR'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="admin-form-group">
              <label className="admin-label">Amount ({balanceForm.unit === 'usd' ? 'USD, converted at the live price' : balanceForm.currency})</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="admin-input"
                  type="number"
                  step={balanceForm.unit === 'usd' ? '0.01' : '0.00000001'}
                  min="0.00000001"
                  required
                  value={balanceForm.amount}
                  onChange={e => setBalanceForm(f => ({ ...f, amount: e.target.value }))}
                />
                <select className="admin-select" style={{ width: 110 }} value={balanceForm.unit} onChange={e => setBalanceForm(f => ({ ...f, unit: e.target.value }))}>
                  <option value="crypto">{balanceForm.currency}</option>
                  <option value="usd">USD</option>
                </select>
              </div>
            </div>
            <div className="admin-form-group">
              <label className="admin-label">Reason</label>
              <input
                className="admin-input"
                required
                value={balanceForm.reason}
                onChange={e => setBalanceForm(f => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="admin-btn admin-btn-primary" disabled={actionLoading}>
                {actionLoading ? 'Adjusting…' : 'Adjust'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function TablePlaceholder({ cols, rows, renderRow }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>{cols.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {!rows || rows.length === 0 ? (
            <tr><td colSpan={cols.length} className="admin-table-empty">No data found.</td></tr>
          ) : rows.map((row, i) => (
            <tr key={row.id || i}>
              {renderRow(row).map((cell, j) => <td key={j}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
