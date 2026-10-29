import { useEffect, useState } from 'react'
import { fingerprint } from '../../utils/pgp.js'

// A PGP public key to paste, with its fingerprint to compare against your own copy.
// Only the PUBLIC key: the private one stays with you and decrypts the addresses.
export default function PgpKeyField({ value, onChange, help, label = 'PGP public key' }) {
  const [print, setPrint] = useState(null)
  useEffect(() => { let on = true; fingerprint(value).then(p => on && setPrint(p)); return () => { on = false } }, [value])
  const privateKey = /PRIVATE KEY BLOCK/.test(value)
  return (
    <div className="admin-form-group">
      <label className="admin-label">{label}</label>
      <textarea className="admin-input" rows={6} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} value={value} onChange={e => onChange(e.target.value)}
        placeholder={'-----BEGIN PGP PUBLIC KEY BLOCK-----\n…\n-----END PGP PUBLIC KEY BLOCK-----'} spellCheck={false} />
      {privateKey
        ? <div className="admin-alert admin-alert-error" style={{ marginTop: 8 }}>This is your PRIVATE key. Remove it and paste the PUBLIC key: anyone holding the private key can read every address.</div>
        : value.trim() && <p className="admin-text-muted" style={{ margin: '6px 0 0' }}>{print ? <>Fingerprint: <code>{print}</code></> : 'Not a valid PGP public key yet.'}</p>}
      {help && <p className="admin-text-muted" style={{ margin: '6px 0 0' }}>{help}</p>}
    </div>
  )
}
