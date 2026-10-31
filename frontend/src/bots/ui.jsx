import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// In-page notifications and confirmations of the bots dashboard (instead of the
// browser's own alert / confirm boxes)
const Ui = createContext(null)
export const useUi = () => useContext(Ui)

export function Modal({ title, children, onClose, wide }) {
  const box = useRef(null)
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    box.current?.querySelector('input, select, textarea, button.primary')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="bp-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`panel bp-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <div className="row-head">
          <h2>{title}</h2>
          <button type="button" className="btn sm" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [ask, setAsk] = useState(null) // { text, ok, danger, resolve }
  const seq = useRef(0)

  // kind: 'ok' | 'err' | 'info'
  const notify = useCallback((text, kind = 'info', ms = 6000) => {
    const id = ++seq.current
    setToasts(t => [...t.slice(-3), { id, text, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ms)
  }, [])
  const confirm = useCallback((text, { ok = 'Confirmer', danger = false } = {}) =>
    new Promise(resolve => setAsk({ text, ok, danger, resolve })), [])
  const answer = v => { ask?.resolve(v); setAsk(null) }

  return (
    <Ui.Provider value={{ notify, confirm }}>
      {children}
      {ask && (
        <Modal title="Confirmation" onClose={() => answer(false)}>
          <p style={{ margin: '0 0 18px' }}>{ask.text}</p>
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => answer(false)}>Annuler</button>
            <button type="button" className={`btn ${ask.danger ? 'danger' : 'primary'}`} onClick={() => answer(true)}>{ask.ok}</button>
          </div>
        </Modal>
      )}
      <div className="bp-toasts" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`bp-toast ${t.kind}`}>
            <span>{t.text}</span>
            <button type="button" aria-label="Fermer" onClick={() => setToasts(x => x.filter(y => y.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </Ui.Provider>
  )
}
