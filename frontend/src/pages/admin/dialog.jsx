import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'

// In-page replacements for the browser's confirm() and alert(), which show the
// site's address in a grey system box instead of the admin's own look

let root = null
function mount(node) {
  if (!root) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  }
  root.render(node)
}

function Dialog({ text, okLabel, cancelLabel, danger, onDone }) {
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onDone(false)
      if (e.key === 'Enter') onDone(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])
  return (
    <div className="admin-modal-overlay" onClick={e => e.target === e.currentTarget && onDone(false)}>
      <div className="admin-modal admin-dialog" role="alertdialog" aria-modal="true">
        <p className="admin-dialog-text">{text}</p>
        <div className="admin-modal-actions">
          {cancelLabel && <button type="button" className="admin-btn admin-btn-secondary" onClick={() => onDone(false)}>{cancelLabel}</button>}
          <button type="button" autoFocus className={'admin-btn ' + (danger ? 'admin-btn-danger' : 'admin-btn-primary')} onClick={() => onDone(true)}>{okLabel}</button>
        </div>
      </div>
    </div>
  )
}

function open(props) {
  return new Promise(resolve => {
    const onDone = answer => { mount(null); resolve(answer) }
    mount(<Dialog {...props} onDone={onDone} />)
  })
}

// Resolves to true when the admin confirms
export const askConfirm = (text, { okLabel = 'Confirm', danger = false } = {}) =>
  open({ text, okLabel, cancelLabel: 'Cancel', danger })

export const showMessage = text => open({ text, okLabel: 'OK' })
