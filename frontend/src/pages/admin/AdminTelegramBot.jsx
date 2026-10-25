import { useCallback, useEffect, useState } from 'react'
import { adminFetch } from './utils/api.js'

// Admin → Settings → Telegram bot. Paste a bot token, pick the chat it posts to,
// tick (or not) "Apply the Captain Slabbin look", link. Switching bots or chats
// is done the same way — no environment variable to touch.
export default function AdminTelegramBot({ canEdit }) {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [replacing, setReplacing] = useState(false)

  // Link form
  const [token, setToken] = useState('')
  const [found, setFound] = useState(null)       // result of /inspect
  const [takeOver, setTakeOver] = useState(false)
  const [chatId, setChatId] = useState('')
  const [brand, setBrand] = useState(true)

  const load = useCallback(() => {
    adminFetch('/admin/telegram').then(setStatus).catch(e => setError(e.message))
  }, [])
  useEffect(() => { load() }, [load])

  async function act(name, fn) {
    setBusy(name); setError(''); setNotice('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  const inspect = (over = takeOver) => act('inspect', async () => {
    const r = await adminFetch('/admin/telegram/inspect', { method: 'POST', body: JSON.stringify({ token: token.trim(), takeOver: over }) })
    setFound(r)
    setChatId(r.chats.length === 1 ? r.chats[0].id : '')
  })

  const link = () => act('link', async () => {
    const r = await adminFetch('/admin/telegram/link', { method: 'POST', body: JSON.stringify({ token: token.trim(), chatId, brand }) })
    setNotice(`@${r.bot.username} is linked.${r.helloDelivered ? ' A confirmation was posted in the chat.' : ` The confirmation message could not be posted (${r.helloError}).`}${r.webhook ? '' : ' Commands (/shop, /admin) will reply once the site runs on HTTPS.'}`)
    setToken(''); setFound(null); setTakeOver(false); setReplacing(false)
    load()
  })

  const post = (path, body, done) => act(path, async () => {
    await adminFetch(`/admin/telegram/${path}`, { method: 'POST', body: JSON.stringify(body || {}) })
    setNotice(done); load()
  })

  if (!status) return <div className="admin-card">{error ? <div className="admin-alert admin-alert-error">{error}</div> : 'Loading…'}</div>
  if (!canEdit) return <div className="admin-card"><div className="admin-alert admin-alert-info">Only admins can manage the Telegram bot.</div></div>

  const muted = { fontSize: '0.8rem', color: '#777', marginTop: 4 }
  const showForm = !status.linked || replacing

  return (
    <div className="admin-card">
      <h2 className="admin-card-title">Telegram bot</h2>
      <p style={{ ...muted, marginTop: 0, marginBottom: 16 }}>
        The bot posts every paid order and every new customer message in your shop's Telegram chat, with a button that opens it here.
      </p>
      {error && <div className="admin-alert admin-alert-error">{error}</div>}
      {notice && <div className="admin-alert admin-alert-success">{notice}</div>}

      {status.linked && !replacing && (
        <>
          {status.error ? (
            <div className="admin-alert admin-alert-error">The linked bot does not answer: {status.error}. Its token may have been revoked: link a new one.</div>
          ) : (
            <div className="admin-info-row" style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
              <div><b>Bot:</b> @{status.bot.username} ({status.bot.name}){status.branded ? ' · Captain Slabbin look applied' : ''}</div>
              <div><b>Posts to:</b> {status.chat ? `${status.chat.title} (${status.chatId})` : status.chatId || 'no chat chosen'}</div>
              <div><b>Commands:</b> {status.webhook.url ? '/shop and /admin reply' : 'off until the site runs on HTTPS'}{status.webhook.lastError ? ` · last error: ${status.webhook.lastError}` : ''}</div>
            </div>
          )}

          {status.seenChats?.length > 1 && (
            <div className="admin-form-group">
              <label className="admin-label">Post to another chat this bot is in</label>
              <select className="admin-input" value={status.chatId || ''} onChange={e => post('chat', { chatId: e.target.value }, 'Chat changed. A message was posted there.')} disabled={!!busy}>
                {status.seenChats.map(c => <option key={c.id} value={c.id}>{c.title} ({c.type})</option>)}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="admin-btn admin-btn-primary" disabled={!!busy} onClick={() => post('test', null, 'Test message sent.')}>{busy === 'test' ? 'Sending…' : 'Send a test message'}</button>
            {!status.branded && <button type="button" className="admin-btn admin-btn-secondary" disabled={!!busy} onClick={() => post('brand', null, 'Captain Slabbin look applied to the bot.')}>Apply the Captain Slabbin look</button>}
            <button type="button" className="admin-btn admin-btn-secondary" disabled={!!busy} onClick={() => { setReplacing(true); setNotice('') }}>Use another bot</button>
            <button type="button" className="admin-btn admin-btn-danger" disabled={!!busy} onClick={() => window.confirm('Unlink this bot? Notifications stop until you link one again.') && post('unlink', null, 'Bot unlinked.')}>Unlink</button>
          </div>
        </>
      )}

      {showForm && (
        <div style={{ display: 'grid', gap: 14 }}>
          <ol style={{ ...muted, margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>New bot: in Telegram, open <b>@BotFather</b>, send <code>/newbot</code>, copy the token. Or use the token of a bot you already have.</li>
            <li>Add the bot to your shop's group or channel and send any message there.</li>
            <li>Paste the token below and click <b>Check</b>.</li>
          </ol>

          <div className="admin-form-group" style={{ margin: 0 }}>
            <label className="admin-label">Bot token</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="admin-input" type="password" autoComplete="off" placeholder="123456789:AA…" value={token} onChange={e => { setToken(e.target.value); setFound(null) }} />
              <button type="button" className="admin-btn admin-btn-primary" disabled={!token.trim() || !!busy} onClick={() => inspect(false)}>{busy === 'inspect' ? 'Checking…' : 'Check'}</button>
            </div>
          </div>

          {found && (
            <>
              <div><b>Found:</b> @{found.bot.username} ({found.bot.name})</div>

              {found.busyElsewhere ? (
                <div className="admin-alert admin-alert-info">
                  This bot is already connected to another app ({found.busyElsewhere}). Linking it here disconnects it from there.
                  <label style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={takeOver} onChange={e => setTakeOver(e.target.checked)} /> Yes, use this bot for the shop
                  </label>
                  {takeOver && <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" style={{ marginTop: 8 }} onClick={() => inspect(true)} disabled={!!busy}>Continue</button>}
                </div>
              ) : (
                <>
                  <div className="admin-form-group" style={{ margin: 0 }}>
                    <label className="admin-label">Chat the bot posts to</label>
                    {found.chats.length ? (
                      <div style={{ display: 'grid', gap: 6 }}>
                        {found.chats.map(c => (
                          <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input type="radio" name="tg-chat" checked={chatId === c.id} onChange={() => setChatId(c.id)} />
                            {c.title} <span style={{ color: '#999' }}>({c.type}, {c.id})</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="admin-alert admin-alert-info" style={{ margin: 0 }}>
                        No chat seen yet. Add the bot to your shop's group or channel, send a message there, then click <b>Check</b> again.
                      </div>
                    )}
                  </div>

                  <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <input type="checkbox" checked={brand} onChange={e => setBrand(e.target.checked)} style={{ marginTop: 3 }} />
                    <span>
                      Apply the Captain Slabbin look
                      <div style={muted}>Renames the bot "Captain Slabbin", sets its description, the /shop and /admin commands and an "Open shop" button. Leave unticked to keep the bot's own name and profile.</div>
                    </span>
                  </label>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="admin-btn admin-btn-primary" disabled={!chatId || !!busy} onClick={link}>{busy === 'link' ? 'Linking…' : 'Link this bot'}</button>
                    {replacing && <button type="button" className="admin-btn admin-btn-secondary" onClick={() => { setReplacing(false); setFound(null); setToken('') }}>Cancel</button>}
                  </div>
                </>
              )}
            </>
          )}
          {replacing && !found && <button type="button" className="admin-btn admin-btn-secondary" style={{ justifySelf: 'start' }} onClick={() => setReplacing(false)}>Cancel</button>}
        </div>
      )}
    </div>
  )
}
