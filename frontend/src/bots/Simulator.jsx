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
  // { id, from: 'bot' | 'me' | 'note', screen?, text?, time }
  const [chat, setChat] = useState([])
  const [started, setStarted] = useState(false)
  const [text, setText] = useState('')
  const [menu, setMenu] = useState(false)
  const [toast, setToast] = useState(null)
  const box = useRef(null)
  const seq = useRef(0)
  const clock = useRef(new Date(2026, 0, 1, 9, 41))

  useEffect(() => {
    setData(null); setError(''); setChat([]); setStarted(false)
    fetch(`${files}/${bot}/data.json`).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData).catch(() => setError(L('Capture illisible.', 'This capture cannot be read.')))
  }, [bot, files])

  const screens = useMemo(() => (data?.screens || []).slice().sort((a, b) => a.order - b.order), [data])
  const byKey = useMemo(() => new Map(screens.map(s => [s.key, s])), [screens])
  const steps = data?.steps || []
  const start = useMemo(() => screens.filter(s => (s.sources || []).includes('/start')), [screens])

  // Each message gets a time a little after the last, like a real chat
  const now = () => { clock.current = new Date(clock.current.getTime() + 37000); return clock.current.toTimeString().slice(0, 5) }
  const msg = m => ({ id: ++seq.current, time: now(), ...m })
  const say = (...items) => setChat(c => [...c, ...items.map(msg)])
  const pressStart = () => { setStarted(true); setChat([msg({ from: 'me', text: '/start' }), ...start.map(screen => msg({ from: 'bot', screen }))]) }
  const restart = () => { setChat([]); setStarted(false); setToast(null) }

  useLayoutEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight }, [chat, started])
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t) }, [toast])

  // What the bot did after an action during the capture: the step that played it
  const stepOf = (action, from) => {
    const all = steps.filter(st => st.action === action && (st.screens || []).length)
    return all.find(st => st.screens.some(k => (byKey.get(k)?.order ?? 0) > (from?.order ?? 0))) || all[0] || null
  }
  const NOT_CAPTURED = L('Cet écran n’a pas été capturé (le bot ne l’a pas encore montré pendant l’exploration).', 'This screen was not captured (the bot did not show it during the exploration).')

  // A button under a message: Telegram edits that message in place (when the capture
  // says so, or for older captures that do not say), and may also send new messages
  const pressInline = (message, b) => {
    if (b.disabled) return
    if (['url', 'web_app', 'login_url'].includes(b.kind) && b.url) { window.open(b.url, '_blank', 'noopener'); return }
    if (b.kind === 'copy') { navigator.clipboard?.writeText(b.copy || '').catch(() => {}); setToast(L('Copié dans le presse-papiers', 'Copied to clipboard')); return }
    if (WHAT[b.kind]) { setToast(`${ICON[b.kind] || ''}${L(...WHAT[b.kind])}`); return }
    const step = stepOf(`[${b.text}]`, message.screen)
    if (step?.alert) setToast(step.alert)
    if (!step) { setToast(NOT_CAPTURED); return }
    const editedKey = step.edited ?? (step.screens.length === 1 ? step.screens[0] : null)
    const fresh = step.screens.filter(k => k !== editedKey).map(k => byKey.get(k)).filter(Boolean)
    setChat(c => [
      ...c.map(m => (m.id === message.id && editedKey && byKey.get(editedKey) ? { ...m, screen: byKey.get(editedKey), edited: true } : m)),
      ...fresh.map(screen => msg({ from: 'bot', screen })),
    ])
  }
  // Typed text, a command or a reply-keyboard button: a message, then the bot's answers
  const sendText = (t, from) => {
    if (/^\/start\b/i.test(t)) { say({ from: 'me', text: t }, ...start.map(screen => ({ from: 'bot', screen }))); return }
    const cmd = t.startsWith('/') ? t.split(/\s+/)[0].toLowerCase() : null
    const step = stepOf(cmd || t, from)
    const answers = step ? step.screens.map(k => byKey.get(k)).filter(Boolean)
      : screens.filter(s => (s.sources || []).some(x => (cmd ? x.toLowerCase() === cmd : x === t))).slice(0, 1)
    say({ from: 'me', text: t }, ...(answers.length ? answers.map(screen => ({ from: 'bot', screen }))
      : [{ from: 'note', text: cmd ? L(`Commande ${cmd} non capturée.`, `Command ${cmd} not captured.`) : L('Ce texte n’ouvre aucun écran capturé.', 'This text opens no captured screen.') }]))
  }
  const pressKeyboard = (screen, b) => {
    if (WHAT[b.kind]) { setToast(`${ICON[b.kind] || ''}${L(...WHAT[b.kind])}`); return }
    sendText(b.text, screen)
  }
  const send = e => { e.preventDefault(); const t = text.trim(); if (!t) return; setText(''); setMenu(false); sendText(t) }

  const profile = data?.profile || {}
  const name = profile.name || `@${bot}`
  const photo = profile.photo && media(files, bot, profile.photo)
  const intro = profile.intro_photo && media(files, bot, profile.intro_photo)
  const commands = profile.commands?.length ? profile.commands
    : [...new Set(screens.flatMap(s => (s.sources || []).filter(x => /^\/[a-z]/i.test(x) && x !== '/start')))].slice(0, 12).map(c => ({ command: c.slice(1), description: '' }))
  const lastBot = [...chat].reverse().find(m => m.from === 'bot')
  const keyboard = [...chat].reverse().find(m => m.from === 'bot' && replyKeyboard(m.screen))?.screen
  const placeholder = lastBot?.screen.markup?.placeholder

  const label = b => <>{b.password ? '🔒 ' : ''}{ICON[b.kind] || ''}{b.text}{b.kind === 'url' && <span className="tg-corner" aria-hidden="true">↗</span>}</>
  const btnClass = b => [b.style ? `st-${b.style}` : '', b.disabled ? 'off' : ''].filter(Boolean).join(' ') || undefined
  const mediaOf = screen => {
    if (!screen.media) return null
    const src = media(files, bot, screen.media)
    const k = kindOf(screen)
    if (k === 'photo' || k === 'sticker') return <img className={k === 'sticker' ? 'tg-sticker' : 'tg-img'} src={src} alt="" loading="lazy" />
    if (k === 'video' || k === 'animation' || k === 'video_note') return <video className="tg-img" src={src} muted={k !== 'video'} loop={k !== 'video'} autoPlay={k !== 'video'} controls={k === 'video'} playsInline />
    if (k === 'voice' || k === 'audio') return <audio className="tg-audio" src={src} controls />
    return <div className="tg-file">📎 {screen.media}</div>
  }

  return (
    <section className="panel sim" aria-label={L('Simulation du bot', 'Bot simulation')}>
      <div className="row-head">
        <h2><span className="idx">04</span>{L('Simulation', 'Simulation')} <span className="count">@{bot}</span></h2>
        <button className="btn sm" onClick={restart} disabled={!data}>{L('Recommencer', 'Restart')}</button>
        {onClose && <button className="btn sm" onClick={onClose}>{L('Fermer', 'Close')}</button>}
      </div>
      <p className="small muted" style={{ margin: '-8px 0 16px' }}>
        {L('Ce que la capture contient déjà, rejoué comme dans l’app Telegram : un bouton sous un message modifie ce message, une commande envoie un nouveau message. Rien n’est envoyé à Telegram.',
          'What the capture already holds, replayed like the Telegram app: a button under a message edits that message, a command sends a new one. Nothing is sent to Telegram.')}
      </p>
      {error && <div className="alert" role="alert"><span>{error}</span></div>}
      <div className="tg">
        <div className="tg-head">
          <span className="tg-back" aria-hidden="true">‹</span>
          <span className="tg-avatar">{photo ? <img src={photo} alt="" /> : name.replace(/^@/, '').slice(0, 1)}</span>
          <span className="tg-who"><b>{name}</b><small>{L('bot', 'bot')}</small></span>
          <span className="tg-dots" aria-hidden="true">⋮</span>
        </div>
        <div className="tg-chat" ref={box}>
          {!data && !error && <div className="tg-note">{L('Chargement…', 'Loading…')}</div>}
          {data && !started && (
            <div className="tg-about">
              {intro && <img src={intro} alt="" />}
              <b>{L('Que peut faire ce bot ?', 'What can this bot do?')}</b>
              <div>{profile.description || profile.about || L('(description non capturée)', '(description not captured)')}</div>
            </div>
          )}
          {started && <div className="tg-date">{L('Aujourd’hui', 'Today')}</div>}
          {chat.map(m => m.from === 'me' ? (
            <div key={m.id} className="tg-row me"><div className="tg-bubble me">{m.text}<span className="tg-time">{m.time} ✓✓</span></div></div>
          ) : m.from === 'note' ? (
            <div key={m.id} className="tg-note">{m.text}</div>
          ) : (
            <div key={m.id} className="tg-row">
              <div className="tg-msg">
                <div className="tg-bubble">
                  {mediaOf(m.screen)}
                  {(m.screen.html || m.screen.raw) && <div className="tg-text" dangerouslySetInnerHTML={{ __html: safeHtml(m.screen.html || m.screen.raw) }} />}
                  <span className="tg-time">{m.edited ? L('modifié ', 'edited ') : ''}{m.time}</span>
                </div>
                {!replyKeyboard(m.screen) && (m.screen.buttons || []).length > 0 && (
                  <div className="tg-inline">
                    {m.screen.buttons.map((row, r) => row.length ? (
                      <div key={r} className="tg-inline-row">
                        {row.map((b, k) => <button key={k} type="button" className={btnClass(b)} disabled={b.disabled} title={b.url || b.copy || undefined} onClick={() => pressInline(m, b)}>{label(b)}</button>)}
                      </div>
                    ) : null)}
                  </div>
                )}
              </div>
            </div>
          ))}
          {toast && <div className="tg-toast" role="status">{toast}</div>}
        </div>
        {!started ? (
          <div className="tg-start"><button type="button" onClick={pressStart} disabled={!data}>{L('DÉMARRER', 'START')}</button></div>
        ) : (
          <>
            {menu && commands.length > 0 && (
              <div className="tg-commands">
                {commands.map(c => (
                  <button key={c.command} type="button" onClick={() => { setMenu(false); sendText(`/${c.command}`, lastBot?.screen) }}>
                    <b>/{c.command}</b>{c.description && c.description !== c.command && <span>{c.description}</span>}
                  </button>
                ))}
              </div>
            )}
            <form className="tg-input" onSubmit={send}>
              {commands.length > 0 && <button type="button" className="tg-menu" onClick={() => setMenu(v => !v)} aria-expanded={menu}>≡ Menu</button>}
              <input value={text} onChange={e => setText(e.target.value)} placeholder={placeholder || L('Message', 'Message')} />
              <button className="tg-send" disabled={!text.trim()} aria-label={L('Envoyer', 'Send')}>➤</button>
            </form>
            {keyboard && (
              <div className="tg-keyboard">
                {keyboard.buttons.map((row, r) => (
                  <div key={r} className="tg-inline-row">
                    {row.map((b, k) => <button key={k} type="button" className={btnClass(b)} disabled={b.disabled} onClick={() => pressKeyboard(keyboard, b)}>{label(b)}</button>)}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
