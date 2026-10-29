import { useCallback, useEffect, useState } from 'react'
import { adminFetch } from '../../pages/admin/utils/api.js'

// The website and each bot catalog are separate shops across the admin (products,
// categories, orders, vouchers). The shop picked follows you from page to page.
const KEY = 'admin_shop'
const read = () => { try { return localStorage.getItem(KEY) || localStorage.getItem('admin_products_shop') || 'all' } catch { return 'all' } }

export function useShopFilter() {
  const [shops, setShops] = useState([])
  const [shop, setShopState] = useState(read)
  const reload = useCallback(() => adminFetch('/admin/products/shops').then(d => setShops(d || [])).catch(() => {}), [])
  useEffect(() => { reload() }, [reload])
  const setShop = useCallback(v => { setShopState(v); try { localStorage.setItem(KEY, v) } catch { /* storage blocked */ } }, [])
  // A shop that no longer exists falls back to all of them
  useEffect(() => { if (shops.length && shop !== 'all' && !shops.some(s => s.key === shop)) setShop('all') }, [shops, shop, setShop])
  const shopOf = key => shops.find(s => s.key === (key || 'site'))
  // Where something new goes from this view: the shop shown, the website from "All shops"
  const target = shop === 'all' ? 'site' : shop
  return { shops, shop, setShop, shopOf, target, reload, query: shop === 'all' ? '' : shop }
}

// counts: { [shopKey]: n } for this page; undefined = products; null = no counts
export default function ShopTabs({ filter, counts, note }) {
  const { shops, shop, setShop, shopOf } = filter
  if (shops.length < 2) return null
  const count = s => (counts === null ? null : counts ? counts[s.key] || 0 : s.count)
  const total = counts === null ? null : counts ? Object.values(counts).reduce((a, b) => a + b, 0) : shops.reduce((n, s) => n + s.count, 0)
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="admin-tabs" style={{ margin: 0, flexWrap: 'wrap' }} role="tablist" aria-label="Shop">
        {[{ key: 'all', label: 'All shops' }, ...shops].map(s => (
          <button key={s.key} type="button" role="tab" aria-selected={shop === s.key} className={'admin-tab' + (shop === s.key ? ' active' : '')}
            title={s.bots?.length ? `Sold by ${s.bots.join(', ')}` : s.key === 'site' ? 'The website and the shop’s own bot' : undefined}
            onClick={() => setShop(s.key)}>
            {s.label}{(s.key === 'all' ? total : count(s)) != null && <span style={{ color: '#888', fontWeight: 400 }}> ({s.key === 'all' ? total : count(s)})</span>}
          </button>
        ))}
      </div>
      {(shopOf(shop)?.bots?.length > 0 || note) && (
        <div className="admin-text-muted" style={{ fontSize: 13 }}>
          {shopOf(shop)?.bots?.length > 0 && `Sold by ${shopOf(shop).bots.join(', ')}. `}{note}
        </div>
      )}
    </div>
  )
}
