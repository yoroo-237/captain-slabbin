import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { apiFetch } from '../../utils/api.js'
import { useApp } from '../../context/AppContext.jsx'
import { useCart } from '../../context/CartContext.jsx'
import { COINS, Coin, Icon, money, fmtCrypto, fmtDate, copyText } from '../lib.jsx'

const URI = { BTC: 'bitcoin', LTC: 'litecoin', DOGE: 'dogecoin', ETH: 'ethereum', XMR: 'monero' }

// The balance is the crypto the customer holds (deposit minus the deposit fee),
// valued live at the market price. Deposits are made to single-use addresses.
export default function WalletPage() {
  const { balance, holdings, refreshBalance } = useApp()
  const { itemCount } = useCart()
  const [params] = useSearchParams()
  const [info, setInfo] = useState(null)
  const [deposits, setDeposits] = useState([])
  const [txns, setTxns] = useState([])
  const [tab, setTab] = useState('deposits')
  const [adding, setAdding] = useState(false)

  const loadLists = useCallback(() => {
    apiFetch('/wallet/deposits').then(d => setDeposits(d.deposits || [])).catch(() => {})
    apiFetch('/wallet/transactions').then(d => setTxns(d.transactions || [])).catch(() => {})
  }, [])

  useEffect(() => {
    apiFetch('/wallet').then(setInfo).catch(() => {})
    refreshBalance()
    loadLists()
  }, [refreshBalance, loadLists])

  const fromCheckout = params.get('from') === 'checkout'

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {fromCheckout && itemCount > 0 && (
        <div className="alert alert-info" style={{ margin: 0 }}>
          Your bag is saved. Once your deposit confirms, <Link to="/checkout" style={{ textDecoration: 'underline', fontWeight: 700 }}>return to checkout</Link>.
        </div>
      )}

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div className="card-cat"><span className="live-dot" />Wallet balance · live</div>
            <div className="price-big" style={{ marginTop: 6 }}>{money(balance)}</div>
          </div>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add funds</button>
        </div>
        {holdings.length > 0 ? (
          <div className="holding-list">
            {holdings.map(h => (
              <div key={h.currency} className="holding">
                <Coin currency={h.currency} />
                <div><b>{fmtCrypto(h.amount)} {h.currency}</b><div className="muted" style={{ fontSize: 12 }}>{COINS[h.currency]?.name}</div></div>
                <div className="usd">{h.usd != null ? money(h.usd) : '—'}<small>{h.price != null ? `1 ${h.currency} = ${money(h.price)}` : 'price unavailable'}</small></div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 12 }}>Your wallet is empty. Add funds with BTC, LTC, DOGE, ETH or XMR to pay instantly at checkout.</p>
        )}
        <p className="summary-note" style={{ marginTop: 12 }}>
          You hold the crypto itself, so its USD value moves with the market until you spend it. At checkout the order total is converted at the live price and locked in.
        </p>
      </div>

      <div className="panel">
        <div className="chips" role="tablist">
          <button className={'chip' + (tab === 'deposits' ? ' active' : '')} onClick={() => setTab('deposits')}>Deposits</button>
          <button className={'chip' + (tab === 'history' ? ' active' : '')} onClick={() => setTab('history')}>History</button>
        </div>
        {tab === 'deposits' ? (
          deposits.length === 0 ? <p className="muted">No deposits yet.</p> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Date</th><th>Coin</th><th>Received</th><th>Credited</th><th>Status</th></tr></thead>
              <tbody>{deposits.map(d => (
                <tr key={d.id}>
                  <td>{fmtDate(d.createdAt)}</td>
                  <td>{d.currency}</td>
                  <td className="num">{Number(d.amountReceived) > 0 ? `${fmtCrypto(d.amountReceived)} ${d.currency}` : '—'}</td>
                  <td className="num">{Number(d.netAmount) > 0 ? `${fmtCrypto(d.netAmount)} ${d.currency}` : '—'}</td>
                  <td><span className={'status ' + d.status}>{d.status}</span></td>
                </tr>
              ))}</tbody>
            </table></div>
          )
        ) : (
          txns.length === 0 ? <p className="muted">No activity yet.</p> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Details</th></tr></thead>
              <tbody>{txns.map(t => (
                <tr key={t.id}>
                  <td>{fmtDate(t.createdAt)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{t.type}</td>
                  <td className="num">
                    {t.cryptoAmount != null ? `${Number(t.cryptoAmount) > 0 ? '+' : ''}${fmtCrypto(t.cryptoAmount)} ${t.currency}` : money(t.amount)}
                    <div className="muted" style={{ fontSize: 12 }}>{money(Math.abs(Number(t.amount)))}{t.rate ? ` @ ${money(t.rate)}` : ''}</div>
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>{t.note}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )
        )}
      </div>

      {adding && <AddFunds feePct={info?.commissionPct} onClose={() => { setAdding(false); loadLists(); refreshBalance() }} />}
    </div>
  )
}

function AddFunds({ feePct, onClose }) {
  const { refreshBalance } = useApp()
  const [currency, setCurrency] = useState('BTC')
  const [agreed, setAgreed] = useState(false)
  const [deposit, setDeposit] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('awaiting')
  const [copied, setCopied] = useState(false)
  const [left, setLeft] = useState('')
  const poll = useRef(null)

  async function create() {
    setBusy(true); setError('')
    try {
      const d = await apiFetch('/wallet/deposit', { method: 'POST', body: JSON.stringify({ currency }) })
      setDeposit(d)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  // Check the chain every 30s while the address is shown (XMR is confirmed by staff)
  useEffect(() => {
    if (!deposit || deposit.currency === 'XMR') return
    const check = async () => {
      try {
        const r = await apiFetch(`/wallet/deposits/${deposit.id}/check`, { method: 'POST' })
        const s = r.deposit?.status
        if (s && s !== status) setStatus(s)
        if (s === 'confirmed') { clearInterval(poll.current); refreshBalance() }
      } catch { /* keep polling */ }
    }
    poll.current = setInterval(check, 30000)
    return () => clearInterval(poll.current)
  }, [deposit]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!deposit?.expiresAt) return
    const tick = () => {
      const ms = new Date(deposit.expiresAt) - Date.now()
      if (ms <= 0) { setLeft('expired'); return }
      const h = Math.floor(ms / 3.6e6), m = Math.floor(ms % 3.6e6 / 6e4), s = Math.floor(ms % 6e4 / 1e3)
      setLeft(`${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [deposit])

  async function copy() {
    if (await copyText(deposit.address)) { setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  const fee = Number(feePct) || 0

  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-label="Add funds">
      <button className="modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="modal">
        <button className="icon-btn modal-close" aria-label="Close" onClick={onClose}><Icon.close /></button>
        {!deposit ? (
          <>
            <h2>Add funds</h2>
            <div className="pay-options" role="radiogroup" aria-label="Currency">
              {Object.entries(COINS).map(([key, c]) => (
                <label key={key} className={'pay-option' + (currency === key ? ' on' : '')}>
                  <input type="radio" name="coin" checked={currency === key} onChange={() => setCurrency(key)} />
                  <Coin currency={key} />
                  <span><b>{c.name}</b> <span className="muted">({key})</span></span>
                  <span className="amt muted">{key === 'XMR' ? 'Manual · within 24h' : 'Automatic'}</span>
                </label>
              ))}
            </div>
            <div className="fee-box">
              <b>Deposit fee: {fee}%</b>
              <span>Send 1 {currency} → {fmtCrypto(1 - fee / 100)} {currency} is added to your balance.</span>
            </div>
            <ul className="muted" style={{ fontSize: 13, paddingLeft: 18, margin: '0 0 14px', display: 'grid', gap: 4 }}>
              <li>Send one transaction to the address shown next. Don’t reuse it.</li>
              <li>Credited after 1 network confirmation; the address expires after 12 hours.</li>
              <li>Your balance holds the crypto — its USD value follows the market.</li>
              <li>Send only {currency} on its native network. Other assets are lost.</li>
            </ul>
            <label className="check" style={{ marginBottom: 14 }}>
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              <span>I understand the deposit terms and the {fee}% fee.</span>
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={!agreed || busy} onClick={create}>{busy ? 'Generating address…' : `Get my ${currency} address`}</button>
          </>
        ) : status === 'confirmed' ? (
          <div style={{ textAlign: 'center' }}>
            <div className="success-mark"><Icon.check /></div>
            <h2 style={{ paddingRight: 0 }}>Deposit confirmed</h2>
            <p className="muted">Your {deposit.currency} has been added to your balance.</p>
            <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <h2>Send {deposit.currency}</h2>
            <div className="qr-box"><QRCodeSVG value={`${URI[deposit.currency]}:${deposit.address}`} size={180} /></div>
            <div className="addr">
              <code>{deposit.address}</code>
              <button className="btn btn-outline btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <div className="summary-row" style={{ marginTop: 10 }}><span>Expires in</span><span>{left}</span></div>
            <div className="summary-row"><span>Deposit fee</span><span>{fee}%</span></div>
            <div className="alert alert-info" style={{ marginTop: 12, marginBottom: 0 }}>
              {deposit.currency === 'XMR'
                ? <>Monero deposits are confirmed by our team. After sending, <Link to="/account/messages" style={{ textDecoration: 'underline' }}>message us</Link> the transaction ID.</>
                : <><span className="live-dot" />Waiting for your payment — we check the network every 30 seconds. You can close this window; the deposit will still be credited.</>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
