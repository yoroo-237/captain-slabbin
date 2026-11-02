// Balances are crypto quantities (WalletHolding), as in the shops. Their USD value is
// amount × live price, and the tokens a user can spend come from that value:
// tokens = floor(USD balance / token price).

export const round8 = (n) => Math.round(n * 1e8) / 1e8
export const round2 = (n) => Math.round(n * 100) / 100
const ceil8 = (n) => Math.ceil(n * 1e8 - 1e-6) / 1e8

export const insufficient = () => Object.assign(new Error('insufficient_tokens'), { status: 402, code: 'insufficient_tokens' })

export async function getHoldings(client, userId) {
  const rows = await client.walletHolding.findMany({ where: { userId } })
  return rows.map((r) => ({ currency: r.currency, amount: parseFloat(r.amount) })).filter((r) => r.amount > 0)
}

// A holding without a price is listed with usd: null and left out of the total
export function valueHoldings(holdings, prices) {
  const lines = holdings.map((h) => ({
    currency: h.currency,
    amount: h.amount,
    price: prices[h.currency] ?? null,
    usd: prices[h.currency] ? round2(h.amount * prices[h.currency]) : null,
  }))
  const balance = round2(lines.reduce((s, l) => s + (l.usd || 0), 0))
  return { balance, holdings: lines, pricesComplete: lines.every((l) => l.price != null) }
}

export const tokensFor = (usd, tokenPriceUsd) => (tokenPriceUsd > 0 ? Math.floor(usd / tokenPriceUsd + 1e-9) : 0)

export function credit(tx, userId, currency, amount) {
  return tx.walletHolding.upsert({
    where: { userId_currency: { userId, currency } },
    update: { amount: { increment: round8(amount) } },
    create: { userId, currency, amount: round8(amount) },
  })
}

// Debits only if the holding still covers the amount at the time of the update,
// so two reports paid at the same moment can never take the balance below zero
export async function debit(tx, userId, currency, amount) {
  const { count } = await tx.walletHolding.updateMany({
    where: { userId, currency, amount: { gte: round8(amount) } },
    data: { amount: { decrement: round8(amount) } },
  })
  if (count === 0) throw insufficient()
}

// Which crypto pays a USD amount at the given prices: the largest holdings first.
// Returns [{ currency, amount, rate, usd }].
export function allocateUsd(holdings, prices, usdTotal) {
  const candidates = holdings
    .filter((h) => h.amount > 0 && prices[h.currency])
    .sort((a, b) => b.amount * prices[b.currency] - a.amount * prices[a.currency])

  const allocations = []
  let remaining = round2(usdTotal)
  for (const h of candidates) {
    if (remaining <= 0) break
    const rate = prices[h.currency]
    const holdingUsd = h.amount * rate
    if (holdingUsd + 0.005 >= remaining) {
      // Crypto rounded up so the platform is never short, capped at the holding
      const amount = Math.min(h.amount, ceil8(remaining / rate))
      allocations.push({ currency: h.currency, amount, rate, usd: remaining })
      remaining = 0
    } else {
      const usd = round2(holdingUsd)
      allocations.push({ currency: h.currency, amount: h.amount, rate, usd })
      remaining = round2(remaining - usd)
    }
  }
  if (remaining > 0) throw insufficient()
  return allocations
}
