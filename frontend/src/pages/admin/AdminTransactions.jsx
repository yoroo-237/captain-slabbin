import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from './utils/api.js'
import StatusBadge from '../../components/admin/StatusBadge.jsx'
import Pagination from '../../components/admin/Pagination.jsx'

export default function AdminTransactions() {
  const [txns, setTxns] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    search: '', type: '', status: '', dateFrom: '', dateTo: '',
  })

  const fetchTxns = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 25 })
      Object.entries(filters).forEach(([k, v]) => v && params.set(k, v))
      const data = await adminFetch(`/admin/transactions?${params}`)
      setTxns(data.transactions || [])
      setTotalPages(data.pagination?.totalPages || 1)
    } catch {
      setTxns([])
    } finally {
      setLoading(false)
    }
  }, [page, filters])

  useEffect(() => { fetchTxns() }, [fetchTxns])

  function clearFilters() {
    setFilters({ search: '', type: '', status: '', dateFrom: '', dateTo: '' })
    setPage(1)
  }

  function setF(key, value) {
    setFilters(f => ({ ...f, [key]: value }))
    setPage(1)
  }

  function formatDate(str) {
    if (!str) return '—'
    return new Date(str).toLocaleString()
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Transactions</h1>
          <p className="admin-page-subtitle">All wallet transactions</p>
        </div>
      </div>

      <div className="admin-filters">
        <input className="admin-filter-input" placeholder="Search username…" value={filters.search} onChange={e => setF('search', e.target.value)} />
        <select className="admin-filter-select" value={filters.type} onChange={e => setF('type', e.target.value)}>
          <option value="">All Types</option>
          <option value="deposit">Deposit</option>
          <option value="purchase">Purchase</option>
          <option value="refund">Refund</option>
          <option value="adjustment">Adjustment</option>
          <option value="bonus">Bonus</option>
        </select>
        <select className="admin-filter-select" value={filters.status} onChange={e => setF('status', e.target.value)}>
          <option value="">All Statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
        <input className="admin-filter-input" type="date" value={filters.dateFrom} onChange={e => setF('dateFrom', e.target.value)} title="From date" />
        <input className="admin-filter-input" type="date" value={filters.dateTo} onChange={e => setF('dateTo', e.target.value)} title="To date" />
        <button className="admin-filter-btn" onClick={clearFilters}>Clear Filters</button>
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>User</th>
                <th>Type</th>
                <th>Amount (USD)</th>
                <th>Status</th>
                <th>Note</th>
                <th>Related To</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j}><span className="admin-skel" style={{ width: '70px', height: '16px' }} /></td>
                    ))}
                  </tr>
                ))
              ) : txns.length === 0 ? (
                <tr><td colSpan={8} className="admin-table-empty">No data found.</td></tr>
              ) : txns.map(t => (
                <tr key={t.id}>
                  <td><span className="admin-code">{t.id}</span></td>
                  <td>{t.user?.username || t.userId || '—'}</td>
                  <td><StatusBadge type="txn" value={t.type} /></td>
                  <td>
                    <span style={{ color: Number(t.amount) >= 0 ? '#28a745' : '#dc3545', fontWeight: 700 }}>
                      {Number(t.amount) >= 0 ? '+' : ''}{Number(t.amount).toFixed(2)}
                    </span>
                  </td>
                  <td>{t.status || '—'}</td>
                  <td>{t.note || '—'}</td>
                  <td>
                    {t.order ? <span className="admin-code">{t.order.orderNumber}</span>
                      : t.deposit ? <span className="admin-code">{t.deposit.currency} deposit</span>
                      : '—'}
                  </td>
                  <td>{formatDate(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  )
}
