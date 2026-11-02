// Evidence attached to a report: a proof link (a forwarded message's t.me link, for
// example) and/or media files (screenshots, videos, voice messages).
// A report on an account must bring evidence that account has not seen yet, and in a
// batch each report brings its own: hashes are computed here and checked by the server.

import crypto from 'node:crypto'

// Default files per report; the super admin sets it from 1 to MAX_FILES_LIMIT
export const MAX_FILES = 3
export const MAX_FILES_LIMIT = 20
// Size limit per file, by kind; MAX_FILE_BYTES is the image one
export const MAX_FILE_BYTES = 3 * 1024 * 1024
export const MAX_BYTES = { image: MAX_FILE_BYTES, audio: 10 * 1024 * 1024, video: 20 * 1024 * 1024 }
// All the files of one send together, at most (the request body carries them in base64);
// the super admin can set a lower one
export const MAX_TOTAL_BYTES = 30 * 1024 * 1024
const LARGEST = Math.max(...Object.values(MAX_BYTES))

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex')

// The same link written differently gives the same hash: protocol, host case,
// trailing slash, #fragment and utm_* parameters are ignored.
export function proofUrlHash(url) {
  if (!url) return null
  const raw = String(url).trim()
  if (!raw) return null
  let normal
  try {
    const u = new URL(raw)
    for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_')) u.searchParams.delete(k)
    normal = `${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}`
  } catch {
    normal = raw.toLowerCase()
  }
  return sha256(normal)
}

// Real file type read from the first bytes, the name or declared type is not trusted
export function sniffImage(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return 'image/gif'
  return null
}

// Images, plus the videos and audio Telegram messages carry (voice messages are Ogg/Opus)
export function sniffMedia(buf) {
  const image = sniffImage(buf)
  if (image) return image
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12)
    if (brand === 'M4A ') return 'audio/mp4'
    return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4'
  }
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm'
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg'
  if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg'
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  return null
}

export const mediaKind = (mime) => mime.split('/')[0]

// files: array of base64 strings (data: URLs accepted), maxFiles at most.
// Returns { files: [{ mime, size, sha256, data }] } or { error }.
export function decodeFiles(files, maxFiles = MAX_FILES) {
  if (files == null) return { files: [] }
  if (!Array.isArray(files)) return { error: 'invalid_file' }
  if (files.length > Math.min(maxFiles, MAX_FILES_LIMIT)) return { error: 'too_many_files' }

  const out = new Map() // sha256 -> file, the same file sent twice counts once
  for (const item of files) {
    if (typeof item !== 'string') return { error: 'invalid_file' }
    const b64 = item.replace(/^data:[^,]*,/, '')
    if (b64.length * 0.75 > LARGEST + 3) return { error: 'file_too_large' }

    const data = Buffer.from(b64, 'base64')
    const mime = sniffMedia(data)
    if (!mime) return { error: 'invalid_file' }
    if (data.length > MAX_BYTES[mediaKind(mime)]) return { error: 'file_too_large' }

    const hash = sha256(data)
    out.set(hash, { mime, size: data.length, sha256: hash, data })
  }
  return { files: [...out.values()] }
}

// One entry per report of a send: { proofUrl, files }.
// Each report brings its own proof: the same link or file in two reports is refused.
// maxFiles per report and maxTotalBytes for the whole send come from the settings.
// Returns { items: [{ proofUrl, urlHash, files }] } or { error }.
export function decodeItems(items, { maxFiles = MAX_FILES, maxTotalBytes = MAX_TOTAL_BYTES } = {}) {
  if (!Array.isArray(items) || items.length === 0) return { error: 'invalid_count' }
  const totalLimit = Math.min(maxTotalBytes, MAX_TOTAL_BYTES)
  const out = []
  const seen = new Set()
  let total = 0
  for (const raw of items) {
    const item = raw && typeof raw === 'object' ? raw : {}
    const decoded = decodeFiles(item.files, maxFiles)
    if (decoded.error) return decoded

    const proofUrl = item.proofUrl ? String(item.proofUrl).trim().slice(0, 500) || null : null
    if (proofUrl && !/^https?:\/\//i.test(proofUrl)) return { error: 'invalid_proof' }
    const urlHash = proofUrlHash(proofUrl)

    for (const key of [urlHash, ...decoded.files.map((f) => f.sha256)]) {
      if (!key) continue
      if (seen.has(key)) return { error: 'duplicate_proof' }
      seen.add(key)
    }
    total += decoded.files.reduce((sum, f) => sum + f.size, 0)
    if (total > totalLimit) return { error: 'files_too_large' }

    out.push({ proofUrl, urlHash, files: decoded.files })
  }
  return { items: out }
}

export const hasProof = (item) => !!item.urlHash || item.files.length > 0

// In a batch, at least a third of the reports (rounded up) carry a proof
export const minWithProof = (count) => (count > 1 ? Math.ceil(count / 3) : 0)
