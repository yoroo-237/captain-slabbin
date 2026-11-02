import axios from 'axios'

// Live USD price of a coin, same sources as the shops: CoinGecko, Kraken as fallback.

const COINGECKO_IDS = { BTC: 'bitcoin', LTC: 'litecoin', DOGE: 'dogecoin', ETH: 'ethereum', XMR: 'monero' }
const KRAKEN_PAIRS = { BTC: 'XBTUSD', LTC: 'LTCUSD', DOGE: 'XDGUSD', ETH: 'ETHUSD', XMR: 'XMRUSD' }

export const CURRENCIES = Object.keys(COINGECKO_IDS)

export async function getUsdPrice(currency) {
  const id = COINGECKO_IDS[currency]
  if (!id) return null

  try {
    const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`, { timeout: 6000 })
    const price = data?.[id]?.usd
    if (price > 0) return price
  } catch { /* fall through to backup */ }

  try {
    const { data } = await axios.get(`https://api.kraken.com/0/public/Ticker?pair=${KRAKEN_PAIRS[currency]}`, { timeout: 6000 })
    const ticker = Object.values(data?.result || {})[0]
    const price = parseFloat(ticker?.c?.[0])
    if (price > 0) return price
  } catch { /* both failed */ }

  return null
}

// Prices shared for 45 s; a stale price is still served if both APIs are down
const PRICE_TTL_MS = 45 * 1000
const priceCache = {}

export async function getCachedUsdPrice(currency) {
  const hit = priceCache[currency]
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.price
  const price = await getUsdPrice(currency)
  if (price) {
    priceCache[currency] = { price, at: Date.now() }
    return price
  }
  return hit?.price ?? null
}

export async function getCachedUsdPrices(currencies = CURRENCIES) {
  const list = [...new Set(currencies)]
  const prices = await Promise.all(list.map(getCachedUsdPrice))
  return Object.fromEntries(list.map((c, i) => [c, prices[i]]))
}
