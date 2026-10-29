import { useApp } from '../../context/AppContext.jsx'
import { isAdmin } from '../../utils/roles.js'
import AdminTelegramBot from './AdminTelegramBot.jsx'

// Telegram bots on their own page (Admin → Telegram bots)
export default function AdminTelegram() {
  const { user } = useApp()
  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Telegram</h1>
          <p className="admin-page-subtitle">Your shop on Telegram: several bots, each with its own style; customers browse, buy and pay in them, and orders and messages reach your chat</p>
        </div>
      </div>
      <div style={{ maxWidth: 860 }}>
        <AdminTelegramBot canEdit={isAdmin(user)} />
      </div>
    </div>
  )
}
