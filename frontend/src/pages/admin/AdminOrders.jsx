import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminFetch } from './utils/api.js'
import StatusBadge from '../../components/admin/StatusBadge.jsx'
import Pagination from '../../components/admin/Pagination.jsx'

// Must match VALID_STATUSES in backend/src/controllers/admin/orders.controller.js
const ORDER_STATUSES = ['processing', 'shipped', 'delivered', 'cancelled', 'refunded']

function UpdateStatusModal({ order, onClose, onUpdated }) {
  const [status, setStatus] = useState(order.status || 'processing')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await adminFetch(`/admin/orders/${order.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      onUpdated()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal">
        <button className="admin-modal-close" onClick={onClose}>×</button>
        <h2 className="admin-modal-title">Update Order Status</h2>
        <p style={{ color: '#888', fontSize: '0.875rem', marginBottom: '16px' }}>
          Order: <strong>#{order.orderNumber || order.id}</strong>
        </p>
        {error && <div style={{ color: '#dc3545', marginBottom: '12px' }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="admin-form-group">
            <label className="admin-label">New Status</label>
            <select className="admin-select" value={status} onChange={e => setStatus(e.target.value)}>
              {ORDER_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="admin-btn admin-btn-primary" disabled={loading}>
              {loading ? 'Updating…' : 'Update Status'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function AdminOrders() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [updateOrder, setUpdateOrder] = useState(null)
  const requestIdRef = useRef(0)

  // Debounce search input before it triggers a fetch
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  const fetchOrders = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 20 })
      if (search) params.set('search', search)
      if (status) params.set('status', status)
      const data = await adminFetch(`/admin/orders?${params}`)
      if (requestId !== requestIdRef.current) return
      setOrders(data.orders || [])
      setTotalPages(data.pagination?.totalPages || 1)
    } catch {
      if (requestId === requestIdRef.current) setOrders([])
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [page, search, status])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  function formatDate(str) {
    if (!str) return '—'
    return new Date(str).toLocaleDateString()
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Orders</h1>
          <p className="admin-page-subtitle">Manage customer orders</p>
        </div>
      </div>

      <div className="admin-filters">
        <input className="admin-filter-input" placeholder="Search order # / customer…" value={searchInput} onChange={e => setSearchInput(e.target.value)} />
        <select className="admin-filter-select" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}>
          <option value="">All Statuses</option>
          {ORDER_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <button className="admin-filter-btn" onClick={fetchOrders}>Refresh</button>
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j}><span className="admin-skel" style={{ width: '70px', height: '16px' }} /></td>
                    ))}
                  </tr>
                ))
              ) : orders.length === 0 ? (
                <tr><td colSpan={8} className="admin-table-empty">No data found.</td></tr>
              ) : orders.map(o => (
                <tr key={o.id}>
                  <td><span className="admin-code">#{o.orderNumber || o.id}</span></td>
                  <td>{o.user?.username || o.name || '—'}</td>
                  <td>{o.items ? o.items.reduce((n, i) => n + i.quantity, 0) : '—'}</td>
                  <td>${Number(o.totalAmount || 0).toFixed(2)}</td>
                  <td>{o.paymentMethod || '—'}</td>
                  <td><StatusBadge type="status" value={o.status} /></td>
                  <td>{formatDate(o.placedAt)}</td>
                  <td>
                    <div className="admin-gap-actions">
                      <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => navigate(`/admin/orders/${o.id}`)}>View</button>
                      <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => setUpdateOrder(o)}>Status</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>

      {updateOrder && (
        <UpdateStatusModal
          order={updateOrder}
          onClose={() => setUpdateOrder(null)}
          onUpdated={fetchOrders}
        />
      )}
    </div>
  )
}
