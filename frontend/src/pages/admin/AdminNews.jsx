import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from './utils/api.js'

function Modal({ title, onClose, children }) {
  return (
    <div className="admin-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal" style={{ maxWidth: '600px' }}>
        <button className="admin-modal-close" onClick={onClose}>×</button>
        <h2 className="admin-modal-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString()
}

export default function AdminNews() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ title: '', content: '', isPublished: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminFetch('/admin/news')
      setItems(Array.isArray(data) ? data : [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchItems() }, [fetchItems])

  function openCreate() { setForm({ title: '', content: '', isPublished: false }); setModal({ mode: 'create' }); setError('') }
  function openEdit(item) { setForm({ title: item.title, content: item.content, isPublished: !!item.isPublished }); setModal({ mode: 'edit', item }); setError('') }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (modal.mode === 'create') {
        await adminFetch('/admin/news', { method: 'POST', body: JSON.stringify(form) })
      } else {
        await adminFetch(`/admin/news/${modal.item.id}`, { method: 'PUT', body: JSON.stringify(form) })
      }
      setModal(null)
      fetchItems()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(item) {
    if (!confirm(`Delete "${item.title}"?`)) return
    try {
      await adminFetch(`/admin/news/${item.id}`, { method: 'DELETE' })
      fetchItems()
    } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">News</h1>
          <p className="admin-page-subtitle">Manage news articles</p>
        </div>
        <button className="admin-btn admin-btn-primary" onClick={openCreate}>+ Add Article</button>
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Title</th><th>Published</th><th>Date</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 4 }).map((_, j) => <td key={j}><span className="admin-skel" style={{ width: '80px', height: '16px' }} /></td>)}</tr>
                ))
              ) : items.length === 0 ? (
                <tr><td colSpan={4} className="admin-table-empty">No data found.</td></tr>
              ) : items.map(item => (
                <tr key={item.id}>
                  <td><strong>{item.title}</strong></td>
                  <td>
                    <span className="admin-badge" style={{ background: item.isPublished ? '#d4edda' : '#e9ecef', color: item.isPublished ? '#155724' : '#6c757d' }}>
                      {item.isPublished ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td>{formatDate(item.publishedAt || item.createdAt)}</td>
                  <td>
                    <div className="admin-gap-actions">
                      <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => openEdit(item)}>Edit</button>
                      <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => handleDelete(item)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal title={modal.mode === 'create' ? 'Add Article' : 'Edit Article'} onClose={() => setModal(null)}>
          {error && <div style={{ color: '#dc3545', marginBottom: '12px' }}>{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="admin-form-group">
              <label className="admin-label">Title</label>
              <input className="admin-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required />
            </div>
            <div className="admin-form-group">
              <label className="admin-label">Content</label>
              <textarea className="admin-textarea" rows={6} value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} required />
            </div>
            <div className="admin-form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.isPublished} onChange={e => setForm(f => ({ ...f, isPublished: e.target.checked }))} />
                <span className="admin-label" style={{ margin: 0 }}>Published</span>
              </label>
            </div>
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
