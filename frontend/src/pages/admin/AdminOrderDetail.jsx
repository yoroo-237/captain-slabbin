import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { adminFetch } from './utils/api.js'
import StatusBadge from '../../components/admin/StatusBadge.jsx'
import { decryptWith } from '../../utils/pgp.js'

// Must match VALID_STATUSES in backend/src/controllers/admin/orders.controller.js
const ORDER_STATUSES = ['processing', 'shipped', 'delivered', 'cancelled', 'refunded']

const money = v => `$${Number(v || 0).toFixed(2)}`

// A PGP-encrypted address, read here with the private key file and its passphrase.
// Everything happens in this browser: the key and the address are never sent.
function EncryptedAddress({ message }) {
  const [open, setOpen] = useState(false)
  const [keyText, setKeyText] = useState('')
  const [pass, setPass] = useState('')
  const [plain, setPlain] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true); setErr('')
    try { setPlain(await decryptWith(keyText, pass, message)) }
    catch (e) { setErr(/passphrase|decrypt/i.test(e.message) ? 'Wrong passphrase, or this address was encrypted to another key.' : e.message) }
    finally { setBusy(false) }
  }
  const readFile = file => file && file.text().then(setKeyText)

  if (plain) return <span>{plain}<br /><button type="button" className="admin-btn admin-btn-sm" style={{ marginTop: 6 }} onClick={() => { setPlain(''); setPass('') }}>Hide</button></span>
  return (
    <span style={{ display: 'grid', gap: 6 }}>
      <span>🔒 PGP encrypted address</span>
      {!open ? (
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => setOpen(true)}>Decrypt</button>
          <button type="button" className="admin-btn admin-btn-sm" onClick={() => navigator.clipboard?.writeText(message)}>Copy the message</button>
        </span>
      ) : (
        <span style={{ display: 'grid', gap: 6, maxWidth: 420 }}>
          <span className="admin-text-muted">Your private key file (…-pgp-private-key.asc) and its passphrase. Read in this browser only.</span>
          <input type="file" accept=".asc,.txt,.key,.gpg" onChange={e => readFile(e.target.files?.[0])} />
          {keyText && <span className="admin-text-muted">Key loaded.</span>}
          <input className="admin-input" type="password" autoComplete="off" placeholder="Passphrase" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && keyText && run()} />
          {err && <span className="admin-alert admin-alert-error" style={{ margin: 0 }}>{err}</span>}
          <span style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" disabled={!keyText || busy} onClick={run}>{busy ? 'Decrypting…' : 'Decrypt'}</button>
            <button type="button" className="admin-btn admin-btn-sm" onClick={() => { setOpen(false); setKeyText(''); setPass(''); setErr('') }}>Cancel</button>
          </span>
        </span>
      )}
    </span>
  )
}

export default function AdminOrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [status, setStatus] = useState('')
  const [tracking, setTracking] = useState({ trackingNumber: '', carrier: '' })
  const [saving, setSaving] = useState('')      // 'status' | 'tracking'
  const [actionMsg, setActionMsg] = useState(null)

  const applyOrder = useCallback(o => {
    setOrder(o)
    setStatus(o.status)
    setTracking({ trackingNumber: o.trackingNumber || '', carrier: o.carrier || '' })
  }, [])

  useEffect(() => {
    let stale = false
    setLoading(true)
    setOrder(null)
    setError('')
    adminFetch(`/admin/orders/${id}`)
      .then(d => { if (!stale) applyOrder(d) })
      .catch(e => { if (!stale) setError(e.message) })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [id, applyOrder])

  async function save(kind) {
    setSaving(kind)
    setActionMsg(null)
    try {
      const updated = kind === 'status'
        ? await adminFetch(`/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
        : await adminFetch(`/admin/orders/${id}/tracking`, { method: 'PATCH', body: JSON.stringify(tracking) })
      applyOrder({ ...order, ...updated })
      setActionMsg({ type: 'success', text: kind === 'status' ? 'Status updated.' : 'Tracking saved — order marked as shipped.' })
    } catch (e) {
      setActionMsg({ type: 'error', text: e.message })
    } finally {
      setSaving('')
    }
  }

  function formatDate(str) {
    if (!str) return '—'
    return new Date(str).toLocaleString()
  }

  if (loading) return <div style={{ padding: '40px', color: '#888' }}>Loading…</div>
  if (error) return <div className="admin-alert admin-alert-error">{error}</div>
  if (!order) return null

  const items = order.items || []
  const subtotal = items.reduce((s, i) => s + Number(i.price) * i.quantity, 0)

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => navigate('/admin/orders')} style={{ marginBottom: '8px' }}>
            ← Back to Orders
          </button>
          <h1 className="admin-page-title">Order #{order.orderNumber || order.id}</h1>
          <p className="admin-page-subtitle">{formatDate(order.placedAt)}</p>
        </div>
        <StatusBadge type="status" value={order.status} />
      </div>

      {actionMsg && (
        <div className={'admin-alert ' + (actionMsg.type === 'error' ? 'admin-alert-error' : 'admin-alert-success')}>
          <span>{actionMsg.text}</span>
          <button className="admin-alert-close" onClick={() => setActionMsg(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="admin-grid-2">
        <div className="admin-card">
          <h2 className="admin-card-title">Order Info</h2>
          <div className="admin-info-list">
            <div className="admin-info-row">
              <span className="admin-info-label">Customer</span>
              <span className="admin-info-value">
                {order.user ? <Link to={`/admin/users/${order.user.id}`}>{order.user.username}</Link> : '—'}
                {order.user?.telegramHandle && <span className="admin-text-muted"> · TG {order.user.telegramHandle}</span>}
              </span>
            </div>
            <div className="admin-info-row"><span className="admin-info-label">Payment</span><span className="admin-info-value">{order.paymentMethod || '—'} (wallet balance)</span></div>
            <div className="admin-info-row"><span className="admin-info-label">Delivery</span><span className="admin-info-value" style={{ whiteSpace: 'pre-wrap' }}>{
              /^-----BEGIN PGP MESSAGE/.test(order.shippingAddress || '') ? <EncryptedAddress message={order.shippingAddress} />
                : order.shippingAddress ? `${order.name}\n${order.shippingAddress}` : 'None — arrange on Telegram'}</span></div>
            <div className="admin-info-row"><span className="admin-info-label">Tracking</span><span className="admin-info-value">{order.trackingNumber ? `${order.trackingNumber}${order.carrier ? ` (${order.carrier})` : ''}` : '—'}</span></div>
            {order.note && <div className="admin-info-row"><span className="admin-info-label">Note</span><span className="admin-info-value">{order.note}</span></div>}
          </div>
        </div>

        <div className="admin-card">
          <h2 className="admin-card-title">Fulfilment</h2>
          <div className="admin-form-group">
            <label className="admin-label">Status</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select className="admin-select" value={status} onChange={e => setStatus(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
                {ORDER_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
              <button className="admin-btn admin-btn-primary" onClick={() => save('status')} disabled={!!saving || status === order.status}>
                {saving === 'status' ? 'Saving…' : 'Update'}
              </button>
            </div>
            {status === 'refunded' && status !== order.status && (
              <p className="admin-text-muted" style={{ margin: '6px 0 0' }}>
                This only changes the status — credit the customer's balance from their user page if the order is refunded.
              </p>
            )}
          </div>
          <hr className="admin-divider" />
          <form onSubmit={e => { e.preventDefault(); save('tracking') }}>
            <div className="admin-form-group">
              <label className="admin-label">Tracking Number</label>
              <input className="admin-input" required value={tracking.trackingNumber} onChange={e => setTracking(t => ({ ...t, trackingNumber: e.target.value }))} />
            </div>
            <div className="admin-form-group">
              <label className="admin-label">Carrier (optional)</label>
              <input className="admin-input" value={tracking.carrier} placeholder="USPS, UPS…" onChange={e => setTracking(t => ({ ...t, carrier: e.target.value }))} />
            </div>
            <button type="submit" className="admin-btn admin-btn-secondary" disabled={!!saving}>
              {saving === 'tracking' ? 'Saving…' : 'Save Tracking & Mark Shipped'}
            </button>
          </form>
        </div>
      </div>

      <div className="admin-card">
        <h2 className="admin-card-title">Items</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Subtotal</th></tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={4} className="admin-table-empty">No items.</td></tr>
              ) : items.map(item => (
                <tr key={item.id}>
                  <td>{item.name || '—'}</td>
                  <td>{item.quantity}</td>
                  <td>{money(item.price)}</td>
                  <td>{money(Number(item.price) * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-info-list" style={{ maxWidth: '320px', marginLeft: 'auto', marginTop: '12px' }}>
          <div className="admin-info-row"><span className="admin-info-label">Subtotal</span><span className="admin-info-value">{money(subtotal)}</span></div>
          <div className="admin-info-row"><span className="admin-info-label">Shipping</span><span className="admin-info-value">{Number(order.shippingFee) > 0 ? money(order.shippingFee) : 'Free'}</span></div>
          <div className="admin-info-row"><span className="admin-info-label">Total</span><span className="admin-info-value" style={{ fontWeight: 800 }}>{money(order.totalAmount)}</span></div>
        </div>
      </div>
    </div>
  )
}
