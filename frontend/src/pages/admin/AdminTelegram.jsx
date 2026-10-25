import { useApp } from '../../context/AppContext.jsx'
import { isAdmin } from '../../utils/roles.js'
import AdminTelegramBot from './AdminTelegramBot.jsx'

// Telegram bot on its own page, also reachable from Settings → Telegram bot
export default function AdminTelegram() {
  const { user } = useApp()
  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Telegram</h1>
          <p className="admin-page-subtitle">Your shop on Telegram: customers browse, buy and pay in the bot; orders and messages reach your chat</p>
        </div>
      </div>
      <div style={{ maxWidth: 760 }}>
        <AdminTelegramBot canEdit={isAdmin(user)} />
      </div>
    </div>
  )
}
