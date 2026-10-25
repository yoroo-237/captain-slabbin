// Canvas smoke and fire, after the original Captain Slabbin gate. One engine per
// canvas. Thin wisps rise constantly off the cigar ember of every logo it is
// anchored to (logos marked `burn` also lick with small flames), and any element
// given as a fire edge (the footer) burns along its bottom, its smoke drifting up
// over the page. burst() opens
// the emitter up: a veil grows with the cloud until the screen is covered
// (onCover — swap whatever is underneath then), holds until canClear() says so
// (capped), and lifts away (onDone). Puffs of smoke and bursts of fire can be
// fired at any point (smokePuff / fireBurst). Time-based off requestAnimationFrame
// timestamps, so slow devices drop frames instead of playing a slow-motion version.

// The gate reveal: slow and thick. Page changes: quick, the swap happens at ~0.35s.
export const GATE_TIMING = { EMIT: 460, COVER: 820, HOLD: 1200, CLEAR: 2100, DONE: 2200, WAIT: 4000 }
export const PAGE_TIMING = { EMIT: 300, COVER: 340, HOLD: 460, CLEAR: 1150, DONE: 1200, WAIT: 0 }

// Where the lit ash sits on the Captain Slabbin logo, as fractions of the image
// box — the default emission point (`emit` overrides it for other logos)
const CIGAR = [0.655, 0.622]
const MAX_PARTICLES = 2400

// Puff colours (core → rim) and veil colours (centre → edge) per look.
// cream: the gate's warm smoke · dark: charcoal veil under cream puffs for the
// dark shop · light: grey puffs in a paper-coloured fog for the light shop.
const TONES = {
  cream: { puff: ['238,229,216', '201,186,168', '168,153,137'], veil: ['214,203,188', '196,183,167', '168,154,138', '150,136,121'], max: 0.86 },
  dark:  { puff: ['238,229,216', '201,186,168', '168,153,137'], veil: ['62,58,54', '46,43,40', '28,27,25', '16,16,16'], max: 0.95 },
  light: { puff: ['112,104,95', '146,137,126', '178,170,160'], veil: ['243,239,233', '236,231,224', '226,220,211', '216,209,199'], max: 0.97 },
}

const centre = (target, size) => {
  const r = target?.getBoundingClientRect?.()
  if (!r) return null
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: size || Math.max(r.width, r.height) }
}

// A small puff of smoke out of any element (an add-to-cart button, a success
// mark…), or at a point. The page's engine picks it up; without one, nothing.
export function smokePuff(target, size) {
  const detail = target?.getBoundingClientRect ? centre(target, size) : target
  if (detail) window.dispatchEvent(new CustomEvent('smoke:puff', { detail }))
}

// A burst of flames out of an element or at a point { x, y, size }
export function fireBurst(target, size) {
  const detail = target?.getBoundingClientRect ? centre(target, size) : target
  if (detail) window.dispatchEvent(new CustomEvent('smoke:fire', { detail }))
}

function makePuff([core, mid, rim]) {
  const puff = document.createElement('canvas')
  puff.width = puff.height = 128
  const c = puff.getContext('2d')
  // Six offset blobs so a puff never reads as a single round gradient
  for (let i = 0; i < 6; i++) {
    const x = 64 + (Math.random() - 0.5) * 42
    const y = 64 + (Math.random() - 0.5) * 42
    const r = 22 + Math.random() * 26
    const g = c.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${core},.42)`)
    g.addColorStop(0.45, `rgba(${mid},.20)`)
    g.addColorStop(1, `rgba(${rim},0)`)
    c.fillStyle = g
    c.fillRect(x - r, y - r, r * 2, r * 2)
  }
  return puff
}

// Fire is built from many small soft sprites, graded by temperature: a particle
// is born white-hot at the base and cools through yellow and orange to a dark
// red as it rises and shrinks. Drawn additively, overlaps build the bright core.
const HEAT = [
  [255, 246, 222], // white-hot
  [255, 208, 96],  // yellow
  [255, 138, 34],  // orange
  [226, 70, 14],   // red-orange
  [140, 30, 10],   // dying red
]
function makeHeatSprites() {
  return HEAT.map(([r, g, b]) => {
    const f = document.createElement('canvas')
    f.width = f.height = 64
    const c = f.getContext('2d')
    const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32)
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`)
    gr.addColorStop(0.35, `rgba(${r},${g},${b},.55)`)
    gr.addColorStop(0.7, `rgba(${r},${g},${b},.12)`)
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`)
    c.fillStyle = gr
    c.fillRect(0, 0, 64, 64)
    return f
  })
}

// anchor: an element, a list of elements, or a function returning either
// (looked up every frame). The first visible one is where bursts pour from.
// fireEdge: an element (or function) whose bottom edge burns while on screen.
export function createSmoke(canvas, { anchor = null, fireEdge = null, emit = CIGAR, tone = 'cream', idle = true } = {}) {
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

  const puffs = {}
  const puffFor = t => puffs[t] || (puffs[t] = makePuff(TONES[t].puff))
  const heat = makeHeatSprites()
  const ps = []
  let look = tone
  let b = null            // the running burst
  let last = 0, since = 0, flameSince = 0, edgeSince = 0, raf = 0, drawn = false

  // Is the element under an overlay (menu, sheet, dialog) it is not part of?
  const OVERLAYS = '.drawer, .drawer-backdrop, .modal-wrap, .search-sheet, .lightbox, .filters.open, .cs-gate'
  const uncovered = (el, r) => {
    const cy = r.top + r.height / 2
    if (cy < 0 || cy > H) return true
    const top = document.elementFromPoint(Math.min(W - 1, Math.max(0, r.left + r.width / 2)), cy)
    const over = top?.closest?.(OVERLAYS)
    return !over || over.contains(el)
  }

  // Every anchored logo that is on screen, with its box and emission point
  const logos = () => {
    const a = typeof anchor === 'function' ? anchor() : anchor
    const list = !a ? [] : a.length != null ? Array.from(a) : [a]
    const out = []
    for (const el of list) {
      const r = el?.getBoundingClientRect?.()
      if (!r?.width || r.bottom < -40 || r.top > H + 40) continue
      if (!uncovered(el, r)) continue
      out.push({
        x: r.left + r.width * emit[0], y: r.top + r.height * emit[1], w: Math.max(r.width, r.height),
        box: r, burn: el.dataset?.smokeLogo === 'burn',
      })
    }
    return out
  }
  const origin = () => logos()[0] || { x: W / 2, y: H * 0.42, w: Math.min(W, H) * 0.4 }

  function spawnWisps(o, n) {
    // A small header logo gets a small plume: speeds and growth follow its size
    const k = Math.max(0.22, Math.min(1, o.w / 300))
    const img = puffFor(look)
    for (let i = 0; i < n; i++) {
      ps.push({
        img, hv: false,
        x: o.x + (Math.random() - 0.5) * o.w * 0.022,
        y: o.y + (Math.random() - 0.5) * o.w * 0.016,
        vx: (Math.random() - 0.34) * 0.02 * k,
        vy: -(0.05 + Math.random() * 0.03) * k,
        r: o.w * (0.018 + Math.random() * 0.024),
        gr: (0.007 + Math.random() * 0.013) * k,
        rot: Math.random() * 6.283,
        spin: (Math.random() - 0.5) * 0.0009,
        ph: Math.random() * 6.283,
        sw: (0.012 + Math.random() * 0.02) * k,
        age: 0,
        max: 3200 + Math.random() * 2200,
        amp: 0.5 + Math.random() * 0.3,
      })
    }
  }

  // One flame particle: rises faster as it heats the air (buoyancy), sways in
  // turbulence, shrinks and cools
  function spawnFlame(x, y, size, up = 1) {
    ps.push({
      fire: true, hv: false, hot: Math.random() < 0.25,
      x, y, s: size, r: size,
      vx: (Math.random() - 0.5) * 0.04,
      vy: -(0.02 + Math.random() * 0.05) * up,
      lift: (0.00022 + Math.random() * 0.00018) * up,
      ph: Math.random() * 6.283, tw: 90 + Math.random() * 80,
      age: 0, max: 380 + Math.random() * 420,
      amp: 0.45 + Math.random() * 0.25,
    })
  }

  function spawnSpark(x, y, up = 1) {
    ps.push({
      spark: true, hv: false,
      x, y, r: 1 + Math.random() * 1.6,
      vx: (Math.random() - 0.5) * 0.12,
      vy: -(0.12 + Math.random() * 0.2) * up,
      ph: Math.random() * 6.283,
      age: 0, max: 700 + Math.random() * 900,
      amp: 1,
    })
  }

  // A burning logo: flames all around its lower half and sides, licking up over
  // it, with sparks
  function spawnBurn(o) {
    const r = o.box
    const sz = Math.max(8, r.width * 0.3)
    for (let i = 0; i < 4; i++) {
      const t = Math.random()
      const side = Math.random() < 0.3
      const x = side ? (Math.random() < 0.5 ? r.left + r.width * 0.08 : r.right - r.width * 0.08) : r.left + r.width * (0.1 + t * 0.8)
      const y = side ? r.top + r.height * (0.35 + Math.random() * 0.5) : r.bottom - r.height * (0.05 + Math.random() * 0.15)
      spawnFlame(x, y, sz * (0.55 + Math.random() * 0.6), 1.1)
    }
    if (Math.random() < 0.3) spawnSpark(r.left + r.width * Math.random(), r.top + r.height * 0.5, 0.9)
  }

  // The fire edge: a dense wall of flames all along the element's bottom,
  // sparks flying off it, and smoke billowing up from it over the page
  function spawnEdge() {
    const el = typeof fireEdge === 'function' ? fireEdge() : fireEdge
    const r = el?.getBoundingClientRect?.()
    if (!r?.width || r.bottom > H + 10 || r.bottom < 0) return
    const base = r.bottom
    const small = W < 640
    const n = Math.ceil(r.width / (small ? 22 : 26))
    for (let i = 0; i < n; i++) {
      // flames of uneven height: some tall tongues, mostly low licks
      const tall = Math.random() < 0.15
      const sz = (small ? 11 : 14) * (tall ? 1.9 : 0.7 + Math.random() * 0.7)
      spawnFlame(r.left + Math.random() * r.width, base - 2 - Math.random() * 6, sz, tall ? 1.7 : 1)
    }
    if (Math.random() < 0.5) spawnSpark(r.left + Math.random() * r.width, base - 20, 1)
    if (Math.random() < 0.35) spawnRising(r.left + Math.random() * r.width, base - 70, 0.32)
  }

  // Smoke that climbs from y all the way out of the top of the screen
  function spawnRising(x, y, amp) {
    const vy = -(0.09 + Math.random() * 0.07)
    ps.push({
      img: puffFor(look), hv: false, rise: true,
      x, y,
      vx: (Math.random() - 0.5) * 0.02, vy,
      r: 30 + Math.random() * 40, gr: 0.012 + Math.random() * 0.02,
      rot: Math.random() * 6.283, spin: (Math.random() - 0.5) * 0.0006,
      ph: Math.random() * 6.283, sw: 0.025, age: 0,
      max: Math.min(16000, (y + 260) / -vy),
      amp: amp * (0.6 + Math.random() * 0.4),
    })
  }

  // Bottom of the footer out of view: the fire is still burning below, its
  // smoke still rises
  function spawnBelow() {
    const el = typeof fireEdge === 'function' ? fireEdge() : fireEdge
    const r = el?.getBoundingClientRect?.()
    if (!r?.width || r.bottom <= H + 10) return
    if (Math.random() < 0.1) spawnRising(Math.random() * W, H + 40, 0.16)
  }

  function spawnCloud(n) {
    const o = origin()
    const S = b.scale || o.w
    const img = puffFor(b.tone)
    for (let i = 0; i < n; i++) {
      // Page bursts pour down from the header; the gate's opens in every direction
      const a = b.down ? Math.PI * (0.08 + Math.random() * 0.84) : Math.random() * Math.PI * 2
      const sp = (0.34 + Math.random() * 0.92) * b.speed
      ps.push({
        img, hv: true,
        x: o.x + (Math.random() - 0.5) * S * 0.34,
        y: o.y + (Math.random() - 0.5) * S * 0.34,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.82 - (b.down ? 0 : 0.04),
        r: S * (0.16 + Math.random() * 0.2),
        gr: (0.26 + Math.random() * 0.34) * b.speed,
        rot: Math.random() * 6.283,
        spin: (Math.random() - 0.5) * 0.0018,
        ph: 0, sw: 0, age: 0,
        max: 1700 + Math.random() * 900,
        amp: 0.8 + Math.random() * 0.34,
      })
    }
  }

  function spawnPuff({ x, y, size }) {
    const img = puffFor(look)
    const n = Math.min(16, 6 + Math.round(size / 20))
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 0.03 + Math.random() * 0.12
      ps.push({
        img, hv: false,
        x: x + Math.cos(a) * size * 0.15, y: y + Math.sin(a) * size * 0.15,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - 0.05,
        r: size * (0.18 + Math.random() * 0.22),
        gr: 0.03 + Math.random() * 0.05,
        rot: Math.random() * 6.283, spin: (Math.random() - 0.5) * 0.002,
        ph: Math.random() * 6.283, sw: 0.01, age: 0,
        max: 900 + Math.random() * 700,
        amp: 0.75 + Math.random() * 0.3,
      })
    }
  }

  function spawnFire({ x, y, size }) {
    const sz = Math.max(10, size * 0.26)
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2
      const d = Math.random() * sz * 0.5
      spawnFlame(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.5, sz * (0.6 + Math.random() * 0.7), 1.6 + Math.random() * 0.8)
    }
    for (let i = 0; i < 10; i++) spawnSpark(x + (Math.random() - 0.5) * sz, y, 1.3)
    spawnPuff({ x, y: y - sz * 2, size: size * 0.7 })
  }

  const onPuff = e => ps.length < MAX_PARTICLES && spawnPuff(e.detail)
  const onFire = e => ps.length < MAX_PARTICLES && spawnFire(e.detail)
  window.addEventListener('smoke:puff', onPuff)
  window.addEventListener('smoke:fire', onFire)

  function frame(now) {
    raf = requestAnimationFrame(frame)
    const dt = last ? Math.min(50, now - last) : 16
    last = now

    let el = 0, veil = 0, T = null
    if (b) {
      T = b.timing
      el = now - b.t0
      if (el < T.EMIT) spawnCloud(4)
      // Swap what is underneath only once the screen is really covered, then hold
      // until it is ready (capped so a slow load never strands anyone in smoke)
      if (!b.covered && el >= T.COVER) { b.covered = true; b.onCover?.() }
      if (b.covered && el >= T.HOLD && !b.held && b.canClear && !b.canClear()) {
        if (b.waited < T.WAIT) { b.t0 += dt; b.waited += dt; el = T.HOLD } else b.held = true
      } else if (el > T.HOLD) b.held = true
      // A veil under the particles guarantees the cover; particles give it texture
      const max = TONES[b.tone].max
      if (el < T.COVER) veil = (el / T.COVER) * max
      else if (el < T.HOLD) veil = max
      else veil = Math.max(0, max * (1 - (el - T.HOLD) / (T.CLEAR - T.HOLD)))
      if (el >= T.DONE) { const done = b.onDone; b = null; done?.() }
    } else if (idle && ps.length < MAX_PARTICLES) {
      since -= dt
      flameSince -= dt
      edgeSince -= dt
      if (edgeSince <= 0 && fireEdge) { spawnEdge(); spawnBelow(); edgeSince = 32 }
      if (since <= 0 || flameSince <= 0) {
        const list = logos()
        if (since <= 0) {
          for (const o of list) if (o.w >= 150 || Math.random() < 0.35 + o.w / 230) spawnWisps(o, o.w >= 150 ? 2 : 1)
          since = 34
        }
        if (flameSince <= 0) { for (const o of list) if (o.burn) spawnBurn(o); flameSince = 40 }
      }
    }

    if (!ps.length && veil <= 0.001) {
      if (drawn) { ctx.clearRect(0, 0, W, H); drawn = false }
      return
    }
    ctx.clearRect(0, 0, W, H)
    drawn = true

    if (veil > 0.001) {
      const o = origin()
      const [c0, c1, c2, c3] = TONES[(b || {}).tone || look].veil
      const grow = Math.min(1, el / T.COVER)
      const gv = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, Math.max(W, H) * (0.12 + grow * 1.3))
      gv.addColorStop(0, `rgba(${c0},${veil})`)
      gv.addColorStop(0.55, `rgba(${c1},${veil * 0.9})`)
      gv.addColorStop(0.82, `rgba(${c2},${veil * 0.5})`)
      gv.addColorStop(1, `rgba(${c3},0)`)
      ctx.fillStyle = gv
      ctx.fillRect(0, 0, W, H)
    }

    // Flames glow additively on dark; on paper they are painted over normally
    const fireBlend = look === 'light' ? 'source-over' : 'lighter'
    const clearing = T && el > T.HOLD
    const fade = clearing ? Math.max(0, 1 - (el - T.HOLD) / (T.CLEAR - T.HOLD)) : 1
    for (let i = ps.length - 1; i >= 0; i--) {
      const q = ps[i]
      q.age += dt
      if (q.age >= q.max) { ps.splice(i, 1); continue }
      const k = q.age / q.max

      if (q.fire) {
        q.vy -= q.lift * dt                                   // hot air rises faster and faster
        q.x += (q.vx + Math.sin(q.age / q.tw + q.ph) * 0.035 * k) * dt
        q.y += q.vy * dt
        // swells quickly, then thins out to a point as it climbs
        q.r = q.s * Math.pow(Math.sin(Math.PI * Math.min(1, k * 1.8 + 0.08)), 0.5) * (1 - k * 0.55)
        const stage = Math.min(HEAT.length - 1, (q.hot ? 0 : 1) + Math.floor(k * (HEAT.length - 0.5)))
        const flick = 0.75 + Math.random() * 0.25
        const a = q.amp * Math.pow(1 - k, 1.1) * flick
        if (a <= 0.01 || q.r < 0.5) continue
        ctx.globalCompositeOperation = fireBlend
        ctx.globalAlpha = a
        // a narrow tongue, three times taller than wide, leaning with its sway
        ctx.drawImage(heat[stage], q.x - q.r * 0.55, q.y - q.r * 2.2, q.r * 1.1, q.r * 3)
        continue
      }
      if (q.spark) {
        q.vy += 0.00006 * dt                                  // sparks arc and slow
        q.x += (q.vx + Math.sin(q.age / 70 + q.ph) * 0.03) * dt
        q.y += q.vy * dt
        const a = (1 - k) * (0.6 + Math.random() * 0.4)
        ctx.globalCompositeOperation = fireBlend
        ctx.globalAlpha = a
        ctx.drawImage(heat[k < 0.5 ? 0 : 1], q.x - q.r * 2, q.y - q.r * 2, q.r * 4, q.r * 4)
        continue
      }

      if (clearing) q.vy -= 0.00028 * dt          // everything lifts out of frame together
      if (q.sw) q.x += Math.sin(q.age / (q.rise ? 1400 : 620) + q.ph) * q.sw * dt
      q.x += q.vx * dt
      q.y += q.vy * dt
      if (q.rise && q.y < -q.r) { ps.splice(i, 1); continue }
      q.vx *= 1 - 0.0011 * dt
      if (q.hv) q.vy = q.vy * (1 - 0.0009 * dt) - 0.000018 * dt
      q.r += q.gr * dt
      q.rot += q.spin * dt
      if (q.r <= 0.5) { ps.splice(i, 1); continue }

      let a = q.rise
        ? q.amp * Math.min(1, q.age / 700) * (1 - k)
        : q.amp * Math.min(1, q.age / 260) * (1 - k) * (1 - k)
      if (clearing && q.hv) a *= fade
      if (a <= 0.003) continue
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = a
      ctx.save()
      ctx.translate(q.x, q.y)
      ctx.rotate(q.rot)
      ctx.drawImage(q.img, -q.r, -q.r, q.r * 2, q.r * 2)
      ctx.restore()
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
  raf = requestAnimationFrame(frame)

  return {
    setAnchor(el) { anchor = el },
    setTone(t) { if (TONES[t]) look = t },
    // opts: timing, tone, scale (cloud size in px), speed, down, onCover, canClear, onDone
    burst(opts = {}) {
      b = {
        timing: GATE_TIMING, tone: look, speed: 1, ...opts,
        t0: performance.now(), covered: false, held: false, waited: 0,
      }
    },
    get busy() { return !!b },
    stop() {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('smoke:puff', onPuff)
      window.removeEventListener('smoke:fire', onFire)
    },
  }
}
