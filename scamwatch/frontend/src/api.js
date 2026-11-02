// Session token kept in this browser; every API call sends it
const TOKEN_KEY = 'scamwatch_token'
let token = (() => { try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' } })()

export const session = {
  get token() { return token },
  set(value) {
    token = value || ''
    try { value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY) } catch {}
  },
}

export const api = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Expired or revoked session: the app signs out
    if (data.error === 'login_required' && token) window.dispatchEvent(new Event('scamwatch:logout'))
    throw Object.assign(new Error(data.error || 'error'), { code: data.error, status: res.status })
  }
  return data
}

// Must match MAX_BATCH in backend/src/server.js
export const MAX_BATCH = 300
// Must match SPREAD_STEP and MAX_SPREAD in backend/src/server.js (minutes, 0 = all at once)
export const SPREAD_STEP = 15
export const MAX_SPREAD = 1440

// Must match backend/src/proof.js
export const MAX_FILES = 3
export const MAX_FILE_BYTES = 3 * 1024 * 1024
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
// Size limit per file by kind, and for all the files of one send
export const MAX_BYTES = { image: MAX_FILE_BYTES, audio: 10 * 1024 * 1024, video: 20 * 1024 * 1024 }
export const MAX_TOTAL_BYTES = 30 * 1024 * 1024
// Screenshots, videos and voice messages (Telegram voice notes are .ogg / .oga)
export const MEDIA_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/ogg,audio/mpeg,audio/mp4,.ogg,.oga,.opus'
// In a batch, at least a third of the reports (rounded up) carry a proof
export const minWithProof = (count) => (count > 1 ? Math.ceil(count / 3) : 0)

export const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

// Only http(s) links are rendered as links (no javascript: URLs)
export const safeLink = (url) => (/^https?:\/\//i.test(url || '') ? url : null)

export const CURRENCIES = ['BTC', 'LTC', 'DOGE', 'ETH', 'XMR']
export const fmtCrypto = (n) => Number(n || 0).toFixed(8).replace(/\.?0+$/, '') || '0'
export const fmtUsd = (n) => `$${Number(n || 0).toFixed(2)}`
