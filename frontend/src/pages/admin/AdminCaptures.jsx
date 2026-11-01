import { useEffect } from 'react'
import '../../bots/bots.css'
import { UiProvider } from '../../bots/ui.jsx'
import CapturePage from '../../bots/CapturePage.jsx'

// Admin → Captures: the bots dashboard's capture page (tg-explorer on the server),
// in its own look inside the site's admin. Needs a server that runs the captures
// (site.Dockerfile, CAPTURES=on).
const FONTS = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap'

export default function AdminCaptures() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS}"]`)) return
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONTS })
    document.head.appendChild(link)
  }, [])
  return (
    <div className="bp bp-embed">
      <UiProvider><CapturePage /></UiProvider>
    </div>
  )
}
