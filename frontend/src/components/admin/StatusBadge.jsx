// StatusBadge — colored inline label based on type + value
const ORDER_STATUS = {
  pending:    { bg: '#fff3cd', color: '#856404' },
  processing: { bg: '#cce5ff', color: '#004085' },
  shipped:    { bg: '#d4edda', color: '#155724' },
  delivered:  { bg: '#d4edda', color: '#155724' },
  cancelled:  { bg: '#f8d7da', color: '#721c24' },
  refunded:   { bg: '#e2e3f3', color: '#3d3d8f' },
  completed:  { bg: '#c3f6c8', color: '#0a5c1a' },
}
const DEPOSIT_STATUS = {
  awaiting:  { bg: '#fff3cd', color: '#856404' },
  confirmed: { bg: '#d4edda', color: '#155724' },
  expired:   { bg: '#e9ecef', color: '#6c757d' },
  partial:   { bg: '#ffe4b5', color: '#8b6914' },
  pending:   { bg: '#e2e3f3', color: '#3d3d8f' },
}
const TIER_STATUS = {
  basic:     { bg: '#e9ecef', color: '#495057' },
  preferred: { bg: '#f5e6d8', color: '#8b4513' },
  bronze:   { bg: '#f5e6d8', color: '#8b4513' },
  silver:   { bg: '#e9ecef', color: '#495057' },
  gold:     { bg: '#fff3cd', color: '#856404' },
  platinum: { bg: '#e2e3f3', color: '#3d3d8f' },
  diamond:  { bg: '#cce5ff', color: '#004085' },
}
const ROLE_STATUS = {
  user:       { bg: '#e9ecef', color: '#495057' },
  customer:   { bg: '#e9ecef', color: '#495057' },
  admin:      { bg: '#f8d7da', color: '#721c24' },
  moderator:  { bg: '#fff3cd', color: '#856404' },
  superadmin: { bg: '#e2e3f3', color: '#3d3d8f' },
}
const TXN_TYPES = {
  deposit:    { bg: '#d4edda', color: '#155724' },
  withdrawal: { bg: '#f8d7da', color: '#721c24' },
  purchase:   { bg: '#cce5ff', color: '#004085' },
  refund:     { bg: '#e2e3f3', color: '#3d3d8f' },
  adjustment: { bg: '#fff3cd', color: '#856404' },
  cashback:   { bg: '#c3f6c8', color: '#0a5c1a' },
  bonus:      { bg: '#ffe4b5', color: '#8b6914' },
}

const MAPS = {
  status:  ORDER_STATUS,
  deposit: DEPOSIT_STATUS,
  tier:    TIER_STATUS,
  role:    ROLE_STATUS,
  txn:     TXN_TYPES,
}

export default function StatusBadge({ type = 'status', value }) {
  if (!value) return null
  const map = MAPS[type] || {}
  const style = map[value?.toLowerCase()] || { bg: '#e9ecef', color: '#555' }
  return (
    <span
      className="admin-badge"
      style={{ background: style.bg, color: style.color }}
    >
      {value}
    </span>
  )
}
