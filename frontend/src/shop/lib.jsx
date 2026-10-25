// Small shared helpers for the storefront: money formatting, coin styling,
// product art fallback and the inline icon set.

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export const money = n => usd.format(Number(n) || 0)

export const COINS = {
  BTC:  { name: 'Bitcoin',  color: '#f7931a', symbol: '₿' },
  LTC:  { name: 'Litecoin', color: '#345d9d', symbol: 'Ł' },
  DOGE: { name: 'Dogecoin', color: '#c2a633', symbol: 'Ð' },
  ETH:  { name: 'Ethereum', color: '#627eea', symbol: 'Ξ' },
  XMR:  { name: 'Monero',   color: '#ff6600', symbol: 'ɱ' },
}

export function Coin({ currency, small }) {
  const c = COINS[currency] || { color: '#555', symbol: '$' }
  return <span className={'coin' + (small ? ' sm' : '')} style={{ background: c.color }} aria-hidden="true">{c.symbol}</span>
}

export const fmtCrypto = n => {
  const v = Number(n)
  if (!v) return '0'
  return v.toFixed(8).replace(/\.?0+$/, '')
}

export const fmtDate = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
export const fmtDateTime = d => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export const isOnSale = p => p.compareAtPrice != null && Number(p.compareAtPrice) > Number(p.price)
export const productUrl = p => `/p/${encodeURIComponent((p.sku || p.slug).toLowerCase())}`

// Products without a photo: the shop's mark on a plain plate, never a fake image
export function ProductArt() {
  return (
    <div className="art" aria-hidden="true">
      <img src="/brand/logo.webp" alt="" />
    </div>
  )
}

export const isVideo = m => m?.mediaType === 'video' || /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(m?.url || '')
export const productMedia = p => (p?.images || []).filter(m => m?.url)

// The card's media: the first photo (or the first video, playing silently), plus
// the second photo faded in on hover when there is one
export function ProductImage({ product, className, hoverAlt }) {
  const media = productMedia(product)
  if (!media.length) return <ProductArt />
  const [first] = media
  const alt = media.slice(1).find(m => !isVideo(m))
  return (
    <>
      {isVideo(first)
        ? (first.thumbnail
            ? <img className={className} src={first.thumbnail} alt={product.name} loading="lazy" decoding="async" />
            : <video className={className} src={first.url} muted playsInline loop autoPlay preload="metadata" aria-label={product.name} />)
        : <img className={className} src={first.thumbnail || first.url} alt={product.name} loading="lazy" decoding="async" />}
      {isVideo(first) && <span className="media-badge" aria-hidden="true"><Icon.play /></span>}
      {hoverAlt && alt && <img className="alt" src={alt.thumbnail || alt.url} alt="" loading="lazy" decoding="async" />}
    </>
  )
}

// Star rating, read-only (value) or as an input (onChange)
export function Stars({ value = 0, onChange, size }) {
  const v = Math.round(Number(value) * 2) / 2
  return (
    <span className={'stars' + (onChange ? ' input' : '')} style={size ? { '--star': `${size}px` } : undefined} role={onChange ? 'radiogroup' : 'img'} aria-label={onChange ? 'Rating' : `${v} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(n => onChange
        ? <button key={n} type="button" role="radio" aria-checked={n === v} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= v ? 'on' : ''} onClick={() => onChange(n)}><Icon.star /></button>
        : <i key={n} className={n <= v ? 'on' : n - 0.5 === v ? 'half' : ''}><Icon.star /></i>)}
    </span>
  )
}

// The shop's own words about itself (Admin → Settings), with a default
export const ABOUT_DEFAULT = `Captain Slabbin is an online shop for adults 21 and over, run by a small crew that answers every message itself.

Every product on the shelves is chosen by the crew, packed in plain, unmarked packaging and shipped with tracking anywhere in the United States.

Payment is crypto only. You pay from your wallet in one tap, and your invoice goes straight to us on Telegram, where a real person confirms it. No email, no real name, no paperwork.`
export const aboutParagraphs = settings => (settings.about_text?.trim() || ABOUT_DEFAULT).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)

export const salePct = p => isOnSale(p) ? Math.round((1 - Number(p.price) / Number(p.compareAtPrice)) * 100) : 0

// Minimal line icons (24×24, currentColor)
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
export const Icon = {
  menu:     () => <svg viewBox="0 0 24 24" {...P}><path d="M3 6h18M3 12h18M3 18h18" /></svg>,
  close:    () => <svg viewBox="0 0 24 24" {...P}><path d="M18 6 6 18M6 6l12 12" /></svg>,
  bag:      () => <svg viewBox="0 0 24 24" {...P}><path d="M6 7h12l1 13H5L6 7z" /><path d="M9 7a3 3 0 0 1 6 0" /></svg>,
  user:     () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
  telegram: () => <svg viewBox="0 0 24 24" {...P}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></svg>,
  search:   () => <svg viewBox="0 0 24 24" {...P}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>,
  chat:     () => <svg viewBox="0 0 24 24" {...P}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" /></svg>,
  truck:    () => <svg viewBox="0 0 24 24" {...P}><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></svg>,
  shield:   () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" /><path d="m9 12 2 2 4-4" /></svg>,
  bolt:     () => <svg viewBox="0 0 24 24" {...P}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>,
  lock:     () => <svg viewBox="0 0 24 24" {...P}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>,
  check:    () => <svg viewBox="0 0 24 24" {...P}><path d="M20 6 9 17l-5-5" /></svg>,
  copy:     () => <svg viewBox="0 0 24 24" {...P}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>,
  filter:   () => <svg viewBox="0 0 24 24" {...P}><path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" /></svg>,
  sun:      () => <svg viewBox="0 0 24 24" {...P} className="sun"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon:     () => <svg viewBox="0 0 24 24" {...P} className="moon"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>,
  plus:     () => <svg viewBox="0 0 24 24" {...P}><path d="M12 5v14M5 12h14" /></svg>,
  minus:    () => <svg viewBox="0 0 24 24" {...P}><path d="M5 12h14" /></svg>,
  arrow:    () => <svg viewBox="0 0 24 24" {...P}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  back:     () => <svg viewBox="0 0 24 24" {...P}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>,
  chevL:    () => <svg viewBox="0 0 24 24" {...P}><path d="m15 18-6-6 6-6" /></svg>,
  chevR:    () => <svg viewBox="0 0 24 24" {...P}><path d="m9 18 6-6-6-6" /></svg>,
  home:     () => <svg viewBox="0 0 24 24" {...P}><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /></svg>,
  wallet:   () => <svg viewBox="0 0 24 24" {...P}><path d="M3 7a2 2 0 0 1 2-2h13v4" /><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z" /><circle cx="16" cy="14.5" r="1.3" /></svg>,
  box:      () => <svg viewBox="0 0 24 24" {...P}><path d="M21 8 12 3 3 8v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>,
  logout:   () => <svg viewBox="0 0 24 24" {...P}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></svg>,
  send:     () => <svg viewBox="0 0 24 24" {...P}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></svg>,
  fire:     () => <svg viewBox="0 0 24 24" {...P}><path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-6 6-6 9-1-1-2-2-2-4-1 2-1 4-1 7 0 4 3 7 7 7z" /></svg>,
  tag:      () => <svg viewBox="0 0 24 24" {...P}><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>,
  pause:    () => <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>,
  play:     () => <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5.5v13l11-6.5z" /></svg>,
  zoom:     () => <svg viewBox="0 0 24 24" {...P}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M11 8v6M8 11h6" /></svg>,
  info:     () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>,
  alert:    () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>,
  card:     () => <svg viewBox="0 0 24 24" {...P}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>,
  clock:    () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  star:     () => <svg viewBox="0 0 24 24" {...P}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3z" /></svg>,
  pin:      () => <svg viewBox="0 0 24 24" {...P}><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg>,
  trash:    () => <svg viewBox="0 0 24 24" {...P}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>,
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
