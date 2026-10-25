import { useState } from 'react'
import { Faq, ContactSection } from '../components/AboutBits.jsx'
import { useSeo, faqLd, FAQ_SEED } from '../seo.js'

// /faq: the questions on their own page, marked up as an FAQPage
export default function FaqPage() {
  const [items, setItems] = useState(FAQ_SEED)
  useSeo({
    title: 'FAQ: ordering, crypto payment and US shipping',
    description: 'How to order from Captain Slabbin: paying with BTC, LTC, ETH, DOGE or XMR, discreet tracked shipping across the USA, invoices on Telegram and support. Adults 21+.',
    path: '/faq',
    jsonLd: faqLd(items),
  })
  return (
    <>
      <Faq page onItems={setItems} />
      <ContactSection />
    </>
  )
}
