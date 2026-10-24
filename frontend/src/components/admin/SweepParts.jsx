// Shared by Settings → Crypto (admins) and the super admin panel.
// The commission is deducted from each deposit when it is credited. Two separate
// sweeps then collect the deposit addresses: the admin sweeps the customer-credited
// share, the super admin sweeps the commission to the reserve fund.

export const RESERVE_LABEL = 'Reserve fund (expansion & maintenance)'

export const COMMISSION_ADDR_KEY = {
  BTC: 'btcCommissionAddress', LTC: 'ltcCommissionAddress', DOGE: 'dogeCommissionAddress', ETH: 'ethCommissionAddress',
}

export const shortAddr = a => (a ? `${a.slice(0, 10)}…${a.slice(-6)}` : '—')

// Unswept amounts per currency: [{ currency, amount, deposits }]
export function PendingTiles({ pending, currencies, note }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px', marginBottom: '14px' }}>
      {currencies.map(({ id, color }) => {
        const p = pending.find(x => x.currency === id)
        return (
          <div key={id} style={{ border: `1px solid ${color}55`, borderRadius: '8px', padding: '8px 12px' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color }}>{id}</div>
            <div className="admin-code" style={{ fontWeight: 700 }}>{p ? p.amount : 0}</div>
            <div className="admin-text-muted" style={{ fontSize: '0.72rem' }}>
              {p ? `${p.deposits} deposit(s)` : 'nothing pending'}{note?.(id, p)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function SweepResult({ result, onClose }) {
  if (!result) return null
  if (result.error) {
    return (
      <div className="admin-alert admin-alert-error">
        <span>{result.currency} sweep failed: {result.error}</span>
        {onClose && <button type="button" className="admin-alert-close" onClick={onClose} aria-label="Dismiss">×</button>}
      </div>
    )
  }
  const problems = (result.skipped || []).filter(s => s.reason)
  return (
    <div className={'admin-alert ' + (result.swept > 0 ? 'admin-alert-success' : 'admin-alert-info')} style={{ display: 'block' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontWeight: 700, marginBottom: '6px' }}>
        <span>
          {result.swept > 0
            ? `✓ ${result.swept} address(es) swept — ${result.total} ${result.currency}`
            : `Nothing to sweep (${result.currency})`}
        </span>
        {onClose && <button type="button" className="admin-alert-close" onClick={onClose} aria-label="Dismiss">×</button>}
      </div>
      {(result.results || []).map((r, i) => (
        <div key={i} style={{ fontSize: '0.78rem', fontFamily: 'monospace', marginBottom: '4px', wordBreak: 'break-all' }}>
          {r.amount} {result.currency} · tx {r.txHash ? `${r.txHash.slice(0, 16)}…` : '—'}
        </div>
      ))}
      {problems.map((s, i) => (
        <div key={`s${i}`} style={{ fontSize: '0.78rem', color: '#b45309', wordBreak: 'break-all' }}>
          ⚠ #{s.depositId} {shortAddr(s.address)} — {s.reason}
        </div>
      ))}
    </div>
  )
}

// `side` picks which share a row shows: 'shop' (admin) or 'reserve' (super admin)
export function SweepLogTable({ logs, loading, side = 'shop' }) {
  if (loading) return <div className="admin-text-muted">Loading…</div>
  const rows = logs.filter(l => (side === 'shop' ? l.kind !== 'reserve' : l.kind !== 'shop'))
  if (!rows.length) return <div className="admin-text-muted">No sweeps yet.</div>
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Date</th><th>Type</th><th>Currency</th><th>Amount</th><th>Tx</th>
            {side === 'reserve' && <th>Reserve Address</th>}
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(l => {
            const amount = side === 'shop' ? l.mainAmount : l.commissionAmount
            const tx     = side === 'shop' ? l.mainTxHash : l.commissionTxHash
            return (
              <tr key={l.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(l.createdAt).toLocaleString()}</td>
                <td>{l.kind === 'legacy' ? 'Split sweep (old)' : side === 'shop' ? 'Customer funds' : 'Commission'}</td>
                <td>{l.currency}</td>
                <td className="admin-code" style={side === 'reserve' ? { color: '#b45309' } : undefined}>{Number(amount)}</td>
                <td><span className="admin-code" title={tx || ''}>{tx ? `${tx.slice(0, 10)}…` : '—'}</span></td>
                {side === 'reserve' && <td><span className="admin-code" title={l.commissionAddress || ''}>{shortAddr(l.commissionAddress)}</span></td>}
                <td>{l.triggeredByUser?.username || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
