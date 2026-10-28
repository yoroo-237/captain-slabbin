import { useCallback, useEffect, useState } from 'react'
import { adminFetch } from './utils/api.js'

// Browser notifications of the admin: ask permission, register /sw.js, subscribe
// this browser to the server's push key. `state` is one of
// unsupported | blocked | off | on.
const supported = typeof window !== 'undefined'
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function keyBytes(base64) {
  const raw = atob((base64 + '='.repeat((4 - base64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

const currentSubscription = async () => {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  return reg ? reg.pushManager.getSubscription() : null
}

export function usePush() {
  const [state, setState] = useState(supported ? 'off' : 'unsupported')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!supported) return
    if (Notification.permission === 'denied') return setState('blocked')
    try { setState((await currentSubscription()) && Notification.permission === 'granted' ? 'on' : 'off') } catch { setState('off') }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  async function run(fn) {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e.message || 'Something went wrong') } finally { setBusy(false); refresh() }
  }

  const enable = () => run(async () => {
    if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in the browser (padlock next to the address), then try again.')
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    const { publicKey } = await adminFetch('/admin/push/key')
    // A subscription made with another server key can't be reused
    const old = await reg.pushManager.getSubscription()
    if (old) await old.unsubscribe()
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
    await adminFetch('/admin/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) })
    await adminFetch('/admin/push/test', { method: 'POST' })
  })

  const disable = () => run(async () => {
    const sub = await currentSubscription()
    if (!sub) return
    await adminFetch('/admin/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
    await sub.unsubscribe()
  })

  const test = () => run(async () => {
    const { sent } = await adminFetch('/admin/push/test', { method: 'POST' })
    if (!sent) throw new Error('The test could not be delivered. Turn notifications off and on again.')
  })

  return { state, busy, error, enable, disable, test }
}
