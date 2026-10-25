// After `vite build`: writes a static HTML file per public page with its own
// <title>, description, canonical, Open Graph and JSON-LD, plus sitemap.xml and
// robots.txt. Crawlers and link previews (Google, Bing, Telegram, WhatsApp…)
// get the right tags without running JavaScript; the app then takes over.
//
// SITE_URL: the canonical address (default https://www.captainslabbin.shop,
// where Vercel serves the shop). Shelves and FAQ come from the live API when
// it answers, else from the defaults below.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const SITE = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://www.captainslabbin.shop').replace(/\/$/, '')
const API = (process.env.VITE_API_URL || SITE.replace(/^https:\/\/(www\.)?/, 'https://api.')).replace(/\/$/, '')

const NAME = 'Captain Slabbin'
const TAGLINE = 'Top shelf. Delivered.'
const DESCRIPTION = 'Captain Slabbin: top shelf flower, concentrates, moonrocks, disposables, prerolls, edibles and shrooms. Pay with crypto in one tap, discreet tracked shipping nationwide across the US. Adults 21+.'
const OG = '/brand/og.jpg'

const SHELF_ART = {
  flower: 'cat-flower', concentrates: 'cat-concentrates', moonrocks: 'cat-moonrocks', disposables: 'cat-disposables',
  prerolls: 'cat-prerolls', edibles: 'cat-edibles', mush: 'cat-shrooms', 'fire-sale': 'cat-captains-chest',
}
// Keep in step with SHELF_COPY in src/shop/seo.js
const SHELF_COPY = {
  'fire-sale': "The Captain's Chest: this week's Fire Sale deals on flower, concentrates, disposables and more, marked down while they last.",
  flower: 'Top shelf flower, hand-picked for nose, bag appeal and potency. Exotic and classic strains by the pound, packed fresh and shipped discreetly across the US.',
  concentrates: 'Premium extracts: live badder, crumble, diamonds and sauce. Clean, potent concentrates sorted by tier, with bulk pricing for repeat buyers.',
  moonrocks: 'Moonrocks: dense flower coated in concentrate and kief, stronger by nature. Classic and flavored rocks by the pound.',
  disposables: 'Disposable vapes and carts, ready to enjoy: authentic and replica lines, single units or bulk, shipped discreetly.',
  prerolls: 'Prerolls ready to light: infused packs, hash holes and classics. Roll it, light it, enjoy.',
  edibles: 'Edibles that are tasty and potent: gummies, chocolate bars and more, clearly dosed.',
  mush: 'Shrooms: whole caps and stems by the ounce. Explore higher, with clear weights and discreet shipping.',
}
const DEFAULT_SHELVES = [
  ['flower', 'Flower'], ['concentrates', 'Concentrates'], ['moonrocks', 'Moonrocks'], ['disposables', 'Disposables'],
  ['prerolls', 'Prerolls'], ['edibles', 'Edibles'], ['mush', 'Mush'],
].map(([slug, name]) => ({ slug, name, children: [] }))
const DEFAULT_FAQ = [
  ['How do I pay?', 'With crypto from your wallet on the site: BTC, LTC, ETH, DOGE or XMR. Add funds once, then every order is paid in one tap.'],
  ['Do you ship across the US?', 'Yes. Orders ship in plain, unmarked packaging with tracking, anywhere we serve in the US.'],
  ['What do you need to know about me?', 'A username and a password, nothing else. Your Telegram is optional.'],
]

async function api(path) {
  try {
    const res = await fetch(API + '/api' + path, { signal: AbortSignal.timeout(6000) })
    const json = await res.json()
    return json.success ? json.data : null
  } catch { return null }
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const abs = p => p.startsWith('http') ? p : SITE + p
const ld = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`

function head({ title, description = DESCRIPTION, path, image = OG, jsonLd = [], noindex = false }) {
  const full = title ? `${title} | ${NAME}` : `${NAME} | ${TAGLINE}`
  const url = SITE + path
  return [
    `<title>${esc(full)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}" />`,
    noindex ? '' : `<link rel="canonical" href="${url}" />`,
    noindex ? '' : `<link rel="alternate" hreflang="en-us" href="${url}" />`,
    noindex ? '' : `<link rel="alternate" hreflang="x-default" href="${url}" />`,
    `<meta property="og:site_name" content="${NAME}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(full)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${abs(image)}" />`,
    image === OG ? '<meta property="og:image:width" content="1200" />\n    <meta property="og:image:height" content="630" />' : '',
    `<meta property="og:locale" content="en_US" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(full)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${abs(image)}" />`,
    ...jsonLd.map(ld),
  ].filter(Boolean).join('\n    ')
}

// Plain HTML for visitors and crawlers without JavaScript
const fallback = body => `<noscript><div style="max-width:720px;margin:40px auto;padding:0 16px;font-family:system-ui,sans-serif;color:#f2ebdf;background:#0d0c0b">${body}</div></noscript>`

const store = settings => ({
  '@context': 'https://schema.org',
  '@type': 'OnlineStore',
  name: settings.site_name || NAME,
  url: SITE + '/',
  logo: abs('/brand/icon-512.png'),
  image: abs(OG),
  description: DESCRIPTION,
  slogan: TAGLINE,
  areaServed: { '@type': 'Country', name: 'United States' },
  currenciesAccepted: 'USD',
  paymentAccepted: 'Bitcoin, Litecoin, Ethereum, Dogecoin, Monero',
  ...(settings.support_phone ? { telephone: settings.support_phone } : {}),
  ...(settings.contact_email ? { email: settings.contact_email } : {}),
  ...(settings.store_city ? { address: { '@type': 'PostalAddress', streetAddress: settings.store_address || undefined, addressLocality: settings.store_city, addressRegion: settings.store_state || undefined, postalCode: settings.store_zip || undefined, addressCountry: 'US' } } : {}),
  ...(settings.telegram_username ? { sameAs: [`https://t.me/${settings.telegram_username.replace(/^@/, '')}`] } : {}),
})
const crumbs = items => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + path })),
})

const template = await readFile(join(DIST, 'index.html'), 'utf8')
if (!/<!-- seo:[\s\S]*?<!-- \/seo -->/.test(template)) throw new Error('index.html has no <!-- seo --> block')
const page = (meta, body) => template
  .replace(/<!-- seo:[\s\S]*?<!-- \/seo -->/, head(meta))
  .replace('<div id="root"></div>', `<div id="root"></div>\n    ${fallback(body)}`)

async function write(path, html) {
  const file = path === '/' ? join(DIST, 'index.html') : join(DIST, path, 'index.html')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, html)
}

const [cats, settingsData, faqData] = await Promise.all([api('/categories'), api('/content/settings'), api('/content/faq')])
const shelves = cats?.categories?.length ? cats.categories : DEFAULT_SHELVES
const settings = settingsData?.settings || {}
const faq = faqData?.length ? faqData.map(f => [f.question, f.answer]) : DEFAULT_FAQ
const shelfLinks = [{ slug: 'fire-sale', name: 'Fire Sale' }, ...shelves].map(s => `<a href="/s/${s.slug}">${esc(s.name)}</a>`).join(' · ')

const pages = [
  ['/', {
    title: 'Top shelf weed, carts and edibles shipped across the USA', path: '/',
    jsonLd: [store(settings), { '@context': 'https://schema.org', '@type': 'WebSite', name: NAME, url: SITE + '/', inLanguage: 'en-US' }],
  }, `<h1>${NAME}: ${TAGLINE}</h1><p>${esc(DESCRIPTION)}</p><p>${shelfLinks}</p><p><a href="/faq">FAQ</a> · <a href="/about">About</a></p>`],
  ['/about', {
    title: 'About the crew: an online shop shipping across the USA', path: '/about',
    description: 'Who is Captain Slabbin: a small crew running an online shop for adults 21+, with top shelf products, crypto checkout and discreet tracked shipping across the US.',
    jsonLd: [store(settings), { '@context': 'https://schema.org', '@type': 'AboutPage', name: `About ${NAME}`, inLanguage: 'en-US' }, crumbs([['Home', '/'], ['About', '/about']])],
  }, `<h1>About ${NAME}</h1><p>A small crew running an online shop for adults 21 and over: top shelf products, crypto checkout and discreet tracked shipping across the US.</p>`],
  ['/faq', {
    title: 'FAQ: ordering, crypto payment and US shipping', path: '/faq',
    description: 'How to order from Captain Slabbin: paying with BTC, LTC, ETH, DOGE or XMR, discreet tracked shipping across the USA, invoices on Telegram and support. Adults 21+.',
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }, crumbs([['Home', '/'], ['FAQ', '/faq']])],
  }, `<h1>Questions &amp; answers</h1>${faq.map(([q, a]) => `<h2>${esc(q)}</h2><p>${esc(a)}</p>`).join('')}`],
  ...[{ slug: 'fire-sale', name: 'Fire Sale' }, ...shelves].map(s => {
    const copy = SHELF_COPY[s.slug] || `${s.name} from ${NAME}: top shelf quality, crypto checkout and discreet tracked shipping across the US.`
    const art = s.imageUrl || (SHELF_ART[s.slug] ? `/brand/cats/${SHELF_ART[s.slug]}.webp` : OG)
    return [`/s/${s.slug}`, {
      title: s.slug === 'fire-sale' ? 'Fire Sale deals, shipped across the USA' : `${s.name} for sale online, shipped across the USA`,
      description: `${copy} Crypto checkout, discreet tracked shipping nationwide. 21+.`,
      path: `/s/${s.slug}`, image: art,
      jsonLd: [crumbs([['Home', '/'], [s.name, `/s/${s.slug}`]]), { '@context': 'https://schema.org', '@type': 'CollectionPage', name: s.name, description: copy, inLanguage: 'en-US' }],
    }, `<h1>${esc(s.name)}</h1><p>${esc(copy)}</p>${(s.children || []).length ? `<ul>${s.children.map(c => `<li>${esc(c.name)}</li>`).join('')}</ul>` : ''}<p>${shelfLinks}</p>`]
  }),
]

// The SPA fallback (product, cart, account…) must not inherit the home page's tags
await writeFile(join(DIST, 'app.html'), template.replace(/<!-- seo:[\s\S]*?<!-- \/seo -->/, head({ title: 'Members only', path: '/', noindex: true })))
for (const [path, meta, body] of pages) await write(path, page(meta, body))

const today = new Date().toISOString().slice(0, 10)
await writeFile(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${pages.map(([path, meta]) => `  <url>
    <loc>${SITE}${path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${path === '/' || path === '/s/fire-sale' ? 'daily' : 'weekly'}</changefreq>
    <priority>${path === '/' ? '1.0' : path.startsWith('/s/') ? '0.8' : '0.6'}</priority>
    <image:image><image:loc>${abs(meta.image || OG)}</image:loc></image:image>
  </url>`).join('\n')}
</urlset>
`)

await writeFile(join(DIST, 'robots.txt'), `# ${NAME}: the public pages are open to search engines; products, prices,
# carts and accounts are for members and stay out of the index.
User-agent: *
Allow: /
Disallow: /admin
Disallow: /account
Disallow: /cart
Disallow: /checkout
Disallow: /login
Disallow: /tg-login
Disallow: /p/
Disallow: /s/all

Sitemap: ${SITE}/sitemap.xml
`)

console.log(`prerender: ${pages.length} pages, sitemap and robots for ${SITE} (shelves ${cats ? 'from the API' : 'from defaults'})`)
