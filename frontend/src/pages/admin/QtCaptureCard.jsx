import { useCallback, useEffect, useRef, useState } from 'react'
import { adminFetch } from './utils/api.js'
import { askConfirm } from './dialog'

// Admin → Bot captures: capture @QTMARKETBOT (up to the quantity selection, with its profile
// photo and description) and apply the resulting "QT Market" style to any of the Telegram bots.
// Uses Captain Slabbin's own capture engine (/admin/qt-capture), not the bots platform's.
const call = (path, method, body) => adminFetch(`/admin/qt-capture${path}`, method ? { method, body: body === undefined ? undefined : JSON.stringify(body) } : {})
const muted = { color: '#777', fontSize: 13 }

export default function QtCaptureCard() {
  const [st, setSt] = useState(null)       // task state, journal, capture summary
  const [keys, setKeys] = useState(null)   // { apiId, configured }
  const [acct, setAcct] = useState(null)   // the Telegram account of the capture
  const [bots, setBots] = useState([])
  const [target, setTarget] = useState('')
  const [form, setForm] = useState({ apiId: '', apiHash: '', phone: '', code: '', password: '' })
  const [step, setStep] = useState('')     // '' | 'code' | 'password'
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const logRef = useRef(null)
  const field = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const refresh = useCallback(async () => { try { setSt(await call('/state')) } catch (e) { setError(e.message) } }, [])
  const loadAccount = useCallback(async () => {
    try {
      const [k, a, t] = await Promise.all([call('/api-keys'), call('/account'), adminFetch('/admin/telegram')])
      setKeys(k); setAcct((a.profiles || []).find(p => p.name === 'explorer') || null)
      setBots(t.bots || [])
      setTarget(cur => cur || String((t.bots || [])[0]?.id || ''))
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { refresh(); loadAccount() }, [refresh, loadAccount])
  // While a task runs, follow its journal
  useEffect(() => {
    if (!st?.running) return
    const id = setInterval(refresh, 2000)
    return () => clearInterval(id)
  }, [st?.running, refresh])
  // A task that ends may have changed the account (sign-out)
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !st?.running) loadAccount()
    wasRunning.current = !!st?.running
  }, [st?.running, loadAccount])
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [st?.log?.length])

  const guard = async fn => {
    setError(''); setWorking(true)
    try { await fn() } catch (e) { setError(e.message) } finally { setWorking(false) }
  }
  // With keys, the account of a session already on the server can be read
  const saveKeys = () => guard(async () => { await call('/api-keys', 'PUT', { apiId: form.apiId, apiHash: form.apiHash }); setForm(f => ({ ...f, apiHash: '' })); await loadAccount() })
  const sendCode = () => guard(async () => {
    const r = await call('/account/send-code', 'POST', { phone: form.phone })
    if (r.error) throw new Error(r.error)
    setStep('code')
  })
  const signIn = () => guard(async () => {
    const r = await call('/account/sign-in', 'POST', { code: form.code, password: form.password })
    if (r.need_password) { setStep('password'); if (r.error) throw new Error(r.error); return }
    if (r.error) throw new Error(r.error)
    setStep(''); setForm(f => ({ ...f, code: '', password: '' })); await loadAccount()
  })
  const signOut = () => guard(async () => {
    if (!(await askConfirm('Sign this Telegram account out? Captures then need a new sign-in.', { okLabel: 'Sign out', danger: true }))) return
    setSt(await call('/account/sign-out', 'POST', {}))
  })
  const apply = fresh => guard(async () => {
    const bot = bots.find(b => String(b.id) === String(target))
    const msg = `Capture @QTMARKETBOT${fresh ? ' from scratch' : ''} (up to the quantity selection, with its profile photo and description), then ${bot ? `apply the "QT Market" style to @${bot.username || bot.id}` : 'make the "QT Market" style'}?`
    if (!(await askConfirm(msg, { okLabel: fresh ? 'Restart' : (bot ? 'Capture and apply' : 'Capture'), danger: fresh }))) return
    setSt(await call('/apply', 'POST', { botId: bot ? bot.id : null, fresh }))
  })
  const clearLog = () => call('/log/clear', 'POST', {}).then(setSt).catch(e => setError(e.message))

  const running = !!st?.running
  const cap = st?.capture
  const signed = !!acct?.authorized

  return (
    <div className="admin-card">
      <h2 className="admin-card-title">Capture @QTMARKETBOT and apply it to a bot</h2>
      <p style={{ ...muted, marginTop: 0 }}>
        The capture walks every product and its place in the bot, stops at the quantity selection, and also reads the bot&apos;s profile photo,
        name and description. The &quot;QT Market&quot; style is then made from it and applied to the Telegram bot you pick.
      </p>
      {error && <div className="admin-alert admin-alert-error">{error}</div>}

      {keys && !keys.configured && (
        <div className="admin-form-group">
          <label className="admin-label">Telegram API keys (my.telegram.org → API development tools)</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="admin-input" style={{ maxWidth: 160 }} placeholder="api_id" value={form.apiId} onChange={field('apiId')} />
            <input className="admin-input" style={{ maxWidth: 300 }} placeholder="api_hash" value={form.apiHash} onChange={field('apiHash')} />
            <button type="button" className="admin-btn admin-btn-primary" disabled={working} onClick={saveKeys}>Save</button>
          </div>
        </div>
      )}

      {keys?.configured && !signed && (
        <div className="admin-form-group">
          <label className="admin-label">Telegram account used for the capture</label>
          {step === '' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input className="admin-input" style={{ maxWidth: 220 }} placeholder="+33600000000" value={form.phone} onChange={field('phone')} />
              <button type="button" className="admin-btn admin-btn-primary" disabled={working || !form.phone} onClick={sendCode}>Send the code</button>
            </div>
          )}
          {step !== '' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input className="admin-input" style={{ maxWidth: 160 }} placeholder="Code" value={form.code} onChange={field('code')} />
              {step === 'password' && <input className="admin-input" style={{ maxWidth: 220 }} type="password" placeholder="2FA password" value={form.password} onChange={field('password')} />}
              <button type="button" className="admin-btn admin-btn-primary" disabled={working} onClick={signIn}>Sign in</button>
              <button type="button" className="admin-btn admin-btn-secondary" disabled={working} onClick={() => setStep('')}>Other number</button>
            </div>
          )}
        </div>
      )}

      {signed && (
        <>
          <p style={{ marginTop: 0 }}>
            Signed in as <b>{acct.first_name}</b>{acct.username ? ` (@${acct.username})` : ''} · {acct.phone}.{' '}
            <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" disabled={working || running} onClick={signOut}>Sign out</button>
          </p>
          <div className="admin-form-group">
            <label className="admin-label">Apply the style to</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select className="admin-input" style={{ maxWidth: 320 }} value={target} onChange={e => setTarget(e.target.value)} disabled={running}>
                <option value="">No bot: only make the style</option>
                {bots.map(b => <option key={b.id} value={b.id}>@{b.username || b.id}</option>)}
              </select>
              <button type="button" className="admin-btn admin-btn-primary" disabled={running || working} onClick={() => apply(false)}>
                {running ? `${st.task} running…` : target ? 'Capture and apply' : 'Capture'}
              </button>
              <button type="button" className="admin-btn admin-btn-secondary" disabled={running || working} onClick={() => apply(true)}
                title="Discard the saved capture and start again at /start">Restart</button>
              {running && <button type="button" className="admin-btn admin-btn-danger" onClick={() => call('/stop', 'POST', {}).then(setSt).catch(e => setError(e.message))}>Stop</button>}
            </div>
          </div>
        </>
      )}

      {cap ? (
        <div style={muted}>
          Capture: {cap.screens} screens · {cap.steps} paths explored{cap.queued ? ` · ${cap.queued} left` : ' · complete'} · {new Date(cap.updated).toLocaleDateString()}
          {' · '}profile: {cap.profile.photo ? 'photo' : 'no photo'}, {cap.profile.description ? 'description' : 'no description'}, {cap.profile.commands} command(s)
        </div>
      ) : <div style={muted}>No capture of @QTMARKETBOT on this server yet.</div>}

      {st?.log?.length > 0 && <div style={{ textAlign: 'right', marginTop: 12 }}><button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={clearLog}>Clear</button></div>}
      {st?.log?.length > 0 && (
        <pre ref={logRef} style={{ marginTop: 12, maxHeight: 240, overflow: 'auto', background: '#0e1621', color: '#cfd8e3', padding: 12, borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {st.log.join('\n')}
        </pre>
      )}
    </div>
  )
}
