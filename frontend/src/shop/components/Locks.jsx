import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useShop } from '../ShopContext.jsx'
import { useSeo } from '../seo.js'
import { Icon } from '../lib.jsx'

// Pages with products, prices or a customer's data: shown once the gate code is
// entered (or the customer is signed in). Until then the gate opens by itself
// and the page explains what's behind it. Never indexed.
export function Locked({ children, what = 'this page' }) {
  const { unlocked, openGate } = useShop()
  useEffect(() => { if (!unlocked) openGate() }, [unlocked]) // eslint-disable-line react-hooks/exhaustive-deps
  useSeo({ title: 'Members only', noindex: true, skip: unlocked })
  if (unlocked) return children
  return (
    <section className="section">
      <div className="container locked">
        <span className="locked-ic" aria-hidden="true"><Icon.lock /></span>
        <h1 className="display">Enter the shop</h1>
        <p className="muted">Prices, products and accounts are for members. Type the shop code to see {what}.</p>
        <div className="locked-cta">
          <button type="button" className="btn btn-primary" onClick={openGate}>Enter the shop</button>
          <Link to="/login" className="btn btn-outline">Sign in</Link>
        </div>
      </div>
    </section>
  )
}

// The public pages' 21+ confirmation: a dialog over the page (the page itself
// stays readable by search engines, as Google allows for age checks).
export function AgeNotice() {
  const { ageOk, confirmAge, gateWanted, settings } = useShop()
  if (ageOk || gateWanted) return null
  return (
    <div className="modal-wrap age-notice" role="dialog" aria-modal="true" aria-labelledby="age-title">
      <div className="modal-backdrop" aria-hidden="true" />
      <div className="modal age-card">
        <img src="/brand/logo.webp" alt="" width="120" height="120" />
        <h2 id="age-title" className="display">Are you 21 or older?</h2>
        <p className="muted">{settings.site_name || 'Captain Slabbin'} is for adults 21 and over. Please confirm your age to continue.</p>
        <div className="age-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={confirmAge} autoFocus>Yes, I'm 21+</button>
          <a className="btn btn-outline btn-lg" href="https://www.google.com" rel="nofollow">No, leave</a>
        </div>
      </div>
    </div>
  )
}
