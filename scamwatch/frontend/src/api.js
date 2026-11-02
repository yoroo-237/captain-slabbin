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
export const MAX_BATCH = 3

// Must match backend/src/proof.js
export const MAX_FILES = 3
export const MAX_FILE_BYTES = 3 * 1024 * 1024
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

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
