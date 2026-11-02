import { Screenshot } from './Admin.jsx'

// Steps of a report, in order. With proof the server captures the account first,
// the report is paid and sent only once the proof is in.
export const STEPS = {
  proof: ['check', 'capture', 'type', 'send'],
  plain: ['send'],
}

// flow: { mode, at, state: 'run' | 'ok' | 'error', detail }
// Steps before `at` are done, `at` is running (or failed), the bar fills accordingly.
export function Progress({ t, flow }) {
  const steps = STEPS[flow.mode]
  const done = flow.state === 'ok' ? steps.length : flow.at
  // The running step counts for half, so the bar moves as soon as it starts
  const pct = Math.round(((done + (flow.state === 'run' ? 0.5 : 0)) / steps.length) * 100)
  return (
    <div className={`progress ${flow.state}`}>
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t.flow.label}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {steps.length > 1 && (
        <ol className="progress-steps">
          {steps.map((k, i) => (
            <li key={k} className={i < done ? 'done' : i === flow.at ? flow.state : ''}>{t.flow.steps[k]}</li>
          ))}
        </ol>
      )}
      {flow.detail && <p className="progress-detail">{flow.detail}</p>}
    </div>
  )
}

// The captured account, as it is sent with the report
export function ProofPreview({ t, lang, capture }) {
  return (
    <div className="proof">
      <span className="mono">{t.flow.proofTitle}</span>
      <div className="capture-body">
        {capture.hasPhoto && <Screenshot path={`/api/captures/${capture.id}/photo`} alt={capture.title} />}
        <div className="capture-text">
          <p className="name">
            {capture.title || '-'}
            {capture.kind && <span className="badge">{t.admin.kinds[capture.kind] || capture.kind}</span>}
            <span className="badge confirmed">{t.types[capture.detectedType] || capture.detectedType}</span>
          </p>
          {capture.about && <p className="desc">{capture.about}</p>}
          {capture.texts.length > 0 && (
            <ul className="texts">
              {capture.texts.map((x, i) => <li key={i} className="desc">{x}</li>)}
            </ul>
          )}
          <p className="hint">{t.flow.proofMeta(capture.textCount, new Date(capture.finishedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }))}</p>
        </div>
      </div>
    </div>
  )
}
