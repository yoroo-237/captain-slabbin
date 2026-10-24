import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { useApp } from '../../context/AppContext.jsx'
import { useCart } from '../../context/CartContext.jsx'
import { useShop } from '../ShopContext.jsx'
import { SignInForm, CreateAccountForm } from '../components/AuthForms.jsx'
import { Icon, money, Coin, fmtCrypto } from '../lib.jsx'

const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']
const EMPTY_ADDRESS = { name: '', street: '', apt: '', city: '', state: '', zip: '' }

function loadAddress() {
  try { return { ...EMPTY_ADDRESS, ...JSON.parse(localStorage.getItem('cs_address') || '{}') } } catch { return EMPTY_ADDRESS }
}

// Checkout paid from the crypto wallet. A guest creates an account (or signs in)
// right here without losing the bag; the order total is converted at the live
// price when the order is placed.
export default function CheckoutPage() {
  const { items, subtotal, clearCart } = useCart()
  const { user, balance, holdings, loadUserData, refreshBalance } = useApp()
  const { settings } = useShop()
  const [authTab, setAuthTab] = useState('create')
  const [address, setAddress] = useState(loadAddress)
  const [touched, setTouched] = useState(false)
  const [payCurrency, setPayCurrency] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [placed, setPlaced] = useState(null)

  useEffect(() => { if (user) refreshBalance?.() }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const shippingCost = Number(settings.shipping_cost || 0)
  const freeAt = Number(settings.shipping_free_threshold || 0)
  const shipping = freeAt > 0 && subtotal >= freeAt ? 0 : shippingCost
  const total = subtotal + shipping

  if (placed) {
    return (
      <div className="container" style={{ maxWidth: 560, paddingTop: 48, textAlign: 'center' }}>
        <div className="success-mark"><Icon.check /></div>
        <h1 className="frost-head" style={{ fontSize: 28 }}>Order confirmed</h1>
        <p className="muted" style={{ marginTop: 8 }}>Order <b style={{ color: 'var(--text)' }}>{placed.order.orderNumber}</b> is paid and being prepared.</p>
        <div className="panel" style={{ marginTop: 20, textAlign: 'left' }}>
          <div className="summary-row"><span>Total</span><span>{money(placed.order.totalAmount)}</span></div>
          {placed.payments.map(p => (
            <div key={p.currency} className="summary-row"><span>Paid in {p.currency}</span><span>{fmtCrypto(p.amount)} {p.currency} @ {money(p.rate)}</span></div>
          ))}
          <div className="summary-row"><span>Remaining balance</span><span>{money(placed.newBalance)}</span></div>
        </div>
        <div className="hero-cta">
          <Link to="/account/orders" className="btn btn-primary">Track my order</Link>
          <Link to="/" className="btn btn-outline">Keep shopping</Link>
        </div>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="container empty" style={{ paddingTop: 60 }}>
        <h2>Your bag is empty</h2>
        <Link to="/" className="btn btn-outline" style={{ marginTop: 16 }}>Back to the shop</Link>
      </div>
    )
  }

  const addrErrors = {
    name: !address.name.trim(), street: !address.street.trim(), city: !address.city.trim(),
    state: !address.state, zip: !/^\d{5}(-\d{4})?$/.test(address.zip.trim()),
  }
  const addressValid = !Object.values(addrErrors).some(Boolean)
  const payHolding = holdings.find(h => h.currency === payCurrency)
  const available = payHolding ? (payHolding.usd || 0) : balance
  const short = Math.max(0, total - available)
  const setA = k => e => setAddress(a => ({ ...a, [k]: e.target.value }))
  const bad = k => touched && addrErrors[k]

  async function placeOrder() {
    setTouched(true)
    if (!addressValid || short > 0) return
    setBusy(true); setError('')
    try {
      localStorage.setItem('cs_address', JSON.stringify(address))
      const a = address
      const data = await apiFetch('/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: items.map(i => ({ productId: i.id, quantity: i.quantity })),
          name: a.name.trim(),
          shippingAddress: `${a.street.trim()}${a.apt.trim() ? `, ${a.apt.trim()}` : ''}, ${a.city.trim()}, ${a.state} ${a.zip.trim()}, US`,
          paymentMethod: payCurrency || 'wallet',
          ...(payCurrency ? { payCurrency } : {}),
        }),
      })
      clearCart()
      setPlaced(data)
      loadUserData()
      window.scrollTo(0, 0)
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="container">
      <div className="breadcrumb"><Link to="/cart">Bag</Link><span className="sep">/</span><span className="current">Checkout</span></div>
      <section className="section" style={{ paddingTop: 14 }}>
        <h1 className="frost-head" style={{ fontSize: 26, marginBottom: 12 }}>Checkout</h1>
        <div className="steps" aria-hidden="true">
          <span className={user ? '' : 'on'}>1 · Account</span><span>›</span>
          <span className={user ? 'on' : ''}>2 · Delivery</span><span>›</span>
          <span className={user ? 'on' : ''}>3 · Payment</span>
        </div>

        <div className="cart-layout">
          <div style={{ display: 'grid', gap: 16 }}>
            {!user ? (
              <div className="panel">
                <div className="chips" role="tablist">
                  <button className={'chip' + (authTab === 'create' ? ' active' : '')} onClick={() => setAuthTab('create')} role="tab" aria-selected={authTab === 'create'}>New here? Create account</button>
                  <button className={'chip' + (authTab === 'signin' ? ' active' : '')} onClick={() => setAuthTab('signin')} role="tab" aria-selected={authTab === 'signin'}>I have an account</button>
                </div>
                <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
                  Orders on the site are paid from a crypto wallet, which needs an account. Your bag is kept.
                  {' '}Prefer not to? <Link to="/cart" style={{ textDecoration: 'underline' }}>Send the order on Telegram</Link> instead.
                </p>
                {authTab === 'create' ? <CreateAccountForm submitLabel="Create account & continue" /> : <SignInForm />}
              </div>
            ) : (
              <>
                <div className="panel">
                  <div className="panel-title">Delivery address</div>
                  <div className="field">
                    <label htmlFor="a-name">Full name</label>
                    <input id="a-name" className={'input' + (bad('name') ? ' invalid' : '')} autoComplete="name" value={address.name} onChange={setA('name')} />
                    {bad('name') && <span className="error">Required</span>}
                  </div>
                  <div className="field">
                    <label htmlFor="a-street">Street address</label>
                    <input id="a-street" className={'input' + (bad('street') ? ' invalid' : '')} autoComplete="address-line1" value={address.street} onChange={setA('street')} />
                    {bad('street') && <span className="error">Required</span>}
                  </div>
                  <div className="field">
                    <label htmlFor="a-apt">Apt, suite, etc. <span className="muted">(optional)</span></label>
                    <input id="a-apt" className="input" autoComplete="address-line2" value={address.apt} onChange={setA('apt')} />
                  </div>
                  <div className="row-3">
                    <div className="field">
                      <label htmlFor="a-city">City</label>
                      <input id="a-city" className={'input' + (bad('city') ? ' invalid' : '')} autoComplete="address-level2" value={address.city} onChange={setA('city')} />
                    </div>
                    <div className="field">
                      <label htmlFor="a-state">State</label>
                      <select id="a-state" className={'select input' + (bad('state') ? ' invalid' : '')} autoComplete="address-level1" value={address.state} onChange={setA('state')}>
                        <option value="">—</option>
                        {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="a-zip">ZIP code</label>
                      <input id="a-zip" className={'input' + (bad('zip') ? ' invalid' : '')} inputMode="numeric" autoComplete="postal-code" maxLength={10} value={address.zip} onChange={setA('zip')} />
                      {bad('zip') && <span className="error">5-digit ZIP</span>}
                    </div>
                  </div>
                  <p className="hint muted" style={{ fontSize: 12 }}>Shipped in discreet, unmarked packaging.</p>
                </div>

                <div className="panel">
                  <div className="panel-title">Pay with</div>
                  {holdings.length === 0 ? (
                    <div className="alert alert-info" style={{ margin: 0 }}>
                      Your wallet is empty. <Link to="/account/wallet?from=checkout" style={{ textDecoration: 'underline', fontWeight: 700 }}>Add funds with crypto</Link> — your bag will be waiting.
                    </div>
                  ) : (
                    <div className="pay-options" role="radiogroup">
                      <label className={'pay-option' + (!payCurrency ? ' on' : '')}>
                        <input type="radio" name="pay" checked={!payCurrency} onChange={() => setPayCurrency('')} />
                        <span><b>Automatic</b><br /><span className="muted" style={{ fontSize: 12 }}>Uses your largest balance first</span></span>
                        <span className="amt"><b>{money(balance)}</b></span>
                      </label>
                      {holdings.length > 1 && holdings.map(h => (
                        <label key={h.currency} className={'pay-option' + (payCurrency === h.currency ? ' on' : '')}>
                          <input type="radio" name="pay" checked={payCurrency === h.currency} onChange={() => setPayCurrency(h.currency)} />
                          <Coin currency={h.currency} />
                          <span><b>{h.currency}</b><br /><span className="muted" style={{ fontSize: 12 }}>{fmtCrypto(h.amount)}</span></span>
                          <span className="amt"><b>{h.usd != null ? money(h.usd) : '—'}</b></span>
                        </label>
                      ))}
                    </div>
                  )}
                  {payHolding?.price && (
                    <p className="summary-note">≈ {fmtCrypto(total / payHolding.price)} {payCurrency} at the current price.</p>
                  )}
                  <p className="summary-note">The total is converted at the live price when you place the order — that amount of crypto is locked in, whatever the market does next.</p>
                  {short > 0 && holdings.length > 0 && (
                    <div className="alert alert-error" style={{ marginTop: 12, marginBottom: 0 }}>
                      You need {money(short)} more{payHolding ? ` in ${payCurrency}` : ''}. <Link to="/account/wallet?from=checkout" style={{ textDecoration: 'underline', fontWeight: 700 }}>Add funds</Link>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <aside className="panel">
            <div className="panel-title">Order summary</div>
            {items.map(i => (
              <div key={i.id} className="summary-row"><span>{i.quantity} × {i.name}</span><span>{money(i.price * i.quantity)}</span></div>
            ))}
            <div className="summary-row" style={{ borderTop: '1px solid var(--trim-soft)', marginTop: 6, paddingTop: 10 }}><span>Subtotal</span><span>{money(subtotal)}</span></div>
            <div className="summary-row"><span>Shipping</span><span>{shipping ? money(shipping) : 'Free'}</span></div>
            <div className="summary-row total"><span>Total</span><span>{money(total)}</span></div>
            {error && <div className="alert alert-error" style={{ marginTop: 12 }} role="alert">{error}</div>}
            <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={placeOrder} disabled={!user || busy || short > 0 || holdings.length === 0}>
              <Icon.lock /> {busy ? 'Placing order…' : `Place order · ${money(total)}`}
            </button>
            {!user && <p className="summary-note">Create an account or sign in to continue.</p>}
            {user && touched && !addressValid && <p className="summary-note" style={{ color: 'var(--blood-hi)' }}>Please complete your delivery address.</p>}
          </aside>
        </div>
      </section>
    </div>
  )
}
