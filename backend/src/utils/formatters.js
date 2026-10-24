export function formatTxnId(ts = Date.now()) {
  return `TXN-${ts}`;
}

export function formatOrderNumber(id) {
  return `ORD-${new Date().getFullYear()}-${String(id).padStart(5, '0')}`;
}

export function formatTicketId(id) {
  return `TKT-${String(id).padStart(5, '0')}`;
}

export function getUserTier(totalSpent) {
  const n = Number(totalSpent);
  if (n >= 5000) return 'platinum';
  if (n >= 2000) return 'gold';
  if (n >= 1000) return 'preferred';
  return 'basic';
}

export function getCashbackRate(tier) {
  const rates = { basic: 0.005, preferred: 0.01, gold: 0.013, platinum: 0.015 };
  return rates[tier] ?? 0.005;
}

export function appError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}
