import { useEffect, useState } from 'react'
import { api, CURRENCIES, fmtCrypto, fmtUsd } from './api.js'
import { PasswordCard } from './Auth.jsx'

// Balance in crypto at the live price, tokens available, top-ups and history
// exempt: the super admin pays nothing, so no balance to show and nothing to top up
export default function Wallet({ t, lang, wallet, reloadWallet, exempt }) {
  const [currency, setCurrency] = useState('BTC')
  const [wanted, setWanted] = useState('10')
  const [prices, setPrices] = useState({})
  const [deposit, setDeposit] = useState(null)
  const [deposits, setDeposits] = useState([])
  const [history, setHistory] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadLists = () => {
    api('/api/wallet/deposits').then(setDeposits).catch(() => {})
    api('/api/wallet/transactions').then(setHistory).catch(() => {})
  }

  useEffect(() => {
    loadLists()
    api('/api/wallet/prices').then((r) => setPrices(r.prices)).catch(() => {})
  }, [])

  // An open deposit is checked every 30 s until the payment is credited
  useEffect(() => {
    if (!deposit || !['awaiting', 'partial'].includes(deposit.status) || deposit.currency === 'XMR') return
    const id = setInterval(() => check(true), 30000)
    return () => clearInterval(id)
  }, [deposit?.id, deposit?.status])

  const tokenPrice = wallet?.tokenPriceUsd || 1
  const usdWanted = Math.max(0, Number(wanted) || 0) * tokenPrice
  const estimate = prices[currency] ? usdWanted / prices[currency] : null

  const create = async () => {
    setBusy(true); setMsg(null)
    try {
      setDeposit(await api('/api/wallet/deposits', { method: 'POST', body: JSON.stringify({ currency }) }))
      loadLists()
    } catch (err) {
      setMsg({ ok: false, text: t.wallet.errors[err.code] || t.error })
    } finally { setBusy(false) }
  }

  const check = async (silent = false) => {
    if (!deposit) return
    if (!silent) { setBusy(true); setMsg(null) }
    try {
      const r = await api(`/api/wallet/deposits/${deposit.id}/check`, { method: 'POST' })
      setDeposit(r.deposit)
      if (r.deposit.status === 'confirmed') {
        setMsg({ ok: true, text: t.wallet.credited })
        reloadWallet(); loadLists()
      } else if (!silent) {
        setMsg({ ok: false, text: r.pending ? t.wallet.pending : t.wallet.notYet })
      }
    } catch (err) {
      if (!silent) setMsg({ ok: false, text: t.wallet.errors[err.code] || t.error })
    } finally { if (!silent) setBusy(false) }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(deposit.address); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }

  const date = (d) => new Date(d).toLocaleString(lang)

  return (
    <div className="wallet">
      <section className={`card balance ${exempt ? 'full' : ''}`}>
        <h2>{t.wallet.title}</h2>
        <p className="big">{exempt ? '∞' : wallet ? wallet.tokens : '...'} <span>{t.wallet.tokens}</span></p>
        <p className="muted">
          {exempt ? t.costSuper : wallet ? t.wallet.balanceLine(fmtUsd(wallet.balance), fmtUsd(wallet.tokenPriceUsd), wallet.reportCostTokens) : ''}
        </p>
        {wallet?.holdings?.length > 0 && (
          <ul className="holdings">
            {wallet.holdings.map((h) => (
              <li key={h.currency}>
                <span className="name">{h.currency}</span>
                <span>{fmtCrypto(h.amount)}</span>
                <span className="count">{h.usd != null ? fmtUsd(h.usd) : t.wallet.noPrice}</span>
              </li>
            ))}
          </ul>
        )}
        {!exempt && <p className="hint">{t.wallet.liveHint}</p>}
      </section>

      {!exempt && <section className="card">
        <h2>{t.wallet.topUp}</h2>
        <div className="tabs">
          {CURRENCIES.map((c) => (
            <button key={c} type="button" className={c === currency ? 'on' : ''} onClick={() => { setCurrency(c); setDeposit(null); setMsg(null) }}>{c}</button>
          ))}
        </div>
        <div className="form-grid">
          <label>
            {t.wallet.wanted}
            <input type="number" min="1" step="1" value={wanted} onChange={(e) => setWanted(e.target.value)} />
            <span className="hint">
              {estimate ? t.wallet.estimate(fmtUsd(usdWanted), `${fmtCrypto(estimate)} ${currency}`) : t.wallet.noPrice}
            </span>
          </label>
          {!deposit && <button className="primary" disabled={busy} onClick={create}>{t.wallet.getAddress}</button>}
        </div>

        {deposit && (
          <div className="deposit">
            <p className="hint">{t.wallet.sendTo(deposit.currency)}</p>
            <div className="address">
              <code>{deposit.address}</code>
              <button type="button" className="ghost" onClick={copy}>{copied ? t.wallet.copied : t.wallet.copy}</button>
            </div>
            <p className="hint">
              {t.wallet.depositStatus[deposit.status]} · {t.wallet.expires(date(deposit.expiresAt))}
            </p>
            {deposit.currency === 'XMR'
              ? <p className="hint">{t.wallet.xmrManual}</p>
              : deposit.status !== 'confirmed' && <button className="ghost" disabled={busy} onClick={() => check()}>{t.wallet.check}</button>}
          </div>
        )}
        {msg && <p className={`msg ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</p>}
        <p className="hint">{t.wallet.topUpHint}</p>
      </section>}

      <section className="card full">
        <h2>{t.wallet.history}</h2>
        <ul className="reports">
          {history.length === 0 && deposits.length === 0 && <li className="muted">{t.wallet.empty}</li>}
          {history.map((x) => (
            <li key={`t${x.id}`}>
              <div className="row">
                <span className="name">{t.wallet.txTypes[x.type] || x.type}</span>
                <span className={x.type === 'report' ? 'neg' : 'pos'}>
                  {x.type === 'report' ? `-${x.tokens} ${t.wallet.tokens}` : `+${fmtCrypto(x.cryptoAmount)} ${x.currency}`}
                </span>
              </div>
              <div className="row muted"><span>{x.note}</span><span>{date(x.createdAt)}</span></div>
            </li>
          ))}
          {deposits.filter((d) => d.status !== 'confirmed').map((d) => (
            <li key={`d${d.id}`}>
              <div className="row">
                <span className="name">{t.wallet.txTypes.deposit} {d.currency}</span>
                <span className="muted">{t.wallet.depositStatus[d.status]}</span>
              </div>
              <div className="row muted"><span className="mono">{d.address}</span><span>{date(d.createdAt)}</span></div>
            </li>
          ))}
        </ul>
      </section>

      <PasswordCard t={t} />
    </div>
  )
}
