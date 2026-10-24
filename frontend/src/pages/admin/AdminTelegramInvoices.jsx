import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminFetch } from './utils/api.js'
import Pagination from '../../components/admin/Pagination.jsx'

const STATUSES = ['new', 'contacted', 'completed', 'cancelled']
const money = n => `$${Number(n).toFixed(2)}`

// Orders customers sent as an invoice on Telegram (guests included). Prices are
// computed by the server; staff follow up by message and track the status here.
export default function AdminTelegramInvoices() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')

  const load = () => {
    const qs = new URLSearchParams({ page: String(page), limit: '20', ...(status ? { status } : {}) })
    adminFetch(`/admin/telegram-invoices?${qs}`).then(setData).catch(e => setError(e.message))
  }
  useEffect(load, [page, status]) // eslint-disable-line react-hooks/exhaustive-deps

  async function setInvoiceStatus(id, next) {
    try {
      await adminFetch(`/admin/telegram-invoices/${id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) })
      load()
    } catch (e) { setError(e.message) }
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Telegram Orders</h1>
          <p className="admin-page-subtitle">Invoices sent from the bag on Telegram. “Delivered” means the bot posted it to the shop chat.</p>
        </div>
        <select className="admin-select" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} style={{ width: 180 }}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {error && <div className="admin-alert admin-alert-error">{error}</div>}

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Code</th><th>Date</th><th>Customer</th><th>Telegram</th><th>Total</th><th>Bot</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {!data ? <tr><td colSpan={8} className="admin-table-empty">Loading…</td></tr>
                : data.invoices.length === 0 ? <tr><td colSpan={8} className="admin-table-empty">No Telegram orders yet</td></tr>
                : data.invoices.map(inv => (
                  <tr key={inv.id}>
                    <td className="admin-code">{inv.code}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(inv.createdAt).toLocaleString()}</td>
                    <td>{inv.user ? <Link to={`/admin/users/${inv.user.id}`}>{inv.user.username}</Link> : <span style={{ color: '#888' }}>Guest</span>}{inv.contact && <div style={{ fontSize: 12, color: '#777' }}>{inv.contact}</div>}</td>
                    <td>{inv.telegramHandle ? `@${inv.telegramHandle.replace(/^@/, '')}` : '—'}</td>
                    <td style={{ fontWeight: 700 }}>{money(inv.total)}</td>
                    <td>{inv.delivered ? '✓ delivered' : <span style={{ color: '#b45309' }}>not sent</span>}</td>
                    <td>
                      <select className="admin-select" value={inv.status} onChange={e => setInvoiceStatus(inv.id, e.target.value)} style={{ minWidth: 120 }}>
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td><button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => setOpen(inv)}>View</button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {data?.pagination && <Pagination page={page} totalPages={data.pagination.totalPages} onChange={setPage} />}
      </div>

      {open && (
        <div className="admin-modal-overlay" onClick={e => e.target === e.currentTarget && setOpen(null)}>
          <div className="admin-modal">
            <div className="admin-modal-title">Telegram order {open.code}</div>
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f6f7fb', padding: 12, borderRadius: 8, fontSize: 13 }}>{open.text}</pre>
            <div className="admin-modal-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setOpen(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
