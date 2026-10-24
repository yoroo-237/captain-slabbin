import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { useApp } from '../../context/AppContext.jsx'
import { useShop } from '../ShopContext.jsx'
import { money, fmtDate, fmtDateTime, fmtCrypto } from '../lib.jsx'

// Signed-in area: overview, wallet, orders, messages and profile
export function AccountLayout() {
  const { user, loadingAuth, logout } = useApp()
  const location = useLocation()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (user) apiFetch('/messages/unread').then(d => setUnread(d.count)).catch(() => {})
  }, [user, location.pathname])

  if (loadingAuth) return <div className="page-loading"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />

  return (
    <div className="container account-layout">
      <nav className="account-nav" aria-label="Account">
        <NavLink to="/account" end>Overview</NavLink>
        <NavLink to="/account/wallet">Wallet</NavLink>
        <NavLink to="/account/orders">Orders</NavLink>
        <NavLink to="/account/messages">Messages {unread > 0 && <span className="badge-count">{unread}</span>}</NavLink>
        <NavLink to="/account/profile">Profile</NavLink>
        <a href="/login" onClick={e => { e.preventDefault(); logout() }}>Sign out</a>
      </nav>
      <div style={{ minWidth: 0 }}><Outlet /></div>
    </div>
  )
}

export function AccountOverview() {
  const { user, balance, holdings } = useApp()
  const [orders, setOrders] = useState(null)
  const [wallet, setWallet] = useState(null)

  useEffect(() => {
    apiFetch('/orders?limit=5').then(d => setOrders(d.orders || [])).catch(() => setOrders([]))
    apiFetch('/wallet').then(setWallet).catch(() => {})
  }, [])

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 className="frost-head" style={{ fontSize: 26 }}>Hi, {user.username}</h1>
      <div className="stat-grid">
        <div className="stat"><div className="k"><span className="live-dot" />Balance</div><div className="v">{money(balance)}</div></div>
        <div className="stat"><div className="k">Cryptos held</div><div className="v">{holdings.length}</div></div>
        <div className="stat"><div className="k">Total spent</div><div className="v">{money(wallet?.totalSpent)}</div></div>
        <div className="stat"><div className="k">Tier</div><div className="v" style={{ textTransform: 'capitalize' }}>{wallet?.tier || '—'}</div></div>
      </div>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span className="panel-title" style={{ margin: 0 }}>Recent orders</span>
          <Link to="/account/orders" className="btn-plain">All orders</Link>
        </div>
        {orders === null ? <div className="spinner" /> : orders.length === 0 ? (
          <p className="muted">No orders yet. <Link to="/" style={{ textDecoration: 'underline' }}>Start shopping</Link></p>
        ) : <OrdersTable orders={orders} />}
      </div>
      <div className="cta-band" style={{ margin: 0 }}>
        <div><b>Need help with an order?</b><p className="muted" style={{ marginTop: 4 }}>Message the shop directly — we reply fast.</p></div>
        <div className="actions"><Link to="/account/messages" className="btn btn-primary">Message us</Link><Link to="/account/wallet" className="btn btn-outline">Add funds</Link></div>
      </div>
    </div>
  )
}

const STATUS_LABEL = { processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded' }

function OrdersTable({ orders }) {
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.id}>
              <td><b>{o.orderNumber}</b>{o.trackingNumber && <div className="muted" style={{ fontSize: 12 }}>{o.carrier ? `${o.carrier} · ` : ''}{o.trackingNumber}</div>}</td>
              <td>{fmtDate(o.placedAt)}</td>
              <td>{o.items.map(i => `${i.quantity} × ${i.name}`).join(', ')}</td>
              <td className="num">{money(o.totalAmount)}{Array.isArray(o.payments) && o.payments.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{o.payments.map(p => `${fmtCrypto(p.amount)} ${p.currency}`).join(' + ')}</div>}</td>
              <td><span className={'status ' + o.status}>{STATUS_LABEL[o.status] || o.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AccountOrders() {
  const [orders, setOrders] = useState(null)
  useEffect(() => { apiFetch('/orders?limit=50').then(d => setOrders(d.orders || [])).catch(() => setOrders([])) }, [])
  return (
    <div className="panel">
      <div className="panel-title">Your orders</div>
      {orders === null ? <div className="spinner" /> : orders.length === 0
        ? <p className="muted">No orders yet. Orders sent on Telegram are confirmed by message.</p>
        : <OrdersTable orders={orders} />}
    </div>
  )
}

export function AccountProfile() {
  const { toast } = useShop()
  const [profile, setProfile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [pwMsg, setPwMsg] = useState(null)

  useEffect(() => { apiFetch('/profile').then(setProfile).catch(() => {}) }, [])
  if (!profile) return <div className="page-loading"><div className="spinner" /></div>

  const set = k => e => setProfile(p => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await apiFetch('/profile', { method: 'PUT', body: JSON.stringify({
        telegramHandle: profile.telegramHandle?.trim().replace(/^@/, '') || null,
        signalDetails: profile.signalDetails?.trim() || null,
        btcRefundAddress: profile.btcRefundAddress?.trim() || null,
        notifOrders: profile.notifOrders, notifDeposits: profile.notifDeposits,
      }) })
      toast('Profile saved')
    } catch (err) { toast(err.message) }
    finally { setSaving(false) }
  }

  async function changePassword(e) {
    e.preventDefault()
    if (pw.newPassword !== pw.confirm) { setPwMsg({ error: 'Passwords don’t match' }); return }
    try {
      await apiFetch('/profile/password', { method: 'PUT', body: JSON.stringify({ currentPassword: pw.currentPassword, newPassword: pw.newPassword }) })
      setPw({ currentPassword: '', newPassword: '', confirm: '' })
      setPwMsg({ ok: 'Password updated' })
    } catch (err) { setPwMsg({ error: err.message }) }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <form className="panel" onSubmit={save}>
        <div className="panel-title">Contact</div>
        <div className="field">
          <label htmlFor="p-tg">Telegram username or ID</label>
          <input id="p-tg" className="input" placeholder="@username" value={profile.telegramHandle || ''} onChange={set('telegramHandle')} />
          <span className="hint">Included automatically when you send an order on Telegram, and on your paid orders, so the shop can reach you.</span>
        </div>
        <div className="field">
          <label htmlFor="p-signal">Signal <span className="muted">(optional)</span></label>
          <input id="p-signal" className="input" value={profile.signalDetails || ''} onChange={set('signalDetails')} />
        </div>
        <div className="field">
          <label htmlFor="p-btc">BTC refund address <span className="muted">(optional)</span></label>
          <input id="p-btc" className="input" value={profile.btcRefundAddress || ''} onChange={set('btcRefundAddress')} />
        </div>
        <label className="check" style={{ marginBottom: 8 }}><input type="checkbox" checked={!!profile.notifOrders} onChange={set('notifOrders')} /> Notify me about my orders</label>
        <label className="check" style={{ marginBottom: 14 }}><input type="checkbox" checked={!!profile.notifDeposits} onChange={set('notifDeposits')} /> Notify me when a deposit is credited</label>
        <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </form>

      <form className="panel" onSubmit={changePassword}>
        <div className="panel-title">Password</div>
        {pwMsg?.error && <div className="alert alert-error">{pwMsg.error}</div>}
        {pwMsg?.ok && <div className="alert alert-ok">{pwMsg.ok}</div>}
        <div className="field"><label htmlFor="pw-cur">Current password</label><input id="pw-cur" className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={e => setPw(p => ({ ...p, currentPassword: e.target.value }))} /></div>
        <div className="row-2">
          <div className="field"><label htmlFor="pw-new">New password</label><input id="pw-new" className="input" type="password" autoComplete="new-password" minLength={8} value={pw.newPassword} onChange={e => setPw(p => ({ ...p, newPassword: e.target.value }))} /></div>
          <div className="field"><label htmlFor="pw-conf">Confirm</label><input id="pw-conf" className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} /></div>
        </div>
        <button className="btn btn-outline" disabled={!pw.currentPassword || pw.newPassword.length < 8}>Update password</button>
      </form>
    </div>
  )
}

// One conversation with the shop staff; polls for replies while open
export function AccountMessages() {
  const [messages, setMessages] = useState(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const logRef = useRef(null)

  const load = () => apiFetch('/messages').then(d => setMessages(d.messages)).catch(e => setError(e.message))
  useEffect(() => {
    load()
    const id = setInterval(() => document.visibilityState === 'visible' && load(), 10000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight) }, [messages?.length])

  async function send(e) {
    e?.preventDefault()
    const text = body.trim()
    if (!text) return
    setSending(true); setError('')
    try {
      const { message } = await apiFetch('/messages', { method: 'POST', body: JSON.stringify({ body: text }) })
      setMessages(m => [...(m || []), message])
      setBody('')
    } catch (err) { setError(err.message) }
    finally { setSending(false) }
  }

  return (
    <div className="panel chat">
      <div className="panel-title">Messages with the shop</div>
      <div className="chat-log" ref={logRef} aria-live="polite">
        {messages === null ? <div className="spinner" /> : messages.length === 0 ? (
          <p className="muted" style={{ margin: 'auto', textAlign: 'center' }}>Ask us anything — stock, bulk pricing, an order.<br />We usually reply within minutes.</p>
        ) : messages.map(m => (
          <div key={m.id} className={'bubble ' + (m.isStaff ? 'staff' : 'me')}>
            {m.body}
            <time dateTime={m.createdAt}>{m.isStaff ? 'Shop · ' : ''}{fmtDateTime(m.createdAt)}</time>
          </div>
        ))}
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <form className="chat-form" onSubmit={send}>
        <textarea
          className="textarea" rows={1} maxLength={2000} placeholder="Write a message…" aria-label="Message"
          value={body} onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <button className="btn btn-primary" disabled={sending || !body.trim()}>Send</button>
      </form>
    </div>
  )
}

