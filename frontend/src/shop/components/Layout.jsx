import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useApp } from '../../context/AppContext.jsx'
import { useCart } from '../../context/CartContext.jsx'
import { apiFetch } from '../../utils/api.js'
import { useShop } from '../ShopContext.jsx'
import { Icon, money } from '../lib.jsx'

// Header (support strip, logo, shelves nav, bag), mobile drawer, footer,
// promo pop-up and toasts around every storefront page.
export default function Layout({ children }) {
  const { settings, shelves, toasts } = useShop()
  const { user, balance } = useApp()
  const { itemCount } = useCart()
  const [drawer, setDrawer] = useState(false)
  const [unread, setUnread] = useState(0)
  const location = useLocation()

  useEffect(() => { setDrawer(false); window.scrollTo(0, 0) }, [location.pathname])

  // Unread replies from the shop, shown on the account icon
  useEffect(() => {
    if (!user) { setUnread(0); return }
    const load = () => apiFetch('/messages/unread').then(d => setUnread(d.count)).catch(() => {})
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [user, location.pathname])

  const phone = settings.support_phone
  const tgUser = settings.telegram_username?.replace(/^@/, '')
  const shelfLinks = [
    { slug: 'fire-sale', name: 'Fire Sale', fire: true, children: [] },
    ...shelves.categories,
  ]

  return (
    <div className="cs">
      <a className="sr-only" href="#main">Skip to content</a>
      {phone && (
        <div className="support-bar">
          <a href={`sms:${phone.replace(/[^\d+]/g, '')}`}>
            <span>Text us now <span className="hours">(24/7 Support)</span></span>
            <span className="num">{phone}</span>
          </a>
        </div>
      )}

      <header className="header">
        <div className="container header-row">
          <div className="header-left">
            <button className="icon-btn mobile-only" aria-label="Open menu" onClick={() => setDrawer(true)}><Icon.menu /></button>
            {tgUser && (
              <a className="icon-btn" href={`https://t.me/${tgUser}`} target="_blank" rel="noreferrer" aria-label="Message us on Telegram"><Icon.telegram /></a>
            )}
          </div>
          <Link to="/" className="header-logo" aria-label="Home">
            <img src="/brand/logo.webp" alt={settings.site_name || 'Captain Slabbin'} />
          </Link>
          <div className="header-right">
            {user && (
              <Link to="/account/wallet" className="balance-chip" title="Live value of your crypto balance">
                <span className="dot" /> {money(balance)}
              </Link>
            )}
            <Link to={user ? '/account' : '/login'} className="icon-btn" aria-label={user ? 'My account' : 'Sign in'}>
              <Icon.user />
              {unread > 0 && <span className="count">{unread}</span>}
            </Link>
            <Link to="/cart" className="icon-btn" aria-label={`Bag, ${itemCount} item${itemCount === 1 ? '' : 's'}`}>
              <Icon.bag />
              {itemCount > 0 && <span className="count">{itemCount}</span>}
            </Link>
          </div>
        </div>
        <nav className="main-nav-row" aria-label="Shop">
          <ul className="main-nav">
            {shelfLinks.map(s => (
              <li key={s.slug}>
                <NavLink to={`/s/${s.slug}`} className={({ isActive }) => (s.fire ? 'fire ' : '') + (isActive ? 'active' : '')}>{s.name}</NavLink>
                {s.children?.length > 0 && (
                  <ul className="nav-sub">
                    {s.children.map(c => <li key={c.slug}><Link to={`/s/${s.slug}?sub=${c.slug}`}>{c.name}</Link></li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {drawer && (
        <>
          <button className="drawer-backdrop" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <nav className="drawer" aria-label="Menu">
            <div className="drawer-head">
              <img src="/brand/logo.webp" alt="" />
              <button className="icon-btn" aria-label="Close menu" onClick={() => setDrawer(false)}><Icon.close /></button>
            </div>
            {shelfLinks.map(s => (
              <div key={s.slug}>
                <NavLink to={`/s/${s.slug}`} className={({ isActive }) => 'drawer-link' + (isActive ? ' active' : '')} style={s.fire ? { color: 'var(--blood-hi)' } : undefined}>
                  {s.name}{s.count != null && <span className="muted">{s.count}</span>}
                </NavLink>
                {s.children?.length > 0 && (
                  <div className="drawer-sub">
                    {s.children.map(c => <Link key={c.slug} className="drawer-link" to={`/s/${s.slug}?sub=${c.slug}`}>{c.name}</Link>)}
                  </div>
                )}
              </div>
            ))}
            <hr />
            {user ? (
              <>
                <Link className="drawer-link" to="/account">My account</Link>
                <Link className="drawer-link" to="/account/wallet">Wallet · {money(balance)}</Link>
                <Link className="drawer-link" to="/account/messages">Messages{unread > 0 && <span className="badge-count">{unread}</span>}</Link>
              </>
            ) : (
              <>
                <Link className="drawer-link" to="/login">Sign in</Link>
                <Link className="drawer-link" to="/account/create">Create account</Link>
              </>
            )}
          </nav>
        </>
      )}

      <main id="main">{children}</main>

      <footer className="footer">
        <div className="container">
          <div className="footer-grid">
            <div>
              <img className="footer-logo" src="/brand/logo.webp" alt="" />
              <p>Premium products, discreet packaging, fast delivery. Questions? Message us any time — we answer 24/7.</p>
            </div>
            <div>
              <h4>Shop</h4>
              <ul>
                <li><Link to="/s/fire-sale">Fire Sale</Link></li>
                {shelves.categories.slice(0, 5).map(c => <li key={c.slug}><Link to={`/s/${c.slug}`}>{c.name}</Link></li>)}
              </ul>
            </div>
            <div>
              <h4>Help</h4>
              <ul>
                <li><Link to={user ? '/account/messages' : '/login'}>Message the shop</Link></li>
                <li><Link to="/account/wallet">Add funds</Link></li>
                <li><Link to="/account/orders">Track an order</Link></li>
                {tgUser && <li><a href={`https://t.me/${tgUser}`} target="_blank" rel="noreferrer">Telegram</a></li>}
                {settings.signal_url && <li><a href={settings.signal_url} target="_blank" rel="noreferrer">Signal</a></li>}
              </ul>
            </div>
          </div>
          <p className="footer-legal">
            For adults 21+ only. Keep out of reach of children. © {new Date().getFullYear()} {settings.site_name || 'Captain Slabbin'}.
          </p>
        </div>
      </footer>

      <PromoPopup />

      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className="toast">
            <span>{t.message}</span>
            {t.action && <Link to={t.action.to}>{t.action.label}</Link>}
          </div>
        ))}
      </div>
    </div>
  )
}

// Shown once per browser session, like the original shop's offer pop-up
function PromoPopup() {
  const { settings } = useShop()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (settings.promo_enabled !== 'true' || !settings.promo_headline) return
    let seen = false
    try { seen = sessionStorage.getItem('cs_promo') === '1' } catch { /* storage blocked */ }
    if (seen) return
    const id = setTimeout(() => setOpen(true), 1500)
    return () => clearTimeout(id)
  }, [settings.promo_enabled, settings.promo_headline])

  function close() {
    setOpen(false)
    try { sessionStorage.setItem('cs_promo', '1') } catch { /* storage blocked */ }
  }

  if (!open) return null
  const tgUser = settings.telegram_username?.replace(/^@/, '')
  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-label="Special offer">
      <button className="modal-backdrop" aria-label="Close" onClick={close} />
      <div className="modal promo-box">
        <button className="icon-btn modal-close" aria-label="Close" onClick={close}><Icon.close /></button>
        <p className="promo-kicker">Don’t miss out</p>
        <p className="promo-line">Order online and save</p>
        <div className="promo-deal">
          <span className="promo-off">{settings.promo_headline.match(/\$\d+/)?.[0] || 'DEAL'} OFF</span>
          <span className="muted" style={{ fontSize: 13 }}>{settings.promo_headline}</span>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <Link to="/s/fire-sale" className="btn btn-red btn-block" onClick={close}>Shop the Fire Sale</Link>
          {tgUser && <a className="btn btn-outline btn-block" href={`https://t.me/${tgUser}`} target="_blank" rel="noreferrer" onClick={close}>Message us on Telegram</a>}
        </div>
      </div>
    </div>
  )
}
