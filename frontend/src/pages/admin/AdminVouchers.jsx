import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from './utils/api.js'
import { askConfirm, showMessage } from './dialog'
import ShopTabs, { useShopFilter } from '../../components/admin/ShopTabs.jsx'

// Admin → Vouchers: codes customers type at the bots' checkout ("Applied Vouchers").
// A code takes a percentage or an amount off the products, never the shipping.

const EMPTY = { code: '', kind: 'percent', value: '', minOrder: '', maxUses: '', expiresAt: '', isActive: true, source: '' }
const off = v => v.kind === 'amount' ? `$${Number(v.value).toFixed(2)} off` : `${Number(v.value)}% off`

function status(v) {
  const grey = { background: '#e9ecef', color: '#6c757d' }
  if (!v.isActive) return ['Off', grey]
  if (v.expiresAt && new Date(v.expiresAt) <= new Date()) return ['Ended', grey]
  if (v.maxUses != null && v.uses >= v.maxUses) return ['Used up', grey]
  return ['Active', { background: '#d4edda', color: '#155724' }]
}

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

export default function AdminVouchers() {
  const [items, setItems] = useState([])
  const [catalogs, setCatalogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Each shop has its own codes: the website's and each bot catalog's
  const shopFilter = useShopFilter()
  const { shop, shopOf, target } = shopFilter
  const keyOf = v => v.source || 'site'
  const shown = shop === 'all' ? items : items.filter(v => keyOf(v) === shop)
  const counts = items.reduce((m, v) => ({ ...m, [keyOf(v)]: (m[keyOf(v)] || 0) + 1 }), {})
  const catalogName = s => shopOf(s)?.label || (s ? `${s.toUpperCase()} catalog` : 'Website')

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminFetch('/admin/vouchers')
      setItems(data.vouchers || [])
      setCatalogs(data.catalogs || [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchItems() }, [fetchItems])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  function openCreate() { setForm({ ...EMPTY, source: target === 'site' ? '' : target }); setModal({ mode: 'create' }); setError('') }
  function openEdit(v) {
    setForm({
      code: v.code, kind: v.kind, value: String(Number(v.value)), minOrder: Number(v.minOrder) ? String(Number(v.minOrder)) : '',
      maxUses: v.maxUses ?? '', expiresAt: v.expiresAt ? v.expiresAt.slice(0, 10) : '', isActive: v.isActive, source: v.source || '',
    })
    setModal({ mode: 'edit', item: v }); setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    // The end date is the last day the code works, up to its last minute
    const body = { ...form, expiresAt: form.expiresAt ? `${form.expiresAt}T23:59:59` : '' }
    try {
      if (modal.mode === 'create') await adminFetch('/admin/vouchers', { method: 'POST', body: JSON.stringify(body) })
      else await adminFetch(`/admin/vouchers/${modal.item.id}`, { method: 'PUT', body: JSON.stringify(body) })
      setModal(null)
      fetchItems()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(v) {
    if (!(await askConfirm(`Delete the voucher ${v.code}? Orders that used it keep their discount.`, { okLabel: 'Delete', danger: true }))) return
    try {
      await adminFetch(`/admin/vouchers/${v.id}`, { method: 'DELETE' })
      fetchItems()
    } catch (e) { showMessage(e.message) }
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Vouchers</h1>
          <p className="admin-page-subtitle">Codes customers type at the bot's checkout, under "Applied Vouchers"</p>
        </div>
        <button className="admin-btn admin-btn-primary" onClick={openCreate}>+ Add voucher</button>
      </div>

      <div className="admin-card" style={{ marginBottom: 12, padding: '12px 16px' }}>
        <ShopTabs filter={shopFilter} counts={counts} />
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Code</th><th>Discount</th><th>Shop</th><th>Used</th><th>Ends</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((_, j) => <td key={j}><span className="admin-skel" style={{ width: '70px', height: '16px' }} /></td>)}</tr>
                ))
              ) : shown.length === 0 ? (
                <tr><td colSpan={7} className="admin-table-empty">No vouchers yet.</td></tr>
              ) : shown.map(v => {
                const [label, look] = status(v)
                return (
                  <tr key={v.id}>
                    <td><span className="admin-code">{v.code}</span></td>
                    <td>{off(v)}{Number(v.minOrder) > 0 && <div style={{ color: '#777', fontSize: '0.8rem' }}>from ${Number(v.minOrder).toFixed(2)}</div>}</td>
                    <td>{catalogName(v.source)}</td>
                    <td>{v.uses}{v.maxUses != null ? ` / ${v.maxUses}` : ''}</td>
                    <td>{v.expiresAt ? new Date(v.expiresAt).toLocaleDateString() : 'Never'}</td>
                    <td><span className="admin-badge" style={look}>{label}</span></td>
                    <td>
                      <div className="admin-gap-actions">
                        <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => openEdit(v)}>Edit</button>
                        <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => handleDelete(v)}>Delete</button>
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
        <Modal title={modal.mode === 'create' ? 'Add voucher' : `Edit ${modal.item.code}`} onClose={() => setModal(null)}>
          {error && <div className="admin-alert admin-alert-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="admin-form-group">
              <label className="admin-label">Code</label>
              <input className="admin-input" value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="WELCOME10" required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
              <div className="admin-form-group">
                <label className="admin-label">Discount</label>
                <select className="admin-input" value={form.kind} onChange={e => set('kind', e.target.value)}>
                  <option value="percent">Percentage off</option>
                  <option value="amount">Amount off ($)</option>
                </select>
              </div>
              <div className="admin-form-group">
                <label className="admin-label">{form.kind === 'percent' ? 'Percent' : 'Dollars'}</label>
                <input className="admin-input" type="number" min="0" step="0.01" value={form.value} onChange={e => set('value', e.target.value)} required />
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Minimum of products ($)</label>
                <input className="admin-input" type="number" min="0" step="0.01" value={form.minOrder} onChange={e => set('minOrder', e.target.value)} placeholder="None" />
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Uses</label>
                <input className="admin-input" type="number" min="1" step="1" value={form.maxUses} onChange={e => set('maxUses', e.target.value)} placeholder="Unlimited" />
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Last day</label>
                <input className="admin-input" type="date" value={form.expiresAt} onChange={e => set('expiresAt', e.target.value)} />
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Shop</label>
                <select className="admin-input" value={form.source} onChange={e => set('source', e.target.value)}>
                  {catalogs.map(c => <option key={c} value={c}>{catalogName(c)}</option>)}
                  <option value="">{catalogName('')}</option>
                </select>
              </div>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} /> Customers can use it
            </label>
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
