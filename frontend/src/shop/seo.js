import { useEffect } from 'react'

// Per-page <head> for search engines and link previews: title, description,
// canonical URL, Open Graph / Twitter cards, robots and JSON-LD. The build also
// writes the public pages' head into static HTML (scripts/prerender.mjs), so
// crawlers that don't run JavaScript (Telegram, WhatsApp…) get the same tags.

export const SITE_NAME = 'Captain Slabbin'
export const DEFAULT_DESCRIPTION = 'Captain Slabbin: top shelf flower, concentrates, moonrocks, disposables, prerolls, edibles and more. Pay with crypto in one tap, discreet tracked shipping across the US. Adults 21+ only.'
export const DEFAULT_IMAGE = '/brand/og.jpg'

const origin = () => window.location.origin
const abs = url => (!url ? null : url.startsWith('http') ? url : origin() + url)

function meta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (content == null) { el?.remove(); return }
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el) }
  el.setAttribute('content', content)
}

function link(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`)
  if (!href) { el?.remove(); return }
  if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el) }
  el.href = href
}

// noindex: private pages (product details, cart, account…) stay out of search
// skip: let a child page set the head instead (hooks can't be conditional)
export function useSeo({ title, description = DEFAULT_DESCRIPTION, path, image = DEFAULT_IMAGE, jsonLd, noindex = false, type = 'website', skip = false }) {
  const ld = jsonLd ? JSON.stringify(jsonLd) : ''
  useEffect(() => {
    if (skip) return
    const full = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} | Top shelf. Delivered.`
    document.title = full
    const url = origin() + (path ?? window.location.pathname)
    meta('name', 'description', description)
    meta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large')
    link('canonical', noindex ? null : url)
    for (const lang of ['en-us', 'x-default']) {
      let el = document.head.querySelector(`link[rel="alternate"][hreflang="${lang}"]`)
      if (noindex) { el?.remove(); continue }
      if (!el) { el = document.createElement('link'); el.rel = 'alternate'; el.hreflang = lang; document.head.appendChild(el) }
      el.href = url
    }
    meta('property', 'og:site_name', SITE_NAME)
    meta('property', 'og:type', type)
    meta('property', 'og:title', full)
    meta('property', 'og:description', description)
    meta('property', 'og:url', url)
    meta('property', 'og:image', abs(image))
    meta('property', 'og:locale', 'en_US')
    meta('name', 'twitter:card', 'summary_large_image')
    meta('name', 'twitter:title', full)
    meta('name', 'twitter:description', description)
    meta('name', 'twitter:image', abs(image))

    // The static page's own JSON-LD (prerender) gives way to the live one
    document.head.querySelectorAll('script[type="application/ld+json"]:not(#page-jsonld)').forEach(el => el.remove())
    let script = document.getElementById('page-jsonld')
    if (ld) {
      if (!script) { script = document.createElement('script'); script.type = 'application/ld+json'; script.id = 'page-jsonld'; document.head.appendChild(script) }
      script.textContent = ld
    } else script?.remove()
  }, [title, description, path, image, ld, noindex, type, skip])
}

// Structured data shared by the public pages
export const storeLd = settings => ({
  '@context': 'https://schema.org',
  '@type': 'OnlineStore',
  name: settings.site_name || SITE_NAME,
  url: origin(),
  logo: abs('/brand/logo.webp'),
  image: abs(DEFAULT_IMAGE),
  description: DEFAULT_DESCRIPTION,
  slogan: 'Top shelf. Delivered.',
  areaServed: { '@type': 'Country', name: 'United States' },
  currenciesAccepted: 'USD',
  paymentAccepted: 'Bitcoin, Litecoin, Ethereum, Dogecoin, Monero',
  ...(settings.support_phone ? { telephone: settings.support_phone } : {}),
  ...(settings.contact_email ? { email: settings.contact_email } : {}),
  ...(settings.store_city ? { address: { '@type': 'PostalAddress', addressLocality: settings.store_city, addressRegion: settings.store_state || undefined, postalCode: settings.store_zip || undefined, streetAddress: settings.store_address || undefined, addressCountry: 'US' } } : {}),
  ...(settings.telegram_username ? { sameAs: [`https://t.me/${settings.telegram_username.replace(/^@/, '')}`] } : {}),
})

export const breadcrumbLd = items => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.path) })),
})

export const faqLd = items => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
})

// Shelf intros: what search engines read on /s/<slug> before the gate
export const SHELF_COPY = {
  'fire-sale': 'The Captain\'s Chest: this week\'s Fire Sale deals on flower, concentrates, disposables and more, marked down while they last.',
  flower: 'Top shelf flower, hand-picked for nose, bag appeal and potency. Exotic and classic strains by the pound, packed fresh and shipped discreetly across the US.',
  concentrates: 'Premium extracts: live badder, crumble, diamonds and sauce. Clean, potent concentrates sorted by tier, with bulk pricing for repeat buyers.',
  moonrocks: 'Moonrocks: dense flower coated in concentrate and kief, stronger by nature. Classic and flavored rocks by the pound.',
  disposables: 'Disposable vapes and carts, ready to enjoy: authentic and replica lines, single units or bulk, shipped discreetly.',
  prerolls: 'Prerolls ready to light: infused packs, hash holes and classics. Roll it, light it, enjoy.',
  edibles: 'Edibles that are tasty and potent: gummies, chocolate bars and more, clearly dosed.',
  mush: 'Shrooms: whole caps and stems by the ounce. Explore higher, with clear weights and discreet shipping.',
}
export const shelfCopy = (slug, name) => SHELF_COPY[slug] || `${name} from Captain Slabbin: top shelf quality, crypto checkout and discreet tracked shipping across the US.`

// Shelf banners from the original shop (frontend/public/brand/cats), unless the
// admin uploaded one in Admin → Categories
const SHELF_ART = {
  flower: 'cat-flower', concentrates: 'cat-concentrates', moonrocks: 'cat-moonrocks',
  disposables: 'cat-disposables', prerolls: 'cat-prerolls', edibles: 'cat-edibles',
  mush: 'cat-shrooms', 'fire-sale': 'cat-captains-chest',
}
export const shelfArt = (slug, imageUrl) => imageUrl || (SHELF_ART[slug] ? `/brand/cats/${SHELF_ART[slug]}.webp` : null)

// First answers for the FAQ page's JSON-LD, replaced by Admin → FAQ once loaded
export const FAQ_SEED = [
  ['How do I pay?', 'With crypto from your wallet on the site: BTC, LTC, ETH, DOGE or XMR. Add funds once, then every order is paid in one tap.'],
  ['Do you ship across the US?', 'Yes. Orders ship in plain, unmarked packaging with tracking, anywhere we serve in the US.'],
]
