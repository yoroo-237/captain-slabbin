import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { useApp } from '../../context/AppContext.jsx'
import { useShop } from '../ShopContext.jsx'
import { storeLocation } from './Layout.jsx'
import { Icon, aboutParagraphs } from '../lib.jsx'
import { WordReveal, magnet, leaning } from '../motion.jsx'

// Home: the shop's first words, lighting up word by word as you scroll, next to
// the smoking logo
export function AboutTeaser() {
  const { settings } = useShop()
  const [first] = aboutParagraphs(settings)
  return (
    <section className="section ab-teaser" aria-label="About Captain Slabbin">
      <div className="container ab-teaser-in">
        <div className="ab-teaser-logo" aria-hidden="true">
          <img src="/brand/logo.webp" alt="" />
        </div>
        <div className="ab-teaser-copy">
          <span className="ab-kicker">About the crew</span>
          <WordReveal text={first} className="ab-statement" />
          <div className="hero-cta">
            <Link to="/about" className="btn btn-primary" {...magnet}>Read our story <Icon.arrow /></Link>
            <Link to="/account/messages" className="btn btn-outline" {...magnet}><Icon.chat /> Talk to us</Link>
          </div>
        </div>
      </div>
    </section>
  )
}

// "Ask the crew": one card per way to reach the shop, then where it is
export function ContactSection({ title = 'Questions? Ask the crew.' }) {
  const { settings } = useShop()
  const { user } = useApp()
  const phone = settings.support_phone
  const digits = phone?.replace(/[^\d+]/g, '')
  const tgUser = settings.telegram_username?.replace(/^@/, '')
  const loc = storeLocation(settings)
  const ways = [
    { icon: Icon.chat, label: 'Message us here', value: 'A real person replies, day or night', to: user ? '/account/messages' : '/login', hot: true },
    tgUser && { icon: Icon.telegram, label: 'Telegram', value: `@${tgUser}`, href: `https://t.me/${tgUser}` },
    phone && { icon: Icon.bolt, label: 'Call or text', value: phone, href: `sms:${digits}` },
    settings.contact_email && { icon: Icon.send, label: 'Email', value: settings.contact_email, href: `mailto:${settings.contact_email}` },
  ].filter(Boolean)

  return (
    <section className="section ct" aria-label="Contact">
      <div className="container">
        <div className="ct-box">
          <div className="ct-head">
            <h2>{title}</h2>
            <p className="muted">Stock, bulk pricing, delivery, an order: ask anything.</p>
          </div>
          <div className="ct-ways">
            {ways.map((w, i) => {
              const inner = <><span className="ic"><w.icon /></span><span className="t"><b>{w.label}</b><span>{w.value}</span></span><Icon.arrow /></>
              const props = { className: 'ct-way reveal' + (w.hot ? ' hot' : ''), style: { transitionDelay: `${i * 0.07}s` }, ...leaning }
              return w.to
                ? <Link key={w.label} to={w.to} {...props}>{inner}</Link>
                : <a key={w.label} href={w.href} target={w.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" {...props}>{inner}</a>
            })}
          </div>
          <div className="ct-where">
            <span className="ct-pin" aria-hidden="true"><Icon.pin /></span>
            <div>
              <b>{loc.full ? (settings.store_address ? `${settings.store_address}, ${loc.cityLine}` : loc.cityLine) : 'Based in the USA'}</b>
              <span className="muted">{settings.store_hours || 'Messages answered 24/7'} · Shipping to all 50 states</span>
            </div>
            {loc.maps && <a className="btn btn-outline btn-sm" href={loc.maps} target="_blank" rel="noreferrer">Get directions</a>}
          </div>
        </div>
      </div>
    </section>
  )
}

export const FAQ_DEFAULT = [
  ['How do I pay?', 'With crypto from your wallet on the site: BTC, LTC, ETH, DOGE or XMR. Add funds once, then every order is paid in one tap. The price is converted and locked at the moment you order.'],
  ['What do you need to know about me?', 'A username and a password, nothing else. Your Telegram is optional and only used so the shop can reach you about an order.'],
  ['How does delivery work?', 'At checkout choose "Ship it to me" and enter a US address: it ships in plain, unmarked packaging with tracking. Or choose no delivery and arrange it with the crew on Telegram.'],
  ['Where does my invoice go?', 'As soon as you pay, the invoice is sent to the shop on Telegram. You can also open it in your own Telegram from the confirmation page.'],
  ['How do I follow my order?', 'Your orders and tracking numbers are in your account. You can also message the shop at any time from the Messages tab.'],
]

// Questions & answers: the ones set in Admin → FAQ, else the basics.
// page: the /faq page's own heading (h1); onItems: hands the list to its JSON-LD
export function Faq({ page = false, onItems }) {
  const [items, setItems] = useState(null)
  const [open, setOpen] = useState(0)
  useEffect(() => {
    apiFetch('/content/faq')
      .then(f => f?.length ? f.map(x => [x.question, x.answer]) : FAQ_DEFAULT)
      .catch(() => FAQ_DEFAULT)
      .then(list => { setItems(list); onItems?.(list) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!items) return null
  const Title = page ? 'h1' : 'h2'
  return (
    <section className="section faq" aria-label="Questions and answers">
      <div className="container faq-in">
        <div className="faq-head">
          <Title className={page ? 'display' : undefined}>{page ? 'Questions & answers' : 'Good to know'}</Title>
          <p className="muted">{page ? 'Ordering, paying with crypto and shipping across the US: what new customers ask most.' : 'The questions new customers ask most.'}</p>
        </div>
        <div className="faq-list">
          {items.map(([q, a], i) => (
            <div key={q} className={'faq-item reveal' + (open === i ? ' open' : '')} style={{ transitionDelay: `${i * 0.05}s` }}>
              <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
                <span>{q}</span><span className="pm" aria-hidden="true" />
              </button>
              <div className="faq-a"><div><p>{a}</p></div></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
