import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from './utils/api.js'
import { askConfirm, showMessage } from './dialog'

// Admin → Refunds: money to give back on the bot's orders (a payment after the 30 minutes, a
// short payment on an expired order, a surplus). Approving sends it from the deposit address
// to the customer's refund address; XMR is sent by hand, then marked as sent.

// "Sending" also shows a refund that left but could not be recorded (its transaction and error are on the row)
const TABS = [['pending', 'To approve'], ['manual', 'XMR to send'], ['sending', 'Sending'], ['refunded', 'Refunded'], ['rejected', 'Rejected']]
const post = (id, action, body) => adminFetch(`/admin/refunds/${id}/${action}`, { method: 'POST', body: JSON.stringify(body || {}) })

export default function AdminRefunds() {
  const [tab, setTab] = useState('pending')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try { setItems((await adminFetch(`/admin/refunds?status=${tab}`)).refunds || []) }
    catch (e) { showMessage(e.message) }
    finally { setLoading(false) }
  }, [tab])
  useEffect(() => { load() }, [load])

  const act = async (r, action, body, confirm) => {
    if (confirm && !(await askConfirm(confirm.text, { okLabel: confirm.ok, danger: confirm.danger }))) return
    setBusy(r.id)
    try {
      const res = await post(r.id, action, body)
      if (res.status === 'manual') showMessage(`Send ${r.amount} ${r.currency} to ${res.address} from your Monero wallet, then come back and mark it as sent.`)
      await load()
    } catch (e) { showMessage(e.message); await load() }
    finally { setBusy(0) }
  }

  const approve = r => act(r, 'approve', null, {
    text: `Send ${r.amount} ${r.currency} to ${r.address || '(no refund address)'}? The network fee is taken off the amount. This cannot be undone.`,
    ok: 'Approve and send',
  })
  const reject = r => act(r, 'reject', null, { text: `Reject this refund? ${r.amount} ${r.currency} goes back on ${r.user?.username}'s balance.`, ok: 'Reject', danger: true })
  const sent = r => {
    const txHash = window.prompt('Transaction id of the XMR refund (optional):') // eslint-disable-line no-alert
    if (txHash === null) return
    act(r, 'sent', { txHash })
  }

  return (
    <div>
      <h1 className="admin-page-title">Refunds</h1>
      <p style={{ color: '#777', fontSize: 13, marginTop: 0 }}>
        Bot orders: a payment after the 30 minutes, a short payment on an order that expired, or a surplus. The commission taken on the deposit is not refunded.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" className={`admin-btn ${tab === k ? 'admin-btn-primary' : 'admin-btn-secondary'}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div className="admin-card" style={{ overflowX: 'auto' }}>
        {loading ? <p>Loading…</p> : items.length === 0 ? <p style={{ color: '#777' }}>Nothing here.</p> : (
          <table className="admin-table">
            <thead><tr><th>#</th><th>Customer</th><th>Amount</th><th>Refund address</th><th>Reason</th><th>Date</th><th /></tr></thead>
            <tbody>
              {items.map(r => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.user?.username}{r.orderId ? ` · order #${r.orderId}` : ''}</td>
                  <td><b>{r.amount} {r.currency}</b></td>
                  <td style={{ wordBreak: 'break-all', maxWidth: 260 }}>{r.address || <i>none</i>}{r.txHash && <div style={{ color: '#777', fontSize: 12 }}>tx {r.txHash}</div>}</td>
                  <td>{r.reason}{r.error && <div style={{ color: '#b00020', fontSize: 12 }}>{r.error}</div>}</td>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.status === 'pending' && <>
                      <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" disabled={busy === r.id} onClick={() => approve(r)}>Approve</button>{' '}
                      <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" disabled={busy === r.id} onClick={() => reject(r)}>Reject</button>
                    </>}
                    {r.status === 'manual' && <>
                      <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" disabled={busy === r.id} onClick={() => sent(r)}>Mark as sent</button>{' '}
                      <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" disabled={busy === r.id} onClick={() => reject(r)}>Reject</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
