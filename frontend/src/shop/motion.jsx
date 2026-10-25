import { useEffect, useRef, useState } from 'react'

// Motion helpers shared by the home and About pages. All of them stand still
// for visitors who ask for reduced motion.
export const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Scroll-linked motion: writes --p (0 → 1) on the element as it is scrolled
// through. "sticky" measures a tall section whose stage is pinned; "pass"
// measures an element crossing the viewport.
export function useScrollVar(ref, mode = 'sticky') {
  useEffect(() => {
    const el = ref.current
    if (!el || reduceMotion()) { el?.style.setProperty('--p', '1'); return }
    let raf = 0
    const update = () => {
      raf = 0
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      const p = mode === 'sticky'
        ? -r.top / Math.max(1, r.height - vh)
        : (vh * 0.8 - r.top) / Math.max(1, r.height + vh * 0.2)
      el.style.setProperty('--p', Math.min(1, Math.max(0, p)).toFixed(4))
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll) }
  }, [ref, mode])
}

// Letters that rise into place one after another. Letters sit in word boxes
// separated by real spaces, so the text still reads "Top shelf." for screen
// readers and search engines.
export function Split({ text, delay = 0, className }) {
  let i = 0
  const words = text.split(' ')
  return (
    <span className={'split ' + (className || '')}>
      {words.map((word, w) => (
        <span key={w}>
          <span className="w">
            {[...word].map((ch, k) => <span key={k} className="ch" style={{ '--i': i++, '--d': `${delay}s` }}>{ch}</span>)}
          </span>
          {w < words.length - 1 && (i++, ' ')}
        </span>
      ))}
    </span>
  )
}

// A paragraph whose words light up one by one as it is scrolled through
export function WordReveal({ text, as: Tag = 'p', className }) {
  const ref = useRef(null)
  useScrollVar(ref, 'pass')
  const words = text.split(/\s+/)
  return (
    <Tag ref={ref} className={'word-reveal ' + (className || '')} style={{ '--n': words.length }} aria-label={text}>
      {words.map((w, i) => <span key={i} aria-hidden="true" style={{ '--w': i }}>{w} </span>)}
    </Tag>
  )
}

// A number that counts up the first time it is seen
export function CountUp({ to, format = n => n }) {
  const ref = useRef(null)
  const [n, setN] = useState(reduceMotion() ? to : 0)
  useEffect(() => {
    const el = ref.current
    if (!el || reduceMotion() || !to) { setN(to); return }
    let raf = 0
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const t0 = performance.now()
      const tick = now => {
        const k = Math.min(1, (now - t0) / 1100)
        setN(Math.round(to * (1 - Math.pow(1 - k, 3))))
        if (k < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    })
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
  }, [to])
  return <b ref={ref}>{format(n)}</b>
}

// Buttons drift toward the pointer while it hovers them
export function magnetic(e) {
  if (e.pointerType !== 'mouse') return
  const b = e.currentTarget
  const r = b.getBoundingClientRect()
  b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.22}px, ${(e.clientY - r.top - r.height / 2) * 0.3}px)`
}
export const unmagnetic = e => { e.currentTarget.style.transform = '' }
export const magnet = { onPointerMove: magnetic, onPointerLeave: unmagnetic }

// Cards lean toward the pointer
export function tilt(e) {
  if (e.pointerType !== 'mouse') return
  const c = e.currentTarget
  const r = c.getBoundingClientRect()
  c.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 8}deg`)
  c.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - 0.5) * -8}deg`)
}
export const untilt = e => { e.currentTarget.style.removeProperty('--rx'); e.currentTarget.style.removeProperty('--ry') }
export const leaning = { onPointerMove: tilt, onPointerLeave: untilt }
