// Service worker of the admin: shows the push notifications sent by the server
// (paid order, customer message, support ticket) even when no tab is open, and
// opens the right admin page when one is tapped. It caches nothing.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  event.waitUntil((async () => {
    await self.registration.showNotification(data.title || 'Admin', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: !!data.tag, // a newer push with the same tag alerts again instead of replacing silently
      icon: '/brand/icon-192.png',
      badge: '/brand/favicon.png',
      data: { url: data.url || '/admin' },
    })
    // Open admin tabs refresh their counters at once
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) client.postMessage({ type: 'push' })
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/admin', self.location.origin).href
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = tabs.find(t => t.url.startsWith(self.location.origin + '/admin'))
    if (open) {
      await open.focus()
      if ('navigate' in open) await open.navigate(url).catch(() => {})
    } else {
      await self.clients.openWindow(url)
    }
  })())
})
