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

export function Coin({ currency }) {
  const c = COINS[currency] || { color: '#555', symbol: '$' }
  return <span className="coin" style={{ background: c.color }} aria-hidden="true">{c.symbol}</span>
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

// Deterministic gradient from the product name, for products without a photo
const PALETTES = [
  ['#2b3a44', '#8fa3b1'], ['#3a1414', '#a81f1a'], ['#1d2b22', '#4f8f6a'], ['#2a2238', '#7d64b8'],
  ['#3a2c14', '#c8963c'], ['#14283a', '#3c7fc8'], ['#331a2b', '#b8487d'], ['#22303a', '#c6d2db'],
]
export function ProductArt({ product }) {
  const name = product?.name || '?'
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const [a, b] = PALETTES[h % PALETTES.length]
  const initials = name.split(/\s+/).filter(w => /[a-z0-9]/i.test(w[0])).slice(0, 2).map(w => w[0].toUpperCase()).join('')
  return (
    <div className="art" style={{ '--art-bg': `radial-gradient(circle at 70% 30%, ${b}, ${a} 70%)` }} aria-hidden="true">
      <span>{initials}</span>
    </div>
  )
}

export function ProductImage({ product, className }) {
  const img = product?.images?.find(i => i.mediaType !== 'video')
  if (!img) return <ProductArt product={product} />
  return <img className={className} src={img.thumbnail || img.url} alt={product.name} loading="lazy" decoding="async" />
}

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
