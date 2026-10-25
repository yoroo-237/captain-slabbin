import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext.jsx'
import { useCart } from '../../context/CartContext.jsx'
import { useShop } from '../ShopContext.jsx'
import { Icon, money, ProductArt, productUrl } from '../lib.jsx'

export function shippingFor(subtotal, settings) {
  const cost = Number(settings.shipping_cost || 0)
  const freeAt = Number(settings.shipping_free_threshold || 0)
  return { freeAt, shipping: freeAt > 0 && subtotal >= freeAt ? 0 : cost }
}

// The cart. Every order is paid in the app from the crypto wallet (an account is
// created at checkout if needed); the paid invoice then goes to Telegram.
export default function CartPage() {
  const { items, subtotal, updateQuantity, removeItem, clearCart } = useCart()
  const { user, balance } = useApp()
  const { settings } = useShop()
  const navigate = useNavigate()

  const { freeAt, shipping } = shippingFor(subtotal, settings)
  const total = subtotal
  const toFree = freeAt > 0 ? Math.max(0, freeAt - subtotal) : 0
  const count = items.reduce((s, i) => s + i.quantity, 0)

  if (!items.length) {
    return (
      <div className="container empty" style={{ paddingTop: 64 }}>
        <span className="ic"><Icon.bag /></span>
        <h2 className="display">Your cart is empty</h2>
        <p>Browse the shelves and add what you like. You only need an account at checkout.</p>
        <div className="hero-cta"><Link to="/s/fire-sale" className="btn btn-red"><Icon.fire /> Shop the Fire Sale</Link><Link to="/s/all" className="btn btn-outline">Shop all</Link></div>
      </div>
    )
  }

  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link to="/">Home</Link><span className="sep">/</span><span className="current">Cart</span></nav>
      <section className="section" style={{ paddingTop: 16 }}>
        <div className="page-head">
          <h1 className="display">Your cart</h1>
          <p>{count} item{count === 1 ? '' : 's'}</p>
        </div>
        <div className="cart-layout">
          <div className="panel" style={{ paddingTop: 6, paddingBottom: 6 }}>
            {items.map(item => (
              <div key={item.id} className="cart-line">
                <Link to={productUrl(item)} className="cart-thumb">
                  {item.image ? <img src={item.image} alt="" /> : <ProductArt product={item} />}
                </Link>
                <div>
                  <div className="line-top">
                    <div>
                      <div className="card-cat">{item.category}</div>
                      <Link to={productUrl(item)} className="card-title">{item.name}</Link>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{money(item.price)}{item.unitLabel ? ` ${item.unitLabel}` : ''}</div>
                    </div>
                    <span className="line-price">{money(item.price * item.quantity)}</span>
                  </div>
                  <div className="line-bottom">
                    <div className="qty-box sm">
                      <button type="button" aria-label={item.quantity > 1 ? 'Decrease quantity' : `Remove ${item.name}`} onClick={() => item.quantity > 1 ? updateQuantity(item.id, item.quantity - 1) : removeItem(item.id)}>
                        {item.quantity > 1 ? <Icon.minus /> : <Icon.trash />}
                      </button>
                      <input type="text" inputMode="numeric" readOnly value={item.quantity} aria-label={`Quantity of ${item.name}`} />
                      <button type="button" aria-label="Increase quantity" disabled={item.stock != null && item.quantity >= item.stock} onClick={() => updateQuantity(item.id, item.quantity + 1)}><Icon.plus /></button>
                    </div>
                    <button className="btn-plain danger" type="button" onClick={() => removeItem(item.id)}>Remove</button>
                  </div>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0', borderTop: '1px solid var(--line)' }}>
              <Link to="/s/all" className="btn-plain"><Icon.back /> Continue shopping</Link>
              <button className="btn-plain danger" type="button" onClick={clearCart}>Clear cart</button>
            </div>
          </div>

          <aside className="panel">
            <div className="panel-title">Order summary</div>
            {freeAt > 0 && (toFree > 0 ? (
              <div className="ship-progress">
                You’re <b>{money(toFree)}</b> away from free shipping
                <div className="track"><div className="fill" style={{ width: `${Math.min(100, (subtotal / freeAt) * 100)}%` }} /></div>
              </div>
            ) : (
              <div className="ship-progress done"><Icon.truck /> You’ve unlocked free shipping</div>
            ))}
            <div className="summary-row"><span>Subtotal</span><span>{money(subtotal)}</span></div>
            <div className="summary-row"><span>Delivery</span><span className="muted" style={{ fontWeight: 600 }}>{shipping ? `${money(shipping)} if shipped` : 'Free if shipped'}</span></div>
            <div className="summary-row total"><span>Total</span><span>{money(total)}</span></div>
            <p className="summary-note" style={{ marginTop: 0 }}>Choose delivery or no delivery at checkout.</p>

            <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 16 }} onClick={() => navigate('/checkout')}>
              <Icon.lock /> Check out
            </button>
            <p className="summary-note" style={{ textAlign: 'center' }}>
              {user
                ? <>Paid from your wallet · balance <b>{money(balance)}</b></>
                : 'New here? You’ll create an account in seconds at checkout. No email needed.'}
            </p>
            <div className="perks" style={{ marginTop: 16 }}>
              <div><Icon.bolt /> Pay in one tap with crypto</div>
              <div><Icon.telegram /> Your paid invoice is sent to us on Telegram</div>
              <div><Icon.truck /> Optional delivery: discreet, tracked shipping</div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  )
}
