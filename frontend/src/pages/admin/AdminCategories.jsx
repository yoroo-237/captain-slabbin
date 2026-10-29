import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from './utils/api.js'
import { askConfirm, showMessage } from './dialog'
import ShopTabs, { useShopFilter } from '../../components/admin/ShopTabs.jsx'

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
  // Each shop has its own shelves: the website's and each bot catalog's
  const shopFilter = useShopFilter()
  const { shop, shopOf, target } = shopFilter
  const keyOf = c => c.source || 'site'
  const shown = shop === 'all' ? items : items.filter(c => keyOf(c) === shop)
  const counts = items.reduce((m, c) => ({ ...m, [keyOf(c)]: (m[keyOf(c)] || 0) + 1 }), {})

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
        await adminFetch('/admin/categories', { method: 'POST', body: JSON.stringify({ ...form, source: target }) })
      } else {
        await adminFetch(`/admin/categories/${modal.item.id}`, { method: 'PUT', body: JSON.stringify(form) })
      }
      setModal(null)
      fetchItems()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(item) {
    if (!(await askConfirm(`Delete "${item.name}"?`, { okLabel: 'Delete', danger: true }))) return
    try {
      await adminFetch(`/admin/categories/${item.id}`, { method: 'DELETE' })
      fetchItems()
    } catch (e) { showMessage(e.message) }
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

      <div className="admin-card" style={{ marginBottom: 12, padding: '12px 16px' }}>
        <ShopTabs filter={shopFilter} counts={counts} />
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Name</th>{shop === 'all' && <th>Shop</th>}<th>Slug</th><th>Products</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 4 }).map((_, j) => <td key={j}><span className="admin-skel" style={{ width: '80px', height: '16px' }} /></td>)}</tr>
                ))
              ) : shown.length === 0 ? (
                <tr><td colSpan={5} className="admin-table-empty">No data found.</td></tr>
              ) : shown.map(item => (
                <tr key={item.id}>
                  <td><strong>{item.name}</strong></td>
                  {shop === 'all' && <td style={{ color: '#555' }}>{shopOf(item.source)?.label || item.source || 'Website'}</td>}
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
            <p className="admin-text-muted" style={{ marginTop: 0, fontSize: 13 }}>Shop: <b>{modal.mode === 'create' ? (shopOf(target)?.label || 'Website') : (shopOf(modal.item.source)?.label || 'Website')}</b></p>
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
