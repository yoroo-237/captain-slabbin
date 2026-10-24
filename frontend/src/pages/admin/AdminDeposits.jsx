import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from './utils/api.js'
import StatusBadge from '../../components/admin/StatusBadge.jsx'
import Pagination from '../../components/admin/Pagination.jsx'

const CURRENCY_COLORS = {
  BTC: '#f7931a', LTC: '#345d9d', DOGE: '#c2a633', ETH: '#627eea', XMR: '#ff6600',
}
const UTXO = ['BTC', 'LTC', 'DOGE']
const LIMIT = 20

const fmtUsd = n => (n == null ? '—' : `$${Number(n).toFixed(2)}`)
const fmtC   = n => (n == null ? '—' : (Number(n).toFixed(8).replace(/\.?0+$/, '') || '0'))
const isOpen = d => d.status === 'awaiting' || d.status === 'partial'
const hasAddress = d => d.address && d.address !== 'pending'

function truncateAddr(addr) {
  if (!addr || addr === 'pending') return '—'
  if (addr.length <= 16) return addr
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard API unavailable (non-HTTPS or denied): fall back to a hidden textarea
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } finally { document.body.removeChild(ta) }
  }
}

function CurrencyBadge({ value }) {
  const color = CURRENCY_COLORS[value] || '#888'
  return (
    <span className="admin-badge" style={{ background: color + '22', color, border: `1px solid ${color}66` }}>
      {value}
    </span>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="admin-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal">
        <button className="admin-modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2 className="admin-modal-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function ErrorBox({ children }) {
  return children ? <div className="admin-alert admin-alert-error">{children}</div> : null
}

function InfoRows({ rows }) {
  return (
    <div className="admin-info-list" style={{ marginBottom: '14px' }}>
      {rows.filter(Boolean).map(([label, value, color]) => (
        <div key={label} className="admin-info-row">
          <span className="admin-info-label">{label}</span>
          <span className="admin-info-value" style={color ? { color, fontWeight: 600 } : undefined}>{value}</span>
        </div>
      ))}
    </div>
  )
}

function DepositHeading({ deposit }) {
  return (
    <div className="admin-flex" style={{ marginBottom: '14px', flexWrap: 'wrap' }}>
      <CurrencyBadge value={deposit.currency} />
      <span className="admin-code">#{deposit.id}</span>
      <span style={{ fontSize: '0.85rem', color: '#666' }}>{deposit.user?.username || '—'}</span>
    </div>
  )
}

// ── Confirm (manual credit) ───────────────────────────────────────────────────
function ConfirmModal({ deposit, onClose, onConfirmed }) {
  const [form, setForm] = useState({ amount: '', note: '', xmrChecks: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm(e) {
    e.preventDefault()
    if (deposit.currency === 'XMR' && !form.xmrChecks) {
      setError('Please confirm the XMR checklist first.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await adminFetch(`/admin/deposits/${deposit.id}/confirm`, {
        method: 'PATCH',
        body: JSON.stringify({ amount: parseFloat(form.amount), note: form.note }),
      })
      onConfirmed()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="Confirm Deposit" onClose={onClose}>
      <DepositHeading deposit={deposit} />
      {deposit.currency === 'XMR' ? (
        <div className="admin-alert admin-alert-warning" style={{ display: 'block' }}>
          <strong>XMR manual checklist</strong>
          <ol style={{ margin: '6px 0 8px', paddingLeft: '18px', lineHeight: 1.6 }}>
            <li>Open your Monero wallet and find the transaction from this customer (ask for the TX hash in a ticket).</li>
            <li>Note the exact XMR amount received.</li>
            <li>Enter it below — the customer's balance is credited in XMR (net of the deposit fee).</li>
          </ol>
          <label style={{ display: 'flex', gap: '8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.xmrChecks} onChange={e => setForm(f => ({ ...f, xmrChecks: e.target.checked }))} />
            I have verified the XMR transaction and the received amount.
          </label>
        </div>
      ) : (
        <p style={{ fontSize: '0.85rem', color: '#666', marginTop: 0 }}>
          {deposit.currency} deposits are normally credited automatically. Use this only if the payment arrived but was not credited
          (check “$ Value” and “Wallet” first).
        </p>
      )}

      <ErrorBox>{error}</ErrorBox>

      <form onSubmit={handleConfirm}>
        <div className="admin-form-group">
          <label className="admin-label">{deposit.currency} amount received *</label>
          <input className="admin-input" type="number" min="0.00000001" step="0.00000001" required autoFocus value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
        </div>
        <div className="admin-form-group">
          <label className="admin-label">Note (optional)</label>
          <input className="admin-input" value={form.note} placeholder="Internal note…" onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
        </div>
        <div className="admin-modal-actions">
          <button type="button" className="admin-btn admin-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="admin-btn admin-btn-success" disabled={loading}>
            {loading ? 'Confirming…' : 'Confirm & Credit'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Generic yes/no action (expire, cleanup, purge) ────────────────────────────
function ActionModal({ title, children, confirmLabel, busyLabel, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    setLoading(true)
    setError('')
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ fontSize: '0.875rem', color: '#555', lineHeight: 1.6, marginBottom: '16px' }}>{children}</div>
      <ErrorBox>{error}</ErrorBox>
      <div className="admin-modal-actions">
        <button className="admin-btn admin-btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
        <button className="admin-btn admin-btn-danger" onClick={run} disabled={loading}>
          {loading ? busyLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

// ── Read-only inspections: USD value / on-chain wallet / HD key ──────────────
function InspectModal({ title, inspect, onClose, children }) {
  return (
    <Modal title={title} onClose={onClose}>
      <DepositHeading deposit={inspect.deposit} />
      {inspect.loading && <div style={{ color: '#888', fontSize: '0.875rem', padding: '12px 0' }}>Loading…</div>}
      <ErrorBox>{inspect.error}</ErrorBox>
      {inspect.data && children(inspect.data)}
      <div className="admin-modal-actions">
        <button className="admin-btn admin-btn-secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}

function UsdValueBody({ v }) {
  return (
    <>
      <InfoRows rows={[
        ['Current price', v.price ? `${fmtUsd(v.price)} / ${v.currency}` : 'unavailable'],
        v.expectedAmount != null && ['Expected', `${fmtC(v.expectedAmount)} ${v.currency} ≈ ${fmtUsd(v.expectedUsd)}`],
        ['Received (recorded)', `${fmtC(v.receivedAmount)} ${v.currency} ≈ ${fmtUsd(v.receivedUsd)}`, v.receivedAmount > 0 ? '#198754' : undefined],
        ['Credited to customer', v.usdCredited > 0 ? fmtUsd(v.usdCredited) : 'not credited yet', v.usdCredited > 0 ? '#198754' : '#888'],
        ['Status', <StatusBadge key="s" type="deposit" value={v.status} />],
      ]} />
      <p className="admin-text-muted" style={{ lineHeight: 1.6 }}>
        USD values use today's price ({v.priceSource || 'no price source available'}). The credited amount used the price at
        confirmation time, so the two can differ.
        {v.currency === 'XMR' && ' XMR amounts are only known after manual verification in your Monero wallet.'}
      </p>
    </>
  )
}

function WalletBody({ w }) {
  return (
    <>
      <div className="admin-code" style={{ display: 'block', padding: '8px 10px', marginBottom: '12px', wordBreak: 'break-all' }}>{w.address}</div>
      <InfoRows rows={[
        ['Balance now', `${fmtC(w.total)} ${w.currency} ≈ ${fmtUsd(w.totalUsd)}`, w.total > 0 ? '#198754' : '#888'],
        w.unconfirmed ? ['Unconfirmed', `${fmtC(w.unconfirmed)} ${w.currency}`, '#b45309'] : null,
        w.totalReceived != null && ['Total ever received', `${fmtC(w.totalReceived)} ${w.currency} ≈ ${fmtUsd(w.totalReceivedUsd)}`],
        w.totalSent != null && ['Total sent out (swept)', `${fmtC(w.totalSent)} ${w.currency}`],
        ['Transactions', w.txCount],
        ['Recorded as received', `${fmtC(w.recordedReceived)} ${w.currency}`],
        ['Credited to customer', w.usdCredited > 0 ? fmtUsd(w.usdCredited) : 'not credited yet'],
      ]} />
      <p className="admin-text-muted" style={{ lineHeight: 1.6 }}>
        Live data from {w.source}. A balance of 0 after a deposit usually means the funds were already swept — compare with
        “Total ever received”.
      </p>
    </>
  )
}

function VerifyBody({ v }) {
  return (
    <>
      <div className={'admin-alert ' + (v.match ? 'admin-alert-success' : 'admin-alert-error')} style={{ display: 'block' }}>
        <strong>{v.match ? '✓ Match' : '✗ Mismatch'}</strong> —{' '}
        {v.match
          ? 'the stored address was derived from the current HD seed. Sweeps can sign for this deposit.'
          : 'the current HD seed derives a different address. Sweeps cannot sign for this deposit until the original seed is restored.'}
      </div>
      {[['Stored address', v.storedAddress], ['Derived address', v.derivedAddress]].map(([label, value]) => (
        <div key={label} style={{ marginBottom: '10px' }}>
          <div className="admin-info-label" style={{ marginBottom: '4px' }}>{label}</div>
          <div className="admin-code" style={{ display: 'block', padding: '6px 10px', wordBreak: 'break-all' }}>{value}</div>
        </div>
      ))}
      {!v.match && (
        <p className="admin-text-muted" style={{ lineHeight: 1.6 }}>
          Recovery: restore the seed that was active when deposit #{v.depositId} was created in Settings → Crypto, run the sweep,
          then put the current seed back.
        </p>
      )}
    </>
  )
}

function AddressModal({ deposit, onClose }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await copyText(deposit.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Modal title="Deposit Address" onClose={onClose}>
      <DepositHeading deposit={deposit} />
      <div className="admin-code" style={{ display: 'block', padding: '12px 14px', fontSize: '0.85rem', lineHeight: 1.6, wordBreak: 'break-all' }}>
        {deposit.address}
      </div>
      <div className="admin-modal-actions">
        <button className="admin-btn admin-btn-secondary" onClick={onClose}>Close</button>
        <button className="admin-btn admin-btn-primary" onClick={copy}>{copied ? '✓ Copied!' : 'Copy Address'}</button>
      </div>
    </Modal>
  )
}

export default function AdminDeposits() {
  const [deposits, setDeposits] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [status, setStatus] = useState('')
  const [currency, setCurrency] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState(null) // { type, text }

  const [confirmDeposit, setConfirmDeposit] = useState(null)
  const [action, setAction] = useState(null)       // 'expire' | 'cleanup' | 'purge'
  const [actionTarget, setActionTarget] = useState(null)
  const [addrDeposit, setAddrDeposit] = useState(null)
  const [inspect, setInspect] = useState(null)     // { kind, deposit, loading, data, error }
  const [hookLoading, setHookLoading] = useState({})

  const fetchDeposits = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const params = new URLSearchParams({ page, limit: LIMIT })
      if (status) params.set('status', status)
      if (currency) params.set('currency', currency)
      const data = await adminFetch(`/admin/deposits?${params}`)
      setDeposits(data.deposits || [])
      setTotal(data.pagination?.total ?? 0)
      setTotalPages(data.pagination?.totalPages || 1)
    } catch (e) {
      setDeposits([])
      setLoadError(e.message)
    } finally {
      setLoading(false)
    }
  }, [page, status, currency])

  useEffect(() => { fetchDeposits() }, [fetchDeposits])

  function flash(text, type = 'success') {
    setNotice({ text, type })
  }

  async function openInspect(deposit, kind) {
    const path = { usd: 'usd-value', chain: 'onchain', verify: 'verify-address' }[kind]
    setInspect({ kind, deposit, loading: true, data: null, error: '' })
    try {
      const data = await adminFetch(`/admin/deposits/${deposit.id}/${path}`)
      setInspect({ kind, deposit, loading: false, data, error: '' })
    } catch (e) {
      setInspect({ kind, deposit, loading: false, data: null, error: e.message })
    }
  }

  async function reregisterHook(deposit) {
    setHookLoading(v => ({ ...v, [deposit.id]: true }))
    try {
      const data = await adminFetch(`/admin/deposits/${deposit.id}/reregister-webhook`, { method: 'POST' })
      flash(data.message || 'Webhook registered', data.hookId ? 'success' : 'error')
      fetchDeposits()
    } catch (e) {
      flash(e.message, 'error')
    } finally {
      setHookLoading(v => ({ ...v, [deposit.id]: false }))
    }
  }

  const actions = {
    expire: {
      title: 'Expire Deposit',
      confirmLabel: 'Expire', busyLabel: 'Expiring…',
      body: d => <>Deposit <strong>#{d.id}</strong> ({d.currency}, {d.user?.username || '—'}) will be marked as expired and nothing will be credited. Funds sent to it afterwards will not be detected automatically.</>,
      run: async d => { await adminFetch(`/admin/deposits/${d.id}/expire`, { method: 'PATCH' }); flash(`Deposit #${d.id} expired.`) },
    },
    cleanup: {
      title: 'Cleanup Expired Deposits',
      confirmLabel: 'Run Cleanup', busyLabel: 'Cleaning up…',
      body: () => <>All awaiting / partial deposits past their expiry time will be marked <strong>expired</strong> and their BlockCypher webhooks deleted.</>,
      run: async () => { const d = await adminFetch('/admin/deposits/cleanup', { method: 'POST' }); flash(`${d.cleaned ?? 0} expired deposit(s) cleaned up.`) },
    },
    purge: {
      title: 'Purge All BlockCypher Webhooks',
      confirmLabel: 'Purge All', busyLabel: 'Purging…',
      body: () => <>Deletes <strong>every</strong> webhook and legacy forward registered on your BlockCypher token (BTC, LTC, DOGE) — including ones not in the database. Use it to free a full quota (persistent 429 errors). Open deposits will then rely on the customer's on-chain check until “Register Hook” is used again.</>,
      run: async () => { const d = await adminFetch('/admin/deposits/purge-blockcypher', { method: 'POST' }); flash(d.message || 'Purge completed.') },
    },
  }

  function openAction(kind, deposit = null) {
    setActionTarget(deposit)
    setAction(kind)
  }

  const from = total === 0 ? 0 : (page - 1) * LIMIT + 1
  const to   = Math.min(page * LIMIT, total)

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Deposits</h1>
          <p className="admin-page-subtitle">{loading ? 'Loading…' : `${total} deposit${total !== 1 ? 's' : ''}${total ? ` · showing ${from}–${to}` : ''}`}</p>
        </div>
      </div>

      <div className="admin-grid-2" style={{ marginBottom: '20px' }}>
        <div className="admin-alert admin-alert-success" style={{ display: 'block', margin: 0 }}>
          <strong>Auto-confirmed — BTC · LTC · DOGE · ETH</strong>
          <div style={{ marginTop: '4px', lineHeight: 1.6 }}>
            A unique address is derived per deposit. After 1 on-chain confirmation the webhook (or the customer's own check
            on the Wallet page) credits the balance at the live price. <strong>No action needed.</strong>
          </div>
        </div>
        <div className="admin-alert admin-alert-warning" style={{ display: 'block', margin: 0 }}>
          <strong>Manual review — XMR</strong>
          <div style={{ marginTop: '4px', lineHeight: 1.6 }}>
            All XMR deposits share one address. The customer opens a support ticket with the TX hash; verify it in your Monero
            wallet, then click <strong>Confirm</strong> and enter the USD amount to credit.
          </div>
        </div>
      </div>

      <div className="admin-filters">
        <select className="admin-filter-select" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}>
          <option value="">All Statuses</option>
          <option value="awaiting">Awaiting</option>
          <option value="partial">Partial</option>
          <option value="confirmed">Confirmed</option>
          <option value="expired">Expired</option>
        </select>
        <select className="admin-filter-select" value={currency} onChange={e => { setCurrency(e.target.value); setPage(1) }}>
          <option value="">All Currencies</option>
          {Object.keys(CURRENCY_COLORS).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="admin-filter-btn" onClick={fetchDeposits} disabled={loading}>Refresh</button>
        <div className="admin-filters-end">
          <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => openAction('cleanup')} title="Expire overdue deposits and delete their webhooks">
            Cleanup Expired
          </button>
          <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => openAction('purge')} title="Delete ALL BlockCypher webhooks, including orphans">
            Purge BlockCypher
          </button>
        </div>
      </div>

      {notice && (
        <div className={'admin-alert ' + (notice.type === 'error' ? 'admin-alert-error' : 'admin-alert-success')}>
          <span>{notice.text}</span>
          <button className="admin-alert-close" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      <ErrorBox>{loadError && `Could not load deposits: ${loadError}`}</ErrorBox>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>User</th>
                <th>Currency</th>
                <th>Address</th>
                <th>Expected</th>
                <th>Received</th>
                <th>Credited</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 11 }).map((_, j) => (
                      <td key={j}><span className="admin-skel" style={{ width: '70px', height: '16px' }} /></td>
                    ))}
                  </tr>
                ))
              ) : deposits.length === 0 ? (
                <tr><td colSpan={11} className="admin-table-empty">No deposits found.</td></tr>
              ) : deposits.map(d => (
                <tr key={d.id}>
                  <td><span className="admin-code">#{d.id}</span></td>
                  <td style={{ fontWeight: 600 }}>{d.user?.username || d.userId || '—'}</td>
                  <td><CurrencyBadge value={d.currency} /></td>
                  <td>
                    {hasAddress(d) ? (
                      <button className="admin-btn admin-btn-secondary admin-btn-sm" style={{ fontFamily: 'monospace' }} title={d.address} onClick={() => setAddrDeposit(d)}>
                        {truncateAddr(d.address)}
                      </button>
                    ) : '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                    {d.amountExpected != null ? `${fmtC(d.amountExpected)} ${d.currency}` : '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace', color: d.amountReceived > 0 ? '#198754' : '#999' }}>
                    {d.amountReceived > 0 ? `${fmtC(d.amountReceived)} ${d.currency}` : '—'}
                  </td>
                  <td style={{ fontWeight: 700, color: d.usdCredited > 0 || d.netAmount > 0 ? '#198754' : '#999' }}>
                    {d.netAmount > 0
                      ? <><span className="admin-code">{+d.netAmount} {d.currency}</span><div style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>{fmtUsd(d.usdCredited)} at deposit</div></>
                      : d.usdCredited > 0 ? fmtUsd(d.usdCredited) : '—'}
                  </td>
                  <td>
                    <div className="admin-gap-actions">
                      <StatusBadge type="deposit" value={d.status} />
                      {d.currency === 'XMR' && isOpen(d) && (
                        <span className="admin-badge" style={{ background: '#fff3cd', color: '#856404' }}>MANUAL</span>
                      )}
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', color: isOpen(d) && new Date(d.expiresAt) < new Date() ? '#dc2626' : undefined }}>
                    {isOpen(d) && d.expiresAt ? new Date(d.expiresAt).toLocaleString() : '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(d.createdAt).toLocaleString()}</td>
                  <td>
                    <div className="admin-gap-actions">
                      {isOpen(d) && (
                        <>
                          <button className="admin-btn admin-btn-success admin-btn-sm" onClick={() => setConfirmDeposit(d)}>Confirm</button>
                          <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => openAction('expire', d)}>Expire</button>
                        </>
                      )}
                      <button className="admin-btn admin-btn-secondary admin-btn-sm" title="USD value of the funds the customer sent" onClick={() => openInspect(d, 'usd')}>
                        $ Value
                      </button>
                      {d.currency !== 'XMR' && hasAddress(d) && (
                        <button className="admin-btn admin-btn-secondary admin-btn-sm" title="Live balance of the deposit address on the blockchain" onClick={() => openInspect(d, 'chain')}>
                          Wallet
                        </button>
                      )}
                      {UTXO.includes(d.currency) && hasAddress(d) && (
                        <button className="admin-btn admin-btn-secondary admin-btn-sm" title="Check that the stored address matches the current HD seed" onClick={() => openInspect(d, 'verify')}>
                          Verify
                        </button>
                      )}
                      {UTXO.includes(d.currency) && isOpen(d) && (
                        <button
                          className="admin-btn admin-btn-secondary admin-btn-sm"
                          title={d.hookId ? `Webhook ${d.hookId} — click to register again` : 'No webhook registered — click to register'}
                          style={!d.hookId ? { borderColor: '#f59e0b', color: '#b45309' } : undefined}
                          onClick={() => reregisterHook(d)}
                          disabled={!!hookLoading[d.id]}
                        >
                          {hookLoading[d.id] ? '…' : d.hookId ? '↺ Hook' : '⚠ Register Hook'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>

      {confirmDeposit && (
        <ConfirmModal
          deposit={confirmDeposit}
          onClose={() => setConfirmDeposit(null)}
          onConfirmed={() => { flash(`Deposit #${confirmDeposit.id} confirmed and credited.`); fetchDeposits() }}
        />
      )}

      {action && (
        <ActionModal
          title={actions[action].title}
          confirmLabel={actions[action].confirmLabel}
          busyLabel={actions[action].busyLabel}
          onClose={() => setAction(null)}
          onConfirm={async () => { await actions[action].run(actionTarget); fetchDeposits() }}
        >
          {actions[action].body(actionTarget)}
        </ActionModal>
      )}

      {addrDeposit && <AddressModal deposit={addrDeposit} onClose={() => setAddrDeposit(null)} />}

      {inspect && (
        <InspectModal
          title={{ usd: 'USD Value', chain: 'Deposit Wallet', verify: 'HD Key Verification' }[inspect.kind]}
          inspect={inspect}
          onClose={() => setInspect(null)}
        >
          {data => inspect.kind === 'usd' ? <UsdValueBody v={data} />
            : inspect.kind === 'chain' ? <WalletBody w={data} />
            : <VerifyBody v={data} />}
        </InspectModal>
      )}
    </div>
  )
}
