import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { useShop } from '../ShopContext.jsx'
import { startSmoke } from './smoke.js'

// Password + 21+ gate in front of the shop. Smoke drifts off the logo while it
// waits; on the right password the smoke swallows the screen, the shop is mounted
// behind it at its thickest (passGate), and the smoke lifts off the real page.
// The API refuses catalog requests until the gate is passed.
export default function AgeGate({ onFinished }) {
  const { passGate, settings, shelves, unlocked } = useShop()
  const [password, setPassword] = useState('')
  const [age, setAge] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [covered, setCovered] = useState(false)
  const canvasRef = useRef(null)
  const logoRef = useRef(null)
  const smokeRef = useRef(null)
  const tokenRef = useRef(null)
  const shelvesRef = useRef(shelves)
  shelvesRef.current = shelves

  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reduce || !canvasRef.current) return
    smokeRef.current = startSmoke(canvasRef.current, logoRef.current, {
      onCover: () => { setCovered(true); passGate(tokenRef.current) },
      // Clear once the shop has its shelves (smoke.js caps the wait at 4s)
      canClear: () => shelvesRef.current.categories.length > 0,
      onDone: () => onFinished?.(),
    })
    return () => smokeRef.current?.stop()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Unlocked some other way (signed in on /login): no reveal to play, just leave
  useEffect(() => {
    if (unlocked && !tokenRef.current) onFinished?.()
  }, [unlocked]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault()
    if (!age) { setError('Please confirm you are 21 or older.'); return }
    setBusy(true)
    setError('')
    try {
      const { token } = await apiFetch('/gate', { method: 'POST', body: JSON.stringify({ password, ageConfirmed: true }) })
      tokenRef.current = token
      if (smokeRef.current) smokeRef.current.burst()
      else { passGate(token); onFinished?.() }
    } catch (err) {
      setError(err.message || 'Incorrect password.')
      setBusy(false)
    }
  }

  return (
    <div className={'cs-gate' + (covered ? ' covered' : '')}>
      <canvas ref={canvasRef} className="gate-smoke" aria-hidden="true" />
      {!covered && (
        <form className="lock-card cs" onSubmit={submit} autoComplete="off">
          <img ref={logoRef} className="gate-logo" src="/brand/logo.webp" alt={settings.site_name || 'Captain Slabbin'} />
          <div className="field" style={{ margin: 0 }}>
            <label className="lock-label" htmlFor="gate-password">Enter password</label>
            <input
              id="gate-password" className={'input lock-input' + (error ? ' invalid' : '')}
              type="password" placeholder="PASSWORD" autoFocus required
              value={password} onChange={e => { setPassword(e.target.value); setError('') }}
              aria-describedby={error ? 'gate-error' : undefined}
            />
          </div>
          <label className="check" style={{ justifyContent: 'center', textAlign: 'left' }}>
            <input type="checkbox" checked={age} onChange={e => { setAge(e.target.checked); setError('') }} />
            <span>I am 21 years of age or older</span>
          </label>
          {error && <p id="gate-error" role="alert" style={{ color: '#ff9a92', fontSize: 14 }}>{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Unlocking…' : 'I’m 21 or older — Enter'}
          </button>
          <p className="lock-note">
            By entering you confirm you are 21 or older. Nothing on this site is visible until you do.
            <br />Already have an account? <Link to="/login" style={{ textDecoration: 'underline', color: '#c6d2db' }}>Sign in</Link>
          </p>
        </form>
      )}
    </div>
  )
}
