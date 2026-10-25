// VITE_API_URL is baked in at build time. When the build was made without it,
// a deployed site talks to api.<its own domain> instead of the visitor's localhost.
function apiBase() {
  const set = import.meta.env.VITE_API_URL
  if (set) return set.replace(/\/+$/, '')
  const { hostname, protocol } = window.location
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(hostname)) return 'http://localhost:4000'
  return `${protocol}//api.${hostname.replace(/^www\./, '')}`
}
export const BASE = apiBase()

export async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('token')
  const hadToken = !!token
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const gate = localStorage.getItem('cs_gate')
  if (gate) headers['X-Gate-Token'] = gate

  let res = await fetch(`${BASE}/api${endpoint}`, { ...options, headers })

  if (res.status === 401 && hadToken) {
    const refreshToken = localStorage.getItem('refreshToken')
    try {
      const rr = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      const rd = await rr.json()
      if (rd.success) {
        localStorage.setItem('token', rd.data.accessToken)
        headers['Authorization'] = `Bearer ${rd.data.accessToken}`
        res = await fetch(`${BASE}/api${endpoint}`, { ...options, headers })
      } else {
        localStorage.removeItem('token')
        localStorage.removeItem('refreshToken')
        window.location.href = '/login'
        return
      }
    } catch {
      localStorage.removeItem('token')
      localStorage.removeItem('refreshToken')
      window.location.href = '/login'
      return
    }
  }

  // The shop gate expired or the password changed: show the gate again
  if (res.status === 401 && !hadToken) {
    const body = await res.clone().json().catch(() => null)
    if (body?.gate) {
      localStorage.removeItem('cs_gate')
      window.dispatchEvent(new Event('cs:gate'))
    }
  }

  // A proxy error page or an unknown route answers with HTML, not JSON
  let json
  try {
    json = await res.json()
  } catch {
    throw new Error(`Server error (${res.status}). Please try again.`)
  }
  if (!json.success) throw new Error(json.error || 'Request failed')
  return json.data
}
