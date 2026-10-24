import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from './utils/api.js'

const STATUSES = ['draft', 'active', 'ended']
const STATUS_STYLE = {
  draft:  { bg: '#e9ecef', color: '#6c757d' },
  active: { bg: '#d4edda', color: '#155724' },
  ended:  { bg: '#f8d7da', color: '#721c24' },
}
const EMPTY_FORM = { title: '', description: '', prize: '', status: 'draft', endsAt: '' }

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

export default function AdminGiveaways() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminFetch('/admin/giveaways')
      setItems(Array.isArray(data) ? data : [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchItems() }, [fetchItems])

  function openCreate() {
    setForm(EMPTY_FORM)
    setModal({ mode: 'create' })
    setError('')
  }
  function openEdit(item) {
    setForm({
      title:       item.title,
      description: item.description || '',
      prize:       item.prize || '',
      status:      item.status || 'draft',
      endsAt:      item.endsAt ? item.endsAt.slice(0, 10) : '',
    })
    setModal({ mode: 'edit', item })
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      // End of the chosen day, so a giveaway ending "today" is still open today
      const payload = { ...form, endsAt: form.endsAt ? new Date(`${form.endsAt}T23:59:59`).toISOString() : null }
      if (modal.mode === 'create') {
        await adminFetch('/admin/giveaways', { method: 'POST', body: JSON.stringify(payload) })
      } else {
        await adminFetch(`/admin/giveaways/${modal.item.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      }
      setModal(null)
      fetchItems()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(item) {
    if (!confirm(`Delete "${item.title}"?`)) return
    try {
      await adminFetch(`/admin/giveaways/${item.id}`, { method: 'DELETE' })
      fetchItems()
    } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Giveaways</h1>
          <p className="admin-page-subtitle">Only “active” giveaways are shown to customers</p>
        </div>
        <button className="admin-btn admin-btn-primary" onClick={openCreate}>+ Add Giveaway</button>
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Title</th><th>Prize</th><th>Status</th><th>Ends</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 5 }).map((_, j) => <td key={j}><span className="admin-skel" style={{ width: '80px', height: '16px' }} /></td>)}</tr>
                ))
              ) : items.length === 0 ? (
                <tr><td colSpan={5} className="admin-table-empty">No data found.</td></tr>
              ) : items.map(item => {
                const st = STATUS_STYLE[item.status] || STATUS_STYLE.draft
                return (
                  <tr key={item.id}>
                    <td><strong>{item.title}</strong></td>
                    <td>{item.prize || '—'}</td>
                    <td><span className="admin-badge" style={{ background: st.bg, color: st.color }}>{item.status}</span></td>
                    <td>{formatDate(item.endsAt)}</td>
                    <td>
                      <div className="admin-gap-actions">
                        <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => openEdit(item)}>Edit</button>
                        <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => handleDelete(item)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal title={modal.mode === 'create' ? 'Add Giveaway' : 'Edit Giveaway'} onClose={() => setModal(null)}>
          {error && <div className="admin-alert admin-alert-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="admin-form-group">
              <label className="admin-label">Title *</label>
              <input className="admin-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required />
            </div>
            <div className="admin-form-group">
              <label className="admin-label">Prize *</label>
              <input className="admin-input" value={form.prize} onChange={e => setForm(f => ({ ...f, prize: e.target.value }))} placeholder="e.g. $100 wallet credit" required />
            </div>
            <div className="admin-form-group">
              <label className="admin-label">Description *</label>
              <textarea className="admin-textarea" rows={4} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required />
            </div>
            <div className="admin-grid-2">
              <div className="admin-form-group">
                <label className="admin-label">Status</label>
                <select className="admin-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
              <div className="admin-form-group">
                <label className="admin-label">End Date</label>
                <input className="admin-input" type="date" value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} />
              </div>
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
