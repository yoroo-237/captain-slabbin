// Evidence attached to a report: a proof link and/or screenshots.
// A report on an account must bring evidence that account has not seen yet,
// so hashes are computed here and checked by the server.

import crypto from 'node:crypto'

export const MAX_FILES = 3
export const MAX_FILE_BYTES = 3 * 1024 * 1024

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
  return null
}

// files: array of base64 strings (data: URLs accepted).
// Returns { files: [{ mime, size, sha256, data }] } or { error }.
export function decodeFiles(files) {
  if (files == null) return { files: [] }
  if (!Array.isArray(files)) return { error: 'invalid_file' }
  if (files.length > MAX_FILES) return { error: 'too_many_files' }

  const out = new Map() // sha256 -> file, the same screenshot sent twice counts once
  for (const item of files) {
    if (typeof item !== 'string') return { error: 'invalid_file' }
    const b64 = item.replace(/^data:[^,]*,/, '')
    if (b64.length * 0.75 > MAX_FILE_BYTES + 3) return { error: 'file_too_large' }

    const data = Buffer.from(b64, 'base64')
    if (data.length > MAX_FILE_BYTES) return { error: 'file_too_large' }
    const mime = sniffImage(data)
    if (!mime) return { error: 'invalid_file' }

    const hash = sha256(data)
    out.set(hash, { mime, size: data.length, sha256: hash, data })
  }
  return { files: [...out.values()] }
}
