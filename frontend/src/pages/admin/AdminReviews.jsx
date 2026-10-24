import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from './utils/api.js'
import Pagination from '../../components/admin/Pagination.jsx'

function StarRating({ value }) {
  return (
    <span style={{ color: '#f7c59f', letterSpacing: '2px' }}>
      {'★'.repeat(value || 0)}{'☆'.repeat(5 - (value || 0))}
      {' '}
      <span style={{ color: '#888', fontSize: '0.8rem' }}>({value}/5)</span>
    </span>
  )
}

const PER_PAGE = 20

export default function AdminReviews() {
  const [reviews, setReviews] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)

  const fetchReviews = useCallback(async () => {
    setLoading(true)
    try {
      // The endpoint returns every review — paginate client-side
      const data = await adminFetch('/admin/reviews')
      const all = Array.isArray(data) ? data : []
      setTotalPages(Math.max(1, Math.ceil(all.length / PER_PAGE)))
      setReviews(all.slice((page - 1) * PER_PAGE, page * PER_PAGE))
    } catch { setReviews([]) }
    finally { setLoading(false) }
  }, [page])

  useEffect(() => { fetchReviews() }, [fetchReviews])

  async function handleApprove(review) {
    try {
      await adminFetch(`/admin/reviews/${review.id}/approve`, { method: 'PATCH' })
      fetchReviews()
    } catch (e) { alert(e.message) }
  }

  async function handleDelete(review) {
    if (!confirm('Delete this review?')) return
    try {
      await adminFetch(`/admin/reviews/${review.id}`, { method: 'DELETE' })
      fetchReviews()
    } catch (e) { alert(e.message) }
  }

  function formatDate(str) {
    if (!str) return '—'
    return new Date(str).toLocaleDateString()
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Reviews</h1>
          <p className="admin-page-subtitle">Moderate product reviews</p>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>User</th>
                <th>Rating</th>
                <th>Comment</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((_, j) => <td key={j}><span className="admin-skel" style={{ width: '70px', height: '16px' }} /></td>)}</tr>
                ))
              ) : reviews.length === 0 ? (
                <tr><td colSpan={7} className="admin-table-empty">No data found.</td></tr>
              ) : reviews.map(r => (
                <tr key={r.id}>
                  <td>{r.product?.name || r.productName || '—'}</td>
                  <td>{r.user?.username || '—'}</td>
                  <td><StarRating value={r.rating} /></td>
                  <td style={{ maxWidth: '200px', fontSize: '0.85rem', color: '#555' }}>
                    {r.comment?.slice(0, 80)}{r.comment?.length > 80 ? '…' : ''}
                  </td>
                  <td>
                    <span className="admin-badge" style={{
                      background: r.isApproved ? '#d4edda' : '#fff3cd',
                      color: r.isApproved ? '#155724' : '#856404',
                    }}>
                      {r.isApproved ? 'Approved' : 'Pending'}
                    </span>
                  </td>
                  <td>{formatDate(r.createdAt)}</td>
                  <td>
                    <div className="admin-gap-actions">
                      {!r.isApproved && (
                        <button className="admin-btn admin-btn-success admin-btn-sm" onClick={() => handleApprove(r)}>Approve</button>
                      )}
                      <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                    </div>
                  </td>
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
