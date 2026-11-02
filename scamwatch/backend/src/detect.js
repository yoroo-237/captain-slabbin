// Automatic detection of the report type from the description and the target.
// Rule-based and explainable: each type has weighted patterns, the best score wins.

export const TYPES = ['crypto_scam', 'clone', 'spam', 'impersonation', 'phishing', 'other']

const RULES = {
  crypto_scam: [
    [/\b(bitcoin|btc|eth|usdt|trc20|erc20|crypto|wallet|airdrop|giveaway|doubl\w+|invest\w*|trading|signals?)\b/i, 2],
    [/\b(guaranteed|garanti\w*|profit|rendement|gains?|x2|x10|100\s?%)\b/i, 2],
    [/\b(bc1[a-z0-9]{20,}|0x[a-fA-F0-9]{40}|T[A-Za-z1-9]{33})\b/, 4],
    [/\b(send|envoy\w+|deposit|d[eé]p[oô]t|recharg\w+)\b.*\b(btc|eth|usdt|crypto)\b/i, 3],
  ],
  clone: [
    [/\b(clone|fake|faux|copy|copie|copy of|same as|identique|imitat\w+|replica)\b/i, 3],
    [/\b(official|officiel\w*)\b.*\b(fake|faux|not|pas)\b/i, 2],
    [/\b(real|vrai|original)\b.*\b(is|est)\b.*@\w+/i, 3],
  ],
  spam: [
    [/\b(spam\w*|unsolicited|non sollicit\w+|mass ?messag\w+|publicit\w+|ads?|advert\w*|promo\w*)\b/i, 3],
    [/\b(add(ed)? me|ajout\w+ (dans|to)|invit\w+).*\b(group|groupe|channel|canal)\b/i, 2],
    [/\b(every day|tous les jours|repeated|r[eé]p[eé]t\w+|flood\w*)\b/i, 1],
  ],
  impersonation: [
    [/\b(impersonat\w+|usurp\w+|pretend\w*|se fait passer|pose as|claims? to be|pr[eé]tend [eê]tre)\b/i, 4],
    [/\b(admin|support|moderator|mod[eé]rateur|staff|owner|ceo)\b.*\b(fake|faux|pretend\w*|passer)\b/i, 3],
    [/\b(my (name|photo|identity)|mon (nom|identit[eé]|photo))\b/i, 2],
  ],
  phishing: [
    [/\b(phish\w*|hame[cç]onn\w+|verify your|v[eé]rifi\w+ (votre|ton)|login|connexion|password|mot de passe|seed phrase|phrase secr[eè]te|private key|cl[eé] priv[eé]e|2fa|otp|code)\b/i, 3],
    [/https?:\/\/(?!t\.me)\S+/i, 2],
    [/\b(bit\.ly|tinyurl|cutt\.ly|is\.gd|t\.co)\b/i, 2],
    [/\b(account (suspended|blocked)|compte (suspendu|bloqu[eé]))\b/i, 3],
  ],
}

export function detectType(description = '', extra = '') {
  const text = `${description} ${extra}`.slice(0, 4000)
  const scores = Object.fromEntries(TYPES.map((t) => [t, 0]))

  for (const [type, rules] of Object.entries(RULES)) {
    for (const [pattern, weight] of rules) {
      if (pattern.test(text)) scores[type] += weight
    }
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [bestType, best] = ranked[0]
  const second = ranked[1][1]

  if (best === 0) return { type: 'other', confidence: 0, scores }

  // Confidence: how far the winner is ahead, capped
  const confidence = Math.min(1, (best - second + 1) / (best + 1))
  return { type: bestType, confidence: Number(confidence.toFixed(2)), scores }
}
