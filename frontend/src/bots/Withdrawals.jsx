import AdminSettings from '../pages/admin/AdminSettings.jsx'
import { L } from './i18n.js'

// The platform's own withdrawals: payout addresses, sweeps and their history
// (the Crypto tab), and the deposit rules. Nothing here is shared with the site.
export default function Withdrawals() {
  return <AdminSettings tabs={['Crypto', 'Deposits']} title={L('Retraits', 'Withdrawals')} subtitle={L('Vos adresses de retrait, le retrait des dépôts et son historique', 'Your payout addresses, sweeping the deposits and its history')} />
}
