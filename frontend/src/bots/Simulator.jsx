import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { L } from './i18n.js'

// What a capture already holds, played like the bot in Telegram: its screens as
// messages (text, picture, buttons), its buttons leading to the screens they
// opened during the capture, commands and keyboard texts typed in the box.
// Nothing is sent to Telegram: it is the capture, replayed in the page.

// Telegram's HTML, kept to what Telegram itself shows
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'INS', 'S', 'STRIKE', 'DEL', 'CODE', 'PRE', 'A', 'BR', 'BLOCKQUOTE', 'SPAN', 'TG-SPOILER'])
function safeHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${String(html || '').replace(/\n/g, '<br>')}</div>`, 'text/html')
  const walk = node => {
    for (const el of [...node.children]) {
      walk(el)
      if (!ALLOWED.has(el.tagName)) { el.replaceWith(...el.childNodes); continue }
      for (const a of [...el.attributes]) if (!(el.tagName === 'A' && a.name === 'href' && /^https?:\/\//.test(a.value))) el.removeAttribute(a.name)
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noreferrer') }
    }
  }
  walk(doc.body.firstChild)
  return doc.body.firstChild.innerHTML
}

const media = (files, bot, name) => (name ? `${files}/${bot}/media/${encodeURIComponent(name)}` : null)
const IMAGE = /\.(jpe?g|png|webp|gif)$/i
const isImage = name => !!name && (IMAGE.test(name) || !/\.[a-z0-9]{2,4}$/i.test(name))
// The kind of media a screen carries (captures before this version only knew the file)
const kindOf = s => s.media_type || (isImage(s.media) ? 'photo' : /\.(mp4|webm|mov)$/i.test(s.media) ? 'video' : /\.(ogg|oga|mp3|m4a)$/i.test(s.media) ? 'audio' : 'document')

// Every button Telegram allows (Bot API: InlineKeyboardButton, KeyboardButton)
const ICON = { web_app: '🌐 ', login_url: '🔐 ', copy: '📋 ', switch_inline: '🔎 ', request_contact: '📱 ', request_location: '📍 ',
  request_poll: '📊 ', request_users: '👤 ', request_chat: '👥 ', pay: '💳 ', game: '🎮 ', user_profile: '👤 ' }
const WHAT = {
  switch_inline: ['recherche en mode inline dans une conversation', 'inline search in a chat'],
  request_contact: ['le client partage son numéro de téléphone', 'the customer shares their phone number'],
  request_location: ['le client partage sa position', 'the customer shares their location'],
  request_poll: ['le client crée un sondage', 'the customer creates a poll'],
  request_users: ['le client choisit des contacts à partager', 'the customer picks contacts to share'],
  request_chat: ['le client choisit un groupe ou un canal à partager', 'the customer picks a group or channel to share'],
  pay: ['paiement d’une facture Telegram', 'payment of a Telegram invoice'],
  game: ['ouvre un jeu', 'opens a game'],
  user_profile: ['ouvre un profil Telegram', 'opens a Telegram profile'],
}
// Reply keyboard (under the box) or buttons under the message
const replyKeyboard = s => s?.markup?.type === 'keyboard' || (s?.buttons || []).some(r => r.some(b => b.kind === 'keyboard'))

export default function Simulator({ bot, files, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [chat, setChat] = useState([]) // { from: 'bot' | 'me' | 'note', screen?, text? }
  const [text, setText] = useState('')
  const box = useRef(null)

  useEffect(() => {
    setData(null); setError(''); setChat([])
    fetch(`${files}/${bot}/data.json`).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData).catch(() => setError(L('Capture illisible.', 'This capture cannot be read.')))
  }, [bot, files])

  const screens = useMemo(() => (data?.screens || []).slice().sort((a, b) => a.order - b.order), [data])
  // /start can send several messages: they all come first, the menu (most buttons) last
  const start = useMemo(() => screens.filter(s => (s.sources || []).includes('/start'))
    .sort((a, b) => a.order - b.order), [screens])
  const restart = () => setChat([{ from: 'me', text: '/start' }, ...start.map(screen => ({ from: 'bot', screen }))])
  useEffect(() => { if (data) restart() }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight }, [chat])

  // The screen a button or a typed text opened during the capture: the nearest later one
  const opened = (from, source) => {
    const later = screens.filter(s => s.order > (from?.order ?? 0) && (s.sources || []).includes(source))
    return later[0] || screens.find(s => (s.sources || []).includes(source)) || null
  }
  const reply = (screen, note) => setChat(c => [...c, screen ? { from: 'bot', screen } : { from: 'note', text: note }])
  const NOT_CAPTURED = L('Cet écran n’a pas été capturé (le bot ne l’a pas encore montré pendant l’exploration).', 'This screen was not captured (the bot did not show it during the exploration).')

  const press = (screen, b) => {
    if (b.disabled) return
    if (['url', 'web_app', 'login_url'].includes(b.kind) && b.url) { window.open(b.url, '_blank', 'noopener'); return }
    if (b.kind === 'copy') {
      navigator.clipboard?.writeText(b.copy || '').catch(() => {})
      return reply(null, L(`📋 Copié : ${b.copy}`, `📋 Copied: ${b.copy}`))
    }
    if (WHAT[b.kind]) return reply(null, `${ICON[b.kind] || ''}${b.text} : ${L(...WHAT[b.kind])}. ${L('Le bouton existe dans la capture ; la simulation ne peut pas le jouer.', 'The button is in the capture; the simulation cannot play it.')}`)
    if (b.kind === 'keyboard') { setChat(c => [...c, { from: 'me', text: b.text }]); return reply(opened(screen, b.text), NOT_CAPTURED) }
    reply(opened(screen, `[${b.text}]`), NOT_CAPTURED)
  }
  const label = b => <>{b.password ? '🔒 ' : ''}{ICON[b.kind] || ''}{b.text}{b.kind === 'url' && <span aria-hidden="true"> ↗</span>}</>
  const btnClass = b => [b.style ? `st-${b.style}` : '', b.disabled ? 'off' : ''].filter(Boolean).join(' ') || undefined
  const send = e => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    setText('')
    setChat(c => [...c, { from: 'me', text: t }])
    if (/^\/start\b/i.test(t)) return setChat(c => [...c, ...start.map(screen => ({ from: 'bot', screen }))])
    const cmd = t.startsWith('/') ? t.split(/\s+/)[0].toLowerCase() : null
    const found = screens.find(s => (s.sources || []).some(x => (cmd ? x.toLowerCase() === cmd : x === t)))
    reply(found, cmd ? L(`Commande ${cmd} non capturée.`, `Command ${cmd} not captured.`) : L('Ce texte n’ouvre aucun écran capturé.', 'This text opens no captured screen.'))
  }

  const profile = data?.profile || {}
  const name = profile.name || `@${bot}`
  const photo = profile.photo && media(files, bot, profile.photo)
  // The reply keyboard of the last bot message that has one stays under the box
  const keyboard = [...chat].reverse().find(m => m.from === 'bot' && replyKeyboard(m.screen))?.screen
  const placeholder = [...chat].reverse().find(m => m.from === 'bot' && m.screen.markup?.placeholder)?.screen.markup.placeholder

  return (
    <section className="panel sim" aria-label={L('Simulation du bot', 'Bot simulation')}>
      <div className="row-head">
        <h2><span className="idx">04</span>{L('Simulation', 'Simulation')} <span className="count">@{bot}</span></h2>
        <button className="btn sm" onClick={restart} disabled={!data}>{L('Recommencer', 'Restart')}</button>
        {onClose && <button className="btn sm" onClick={onClose}>{L('Fermer', 'Close')}</button>}
      </div>
      <p className="small muted" style={{ margin: '-8px 0 16px' }}>
        {L('Ce que la capture contient déjà, rejoué comme dans Telegram. Rien n’est envoyé : les boutons mènent aux écrans qu’ils ont ouverts pendant la capture.',
          'What the capture already holds, replayed like in Telegram. Nothing is sent: buttons lead to the screens they opened during the capture.')}
      </p>
      {error && <div className="alert" role="alert"><span>{error}</span></div>}
      <div className="tg">
        <div className="tg-head">
          <span className="tg-avatar">{photo ? <img src={photo} alt="" /> : name.replace(/^@/, '').slice(0, 1)}</span>
          <span className="tg-who"><b>{name}</b><small>{L('bot', 'bot')} · {screens.length} {L('écrans copiés', 'screens copied')}</small></span>
        </div>
        <div className="tg-chat" ref={box}>
          {!data && !error && <div className="tg-note">{L('Chargement…', 'Loading…')}</div>}
          {chat.map((m, i) => m.from === 'me' ? (
            <div key={i} className="tg-row me"><div className="tg-bubble me">{m.text}</div></div>
          ) : m.from === 'note' ? (
            <div key={i} className="tg-note">{m.text}</div>
          ) : (
            <div key={i} className="tg-row">
              <div className="tg-msg">
                <div className="tg-bubble">
                  {m.screen.media && (() => {
                    const src = media(files, bot, m.screen.media)
                    const k = kindOf(m.screen)
                    if (k === 'photo' || k === 'sticker') return <img className={k === 'sticker' ? 'tg-sticker' : 'tg-img'} src={src} alt="" loading="lazy" />
                    if (k === 'video' || k === 'animation' || k === 'video_note') return <video className="tg-img" src={src} muted={k !== 'video'} loop={k !== 'video'} autoPlay={k !== 'video'} controls={k === 'video'} playsInline />
                    if (k === 'voice' || k === 'audio') return <audio className="tg-audio" src={src} controls />
                    return <div className="tg-file">📎 {m.screen.media}</div>
                  })()}
                  {(m.screen.html || m.screen.raw) && <div className="tg-text" dangerouslySetInnerHTML={{ __html: safeHtml(m.screen.html || m.screen.raw) }} />}
                </div>
                {!replyKeyboard(m.screen) && (m.screen.buttons || []).length > 0 && (
                  <div className="tg-inline">
                    {m.screen.buttons.map((row, r) => row.length ? (
                      <div key={r} className="tg-inline-row">
                        {row.map((b, k) => <button key={k} type="button" className={btnClass(b)} disabled={b.disabled} title={b.url || b.copy || undefined} onClick={() => press(m.screen, b)}>{label(b)}</button>)}
                      </div>
                    ) : null)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <form className="tg-input" onSubmit={send}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder={placeholder || L('Écrire un message ou une /commande', 'Write a message or a /command')} disabled={!data} />
          <button className="btn primary sm" disabled={!data || !text.trim()}>{L('Envoyer', 'Send')}</button>
        </form>
        {keyboard && (
          <div className="tg-keyboard">
            {keyboard.buttons.map((row, r) => (
              <div key={r} className="tg-inline-row">
                {row.map((b, k) => <button key={k} type="button" className={btnClass(b)} disabled={b.disabled} onClick={() => press(keyboard, b)}>{label(b)}</button>)}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
