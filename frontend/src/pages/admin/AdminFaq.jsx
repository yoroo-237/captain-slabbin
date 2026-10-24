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

export default function AdminFaq() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ question: '', answer: '', position: 0 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminFetch('/admin/faq')
      setItems(data.faq || data || [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchItems() }, [fetchItems])

  function openCreate() { setForm({ question: '', answer: '', position: items.length + 1 }); setModal({ mode: 'create' }); setError('') }
  function openEdit(item) { setForm({ question: item.question, answer: item.answer, position: item.position ?? 0 }); setModal({ mode: 'edit', item }); setError('') }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (modal.mode === 'create') {
        await adminFetch('/admin/faq', { method: 'POST', body: JSON.stringify(form) })
      } else {
        await adminFetch(`/admin/faq/${modal.item.id}`, { method: 'PUT', body: JSON.stringify(form) })
      }
      setModal(null)
      fetchItems()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(item) {
    if (!confirm(`Delete this FAQ item?`)) return
    try {
      await adminFetch(`/admin/faq/${item.id}`, { method: 'DELETE' })
      fetchItems()
    } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">FAQ</h1>
          <p className="admin-page-subtitle">Manage frequently asked questions</p>
        </div>
        <button className="admin-btn admin-btn-primary" onClick={openCreate}>+ Add FAQ</button>
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>#</th><th>Question</th><th>Answer</th><th>Actions</th></tr>
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
                  <td>{item.position ?? '—'}</td>
                  <td style={{ maxWidth: '240px' }}>{item.question}</td>
                  <td style={{ maxWidth: '300px', color: '#888', fontSize: '0.85rem' }}>{item.answer?.slice(0, 80)}{item.answer?.length > 80 ? '…' : ''}</td>
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
        <Modal title={modal.mode === 'create' ? 'Add FAQ' : 'Edit FAQ'} onClose={() => setModal(null)}>
          {error && <div style={{ color: '#dc3545', marginBottom: '12px' }}>{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="admin-form-group">
              <label className="admin-label">Order</label>
              <input className="admin-input" type="number" value={form.position} onChange={e => setForm(f => ({ ...f, position: parseInt(e.target.value, 10) || 0 }))} />
            </div>
            <div className="admin-form-group">
              <label className="admin-label">Question</label>
              <input className="admin-input" value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))} required />
            </div>
            <div className="admin-form-group">
              <label className="admin-label">Answer</label>
              <textarea className="admin-textarea" rows={5} value={form.answer} onChange={e => setForm(f => ({ ...f, answer: e.target.value }))} required />
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
