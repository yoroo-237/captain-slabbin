import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// After a new deploy, a page opened earlier still asks for the previous build's
// files (admin pages load on first visit). When one is gone, load the new build
// once instead of crashing; a second failure within 30 s is left to the error.
window.addEventListener('vite:preloadError', event => {
  let last = 0
  try { last = Number(sessionStorage.getItem('cs_reloaded_at')) || 0 } catch { /* storage blocked */ }
  if (Date.now() - last < 30000) return
  event.preventDefault()
  try { sessionStorage.setItem('cs_reloaded_at', String(Date.now())) } catch { /* storage blocked */ }
  window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
