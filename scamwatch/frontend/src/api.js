export const api = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error })
  return data
}

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
