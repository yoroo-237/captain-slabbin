import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { useApp } from '../../context/AppContext.jsx'
import { useCart } from '../../context/CartContext.jsx'
import { useShop } from '../ShopContext.jsx'
import { SignInForm, CreateAccountForm } from '../components/AuthForms.jsx'
import { shippingFor } from './CartPage.jsx'
import { Icon, money, Coin, fmtCrypto, ProductArt } from '../lib.jsx'
import { smokePuff } from '../components/smoke.js'

const STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'],
  ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'],
  ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
]
const EMPTY_ADDRESS = { name: '', street: '', apt: '', city: '', state: '', zip: '' }

// Kept on this device only, to prefill the next delivery
function loadAddress() {
  try { return { ...EMPTY_ADDRESS, ...JSON.parse(localStorage.getItem('cs_address') || '{}') } } catch { return EMPTY_ADDRESS }
}

// Checkout paid in the app from the crypto wallet. A guest creates an account (or
// signs in) right here without losing the cart; the order total is converted at
// the live price when the order is placed, and the paid invoice goes to Telegram.
// Nothing is required from the customer: the Telegram username/ID is optional
// (asked only when the profile has none), and delivery is an option — choosing it
// asks for a US address, adds shipping and puts the address on the invoice.
export default function CheckoutPage() {
  const { items, subtotal, clearCart } = useCart()
  const { user, balance, holdings, loadUserData, refreshBalance } = useApp()
  const { settings } = useShop()
  const [authTab, setAuthTab] = useState('create')
  const [profileHandle, setProfileHandle] = useState(null)
  const [telegram, setTelegram] = useState('')
  const [delivery, setDelivery] = useState(false)
  const [address, setAddress] = useState(loadAddress)
  const [touched, setTouched] = useState(false)
  const [payCurrency, setPayCurrency] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [placed, setPlaced] = useState(null)

  useEffect(() => {
    if (!user) return
    refreshBalance?.()
    apiFetch('/profile').then(p => setProfileHandle(p.telegramHandle || '')).catch(() => setProfileHandle(''))
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const shipping = delivery ? shippingFor(subtotal, settings).shipping : 0
  const total = subtotal + shipping

  if (placed) return <OrderPlaced placed={placed} />

  if (!items.length) {
    return (
      <div className="container empty" style={{ paddingTop: 64 }}>
        <span className="ic"><Icon.bag /></span>
        <h2>Your cart is empty</h2>
        <div className="hero-cta"><Link to="/s/all" className="btn btn-primary">Shop all products</Link></div>
      </div>
    )
  }

  const payHolding = holdings.find(h => h.currency === payCurrency)
  const available = payHolding ? (payHolding.usd || 0) : balance
  const short = Math.max(0, total - available)
  const addrErrors = {
    name: !address.name.trim(), street: !address.street.trim(), city: !address.city.trim(),
    state: !address.state, zip: !/^\d{5}(-\d{4})?$/.test(address.zip.trim()),
  }
  const addressOk = !delivery || !Object.values(addrErrors).some(Boolean)
  const setA = k => e => setAddress(a => ({ ...a, [k]: k === 'zip' ? e.target.value.replace(/[^\d-]/g, '') : e.target.value }))
  const bad = k => touched && addrErrors[k]
  const step = !user ? 1 : 2

  async function placeOrder() {
    setTouched(true)
    if (!addressOk) { document.getElementById('delivery')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
    if (short > 0) return
    setBusy(true); setError('')
    try {
      if (delivery) { try { localStorage.setItem('cs_address', JSON.stringify(address)) } catch { /* storage blocked */ } }
      const data = await apiFetch('/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: items.map(i => ({ productId: i.id, quantity: i.quantity })),
          ...(!profileHandle && telegram.trim() ? { telegram: telegram.trim() } : {}),
          ...(delivery ? { delivery: { ...address, zip: address.zip.trim() } } : {}),
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

  const Step = ({ n, label }) => (
    <li className={step === n ? 'on' : step > n ? 'done' : ''}>
      <span className="n">{step > n ? <Icon.check /> : n}</span><span className="t">{label}</span>
    </li>
  )

  return (
    <div className="container">
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link to="/cart">Cart</Link><span className="sep">/</span><span className="current">Checkout</span></nav>
      <section className="section" style={{ paddingTop: 16 }}>
        <div className="page-head"><h1 className="display">Checkout</h1></div>
        <ol className="steps" aria-label="Checkout steps">
          <Step n={1} label="Account" /><Step n={2} label="Payment" />
        </ol>

        <div className="cart-layout">
          <div className="stack">
            {!user ? (
              <div className="panel step-panel">
                <div className="panel-title"><span className="n">1</span> Your account</div>
                <div className="auth-tabs" role="tablist">
                  <button role="tab" aria-selected={authTab === 'create'} onClick={() => setAuthTab('create')}>New customer</button>
                  <button role="tab" aria-selected={authTab === 'signin'} onClick={() => setAuthTab('signin')}>Returning customer</button>
                </div>
                <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
                  Orders are paid in the app from your crypto wallet, which needs an account. Just a username and password. No email, name or address, and your cart is kept.
                </p>
                {authTab === 'create' ? <CreateAccountForm submitLabel="Create account & continue" /> : <SignInForm />}
              </div>
            ) : (
              <>
                {profileHandle === '' && (
                  <div className="panel">
                    <div className="panel-title"><Icon.telegram /> Telegram <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>(optional)</span></div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label htmlFor="co-tg">Your Telegram username or ID</label>
                      <input id="co-tg" className="input" placeholder="@username" autoComplete="off" value={telegram} onChange={e => setTelegram(e.target.value)} />
                      <span className="hint">Added to your invoice so the shop can reach you, and saved to your profile. We don’t ask for anything else.</span>
                    </div>
                  </div>
                )}

                <div className="panel" id="delivery" style={{ scrollMarginTop: 140 }}>
                  <div className="panel-title"><Icon.truck /> Delivery</div>
                  <div className="pay-options" role="radiogroup" aria-label="Delivery">
                    <label className={'pay-option' + (delivery ? ' on' : '')}>
                      <input type="radio" name="delivery" checked={delivery} onChange={() => setDelivery(true)} />
                      <span><b>Ship it to me</b><br /><span className="muted" style={{ fontSize: 12 }}>Discreet, tracked shipping anywhere in the US</span></span>
                      <span className="amt"><b>{shippingFor(subtotal, settings).shipping ? money(shippingFor(subtotal, settings).shipping) : 'Free'}</b></span>
                    </label>
                    <label className={'pay-option' + (!delivery ? ' on' : '')}>
                      <input type="radio" name="delivery" checked={!delivery} onChange={() => setDelivery(false)} />
                      <span><b>No delivery</b><br /><span className="muted" style={{ fontSize: 12 }}>We’ll sort it out with you on Telegram</span></span>
                      <span className="amt"><b>$0.00</b></span>
                    </label>
                  </div>

                  {delivery && (
                    <div style={{ marginTop: 18 }}>
                      <div className="field">
                        <label htmlFor="a-name">Full name</label>
                        <input id="a-name" className={'input' + (bad('name') ? ' invalid' : '')} autoComplete="shipping name" value={address.name} onChange={setA('name')} />
                        {bad('name') && <span className="error">Enter the name on the package</span>}
                      </div>
                      <div className="field">
                        <label htmlFor="a-street">Street address</label>
                        <input id="a-street" className={'input' + (bad('street') ? ' invalid' : '')} autoComplete="shipping address-line1" placeholder="123 Main St" value={address.street} onChange={setA('street')} />
                        {bad('street') && <span className="error">Enter a street address</span>}
                      </div>
                      <div className="field">
                        <label htmlFor="a-apt">Apt, suite, unit <span className="muted">(optional)</span></label>
                        <input id="a-apt" className="input" autoComplete="shipping address-line2" value={address.apt} onChange={setA('apt')} />
                      </div>
                      <div className="row-3">
                        <div className="field">
                          <label htmlFor="a-city">City</label>
                          <input id="a-city" className={'input' + (bad('city') ? ' invalid' : '')} autoComplete="shipping address-level2" value={address.city} onChange={setA('city')} />
                          {bad('city') && <span className="error">Required</span>}
                        </div>
                        <div className="field">
                          <label htmlFor="a-state">State</label>
                          <select id="a-state" className={'select' + (bad('state') ? ' invalid' : '')} autoComplete="shipping address-level1" value={address.state} onChange={setA('state')}>
                            <option value="">Select</option>
                            {STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                          </select>
                          {bad('state') && <span className="error">Required</span>}
                        </div>
                        <div className="field">
                          <label htmlFor="a-zip">ZIP code</label>
                          <input id="a-zip" className={'input' + (bad('zip') ? ' invalid' : '')} inputMode="numeric" autoComplete="shipping postal-code" placeholder="12345" maxLength={10} value={address.zip} onChange={setA('zip')} />
                          {bad('zip') && <span className="error">5-digit ZIP</span>}
                        </div>
                      </div>
                      <p className="summary-note" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 0 }}><Icon.box /> Shipped in discreet, unmarked packaging. Your address goes on the invoice the shop receives on Telegram.</p>
                    </div>
                  )}
                </div>

                <div className="panel step-panel">
                  <div className="panel-title"><span className="n">2</span> Payment</div>
                  {holdings.length === 0 ? (
                    <div className="alert alert-info" style={{ margin: 0 }}>
                      <Icon.wallet />
                      <span>Your wallet is empty. <Link to="/account/wallet?from=checkout" className="link">Add funds with crypto</Link>. Your cart will be waiting.</span>
                    </div>
                  ) : (
                    <div className="pay-options" role="radiogroup" aria-label="Pay with">
                      <label className={'pay-option' + (!payCurrency ? ' on' : '')}>
                        <input type="radio" name="pay" checked={!payCurrency} onChange={() => setPayCurrency('')} />
                        <span><b>Wallet balance</b><br /><span className="muted" style={{ fontSize: 12 }}>Uses your largest holding first</span></span>
                        <span className="amt"><b>{money(balance)}</b></span>
                      </label>
                      {holdings.length > 1 && holdings.map(h => (
                        <label key={h.currency} className={'pay-option' + (payCurrency === h.currency ? ' on' : '')}>
                          <input type="radio" name="pay" checked={payCurrency === h.currency} onChange={() => setPayCurrency(h.currency)} />
                          <Coin currency={h.currency} />
                          <span><b>{h.currency}</b><br /><span className="muted" style={{ fontSize: 12 }}>{fmtCrypto(h.amount)}</span></span>
                          <span className="amt"><b>{h.usd != null ? money(h.usd) : 'N/A'}</b></span>
                        </label>
                      ))}
                    </div>
                  )}
                  {payHolding?.price && (
                    <p className="summary-note">≈ {fmtCrypto(total / payHolding.price)} {payCurrency} at today’s price.</p>
                  )}
                  <p className="summary-note">The total is converted at the live price when you place the order and that amount is locked in. Once paid, your invoice is sent to the shop on Telegram.</p>
                  {short > 0 && holdings.length > 0 && (
                    <div className="alert alert-warn" style={{ marginTop: 12, marginBottom: 0 }}>
                      <Icon.alert />
                      <span>You need <b>{money(short)}</b> more{payHolding ? ` in ${payCurrency}` : ''}. <Link to="/account/wallet?from=checkout" className="link">Add funds</Link></span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <aside className="panel">
            <div className="panel-title">Order summary</div>
            <div className="summary-items">
              {items.map(i => (
                <div key={i.id} className="summary-item">
                  <span className="thumb-wrap">
                    <span className="cart-thumb">{i.image ? <img src={i.image} alt="" /> : <ProductArt product={i} />}</span>
                    <span className="q">{i.quantity}</span>
                  </span>
                  <span className="nm">{i.name}</span>
                  <span className="pr">{money(i.price * i.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="summary-row"><span>Subtotal</span><span>{money(subtotal)}</span></div>
            <div className="summary-row"><span>Delivery</span><span className={shipping || !delivery ? '' : 'free'}>{!delivery ? 'None' : shipping ? money(shipping) : 'Free'}</span></div>
            <div className="summary-row total"><span>Total</span><span>{money(total)}</span></div>
            {error && <div className="alert alert-error" style={{ marginTop: 12 }} role="alert"><Icon.alert /><span>{error}</span></div>}
            <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 16 }} onClick={placeOrder} disabled={!user || busy || short > 0 || holdings.length === 0}>
              <Icon.lock /> {busy ? 'Placing order…' : `Place order · ${money(total)}`}
            </button>
            {!user && <p className="summary-note" style={{ textAlign: 'center' }}>Create an account or sign in to continue.</p>}
            {user && touched && !addressOk && <p className="summary-note" style={{ color: 'var(--blood-hi)', textAlign: 'center' }}>Please complete your delivery address.</p>}
            <div className="secure-row">
              <span><Icon.lock /> Secure checkout</span>
              <span><Icon.telegram /> Invoice on Telegram</span>
              <span><Icon.shield /> Private</span>
            </div>
          </aside>
        </div>
      </section>
    </div>
  )
}

// Paid: the order recap. The invoice (a copy of the order) just goes to Telegram
function OrderPlaced({ placed }) {
  const { order, payments, newBalance, invoice } = placed
  const markRef = useRef(null)
  useEffect(() => { const id = setTimeout(() => smokePuff(markRef.current, 220), 250); return () => clearTimeout(id) }, [])

  return (
    <div className="container" style={{ maxWidth: 620, paddingTop: 48 }}>
      <div style={{ textAlign: 'center' }}>
        <div className="success-mark" ref={markRef}><Icon.check /></div>
        <h1 className="display" style={{ fontSize: 'clamp(40px, 8vw, 60px)', marginTop: 6 }}>Order confirmed</h1>
        <p className="muted" style={{ marginTop: 10 }}>Order <b style={{ color: 'var(--text)' }}>{order.orderNumber}</b> is paid. The shop will contact you on Telegram to finish up.</p>
      </div>

      <div className="panel" style={{ marginTop: 24 }}>
        <div className="summary-row"><span>Total</span><span>{money(order.totalAmount)}</span></div>
        {payments.map(p => (
          <div key={p.currency} className="summary-row"><span>Paid in {p.currency}</span><span>{fmtCrypto(p.amount)} {p.currency} @ {money(p.rate)}</span></div>
        ))}
        <div className="summary-row"><span>Remaining balance</span><span>{money(newBalance)}</span></div>
      </div>

      {invoice && (
        <div className={'alert ' + (invoice.delivered ? 'alert-ok' : 'alert-info')} style={{ marginTop: 16, marginBottom: 0 }}>
          <Icon.telegram />
          <span>{invoice.delivered ? 'Your invoice has been sent to the shop on Telegram.' : 'Open Telegram to send your invoice to the shop.'}</span>
        </div>
      )}

      <div className="hero-cta" style={{ marginTop: 24 }}>
        {invoice?.shopTelegramUrl && <a className="btn btn-telegram" href={invoice.shopTelegramUrl} target="_blank" rel="noreferrer"><Icon.telegram /> Open Telegram</a>}
        <Link to="/account/orders" className="btn btn-primary"><Icon.box /> Track my order</Link>
        <Link to="/" className="btn btn-outline">Keep shopping</Link>
      </div>
    </div>
  )
}
