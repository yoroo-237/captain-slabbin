// Parses what the user typed to identify the reported account:
// @username, t.me/username, https://t.me/username, or a numeric ID.

const USERNAME = /^[a-z][a-z0-9_]{4,31}$/i

export function parseTarget(input = '') {
  let value = String(input).trim()
  if (!value) return null

  const link = value.match(/^(?:https?:\/\/)?(?:t|telegram)\.me\/([^/?#\s]+)/i)
  if (link) value = link[1]

  value = value.replace(/^@/, '')

  if (/^\d{5,15}$/.test(value)) return { tgId: value, username: null, kind: 'unknown' }

  if (USERNAME.test(value)) {
    const kind = /bot$/i.test(value) ? 'bot' : 'unknown'
    return { tgId: null, username: value.toLowerCase(), kind }
  }

  return null
}
