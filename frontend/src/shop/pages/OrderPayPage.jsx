import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { apiFetch } from '../../utils/api.js'
import { useApp } from '../../context/AppContext.jsx'
import { Coin, Icon, money, fmtCrypto, copyText } from '../lib.jsx'

const URI = { BTC: 'bitcoin', LTC: 'litecoin', DOGE: 'dogecoin', ETH: 'ethereum', XMR: 'monero' }
const fmt = n => (n == null ? '' : Number(n).toFixed(8).replace(/\.?0+$/, ''))

function countdown(expiresAt) {
  const ms = new Date(expiresAt) - Date.now()
  if (ms <= 0) return '0:00'
  return `${Math.floor(ms / 6e4)}:${String(Math.floor(ms % 6e4 / 1e3)).padStart(2, '0')}`
}

// An order paid straight in crypto: its own address, the exact amount, the time left.
// Payments add up; the page reads the blockchain every 30 s and moves on once it is paid.
// Reopened from Your orders.
export default function OrderPayPage() {
  const { id } = useParams()
  const { refreshBalance } = useApp()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [left, setLeft] = useState('')
  const [copied, setCopied] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const load = useCallback(() => apiFetch(`/orders/${id}/payment`).then(setData).catch(e => setError(e.message)), [id])
  useEffect(() => { load() }, [load])

  const status = data?.order?.status
  const currency = data?.currency
  const awaiting = status === 'awaiting_payment'

  const check = useCallback(async () => {
    setChecking(true)
    try { setData(await apiFetch(`/orders/${id}/payment/check`, { method: 'POST' })) }
    catch { /* checked again next time */ }
    finally { setChecking(false) }
  }, [id])

  useEffect(() => {
    if (!awaiting) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') check() }, 30000)
    return () => clearInterval(t)
  }, [awaiting, check])

  useEffect(() => {
    if (!awaiting || !data?.order?.expiresAt) return
    const tick = () => { setLeft(countdown(data.order.expiresAt)); if (new Date(data.order.expiresAt) <= Date.now()) load() }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [awaiting, data?.order?.expiresAt, load])

  useEffect(() => { if (status === 'processing') refreshBalance?.() }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const copy = (text, what) => { copyText(String(text)); setCopied(what); setTimeout(() => setCopied(''), 1800) }

  async function cancel() {
    if (!window.confirm('Cancel this order? Anything already received is refunded.')) return
    setCancelling(true)
    try { await apiFetch(`/orders/${id}/cancel`, { method: 'POST' }); await load() }
    catch (e) { setError(e.message) }
    finally { setCancelling(false) }
  }

  if (error && !data) {
    return (
      <div className="stack"><div className="panel">
        <h1 className="display">Order not found</h1>
        <p className="muted">{error}</p>
        <Link to="/account/orders" className="btn btn-primary">Your orders</Link>
      </div></div>
    )
  }
  if (!data) return <div className="spinner" />

  const { order, deposit } = data
  const received = deposit ? Number(deposit.amountReceived) : 0
  const toSend = received > 0 ? data.remaining : data.amountDue
  const qr = deposit?.address ? `${URI[currency] || currency.toLowerCase()}:${deposit.address}${['BTC', 'LTC', 'DOGE'].includes(currency) && toSend ? `?amount=${fmt(toSend)}` : ''}` : ''

  if (['processing', 'shipped', 'delivered'].includes(status)) {
    return (
      <div className="stack">
        <div className="panel" style={{ textAlign: 'center' }}>
          <div className="success-mark"><Icon.check /></div>
          <h1 className="display">Payment received</h1>
          <p className="muted">Order <b style={{ color: 'var(--text)' }}>{order.orderNumber}</b> is paid and being prepared. The shop will contact you on Telegram to finish up.</p>
          <div className="hero-cta" style={{ justifyContent: 'center' }}>
            <Link to="/account/orders" className="btn btn-primary"><Icon.box /> Your orders</Link>
            <Link to="/" className="btn btn-outline">Keep shopping</Link>
          </div>
        </div>
      </div>
    )
  }

  if (!awaiting) {
    return (
      <div className="stack">
        <div className="panel">
          <h1 className="display">Order {order.orderNumber} was cancelled</h1>
          <p className="muted">{received > 0 ? `${fmt(received)} ${currency} received for it is being refunded.` : 'No payment was received for it.'} A payment sent to its address now is refunded too.</p>
          <Link to="/account/orders" className="btn btn-primary">Your orders</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="greeting"><h1 className="display">Pay order {order.orderNumber}</h1></div>
      <div className="panel">
        <div className="panel-title" style={{ justifyContent: 'space-between', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Coin currency={currency} /> {currency}</span>
          <span className="muted" aria-live="polite">Time left <b style={{ color: 'var(--text)', fontFamily: 'ui-monospace, monospace', fontSize: 18 }}>{left}</b></span>
        </div>

        {qr && <div className="qr-box" style={{ display: 'flex', justifyContent: 'center' }}><QRCodeSVG value={qr} size={196} includeMargin /></div>}

        <div className="field">
          <label>{received > 0 ? 'Still to send' : 'Amount to send'}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" readOnly value={`${fmt(toSend)} ${currency}`} onFocus={e => e.target.select()} />
            <button type="button" className="btn btn-outline btn-sm" onClick={() => copy(fmt(toSend), 'amount')}>{copied === 'amount' ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
        <div className="field">
          <label>To this address</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" readOnly value={deposit?.address || ''} onFocus={e => e.target.select()} style={{ fontSize: 12 }} />
            <button type="button" className="btn btn-outline btn-sm" onClick={() => copy(deposit?.address, 'address')}>{copied === 'address' ? 'Copied' : 'Copy'}</button>
          </div>
        </div>

        {received > 0 && (
          <div className="alert alert-warn"><Icon.alert /><span>Received so far: <b>{fmt(received)} {currency}</b>. Send the rest to the same address.</span></div>
        )}
        {error && <div className="alert alert-error"><Icon.alert /><span>{error}</span></div>}

        <p className="summary-note">Send exactly this amount, in {currency} only. It is priced for this order and includes the {data.commissionPct}% deposit fee. Several payments add up. Anything sent after the time runs out, or above the amount, is refunded.</p>
        <p className="summary-note">
          {['BTC', 'LTC', 'DOGE'].includes(currency) ? 'Confirmed after 1 blockchain confirmation. This page checks every 30 seconds.'
            : currency === 'ETH' ? 'ETH payments are detected within a few minutes.'
            : <>Monero payments are checked by hand: after sending, <Link to="/account/messages" className="link">message us</Link> the transaction ID.</>}
        </p>

        <div className="hero-cta">
          <button type="button" className="btn btn-primary" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'I sent it, check now'}</button>
          <button type="button" className="btn btn-outline" onClick={cancel} disabled={cancelling}>{cancelling ? 'Cancelling…' : 'Cancel order'}</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Order summary</div>
        {order.items.map(i => (
          <div key={i.id} className="summary-row"><span>{i.quantity} × {i.name}</span><span>{money(i.price * i.quantity)}</span></div>
        ))}
        <div className="summary-row"><span>Delivery</span><span>{order.shippingAddress ? (order.shippingFee ? money(order.shippingFee) : 'Free') : 'None'}</span></div>
        <div className="summary-row total"><span>Total</span><span>{money(order.totalAmount)}</span></div>
        <p className="summary-note">{fmtCrypto(data.amountDue)} {currency} asked for this order.</p>
      </div>
    </div>
  )
}
