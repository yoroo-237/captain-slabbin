import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from './utils/api.js'
import { useApp } from '../../context/AppContext.jsx'
import { isAdmin } from '../../utils/roles.js'
import { PendingTiles, SweepResult, SweepLogTable } from '../../components/admin/SweepParts.jsx'
import AdminTelegramBot from './AdminTelegramBot.jsx'

const TABS = ['General', 'Storefront', 'Telegram bot', 'Shipping', 'Loyalty', 'Deposits', 'Crypto']

// Mirrors getUserTier / getCashbackRate in backend/src/utils/formatters.js
const TIERS = [
  { name: 'Basic',     minSpent: 0,    cashback: 0.5 },
  { name: 'Preferred', minSpent: 1000, cashback: 1 },
  { name: 'Gold',      minSpent: 2000, cashback: 1.3 },
  { name: 'Platinum',  minSpent: 5000, cashback: 1.5 },
]

const SWEEP_CURRENCIES = [
  { id: 'BTC',  color: '#f7931a' },
  { id: 'LTC',  color: '#345d9d' },
  { id: 'DOGE', color: '#c2a633' },
  { id: 'ETH',  color: '#627eea' },
]

// Settings are stored as strings: "false" must not count as enabled
const flag = v => v === true || v === 'true'

function Toggle({ checked, onChange }) {
  return (
    <label className="admin-switch">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="admin-slider" />
    </label>
  )
}

export default function AdminSettings() {
  const { user } = useApp()
  const canEdit = isAdmin(user)
  const [tab, setTab] = useState('General')
  const [settings, setSettings] = useState({})
  const [saved, setSaved] = useState({})      // last saved values — what a sweep actually uses
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  const [showSeed, setShowSeed] = useState(false)

  // Sweeps — the customer-credited share only; the deposit commission is swept by the super admin
  const [pending, setPending] = useState([])
  const [sweepLogs, setSweepLogs] = useState([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [sweepConfirm, setSweepConfirm] = useState(null)  // currency awaiting confirmation
  const [sweeping, setSweeping] = useState(null)          // currency being swept
  const [sweepResult, setSweepResult] = useState(null)

  const loadSweepInfo = useCallback(() => {
    if (!canEdit) return
    adminFetch('/admin/sweep/pending')
      .then(d => setPending(d.pending || []))
      .catch(() => setPending([]))
    adminFetch('/admin/sweep/logs')
      .then(d => setSweepLogs(d.logs || []))
      .catch(() => setSweepLogs([]))
      .finally(() => setLogsLoading(false))
  }, [canEdit])

  useEffect(() => {
    adminFetch('/admin/settings')
      .then(d => { const s = d.settings || {}; setSettings(s); setSaved(s) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
    loadSweepInfo()
  }, [loadSweepInfo])

  function setS(key, value) {
    setSettings(s => ({ ...s, [key]: value }))
    setSuccess('')
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setSuccess('')
    setError('')
    try {
      await adminFetch('/admin/settings', { method: 'PUT', body: JSON.stringify(settings) })
      setSaved(settings)
      setSuccess('Settings saved successfully.')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function doSweep(currency) {
    setSweepConfirm(null)
    setSweeping(currency)
    setSweepResult(null)
    try {
      const url = currency === 'ETH' ? '/admin/eth/sweep' : `/admin/utxo/sweep/${currency}`
      setSweepResult(await adminFetch(url, { method: 'POST' }))
      loadSweepInfo()
    } catch (e) {
      setSweepResult({ currency, error: e.message })
    } finally {
      setSweeping(null)
    }
  }

  // Why a currency cannot be swept right now (null = ready)
  function sweepBlocker(currency) {
    if (!saved[`${currency.toLowerCase()}_address`]) return 'destination address not saved'
    return null
  }

  const unsavedAddresses = SWEEP_CURRENCIES.some(({ id }) => {
    const k = `${id.toLowerCase()}_address`
    return (settings[k] || '') !== (saved[k] || '')
  })

  if (loading) return <div style={{ padding: '40px', color: '#888' }}>Loading settings…</div>

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Settings</h1>
          <p className="admin-page-subtitle">Manage site configuration</p>
        </div>
      </div>

      {!canEdit && (
        <div className="admin-alert admin-alert-info">Read-only — only admins can change settings.</div>
      )}
      {success && <div className="admin-alert admin-alert-success">{success}</div>}
      {error && <div className="admin-alert admin-alert-error">{error}</div>}

      <div className="admin-tabs">
        {TABS.map(t => (
          <button key={t} type="button" className={'admin-tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Telegram bot' ? <AdminTelegramBot canEdit={canEdit} /> : (
      <form onSubmit={handleSave}>
        <fieldset disabled={!canEdit} style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
        <div className="admin-card">
          {tab === 'General' && (
            <>
              <h2 className="admin-card-title">General Settings</h2>
              <div className="admin-form-group">
                <label className="admin-label">Site Name</label>
                <input className="admin-input" value={settings.site_name || ''} onChange={e => setS('site_name', e.target.value)} />
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Maintenance Mode</label>
                <div className="admin-toggle">
                  <Toggle checked={flag(settings.maintenance_mode)} onChange={v => setS('maintenance_mode', v)} />
                  <span style={{ fontSize: '0.875rem', color: '#555' }}>
                    {flag(settings.maintenance_mode) ? 'Enabled — site is in maintenance' : 'Disabled'}
                  </span>
                </div>
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Registration Open</label>
                <div className="admin-toggle">
                  <Toggle checked={flag(settings.registration_open)} onChange={v => setS('registration_open', v)} />
                  <span style={{ fontSize: '0.875rem', color: '#555' }}>
                    {flag(settings.registration_open) ? 'Open — new accounts can register' : 'Closed — the Register form is refused'}
                  </span>
                </div>
              </div>
            </>
          )}

          {tab === 'Storefront' && (
            <>
              <h2 className="admin-card-title">Storefront</h2>
              <div className="admin-form-group">
                <label className="admin-label">Shop password (gate)</label>
                <input className="admin-input" value={settings.site_password || ''} onChange={e => setS('site_password', e.target.value)} autoComplete="off" />
                <div className="admin-text-muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>Visitors must enter it (and confirm they are 21+) before seeing anything. Leave empty to turn the gate off. Changing it signs every visitor out of the gate.</div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <input type="checkbox" checked={settings.gate_show_password !== 'false'} onChange={e => setS('gate_show_password', e.target.checked ? 'true' : 'false')} />
                  Show it on the gate (“Type CSC to enter”): the gate then only checks age and keeps bots out
                </label>
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Support phone (top strip “Text us now”)</label>
                <input className="admin-input" value={settings.support_phone || ''} onChange={e => setS('support_phone', e.target.value)} placeholder="(555) 010-0100" />
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Shop Telegram username</label>
                <input className="admin-input" value={settings.telegram_username || ''} onChange={e => setS('telegram_username', e.target.value)} placeholder="@captainslabbin" />
                <div className="admin-text-muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>Opened by the “Open Telegram” button after payment, prefilled with the paid invoice.</div>
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Signal link</label>
                <input className="admin-input" value={settings.signal_url || ''} onChange={e => setS('signal_url', e.target.value)} placeholder="https://signal.group/…" />
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Promo pop-up</label>
                <div className="admin-toggle">
                  <Toggle checked={flag(settings.promo_enabled)} onChange={v => setS('promo_enabled', v)} />
                  <span style={{ fontSize: '0.875rem', color: '#555' }}>{flag(settings.promo_enabled) ? 'Shown once per visit' : 'Hidden'}</span>
                </div>
                <input className="admin-input" style={{ marginTop: 8 }} value={settings.promo_headline || ''} onChange={e => setS('promo_headline', e.target.value)} placeholder="$50 off per unit on every order placed through the website" />
              </div>

              <h2 className="admin-card-title" style={{ marginTop: 24 }}>Shop contact &amp; location</h2>
              <div className="admin-form-group">
                <label className="admin-label">Contact email</label>
                <input className="admin-input" type="email" value={settings.contact_email || ''} onChange={e => setS('contact_email', e.target.value)} placeholder="support@captainslabbin.com" />
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Street address (optional, shown with a “Get directions” link)</label>
                <input className="admin-input" value={settings.store_address || ''} onChange={e => setS('store_address', e.target.value)} placeholder="1200 Ocean Ave" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                <div className="admin-form-group"><label className="admin-label">City</label><input className="admin-input" value={settings.store_city || ''} onChange={e => setS('store_city', e.target.value)} placeholder="Los Angeles" /></div>
                <div className="admin-form-group"><label className="admin-label">State</label><input className="admin-input" maxLength={2} value={settings.store_state || ''} onChange={e => setS('store_state', e.target.value.toUpperCase())} placeholder="CA" /></div>
                <div className="admin-form-group"><label className="admin-label">ZIP</label><input className="admin-input" value={settings.store_zip || ''} onChange={e => setS('store_zip', e.target.value)} placeholder="90001" /></div>
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Hours</label>
                <input className="admin-input" value={settings.store_hours || ''} onChange={e => setS('store_hours', e.target.value)} placeholder="Open 24/7 · Text anytime" />
              </div>

              <div className="admin-form-group">
                <label className="admin-label">About the shop (About page and home page; blank lines start a new paragraph)</label>
                <textarea className="admin-input" rows={6} value={settings.about_text || ''} onChange={e => setS('about_text', e.target.value)} placeholder="Leave empty for the default text" />
              </div>

              <h2 className="admin-card-title" style={{ marginTop: 24 }}>Announcement bar &amp; ad banner</h2>
              <div className="admin-form-group">
                <label className="admin-label">Announcement bar (one message per line, they rotate at the top of every page)</label>
                <textarea className="admin-input" rows={4} value={settings.announcements || ''} onChange={e => setS('announcements', e.target.value)} placeholder={'Free shipping on orders over $1,000\nFire Sale: up to 25% off this week'} />
                <div className="admin-text-muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>Leave empty to use automatic messages (Fire Sale, free shipping, crypto, support phone).</div>
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Ad banner on the home page (one item per line)</label>
                <textarea className="admin-input" rows={3} value={settings.ad_banner || ''} onChange={e => setS('ad_banner', e.target.value)} placeholder={'New drop: Lemon Cherry Gelato\nBulk pricing on request'} />
                <div className="admin-text-muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>Leave empty to scroll the current Fire Sale deals.</div>
              </div>
            </>
          )}

          {tab === 'Shipping' && (
            <>
              <h2 className="admin-card-title">Shipping Settings</h2>
              <div className="admin-form-group">
                <label className="admin-label">Shipping Cost ($)</label>
                <input className="admin-input" type="number" min="0" step="0.01" value={settings.shipping_cost ?? ''} onChange={e => setS('shipping_cost', e.target.value)} />
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Free Shipping Threshold ($)</label>
                <input className="admin-input" type="number" min="0" step="0.01" value={settings.shipping_free_threshold ?? ''} onChange={e => setS('shipping_free_threshold', e.target.value)} />
                <p className="admin-text-muted" style={{ margin: '6px 0 0' }}>0 = no free shipping threshold.</p>
              </div>
              <div className="admin-grid-2">
                <div className="admin-form-group">
                  <label className="admin-label">Shipping Deadline (Hours)</label>
                  <input className="admin-input" type="number" min="0" max="23" value={settings.shipping_deadline_h ?? ''} onChange={e => setS('shipping_deadline_h', e.target.value)} />
                </div>
                <div className="admin-form-group">
                  <label className="admin-label">Shipping Deadline (Minutes)</label>
                  <input className="admin-input" type="number" min="0" max="59" value={settings.shipping_deadline_m ?? ''} onChange={e => setS('shipping_deadline_m', e.target.value)} />
                </div>
              </div>
            </>
          )}

          {tab === 'Loyalty' && (
            <>
              <h2 className="admin-card-title">Loyalty Settings</h2>
              <div className="admin-form-group">
                <label className="admin-label">Points Rate (points per $1 spent)</label>
                <input className="admin-input" type="number" min="0" step="0.01" value={settings.points_rate ?? ''} onChange={e => setS('points_rate', e.target.value)} />
              </div>
              <hr className="admin-divider" />
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>Tier Thresholds (read-only)</h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr><th>Tier</th><th>Min Spent ($)</th><th>Cashback Rate</th></tr>
                  </thead>
                  <tbody>
                    {TIERS.map(t => (
                      <tr key={t.name}>
                        <td>{t.name}</td>
                        <td>${t.minSpent.toLocaleString()}</td>
                        <td>{t.cashback}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'Deposits' && (
            <>
              <h2 className="admin-card-title">Deposit Settings</h2>
              <div className="admin-form-group">
                <label className="admin-label">Deposit Expiry (Hours)</label>
                <input className="admin-input" type="number" min="1" value={settings.deposit_expiry_hours ?? ''} onChange={e => setS('deposit_expiry_hours', e.target.value)} />
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Minimum Deposit ($)</label>
                <input className="admin-input" type="number" min="0" step="0.01" value={settings.min_deposit ?? ''} onChange={e => setS('min_deposit', e.target.value)} />
              </div>
              <div className="admin-form-group">
                <label className="admin-label">Maximum Deposit ($)</label>
                <input className="admin-input" type="number" min="0" step="0.01" value={settings.max_deposit ?? ''} onChange={e => setS('max_deposit', e.target.value)} />
              </div>
            </>
          )}

          {tab === 'Crypto' && (
            <>
              {canEdit && (
                <>
                  <h2 className="admin-card-title">HD Wallet Seed — BTC / LTC / DOGE</h2>
                  <div className="admin-alert admin-alert-warning" style={{ display: 'block' }}>
                    <strong>Security notice:</strong> This 12-word mnemonic generates all BTC, LTC and DOGE deposit addresses. Keep it secret — anyone with access to it can sweep funds. It is stored in the database.
                  </div>
                  <div className="admin-form-group">
                    <label className="admin-label">BTC / LTC / DOGE HD Seed (12 words)</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        className="admin-input"
                        type={showSeed ? 'text' : 'password'}
                        value={settings.btc_hd_seed || ''}
                        onChange={e => setS('btc_hd_seed', e.target.value)}
                        placeholder="word1 word2 word3 … word12"
                        style={{ fontFamily: 'monospace', flex: 1, minWidth: 0 }}
                        autoComplete="off"
                      />
                      <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setShowSeed(v => !v)}>
                        {showSeed ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: '#888' }}>
                      Leave blank to use the <code>BTC_HD_SEED</code> environment variable. Changing it makes the existing deposit addresses unsweepable (use “Verify” on the Deposits page).
                    </p>
                  </div>
                  <hr className="admin-divider" />
                </>
              )}

              <h2 className="admin-card-title" style={{ marginTop: 0 }}>Destination Addresses</h2>
              <p style={{ fontSize: '0.82rem', color: '#888', marginBottom: '14px' }}>
                Sweeps send the customer-credited funds collected on deposit addresses to these wallets. XMR is received directly on this address.
              </p>
              {['btc', 'ltc', 'doge', 'eth', 'xmr'].map(c => (
                <div key={c} className="admin-form-group">
                  <label className="admin-label">{c.toUpperCase()} Address</label>
                  <input className="admin-input" style={{ fontFamily: 'monospace' }} value={settings[`${c}_address`] || ''} onChange={e => setS(`${c}_address`, e.target.value.trim())} placeholder={`${c.toUpperCase()} wallet address`} />
                </div>
              ))}
            </>
          )}

          {canEdit && (
            <>
              <hr className="admin-divider" />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
            </>
          )}
        </div>
        </fieldset>
      </form>
      )}

      {tab === 'Crypto' && canEdit && (
        <>
          <div className="admin-card">
            <h2 className="admin-card-title">Sweep Funds</h2>
            <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '16px' }}>
              Sends the customer-credited funds of every confirmed deposit to the saved destination addresses.
            </p>
            <PendingTiles pending={pending} currencies={SWEEP_CURRENCIES} />
            {unsavedAddresses && (
              <div className="admin-alert admin-alert-warning">You have unsaved address changes — sweeps use the saved addresses. Save first.</div>
            )}
            <SweepResult result={sweepResult} onClose={() => setSweepResult(null)} />

            {SWEEP_CURRENCIES.map(({ id, color }) => {
              const blocker = sweepBlocker(id)
              return (
                <div key={id} className="admin-sweep-row">
                  <span className="admin-badge" style={{ background: color + '22', color, border: `1px solid ${color}66` }}>{id}</span>
                  {sweepConfirm === id ? (
                    <>
                      <span style={{ fontSize: '0.82rem', color: '#b45309', fontWeight: 600, flex: 1, minWidth: 0 }}>
                        Sweep {id} → <span className="admin-code">{saved[`${id.toLowerCase()}_address`]}</span> ?
                      </span>
                      <div className="admin-gap-actions">
                        <button type="button" className="admin-btn admin-btn-success admin-btn-sm" onClick={() => doSweep(id)}>Yes, sweep</button>
                        <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => setSweepConfirm(null)}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="admin-text-muted" style={{ flex: 1, minWidth: 0 }}>
                        {blocker ? `Disabled — ${blocker}` : <>→ <span className="admin-code">{saved[`${id.toLowerCase()}_address`]}</span></>}
                      </span>
                      <button
                        type="button"
                        className="admin-btn admin-btn-secondary admin-btn-sm"
                        disabled={!!blocker || !!sweeping}
                        onClick={() => setSweepConfirm(id)}
                      >
                        {sweeping === id ? 'Sweeping…' : `Sweep ${id}`}
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          <div className="admin-card">
            <h2 className="admin-card-title">Sweep History</h2>
            <SweepLogTable logs={sweepLogs} loading={logsLoading} side="shop" />
          </div>
        </>
      )}
    </div>
  )
}
