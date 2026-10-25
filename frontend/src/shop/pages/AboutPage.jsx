import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { useShop } from '../ShopContext.jsx'
import { useSeo, storeLd } from '../seo.js'
import Testimonials from '../components/Testimonials.jsx'
import { ContactSection, Faq } from '../components/AboutBits.jsx'
import { Icon, aboutParagraphs } from '../lib.jsx'
import { Split, WordReveal, CountUp, useScrollVar, magnet, leaning } from '../motion.jsx'

const VALUES = [
  [Icon.box, 'Discreet by default', 'Plain, unmarked packaging and tracked shipping to all 50 states. Nothing on the box says what is inside.'],
  [Icon.bolt, 'Crypto checkout', 'BTC, LTC, ETH, DOGE or XMR from your wallet. The price is converted and locked the moment you order.'],
  [Icon.telegram, 'Real people on Telegram', 'Every paid invoice reaches the crew on Telegram, and a person confirms it. No bots answering your questions.'],
  [Icon.shield, 'Private by design', 'A username and a password. No email, no real name. Your address only if you choose delivery.'],
]

// /about: who the shop is, how it works, what buyers say, answers, contact
export default function AboutPage() {
  const { settings, shelves } = useShop()
  useSeo({
    title: 'About the crew: an online shop shipping across the USA',
    description: 'Who is Captain Slabbin: a small crew running an online shop for adults 21+, with top shelf products, crypto checkout and discreet tracked shipping to all states we serve in the US.',
    path: '/about',
    jsonLd: [storeLd(settings), { '@context': 'https://schema.org', '@type': 'AboutPage', name: 'About Captain Slabbin', inLanguage: 'en-US' }],
  })
  const [intro, ...story] = aboutParagraphs(settings)
  const storyRef = useRef(null)
  useScrollVar(storyRef, 'pass')
  const total = shelves.categories.reduce((s, c) => s + c.count, 0)

  return (
    <>
      <section className="ab-hero">
        <div className="container ab-hero-in">
          <div className="ab-hero-copy">
            <span className="ab-kicker">About us</span>
            <h1 className="display">
              <Split text="Run by a crew," delay={0.15} />{' '}
              <Split text="not a call center." delay={0.5} className="blood-text" />
            </h1>
            <p className="lead">{intro}</p>
            <div className="hero-cta">
              <Link to="/s/all" className="btn btn-primary btn-lg" {...magnet}>Shop all products</Link>
              <Link to="/account/messages" className="btn btn-outline btn-lg" {...magnet}><Icon.chat /> Talk to the crew</Link>
            </div>
          </div>
          <div className="ab-hero-art" aria-hidden="true">
            <span className="ab-ring" />
            <img src="/brand/logo.webp" alt="" />
          </div>
        </div>
      </section>

      {story.length > 0 && (
        <section className="section ab-story" ref={storyRef}>
          <div className="container ab-story-in">
            <div className="ab-story-rail" aria-hidden="true"><span /></div>
            <div className="ab-story-text">
              {story.map((p, i) => <WordReveal key={i} text={p} className="ab-statement" />)}
            </div>
          </div>
        </section>
      )}

      <section className="stat-band" aria-label="The shop in numbers">
        <div className="container stat-band-in">
          {total > 0 && <div className="sb reveal"><CountUp to={total} /><span>products in stock</span></div>}
          <div className="sb reveal"><CountUp to={50} /><span>states we ship to</span></div>
          <div className="sb reveal"><b>5</b><span>cryptos accepted</span></div>
          <div className="sb reveal"><b>24/7</b><span>messages answered</span></div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head"><h2>How we work</h2></div>
          <div className="ab-values">
            {VALUES.map(([I, t, d], i) => (
              <div key={t} className="ab-value reveal" style={{ transitionDelay: `${i * 0.08}s` }} {...leaning}>
                <span className="ic"><I /></span><h3>{t}</h3><p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Testimonials />

      <Faq />

      <ContactSection title="Find the crew" />
    </>
  )
}
