import { useCallback, useEffect, useState } from 'react'
import { adminFetch } from './utils/api.js'
import { askConfirm, showMessage } from './dialog'

// Admin → Telegram. Several bots sell the same shop: link each by pasting its
// token, give it a style (profile, copy, images, pages) and the shelves it
// shows. The primary bot posts paid orders and customer messages to the shop's
// chat. Styles are written under "Styles", or recreated from one of the shop's
// own bots by its token.
const muted = { fontSize: '0.8rem', color: '#777', marginTop: 4 }
const TABS = ['Bots', 'Styles']

export default function AdminTelegramBot({ canEdit }) {
  const [tab, setTab] = useState('Bots')
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [shelves, setShelves] = useState([])

  const load = useCallback(() => {
    adminFetch('/admin/telegram').then(setStatus).catch(e => setError(e.message))
  }, [])
  useEffect(() => {
    load()
    adminFetch('/admin/categories').then(d => setShelves((d.categories || d || []).filter(c => !c.parentId))).catch(() => {})
  }, [load])

  // One action at a time; its message shows above the cards
  async function act(name, fn, done) {
    setBusy(name); setError(''); setNotice('')
    try { const r = await fn(); if (done) setNotice(typeof done === 'function' ? done(r) : done); load() } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const post = (path, body) => adminFetch(`/admin/telegram/${path}`, { method: 'POST', body: JSON.stringify(body || {}) })

  if (!status) return <div className="admin-card">{error ? <div className="admin-alert admin-alert-error">{error}</div> : 'Loading…'}</div>
  if (!canEdit) return <div className="admin-card"><div className="admin-alert admin-alert-info">Only admins can manage the Telegram bots.</div></div>

  return (
    <div>
      <div className="admin-tabs">
        {TABS.map(t => <button key={t} type="button" className={'admin-tab' + (tab === t ? ' active' : '')} onClick={() => { setTab(t); setNotice(''); setError('') }}>{t}</button>)}
      </div>
      {error && <div className="admin-alert admin-alert-error">{error}</div>}
      {notice && <div className="admin-alert admin-alert-success">{notice}</div>}

      {tab === 'Bots' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {status.bots.map(bot => <BotCard key={bot.id} bot={bot} styles={status.styles} shelves={shelves} busy={busy} act={act} post={post} />)}
          <LinkForm hasBots={status.bots.length > 0} styles={status.styles} busy={busy} act={act} post={post} />
        </div>
      )}
      {tab === 'Styles' && <StylesTab bots={status.bots} styles={status.styles} shelves={shelves} busy={busy} act={act} post={post} reload={load} />}
    </div>
  )
}

// ─── Bots ────────────────────────────────────────────────────────────────────

function BotCard({ bot, styles, shelves: allShelves, busy, act, post }) {
  const [picked, setPicked] = useState(bot.shelves || [])
  useEffect(() => { setPicked(bot.shelves || []) }, [bot.shelves])
  const id = bot.id
  // The shop's own picture belongs to the shop's own style only
  const isShopStyle = !bot.styleId || styles.find(s => s.id === bot.styleId)?.name === 'Captain Slabbin'
  // Only the shelves of the catalog this bot sells (its style's), never another catalog's
  const catalog = styles.find(s => s.id === bot.styleId)?.catalog || null
  const shelves = allShelves.filter(c => (c.source || null) === catalog)
  const groups = bot.seenChats.filter(c => c.type !== 'private')

  function uploadPhoto(file, input) {
    if (!file) return
    input.value = ''
    if (!/jpe?g$/i.test(file.type) || file.size > 5 * 1024 * 1024) return showMessage('The photo must be a JPG under 5 MB.')
    const reader = new FileReader()
    reader.onload = () => act(`photo${id}`, () => post(`bots/${id}/photo`, { image: reader.result }), 'Your photo is now the bot’s profile photo.')
    reader.readAsDataURL(file)
  }
  const toggle = slug => setPicked(p => p.includes(slug) ? p.filter(s => s !== slug) : [...p, slug])
  const changed = JSON.stringify([...picked].sort()) !== JSON.stringify([...(bot.shelves || [])].sort())

  return (
    <div className="admin-card">
      <h2 className="admin-card-title">
        @{bot.username || 'bot'} <span style={{ fontWeight: 400, color: '#777' }}>({bot.name})</span>
        {bot.isPrimary && <span className="admin-pill">Primary</span>}
      </h2>
      {bot.error ? (
        <div className="admin-alert admin-alert-error">This bot does not answer: {String(bot.error).replace(/[.\s]+$/, '')}. Its token may have been revoked: unlink it and link it again.</div>
      ) : (
        <div className="admin-info-row" style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
          <div><b>Link for customers:</b> <a href={`https://t.me/${bot.username}`} target="_blank" rel="noreferrer">t.me/{bot.username}</a> · {bot.customers} customer{bot.customers === 1 ? '' : 's'}</div>
          {bot.isPrimary && <div><b>Orders and messages go to:</b> {bot.chat ? `${bot.chat.title} (${bot.chatId})` : bot.chatId || "waiting: add the bot to your shop's group or channel, it picks it by itself"}</div>}
          <div><b>Catalog and commands:</b> {bot.webhook?.url ? 'on' : 'off until the site runs on HTTPS'}{bot.webhook?.lastError ? ` · last error: ${bot.webhook.lastError}` : ''}</div>
        </div>
      )}

      <div className="admin-form-group">
        <label className="admin-label">Style</label>
        <select className="admin-input" value={bot.styleId || ''} disabled={!!busy}
          onChange={async e => { const styleId = Number(e.target.value); styleId && await askConfirm('Apply this style? The bot’s name, descriptions, commands and photo change in Telegram right away.', { okLabel: 'Apply' })
            && act(`style${id}`, () => post(`bots/${id}/style`, { styleId }),
              r => r.photoError ? `Style applied, but the profile photo did not change: ${r.photoError}` : r.photo === 'none' ? 'Style applied. It has no profile photo, so the bot kept its current one.' : 'Style applied to the bot, photo included.') }}>
          {!bot.styleId && <option value="">No style (the bot keeps its own profile)</option>}
          {styles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {bot.isPrimary && bot.seenChats.length > 0 && (
        <div className="admin-form-group">
          <label className="admin-label">Orders and messages go to</label>
          <select className="admin-input" value={bot.chatId || ''} disabled={!!busy} onChange={e => act(`chat${id}`, () => post(`bots/${id}/chat`, { chatId: e.target.value }), 'Chat changed. A message was posted there.')}>
            {!bot.chatId && <option value="">Choose a chat</option>}
            {bot.seenChats.map(c => <option key={c.id} value={c.id}>{c.title} ({c.type})</option>)}
          </select>
        </div>
      )}
      {groups.length > 0 && (
        <div className="admin-form-group">
          <label className="admin-label">Post new products to</label>
          <select className="admin-input" value={bot.postChatId || ''} disabled={!!busy}
            onChange={e => act(`post${id}`, () => post(`bots/${id}/post-chat`, { chatId: e.target.value }), e.target.value ? 'New products will be posted there, with a button to buy in this bot.' : 'This bot no longer posts new products.')}>
            <option value="">Don't post</option>
            {groups.map(c => <option key={c.id} value={c.id}>{c.title} ({c.type})</option>)}
          </select>
        </div>
      )}

      {shelves.length > 0 && (
        <div className="admin-form-group">
          <label className="admin-label">Shelves this bot shows</label>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {shelves.map(c => (
              <label key={c.slug} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={picked.includes(c.slug)} onChange={() => toggle(c.slug)} /> {c.name}
              </label>
            ))}
          </div>
          <div style={muted}>None ticked: the bot shows every shelf.</div>
          {changed && <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" style={{ marginTop: 8 }} disabled={!!busy} onClick={() => act(`shelves${id}`, () => post(`bots/${id}/shelves`, { shelves: picked }), 'Shelves saved.')}>Save shelves</button>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {bot.isPrimary && <button type="button" className="admin-btn admin-btn-primary" disabled={!!busy} onClick={() => act('test', () => post('test'), 'Test message sent.')}>{busy === 'test' ? 'Sending…' : 'Send a test message'}</button>}
        {!bot.isPrimary && <button type="button" className="admin-btn admin-btn-secondary" disabled={!!busy} onClick={() => act(`primary${id}`, () => post(`bots/${id}/primary`), `@${bot.username} now posts the shop's notifications. Pick its chat below.`)}>Make primary</button>}
        {isShopStyle
          ? <button type="button" className="admin-btn admin-btn-secondary" disabled={!!busy} onClick={() => act(`photo${id}`, () => post(`bots/${id}/photo`), 'The shop photo is now the bot’s profile photo.')}>Use the shop photo</button>
          : <button type="button" className="admin-btn admin-btn-secondary" disabled={!!busy} onClick={() => act(`photo${id}`, () => post(`bots/${id}/photo`, { fromStyle: true }), 'The style’s photo is now the bot’s profile photo.')}>Use the style’s photo</button>}
        <label className="admin-btn admin-btn-secondary" style={{ cursor: 'pointer' }}>
          Upload a photo (JPG)
          <input type="file" accept="image/jpeg" hidden onChange={e => uploadPhoto(e.target.files?.[0], e.target)} />
        </label>
        <button type="button" className="admin-btn admin-btn-danger" disabled={!!busy}
          onClick={async () => await askConfirm(`Unlink @${bot.username}? It stops answering customers here.`, { okLabel: 'Unlink', danger: true }) && act(`unlink${id}`, () => post(`bots/${id}/unlink`), 'Bot unlinked.')}>Unlink</button>
      </div>
    </div>
  )
}

function LinkForm({ hasBots, styles, busy, act, post }) {
  const [open, setOpen] = useState(!hasBots)
  const [token, setToken] = useState('')
  const [found, setFound] = useState(null)
  const [takeOver, setTakeOver] = useState(false)
  const [chatId, setChatId] = useState('')
  const [styleId, setStyleId] = useState('')
  const [primary, setPrimary] = useState(!hasBots)
  const asPrimary = !hasBots || primary

  const inspect = over => act('inspect', async () => {
    const r = await post('inspect', { token: token.trim(), takeOver: over })
    setFound(r)
    setChatId(r.chats.length === 1 ? r.chats[0].id : '')
  })
  const link = () => act('link', async () => {
    const r = await post('link', { token: token.trim(), chatId: asPrimary ? chatId : '', styleId: Number(styleId) || null, primary: asPrimary })
    setToken(''); setFound(null); setTakeOver(false); setOpen(false)
    return r
  }, r => `@${r.bot.username} is linked.${r.styleError ? ` Its style could not be applied (${r.styleError}): choose it again on its card in a few minutes.` : ''}${r.waitingForChat ? " Now add it to your shop's group or channel: it will pick that chat by itself." : r.isPrimary && r.helloDelivered ? ' A confirmation was posted in the chat.' : r.isPrimary && r.helloError ? ` The confirmation message could not be posted (${r.helloError}).` : ''}${r.webhook ? '' : ' The catalog and commands will reply once the site runs on HTTPS.'}`)

  if (!open) return <button type="button" className="admin-btn admin-btn-primary" style={{ justifySelf: 'start' }} onClick={() => setOpen(true)}>+ Link another bot</button>

  return (
    <div className="admin-card">
      <h2 className="admin-card-title">{hasBots ? 'Link another bot' : 'Link a bot'}</h2>
      <ol style={{ ...muted, margin: '0 0 14px', paddingLeft: 18, lineHeight: 1.7 }}>
        <li>New bot: in Telegram, open <b>@BotFather</b>, send <code>/newbot</code>, copy the token. Or use the token of a bot you already have.</li>
        <li>Paste the token below, click <b>Check</b>, choose its style, then <b>Link this bot</b>.</li>
      </ol>
      <div className="admin-form-group">
        <label className="admin-label">Bot token</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="admin-input" type="password" autoComplete="off" placeholder="123456789:AA…" value={token} onChange={e => { setToken(e.target.value); setFound(null) }} />
          <button type="button" className="admin-btn admin-btn-primary" disabled={!token.trim() || !!busy} onClick={() => inspect(false)}>{busy === 'inspect' ? 'Checking…' : 'Check'}</button>
        </div>
      </div>

      {found && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div><b>Found:</b> @{found.bot.username} ({found.bot.name})</div>
          {found.alreadyLinked ? (
            <div className="admin-alert admin-alert-info" style={{ margin: 0 }}>This bot is already linked: it is in the list above.</div>
          ) : found.busyElsewhere ? (
            <div className="admin-alert admin-alert-info" style={{ margin: 0 }}>
              This bot is connected to another app ({found.busyElsewhere}). Linking it here disconnects it from there. To only recreate its look, use <b>Styles → Recreate one of my bots</b> instead: it reads the bot without disconnecting it.
              <label style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={takeOver} onChange={e => setTakeOver(e.target.checked)} /> Yes, move this bot to the shop
              </label>
              {takeOver && <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" style={{ marginTop: 8 }} onClick={() => inspect(true)} disabled={!!busy}>Continue</button>}
            </div>
          ) : (
            <>
              <div className="admin-form-group" style={{ margin: 0 }}>
                <label className="admin-label">Style</label>
                <select className="admin-input" value={styleId} onChange={e => setStyleId(e.target.value)}>
                  <option value="">None (keep the bot's own name and profile)</option>
                  {styles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              {hasBots && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={primary} onChange={e => setPrimary(e.target.checked)} /> Make it the primary bot (it posts the shop's notifications)
                </label>
              )}
              {asPrimary && (
                <div className="admin-form-group" style={{ margin: 0 }}>
                  <label className="admin-label">Orders and messages go to</label>
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
                    <div className="admin-alert admin-alert-info" style={{ margin: 0 }}>No chat yet, that's fine: link the bot now, then add it to your shop's group or channel. It will pick that chat by itself.</div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="admin-btn admin-btn-primary" disabled={(asPrimary && found.chats.length > 0 && !chatId) || !!busy} onClick={link}>{busy === 'link' ? 'Linking…' : 'Link this bot'}</button>
                {hasBots && <button type="button" className="admin-btn admin-btn-secondary" onClick={() => { setOpen(false); setFound(null); setToken('') }}>Cancel</button>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function StylesTab({ bots, styles, shelves, busy, act, post, reload }) {
  const [editing, setEditing] = useState(null) // { id?, name, look }
  const [defaults, setDefaults] = useState(null)
  const [neutral, setNeutral] = useState(null)
  const [token, setToken] = useState('')
  useEffect(() => {
    adminFetch('/admin/telegram/styles/defaults').then(d => setDefaults(d.look)).catch(() => {})
    adminFetch('/admin/telegram/styles/defaults?neutral=1&name=Your%20bot').then(d => setNeutral(d.look)).catch(() => {})
  }, [])

  const open = id => act('open', async () => {
    const { style } = await adminFetch(`/admin/telegram/styles/${id}`)
    setEditing({ id: style.id, name: style.name, look: style.look || {}, source: style.source })
  })
  const recreate = body => act('import', async () => {
    const { style } = await post('styles/import', body)
    setToken('')
    setEditing({ id: style.id, name: style.name, look: style.look, source: style.source })
    return style
  }, s => `Style "${s.name}" created from the bot's profile. Its screens are not readable by Telegram's API: rebuild them below as pages.`)

  // The shop's own style falls back to the shop's look; every other style to the brand-free base
  const fallback = editing && (editing.name === 'Captain Slabbin' ? defaults : neutral)
  if (editing && fallback) return <StyleEditor key={editing.id || 'new'} initial={editing} defaults={fallback} shelves={shelves} busy={busy} act={act} onClose={() => { setEditing(null); reload() }} />

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="admin-card">
        <h2 className="admin-card-title">Styles</h2>
        <p style={{ ...muted, marginTop: 0 }}>A style is a bot's profile, the copy of its screens, its buttons, images and pages. Anything left empty keeps the shop's default.</p>
        <div style={{ display: 'grid', gap: 8 }}>
          {styles.map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <span><b>{s.name}</b>{s.source ? <span style={{ color: '#999' }}> · recreated from {s.source}</span> : ''}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" disabled={!!busy} onClick={() => open(s.id)}>Edit</button>
                <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" disabled={!!busy}
                  onClick={async () => await askConfirm(`Delete the style "${s.name}"? Bots using it keep their current profile and go back to the default copy.`, { okLabel: 'Delete', danger: true }) && act('delete', () => adminFetch(`/admin/telegram/styles/${s.id}`, { method: 'DELETE' }), 'Style deleted.')}>Delete</button>
              </span>
            </div>
          ))}
        </div>
        <button type="button" className="admin-btn admin-btn-primary" style={{ marginTop: 14 }} disabled={!defaults} onClick={() => setEditing({ name: '', look: {} })}>+ New style</button>
      </div>

      <div className="admin-card">
        <h2 className="admin-card-title">Recreate one of my bots</h2>
        <p style={{ ...muted, marginTop: 0 }}>
          Its name, descriptions, commands, menu button and profile photo become a new style. The bot is only read: it keeps running where it runs.
        </p>
        {bots.length > 0 && (
          <div className="admin-form-group">
            <label className="admin-label">A bot linked here</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {bots.map(b => <button key={b.id} type="button" className="admin-btn admin-btn-secondary" disabled={!!busy} onClick={() => recreate({ botId: b.id })}>@{b.username}</button>)}
            </div>
          </div>
        )}
        <div className="admin-form-group" style={{ margin: 0 }}>
          <label className="admin-label">Another bot of yours, by its token</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="admin-input" type="password" autoComplete="off" placeholder="123456789:AA…" value={token} onChange={e => setToken(e.target.value)} />
            <button type="button" className="admin-btn admin-btn-primary" disabled={!token.trim() || !!busy} onClick={() => recreate({ token: token.trim() })}>{busy === 'import' ? 'Reading…' : 'Recreate'}</button>
          </div>
          <div style={muted}>@BotFather → <code>/mybots</code> → the bot → <b>API Token</b>. Telegram only gives a bot's profile to whoever holds its token.</div>
        </div>
      </div>
    </div>
  )
}

const LAYOUT_TEXT_FIELDS = [
  ['start', 'Welcome on /start ({menu} = the menu command)'], ['shelfIntro', 'Shelf intro ({shelf} = its name)'],
  ['customOrder', 'Custom order: asking for it'], ['customOrderSent', 'Custom order: received'],
  ['vendorLine', 'Line under each product ({handle} = the username below)'],
]
// Short one-line texts of the commands layout
const LAYOUT_LINE_FIELDS = [['handle', 'Shop username, written where a text or product says {handle} (empty = the bot’s own)']]
// Checkout of the commands layout: voucher, shipping details, summary
const CHECKOUT_TEXT_FIELDS = [
  ['shipTitle', 'Shipping: title'], ['ship_name', 'Shipping: asking for the name'], ['ship_street', 'Shipping: asking for the street'],
  ['ship_apt', 'Shipping: asking for the apartment'], ['ship_city', 'Shipping: asking for the city'], ['ship_state', 'Shipping: asking for the state'],
  ['ship_zip', 'Shipping: asking for the postcode'], ['shipCountry', 'Shipping: country'], ['shipAddressPgp', 'Shipping: asking for the encrypted address ({pgp} = the key page)'],
  ['pgpInvalid', 'Shipping: not a valid PGP message'], ['payTitle', 'Payment method: title'], ['refundAsk', 'Payment method: asking for the refund address ({coin})'],
  ['myCartTitle', 'My Cart: title'], ['cartHint', 'My Cart: tip under the title'], ['cartEmpty', 'My Cart: empty'], ['vendor', 'My Cart: vendor name ("by …")'],
  ['vouchersTitle', 'Vouchers: title'], ['noVouchers', 'Vouchers: none applied'], ['voucherAsk', 'Vouchers: asking for a code'], ['orderNotesAsk', 'Order notes: asking for them'],
  ['noteNotInCart', 'Product notes: product not in the cart'], ['ordersTitle', 'My Orders: title'], ['noOrdersYet', 'My Orders: none yet'],
  ['unknownCommand', 'Unknown command'],
]
const TEXT_FIELDS = [
  ['header', 'Menu header'], ['welcome', 'Welcome (before 21+ confirmation)'], ['menuIntro', 'Menu intro (customer)'],
  ['menuIntroGuest', 'Menu intro (group)'], ['restocking', 'No shelves'], ['delivery', 'Checkout: delivery'],
  ['paidNote', 'After payment'], ['walletIntro', 'Wallet'], ['noOrders', 'No orders yet'],
]
const LABEL_FIELDS = [
  ['ageButton', '21+ button'], ['fireSale', 'Fire Sale'], ['wallet', 'Wallet'], ['orders', 'My orders'], ['account', 'Account on the site'],
  ['openShop', 'Open the shop'], ['onSite', 'On the site'], ['buy', 'Buy'], ['keepShopping', 'Keep shopping'], ['allShelves', 'All shelves'],
  ['rating', 'Rating icon (commands layout)'],
]
const IMAGE_FIELDS = [['banner', 'Banner (welcome, menu)'], ['start', 'Welcome on /start (commands layout)'], ['menu', 'Menu board (commands layout)'], ['wallet', 'Wallet'], ['orders', 'Orders']]
const ACTIONS = [['menu', 'Shelves menu'], ['deals', 'Fire Sale'], ['wallet', 'Wallet'], ['orders', 'My orders'], ['site', 'Website'], ['page', 'Page…'], ['cat', 'Shelf…'], ['url', 'Link…']]

// Path-based edit of the partial look: '' removes the key (back to the default)
function setIn(obj, path, value) {
  const [k, ...rest] = path
  const next = { ...(obj || {}) }
  if (rest.length) next[k] = setIn(next[k], rest, value)
  else if (value === '' || value === undefined) delete next[k]
  else next[k] = value
  return next
}

function StyleEditor({ initial, defaults, shelves: allShelves, busy, act, onClose }) {
  const [name, setName] = useState(initial.name)
  const [look, setLook] = useState(initial.look)
  const set = (path, value) => setLook(l => setIn(l, path, value))
  const get = path => path.reduce((o, k) => o?.[k], look) ?? ''
  const def = path => path.reduce((o, k) => o?.[k], defaults) ?? ''
  const pages = look.pages || []
  // Only the shelves of the catalog this style sells, and the catalogs that exist
  const shelves = allShelves.filter(c => (c.source || null) === (look.catalog || null))
  const sources = [...new Set(allShelves.map(c => c.source).filter(Boolean))]
  const links = look.siteLinks ?? (defaults.siteLinks !== false)
  // A copied bot can have hundreds of pages: search them and show them by slices
  const [pageFilter, setPageFilter] = useState('')
  const [pageLimit, setPageLimit] = useState(20)
  const q = pageFilter.trim().toLowerCase()
  const shownPages = pages.map((p, i) => ({ p, i })).filter(({ p }) => !q || `${p.key} ${p.title || ''} ${p.html || ''}`.toLowerCase().includes(q))
  const setPages = next => set(['pages'], next.length ? next : undefined)

  const save = () => act('save', async () => {
    const body = JSON.stringify({ name, look })
    const r = initial.id
      ? await adminFetch(`/admin/telegram/styles/${initial.id}`, { method: 'PUT', body })
      : await adminFetch('/admin/telegram/styles', { method: 'POST', body })
    onClose()
    return r
  }, r => `Style saved.${r.reapplied ? ` Applied again to ${r.reapplied} bot${r.reapplied > 1 ? 's' : ''}.` : ''}${r.failed?.length ? ` Not applied: ${r.failed.join('; ')}` : ''}`)

  const field = (path, label, { area = false } = {}) => (
    <div className="admin-form-group" key={path.join('.')}>
      <label className="admin-label">{label}</label>
      {area
        ? <textarea className="admin-input" rows={4} value={get(path)} placeholder={def(path)} onChange={e => set(path, e.target.value)} />
        : <input className="admin-input" value={get(path)} placeholder={def(path) || ''} onChange={e => set(path, e.target.value)} />}
    </div>
  )

  return (
    <div className="admin-card">
      <h2 className="admin-card-title">{initial.id ? `Style: ${initial.name}` : 'New style'}</h2>
      <p style={{ ...muted, marginTop: 0 }}>Grey text is the shop's default, used when a field is empty. Texts take Telegram formatting: &lt;b&gt;bold&lt;/b&gt;, &lt;i&gt;italic&lt;/i&gt;, &lt;a href="…"&gt;link&lt;/a&gt;.</p>
      <div className="admin-form-group">
        <label className="admin-label">Style name</label>
        <input className="admin-input" value={name} onChange={e => setName(e.target.value)} />
      </div>

      <h3 className="admin-card-title" style={{ fontSize: '0.95rem', marginTop: 20 }}>Profile in Telegram</h3>
      {field(['profile', 'name'], 'Bot name')}
      {field(['profile', 'shortDescription'], 'Short description (profile, shares)')}
      {field(['profile', 'description'], 'Description (empty chat, before Start)', { area: true })}
      {field(['profile', 'menuButton'], 'Menu button')}
      {field(['profile', 'photo'], 'Profile photo (JPG url)')}
      {get(['profile', 'photo']) && <img src={get(['profile', 'photo'])} alt="" width="72" height="72" style={{ borderRadius: '50%', objectFit: 'cover', marginBottom: 12 }} />}
      <div className="admin-form-group">
        <label className="admin-label">Commands (one per line: command - description)</label>
        <textarea className="admin-input" rows={5}
          value={(look.profile?.commands || []).map(c => `${c.command} - ${c.description}`).join('\n')}
          placeholder={(defaults.profile.commands || []).map(c => `${c.command} - ${c.description}`).join('\n')}
          onChange={e => {
            const cmds = e.target.value.split('\n').map(l => l.match(/^\/?([a-z0-9_]{1,32})\s*-\s*(.+)$/i)).filter(Boolean).map(m => ({ command: m[1].toLowerCase(), description: m[2].trim().slice(0, 256) }))
            set(['profile', 'commands'], cmds.length ? cmds : undefined)
          }} />
      </div>

      <h3 className="admin-card-title" style={{ fontSize: '0.95rem', marginTop: 20 }}>Catalog and layout</h3>
      <div className="admin-form-group">
        <label className="admin-label">Products this bot sells</label>
        <select className="admin-input" value={look.catalog || ''} onChange={e => set(['catalog'], e.target.value || undefined)}>
          <option value="">The shop's own products</option>
          {sources.map(src => <option key={src} value={src}>Imported catalog "{src}"</option>)}
        </select>
      </div>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <input type="checkbox" checked={links} onChange={e => set(['siteLinks'], e.target.checked)} />
        <span>Links to the shop's website in this bot (buttons, menu button, wording)</span>
      </label>
      <div className="admin-form-group">
        <label className="admin-label">How customers move around</label>
        <select className="admin-input" value={look.layout || 'buttons'} onChange={e => set(['layout'], e.target.value === 'buttons' ? undefined : e.target.value)}>
          <option value="buttons">Buttons: shelves as buttons, screens edited in place</option>
          <option value="commands">Commands: a menu board, shelves and products opened with /commands</option>
        </select>
      </div>
      {look.layout === 'commands' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0 12px' }}>
            {field(['prefix'], 'Menu command (e.g. v_shop: /v_shop, /v_shop_flower)')}
            {field(['customOrderCommand'], 'Custom order command')}
          </div>
          {LAYOUT_LINE_FIELDS.map(([k, l]) => field(['texts', k], l))}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0 12px' }}>
            {field(['shippingFee'], 'Shipping fee in $ (empty = the shop’s shipping settings)')}
            {field(['pgpPage'], 'Page with your PGP public key (its key)')}
            <div className="admin-form-group">
              <label className="admin-label">Encrypted address</label>
              <select className="admin-input" value={get(['pgpAddress']) || 'optional'} onChange={e => set(['pgpAddress'], e.target.value)}>
                <option value="optional">PGP or plain text</option>
                <option value="required">PGP only</option>
              </select>
            </div>
          </div>
          <div style={muted}>Addresses are asked encrypted only once the page above holds a PGP public key (-----BEGIN PGP PUBLIC KEY BLOCK-----): put your own key there, never another shop's.</div>
          <details style={{ margin: '10px 0' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Checkout texts</summary>
            {CHECKOUT_TEXT_FIELDS.map(([k, l]) => field(['texts', k], l, { area: true }))}
          </details>
          {LAYOUT_TEXT_FIELDS.map(([k, l]) => field(['texts', k], l, { area: true }))}
          <div style={muted}>The menu board shows "Menu intro (customer)" first, then the custom order, previous orders, every shelf and every page that has a menu label.</div>
        </>
      )}

      <h3 className="admin-card-title" style={{ fontSize: '0.95rem', marginTop: 20 }}>Screens</h3>
      {TEXT_FIELDS.map(([k, l]) => field(['texts', k], l, { area: true }))}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0 12px' }}>
        {field(['rule'], 'Divider line')}
        <div className="admin-form-group">
          <label className="admin-label">Titles</label>
          <select className="admin-input" value={look.upperTitles === false ? 'as' : 'upper'} onChange={e => set(['upperTitles'], e.target.value === 'as' ? false : undefined)}>
            <option value="upper">IN CAPITALS</option>
            <option value="as">As written</option>
          </select>
        </div>
      </div>

      <h3 className="admin-card-title" style={{ fontSize: '0.95rem', marginTop: 20 }}>Buttons</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0 12px' }}>
        {LABEL_FIELDS.map(([k, l]) => field(['labels', k], l))}
      </div>

      <h3 className="admin-card-title" style={{ fontSize: '0.95rem', marginTop: 20 }}>Images (url)</h3>
      {IMAGE_FIELDS.map(([k, l]) => field(['images', k], l))}
      {shelves.map(c => field(['images', 'shelves', c.slug], `Shelf: ${c.name}`))}

      <h3 className="admin-card-title" style={{ fontSize: '0.95rem', marginTop: 20 }}>Pages</h3>
      <p style={{ ...muted, marginTop: 0 }}>Your own screens, each with its text, image and buttons. A button opens another page or one of the shop's screens. Pick a home page to have /start open it instead of the shelves.</p>
      <div className="admin-form-group">
        <label className="admin-label">/start opens</label>
        <select className="admin-input" value={look.home || ''} onChange={e => set(['home'], e.target.value)}>
          <option value="">The shelves menu</option>
          {pages.map(p => <option key={p.key} value={p.key}>Page {p.key}</option>)}
        </select>
      </div>
      {pages.length > 8 && (
        <input className="admin-input" style={{ marginBottom: 10 }} type="search" placeholder={`Search the ${pages.length} pages (command or text)`} value={pageFilter} onChange={e => { setPageFilter(e.target.value); setPageLimit(20) }} />
      )}
      {shownPages.slice(0, pageLimit).map(({ p, i }) => (
        <PageEditor key={i} page={p} pages={pages} shelves={shelves}
          onChange={np => setPages(pages.map((x, j) => j === i ? np : x))}
          onRemove={() => { setPages(pages.filter((_, j) => j !== i)); if (look.home === p.key) set(['home'], '') }} />
      ))}
      {q && shownPages.length === 0 && <p className="admin-text-muted">No page matches.</p>}
      {shownPages.length > pageLimit && (
        <button type="button" className="admin-btn admin-btn-secondary" style={{ marginBottom: 10 }} onClick={() => setPageLimit(n => n + 40)}>
          Show {Math.min(40, shownPages.length - pageLimit)} more ({shownPages.length - pageLimit} left)
        </button>
      )}
      <button type="button" className="admin-btn admin-btn-secondary" onClick={() => {
        let n = pages.length + 1
        while (pages.some(p => p.key === `p${n}`)) n++
        setPages([...pages, { key: `p${n}`, html: '', image: '', buttons: [[{ text: '🛒 Shop', action: 'menu' }]] }])
      }}>+ Add a page</button>

      <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
        <button type="button" className="admin-btn admin-btn-primary" disabled={!name.trim() || !!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save style'}</button>
        <button type="button" className="admin-btn admin-btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

// One custom page, folded to a one-line summary until opened (a copied bot can have
// hundreds); buttons are edited flat (each with its row number)
function PageEditor({ page, pages, shelves, onChange, onRemove }) {
  const [open, setOpen] = useState(!page.html)
  const flat = (page.buttons || []).flatMap((row, r) => row.map(b => ({ ...b, row: r + 1 })))
  const setFlat = list => {
    const rows = []
    for (const b of list) {
      const r = Math.max(1, Math.min(20, Number(b.row) || 1)) - 1
      ;(rows[r] ||= []).push({ text: b.text, action: b.action })
    }
    onChange({ ...page, buttons: rows.filter(Boolean) })
  }
  const kindOf = a => a.startsWith('page:') ? 'page' : a.startsWith('cat:') ? 'cat' : a.startsWith('url:') ? 'url' : a
  const setBtn = (i, patch) => setFlat(flat.map((b, j) => j === i ? { ...b, ...patch } : b))
  const summary = String(page.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

  return (
    <div className="admin-page-edit">
      <div className="admin-page-edit-head">
        <button type="button" className="admin-page-edit-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <b>/{page.key}</b>
          <span className="admin-page-edit-sum">{summary || 'Empty page'}</span>
          <span className="admin-text-muted admin-page-edit-count">{flat.length} button{flat.length === 1 ? '' : 's'}</span>
        </button>
        <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={onRemove}>Remove</button>
      </div>
      {open && (
        <div className="admin-page-edit-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0 12px' }}>
            <div className="admin-form-group">
              <label className="admin-label">Command (also opens it: /{page.key})</label>
              <input className="admin-input" value={page.key} onChange={e => onChange({ ...page, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32) })} />
            </div>
            <div className="admin-form-group">
              <label className="admin-label">Menu label (commands layout; empty = not listed)</label>
              <input className="admin-input" value={page.title || ''} onChange={e => onChange({ ...page, title: e.target.value })} />
            </div>
          </div>
          <div className="admin-form-group">
            <label className="admin-label">Text</label>
            <textarea className="admin-input" rows={5} value={page.html || ''} onChange={e => onChange({ ...page, html: e.target.value })} />
          </div>
          <div className="admin-form-group">
            <label className="admin-label">Image (url, shown above the text)</label>
            <input className="admin-input" value={page.image || ''} onChange={e => onChange({ ...page, image: e.target.value })} />
          </div>
          <label className="admin-label">Buttons</label>
          {flat.map((b, i) => {
            const kind = kindOf(b.action || 'menu')
            const arg = kind === 'page' || kind === 'cat' || kind === 'url' ? b.action.slice(b.action.indexOf(':') + 1) : ''
            return (
              <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                <input className="admin-input" style={{ flex: '2 1 160px' }} placeholder="Label" value={b.text} onChange={e => setBtn(i, { text: e.target.value })} />
                <select className="admin-input" style={{ flex: '1 1 120px' }} value={kind} onChange={e => setBtn(i, { action: ['page', 'cat', 'url'].includes(e.target.value) ? `${e.target.value}:` : e.target.value })}>
                  {ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {kind === 'page' && (
                  <select className="admin-input" style={{ flex: '1 1 100px' }} value={arg} onChange={e => setBtn(i, { action: `page:${e.target.value}` })}>
                    <option value="">Choose</option>
                    {pages.filter(p => p.key !== page.key).map(p => <option key={p.key} value={p.key}>{p.key}</option>)}
                  </select>
                )}
                {kind === 'cat' && (
                  <select className="admin-input" style={{ flex: '1 1 100px' }} value={arg} onChange={e => setBtn(i, { action: `cat:${e.target.value}` })}>
                    <option value="">Choose</option>
                    {shelves.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                  </select>
                )}
                {kind === 'url' && <input className="admin-input" style={{ flex: '2 1 160px' }} placeholder="https://…" value={arg} onChange={e => setBtn(i, { action: `url:${e.target.value}` })} />}
                <input className="admin-input" style={{ width: 64 }} type="number" min="1" title="Row" value={b.row} onChange={e => setBtn(i, { row: e.target.value })} />
                <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => setFlat(flat.filter((_, j) => j !== i))}>✕</button>
              </div>
            )
          })}
          <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => setFlat([...flat, { text: '', action: 'menu', row: (page.buttons?.length || 0) + 1 }])}>+ Button</button>
        </div>
      )}
    </div>
  )
}
