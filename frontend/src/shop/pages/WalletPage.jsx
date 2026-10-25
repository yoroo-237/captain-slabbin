import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { apiFetch } from '../../utils/api.js'
import { useApp } from '../../context/AppContext.jsx'
import { useCart } from '../../context/CartContext.jsx'
import { COINS, Coin, Icon, money, fmtCrypto, fmtDate, copyText } from '../lib.jsx'
import { smokePuff } from '../components/smoke.js'

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
    <div className="stack">
      <div className="greeting"><h1 className="display">Wallet</h1></div>

      {fromCheckout && itemCount > 0 && (
        <div className="alert alert-info" style={{ margin: 0 }}>
          <Icon.bag />
          <span>Your cart is saved. Once your deposit confirms, <Link to="/checkout" className="link">return to checkout</Link>.</span>
        </div>
      )}

      <div className="wallet-card">
        <img className="wallet-mark" src="/brand/logo.webp" alt="" />
        <div className="top">
          <div>
            <div className="lbl"><span className="live-dot" />Balance · live value</div>
            <div className="bal">{money(balance)}</div>
          </div>
          {holdings.length > 0 && (
            <div className="coins" aria-hidden="true">{holdings.map(h => <Coin key={h.currency} currency={h.currency} />)}</div>
          )}
        </div>
        <div className="foot">
          <span>{holdings.length ? `${holdings.length} coin${holdings.length === 1 ? '' : 's'} held · updates every 30s` : 'Add BTC, LTC, DOGE, ETH or XMR to pay in one tap'}</span>
          <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon.plus /> Add funds</button>
        </div>
      </div>

      {holdings.length > 0 && (
        <div className="panel">
          <div className="panel-title"><Icon.wallet /> Holdings</div>
          <div className="holding-list">
            {holdings.map(h => (
              <div key={h.currency} className="holding">
                <Coin currency={h.currency} />
                <div>
                  <b>{fmtCrypto(h.amount)} {h.currency}</b>
                  <div className="muted" style={{ fontSize: 12 }}>{COINS[h.currency]?.name}</div>
                  {balance > 0 && h.usd != null && <div className="share"><i style={{ width: `${Math.min(100, (h.usd / balance) * 100)}%`, background: COINS[h.currency]?.color }} /></div>}
                </div>
                <div className="usd">{h.usd != null ? money(h.usd) : 'N/A'}<small>{h.price != null ? `1 ${h.currency} = ${money(h.price)}` : 'price unavailable'}</small></div>
              </div>
            ))}
          </div>
          <p className="summary-note" style={{ marginTop: 12 }}>
            You hold the crypto itself, so its USD value moves with the market until you spend it. At checkout the order total is converted at the live price and locked in.
          </p>
        </div>
      )}

      <div className="panel">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'deposits'} onClick={() => setTab('deposits')}>Deposits</button>
          <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>Activity</button>
        </div>
        {tab === 'deposits' ? (
          deposits.length === 0 ? <p className="muted">No deposits yet. Your first one shows up here as soon as you request an address.</p> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Date</th><th>Coin</th><th>Received</th><th>Credited</th><th>Status</th></tr></thead>
              <tbody>{deposits.map(d => (
                <tr key={d.id}>
                  <td>{fmtDate(d.createdAt)}</td>
                  <td><span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Coin currency={d.currency} small />{d.currency}</span></td>
                  <td className="num">{Number(d.amountReceived) > 0 ? `${fmtCrypto(d.amountReceived)} ${d.currency}` : '-'}</td>
                  <td className="num">{Number(d.netAmount) > 0 ? `${fmtCrypto(d.netAmount)} ${d.currency}` : '-'}</td>
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
                    <b className={'amount' + (Number(t.cryptoAmount ?? t.amount) > 0 ? ' pos' : '')}>{t.cryptoAmount != null ? `${Number(t.cryptoAmount) > 0 ? '+' : ''}${fmtCrypto(t.cryptoAmount)} ${t.currency}` : money(t.amount)}</b>
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
        if (s === 'confirmed') { clearInterval(poll.current); refreshBalance(); setTimeout(() => smokePuff(document.querySelector('.cs .success-mark'), 200), 50) }
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
            <h2 className="display">Add funds</h2>
            <div className="pay-options" role="radiogroup" aria-label="Currency">
              {Object.entries(COINS).map(([key, c]) => (
                <label key={key} className={'pay-option' + (currency === key ? ' on' : '')}>
                  <input type="radio" name="coin" checked={currency === key} onChange={() => setCurrency(key)} />
                  <Coin currency={key} />
                  <span><b>{c.name}</b> <span className="muted">({key})</span></span>
                  <span className="amt muted">{key === 'XMR' ? 'Manual · within 24h' : 'Instant · 1 confirmation'}</span>
                </label>
              ))}
            </div>
            <div className="fee-box">
              <b>Deposit fee: {fee}%</b>
              <span>Send 1 {currency} → {fmtCrypto(1 - fee / 100)} {currency} is added to your balance.</span>
            </div>
            <ul className="rules">
              <li>Send one transaction to the address shown next. Don’t reuse it.</li>
              <li>Credited after 1 network confirmation; the address expires after 12 hours.</li>
              <li>Your balance holds the crypto, so its USD value follows the market.</li>
              <li>Send only {currency} on its native network. Other assets are lost.</li>
            </ul>
            <label className="check" style={{ marginBottom: 14 }}>
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              <span>I understand the deposit terms and the {fee}% fee.</span>
            </label>
            {error && <div className="alert alert-error"><Icon.alert /><span>{error}</span></div>}
            <button className="btn btn-primary btn-block btn-lg" disabled={!agreed || busy} onClick={create}>{busy ? 'Generating address…' : `Get my ${currency} address`}</button>
          </>
        ) : status === 'confirmed' ? (
          <div style={{ textAlign: 'center' }}>
            <div className="success-mark"><Icon.check /></div>
            <h2 className="display" style={{ paddingRight: 0 }}>Deposit confirmed</h2>
            <p className="muted">Your {deposit.currency} has been added to your balance.</p>
            <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <h2 className="display">Send {deposit.currency}</h2>
            <div className="qr-box"><QRCodeSVG value={`${URI[deposit.currency]}:${deposit.address}`} size={180} /></div>
            <div className="addr">
              <code>{deposit.address}</code>
              <button className="btn btn-outline btn-sm" onClick={copy}>{copied ? <><Icon.check /> Copied</> : <><Icon.copy /> Copy</>}</button>
            </div>
            <div className="summary-row" style={{ marginTop: 10 }}><span><Icon.clock /> Expires in</span><span className="countdown">{left}</span></div>
            <div className="summary-row"><span>Deposit fee</span><span>{fee}%</span></div>
            <div className="alert alert-info" style={{ marginTop: 12, marginBottom: 0 }}>
              {deposit.currency === 'XMR'
                ? <>Monero deposits are confirmed by our team. After sending, <Link to="/account/messages" style={{ textDecoration: 'underline' }}>message us</Link> the transaction ID.</>
                : <><span className="live-dot" />Waiting for your payment. We check the network every 30 seconds. You can close this window; the deposit will still be credited.</>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
