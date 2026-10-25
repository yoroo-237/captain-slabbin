import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext.jsx'
import { isStaff } from '../../utils/roles.js'
import { useCart } from '../../context/CartContext.jsx'
import { apiFetch } from '../../utils/api.js'
import { useShop } from '../ShopContext.jsx'
import { Icon, Coin, money, productUrl, ProductImage } from '../lib.jsx'
import { createSmoke, PAGE_TIMING, fireBurst, smokePuff } from './smoke.js'

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Header (support strip, smoking logo, search, shelves nav, cart), mobile drawer,
// search sheet, burning footer, promo pop-up and toasts around every page.
// The header logo smokes constantly; the footer is on fire along its bottom
// edge, its smoke drifting up over the page; a click anywhere throws out fire
// or smoke. Kept to these two spots so the page doesn't feel overloaded.
//
// Page changes go through smoke: `target` is where the router is, `shown` what is
// on screen. When the path changes, a burst pours out of the logo's cigar, the new
// page is swapped in under the thickest smoke (onSwap) and the smoke lifts.
// Query-only changes (filters, pages of a shelf) swap at once.
export default function Layout({ children, shown, target, onSwap }) {
  const { settings, shelves, toasts } = useShop()
  const { user, balance, theme, toggleTheme } = useApp()
  const { itemCount } = useCart()
  const [drawer, setDrawer] = useState(false)
  const [searching, setSearching] = useState(false)
  const [unread, setUnread] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  const [settle, setSettle] = useState(0)
  const canvasRef = useRef(null)
  const smoke = useRef(null)

  // One smoke engine for the whole visit. Page and theme bursts pour from the
  // header logo, the first one in the page.
  useEffect(() => {
    if (reduceMotion() || !canvasRef.current) return
    smoke.current = createSmoke(canvasRef.current, {
      anchor: () => document.querySelectorAll('.cs [data-smoke-logo]'),
      fireEdge: () => document.querySelector('.cs [data-fire-edge]'),
      tone: theme === 'light' ? 'light' : 'dark',
    })
    return () => { smoke.current?.stop(); smoke.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { smoke.current?.setTone(theme === 'light' ? 'light' : 'dark') }, [theme])

  // While a burst covers the page the canvas goes above everything; the rest of
  // the time it sits under menus, sheets and dialogs
  function burst(opts) {
    const s = smoke.current
    canvasRef.current?.classList.add('covering')
    s.burst({
      timing: PAGE_TIMING, down: true, speed: 1.5,
      scale: Math.max(window.innerWidth, window.innerHeight) * 0.3,
      ...opts,
      onDone: () => { canvasRef.current?.classList.remove('covering'); opts.onDone?.() },
    })
  }

  // A click anywhere throws out fire or smoke (not while typing in a field)
  useEffect(() => {
    if (reduceMotion()) return
    const onDown = e => {
      if (e.button !== 0 || e.target.closest('input, textarea, select, [contenteditable]')) return
      const at = { x: e.clientX, y: e.clientY, size: 70 }
      if (Math.random() < 0.5) fireBurst(at)
      else smokePuff(at)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])

  // "/" opens the search from anywhere
  useEffect(() => {
    const onKey = e => {
      if (e.key !== '/' || e.target.closest?.('input, textarea, select, [contenteditable]')) return
      e.preventDefault()
      setSearching(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Sections marked .reveal rise into view as they are scrolled to
  useEffect(() => {
    const els = document.querySelectorAll('.cs .reveal:not(.in)')
    if (!('IntersectionObserver' in window) || reduceMotion()) { els.forEach(el => el.classList.add('in')); return }
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
    }, { rootMargin: '0px 0px -8% 0px' })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  })

  useEffect(() => {
    if (target.key === shown.key) return
    const s = smoke.current
    if (target.pathname === shown.pathname || !s) { onSwap(); return }
    if (s.busy) return // the running burst swaps to the latest page, or settle re-runs this
    burst({ onCover: onSwap, onDone: () => setSettle(n => n + 1) })
  }, [target, settle]) // eslint-disable-line react-hooks/exhaustive-deps

  // New page on screen: close menus and start at the top (under the smoke)
  useEffect(() => { setDrawer(false); setSearching(false); window.scrollTo(0, 0) }, [shown.pathname])

  // The theme switch is a smoke transition too
  function switchTheme() {
    const s = smoke.current
    if (!s || s.busy) { toggleTheme(); return }
    burst({ onCover: toggleTheme })
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Unread replies from the shop, shown on the account icon
  useEffect(() => {
    if (!user) { setUnread(0); return }
    const load = () => apiFetch('/messages/unread').then(d => setUnread(d.count)).catch(() => {})
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [user, shown.pathname])

  // Re-run the badge bump whenever the cart count goes up
  const [bump, setBump] = useState(false)
  const lastCount = useRef(itemCount)
  useEffect(() => {
    if (itemCount > lastCount.current) setBump(true)
    lastCount.current = itemCount
  }, [itemCount])

  const phone = settings.support_phone
  const tgUser = settings.telegram_username?.replace(/^@/, '')
  const shelfLinks = [
    { slug: 'fire-sale', name: 'Fire Sale', fire: true, children: [], count: shelves.fireSale || null },
    ...shelves.categories,
  ]
  const hasSticky = shown.pathname.startsWith('/p/')

  return (
    <div className={'cs' + (hasSticky ? ' has-sticky' : '')}>
      <a className="sr-only skip" href="#main">Skip to content</a>
      <canvas ref={canvasRef} className="page-smoke" aria-hidden="true" />

      <AnnouncementBar />

      <header className={'header' + (scrolled ? ' scrolled' : '')}>
        <div className="container header-row">
          <button className="icon-btn mobile-only" aria-label="Open menu" onClick={() => setDrawer(true)}><Icon.menu /></button>
          <Link to="/" className="header-brand" aria-label={`${settings.site_name || 'Captain Slabbin'}, home`}>
            <span className="header-logo">
              <img src="/brand/logo.webp" alt="" data-smoke-logo />
              <span className="ember" aria-hidden="true" />
            </span>
            <span className="brand-name">{settings.site_name || 'Captain Slabbin'}</span>
          </Link>
          <button className="header-search desktop-only" onClick={() => setSearching(true)}>
            <Icon.search /><span>Search products, strains, SKUs…</span><kbd>/</kbd>
          </button>
          <div className="header-right">
            <button className="icon-btn mobile-only" aria-label="Search products" onClick={() => setSearching(true)}><Icon.search /></button>
            {isStaff(user) && <Link to="/admin" className="btn btn-outline btn-sm staff-link desktop-only">Dashboard</Link>}
            {user && <BalanceChip />}
            <button className="icon-btn theme-btn desktop-only" onClick={switchTheme} aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
              <Icon.moon /><Icon.sun />
            </button>
            <Link to={user ? '/account' : '/login'} className="icon-btn" aria-label={user ? 'My account' : 'Sign in'}>
              <Icon.user />
              {unread > 0 && <span className="count">{unread}</span>}
            </Link>
            <Link to="/cart" className="icon-btn" aria-label={`Cart, ${itemCount} item${itemCount === 1 ? '' : 's'}`}>
              <Icon.bag />
              {itemCount > 0 && <span className={'count' + (bump ? ' bump' : '')} onAnimationEnd={() => setBump(false)}>{itemCount}</span>}
            </Link>
          </div>
        </div>
        <nav className="main-nav-row" aria-label="Shop">
          <ul className="main-nav">
            <li><NavLink to="/" end>Home</NavLink></li>
            {shelfLinks.map(s => (
              <li key={s.slug}>
                <NavLink to={`/s/${s.slug}`} className={({ isActive }) => (s.fire ? 'fire ' : '') + (isActive ? 'active' : '')}>
                  {s.fire && <Icon.fire />}{s.name}
                </NavLink>
                {s.children?.length > 0 && (
                  <ul className="nav-sub">
                    {s.children.map(c => <li key={c.slug}><Link to={`/s/${s.slug}?sub=${c.slug}`}>{c.name}<span className="muted">{c.count}</span></Link></li>)}
                  </ul>
                )}
              </li>
            ))}
            <li><NavLink to="/s/all">Shop all</NavLink></li>
            <li className="nav-aside"><NavLink to="/about">About</NavLink></li>
            {tgUser && <li><a href={`https://t.me/${tgUser}`} target="_blank" rel="noreferrer"><Icon.telegram /> Telegram</a></li>}
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
            <NavLink to="/" end className={({ isActive }) => 'drawer-link' + (isActive ? ' active' : '')}>Home</NavLink>
            {shelfLinks.map(s => (
              <div key={s.slug}>
                <NavLink to={`/s/${s.slug}`} className={({ isActive }) => 'drawer-link' + (s.fire ? ' fire' : '') + (isActive ? ' active' : '')}>
                  {s.name}{s.count != null && <span className="muted">{s.count}</span>}
                </NavLink>
                {s.children?.length > 0 && (
                  <div className="drawer-sub">
                    {s.children.map(c => <Link key={c.slug} className="drawer-link" to={`/s/${s.slug}?sub=${c.slug}`}>{c.name}</Link>)}
                  </div>
                )}
              </div>
            ))}
            <NavLink to="/s/all" className="drawer-link">Shop all</NavLink>
            <NavLink to="/about" className="drawer-link">About us</NavLink>
            <hr />
            {user ? (
              <>
                {isStaff(user) && <Link className="drawer-link staff-link" to="/admin">Admin dashboard</Link>}
                <Link className="drawer-link" to="/account">My account</Link>
                <Link className="drawer-link" to="/account/wallet">Wallet <span className="muted">{money(balance)}</span></Link>
                <Link className="drawer-link" to="/account/orders">Orders</Link>
                <Link className="drawer-link" to="/account/messages">Messages{unread > 0 && <span className="badge-count">{unread}</span>}</Link>
              </>
            ) : (
              <>
                <Link className="drawer-link" to="/login">Sign in</Link>
                <Link className="drawer-link" to="/account/create">Create account</Link>
              </>
            )}
            <div className="drawer-foot">
              <button className="btn btn-outline btn-block theme-btn" onClick={() => { setDrawer(false); switchTheme() }}>
                <Icon.moon /><Icon.sun /> {theme === 'light' ? 'Dark mode' : 'Light mode'}
              </button>
              {tgUser && <a className="btn btn-telegram btn-block" href={`https://t.me/${tgUser}`} target="_blank" rel="noreferrer"><Icon.telegram /> Message us</a>}
            </div>
          </nav>
        </>
      )}

      {searching && <SearchSheet onClose={() => setSearching(false)} />}

      <main id="main">{children}</main>

      <footer className="footer" data-fire-edge>
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand">
              <span className="footer-logo">
                <img src="/brand/logo.webp" alt="" />
              </span>
              <p>Premium products, discreet packaging, fast tracked shipping anywhere in the US. Questions? Text or message us any time. We answer 24/7.</p>
              <div className="footer-coins" aria-label="We accept Bitcoin, Litecoin, Dogecoin, Ethereum and Monero">
                {['BTC', 'LTC', 'DOGE', 'ETH', 'XMR'].map(c => <Coin key={c} currency={c} small />)}
              </div>
            </div>
            <div>
              <h4>Shop</h4>
              <ul>
                <li><Link to="/s/fire-sale">Fire Sale</Link></li>
                {shelves.categories.slice(0, 5).map(c => <li key={c.slug}><Link to={`/s/${c.slug}`}>{c.name}</Link></li>)}
                <li><Link to="/s/all">Shop all</Link></li>
              </ul>
            </div>
            <div>
              <h4>Account</h4>
              <ul>
                <li><Link to={user ? '/account' : '/login'}>{user ? 'My account' : 'Sign in'}</Link></li>
                <li><Link to="/account/wallet">Add funds</Link></li>
                <li><Link to="/account/orders">Track an order</Link></li>
                <li><Link to="/about">About us</Link></li>
              </ul>
            </div>
            <div>
              <h4>Contact</h4>
              <ShopContact />
            </div>
          </div>
          <div className="footer-legal">
            <span>For adults 21+ only. Keep out of reach of children and pets.</span>
            <span>© {new Date().getFullYear()} {settings.site_name || 'Captain Slabbin'}</span>
          </div>
        </div>
      </footer>

      <PromoPopup />

      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className="toast">
            <span className="ic"><Icon.check /></span>
            <span className="msg">{t.message}</span>
            {t.action && <Link to={t.action.to}>{t.action.label}</Link>}
          </div>
        ))}
      </div>
    </div>
  )
}

// The signed-in customer's balance, valued live. An arrow shows which way the
// market moved it at the last re-valuation (every 30s); a deposit or a purchase
// changes what is held, so it resets the arrow instead of counting as a move.
function BalanceChip() {
  const { balance, holdings } = useApp()
  const held = holdings.map(h => `${h.currency}:${h.amount}`).join('|')
  const last = useRef({ held, balance })
  const [trend, setTrend] = useState(null)
  const [flash, setFlash] = useState(0)
  useEffect(() => {
    const prev = last.current
    last.current = { held, balance }
    if (prev.held !== held) { setTrend(null); return }
    const delta = Math.round((balance - prev.balance) * 100) / 100
    if (!delta) return
    setTrend({ up: delta > 0, delta })
    setFlash(n => n + 1)
  }, [balance, held])
  return (
    <Link to="/account/wallet" className={'balance-chip' + (trend ? (trend.up ? ' up' : ' down') : '')} title="Live value of your crypto balance">
      <span className="dot" />
      <span className="amt" key={flash}>{money(balance)}</span>
      {trend && (
        <span className="trend" aria-label={`${trend.up ? 'Up' : 'Down'} ${money(Math.abs(trend.delta))} since the last update`}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{trend.up ? <path d="M12 5l7 9H5z" /> : <path d="M12 19l7-9H5z" />}</svg>
          <span className="d">{money(Math.abs(trend.delta))}</span>
        </span>
      )}
    </Link>
  )
}

// The shop's contact details and US location, from Admin → Settings
export function storeLocation(settings) {
  const cityLine = [settings.store_city, [settings.store_state, settings.store_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const full = [settings.store_address, cityLine].filter(Boolean).join(', ')
  return { cityLine, full, maps: full ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(full + ', USA')}` : null }
}

export function ShopContact() {
  const { settings } = useShop()
  const { user } = useApp()
  const phone = settings.support_phone
  const digits = phone?.replace(/[^\d+]/g, '')
  const tgUser = settings.telegram_username?.replace(/^@/, '')
  const loc = storeLocation(settings)
  return (
    <ul className="contact-list">
      {phone && <li><Icon.chat /><span><a href={`tel:${digits}`}>{phone}</a><small>Call or <a href={`sms:${digits}`}>text</a></small></span></li>}
      {settings.contact_email && <li><Icon.send /><a href={`mailto:${settings.contact_email}`}>{settings.contact_email}</a></li>}
      {tgUser && <li><Icon.telegram /><a href={`https://t.me/${tgUser}`} target="_blank" rel="noreferrer">@{tgUser}</a></li>}
      <li><Icon.pin /><span>
        {loc.full
          ? <>{settings.store_address && <>{settings.store_address}<br /></>}{loc.cityLine}<small><a href={loc.maps} target="_blank" rel="noreferrer">Get directions</a></small></>
          : 'Ships nationwide from the USA'}
      </span></li>
      {settings.store_hours && <li><Icon.clock /><span>{settings.store_hours}</span></li>}
      <li><Icon.box /><Link to={user ? '/account/messages' : '/login'}>Message the shop</Link></li>
    </ul>
  )
}

// The rotating announcement bar above the header. Messages come from Admin →
// Settings (one per line), else from the shop's own numbers.
function AnnouncementBar() {
  const { settings, shelves } = useShop()
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const freeAt = Number(settings.shipping_free_threshold || 0)
  const custom = (settings.announcements || '').split('\n').map(l => l.trim()).filter(Boolean).map(text => ({ text }))
  const msgs = custom.length ? custom : [
    shelves.fireSale > 0 && { text: `Fire Sale: ${shelves.fireSale} deals live now`, to: '/s/fire-sale', cta: 'Shop now' },
    freeAt > 0 && { text: `Free shipping on orders over ${money(freeAt)}` },
    { text: 'Pay with BTC, LTC, ETH, DOGE or XMR. Invoice straight to Telegram' },
    settings.support_phone && { text: `Questions? Text us 24/7 at ${settings.support_phone}`, href: `sms:${settings.support_phone.replace(/[^\d+]/g, '')}` },
  ].filter(Boolean)

  useEffect(() => {
    if (paused || msgs.length < 2) return
    const id = setInterval(() => setI(n => (n + 1) % msgs.length), 4200)
    return () => clearInterval(id)
  }, [paused, msgs.length])

  if (!msgs.length) return null
  const m = msgs[i % msgs.length]
  const body = <>{m.text}{m.cta && <b>{m.cta} <Icon.arrow /></b>}</>
  return (
    <div className="annc" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} aria-live="polite">
      {msgs.length > 1 && <button type="button" className="annc-nav" aria-label="Previous announcement" onClick={() => setI(n => (n - 1 + msgs.length) % msgs.length)}><Icon.chevL /></button>}
      <div className="annc-msg" key={i}>
        {m.to ? <Link to={m.to}>{body}</Link> : m.href ? <a href={m.href}>{body}</a> : <span>{body}</span>}
      </div>
      {msgs.length > 1 && <button type="button" className="annc-nav" aria-label="Next announcement" onClick={() => setI(n => (n + 1) % msgs.length)}><Icon.chevR /></button>}
    </div>
  )
}

// Search from anywhere: live results while typing, Enter for the full list
function SearchSheet({ onClose }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState(null)

  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setHits(null); return }
    let live = true
    const id = setTimeout(() => {
      apiFetch(`/products?search=${encodeURIComponent(term)}&limit=6`)
        .then(d => live && setHits(d.products || []))
        .catch(() => live && setHits([]))
    }, 220)
    return () => { live = false; clearTimeout(id) }
  }, [q])

  function submit(e) {
    e.preventDefault()
    if (!q.trim()) return
    navigate(`/s/all?q=${encodeURIComponent(q.trim())}`)
    onClose()
  }

  return (
    <>
      <button className="drawer-backdrop" aria-label="Close search" onClick={onClose} />
      <div className="search-sheet" role="dialog" aria-modal="true" aria-label="Search">
        <form onSubmit={submit}>
          <div className="search-box">
            <Icon.search />
            <input className="input" type="search" autoFocus placeholder="Search products, strains, SKUs…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search products" />
          </div>
          <button type="button" className="icon-btn" aria-label="Close search" onClick={onClose}><Icon.close /></button>
        </form>
        {hits && (
          <div className="search-results">
            {hits.length === 0 ? <p className="search-empty">No matches for “{q.trim()}”. Try a shorter word.</p> : (
              <>
                {hits.map(p => (
                  <Link key={p.id} to={productUrl(p)} className="search-hit" onClick={onClose}>
                    <span className="thumb"><ProductImage product={p} /></span>
                    <span><span className="nm">{p.name}</span><br /><span className="ct">{p.category?.name}</span></span>
                    <span className="pr">{money(p.price)}</span>
                  </Link>
                ))}
                <button type="button" className="btn btn-outline btn-block" style={{ marginTop: 8 }} onClick={submit}>See all results <Icon.arrow /></button>
              </>
            )}
          </div>
        )}
      </div>
    </>
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
    const id = setTimeout(() => setOpen(true), 2500)
    return () => clearTimeout(id)
  }, [settings.promo_enabled, settings.promo_headline])

  function close() {
    setOpen(false)
    try { sessionStorage.setItem('cs_promo', '1') } catch { /* storage blocked */ }
  }

  if (!open) return null
  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-label="Special offer">
      <button className="modal-backdrop" aria-label="Close" onClick={close} />
      <div className="modal promo-box">
        <button className="icon-btn modal-close" aria-label="Close" onClick={close}><Icon.close /></button>
        <img className="promo-logo" src="/brand/logo.webp" alt="" />
        <p className="promo-kicker">Don’t miss out</p>
        <p className="promo-line display">Order online &amp; save</p>
        <div className="promo-deal">
          <span className="promo-off">{settings.promo_headline.match(/\$\d+/)?.[0] || 'DEAL'} OFF</span>
          <span className="muted" style={{ fontSize: 13 }}>{settings.promo_headline}</span>
        </div>
        <Link to="/s/fire-sale" className="btn btn-red btn-block btn-lg" onClick={close}><Icon.fire /> Shop the Fire Sale</Link>
      </div>
    </div>
  )
}
