import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { useShop } from '../ShopContext.jsx'
import ProductCard, { CardSkeleton } from '../components/ProductCard.jsx'
import { AboutTeaser, ContactSection } from '../components/AboutBits.jsx'
import Testimonials from '../components/Testimonials.jsx'
import { Icon, Coin, money, salePct, productUrl } from '../lib.jsx'
import { reduceMotion, useScrollVar, Split, CountUp, magnetic, unmagnetic } from '../motion.jsx'

export default function HomePage() {
  const { shelves, settings } = useShop()
  const [featured, setFeatured] = useState(null)
  const [deals, setDeals] = useState([])
  const heroRef = useRef(null)
  const stageRef = useRef(null)
  const railRef = useRef(null)
  const trackRef = useRef(null)
  const stepsRef = useRef(null)

  useEffect(() => {
    apiFetch('/products?sort=featured&limit=8').then(d => setFeatured(d.products)).catch(() => setFeatured([]))
    apiFetch('/products?category=fire-sale&limit=12').then(d => setDeals(d.products || [])).catch(() => {})
  }, [])

  useScrollVar(heroRef)
  useScrollVar(railRef)
  useScrollVar(stepsRef, 'pass')

  // Steps light up one after another as they come into view
  useEffect(() => {
    const el = stepsRef.current
    if (!el) return
    const items = el.querySelectorAll('li')
    if (!('IntersectionObserver' in window) || reduceMotion()) { items.forEach(li => li.classList.add('lit')); return }
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('lit'); io.unobserve(e.target) }
    }, { rootMargin: '0px 0px -20% 0px' })
    items.forEach(li => io.observe(li))
    return () => io.disconnect()
  }, [])

  // The logo follows the pointer in 3D
  useEffect(() => {
    const el = stageRef.current
    if (!el || reduceMotion()) return
    let raf = 0, mx = 0, my = 0
    const onMove = e => {
      mx = e.clientX / window.innerWidth - 0.5
      my = e.clientY / window.innerHeight - 0.5
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; el.style.setProperty('--mx', mx.toFixed(3)); el.style.setProperty('--my', my.toFixed(3)) })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove) }
  }, [])

  // Desktop: the category rail scrolls sideways as the page scrolls down, so
  // its section is as tall as the rail is wide
  // Once the admin has given the categories their banners (Admin → Categories),
  // the home shows them stacked like the original shop instead of the rail
  const bannerMode = shelves.categories.some(c => c.imageUrl)
  const tiles = [{ slug: 'fire-sale', name: 'Fire Sale', count: shelves.fireSale, fire: true }, ...shelves.categories]
  useLayoutEffect(() => {
    const sec = railRef.current, track = trackRef.current
    if (!sec || !track) return
    const size = () => {
      const wide = window.innerWidth >= 960 && !reduceMotion()
      const extra = Math.max(0, track.scrollWidth - window.innerWidth)
      sec.style.height = wide ? `${window.innerHeight + extra}px` : ''
      sec.style.setProperty('--shift', `${-extra}px`)
    }
    size()
    window.addEventListener('resize', size)
    return () => window.removeEventListener('resize', size)
  }, [tiles.length, bannerMode])

  // Ad banner: the admin's lines, else the live Fire Sale deals
  const adLines = (settings.ad_banner || '').split('\n').map(l => l.trim()).filter(Boolean)
  const ads = adLines.length
    ? adLines.map(text => ({ text, to: '/s/fire-sale' }))
    : deals.map(p => ({ text: p.name, tag: `−${salePct(p)}%`, price: money(p.price), to: productUrl(p) }))
  const total = shelves.categories.reduce((s, c) => s + c.count, 0)
  const phone = settings.support_phone
  const freeAt = Number(settings.shipping_free_threshold || 0)

  return (
    <>
      <section className="hx" ref={heroRef}>
        <div className="hx-stage" ref={stageRef}>
          <div className="hx-words" aria-hidden="true">
            <span className="hx-word a">Captain</span>
            <span className="hx-word b">Slabbin</span>
          </div>
          <div className="hx-logo">
            <div className="hx-logo-tilt">
              <img src="/brand/logo.webp" alt="" />
            </div>
          </div>
          <div className="container hx-copy">
            <h1 className="display">
              <Split text="Top shelf." delay={0.2} />
              <Split text="Delivered." delay={0.55} className="blood-text" />
            </h1>
            <p className="lead">Hand-picked flower, concentrates, edibles and more. Pay with crypto in one tap and your invoice goes straight to the shop on Telegram.</p>
            <div className="hero-cta">
              <Link to="/s/fire-sale" className="btn btn-primary btn-lg magnet" onPointerMove={magnetic} onPointerLeave={unmagnetic}><Icon.fire /> Shop the Fire Sale</Link>
              <Link to="/s/all" className="btn btn-outline btn-lg magnet" onPointerMove={magnetic} onPointerLeave={unmagnetic}>Shop all products</Link>
            </div>
          </div>
        </div>
      </section>

      {bannerMode && (
        <section className="banners" aria-label="Shop by category">
          <div className="container banners-in">
            {shelves.fireSale > 0 && (
              <Link to="/s/fire-sale" className="banner banner-text fire" style={{ '--i': 0 }}>
                <span className="display"><Icon.fire /> Fire Sale</span><small>{shelves.fireSale} deals this week</small>
              </Link>
            )}
            {shelves.categories.map((c, i) => (
              <Link key={c.slug} to={`/s/${c.slug}`} className={'banner' + (c.imageUrl ? '' : ' banner-text')} style={{ '--i': i + 1 }} aria-label={c.name}>
                {c.imageUrl
                  ? <img src={c.imageUrl} alt={c.name} loading={i < 4 ? 'eager' : 'lazy'} decoding="async" />
                  : <><span className="display">{c.name}</span><small>{c.count ? `${c.count} item${c.count === 1 ? '' : 's'}` : 'Coming soon'}</small></>}
              </Link>
            ))}
            {(phone || settings.signal_url) && (
              <div className="banners-cta">
                {phone && <a className="btn btn-light" href={`sms:${phone.replace(/[^\d+]/g, '')}`}>Text us</a>}
                {settings.signal_url && <a className="btn btn-outline" href={settings.signal_url} target="_blank" rel="noreferrer">Join Signal</a>}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="stat-band" aria-label="The shop in numbers">
        <div className="container stat-band-in">
          {total > 0 && <div className="sb reveal"><CountUp to={total} /><span>products in stock</span></div>}
          {shelves.fireSale > 0 && <div className="sb reveal"><CountUp to={shelves.fireSale} /><span>deals in the Fire Sale</span></div>}
          {freeAt > 0 && <div className="sb reveal"><CountUp to={freeAt} format={n => money(n).replace('.00', '')} /><span>for free shipping</span></div>}
          <div className="sb reveal"><b>5</b><span>cryptos accepted</span></div>
          <div className="sb reveal"><b>24/7</b><span>support by text</span></div>
        </div>
      </section>

      {ads.length > 0 && (
        <section className="ad-bands" aria-label="Deals">
          <div className="ad-band red">
            <div className="ad-track">
              {[0, 1].map(copy => (
                <div className="ad-run" key={copy} aria-hidden={copy === 1}>
                  {ads.map((a, k) => (
                    <Link key={k} to={a.to} className="ad-item" tabIndex={copy ? -1 : 0}>
                      <Icon.fire />{a.tag && <b>{a.tag}</b>}<span>{a.text}</span>{a.price && <em>{a.price}</em>}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="ad-band dark" aria-hidden="true">
            <div className="ad-track rev">
              {[0, 1].map(copy => (
                <div className="ad-run" key={copy}>
                  {['Fire Sale', 'Top shelf', 'Discreet shipping', 'Crypto checkout', 'Invoice on Telegram', '21+ only'].map(w => <span key={w} className="ad-word">{w}</span>)}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {!bannerMode && <section className="rail" ref={railRef} aria-label="Shop by category">
        <div className="rail-stage">
          <div className="container rail-head">
            <h2>Shop by category</h2>
            <Link to="/s/all" className="see-all">Shop all <Icon.arrow /></Link>
          </div>
          <div className="rail-track" ref={trackRef}>
            {tiles.map((c, i) => (
              <Link key={c.slug} to={`/s/${c.slug}`} className={'rail-tile' + (c.fire ? ' fire' : '') + (c.imageUrl ? ' has-img' : '')} style={{ '--i': i }}>
                {c.imageUrl && <img src={c.imageUrl} alt="" loading="lazy" decoding="async" />}
                <span className="rail-n">{c.count ? `${c.count} item${c.count === 1 ? '' : 's'}` : c.fire ? 'Weekly deals' : 'Coming soon'}</span>
                <span className="rail-name display">{c.fire && <Icon.fire />}{c.name}</span>
                <span className="rail-go" aria-hidden="true"><Icon.arrow /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>}

      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2>Captain’s picks</h2>
            <Link to="/s/all" className="see-all">See all <Icon.arrow /></Link>
          </div>
          {featured === null ? (
            <div className="grid">{Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} />)}</div>
          ) : featured.length ? (
            <div className="grid">{featured.map(p => <ProductCard key={p.id} product={p} />)}</div>
          ) : (
            <p className="muted">Nothing on the shelves yet. Check back soon.</p>
          )}
        </div>
      </section>

      <section className="section how-sec">
        <div className="container">
          <div className="section-head">
            <div>
              <h2>How ordering works</h2>
              <p className="muted" style={{ marginTop: 6 }}>Three steps, about two minutes. Nothing to fill in but a username.</p>
            </div>
            <Link to="/s/all" className="see-all">Start shopping <Icon.arrow /></Link>
          </div>
          <ol className="how2" ref={stepsRef}>
            <li style={{ '--at': 0.1 }}>
              <div className="how2-art art-cart" aria-hidden="true">
                <span className="drop d1" /><span className="drop d2" /><span className="drop d3" />
                <span className="bag"><Icon.bag /></span>
              </div>
              <span className="how2-step">Step 1</span>
              <h3>Fill your cart</h3>
              <p>Browse the shelves, filter by price and add what you like. Your cart is saved on this device.</p>
              <ul className="how2-chips"><li>No email needed</li><li>Account at checkout</li></ul>
            </li>
            <li style={{ '--at': 0.42 }}>
              <div className="how2-art art-coins" aria-hidden="true">
                {['BTC', 'LTC', 'ETH', 'DOGE', 'XMR'].map((c, k) => <span key={c} className="coin-fly" style={{ '--k': k }}><Coin currency={c} /></span>)}
              </div>
              <span className="how2-step">Step 2</span>
              <h3>Pay with crypto</h3>
              <p>Add funds to your wallet, then pay in one tap. The price is converted and locked the moment you order.</p>
              <ul className="how2-chips"><li>Price locked</li><li>5 coins accepted</li></ul>
            </li>
            <li style={{ '--at': 0.74 }}>
              <div className="how2-art art-plane" aria-hidden="true">
                <svg className="trail" viewBox="0 0 220 90" preserveAspectRatio="none"><path d="M6 78 C 60 70, 90 20, 150 30 S 205 20, 214 12" /></svg>
                <span className="plane"><Icon.telegram /></span>
              </div>
              <span className="how2-step">Step 3</span>
              <h3>Invoice on Telegram</h3>
              <p>Your paid invoice goes to the shop on Telegram. Choose delivery to a US address, or arrange it there.</p>
              <ul className="how2-chips"><li>Discreet packaging</li><li>Tracked shipping</li></ul>
            </li>
          </ol>
        </div>
      </section>

      <Testimonials />

      <AboutTeaser />

      <ContactSection />
    </>
  )
}
