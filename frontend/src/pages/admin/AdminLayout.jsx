import { useState, useEffect, useCallback, Suspense, Component } from 'react'
import { NavLink, Outlet, Navigate, Link, useLocation } from 'react-router-dom'
import { useApp } from '../../context/AppContext.jsx'
import { adminFetch } from './utils/api.js'
import { usePush } from './usePush.js'
import './admin.css'

const NAV_ITEMS = [
  { section: 'Overview' },
  { label: 'Dashboard', path: '/admin', end: true },
  { section: 'Commerce' },
  { label: 'Orders', path: '/admin/orders', badge: 'orders' },
  { label: 'Products', path: '/admin/products' },
  { label: 'Categories', path: '/admin/categories' },
  { label: 'Brands', path: '/admin/brands' },
  { label: 'Vouchers', path: '/admin/vouchers' },
  { section: 'Users & Finance' },
  { label: 'Users', path: '/admin/users' },
  { label: 'Deposits', path: '/admin/deposits' },
  { label: 'Transactions', path: '/admin/transactions' },
  { section: 'Support' },
  { label: 'Messages', path: '/admin/messages', badge: 'messages' },
  { label: 'Support Tickets', path: '/admin/support', badge: 'tickets' },
  { label: 'Reviews', path: '/admin/reviews' },
  { section: 'Content' },
  { label: 'News', path: '/admin/news' },
  { label: 'FAQ', path: '/admin/faq' },
  { label: 'Giveaways', path: '/admin/giveaways' },
  { section: 'System' },
  { label: 'Analytics', path: '/admin/analytics' },
  { label: 'Settings', path: '/admin/settings' },
  { label: 'Telegram bots', path: '/admin/telegram' },
  { label: 'My account', path: '/admin/account' },
]

const SUPER_NAV_ITEMS = [
  { section: 'Super Admin' },
  { label: 'Deposit Commission', path: '/admin/super' },
]

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload))
  } catch {
    return {}
  }
}

// What waits for staff (unread messages, orders to process, open tickets), refreshed
// every 30 s, when the tab regains focus and the moment a push arrives
function useBadges(enabled) {
  const [badges, setBadges] = useState({ messages: 0, orders: 0, tickets: 0 })
  const load = useCallback(() => { adminFetch('/admin/badges').then(setBadges).catch(() => {}) }, [])
  useEffect(() => {
    if (!enabled) return undefined
    load()
    const timer = setInterval(load, 30000)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    const onPush = e => { if (e.data?.type === 'push') load() }
    document.addEventListener('visibilitychange', onVisible)
    navigator.serviceWorker?.addEventListener('message', onPush)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); navigator.serviceWorker?.removeEventListener('message', onPush) }
  }, [enabled, load])
  return badges
}

const BELL = {
  on: 'Notifications on',
  off: 'Turn on notifications',
  blocked: 'Notifications blocked',
}

// Header button: push notifications for orders, messages and tickets
function NotificationsButton() {
  const { state, busy, error, enable, disable, test } = usePush()
  const [open, setOpen] = useState(false)
  if (state === 'unsupported') return null
  return (
    <div className="admin-pop-wrap">
      <button type="button" className={'admin-bell' + (state === 'on' ? ' on' : '')} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={BELL[state]} title={BELL[state]}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
          {state !== 'on' && <line x1="3" y1="3" x2="21" y2="21" />}
        </svg>
      </button>
      {open && (
        <>
          <div className="admin-pop-backdrop" onClick={() => setOpen(false)} />
          <div className="admin-pop" role="dialog" aria-label="Notifications">
            <div className="admin-pop-title">Notifications</div>
            {state === 'on' && <p className="admin-pop-text">On in this browser: you are told about paid orders, customer messages and support tickets, even with this tab closed.</p>}
            {state === 'off' && <p className="admin-pop-text">Get a notification for each paid order, customer message and support ticket, even with this tab closed.</p>}
            {state === 'blocked' && <p className="admin-pop-text">This browser blocks notifications for the site. Allow them with the padlock next to the address, then come back here.</p>}
            {error && <div className="admin-alert admin-alert-error" style={{ margin: '0 0 10px' }}>{error}</div>}
            <div className="admin-pop-actions">
              {state === 'off' && <button type="button" className="admin-btn admin-btn-primary" disabled={busy} onClick={enable}>{busy ? 'Turning on…' : 'Turn on'}</button>}
              {state === 'on' && <>
                <button type="button" className="admin-btn admin-btn-secondary" disabled={busy} onClick={test}>Send a test</button>
                <button type="button" className="admin-btn admin-btn-danger" disabled={busy} onClick={disable}>Turn off</button>
              </>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function AdminLayout() {
  const { user, logout, loadingAuth } = useApp()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const badges = useBadges(!loadingAuth)
  const waiting = badges.messages + badges.orders + badges.tickets
  useEffect(() => {
    document.title = (waiting ? `(${waiting}) ` : '') + 'Admin Dashboard'
  }, [waiting])

  if (loadingAuth) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>Loading…</div>

  // Derive username from JWT if user not loaded yet
  const token = localStorage.getItem('token')
  let username = user?.username || ''
  if (!username && token) {
    const payload = decodeJwt(token)
    username = payload.username || payload.sub || 'Admin'
  }

  const initial = username?.charAt(0)?.toUpperCase() || 'A'
  const navItems = user?.role === 'superadmin' ? [...NAV_ITEMS, ...SUPER_NAV_ITEMS] : NAV_ITEMS

  return (
    <div className="admin-layout">
      {/* Overlay for mobile */}
      <div
        className={'admin-sidebar-overlay' + (sidebarOpen ? ' open' : '')}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={'admin-sidebar' + (sidebarOpen ? ' open' : '')}>
        <span className="admin-sidebar-logo">Admin Dashboard</span>

        <nav className="admin-nav">
          {navItems.map((item, i) =>
            item.section ? (
              <div key={i} className="admin-nav-section">{item.section}</div>
            ) : (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                className={({ isActive }) => 'admin-nav-link' + (isActive ? ' active' : '')}
                onClick={() => setSidebarOpen(false)}
              >
                <span className="admin-nav-label">{item.label}</span>
                {item.badge && badges[item.badge] > 0 && <span className="admin-nav-badge" aria-label={`${badges[item.badge]} waiting`}>{badges[item.badge] > 99 ? '99+' : badges[item.badge]}</span>}
              </NavLink>
            )
          )}
        </nav>

        <div className="admin-sidebar-footer">
          <Link to="/" className="admin-btn" style={{ width: '100%', textAlign: 'center', textDecoration: 'none', display: 'block', marginBottom: '8px' }}>
            ← Back to Site
          </Link>
          <button className="admin-btn admin-btn-danger" style={{ width: '100%' }} onClick={logout}>
            Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="admin-main">
        <header className="admin-header">
          <button
            className="admin-burger"
            onClick={() => setSidebarOpen(o => !o)}
            aria-label="Toggle sidebar"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>

          <div className="admin-header-end">
            <NotificationsButton />
            <Link to="/admin/account" className="admin-user-chip" title="My account: change username or password" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="admin-avatar">{initial}</div>
              <span className="admin-user-name">{username}</span>
              {user?.role && <span className="admin-text-muted admin-user-role">· {user.role}</span>}
            </Link>
          </div>
        </header>

        <main className="admin-content">
          <PageBoundary key={location.pathname}><Suspense fallback={<div style={{ padding: 40, color: '#888' }}>Loading…</div>}><Outlet /></Suspense></PageBoundary>
        </main>
      </div>
    </div>
  )
}

// One admin page failing shows a way out instead of a blank screen; moving to
// another page (new key) starts clean
class PageBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { console.error('[admin page]', error) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="admin-card" style={{ maxWidth: 520 }}>
        <h2 className="admin-card-title">This page could not load</h2>
        <p className="admin-text-muted" style={{ margin: '0 0 14px' }}>{String(this.state.error?.message || this.state.error)}</p>
        <button type="button" className="admin-btn admin-btn-primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}
