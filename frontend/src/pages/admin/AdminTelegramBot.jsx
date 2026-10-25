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
    setNotice(`@${r.bot.username} is linked.${r.waitingForChat ? " Now add it to your shop's group or channel: it will pick that chat by itself." : r.helloDelivered ? ' A confirmation was posted in the chat.' : ` The confirmation message could not be posted (${r.helloError}).`}${r.webhook ? '' : ' The catalog and commands will reply once the site runs on HTTPS.'}`)
    setToken(''); setFound(null); setTakeOver(false); setReplacing(false)
    load()
  })

  const [photoPreview, setPhotoPreview] = useState(null)
  // Own photo: read as a data URL, sent as is (Telegram wants a JPG)
  function uploadPhoto(file, input) {
    if (!file) return
    input.value = ''
    if (!/jpe?g$/i.test(file.type)) { setError('The photo must be a JPG.'); return }
    if (file.size > 5 * 1024 * 1024) { setError('The photo must be under 5 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => {
      setPhotoPreview(reader.result)
      post('photo', { image: reader.result }, 'Your photo is now the bot’s profile photo.')
    }
    reader.readAsDataURL(file)
  }

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
        Customers browse the shelves, buy and pay from their wallet right in the bot, with no name to type: their account is their Telegram. Every paid order and customer message is posted in your shop's chat, with a button that opens it here.
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
              <div><b>Shop link for customers:</b> <a href={`https://t.me/${status.bot.username}`} target="_blank" rel="noreferrer">t.me/{status.bot.username}</a></div>
              <div><b>Orders and messages go to:</b> {status.chat ? `${status.chat.title} (${status.chatId})` : status.chatId || "waiting: add the bot to your shop's group or channel, it picks it by itself"}</div>
              <div><b>Commands:</b> {status.webhook.url ? 'catalog, buying and commands are on' : 'off until the site runs on HTTPS'}{status.webhook.lastError ? ` · last error: ${status.webhook.lastError}` : ''}</div>
            </div>
          )}

          {status.seenChats?.length > 0 && (
            <div className="admin-form-group">
              <label className="admin-label">Orders and messages go to</label>
              <select className="admin-input" value={status.chatId || ''} onChange={e => post('chat', { chatId: e.target.value }, 'Chat changed. A message was posted there.')} disabled={!!busy}>
                {!status.chatId && <option value="">Choose a chat</option>}
                {status.seenChats.map(c => <option key={c.id} value={c.id}>{c.title} ({c.type})</option>)}
              </select>
            </div>
          )}
          {status.seenChats?.length > 0 && (
            <div className="admin-form-group">
              <label className="admin-label">Post new products to</label>
              <select className="admin-input" value={status.postChatId || ''} onChange={e => post('post-chat', { chatId: e.target.value }, e.target.value ? 'New products will be posted there, with a button to buy in the bot.' : 'New products are no longer posted.')} disabled={!!busy}>
                <option value="">Don't post</option>
                {status.seenChats.filter(c => c.type !== 'private').map(c => <option key={c.id} value={c.id}>{c.title} ({c.type})</option>)}
              </select>
              <div style={muted}>Each new product is posted with its photo and price about a minute after you create it. Use a channel your customers follow.</div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="admin-btn admin-btn-primary" disabled={!!busy} onClick={() => post('test', null, 'Test message sent.')}>{busy === 'test' ? 'Sending…' : 'Send a test message'}</button>
            <button type="button" className="admin-btn admin-btn-secondary" disabled={!!busy} onClick={() => post('brand', null, 'Captain Slabbin look applied to the bot.')}>{status.branded ? 'Apply the look again' : 'Apply the Captain Slabbin look'}</button>
            <button type="button" className="admin-btn admin-btn-secondary" disabled={!!busy} onClick={() => { setReplacing(true); setNotice('') }}>Use another bot</button>
            <button type="button" className="admin-btn admin-btn-danger" disabled={!!busy} onClick={() => window.confirm('Unlink this bot? Notifications stop until you link one again.') && post('unlink', null, 'Bot unlinked.')}>Unlink</button>
          </div>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #eee', display: 'grid', gap: 18 }}>
            <div>
              <h3 className="admin-card-title" style={{ fontSize: '0.95rem' }}>Profile photo</h3>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <img src={photoPreview || '/brand/bot/avatar.jpg'} alt="" width="80" height="80" style={{ borderRadius: '50%', objectFit: 'cover' }} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="admin-btn admin-btn-secondary" disabled={!!busy} onClick={() => { setPhotoPreview(null); post('photo', null, 'The Captain Slabbin photo is now the bot’s profile photo.') }}>
                    {busy === 'photo' ? 'Sending…' : 'Use the Captain Slabbin photo'}
                  </button>
                  <label className="admin-btn admin-btn-secondary" style={{ cursor: 'pointer' }}>
                    Upload my own (JPG)
                    <input type="file" accept="image/jpeg" hidden onChange={e => uploadPhoto(e.target.files?.[0], e.target)} />
                  </label>
                </div>
              </div>
              <div style={muted}>Changes the bot's picture in Telegram right away. "Apply the look" also sets the Captain Slabbin photo.</div>
            </div>
            <div>
              <h3 className="admin-card-title" style={{ fontSize: '0.95rem' }}>Welcome picture</h3>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <a href="/brand/bot/intro.jpg" download="captain-slabbin-bot-intro.jpg"><img src="/brand/bot/intro.jpg" alt="Download" width="171" height="96" style={{ borderRadius: 8, display: 'block' }} /></a>
                <div style={{ ...muted, margin: 0, flex: '1 1 260px', lineHeight: 1.7 }}>
                  Shown to people before they tap Start. Telegram only takes it through <b>@BotFather</b>: download it (click the picture), then in @BotFather send <code>/mybots</code>, choose @{status.bot?.username}, <b>Edit Bot</b>, <b>Edit Description Picture</b>, and send it.
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {showForm && (
        <div style={{ display: 'grid', gap: 14 }}>
          <ol style={{ ...muted, margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>New bot: in Telegram, open <b>@BotFather</b>, send <code>/newbot</code>, copy the token. Or use the token of a bot you already have.</li>
            <li>Paste the token below, click <b>Check</b>, then <b>Link this bot</b>.</li>
            <li>Add the bot to your shop's group or channel (as admin for a channel): it picks that chat by itself for orders and messages.</li>
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
                        No chat yet, that's fine: link the bot now, then add it to your shop's group or channel. It will pick that chat by itself.
                      </div>
                    )}
                  </div>

                  <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <input type="checkbox" checked={brand} onChange={e => setBrand(e.target.checked)} style={{ marginTop: 3 }} />
                    <span>
                      Apply the Captain Slabbin look
                      <div style={muted}>Renames the bot "Captain Slabbin" and gives it the shop's description. The catalog, buying, wallet and commands work either way. Leave unticked to keep the bot's own name and profile.</div>
                    </span>
                  </label>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="admin-btn admin-btn-primary" disabled={(found.chats.length > 0 && !chatId) || !!busy} onClick={link}>{busy === 'link' ? 'Linking…' : 'Link this bot'}</button>
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
