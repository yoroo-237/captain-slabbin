import { useEffect, useState } from 'react'
import { session, safeLink } from './api.js'

// Screenshots need the session header, so they are fetched as blobs
export function Screenshot({ id, alt, path = `/api/admin/evidence/${id}` }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let url
    let alive = true
    fetch(path, { headers: { Authorization: `Bearer ${session.token}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (b && alive) { url = URL.createObjectURL(b); setSrc(url) } })
      .catch(() => {})
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [path])
  if (!src) return <span className="shot placeholder" />
  return <a href={src} target="_blank" rel="noreferrer"><img className="shot" src={src} alt={alt} /></a>
}

// Conversation with the bot (its answers, the buttons pressed) or channel / group history,
// with the images of the messages. limit: messages shown before "show all"
// (the start of a bot conversation, the latest messages of a channel).
export function Transcript({ t, capture, limit }) {
  const [all, setAll] = useState(false)
  const messages = capture.messages || []
  // Captures made before conversations were kept: their texts only
  if (!messages.length) {
    return capture.texts?.length > 0 && (
      <ul className="texts">{capture.texts.slice(0, 10).map((x, i) => <li key={i} className="desc">{x}</li>)}</ul>
    )
  }
  const mediaAt = Object.fromEntries((capture.media || []).map((m) => [m.position, m.id]))
  const cut = limit && !all && messages.length > limit
  const shown = !cut ? messages : capture.kind === 'bot' ? messages.slice(0, limit) : messages.slice(-limit)
  return (
    <div className="chat">
      {shown.map((m, i) => (
        <div key={i} className={`bubble ${m.from}${m.id === null && m.from === 'me' ? ' action' : ''}`}>
          {m.media.some((p) => mediaAt[p]) && (
            <div className="chat-media">
              {m.media.filter((p) => mediaAt[p]).map((p) => <Screenshot key={p} path={`/api/captures/media/${mediaAt[p]}`} alt="" />)}
            </div>
          )}
          {m.text && <p>{m.text}</p>}
          {m.buttons.length > 0 && (
            <div className="chat-buttons">
              {m.buttons.map((b, j) => (safeLink(b.url)
                ? <a key={j} className="chip" href={safeLink(b.url)} target="_blank" rel="noopener noreferrer nofollow">{b.text} ↗</a>
                : <span key={j} className="chip">{b.text}</span>))}
            </div>
          )}
          {(m.date || m.edited) && (
            <span className="chat-meta">{m.edited ? `${t.chat.edited} · ` : ''}{m.date && new Date(m.date).toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
          )}
        </div>
      ))}
      {limit && messages.length > limit && (
        <button type="button" className="link" onClick={() => setAll(!all)}>{all ? t.chat.less : t.chat.more(messages.length)}</button>
      )}
    </div>
  )
}

// Steps of a report, in order. With proof the server captures the account first,
// the report is paid and sent only once the proof is in.
export const STEPS = {
  proof: ['check', 'capture', 'type', 'send'],
  plain: ['send'],
}

// flow: { mode, at, state: 'run' | 'ok' | 'error', detail }
// Steps before `at` are done, `at` is running (or failed), the bar fills accordingly.
export function Progress({ t, flow }) {
  const steps = STEPS[flow.mode]
  const done = flow.state === 'ok' ? steps.length : flow.at
  // The running step counts for half, so the bar moves as soon as it starts
  const pct = Math.round(((done + (flow.state === 'run' ? 0.5 : 0)) / steps.length) * 100)
  return (
    <div className={`progress ${flow.state}`}>
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t.flow.label}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {steps.length > 1 && (
        <ol className="progress-steps">
          {steps.map((k, i) => (
            <li key={k} className={i < done ? 'done' : i === flow.at ? flow.state : ''}>{t.flow.steps[k]}</li>
          ))}
        </ol>
      )}
      {flow.detail && <p className="progress-detail">{flow.detail}</p>}
    </div>
  )
}

// The captured account, as it is sent with the report
export function ProofPreview({ t, lang, capture }) {
  return (
    <div className="proof">
      <span className="mono">{t.flow.proofTitle}</span>
      <div className="capture-body">
        {capture.hasPhoto && <Screenshot path={`/api/captures/${capture.id}/photo`} alt={capture.title} />}
        <div className="capture-text">
          <p className="name">
            {capture.title || '-'}
            {capture.kind && <span className="badge">{t.admin.kinds[capture.kind] || capture.kind}</span>}
            <span className="badge confirmed">{t.types[capture.detectedType] || capture.detectedType}</span>
          </p>
          {capture.about && <p className="desc">{capture.about}</p>}
          <Transcript t={t} capture={capture} limit={4} />
          <p className="hint">{t.flow.proofMeta(capture.textCount, new Date(capture.finishedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }))}</p>
        </div>
      </div>
    </div>
  )
}
