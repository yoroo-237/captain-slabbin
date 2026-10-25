import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCart } from '../../context/CartContext.jsx'
import { useShop } from '../ShopContext.jsx'
import { Icon, money, isOnSale, isVideo, productMedia, salePct, productUrl, ProductArt } from '../lib.jsx'
import { smokePuff } from './smoke.js'

// Only what the cart needs is stored, so it survives catalog changes
export const toCartItem = p => ({
  id: p.id, sku: p.sku, slug: p.slug, name: p.name, price: Number(p.price),
  unitLabel: p.unitLabel, stock: p.stock, category: p.category?.name,
  // a photo, else a video's poster frame
  image: (() => {
    const m = p.images || []
    const photo = m.find(i => !isVideo(i))
    return photo?.thumbnail || photo?.url || m.find(i => i.thumbnail)?.thumbnail || null
  })(),
})

// The card leans toward the pointer
function tilt(e) {
  if (e.pointerType !== 'mouse') return
  const c = e.currentTarget
  const r = c.getBoundingClientRect()
  c.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 8}deg`)
  c.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - 0.5) * -8}deg`)
}
const untilt = e => { e.currentTarget.style.removeProperty('--rx'); e.currentTarget.style.removeProperty('--ry') }

// A video in a card: plays silently on a loop while it is on screen; the button
// pauses and resumes it
function CardVideo({ m, label }) {
  const ref = useRef(null)
  const [playing, setPlaying] = useState(true)
  useEffect(() => {
    const v = ref.current
    if (!v || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && playing) v.play().catch(() => {})
      else v.pause()
    }, { threshold: 0.4 })
    io.observe(v)
    return () => io.disconnect()
  }, [playing])
  function toggle(e) {
    e.preventDefault(); e.stopPropagation()
    const v = ref.current
    if (v.paused) { v.play().catch(() => {}); setPlaying(true) } else { v.pause(); setPlaying(false) }
  }
  return (
    <>
      <video ref={ref} src={m.url} poster={m.thumbnail || undefined} muted loop playsInline autoPlay preload="metadata" aria-label={label} />
      <button type="button" className="cm-play" onClick={toggle} aria-label={playing ? 'Pause video' : 'Play video'}>
        {playing ? <Icon.pause /> : <Icon.play />}
      </button>
    </>
  )
}

// The card's photos and videos: arrows on hover, swipe on touch, dots below.
// The media itself links to the product.
function CardMedia({ product, url }) {
  const media = productMedia(product)
  const [i, setI] = useState(0)
  const touch = useRef(null)
  if (!media.length) return <Link to={url} className="cm-link" tabIndex={-1} aria-hidden="true"><ProductArt /></Link>
  const m = media[Math.min(i, media.length - 1)]
  const go = (d, e) => { e?.preventDefault(); e?.stopPropagation(); setI(n => (n + d + media.length) % media.length) }
  const onTouchStart = e => { touch.current = e.touches[0].clientX }
  const onTouchEnd = e => {
    if (touch.current == null || media.length < 2) return
    const dx = e.changedTouches[0].clientX - touch.current
    touch.current = null
    if (Math.abs(dx) > 35) go(dx < 0 ? 1 : -1)
  }
  return (
    <div className="cm" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <Link to={url} className="cm-link" tabIndex={-1} aria-hidden="true">
        {isVideo(m)
          ? null
          : <img key={m.id} src={m.thumbnail || m.url} alt="" loading="lazy" decoding="async" />}
      </Link>
      {isVideo(m) && <CardVideo key={m.id} m={m} label={product.name} />}
      {media.length > 1 && (
        <>
          <button type="button" className="cm-nav prev" onClick={e => go(-1, e)} aria-label="Previous photo"><Icon.chevL /></button>
          <button type="button" className="cm-nav next" onClick={e => go(1, e)} aria-label="Next photo"><Icon.chevR /></button>
          <span className="cm-dots" aria-hidden="true">{media.map((x, k) => <i key={x.id} className={(k === i ? 'on' : '') + (isVideo(x) ? ' vid' : '')} />)}</span>
        </>
      )}
    </div>
  )
}

export default function ProductCard({ product }) {
  const { addItem, items } = useCart()
  const { toast } = useShop()
  const [pop, setPop] = useState(false)
  const soldOut = product.stock <= 0
  const sale = isOnSale(product)
  const low = !soldOut && product.stock <= 5
  const inCart = items.find(i => i.id === product.id)?.quantity || 0
  const url = productUrl(product)

  function add(e) {
    if (inCart >= product.stock) { toast(`Only ${product.stock} available.`); return }
    addItem(toCartItem(product), 1)
    setPop(true)
    smokePuff(e.currentTarget)
    toast(`${product.name} added to your cart`, { to: '/cart', label: 'View cart' })
  }

  return (
    <article className={'card' + (soldOut ? ' is-out' : '')} onPointerMove={tilt} onPointerLeave={untilt}>
      <div className="card-media">
        <div className="card-tags">
          {sale && <span className="tag tag-sale">−{salePct(product)}%</span>}
          {product.badge && <span className="tag">{product.badge}</span>}
          {soldOut && <span className="tag tag-out">Sold out</span>}
        </div>
        <CardMedia product={product} url={url} />
      </div>
      <div className="card-body">
        <span className="card-cat">{product.category?.name}</span>
        <Link to={url} className="card-title">{product.name}</Link>
        {low && <span className="card-stock">Only {product.stock} left</span>}
      </div>
      <div className="card-foot">
        <div className={'card-price' + (sale ? ' sale' : '')}>
          <span className="row">
            <span className="now">{money(product.price)}</span>
            {sale && <span className="was">{money(product.compareAtPrice)}</span>}
          </span>
          {product.unitLabel && <span className="unit">{product.unitLabel}</span>}
        </div>
        <button
          type="button" onAnimationEnd={() => setPop(false)}
          className={'card-add' + (inCart ? ' in' : '') + (pop ? ' pop' : '')}
          onClick={add} disabled={soldOut}
          aria-label={soldOut ? `${product.name} is sold out` : `Add ${product.name} to cart`}
        >
          {soldOut ? <span className="lbl">Sold out</span> : inCart ? <><Icon.check /><span className="lbl">{inCart}</span></> : <><Icon.plus /><span className="lbl">Add</span></>}
        </button>
      </div>
    </article>
  )
}

export function CardSkeleton() {
  return (
    <div className="card-skel" aria-hidden="true">
      <div className="m skeleton" style={{ borderRadius: 0 }} />
      <div className="l s skeleton" />
      <div className="l skeleton" />
      <div className="l b skeleton" />
    </div>
  )
}
