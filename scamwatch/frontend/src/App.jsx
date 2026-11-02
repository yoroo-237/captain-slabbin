import { useEffect, useRef, useState } from 'react'
import { messages, TYPE_KEYS } from './i18n.js'
import { api, readAsDataUrl, MAX_FILES, MAX_FILE_BYTES, IMAGE_TYPES } from './api.js'
import Admin from './Admin.jsx'

const initialLang = () => {
  try {
    const saved = localStorage.getItem('lang')
    if (saved === 'fr' || saved === 'en') return saved
  } catch {}
  return navigator.language?.startsWith('fr') ? 'fr' : 'en'
}

const isAdminRoute = () => window.location.hash === '#admin'

export default function App() {
  const [lang, setLang] = useState(initialLang)
  const t = messages[lang]
  const [adminRoute, setAdminRoute] = useState(isAdminRoute)

  const [target, setTarget] = useState('')
  const [description, setDescription] = useState('')
  const [proofUrl, setProofUrl] = useState('')
  const [files, setFiles] = useState([])
  const [fileInputKey, setFileInputKey] = useState(0)
  const [type, setType] = useState('') // '' = automatic
  const [detected, setDetected] = useState(null)
  const [status, setStatus] = useState({ state: 'idle', message: '' })

  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState([])
  const [stats, setStats] = useState({ targets: 0, reports: 0 })

  const changeLang = (l) => {
    setLang(l)
    document.documentElement.lang = l
    try { localStorage.setItem('lang', l) } catch {}
  }

  useEffect(() => {
    const onHash = () => setAdminRoute(isAdminRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const loadTargets = (q = '') =>
    api(`/api/targets?q=${encodeURIComponent(q)}`).then(setTargets).catch(() => {})
  const loadStats = () => api('/api/stats').then(setStats).catch(() => {})

  useEffect(() => { loadTargets(); loadStats() }, [])

  // Debounced search
  useEffect(() => {
    const id = setTimeout(() => loadTargets(query), 250)
    return () => clearTimeout(id)
  }, [query])

  // Debounced live detection
  const seq = useRef(0)
  useEffect(() => {
    if (!description.trim() && !proofUrl.trim()) return setDetected(null)
    const mine = ++seq.current
    const id = setTimeout(async () => {
      try {
        const r = await api('/api/detect', { method: 'POST', body: JSON.stringify({ description, proofUrl }) })
        if (mine === seq.current) setDetected(r)
      } catch {}
    }, 300)
    return () => clearTimeout(id)
  }, [description, proofUrl])

  const pickFiles = (e) => {
    const picked = [...e.target.files]
    const error =
      picked.length > MAX_FILES ? 'too_many_files'
      : picked.some((f) => !IMAGE_TYPES.includes(f.type)) ? 'invalid_file'
      : picked.some((f) => f.size > MAX_FILE_BYTES) ? 'file_too_large'
      : null
    if (error) {
      setFiles([]); setFileInputKey((k) => k + 1)
      return setStatus({ state: 'error', message: t.errors[error] })
    }
    setFiles(picked)
    setStatus({ state: 'idle', message: '' })
  }

  const submit = async (e) => {
    e.preventDefault()
    setStatus({ state: 'sending', message: '' })
    try {
      const encoded = await Promise.all(files.map(readAsDataUrl))
      await api('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          target, description, proofUrl: proofUrl || undefined, type: type || undefined, lang,
          files: encoded.length ? encoded : undefined,
        }),
      })
      setStatus({ state: 'ok', message: t.thanks })
      setTarget(''); setDescription(''); setProofUrl(''); setType(''); setDetected(null)
      setFiles([]); setFileInputKey((k) => k + 1)
      loadTargets(query); loadStats()
    } catch (err) {
      setStatus({ state: 'error', message: t.errors[err.code] || t.error })
    }
  }

  return (
    <>
    <header className="topbar">
      <div className="topbar-inner">
        <div>
          <h1><a href="#" className="home">{t.title}</a></h1>
          <p className="tagline">{t.tagline}</p>
        </div>
        <div className="lang">
          {['en', 'fr'].map((l) => (
            <button key={l} className={l === lang ? 'on' : ''} onClick={() => changeLang(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
      </div>
    </header>

    <div className="page">

      {adminRoute ? <Admin t={t} lang={lang} /> : (
        <main>
          <section className="card">
            <h2>{t.reportTitle}</h2>
            <form onSubmit={submit}>
              <label>
                {t.target}
                <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={t.targetHint} required />
              </label>

              <label>
                {t.description}
                <textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t.descriptionHint}
                />
              </label>

              <label>
                {t.proof}
                <input value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="https://" />
              </label>

              <label>
                {t.screenshots}
                <input key={fileInputKey} type="file" accept={IMAGE_TYPES.join(',')} multiple onChange={pickFiles} />
                <span className="hint">{files.length ? t.filesPicked(files.length) : t.screenshotsHint}</span>
              </label>

              <label>
                {t.type}
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">
                    {t.auto}{detected ? ` (${t.detected}: ${t.types[detected.type]})` : ''}
                  </option>
                  {TYPE_KEYS.map((k) => <option key={k} value={k}>{t.types[k]}</option>)}
                </select>
              </label>

              <p className="hint">{t.repeatRule}</p>

              <button className="primary" disabled={status.state === 'sending'}>
                {status.state === 'sending' ? t.sending : t.submit}
              </button>
              {status.message && <p className={`msg ${status.state}`}>{status.message}</p>}
            </form>
          </section>

          <section className="card">
            <h2>{t.reported}</h2>
            <p className="muted">{t.stats(stats.targets, stats.reports)}</p>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              aria-label={t.search}
            />
            <ul className="list">
              {targets.length === 0 && <li className="muted">{t.none}</li>}
              {targets.map((x) => (
                <li key={x.id}>
                  <span className="name">
                    {x.username ? `@${x.username}` : `ID ${x.tgId}`}
                    {x.status === 'confirmed' && <span className="badge confirmed">{t.statuses.confirmed}</span>}
                  </span>
                  <span className="count">{x.reportCount} {t.reports}</span>
                </li>
              ))}
            </ul>
          </section>
        </main>
      )}
    </div>
    </>
  )
}
