import { useState, Suspense, Component } from 'react'
import { NavLink, Outlet, Navigate, Link, useLocation } from 'react-router-dom'
import { useApp } from '../../context/AppContext.jsx'
import './admin.css'

const NAV_ITEMS = [
  { section: 'Overview' },
  { label: 'Dashboard', path: '/admin', end: true },
  { section: 'Commerce' },
  { label: 'Orders', path: '/admin/orders' },
  { label: 'Products', path: '/admin/products' },
  { label: 'Categories', path: '/admin/categories' },
  { label: 'Brands', path: '/admin/brands' },
  { section: 'Users & Finance' },
  { label: 'Users', path: '/admin/users' },
  { label: 'Deposits', path: '/admin/deposits' },
  { label: 'Transactions', path: '/admin/transactions' },
  { section: 'Support' },
  { label: 'Messages', path: '/admin/messages' },
  { label: 'Support Tickets', path: '/admin/support' },
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

export default function AdminLayout() {
  const { user, logout, loadingAuth } = useApp()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
                {item.label}
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

          <Link to="/admin/account" className="admin-user-chip" title="My account: change username or password" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="admin-avatar">{initial}</div>
            <span>{username}</span>
            {user?.role && <span className="admin-text-muted">· {user.role}</span>}
          </Link>
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
