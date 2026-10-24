import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminFetch } from './utils/api.js'
import Pagination from '../../components/admin/Pagination.jsx'

const STATUS_STYLE = {
  open:        { bg: '#d4edda', color: '#155724' },
  in_progress: { bg: '#cce5ff', color: '#004085' },
  resolved:    { bg: '#e2e3f3', color: '#3d3d8f' },
  closed:      { bg: '#e9ecef', color: '#6c757d' },
}
const PRIORITY_STYLE = {
  low:    { bg: '#e9ecef', color: '#555' },
  normal: { bg: '#fff3cd', color: '#856404' },
  high:   { bg: '#f8d7da', color: '#721c24' },
  urgent: { bg: '#dc3545', color: '#fff' },
}

export default function AdminSupport() {
  const navigate = useNavigate()
  const [tickets, setTickets] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 20 })
      if (status) params.set('status', status)
      if (priority) params.set('priority', priority)
      const data = await adminFetch(`/admin/support/tickets?${params}`)
      setTickets(data.tickets || [])
      setTotalPages(data.pagination?.totalPages || 1)
    } catch {
      setTickets([])
    } finally {
      setLoading(false)
    }
  }, [page, status, priority])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  function formatDate(str) {
    if (!str) return '—'
    return new Date(str).toLocaleDateString()
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Support Tickets</h1>
          <p className="admin-page-subtitle">Manage customer support tickets</p>
        </div>
      </div>

      <div className="admin-filters">
        <select className="admin-filter-select" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}>
          <option value="">All Statuses</option>
          {Object.keys(STATUS_STYLE).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select className="admin-filter-select" value={priority} onChange={e => { setPriority(e.target.value); setPage(1) }}>
          <option value="">All Priorities</option>
          {Object.keys(PRIORITY_STYLE).map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="admin-filter-btn" onClick={fetchTickets}>Refresh</button>
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Category</th>
                <th>User</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j}><span className="admin-skel" style={{ width: '80px', height: '16px' }} /></td>
                    ))}
                  </tr>
                ))
              ) : tickets.length === 0 ? (
                <tr><td colSpan={7} className="admin-table-empty">No data found.</td></tr>
              ) : tickets.map(t => {
                const ss = STATUS_STYLE[t.status?.toLowerCase()] || { bg: '#e9ecef', color: '#555' }
                const ps = PRIORITY_STYLE[t.priority?.toLowerCase()] || { bg: '#e9ecef', color: '#555' }
                return (
                  <tr key={t.id}>
                    <td>
                      {t.subject || '—'}
                      {t._count?.messages > 0 && <span className="admin-text-muted"> · {t._count.messages} msg</span>}
                    </td>
                    <td>{t.category || '—'}</td>
                    <td>{t.user?.username || '—'}</td>
                    <td><span className="admin-badge" style={{ background: ss.bg, color: ss.color }}>{t.status?.replace('_', ' ')}</span></td>
                    <td><span className="admin-badge" style={{ background: ps.bg, color: ps.color }}>{t.priority}</span></td>
                    <td>{formatDate(t.createdAt)}</td>
                    <td>
                      <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => navigate(`/admin/support/${t.id}`)}>
                        View
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  )
}
