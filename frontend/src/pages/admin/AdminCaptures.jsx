import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { adminFetch } from './utils/api.js'
import { askConfirm, showMessage } from './dialog'
import { BASE } from '../../utils/api.js'
import { useTask, taskName, lineKind } from '../../bots/CapturePage.jsx'
import Simulator from '../../bots/Simulator.jsx'
import FidelityCheck from '../../bots/FidelityCheck.jsx'
import { UiProvider } from '../../bots/ui.jsx'
import QtCaptureCard from './QtCaptureCard.jsx'
import '../../bots/bots.css'

// Admin → Bot captures: keeps the replica styles up to date. Only the bot a style
// was replicated from can be captured again here (the server refuses any other):
// the capture resumes where it stopped, runs to the end, then that same style is
// rebuilt and the bots using it get its new screens and commands. The capture of
// the style picked can be played in the simulation and checked route by route, the
// routes missing run again (then the style is rebuilt the same way).
const cap = (path, body) => adminFetch(`/admin/capture${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
const muted = { fontSize: '0.8rem', color: '#777', marginTop: 4 }
const LOG_COLORS = { cmd: '#8a94a6', ok: '#28a745', err: '#dc3545', info: '#b8860b' }

// The capture needs the staff member's own Telegram account: API keys once, then a sign-in
function TelegramAccount() {
  const [keys, setKeys] = useState(null)
  const [account, setAccount] = useState(null)
  const [form, setForm] = useState({ apiId: '', apiHash: '', phone: '', code: '', password: '' })
  const [stage, setStage] = useState('phone')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const load = useCallback(async () => {
    const k = await cap('/api-keys').catch(e => { setError(e.message); return null })
    setKeys(k)
    if (k?.configured) setAccount(await cap('/account?profile=explorer').catch(() => null))
  }, [])
  useEffect(() => { load() }, [load])
  const step = (name, fn) => async e => {
    e?.preventDefault()
    setBusy(name); setError('')
    try { await fn() } catch (err) { setError(err.message) } finally { setBusy('') }
  }
  const me = account?.profiles?.find(p => p.name === 'explorer')
  const [changingKeys, setChangingKeys] = useState(false)
  // Signing out closes the session on Telegram (the device disappears from it); the
  // next sign-in can use any number
  const switchAccount = step('out', async () => {
    if (!(await askConfirm('Sign this account out? Captures then need a sign-in again, with this or another number.', { okLabel: 'Sign out', danger: true }))) return
    await cap('/account/sign-out', { profile: 'explorer' })
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const a = await cap('/account?profile=explorer').catch(() => null)
      if (!a?.profiles?.find(p => p.name === 'explorer')?.authorized) { setAccount(a); setStage('phone'); return }
    }
  })

  const saveKeys = step('keys', async () => {
    await adminFetch('/admin/capture/api-keys', { method: 'PUT', body: JSON.stringify({ apiId: form.apiId, apiHash: form.apiHash }) })
    setForm(f => ({ ...f, apiHash: '' })); setChangingKeys(false); await load()
  })
  const sendCode = step('code', async () => {
    const r = await cap('/account/send-code', { profile: 'explorer', phone: form.phone })
    if (r.error) throw new Error(r.error)
    setStage('code')
  })
  const signIn = step('signin', async () => {
    const r = await cap('/account/sign-in', { profile: 'explorer', code: form.code, password: form.password })
    if (r.need_password) setStage('password')
    if (r.error) throw new Error(r.error)
    if (r.ok) { setStage('phone'); setForm(f => ({ ...f, code: '', password: '' })); await load() }
  })

  return (
    <div className="admin-card">
      <h2 className="admin-card-title">Your Telegram account</h2>
      {error && <div className="admin-alert admin-alert-error">{error}</div>}
      {!keys ? <p style={muted}>Loading…</p> : !keys.configured ? (
        <form onSubmit={saveKeys}>
          <p style={{ ...muted, marginTop: 0 }}>Once: on <a href="https://my.telegram.org" target="_blank" rel="noreferrer">my.telegram.org</a>, sign in with your number, open “API development tools”, create an app (any name), then copy “App api_id” and “App api_hash”. They stay on your account.</p>
          <div className="admin-grid-2">
            <div className="admin-form-group"><label className="admin-label">api_id</label><input className="admin-input" inputMode="numeric" value={form.apiId} onChange={set('apiId')} required /></div>
            <div className="admin-form-group"><label className="admin-label">api_hash</label><input className="admin-input" autoComplete="off" value={form.apiHash} onChange={set('apiHash')} required /></div>
          </div>
          <button className="admin-btn admin-btn-primary" disabled={!!busy}>{busy === 'keys' ? 'Saving…' : 'Save the keys'}</button>
        </form>
      ) : changingKeys ? (
        <form onSubmit={saveKeys}>
          <p style={{ ...muted, marginTop: 0 }}>New API keys from <a href="https://my.telegram.org" target="_blank" rel="noreferrer">my.telegram.org</a> (API development tools). The account signed in now stays signed in.</p>
          <div className="admin-grid-2">
            <div className="admin-form-group"><label className="admin-label">api_id</label><input className="admin-input" inputMode="numeric" value={form.apiId} onChange={set('apiId')} required /></div>
            <div className="admin-form-group"><label className="admin-label">api_hash</label><input className="admin-input" autoComplete="off" value={form.apiHash} onChange={set('apiHash')} required /></div>
          </div>
          <div className="admin-gap-actions">
            <button className="admin-btn admin-btn-primary" disabled={!!busy}>{busy === 'keys' ? 'Saving…' : 'Save the keys'}</button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setChangingKeys(false)}>Cancel</button>
          </div>
        </form>
      ) : me?.authorized ? (
        <>
          <p style={{ marginTop: 0 }}>Signed in as <b>{me.first_name}</b>{me.username ? ` (@${me.username})` : ''} · {me.phone}. Captures use this account.</p>
          <div className="admin-gap-actions">
            <button type="button" className="admin-btn admin-btn-secondary" disabled={!!busy} onClick={switchAccount}>{busy === 'out' ? 'Signing out…' : 'Use another account'}</button>
            <button type="button" className="admin-btn admin-btn-secondary" disabled={!!busy} onClick={() => { setChangingKeys(true); setForm(f => ({ ...f, apiId: keys.apiId, apiHash: '' })) }}>Change the API keys</button>
          </div>
        </>
      ) : (
        <form onSubmit={stage === 'phone' ? sendCode : signIn}>
          <p style={{ ...muted, marginTop: 0 }}>Sign in the account that browses the bots. Telegram sends the code in its app, not by SMS.</p>
          {stage === 'phone' && <div className="admin-form-group"><label className="admin-label">Phone number</label><input className="admin-input" inputMode="tel" placeholder="+33600000000" value={form.phone} onChange={set('phone')} required /></div>}
          {stage === 'code' && <div className="admin-form-group"><label className="admin-label">Code received in Telegram</label><input className="admin-input" inputMode="numeric" autoComplete="one-time-code" value={form.code} onChange={set('code')} required autoFocus /></div>}
          {stage === 'password' && <div className="admin-form-group"><label className="admin-label">2FA password of the account</label><input className="admin-input" type="password" autoComplete="off" value={form.password} onChange={set('password')} required autoFocus /></div>}
          <div className="admin-gap-actions">
            <button className="admin-btn admin-btn-primary" disabled={!!busy}>{busy ? '…' : stage === 'phone' ? 'Get the code' : 'Sign in'}</button>
            {stage !== 'phone' && <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setStage('phone')}>Another number</button>}
          </div>
        </form>
      )}
    </div>
  )
}

function Journal({ lines }) {
  const box = useRef(null)
  const stick = useRef(true)
  useLayoutEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight }, [lines])
  return (
    <div ref={box} role="log" aria-live="polite" onScroll={() => { const el = box.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24 }}
      style={{ background: '#1a1a2e', color: '#d6d9e0', borderRadius: 8, padding: '10px 14px', height: 360, overflow: 'auto', font: '12px/1.6 ui-monospace, Consolas, monospace' }}>
      {lines.length
        ? lines.map((l, i) => <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: LOG_COLORS[lineKind(l)] || undefined }}>{l}</div>)
        : <div style={{ color: '#8a94a6' }}>The progress of an update shows here.</div>}
    </div>
  )
}

export default function AdminCaptures() {
  const { state, lines, onDone } = useTask()
  const [styles, setStyles] = useState(null)
  const [captures, setCaptures] = useState([])
  const [picked, setPicked] = useState('')
  const [error, setError] = useState('')
  const [filesKey, setFilesKey] = useState('')
  const [view, setView] = useState('') // '' | 'sim' | 'check'
  const [tick, setTick] = useState(0)
  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([adminFetch('/admin/telegram'), cap('/captures')])
      setStyles((t.styles || []).filter(s => s.sourceBot).map(s => ({ ...s, bots: (t.bots || []).filter(b => b.styleId === s.id).map(b => b.username) })))
      setCaptures(c.captures || []); setFilesKey(c.key || '')
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])
  // While a capture runs, refresh the counts so the paths-done / total progress moves
  useEffect(() => {
    if (!state.running) return
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [state.running, load])
  useEffect(() => {
    onDone.current = () => {
      load(); setTick(t => t + 1)
      const tail = lines.slice(-12)
      const said = [...tail].reverse().find(l => !l.startsWith('-- terminé') && !l.startsWith('$ ')) || ''
      showMessage(said || 'The update is finished.')
    }
  }, [onDone, load, lines])

  const busy = state.running
  const captureOf = bot => captures.find(c => c.name === String(bot).toLowerCase())
  const current = styles?.find(x => String(x.id) === String(picked)) || styles?.[0]
  const shown = view && current && captureOf(current.sourceBot) ? current : null
  const toggleView = v => setView(x => (x === v ? '' : v))
  const update = async (s, fresh = false) => {
    const what = s.replica ? 'this style is rebuilt and the bots using it get its new screens and commands'
      : 'its information pages and its welcome and menu pictures are updated (its catalog, cart and checkout stay as they are)'
    const msg = fresh
      ? `Recapture "${s.name}" from @${s.sourceBot} from scratch? The saved capture is discarded and it starts again at /start — this can be long — then ${what}.`
      : `Update "${s.name}" from @${s.sourceBot}? The capture resumes where it stopped and runs to the end, then ${what}.`
    if (!(await askConfirm(msg, { okLabel: fresh ? 'Restart' : 'Update', danger: fresh }))) return
    setError('')
    try { await cap(`/styles/${s.id}/refresh`, fresh ? { fresh: true } : {}) } catch (e) { setError(e.message) }
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Bot captures</h1>
          <p className="admin-page-subtitle">Keep the replica styles up to date: only the bot a style was made from can be captured again</p>
        </div>
      </div>
      {error && <div className="admin-alert admin-alert-error">{error}</div>}

      <QtCaptureCard />

      <TelegramAccount />

      <div className="admin-card">
        <h2 className="admin-card-title">Styles</h2>
        {!styles ? <p style={muted}>Loading…</p> : styles.length === 0 ? (
          <p style={{ ...muted, marginTop: 0 }}>No style made from a bot yet. A style copied or replicated from a bot shows here, ready to be updated from that bot.</p>
        ) : (() => {
          const s = current
          const c = captureOf(s.sourceBot)
          return (
            <>
              <div className="admin-form-group">
                <label className="admin-label">Style to update</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select className="admin-input" style={{ maxWidth: 420 }} value={s.id} onChange={e => setPicked(e.target.value)} disabled={busy}>
                    {styles.map(x => <option key={x.id} value={x.id}>{x.name} (from @{x.sourceBot})</option>)}
                  </select>
                  <button type="button" className="admin-btn admin-btn-primary" disabled={busy} onClick={() => update(s)}>{busy ? 'Updating…' : 'Update'}</button>
                  <button type="button" className="admin-btn admin-btn-secondary" disabled={busy} onClick={() => update(s, true)} title="Discard the saved capture and capture the bot again from /start">Restart</button>
                  {c && <button type="button" className={`admin-btn ${view === 'sim' ? 'admin-btn-primary' : 'admin-btn-secondary'}`} onClick={() => toggleView('sim')}>Simulate</button>}
                  {c && <button type="button" className={`admin-btn ${view === 'check' ? 'admin-btn-primary' : 'admin-btn-secondary'}`} onClick={() => toggleView('check')}>Check</button>}
                </div>
              </div>
              <div style={muted}>
                From <b>@{s.sourceBot}</b> · {s.replica ? 'replica: rebuilt from the bot' : 'shop style: information pages and pictures only'} · used by {s.bots.length ? s.bots.map(b => `@${b}`).join(', ') : 'no bot yet'}
              </div>
              {c ? (() => {
                const done = c.steps || 0, left = c.queued || 0, total = done + left
                const pct = total ? Math.round((done / total) * 100) : (c.screens ? 100 : 0)
                return (
                  <div style={{ marginTop: 8, maxWidth: 460 }}>
                    <div style={muted}>
                      Capture: {c.screens} screens · <b>{done}</b> paths explored{left ? <> · {left} left · <b>{total}</b> total ({pct}%)</> : ' · complete'} · {new Date(c.updated).toLocaleDateString()}
                    </div>
                    <div style={{ height: 6, background: '#e6e6ef', borderRadius: 999, overflow: 'hidden', marginTop: 6 }}>
                      <div style={{ width: `${left ? pct : 100}%`, height: '100%', background: left ? '#1a1a2e' : '#28a745', transition: 'width .4s' }} />
                    </div>
                  </div>
                )
              })() : <div style={muted}>Capture: not on this server yet (the update starts it)</div>}
            </>
          )
        })()}
      </div>

      <div className="admin-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <h2 className="admin-card-title" style={{ margin: 0 }}>Progress {busy && <span style={{ fontWeight: 400, color: '#777', fontSize: 14 }}>· {taskName(state.name)} running</span>}</h2>
          {busy && <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => cap('/stop', {}).catch(e => setError(e.message))}>Stop</button>}
        </div>
        <Journal lines={lines} />
        <p style={muted}>Stopping keeps what was captured and leaves the style as it was; the next update resumes from there.</p>
      </div>

      {/* The bots dashboard's own simulation and check, in its look */}
      {shown && (
        <UiProvider>
          <div className="bp bp-in-admin" style={{ minHeight: 0, background: 'transparent', borderRadius: 16 }}>
            {view === 'check' && <FidelityCheck key={shown.id} bot={shown.sourceBot.toLowerCase()} busy={busy} tick={tick} rebuild={shown.id}
              onRetried={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />}
            {view === 'sim' && filesKey && <Simulator key={shown.id} bot={shown.sourceBot.toLowerCase()} files={`${BASE}/api/capture-files/${filesKey}`} onClose={() => setView('')} />}
          </div>
        </UiProvider>
      )}
    </div>
  )
}
