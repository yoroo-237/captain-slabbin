import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { useApp } from '../../context/AppContext.jsx'
import { useCart } from '../../context/CartContext.jsx'
import { useShop } from '../ShopContext.jsx'
import { Icon, money, copyText, ProductArt, productUrl } from '../lib.jsx'

// The bag, with two ways to order:
//   1. Checkout on the site, paid from the crypto wallet (account created at checkout if needed)
//   2. Send the order to the shop on Telegram — no account needed. If the
//      customer is signed in with a Telegram username on their profile, it is added.
export default function CartPage() {
  const { items, subtotal, updateQuantity, removeItem, clearCart } = useCart()
  const { user, balance } = useApp()
  const { settings } = useShop()
  const navigate = useNavigate()
  const [sendOpen, setSendOpen] = useState(false)

  const shippingCost = Number(settings.shipping_cost || 0)
  const freeAt = Number(settings.shipping_free_threshold || 0)
  const shipping = !items.length ? 0 : freeAt > 0 && subtotal >= freeAt ? 0 : shippingCost
  const total = subtotal + shipping
  const toFree = freeAt > 0 ? Math.max(0, freeAt - subtotal) : 0

  if (!items.length) {
    return (
      <div className="container empty" style={{ paddingTop: 60 }}>
        <h2 className="frost-head" style={{ fontSize: 26 }}>Your bag is empty</h2>
        <p>Browse the shelves and add what you like — no account needed.</p>
        <div className="hero-cta"><Link to="/s/fire-sale" className="btn btn-red">Shop the Fire Sale</Link><Link to="/s/flower" className="btn btn-outline">Browse flower</Link></div>
      </div>
    )
  }

  return (
    <div className="container">
      <div className="breadcrumb"><Link to="/">Home</Link><span className="sep">/</span><span className="current">Bag</span></div>
      <section className="section" style={{ paddingTop: 14 }}>
        <h1 className="frost-head" style={{ fontSize: 26, marginBottom: 18 }}>Your bag</h1>
        <div className="cart-layout">
          <div className="panel" style={{ paddingTop: 4, paddingBottom: 4 }}>
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
                      <div className="muted" style={{ fontSize: 12 }}>{money(item.price)}{item.unitLabel ? ` ${item.unitLabel}` : ''}{item.sku ? ` · ${item.sku}` : ''}</div>
                    </div>
                    <span className="line-price">{money(item.price * item.quantity)}</span>
                  </div>
                  <div className="line-bottom">
                    <div className="qty-box sm">
                      <button type="button" aria-label="One fewer" onClick={() => item.quantity > 1 ? updateQuantity(item.id, item.quantity - 1) : removeItem(item.id)}>−</button>
                      <input type="text" inputMode="numeric" readOnly value={item.quantity} aria-label={`Quantity of ${item.name}`} />
                      <button type="button" aria-label="One more" disabled={item.stock != null && item.quantity >= item.stock} onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</button>
                    </div>
                    <button className="btn-plain" type="button" onClick={() => removeItem(item.id)}>Remove</button>
                  </div>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0' }}>
              <Link to="/" className="btn-plain">← Keep shopping</Link>
              <button className="btn-plain" type="button" onClick={clearCart}>Empty bag</button>
            </div>
          </div>

          <aside className="panel">
            <div className="panel-title">Order summary</div>
            {freeAt > 0 && (
              <div className="ship-progress">
                {toFree > 0 ? <>Add <b>{money(toFree)}</b> for free shipping</> : <><Icon.check /> You’ve unlocked free shipping</>}
                <div className="track"><div className="fill" style={{ width: `${Math.min(100, (subtotal / freeAt) * 100)}%` }} /></div>
              </div>
            )}
            <div className="summary-row"><span>Subtotal</span><span>{money(subtotal)}</span></div>
            <div className="summary-row"><span>Shipping</span><span>{shipping ? money(shipping) : 'Free'}</span></div>
            <div className="summary-row total"><span>Total</span><span>{money(total)}</span></div>

            <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={() => navigate('/checkout')}>
              <Icon.lock /> Checkout
            </button>
            <p className="summary-note">
              {user ? <>Paid from your wallet · balance <b>{money(balance)}</b></> : 'No account yet? You’ll create one in a few seconds at checkout.'}
            </p>

            <div className="or-divider">or</div>
            {!sendOpen ? (
              <button className="btn btn-telegram btn-block" onClick={() => setSendOpen(true)}><Icon.telegram /> Send order on Telegram</button>
            ) : (
              <TelegramSend onDone={clearCart} />
            )}
            <p className="summary-note">Telegram orders are confirmed by the shop by message — no account needed.</p>
          </aside>
        </div>
      </section>
    </div>
  )
}

function TelegramSend({ onDone }) {
  const { items } = useCart()
  const { user } = useApp()
  const { settings } = useShop()
  const [profileHandle, setProfileHandle] = useState(null)
  const [telegram, setTelegram] = useState('')
  const [contact, setContact] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (user) apiFetch('/profile').then(p => setProfileHandle(p.telegramHandle || '')).catch(() => setProfileHandle(''))
  }, [user])

  async function send(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await apiFetch('/telegram/invoice', {
        method: 'POST',
        body: JSON.stringify({
          items: items.map(i => ({ productId: i.id, quantity: i.quantity })),
          telegram: profileHandle ? undefined : telegram.trim() || undefined,
          contact: contact.trim() || undefined,
          note: note.trim() || undefined,
        }),
      })
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (await copyText(result.text)) { setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  if (result) {
    return (
      <div className="send-panel">
        <div className={'alert ' + (result.delivered ? 'alert-ok' : 'alert-info')} style={{ marginBottom: 0 }}>
          {result.delivered
            ? <>Order <b>{result.code}</b> sent to the shop. We’ll message you on Telegram shortly.</>
            : <>Order <b>{result.code}</b> is ready. Send it to us on Telegram to confirm.</>}
        </div>
        <pre className="invoice-text">{result.text}</pre>
        <div className="send-actions">
          {result.shopTelegramUrl && (
            <a className="btn btn-telegram btn-block" href={result.shopTelegramUrl} target="_blank" rel="noreferrer"><Icon.telegram /> Open Telegram</a>
          )}
          <button className="btn btn-outline btn-block" type="button" onClick={copy}><Icon.copy /> {copied ? 'Copied!' : 'Copy the invoice'}</button>
          {settings.signal_url && <a className="btn btn-outline btn-block" href={settings.signal_url} target="_blank" rel="noreferrer">Send on Signal</a>}
        </div>
        <button className="btn-plain" type="button" style={{ marginTop: 10 }} onClick={onDone}>Done — empty my bag</button>
      </div>
    )
  }

  return (
    <form onSubmit={send}>
      {error && <div className="alert alert-error">{error}</div>}
      {user && profileHandle ? (
        <p className="summary-note" style={{ marginBottom: 12 }}>Your Telegram <b>@{profileHandle.replace(/^@/, '')}</b> will be included so we can reach you.</p>
      ) : (
        <div className="field">
          <label htmlFor="tg-user">Your Telegram username</label>
          <input id="tg-user" className="input" placeholder="@username" value={telegram} onChange={e => setTelegram(e.target.value)} autoComplete="off" />
          <span className="hint">{user ? <>Optional · save it in <Link to="/account/profile" style={{ textDecoration: 'underline' }}>your profile</Link> to skip this next time.</> : 'Optional, so we can message you back.'}</span>
        </div>
      )}
      <div className="field">
        <label htmlFor="tg-contact">Other contact <span className="muted">(optional)</span></label>
        <input id="tg-contact" className="input" placeholder="Phone or Signal" value={contact} onChange={e => setContact(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="tg-note">Note <span className="muted">(optional)</span></label>
        <textarea id="tg-note" className="textarea" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} />
      </div>
      <button className="btn btn-telegram btn-block" disabled={busy}>{busy ? 'Preparing…' : 'Create & send invoice'}</button>
    </form>
  )
}
