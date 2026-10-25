import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { useApp } from '../../context/AppContext.jsx'
import { useShop } from '../ShopContext.jsx'
import { Icon, money, fmtDate, fmtDateTime, fmtCrypto } from '../lib.jsx'

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
      <div className="account-side">
        <div className="account-id">
          <span className="avatar" aria-hidden="true">{user.username?.[0]?.toUpperCase()}</span>
          <div><b>{user.username}</b><span>{user.tier || 'Member'}</span></div>
        </div>
        <nav className="account-nav" aria-label="Account">
          <NavLink to="/account" end><Icon.home /> Overview</NavLink>
          <NavLink to="/account/wallet"><Icon.wallet /> Wallet</NavLink>
          <NavLink to="/account/orders"><Icon.box /> Orders</NavLink>
          <NavLink to="/account/messages"><Icon.chat /> Messages {unread > 0 && <span className="badge-count">{unread}</span>}</NavLink>
          <NavLink to="/account/profile"><Icon.user /> Profile</NavLink>
          <a href="/login" onClick={e => { e.preventDefault(); logout() }}><Icon.logout /> Sign out</a>
        </nav>
      </div>
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
    <div className="stack">
      <div className="greeting">
        <h1 className="display">Welcome back, {user.username}</h1>
      </div>
      <div className="stat-grid">
        <Link to="/account/wallet" className="stat"><span className="ic"><Icon.wallet /></span><div className="k"><span className="live-dot" />Balance</div><div className="v">{money(balance)}</div></Link>
        <div className="stat"><span className="ic"><Icon.bolt /></span><div className="k">Coins held</div><div className="v">{holdings.length}</div></div>
        <div className="stat"><span className="ic"><Icon.box /></span><div className="k">Total spent</div><div className="v">{money(wallet?.totalSpent)}</div></div>
        <div className="stat"><span className="ic"><Icon.star /></span><div className="k">Tier</div><div className="v" style={{ textTransform: 'capitalize' }}>{wallet?.tier || 'Basic'}</div></div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title"><Icon.box /> Recent orders</span>
          <Link to="/account/orders" className="see-all">All orders <Icon.arrow /></Link>
        </div>
        {orders === null ? <div className="spinner" /> : orders.length === 0 ? (
          <div className="empty" style={{ padding: '24px 0' }}>
            <span className="ic"><Icon.bag /></span>
            <p>No orders yet.</p>
            <div className="hero-cta"><Link to="/s/all" className="btn btn-primary btn-sm">Start shopping</Link></div>
          </div>
        ) : <Orders orders={orders} />}
      </div>
      <div className="help-strip">
        <div><h2>Need help with an order?</h2><p className="muted">Message the shop directly. A real person answers, day or night.</p></div>
        <div className="actions"><Link to="/account/messages" className="btn btn-primary"><Icon.chat /> Message us</Link><Link to="/account/wallet" className="btn btn-outline">Add funds</Link></div>
      </div>
    </div>
  )
}

const STATUS_LABEL = { processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded' }
const paidWith = o => Array.isArray(o.payments) && o.payments.length > 0 ? o.payments.map(p => `${fmtCrypto(p.amount)} ${p.currency}`).join(' + ') : null

// A table on wide screens, a stack of cards on phones
function Orders({ orders }) {
  return (
    <>
      <div className="table-wrap only-wide">
        <table className="t">
          <thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <td><b>{o.orderNumber}</b>{o.trackingNumber && <div className="muted" style={{ fontSize: 12 }}>{o.carrier ? `${o.carrier} · ` : ''}{o.trackingNumber}</div>}</td>
                <td>{fmtDate(o.placedAt)}</td>
                <td>{o.items.map(i => `${i.quantity} × ${i.name}`).join(', ')}</td>
                <td className="num"><b>{money(o.totalAmount)}</b>{paidWith(o) && <div className="muted" style={{ fontSize: 12 }}>{paidWith(o)}</div>}</td>
                <td><span className={'status ' + o.status}>{STATUS_LABEL[o.status] || o.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="order-list only-narrow">
        {orders.map(o => (
          <div key={o.id} className="order-card">
            <div className="top"><b>{o.orderNumber}</b><span className={'status ' + o.status}>{STATUS_LABEL[o.status] || o.status}</span></div>
            <div className="items">{o.items.map(i => `${i.quantity} × ${i.name}`).join(', ')}</div>
            {o.trackingNumber && <div className="muted" style={{ fontSize: 12 }}><Icon.truck /> {o.carrier ? `${o.carrier} · ` : ''}{o.trackingNumber}</div>}
            <div className="bottom"><span>{fmtDate(o.placedAt)}{paidWith(o) ? ` · ${paidWith(o)}` : ''}</span><b>{money(o.totalAmount)}</b></div>
          </div>
        ))}
      </div>
    </>
  )
}

export function AccountOrders() {
  const [orders, setOrders] = useState(null)
  useEffect(() => { apiFetch('/orders?limit=50').then(d => setOrders(d.orders || [])).catch(() => setOrders([])) }, [])
  return (
    <div className="stack">
      <div className="greeting"><h1 className="display">Your orders</h1></div>
      <div className="panel">
        {orders === null ? <div className="spinner" /> : orders.length === 0 ? (
          <div className="empty" style={{ padding: '24px 0' }}>
            <span className="ic"><Icon.box /></span>
            <h2>No orders yet</h2>
            <p>Once you check out, your orders and tracking numbers show up here.</p>
            <div className="hero-cta"><Link to="/s/all" className="btn btn-primary">Start shopping</Link></div>
          </div>
        ) : <Orders orders={orders} />}
      </div>
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
    <div className="stack">
      <div className="greeting"><h1 className="display">Profile</h1></div>
      <form className="panel" onSubmit={save}>
        <div className="panel-title"><Icon.telegram /> Contact</div>
        <div className="field">
          <label htmlFor="p-tg">Telegram username or ID</label>
          <input id="p-tg" className="input" placeholder="@username" value={profile.telegramHandle || ''} onChange={set('telegramHandle')} />
          <span className="hint">Added to every paid invoice we receive on Telegram, so the shop can reach you.</span>
        </div>
        <div className="row-2">
          <div className="field">
            <label htmlFor="p-signal">Signal <span className="muted">(optional)</span></label>
            <input id="p-signal" className="input" value={profile.signalDetails || ''} onChange={set('signalDetails')} />
          </div>
          <div className="field">
            <label htmlFor="p-btc">BTC refund address <span className="muted">(optional)</span></label>
            <input id="p-btc" className="input" value={profile.btcRefundAddress || ''} onChange={set('btcRefundAddress')} />
          </div>
        </div>
        <div className="stack" style={{ gap: 10, marginBottom: 18 }}>
          <label className="check"><input type="checkbox" checked={!!profile.notifOrders} onChange={set('notifOrders')} /> Notify me about my orders</label>
          <label className="check"><input type="checkbox" checked={!!profile.notifDeposits} onChange={set('notifDeposits')} /> Notify me when a deposit is credited</label>
        </div>
        <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </form>

      <form className="panel" onSubmit={changePassword}>
        <div className="panel-title"><Icon.lock /> Password</div>
        {pwMsg?.error && <div className="alert alert-error"><Icon.alert /><span>{pwMsg.error}</span></div>}
        {pwMsg?.ok && <div className="alert alert-ok"><Icon.check /><span>{pwMsg.ok}</span></div>}
        <div className="field"><label htmlFor="pw-cur">Current password</label><input id="pw-cur" className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={e => setPw(p => ({ ...p, currentPassword: e.target.value }))} /></div>
        <div className="row-2">
          <div className="field"><label htmlFor="pw-new">New password</label><input id="pw-new" className="input" type="password" autoComplete="new-password" minLength={8} value={pw.newPassword} onChange={e => setPw(p => ({ ...p, newPassword: e.target.value }))} /><span className="hint">At least 8 characters</span></div>
          <div className="field"><label htmlFor="pw-conf">Confirm new password</label><input id="pw-conf" className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} /></div>
        </div>
        <button className="btn btn-outline" disabled={!pw.currentPassword || pw.newPassword.length < 8}>Update password</button>
      </form>
    </div>
  )
}

const QUICK_ASKS = ['Is this item back in stock?', 'Where is my order?', 'Do you offer bulk pricing?']

// One conversation with the shop staff; polls for replies while open
export function AccountMessages() {
  const [messages, setMessages] = useState(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const logRef = useRef(null)
  const inputRef = useRef(null)

  const load = () => apiFetch('/messages').then(d => setMessages(d.messages)).catch(e => setError(e.message))
  useEffect(() => {
    load()
    const id = setInterval(() => document.visibilityState === 'visible' && load(), 10000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }) }, [messages?.length])

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
      <div className="chat-head">
        <img src="/brand/logo.webp" alt="" />
        <div><b>Captain Slabbin</b><span><span className="live-dot" />Usually replies within minutes</span></div>
      </div>
      <div className="chat-log" ref={logRef} aria-live="polite">
        {messages === null ? <div className="spinner" style={{ margin: 'auto' }} /> : messages.length === 0 ? (
          <div className="chat-empty">
            <span className="ic"><Icon.chat /></span>
            <b style={{ color: 'var(--text)' }}>Ask us anything</b>
            <span>Stock, bulk pricing, an order: we’re here 24/7.</span>
            <div className="quick-asks">
              {QUICK_ASKS.map(q => <button key={q} type="button" className="chip" onClick={() => { setBody(q); inputRef.current?.focus() }}>{q}</button>)}
            </div>
          </div>
        ) : messages.map(m => (
          <div key={m.id} className={'bubble ' + (m.isStaff ? 'staff' : 'me')}>
            {m.body}
            <time dateTime={m.createdAt}>{m.isStaff ? 'Shop · ' : ''}{fmtDateTime(m.createdAt)}</time>
          </div>
        ))}
      </div>
      {error && <div className="alert alert-error"><Icon.alert /><span>{error}</span></div>}
      <form className="chat-form" onSubmit={send}>
        <textarea
          ref={inputRef}
          className="textarea" rows={1} maxLength={2000} placeholder="Write a message…" aria-label="Message"
          value={body} onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <button className="btn btn-primary" disabled={sending || !body.trim()} aria-label="Send"><Icon.send /></button>
      </form>
    </div>
  )
}
