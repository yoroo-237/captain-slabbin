import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from './utils/api.js'

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

export default function AdminCategories() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | { mode: 'create' | 'edit', item?: {} }
  const [form, setForm] = useState({ name: '', slug: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminFetch('/admin/categories')
      setItems(data.categories || data || [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchItems() }, [fetchItems])

  function openCreate() { setForm({ name: '', slug: '' }); setModal({ mode: 'create' }); setError('') }
  function openEdit(item) { setForm({ name: item.name, slug: item.slug }); setModal({ mode: 'edit', item }); setError('') }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (modal.mode === 'create') {
        await adminFetch('/admin/categories', { method: 'POST', body: JSON.stringify(form) })
      } else {
        await adminFetch(`/admin/categories/${modal.item.id}`, { method: 'PUT', body: JSON.stringify(form) })
      }
      setModal(null)
      fetchItems()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(item) {
    if (!confirm(`Delete "${item.name}"?`)) return
    try {
      await adminFetch(`/admin/categories/${item.id}`, { method: 'DELETE' })
      fetchItems()
    } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Categories</h1>
          <p className="admin-page-subtitle">Manage product categories</p>
        </div>
        <button className="admin-btn admin-btn-primary" onClick={openCreate}>+ Add Category</button>
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Name</th><th>Slug</th><th>Products</th><th>Actions</th></tr>
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
                  <td><strong>{item.name}</strong></td>
                  <td><span className="admin-code">{item.slug}</span></td>
                  <td>{item.productCount ?? item._count?.products ?? '—'}</td>
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
        <Modal title={modal.mode === 'create' ? 'Add Category' : 'Edit Category'} onClose={() => setModal(null)}>
          {error && <div style={{ color: '#dc3545', marginBottom: '12px' }}>{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="admin-form-group">
              <label className="admin-label">Name</label>
              <input className="admin-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="admin-form-group">
              <label className="admin-label">Slug</label>
              <input className="admin-input" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="auto-generated if empty" />
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
