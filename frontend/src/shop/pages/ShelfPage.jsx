import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { useShop } from '../ShopContext.jsx'
import ProductCard from '../components/ProductCard.jsx'
import { Icon } from '../lib.jsx'

const SORTS = [
  ['featured',   'Featured'],
  ['price_asc',  'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['latest',     'Newest'],
  ['name',       'Name A–Z'],
]
const PRICE_BANDS = [
  ['', '', 'Any price'], ['', '50', 'Under $50'], ['50', '250', '$50 – $250'], ['250', '1000', '$250 – $1,000'], ['1000', '', '$1,000+'],
]
const PER_PAGE = 24

// /s/:slug — one shelf with search, sort, sub-shelf chips, price/stock filters
// and pagination. Every filter lives in the URL so links and Back work.
export default function ShelfPage() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const { shelves } = useShop()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [search, setSearch] = useState(params.get('q') || '')

  const sub = params.get('sub') || ''
  const sort = params.get('sort') || 'featured'
  const page = Math.max(1, parseInt(params.get('page') || '1', 10))
  const min = params.get('min') || ''
  const max = params.get('max') || ''
  const inStock = params.get('stock') === '1'
  const q = params.get('q') || ''

  const shelf = slug === 'fire-sale'
    ? { slug, name: 'Fire Sale', children: [] }
    : shelves.categories.find(c => c.slug === slug)
  const title = shelf?.children.find(c => c.slug === sub)?.name || shelf?.name || slug.replace(/-/g, ' ')

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k)
    if (!('page' in changes)) next.delete('page')
    setParams(next, { replace: !('page' in changes) })
  }

  // Search as you type, without a request per keystroke
  useEffect(() => {
    if (search === q) return
    const id = setTimeout(() => update({ q: search.trim() }), 350)
    return () => clearTimeout(id)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(() => {
    const qs = new URLSearchParams({ category: sub || slug, sort, page: String(page), limit: String(PER_PAGE) })
    if (q) qs.set('search', q)
    if (min) qs.set('minPrice', min)
    if (max) qs.set('maxPrice', max)
    if (inStock) qs.set('inStock', '1')
    return qs.toString()
  }, [slug, sub, sort, page, q, min, max, inStock])

  useEffect(() => {
    let live = true
    setData(null)
    setError('')
    apiFetch(`/products?${query}`)
      .then(d => live && setData(d))
      .catch(e => live && setError(e.message))
    return () => { live = false }
  }, [query])

  const activeFilters = [min || max, inStock, q].filter(Boolean).length
  const totalPages = data?.pagination?.totalPages || 1

  const filters = (
    <aside className={'filters panel' + (filtersOpen ? ' open' : '')} aria-label="Filters">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="panel-title" style={{ margin: 0 }}>Filters</span>
        {filtersOpen && <button className="icon-btn" aria-label="Close filters" onClick={() => setFiltersOpen(false)}><Icon.close /></button>}
      </div>
      {shelf?.children?.length > 0 && (
        <>
          <h3>Type</h3>
          {[{ slug: '', name: `All ${shelf.name}`, count: shelf.count }, ...shelf.children].map(c => (
            <label key={c.slug || 'all'} className="filter-row">
              <span className="check"><input type="radio" name="sub" checked={sub === c.slug} onChange={() => update({ sub: c.slug })} /> {c.name}</span>
              <span className="count">{c.count}</span>
            </label>
          ))}
        </>
      )}
      <h3>Price</h3>
      {PRICE_BANDS.map(([lo, hi, label]) => (
        <label key={label} className="filter-row">
          <span className="check"><input type="radio" name="price" checked={min === lo && max === hi} onChange={() => update({ min: lo, max: hi })} /> {label}</span>
        </label>
      ))}
      <h3>Availability</h3>
      <label className="filter-row">
        <span className="check"><input type="checkbox" checked={inStock} onChange={e => update({ stock: e.target.checked ? '1' : '' })} /> In stock only</span>
      </label>
      {activeFilters > 0 && (
        <button className="btn btn-outline btn-sm btn-block" style={{ marginTop: 14 }} onClick={() => { setSearch(''); update({ q: '', min: '', max: '', stock: '' }) }}>Clear filters</button>
      )}
      {filtersOpen && <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={() => setFiltersOpen(false)}>Show results</button>}
    </aside>
  )

  return (
    <div className="container" id="shelf">
      <div className="breadcrumb">
        <Link to="/">Home</Link><span className="sep">/</span>
        {sub && shelf ? <><Link to={`/s/${slug}`}>{shelf.name}</Link><span className="sep">/</span></> : null}
        <span className="current">{title}</span>
      </div>

      <section className="section" style={{ paddingTop: 14 }}>
        <div className="shop-toolbar">
          <div>
            <h1 className={'frost-head' + (slug === 'fire-sale' ? ' blood-text' : '')}>{title}</h1>
            <span className="count-txt">{data ? `${data.pagination.total} product${data.pagination.total === 1 ? '' : 's'}` : 'Loading…'}</span>
          </div>
          <div className="shop-tools">
            <div className="search-box">
              <Icon.search />
              <input className="input" type="search" placeholder="Search name or SKU" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search products" />
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
            <button className={'chip' + (!sub ? ' active' : '')} onClick={() => update({ sub: '' })}>All</button>
            {shelf.children.map(c => (
              <button key={c.slug} className={'chip' + (sub === c.slug ? ' active' : '')} onClick={() => update({ sub: c.slug })}>{c.name}</button>
            ))}
          </div>
        )}

        <div className="shop-layout">
          {filters}
          {filtersOpen && <button className="drawer-backdrop" aria-label="Close filters" onClick={() => setFiltersOpen(false)} />}
          <div>
            {error ? (
              <div className="alert alert-error">{error}</div>
            ) : !data ? (
              <div className="grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" style={{ aspectRatio: '3 / 4' }} />)}</div>
            ) : data.products.length === 0 ? (
              <div className="empty">
                <h2>Nothing here{activeFilters ? ' with these filters' : ' yet'}</h2>
                <p>{activeFilters ? 'Try removing a filter.' : 'New drops land every week — check the other shelves meanwhile.'}</p>
                {activeFilters > 0 && <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={() => { setSearch(''); update({ q: '', min: '', max: '', stock: '' }) }}>Clear the filters</button>}
              </div>
            ) : (
              <>
                <div className="grid">{data.products.map(p => <ProductCard key={p.id} product={p} />)}</div>
                {totalPages > 1 && (
                  <nav className="pagination" aria-label="Pages">
                    <button disabled={page <= 1} onClick={() => update({ page: String(page - 1) })} aria-label="Previous page">←</button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
                      .map(n => <button key={n} className={n === page ? 'active' : ''} onClick={() => update({ page: String(n) })} aria-current={n === page ? 'page' : undefined}>{n}</button>)}
                    <button disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })} aria-label="Next page">→</button>
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
