import { Link } from 'react-router-dom'
import { useCart } from '../../context/CartContext.jsx'
import { useShop } from '../ShopContext.jsx'
import { money, isOnSale, productUrl, ProductImage } from '../lib.jsx'

// Only what the cart needs is stored, so it survives catalog changes
export const toCartItem = p => ({
  id: p.id, sku: p.sku, slug: p.slug, name: p.name, price: Number(p.price),
  unitLabel: p.unitLabel, stock: p.stock, category: p.category?.name,
  image: p.images?.find(i => i.mediaType !== 'video')?.thumbnail || p.images?.find(i => i.mediaType !== 'video')?.url || null,
})

export default function ProductCard({ product }) {
  const { addItem, items } = useCart()
  const { toast } = useShop()
  const soldOut = product.stock <= 0
  const sale = isOnSale(product)
  const inBag = items.find(i => i.id === product.id)?.quantity || 0

  function add(e) {
    e.preventDefault()
    if (inBag >= product.stock) { toast(`Only ${product.stock} available.`); return }
    addItem(toCartItem(product), 1)
    toast(`${product.name} added to your bag`, { to: '/cart', label: 'View bag' })
  }

  return (
    <Link to={productUrl(product)} className="card">
      <div className="card-media">
        <div className="card-tags">
          {sale && <span className="tag tag-sale">Sale</span>}
          {product.badge && <span className="tag">{product.badge}</span>}
          {soldOut && <span className="tag tag-out">Sold out</span>}
        </div>
        <ProductImage product={product} />
      </div>
      <div className="card-body">
        <span className="card-cat">{product.category?.name}</span>
        <span className="card-title">{product.name}</span>
        <span className="card-price">
          {money(product.price)}
          {sale && <span className="was">{money(product.compareAtPrice)}</span>}
          {product.unitLabel && <span className="unit">{product.unitLabel}</span>}
        </span>
      </div>
      <button className="btn btn-outline btn-sm card-add" onClick={add} disabled={soldOut}>
        {soldOut ? 'Sold out' : inBag ? `In bag (${inBag}) · Add 1` : 'Add to bag'}
      </button>
    </Link>
  )
}
