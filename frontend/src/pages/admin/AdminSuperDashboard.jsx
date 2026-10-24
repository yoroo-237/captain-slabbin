import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from './utils/api.js'
import { COMMISSION_ADDR_KEY, PendingTiles, SweepResult, SweepLogTable } from '../../components/admin/SweepParts.jsx'

const CURRENCIES = [
  { id: 'BTC',  color: '#f7931a' },
  { id: 'LTC',  color: '#345d9d' },
  { id: 'DOGE', color: '#c2a633' },
  { id: 'ETH',  color: '#627eea' },
]

export default function AdminSuperDashboard() {
  const [form, setForm] = useState(null)          // editable commission settings
  const [commission, setCommission] = useState(null) // saved commission settings
  const [pending, setPending] = useState([])
  const [collected, setCollected] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [error, setError] = useState('')

  const [logs, setLogs] = useState([])
  const [logsLoading, setLogsLoading] = useState(true)

  const [sweepConfirm, setSweepConfirm] = useState(null)
  const [sweeping, setSweeping] = useState(null)
  const [sweepResult, setSweepResult] = useState(null)

  const loadLogs = useCallback(() => {
    adminFetch('/admin/superadmin/sweep-logs')
      .then(d => setLogs(d.logs || []))
      .catch(() => setLogs([]))
      .finally(() => setLogsLoading(false))
    adminFetch('/admin/superadmin/pending')
      .then(d => { setPending(d.pending || []); setCollected(d.collected || []) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    adminFetch('/admin/superadmin/settings')
      .then(c => { setCommission(c); setForm(c) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
    loadLogs()
  }, [loadLogs])

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setSavedMsg('') }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSavedMsg('')
    try {
      const updated = await adminFetch('/admin/superadmin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          commissionPct:         form.commissionPct,
          btcCommissionAddress:  form.btcCommissionAddress,
          ltcCommissionAddress:  form.ltcCommissionAddress,
          dogeCommissionAddress: form.dogeCommissionAddress,
          ethCommissionAddress:  form.ethCommissionAddress,
        }),
      })
      setCommission(updated)
      setForm(updated)
      setSavedMsg('Commission settings saved.')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function doSweep(currency) {
    setSweepConfirm(null)
    setSweeping(currency)
    setSweepResult(null)
    try {
      const url = currency === 'ETH' ? '/admin/superadmin/eth/sweep' : `/admin/superadmin/utxo/sweep/${currency}`
      setSweepResult(await adminFetch(url, { method: 'POST' }))
      loadLogs()
    } catch (e) {
      setSweepResult({ currency, error: e.message })
    } finally {
      setSweeping(null)
    }
  }

  if (loading) return <div style={{ padding: '40px', color: '#888' }}>Loading…</div>
  if (!form) return <div className="admin-alert admin-alert-error">{error || 'Could not load reserve fund settings.'}</div>

  const dirty = JSON.stringify(form) !== JSON.stringify(commission)

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Super Admin — Deposit Commission</h1>
          <p className="admin-page-subtitle">Visible only to super admin accounts</p>
        </div>
      </div>

      {error && <div className="admin-alert admin-alert-error">{error}</div>}

      <div className="admin-card" style={{ maxWidth: '720px' }}>
        <h2 className="admin-card-title">Commission Settings</h2>
        <p style={{ fontSize: '0.85rem', color: '#666', lineHeight: 1.6, marginTop: 0 }}>
          This percentage is deducted from every customer deposit when it is credited — the customer is credited the
          rest and sees the rate before depositing. The commission is swept to the reserve addresses below, separately
          from the admin sweep. A new rate applies to deposits confirmed after saving.
        </p>
        <form onSubmit={save}>
          <div className="admin-form-group">
            <label className="admin-label">Commission % per deposit</label>
            <input
              className="admin-input" type="number" min="0" max="99" step="0.1" required
              value={form.commissionPct}
              onChange={e => set('commissionPct', e.target.value)}
              style={{ maxWidth: '140px' }}
            />
          </div>
          {CURRENCIES.map(({ id }) => (
            <div className="admin-form-group" key={id}>
              <label className="admin-label">{id} Reserve Address</label>
              <input
                className="admin-input" type="text"
                value={form[COMMISSION_ADDR_KEY[id]] || ''}
                onChange={e => set(COMMISSION_ADDR_KEY[id], e.target.value.trim())}
                placeholder={`${id} address`}
                style={{ fontFamily: 'monospace' }}
                autoComplete="off"
              />
            </div>
          ))}
          <div className="admin-flex" style={{ flexWrap: 'wrap' }}>
            <button type="submit" className="admin-btn admin-btn-primary" disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {savedMsg && <span style={{ color: '#198754', fontSize: '0.85rem', fontWeight: 600 }}>✓ {savedMsg}</span>}
            {dirty && !saving && <span className="admin-text-muted">Unsaved changes — sweeps use the saved values.</span>}
          </div>
        </form>
      </div>

      <div className="admin-card" style={{ maxWidth: '720px' }}>
        <h2 className="admin-card-title">Commission to Sweep</h2>
        <p style={{ fontSize: '0.85rem', color: '#666', lineHeight: 1.6, marginTop: 0 }}>
          Each sweep sends only the commission (minus the network fee) and leaves the customer share for the admin.
          XMR is collected from the Monero wallet by hand.
        </p>
        <PendingTiles
          pending={pending}
          currencies={[...CURRENCIES, { id: 'XMR', color: '#ff6600' }]}
          note={id => { const c = collected.find(x => x.currency === id); return c ? ` · ${c.amount} all-time` : '' }}
        />
        <SweepResult result={sweepResult} onClose={() => setSweepResult(null)} />
        {CURRENCIES.map(({ id, color }) => {
          const reserveAddr = commission[COMMISSION_ADDR_KEY[id]]
          const blocker = !reserveAddr ? 'reserve address not saved' : null
          return (
            <div key={id} className="admin-sweep-row">
              <span className="admin-badge" style={{ background: color + '22', color, border: `1px solid ${color}66` }}>{id}</span>
              {sweepConfirm === id ? (
                <>
                  <span style={{ fontSize: '0.82rem', color: '#b45309', fontWeight: 600, flex: 1, minWidth: 0 }}>
                    Sweep {id} commission → <span className="admin-code">{reserveAddr}</span> ?
                  </span>
                  <div className="admin-gap-actions">
                    <button type="button" className="admin-btn admin-btn-success admin-btn-sm" onClick={() => doSweep(id)}>Yes, sweep</button>
                    <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => setSweepConfirm(null)}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <span className="admin-text-muted" style={{ flex: 1, minWidth: 0 }}>
                    {blocker ? `Disabled — ${blocker}` : <>→ <span className="admin-code">{reserveAddr}</span></>}
                  </span>
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary admin-btn-sm"
                    disabled={!!blocker || !!sweeping}
                    onClick={() => setSweepConfirm(id)}
                  >
                    {sweeping === id ? 'Sweeping…' : `Sweep ${id}`}
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="admin-card">
        <h2 className="admin-card-title">Reserve Fund History</h2>
        <SweepLogTable logs={logs} loading={logsLoading} side="reserve" />
      </div>
    </div>
  )
}
