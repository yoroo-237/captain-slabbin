import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { adminFetch } from './utils/api.js'
import { askConfirm, showMessage } from './dialog'
import { useTask, taskName, lineKind } from '../../bots/CapturePage.jsx'

// Admin → Bot captures: keeps the replica styles up to date. Only the bot a style
// was replicated from can be captured again here (the server refuses any other):
// the capture resumes where it stopped, runs to the end, then that same style is
// rebuilt and the bots using it get its new screens and commands.
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

  const saveKeys = step('keys', async () => {
    await adminFetch('/admin/capture/api-keys', { method: 'PUT', body: JSON.stringify({ apiId: form.apiId, apiHash: form.apiHash }) })
    setForm(f => ({ ...f, apiHash: '' })); await load()
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
      ) : me?.authorized ? (
        <p style={{ margin: 0 }}>Signed in as <b>{me.first_name}</b>{me.username ? ` (@${me.username})` : ''} · {me.phone}. Captures use this account.</p>
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
  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([adminFetch('/admin/telegram'), cap('/captures')])
      setStyles((t.styles || []).filter(s => s.replicaOf).map(s => ({ ...s, bots: (t.bots || []).filter(b => b.styleId === s.id).map(b => b.username) })))
      setCaptures(c.captures || [])
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    onDone.current = () => {
      load()
      const tail = lines.slice(-12)
      const said = [...tail].reverse().find(l => !l.startsWith('-- terminé') && !l.startsWith('$ ')) || ''
      showMessage(said || 'The update is finished.')
    }
  }, [onDone, load, lines])

  const busy = state.running
  const captureOf = bot => captures.find(c => c.name === String(bot).toLowerCase())
  const update = async s => {
    if (!(await askConfirm(`Update "${s.name}" from @${s.replicaOf}? The capture resumes where it stopped and runs to the end, then this style is rebuilt and the bots using it get its new screens and commands.`, { okLabel: 'Update' }))) return
    setError('')
    try { await cap(`/styles/${s.id}/refresh`, {}) } catch (e) { setError(e.message) }
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

      <TelegramAccount />

      <div className="admin-card">
        <h2 className="admin-card-title">Replica styles</h2>
        {!styles ? <p style={muted}>Loading…</p> : styles.length === 0 ? (
          <p style={{ ...muted, marginTop: 0 }}>No replica style yet. A style made by replicating a bot shows here, ready to be updated from that bot.</p>
        ) : (() => {
          const s = styles.find(x => String(x.id) === String(picked)) || styles[0]
          const c = captureOf(s.replicaOf)
          return (
            <>
              <div className="admin-form-group">
                <label className="admin-label">Style to update</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select className="admin-input" style={{ maxWidth: 420 }} value={s.id} onChange={e => setPicked(e.target.value)} disabled={busy}>
                    {styles.map(x => <option key={x.id} value={x.id}>{x.name} (from @{x.replicaOf})</option>)}
                  </select>
                  <button type="button" className="admin-btn admin-btn-primary" disabled={busy} onClick={() => update(s)}>{busy ? 'Updating…' : 'Update'}</button>
                </div>
              </div>
              <div style={muted}>
                From <b>@{s.replicaOf}</b> · capture: {c ? `${c.screens} screens, ${c.queued ? `${c.queued} actions left` : 'complete'}, ${new Date(c.updated).toLocaleDateString()}` : 'not on this server yet (the update starts it)'}
                {' · '}used by {s.bots.length ? s.bots.map(b => `@${b}`).join(', ') : 'no bot yet'}
              </div>
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
    </div>
  )
}
