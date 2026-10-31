// Languages of the bots dashboard: French and English, chosen by each person
// (kept on their device). The dashboard's own pages say both with L(fr, en); the
// pages it shares with the site's admin are written in English and shown in French
// through the dictionary below, applied to the page's text as it renders, so the
// site's own admin never changes.
import FR from './fr.js'

const KEY = 'bots_lang'
export const LANGS = [{ code: 'fr', label: 'Français' }, { code: 'en', label: 'English' }]

function detect() {
  try { const saved = localStorage.getItem(KEY); if (saved === 'fr' || saved === 'en') return saved } catch { /* storage blocked */ }
  return /^fr\b/i.test(navigator.language || '') ? 'fr' : 'en'
}
export const lang = detect()
document.documentElement.lang = lang

export function setLang(code) {
  try { localStorage.setItem(KEY, code) } catch { /* storage blocked */ }
  window.location.reload()
}

// The dashboard's own words, in both languages
export const L = (fr, en) => (lang === 'fr' ? fr : en)
export const locale = lang === 'fr' ? 'fr-FR' : 'en-US'

// ─── The shared admin pages, in French ───────────────────────────────────────
// Whole texts first, then a few patterns for texts with numbers or names in them
const PATTERNS = [
  [/^Order: #?(.+)$/, (_, n) => `Commande : #${n}`],
  [/^Signed in as (.+) · (\w+)$/, (_, u, r) => `Connecté en tant que ${u} · ${r}`],
  [/^Sold by (.+)\.$/, (_, b) => `Vendu par ${b}.`],
  [/^Page (\d+) of (\d+)$/, (_, a, b) => `Page ${a} sur ${b}`],
  [/^(\d+) items?$/, (_, n) => `${n} article${n === '1' ? '' : 's'}`],
  [/^from \$([\d.,]+)$/, (_, n) => `dès ${n} $`],
  [/^\$([\d.,]+) off$/, (_, n) => `${n} $ de remise`],
  [/^([\d.,]+)% off$/, (_, n) => `${n} % de remise`],
  [/^Delete "(.+)"\?$/, (_, n) => `Supprimer « ${n} » ?`],
  [/^Telegram asks to wait (\d+) s before trying again\.$/, (_, n) => `Telegram demande d’attendre ${n} s avant de réessayer.`],
  [/^@(\w+) is already linked by another account of the platform\. Unlink it there first\.$/, (_, b) => `@${b} est déjà lié par un autre compte de la plateforme. Déliez-le d’abord là-bas.`],
  [/^@(\w+) is already linked\.$/, (_, b) => `@${b} est déjà lié.`],
  [/^Edit (.+)$/, (_, n) => (FR[n] ? `Modifier ${FR[n].toLowerCase()}` : `Modifier ${n}`)],
]

function translate(text) {
  const core = text.trim()
  if (!core) return null
  const hit = FR[core] ?? PATTERNS.reduce((r, [re, f]) => r ?? (re.test(core) ? core.replace(re, f) : null), null)
  if (hit == null || hit === core) return null
  return text.replace(core, hit)
}

const ATTRS = ['placeholder', 'title', 'aria-label']
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE'])
function walk(node) {
  if (node.nodeType === 3) {
    const p = node.parentNode
    if (p && SKIP.has(p.nodeName)) return
    const t = translate(node.nodeValue)
    if (t != null) node.nodeValue = t
    return
  }
  if (node.nodeType !== 1 || SKIP.has(node.nodeName) || node.closest?.('[data-no-translate]')) return
  for (const a of ATTRS) {
    const v = node.getAttribute(a)
    const t = v && translate(v)
    if (t != null) node.setAttribute(a, t)
  }
  for (const c of node.childNodes) walk(c)
}

// Translates `root` now and whatever renders in it later (French only)
export function translateDom(root = document.body) {
  if (lang !== 'fr') return () => {}
  walk(root)
  const obs = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') walk(m.target)
      else if (m.type === 'attributes') walk(m.target)
      else m.addedNodes.forEach(walk)
    }
  })
  obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
  return () => obs.disconnect()
}
