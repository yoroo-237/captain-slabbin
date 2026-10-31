import { Suspense, useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, Link } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { adminFetch } from '../pages/admin/utils/api.js'
import { UiProvider } from './ui.jsx'

// Bots first, then what they sell, what they earn and where it goes
const NAV = [
  { label: 'Bots', path: '/admin', end: true },
  { label: 'Captures', path: '/admin/captures', admin: true },
  { sep: true },
  { label: 'Commandes', path: '/admin/orders', badge: 'orders' },
  { label: 'Messages', path: '/admin/messages', badge: 'messages' },
  { label: 'Produits', path: '/admin/products' },
  { label: 'Rayons', path: '/admin/categories' },
  { label: 'Vouchers', path: '/admin/vouchers' },
  { sep: true },
  { label: 'Clients', path: '/admin/users' },
  { label: 'Dépôts', path: '/admin/deposits' },
  { label: 'Transactions', path: '/admin/transactions' },
  { label: 'Retraits', path: '/admin/withdrawals', admin: true },
  { label: 'Commission', path: '/admin/super', superadmin: true },
  { label: 'Utilisateurs', path: '/admin/staff', superadmin: true },
  { sep: true },
  { label: 'Vue d’ensemble', path: '/admin/overview' },
  { label: 'Statistiques', path: '/admin/analytics' },
  { label: 'Mon compte', path: '/admin/account' },
]

function useBadges() {
  const [badges, setBadges] = useState({})
  const load = useCallback(() => { adminFetch('/admin/badges').then(setBadges).catch(() => {}) }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [load])
  return badges
}

export default function BotsLayout({ fallback }) {
  const { user, logout } = useApp()
  const badges = useBadges()
  const admin = ['admin', 'superadmin'].includes(user.role)
  const items = NAV.filter(i => (!i.admin || admin) && (!i.superadmin || user.role === 'superadmin'))
  return (
    <UiProvider>
    <div className="bp">
      <header className="bp-top">
        <div className="bp-wrap">
          <div className="bp-top-in">
            <Link to="/admin" className="brand">
              <span className="brand-mark" aria-hidden="true"><img src="/logo-mko-192.png" alt="" width="39" height="39" /></span>
              <span>Bots<small>Plateforme des bots Telegram</small></span>
            </Link>
            <span className="spacer" />
            <span className="bp-user">
              <Link to="/admin/account" className="who-name" style={{ color: 'inherit', textDecoration: 'none' }} title="Mon compte : identifiant et mot de passe">{user.username}</Link>
              <span className="role">{user.role}</span>
              <button type="button" className="btn sm" onClick={logout}>Déconnexion</button>
            </span>
          </div>
          <nav className="bp-nav" aria-label="Sections">
            {items.map((i, k) => i.sep
              ? <span key={k} className="sep" aria-hidden="true" />
              : (
                <NavLink key={i.path} to={i.path} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {i.label}{i.badge && badges[i.badge] > 0 && <span className="nb">{badges[i.badge]}</span>}
                </NavLink>
              ))}
          </nav>
        </div>
      </header>
      <main className="bp-wrap bp-main">
        <Suspense fallback={fallback}><Outlet /></Suspense>
      </main>
    </div>
    </UiProvider>
  )
}
