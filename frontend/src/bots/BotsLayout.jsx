import { Suspense, useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, Link } from 'react-router-dom'
import { useApp } from '../context/AppContext.jsx'
import { adminFetch } from '../pages/admin/utils/api.js'
import { UiProvider } from './ui.jsx'
import { L, LANGS, lang, setLang } from './i18n.js'

// Bots first, then what they sell, what they earn and where it goes
const NAV = [
  { label: 'Bots', path: '/admin', end: true },
  { label: 'Captures', path: '/admin/captures', admin: true },
  { sep: true },
  { label: L('Commandes', 'Orders'), path: '/admin/orders', badge: 'orders' },
  { label: 'Messages', path: '/admin/messages', badge: 'messages' },
  { label: L('Produits', 'Products'), path: '/admin/products' },
  { label: L('Rayons', 'Shelves'), path: '/admin/categories' },
  { label: 'Vouchers', path: '/admin/vouchers' },
  { sep: true },
  { label: L('Clients', 'Customers'), path: '/admin/users' },
  { label: L('Dépôts', 'Deposits'), path: '/admin/deposits' },
  { label: 'Transactions', path: '/admin/transactions' },
  { label: L('Retraits', 'Withdrawals'), path: '/admin/withdrawals', admin: true },
  { label: 'Commission', path: '/admin/super', superadmin: true },
  { label: L('Utilisateurs', 'Users'), path: '/admin/staff', superadmin: true },
  { sep: true },
  { label: L('Vue d’ensemble', 'Overview'), path: '/admin/overview' },
  { label: L('Statistiques', 'Analytics'), path: '/admin/analytics' },
  { label: L('Mon compte', 'My account'), path: '/admin/account' },
]

// FR / EN, kept on this device
export function LangSwitch() {
  return (
    <span className="mode" role="radiogroup" aria-label={L('Langue', 'Language')}>
      {LANGS.map(l => (
        <button key={l.code} type="button" role="radio" aria-checked={lang === l.code} title={l.label}
          className={lang === l.code ? 'sel' : ''} onClick={() => lang !== l.code && setLang(l.code)}>{l.code.toUpperCase()}</button>
      ))}
    </span>
  )
}

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
              <span>Bots<small>{L('Plateforme des bots Telegram', 'Telegram bots platform')}</small></span>
            </Link>
            <span className="spacer" />
            <span className="bp-user">
              <Link to="/admin/account" className="who-name" style={{ color: 'inherit', textDecoration: 'none' }} title={L('Mon compte : identifiant et mot de passe', 'My account: sign-in name and password')}>{user.username}</Link>
              <span className="role">{user.role}</span>
              <LangSwitch />
              <button type="button" className="btn sm" onClick={logout}>{L('Déconnexion', 'Sign out')}</button>
            </span>
          </div>
          <nav className="bp-nav" aria-label={L('Sections', 'Sections')}>
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
