import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { useShop } from '../ShopContext.jsx'
import { useSeo, breadcrumbLd, shelfCopy, shelfArt } from '../seo.js'
import ProductCard, { CardSkeleton } from '../components/ProductCard.jsx'
import { Icon } from '../lib.jsx'

const SORTS = [
  ['featured',   'Featured'],
  ['price_asc',  'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['latest',     'Newest'],
  ['name',       'Name A–Z'],
]
// Quick picks fill the min/max inputs; the inputs themselves take any value
const PRICE_PICKS = [['', '50', 'Under $50'], ['50', '250', '$50 – $250'], ['250', '1000', '$250 – $1,000'], ['1000', '', '$1,000+']]
const PER_PAGE = 24

// /s/:slug — one shelf with search, sort, sub-shelf chips, a real price range,
// on-sale/in-stock filters and pagination. Every filter lives in the URL so
// links and Back work. /s/all is the whole catalog (and where header search lands).
// Before the shop code: the shelf's public intro (indexable). After: the catalog.
export default function ShelfPage() {
  const { unlocked } = useShop()
  return unlocked ? <ShelfCatalog /> : <PublicShelf />
}

function ShelfCatalog() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const { shelves } = useShop()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [search, setSearch] = useState(params.get('q') || '')
  // Local price text so typing doesn't refetch on every keystroke
  const [priceText, setPriceText] = useState({ min: params.get('min') || '', max: params.get('max') || '' })

  const sub = params.get('sub') || ''
  const sort = params.get('sort') || 'featured'
  const page = Math.max(1, parseInt(params.get('page') || '1', 10))
  const min = params.get('min') || ''
  const max = params.get('max') || ''
  const inStock = params.get('stock') === '1'
  const onSale = params.get('sale') === '1'
  const q = params.get('q') || ''

  const all = slug === 'all'
  const shelf = slug === 'fire-sale'
    ? { slug, name: 'Fire Sale', children: [] }
    : all ? { slug, name: 'Shop all', children: [] }
    : shelves.categories.find(c => c.slug === slug)
  const title = all && q ? `Results for “${q}”` : shelf?.children.find(c => c.slug === sub)?.name || shelf?.name || slug.replace(/-/g, ' ')
  useSeo({
    title: slug === 'fire-sale' ? 'Fire Sale deals, shipped across the USA' : `${shelf?.name || title} for sale online, shipped across the USA`,
    description: `${shelfCopy(slug, shelf?.name || title)} Crypto checkout, discreet tracked shipping nationwide. 21+.`,
    path: `/s/${slug}`,
    image: shelfArt(slug, shelf?.imageUrl) || undefined,
    noindex: all || params.toString() !== '',
  })

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k)
    if (!('page' in changes)) next.delete('page')
    setParams(next, { replace: !('page' in changes) })
  }

  useEffect(() => { setSearch(s => s.trim() === q ? s : q) }, [q]) // header search lands here with a new ?q
  useEffect(() => { setPriceText({ min, max }) }, [min, max])      // a quick pick or "clear" overrides typing

  // Search as you type, without a request per keystroke
  useEffect(() => {
    if (search === q) return
    const id = setTimeout(() => update({ q: search.trim() }), 350)
    return () => clearTimeout(id)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  // Price text as you type, same debounce — and only numbers make it into the URL
  useEffect(() => {
    const t = { min: priceText.min.replace(/[^\d]/g, ''), max: priceText.max.replace(/[^\d]/g, '') }
    if (t.min === min && t.max === max) return
    const id = setTimeout(() => update({ min: t.min, max: t.max }), 500)
    return () => clearTimeout(id)
  }, [priceText]) // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(() => {
    const qs = new URLSearchParams({ sort, page: String(page), limit: String(PER_PAGE) })
    if (!all || sub) qs.set('category', sub || slug)
    if (q) qs.set('search', q)
    if (min) qs.set('minPrice', min)
    if (max) qs.set('maxPrice', max)
    if (inStock) qs.set('inStock', '1')
    if (onSale) qs.set('onSale', '1')
    return qs.toString()
  }, [slug, all, sub, sort, page, q, min, max, inStock, onSale])

  useEffect(() => {
    let live = true
    setData(null)
    setError('')
    apiFetch(`/products?${query}`)
      .then(d => live && setData(d))
      .catch(e => live && setError(e.message))
    return () => { live = false }
  }, [query])

  const activeFilters = [min || max, inStock, onSale, q].filter(Boolean).length
  const totalPages = data?.pagination?.totalPages || 1
  const priceLabel = min && max ? `$${min} – $${max}` : min ? `$${min}+` : `Under $${max}`
  const clearAll = () => { setSearch(''); setPriceText({ min: '', max: '' }); update({ q: '', min: '', max: '', stock: '', sale: '' }) }

  const filters = (
    <aside className={'filters panel' + (filtersOpen ? ' open' : '')} aria-label="Filters">
      <div className="filters-head">
        <span className="panel-title" style={{ margin: 0 }}><Icon.filter /> Filters</span>
        {activeFilters > 0 && <button type="button" className="btn-plain" onClick={clearAll}>Clear all</button>}
        {filtersOpen && <button className="icon-btn" aria-label="Close filters" onClick={() => setFiltersOpen(false)}><Icon.close /></button>}
      </div>

      {shelf?.children?.length > 0 && (
        <div className="filter-group">
          <h3>Type</h3>
          {[{ slug: '', name: `All ${shelf.name}`, count: shelf.count }, ...shelf.children].map(c => (
            <label key={c.slug || 'all'} className="filter-row">
              <span className="check"><input type="radio" name="sub" checked={sub === c.slug} onChange={() => update({ sub: c.slug })} /> {c.name}</span>
              <span className="count">{c.count}</span>
            </label>
          ))}
        </div>
      )}

      <div className="filter-group">
        <h3>Price</h3>
        <div className="price-range">
          <label className="price-field">
            <span>Min</span>
            <span className="price-input"><span>$</span><input type="text" inputMode="numeric" placeholder="0" value={priceText.min} onChange={e => setPriceText(p => ({ ...p, min: e.target.value }))} aria-label="Minimum price" /></span>
          </label>
          <span className="price-sep">–</span>
          <label className="price-field">
            <span>Max</span>
            <span className="price-input"><span>$</span><input type="text" inputMode="numeric" placeholder="Any" value={priceText.max} onChange={e => setPriceText(p => ({ ...p, max: e.target.value }))} aria-label="Maximum price" /></span>
          </label>
        </div>
        <div className="price-picks">
          {PRICE_PICKS.map(([lo, hi, label]) => (
            <button key={label} type="button" className={'chip' + (min === lo && max === hi ? ' active' : '')} onClick={() => update({ min: lo, max: hi })}>{label}</button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <h3>Availability</h3>
        <label className="filter-row">
          <span className="check"><input type="checkbox" checked={inStock} onChange={e => update({ stock: e.target.checked ? '1' : '' })} /> In stock only</span>
        </label>
        <label className="filter-row">
          <span className="check"><input type="checkbox" checked={onSale} onChange={e => update({ sale: e.target.checked ? '1' : '' })} /> On sale</span>
        </label>
      </div>

      {filtersOpen && <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={() => setFiltersOpen(false)}>Show {data ? data.pagination.total : ''} results</button>}
    </aside>
  )

  return (
    <div className="container" id="shelf">
      <div className="breadcrumb">
        <Link to="/">Home</Link><span className="sep">/</span>
        {all && q ? <><Link to="/s/all">Shop all</Link><span className="sep">/</span></> : null}
        {sub && shelf ? <><Link to={`/s/${slug}`}>{shelf.name}</Link><span className="sep">/</span></> : null}
        <span className="current">{title}</span>
      </div>

      <section className="section" style={{ paddingTop: 14 }}>
        <div className="shop-toolbar">
          <div>
            <h1 className={'display' + (slug === 'fire-sale' ? ' blood-text' : '')}>{title}</h1>
            <span className="count-txt">{data ? `${data.pagination.total} product${data.pagination.total === 1 ? '' : 's'}` : 'Loading…'}</span>
          </div>
          <div className="shop-tools">
            <div className="search-box">
              <Icon.search />
              <input className="input" type="search" placeholder={all ? 'Search the whole shop' : `Search ${shelf?.name || 'this shelf'}`} value={search} onChange={e => setSearch(e.target.value)} aria-label="Search products" />
            </div>
            <select className="select" value={sort} onChange={e => update({ sort: e.target.value === 'featured' ? '' : e.target.value })} aria-label="Sort products">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button className="btn btn-outline filters-toggle" onClick={() => setFiltersOpen(true)}>
              <Icon.filter /> Filters{activeFilters ? ` (${activeFilters})` : ''}
            </button>
          </div>
        </div>

        {shelf?.children?.length > 0 && (
          <div className="chips" role="tablist" aria-label="Type">
            <button className={'chip' + (!sub ? ' active' : '')} onClick={() => update({ sub: '' })}>All <span className="n">{shelf.count}</span></button>
            {shelf.children.map(c => (
              <button key={c.slug} className={'chip' + (sub === c.slug ? ' active' : '')} onClick={() => update({ sub: c.slug })}>{c.name} <span className="n">{c.count}</span></button>
            ))}
          </div>
        )}

        {activeFilters > 0 && (
          <div className="active-filters" aria-label="Active filters">
            {q && <button className="chip" onClick={() => { setSearch(''); update({ q: '' }) }}>“{q}” <Icon.close /></button>}
            {(min || max) && <button className="chip" onClick={() => { setPriceText({ min: '', max: '' }); update({ min: '', max: '' }) }}>{priceLabel} <Icon.close /></button>}
            {onSale && <button className="chip" onClick={() => update({ sale: '' })}>On sale <Icon.close /></button>}
            {inStock && <button className="chip" onClick={() => update({ stock: '' })}>In stock <Icon.close /></button>}
            <button className="btn-plain" onClick={clearAll}>Clear all</button>
          </div>
        )}

        <div className="shop-layout">
          {filters}
          {filtersOpen && <button className="drawer-backdrop" aria-label="Close filters" onClick={() => setFiltersOpen(false)} />}
          <div>
            {error ? (
              <div className="alert alert-error">{error}</div>
            ) : !data ? (
              <div className="grid">{Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}</div>
            ) : data.products.length === 0 ? (
              <div className="empty">
                <span className="ic">{q ? <Icon.search /> : <Icon.box />}</span>
                <h2>{q ? `No matches for “${q}”` : `Nothing here${activeFilters ? ' with these filters' : ' yet'}`}</h2>
                <p>{activeFilters ? 'Try a shorter word or loosen a filter.' : 'New drops land every week. Check the other shelves meanwhile.'}</p>
                <div className="hero-cta">
                  {activeFilters > 0 && <button className="btn btn-outline" onClick={clearAll}>Clear filters</button>}
                  <Link to="/s/fire-sale" className="btn btn-red"><Icon.fire /> Fire Sale</Link>
                </div>
              </div>
            ) : (
              <>
                <div className="grid">{data.products.map(p => <ProductCard key={p.id} product={p} />)}</div>
                {totalPages > 1 && (
                  <nav className="pagination" aria-label="Pages">
                    <button disabled={page <= 1} onClick={() => update({ page: String(page - 1) })} aria-label="Previous page"><Icon.chevL /></button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
                      .map(n => <button key={n} className={n === page ? 'active' : ''} onClick={() => update({ page: String(n) })} aria-current={n === page ? 'page' : undefined}>{n}</button>)}
                    <button disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })} aria-label="Next page"><Icon.chevR /></button>
                  </nav>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

// What search engines and new visitors see on /s/<slug>: the shelf's banner,
// what it carries, its sub-shelves and the other shelves. No products or prices.
function PublicShelf() {
  const { slug } = useParams()
  const { shelves, openGate } = useShop()
  const fire = slug === 'fire-sale'
  const shelf = fire ? { slug, name: 'Fire Sale', count: shelves.fireSale, children: [] } : shelves.categories.find(c => c.slug === slug)
  const name = shelf?.name || slug.replace(/-/g, ' ')
  const copy = shelfCopy(slug, name)
  const art = shelfArt(slug, shelf?.imageUrl)
  useSeo({
    title: fire ? 'Fire Sale deals, shipped across the USA' : `${name} for sale online, shipped across the USA`,
    description: `${copy} Crypto checkout, discreet tracked shipping nationwide. 21+.`,
    path: `/s/${slug}`,
    image: art || undefined,
    noindex: slug === 'all' || (!shelf && !fire),
    jsonLd: [
      breadcrumbLd([{ name: 'Home', path: '/' }, { name, path: `/s/${slug}` }]),
      { '@context': 'https://schema.org', '@type': 'CollectionPage', name, description: copy, inLanguage: 'en-US' },
    ],
  })
  const others = shelves.categories.filter(c => c.slug !== slug)
  return (
    <section className="section shelf-public">
      <div className="container">
        <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">Home</Link> <span aria-hidden="true">/</span> <span>{name}</span></nav>
        {art && <img className="shelf-banner" src={art} alt={`${name} at Captain Slabbin`} width="740" height="225" />}
        <h1 className={'display' + (fire ? ' blood-text' : '')}>{fire ? 'Fire Sale' : name}</h1>
        <p className="lead">{copy}</p>
        {shelf?.count > 0 && <p className="muted">{shelf.count} {shelf.count === 1 ? 'product' : 'products'} in stock right now, shipped discreetly across the US.</p>}
        {shelf?.children?.length > 0 && (
          <ul className="shelf-types">
            {shelf.children.map(c => <li key={c.slug}><b>{c.name}</b>{c.count ? <span className="muted"> · {c.count}</span> : null}</li>)}
          </ul>
        )}
        <div className="locked-cta" style={{ justifyContent: 'flex-start', margin: '22px 0 36px' }}>
          <button type="button" className="btn btn-primary btn-lg" onClick={openGate}><Icon.lock /> See prices and products</button>
          <Link to="/faq" className="btn btn-outline btn-lg">How ordering works</Link>
        </div>
        {others.length > 0 && (
          <>
            <h2 className="shelf-more">More shelves</h2>
            <ul className="shelf-links">
              {!fire && <li><Link to="/s/fire-sale">Fire Sale</Link></li>}
              {others.map(c => <li key={c.slug}><Link to={`/s/${c.slug}`}>{c.name}</Link></li>)}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
