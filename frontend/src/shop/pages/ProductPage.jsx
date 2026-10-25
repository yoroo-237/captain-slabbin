import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { useCart } from '../../context/CartContext.jsx'
import { useShop } from '../ShopContext.jsx'
import { useSeo } from '../seo.js'
import ProductCard, { toCartItem } from '../components/ProductCard.jsx'
import { Icon, money, isOnSale, isVideo, productMedia, salePct, ProductArt, Stars, fmtDate } from '../lib.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { smokePuff } from '../components/smoke.js'

// /p/:sku — gallery of photos and videos (swipe, arrows, thumbnails, lightbox for
// photos), price, stock meter, quantity and add to cart.
// On phones a buy bar slides up once the main button scrolls out of view.
export default function ProductPage() {
  const { sku } = useParams()
  const { addItem, items } = useCart()
  const { toast, settings } = useShop()
  const [product, setProduct] = useState(null)
  const [related, setRelated] = useState([])
  const [error, setError] = useState('')
  const [index, setIndex] = useState(0)
  const [zoom, setZoom] = useState(false)
  // Members-only page: named in the tab, never indexed
  useSeo({ title: product?.name || 'Product', noindex: true })
  const [qty, setQty] = useState(1)
  const [buyHidden, setBuyHidden] = useState(false)
  const buyRef = useRef(null)
  const touch = useRef(null)

  useEffect(() => {
    let live = true
    setProduct(null); setError(''); setIndex(0); setQty(1)
    apiFetch(`/products/${encodeURIComponent(sku)}`)
      .then(p => { if (live) { setProduct(p); document.title = `${p.name} · Captain Slabbin` } })
      .catch(e => live && setError(e.message))
    apiFetch(`/products/${encodeURIComponent(sku)}/related`).then(r => live && setRelated(r)).catch(() => {})
    return () => { live = false; document.title = 'Captain Slabbin' }
  }, [sku])

  const media = productMedia(product)
  const current = media[index]
  const go = d => setIndex(i => (i + d + media.length) % media.length)

  useEffect(() => {
    if (!zoom) return
    const onKey = e => {
      if (e.key === 'Escape') setZoom(false)
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, media.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = buyRef.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([e]) => setBuyHidden(!e.isIntersecting && e.boundingClientRect.top < 0))
    io.observe(el)
    return () => io.disconnect()
  }, [product])

  if (error) {
    return (
      <div className="container empty">
        <span className="ic"><Icon.box /></span>
        <h2>This product is no longer listed</h2>
        <p>It may have sold out or moved shelves.</p>
        <div className="hero-cta"><Link to="/s/all" className="btn btn-primary">Shop all products</Link></div>
      </div>
    )
  }
  if (!product) {
    return (
      <div className="container product-layout" aria-busy="true">
        <div className="skeleton" style={{ aspectRatio: '1' }} />
        <div className="stack">
          <div className="skeleton" style={{ height: 14, width: '30%' }} />
          <div className="skeleton" style={{ height: 56, width: '80%' }} />
          <div className="skeleton" style={{ height: 40, width: '40%' }} />
          <div className="skeleton" style={{ height: 48 }} />
        </div>
      </div>
    )
  }

  const sale = isOnSale(product)
  const inCart = items.find(i => i.id === product.id)?.quantity || 0
  const left = product.stock - inCart
  const soldOut = product.stock <= 0
  const low = product.stock > 0 && product.stock <= 10
  const parent = product.category?.parent
  const shelf = parent || product.category
  const freeAt = Number(settings.shipping_free_threshold || 0)

  function add(e) {
    const n = Math.min(qty, left)
    if (n <= 0) { toast(`All ${product.stock} available are already in your cart.`); return }
    addItem(toCartItem(product), n)
    smokePuff(e?.currentTarget, 90)
    toast(`${n} × ${product.name} added to your cart`, { to: '/cart', label: 'View cart' })
    setQty(1)
  }

  const step = d => setQty(q => Math.max(1, Math.min(Math.max(1, left), q + d)))
  const onTouchStart = e => { touch.current = e.touches[0].clientX }
  const onTouchEnd = e => {
    if (touch.current == null || media.length < 2) return
    const dx = e.changedTouches[0].clientX - touch.current
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
    touch.current = null
  }

  return (
    <>
      <div className="container">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link><span className="sep">/</span>
          {parent && <><Link to={`/s/${parent.slug}`}>{parent.name}</Link><span className="sep">/</span></>}
          {product.category && <><Link to={parent ? `/s/${parent.slug}?sub=${product.category.slug}` : `/s/${product.category.slug}`}>{product.category.name}</Link><span className="sep">/</span></>}
          <span className="current">{product.name}</span>
        </nav>

        <section className="product-layout">
          <div className="product-gallery">
            <div className="gallery-frame" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              <div className="card-tags">
                {sale && <span className="tag tag-sale">−{salePct(product)}%</span>}
                {product.badge && <span className="tag">{product.badge}</span>}
                {soldOut && <span className="tag tag-out">Sold out</span>}
              </div>
              {!current ? <ProductArt /> : isVideo(current) ? (
                <video key={current.id} src={current.url} poster={current.thumbnail || undefined} controls playsInline muted autoPlay loop preload="metadata" aria-label={`${product.name}, video`} />
              ) : (
                <img key={current.id} src={current.url} alt={`${product.name}, photo ${index + 1}`} onClick={() => setZoom(true)} />
              )}
              {current && !isVideo(current) && <button type="button" className="gallery-zoom" aria-label="Enlarge photo" onClick={() => setZoom(true)}><Icon.zoom /></button>}
              {media.length > 1 && (
                <>
                  <button type="button" className="gallery-nav gallery-nav--prev" aria-label="Previous" onClick={() => go(-1)}><Icon.chevL /></button>
                  <button type="button" className="gallery-nav gallery-nav--next" aria-label="Next" onClick={() => go(1)}><Icon.chevR /></button>
                  <span className="gallery-count">{index + 1} / {media.length}</span>
                </>
              )}
            </div>
            {media.length > 1 && (
              <div className="gallery-thumbs">
                {media.map((m, i) => (
                  <button key={m.id} type="button" className={i === index ? 'active' : ''} onClick={() => setIndex(i)} aria-label={`${isVideo(m) ? 'Video' : 'Photo'} ${i + 1}`}>
                    {isVideo(m) && !m.thumbnail
                      ? <video src={m.url} muted playsInline preload="metadata" />
                      : <img src={m.thumbnail || m.url} alt="" decoding="async" />}
                    {isVideo(m) && <span className="media-badge"><Icon.play /></span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="product-info">
            <div>
              {product.category && <Link className="product-cat" to={parent ? `/s/${parent.slug}?sub=${product.category.slug}` : `/s/${product.category.slug}`}>{product.category.name}</Link>}
              <h1 className="product-title">{product.name}</h1>
              {product.sku && <div className="sku" style={{ marginTop: 8 }}>SKU {product.sku}</div>}
            </div>

            <div className="price-block">
              <div className={'price-big' + (sale ? ' sale' : '')}>
                <span>{money(product.price)}</span>
                {sale && <span className="was">{money(product.compareAtPrice)}</span>}
                {product.unitLabel && <span className="unit">{product.unitLabel}</span>}
              </div>
              {sale && <span className="save-pill"><Icon.tag /> You save {money(product.compareAtPrice - product.price)}</span>}
              <div className="stock-meter">
                <div className="stock-meter-track">
                  <div className={'stock-meter-fill' + (low ? ' low' : '')} style={{ width: `${soldOut ? 0 : Math.min(100, Math.max(8, product.stock))}%` }} />
                </div>
                <div className="stock-meter-label">
                  <span className={'live-dot' + (soldOut ? ' off' : low ? ' warn' : '')} />
                  {soldOut ? 'Sold out. Message us to be notified when it’s back' : low ? `Only ${product.stock} left, order soon` : 'In stock · ships in 1–2 business days'}
                </div>
              </div>
            </div>

            <div className="buy-row" ref={buyRef}>
              <div className="qty-box">
                <button type="button" aria-label="Decrease quantity" onClick={() => step(-1)} disabled={soldOut || qty <= 1}><Icon.minus /></button>
                <input type="text" inputMode="numeric" value={qty} readOnly aria-label="Quantity" />
                <button type="button" aria-label="Increase quantity" onClick={() => step(1)} disabled={soldOut || qty >= left}><Icon.plus /></button>
              </div>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={add} disabled={soldOut || left <= 0}>
                {soldOut ? 'Sold out' : <><Icon.bag /> Add to cart · {money(product.price * qty)}</>}
              </button>
            </div>
            {inCart > 0 && <p className="muted" style={{ fontSize: 13, marginTop: -6 }}><Icon.check /> {inCart} in your cart · <Link to="/cart" className="link">Check out</Link></p>}
            {soldOut && <Link to="/account/messages" className="btn btn-outline btn-block"><Icon.chat /> Ask about restock</Link>}

            {product.description && <p className="product-desc">{product.description}</p>}

            <div className="perks">
              <div><Icon.truck /> Discreet, unmarked packaging · tracked shipping{freeAt > 0 ? ` · free over ${money(freeAt)}` : ''}</div>
              <div><Icon.bolt /> Pay in one tap with crypto from your wallet</div>
              <div><Icon.telegram /> Your paid invoice goes to us on Telegram automatically</div>
              <div><Icon.chat /> Questions? <Link to="/account/messages" className="link" style={{ marginLeft: 4 }}>Message the shop</Link></div>
            </div>
          </div>
        </section>

        <ProductReviews productId={product.id} />

        {related.length > 0 && (
          <section className="section">
            <div className="section-head">
              <h2>You may also like</h2>
              {shelf && <Link to={`/s/${shelf.slug}`} className="see-all">See all <Icon.arrow /></Link>}
            </div>
            <div className="grid">{related.map(p => <ProductCard key={p.id} product={p} />)}</div>
          </section>
        )}
      </div>

      {!soldOut && (
        <div className={'sticky-buy' + (buyHidden ? ' show' : '')} aria-hidden={!buyHidden}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="p">{money(product.price)}</div>
            <div className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{product.name}</div>
          </div>
          <button className="btn btn-primary" onClick={add} disabled={left <= 0} tabIndex={buyHidden ? 0 : -1}><Icon.bag /> Add to cart</button>
        </div>
      )}

      {zoom && current && !isVideo(current) && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Enlarged photo">
          <button type="button" className="lightbox-backdrop" aria-label="Close" onClick={() => setZoom(false)} />
          <img src={current.url} alt={product.name} />
          <button type="button" className="lightbox-close" aria-label="Close" onClick={() => setZoom(false)}><Icon.close /></button>
        </div>
      )}
    </>
  )
}

// Approved reviews with the average; customers who bought the product can add
// one (shown once staff approve it)
function ProductReviews({ productId }) {
  const { user } = useApp()
  const [data, setData] = useState(null)
  const [can, setCan] = useState(null)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch(`/reviews/product/${productId}`).then(setData).catch(() => setData({ reviews: [], count: 0 }))
    if (user) apiFetch(`/reviews/can/${productId}`).then(setCan).catch(() => {})
  }, [productId, user])

  async function submit(e) {
    e.preventDefault()
    if (!rating) { setError('Choose a star rating.'); return }
    setError('')
    try {
      await apiFetch('/reviews', { method: 'POST', body: JSON.stringify({ productId, rating, comment }) })
      setSent(true)
    } catch (err) { setError(err.message) }
  }

  if (!data) return null
  return (
    <section className="section reviews" aria-label="Customer reviews">
      <div className="section-head">
        <div>
          <h2>Customer reviews</h2>
          {data.count > 0
            ? <p className="muted testi-sum"><Stars value={data.average} /> {Number(data.average).toFixed(1)} out of 5 · {data.count} review{data.count === 1 ? '' : 's'}</p>
            : <p className="muted">No reviews yet. Reviews come from verified buyers only.</p>}
        </div>
      </div>
      <div className="reviews-grid">
        {data.reviews.map(r => (
          <figure key={r.id} className="testi-card reveal">
            <Stars value={r.rating} />
            {r.comment && <blockquote>{r.comment}</blockquote>}
            <figcaption><b>{r.author}</b><span>Verified buyer · {fmtDate(r.createdAt)}</span></figcaption>
          </figure>
        ))}
        {sent ? (
          <div className="review-form panel"><Icon.check /> Thanks! Your review will appear once the shop approves it.</div>
        ) : can?.canReview ? (
          <form className="review-form panel" onSubmit={submit}>
            <b>Review this product</b>
            <Stars value={rating} onChange={setRating} size={26} />
            <textarea className="textarea" rows={3} maxLength={800} placeholder="How was it? (optional)" value={comment} onChange={e => setComment(e.target.value)} />
            {error && <span className="error" style={{ color: 'var(--red-text)', fontSize: 13 }}>{error}</span>}
            <button className="btn btn-primary">Post review</button>
          </form>
        ) : can?.reviewed ? (
          <div className="review-form panel muted">{can.approved ? 'Thanks for your review.' : 'Your review is waiting for approval.'}</div>
        ) : null}
      </div>
    </section>
  )
}
