// Canvas smoke for the shop gate, after the original Captain Slabbin gate.
// Idle: thin wisps rise off the cigar ember of the logo. Burst: the emitter opens
// up, a veil grows with the cloud until the screen is covered (onCover — the shop
// is mounted behind it then), holds until the shop is ready, and lifts away (onDone).
// Time-based off requestAnimationFrame timestamps, so slow devices drop frames
// instead of playing a slow-motion version.

const PHASE = { EMIT: 460, COVER: 820, HOLD: 1200, CLEAR: 2100, DONE: 2200 }

// Where the lit ash sits on the logo artwork, as fractions of the image box
const CIGAR_X = 0.655
const CIGAR_Y = 0.622

function makePuff() {
  const puff = document.createElement('canvas')
  puff.width = puff.height = 128
  const c = puff.getContext('2d')
  // Six offset blobs so a puff never reads as a single round gradient
  for (let i = 0; i < 6; i++) {
    const x = 64 + (Math.random() - 0.5) * 42
    const y = 64 + (Math.random() - 0.5) * 42
    const r = 22 + Math.random() * 26
    const g = c.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(238,229,216,.42)')
    g.addColorStop(0.45, 'rgba(201,186,168,.20)')
    g.addColorStop(1, 'rgba(168,153,137,0)')
    c.fillStyle = g
    c.fillRect(x - r, y - r, r * 2, r * 2)
  }
  return puff
}

export function startSmoke(canvas, anchor, { onCover, canClear, onDone } = {}) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  let W = 0, H = 0
  const resize = () => {
    W = window.innerWidth; H = window.innerHeight
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()
  window.addEventListener('resize', resize)

  const puff = makePuff()
  const ps = []
  let bursting = false, t0 = 0, last = 0, since = 0, raf = 0, veil = 0
  let covered = false, held = false, waited = 0, finished = false

  const origin = () => {
    const r = anchor?.getBoundingClientRect()
    if (!r?.width) return { x: W / 2, y: H * 0.42, w: Math.min(W, H) * 0.4 }
    return { x: r.left + r.width * CIGAR_X, y: r.top + r.height * CIGAR_Y, w: r.width }
  }

  function spawn(n, heavy) {
    const o = origin()
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = heavy ? 0.34 + Math.random() * 0.92 : 0
      ps.push({
        x: o.x + (Math.random() - 0.5) * o.w * (heavy ? 0.34 : 0.022),
        y: o.y + (Math.random() - 0.5) * o.w * (heavy ? 0.34 : 0.016),
        hv: heavy,
        vx: heavy ? Math.cos(a) * sp : (Math.random() - 0.34) * 0.02,
        vy: heavy ? Math.sin(a) * sp * 0.82 - 0.04 : -(0.05 + Math.random() * 0.03),
        r: o.w * (heavy ? 0.16 + Math.random() * 0.2 : 0.018 + Math.random() * 0.024),
        gr: heavy ? 0.26 + Math.random() * 0.34 : 0.007 + Math.random() * 0.013,
        rot: Math.random() * 6.283,
        spin: (Math.random() - 0.5) * (heavy ? 0.0018 : 0.0009),
        ph: Math.random() * 6.283,
        sw: heavy ? 0 : 0.012 + Math.random() * 0.02,
        age: 0,
        max: heavy ? 1700 + Math.random() * 900 : 3200 + Math.random() * 2200,
        amp: heavy ? 0.8 + Math.random() * 0.34 : 0.5 + Math.random() * 0.3,
      })
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame)
    const dt = last ? Math.min(50, now - last) : 16
    last = now
    let el = bursting ? now - t0 : 0

    if (!bursting) {
      since -= dt
      if (since <= 0 && ps.length < 150) { spawn(2, false); since = 34 }
    } else {
      if (el < PHASE.EMIT) spawn(4, true)
      // Swap the page underneath only once the screen is really covered, then hold
      // until the shop is there (capped so a slow load never strands anyone in smoke)
      if (!covered && el >= PHASE.COVER) { covered = true; onCover?.() }
      if (covered && el >= PHASE.HOLD && !held && canClear && !canClear()) {
        if (waited < 4000) { t0 += dt; waited += dt; el = PHASE.HOLD } else held = true
      } else if (el > PHASE.HOLD) held = true
      if (!finished && el >= PHASE.DONE) { finished = true; onDone?.() }
      // A veil under the particles guarantees the cover; particles give it texture
      if (el < PHASE.COVER) veil = (el / PHASE.COVER) * 0.86
      else if (el < PHASE.HOLD) veil = 0.86
      else veil = Math.max(0, 0.86 * (1 - (el - PHASE.HOLD) / (PHASE.CLEAR - PHASE.HOLD)))
    }

    ctx.clearRect(0, 0, W, H)

    if (veil > 0.001) {
      const o = origin()
      const grow = Math.min(1, el / PHASE.COVER)
      const gv = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, Math.max(W, H) * (0.12 + grow * 1.3))
      gv.addColorStop(0, `rgba(214,203,188,${veil})`)
      gv.addColorStop(0.55, `rgba(196,183,167,${veil * 0.88})`)
      gv.addColorStop(0.82, `rgba(168,154,138,${veil * 0.42})`)
      gv.addColorStop(1, 'rgba(150,136,121,0)')
      ctx.fillStyle = gv
      ctx.fillRect(0, 0, W, H)
    }

    const clearing = bursting && el > PHASE.HOLD
    for (let i = ps.length - 1; i >= 0; i--) {
      const q = ps[i]
      q.age += dt
      if (q.age >= q.max) { ps.splice(i, 1); continue }
      if (clearing) q.vy -= 0.00028 * dt          // everything lifts out of frame together
      if (q.sw) q.x += Math.sin(q.age / 620 + q.ph) * q.sw * dt
      q.x += q.vx * dt
      q.y += q.vy * dt
      q.vx *= 1 - 0.0011 * dt
      if (q.hv) q.vy = q.vy * (1 - 0.0009 * dt) - 0.000018 * dt
      q.r += q.gr * dt
      q.rot += q.spin * dt

      const k = q.age / q.max
      let a = q.amp * Math.min(1, q.age / 260) * (1 - k) * (1 - k)
      if (clearing) a *= Math.max(0, 1 - (el - PHASE.HOLD) / (PHASE.CLEAR - PHASE.HOLD))
      if (a <= 0.003) continue
      ctx.save()
      ctx.globalAlpha = a
      ctx.translate(q.x, q.y)
      ctx.rotate(q.rot)
      ctx.drawImage(puff, -q.r, -q.r, q.r * 2, q.r * 2)
      ctx.restore()
    }
  }
  raf = requestAnimationFrame(frame)

  return {
    burst() { bursting = true; t0 = performance.now() },
    stop() { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) },
  }
}
