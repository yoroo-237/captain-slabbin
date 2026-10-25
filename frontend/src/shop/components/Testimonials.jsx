import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { Icon, Stars, fmtDate, productUrl } from '../lib.jsx'

function Quote({ r, hidden }) {
  return (
    <figure className="tm-card" aria-hidden={hidden || undefined}>
      <svg className="tm-q" viewBox="0 0 32 24" aria-hidden="true"><path d="M0 24V14C0 6 4 1 12 0l1 4c-4 1-6 4-6 8h6v12H0zm19 0V14c0-8 4-13 12-14l1 4c-4 1-6 4-6 8h6v12H19z" /></svg>
      <Stars value={r.rating} />
      <blockquote>{r.comment}</blockquote>
      <figcaption>
        <span className="tm-av" aria-hidden="true">{r.author[0]}</span>
        <span>
          <b>{r.author}</b>
          <span className="tm-ver"><Icon.check /> Verified buyer · {fmtDate(r.createdAt)}</span>
          {r.product && <Link to={productUrl(r.product)} tabIndex={hidden ? -1 : 0}>{r.product.name}</Link>}
        </span>
      </figcaption>
    </figure>
  )
}

// Approved reviews from verified buyers: the overall score on one side and a
// wall of quotes drifting in two columns on the other. With no review yet the
// section says so plainly: nothing here is ever made up.
export default function Testimonials({ title = 'What customers say' }) {
  const [reviews, setReviews] = useState(null)
  useEffect(() => { apiFetch('/reviews').then(r => setReviews(r || [])).catch(() => setReviews([])) }, [])
  if (reviews === null) return null

  const count = reviews.length
  const avg = count ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0
  const wall = count >= 4
  const cols = wall ? [reviews.filter((_, i) => i % 2 === 0), reviews.filter((_, i) => i % 2 === 1)] : [reviews]

  return (
    <section className="section tm" aria-label={title}>
      <div className="container tm-in">
        <div className="tm-score reveal">
          <h2>{title}</h2>
          {count ? (
            <>
              <div className="tm-big"><span>{avg.toFixed(1)}</span><small>/ 5</small></div>
              <Stars value={avg} size={22} />
              <p className="muted">From {count} verified buyer{count === 1 ? '' : 's'}. Only customers who bought a product can review it, and every review is checked by the crew.</p>
            </>
          ) : (
            <>
              <div className="tm-big tm-none"><Icon.star /></div>
              <p className="muted">No reviews yet. Only customers who bought a product can review it, from the product page, so every review here will be real.</p>
            </>
          )}
          <Link to="/s/all" className="btn btn-outline">Shop and review <Icon.arrow /></Link>
        </div>

        {count === 0 && (
          <ol className="tm-how">
            <li className="reveal"><span className="ic"><Icon.bag /></span><div><b>Buy a product</b><span>Reviews are open to customers who actually ordered it.</span></div></li>
            <li className="reveal"><span className="ic"><Icon.star /></span><div><b>Rate it on its page</b><span>One to five stars and a few words, right on the product page.</span></div></li>
            <li className="reveal"><span className="ic"><Icon.check /></span><div><b>Checked by the crew</b><span>Every review is read before it shows here. Names stay private.</span></div></li>
          </ol>
        )}

        {count > 0 && (
          <div className={'tm-wall' + (wall ? ' moving' : '')}>
            {cols.map((col, c) => (
              <div key={c} className={'tm-col' + (c ? ' down' : '')}>
                <div className="tm-run">
                  {col.map(r => <Quote key={r.id} r={r} />)}
                  {wall && col.map(r => <Quote key={`d${r.id}`} r={r} hidden />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
