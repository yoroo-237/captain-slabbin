import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { useCart } from '../../context/CartContext.jsx'
import { useShop } from '../ShopContext.jsx'
import ProductCard, { toCartItem } from '../components/ProductCard.jsx'
import { Icon, money, isOnSale, ProductArt } from '../lib.jsx'

// /p/:sku — gallery with lightbox, price, stock meter, quantity and add to bag
export default function ProductPage() {
  const { sku } = useParams()
  const { addItem, items } = useCart()
  const { toast } = useShop()
  const [product, setProduct] = useState(null)
  const [related, setRelated] = useState([])
  const [error, setError] = useState('')
  const [index, setIndex] = useState(0)
  const [zoom, setZoom] = useState(false)
  const [qty, setQty] = useState(1)

  useEffect(() => {
    let live = true
    setProduct(null); setError(''); setIndex(0); setQty(1)
    apiFetch(`/products/${encodeURIComponent(sku)}`)
      .then(p => { if (live) { setProduct(p); document.title = `${p.name} · Captain Slabbin` } })
      .catch(e => live && setError(e.message))
    apiFetch(`/products/${encodeURIComponent(sku)}/related`).then(r => live && setRelated(r)).catch(() => {})
    return () => { live = false; document.title = 'Captain Slabbin' }
  }, [sku])

  useEffect(() => {
    if (!zoom) return
    const onKey = e => e.key === 'Escape' && setZoom(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  if (error) {
    return (
      <div className="container empty">
        <h2>This product is no longer listed</h2>
        <p>It may have sold out or moved shelves.</p>
        <Link to="/" className="btn btn-outline" style={{ marginTop: 16 }}>Back to the shop</Link>
      </div>
    )
  }
  if (!product) return <div className="page-loading"><div className="spinner" /></div>

  const images = product.images.filter(i => i.mediaType !== 'video')
  const sale = isOnSale(product)
  const inBag = items.find(i => i.id === product.id)?.quantity || 0
  const left = product.stock - inBag
  const soldOut = product.stock <= 0
  const low = product.stock > 0 && product.stock <= 10
  const parent = product.category?.parent
  const shelf = parent || product.category

  function add() {
    const n = Math.min(qty, left)
    if (n <= 0) { toast(`All ${product.stock} available are already in your bag.`); return }
    addItem(toCartItem(product), n)
    toast(`${n} × ${product.name} added to your bag`, { to: '/cart', label: 'View bag' })
    setQty(1)
  }

  const step = d => setQty(q => Math.max(1, Math.min(Math.max(1, left), q + d)))

  return (
    <>
      <div className="container">
        <div className="breadcrumb">
          <Link to="/">Home</Link><span className="sep">/</span>
          {shelf && <><Link to={`/s/${shelf.slug}`}>{shelf.name}</Link><span className="sep">/</span></>}
          <span className="current">{product.name}</span>
        </div>

        <section className="product-layout">
          <div>
            <div className="gallery-frame">
              {images.length ? (
                <img src={images[index].url} alt={`${product.name} — photo ${index + 1}`} decoding="sync" onClick={() => setZoom(true)} />
              ) : <ProductArt product={product} />}
              {images.length > 1 && (
                <>
                  <button type="button" className="gallery-nav gallery-nav--prev" aria-label="Previous image" onClick={() => setIndex(i => (i - 1 + images.length) % images.length)}>‹</button>
                  <button type="button" className="gallery-nav gallery-nav--next" aria-label="Next image" onClick={() => setIndex(i => (i + 1) % images.length)}>›</button>
                  <span className="gallery-count">{index + 1} / {images.length}</span>
                </>
              )}
            </div>
            {images.length > 1 && (
              <div className="gallery-thumbs">
                {images.map((img, i) => (
                  <button key={img.id} type="button" className={i === index ? 'active' : ''} onClick={() => setIndex(i)} aria-label={`Photo ${i + 1}`}>
                    <img src={img.thumbnail || img.url} alt="" decoding="async" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="product-info">
            <div className="card-tags" style={{ position: 'static' }}>
              {sale && <span className="tag tag-sale">Sale</span>}
              {product.badge && <span className="tag">{product.badge}</span>}
            </div>
            <div>
              <div className="card-cat">{product.category?.name}</div>
              <h1 className="product-title frost-head" style={{ marginTop: 6 }}>{product.name}</h1>
              {product.sku && <div className="sku" style={{ marginTop: 6 }}>SKU {product.sku}</div>}
            </div>

            <div className="price-big">
              {money(product.price)}
              {sale && <span className="was">{money(product.compareAtPrice)}</span>}
              {product.unitLabel && <span className="unit">{product.unitLabel}</span>}
            </div>
            {sale && <span className="save-pill">You save {money(product.compareAtPrice - product.price)}</span>}

            <div className="stock-meter">
              <div className="stock-meter-track">
                <div className={'stock-meter-fill' + (low ? ' low' : '')} style={{ width: `${soldOut ? 0 : Math.min(100, Math.max(8, product.stock))}%` }} />
              </div>
              <div className="stock-meter-label">
                {soldOut ? 'Sold out — message us to be notified' : low ? `Only ${product.stock} left` : 'In stock, ready to ship'}
              </div>
            </div>

            <div className="buy-row">
              <div className="qty-box">
                <button type="button" aria-label="One fewer" onClick={() => step(-1)} disabled={soldOut}>−</button>
                <input type="text" inputMode="numeric" value={qty} readOnly aria-label="Quantity" />
                <button type="button" aria-label="One more" onClick={() => step(1)} disabled={soldOut || qty >= left}>+</button>
              </div>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={add} disabled={soldOut || left <= 0}>
                {soldOut ? 'Sold out' : `Add to bag · ${money(product.price * qty)}`}
              </button>
            </div>
            {inBag > 0 && <p className="muted" style={{ fontSize: 13 }}>{inBag} already in your bag · <Link to="/cart" style={{ textDecoration: 'underline' }}>Checkout</Link></p>}

            {product.description && <p className="product-desc">{product.description}</p>}

            <div className="perks">
              <div><Icon.truck /> Discreet packaging, tracked shipping</div>
              <div><Icon.bolt /> Pay instantly from your crypto wallet</div>
              <div><Icon.telegram /> Or send the order to us on Telegram from your bag</div>
            </div>
          </div>
        </section>

        {related.length > 0 && (
          <section className="section">
            <div className="section-head"><h2 className="frost-head">More from this shelf</h2></div>
            <div className="grid">{related.map(p => <ProductCard key={p.id} product={p} />)}</div>
          </section>
        )}
      </div>

      {!soldOut && (
        <div className="sticky-buy">
          <div style={{ flex: 1 }}>
            <div className="p">{money(product.price)}</div>
            <div className="muted" style={{ fontSize: 12 }}>{product.unitLabel || product.name}</div>
          </div>
          <button className="btn btn-primary" onClick={add} disabled={left <= 0}>Add to bag</button>
        </div>
      )}

      {zoom && images.length > 0 && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Enlarged image">
          <button type="button" className="lightbox-backdrop" aria-label="Close" onClick={() => setZoom(false)} />
          <img src={images[index].url} alt={product.name} />
          <button type="button" className="lightbox-close" aria-label="Close" onClick={() => setZoom(false)}>×</button>
        </div>
      )}
    </>
  )
}
