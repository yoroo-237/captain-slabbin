import AdminSettings from '../pages/admin/AdminSettings.jsx'

// The platform's own withdrawals: payout addresses, sweeps and their history
// (the Crypto tab), and the deposit rules. Nothing here is shared with the site.
export default function Withdrawals() {
  return <AdminSettings tabs={['Crypto', 'Deposits']} title="Retraits" subtitle="Adresses de retrait de la plateforme des bots, balayage des dépôts et historique" />
}
