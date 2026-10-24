import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { useShop } from '../ShopContext.jsx'
import ProductCard from '../components/ProductCard.jsx'
import { Icon } from '../lib.jsx'

// Metal plates when a shelf has no banner image yet
const PLATE_TINTS = ['#8fa3b1', '#a81f1a', '#4f8f6a', '#7d64b8', '#c8963c', '#3c7fc8', '#b8487d', '#c6d2db']

function ShelfPlate({ to, name, meta, image, tint, fire }) {
  return (
    <Link to={to} className={'category-card' + (fire ? ' fire' : '')}>
      {image ? <img src={image} alt={name} width="740" height="225" decoding="async" /> : (
        <>
          <div className="plate-art" style={{ background: `radial-gradient(120% 140% at 85% 20%, ${tint}55, transparent 60%), linear-gradient(115deg, #0c0e11 30%, ${tint}22)` }} />
          <div className="plate-label">
            <span className="name frost-head">{name}</span>
            <span className="meta">{meta}</span>
          </div>
        </>
      )}
    </Link>
  )
}

export default function HomePage() {
  const { shelves, settings } = useShop()
  const [featured, setFeatured] = useState(null)

  useEffect(() => {
    apiFetch('/products?sort=featured&limit=8').then(d => setFeatured(d.products)).catch(() => setFeatured([]))
  }, [])

  const tgUser = settings.telegram_username?.replace(/^@/, '')
  const total = shelves.categories.reduce((s, c) => s + c.count, 0)

  return (
    <>
      <section className="hero container">
        <h1 className="frost-head">Top shelf. Delivered.</h1>
        <p>{total ? `${total} products in stock` : 'Fresh drops every week'} — pay with crypto from your wallet in seconds, or send your order to us on Telegram.</p>
        <div className="hero-cta">
          <Link to="/s/fire-sale" className="btn btn-red">Shop the Fire Sale</Link>
          <Link to="/s/flower" className="btn btn-outline">Browse flower</Link>
        </div>
        <div className="trust-row">
          <div className="trust"><Icon.truck /><div><b>Fast, discreet shipping</b><span>Tracked to your door</span></div></div>
          <div className="trust"><Icon.bolt /><div><b>Instant checkout</b><span>Pay from your crypto wallet</span></div></div>
          <div className="trust"><Icon.chat /><div><b>24/7 support</b><span>Message us any time</span></div></div>
          <div className="trust"><Icon.shield /><div><b>No account needed</b><span>to browse or order on Telegram</span></div></div>
        </div>
      </section>

      <section className="section section--tight">
        <div className="container">
          <div className="category-grid">
            {shelves.fireSale > 0 && (
              <ShelfPlate to="/s/fire-sale" name="Fire Sale" meta={`${shelves.fireSale} marked down today`} tint="#a81f1a" fire />
            )}
            {shelves.categories.map((c, i) => (
              <ShelfPlate key={c.slug} to={`/s/${c.slug}`} name={c.name} image={c.imageUrl}
                meta={c.count ? `${c.count} item${c.count === 1 ? '' : 's'}` : 'Coming soon'} tint={PLATE_TINTS[(i + 1) % PLATE_TINTS.length]} />
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2 className="frost-head">Captain’s picks</h2>
            <Link to="/s/flower" className="btn-plain">See all</Link>
          </div>
          {featured === null ? (
            <div className="grid">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ aspectRatio: '3 / 4' }} />)}</div>
          ) : featured.length ? (
            <div className="grid">{featured.map(p => <ProductCard key={p.id} product={p} />)}</div>
          ) : (
            <p className="muted">Nothing on the shelves yet — check back soon.</p>
          )}

          <div className="cta-band">
            <div>
              <h2 className="frost-head" style={{ fontSize: 20 }}>Rather order by message?</h2>
              <p className="muted" style={{ marginTop: 6 }}>Fill your bag, then send the order to us on Telegram — no account needed.</p>
            </div>
            <div className="actions">
              <Link to="/cart" className="btn btn-primary">Go to bag</Link>
              {tgUser && <a className="btn btn-telegram" href={`https://t.me/${tgUser}`} target="_blank" rel="noreferrer">Text us on Telegram</a>}
              {settings.signal_url && <a className="btn btn-outline" href={settings.signal_url} target="_blank" rel="noreferrer">Join Signal</a>}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
