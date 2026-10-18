importScripts('./release_manifest.js')

const APP_VERSION = self.MT_RELEASE.version
const CACHE_PREFIX = 'money-tracker-v2'
const CACHE_NAME = `${CACHE_PREFIX}-${APP_VERSION}`
const CORE_NETWORK_TIMEOUT_MS = 900

const STATIC_ASSETS = self.MT_RELEASE.coreAssets

self.addEventListener('push', event => {
  let payload = {}
  try { payload = event.data?.json() || {} } catch (_) {}
  const title = payload.title || 'Financial Tracker'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: payload.icon || './assets/icon.svg',
      badge: payload.badge || './assets/icon.svg',
      tag: payload.tag || 'money-tracker',
      renotify: payload.renotify || false,
      data: payload.data || {},
      actions: payload.actions || [{ action: 'open', title: 'เปิดแอป' }],
    })
  )
})

function isSameOrigin(request) {
  try { return new URL(request.url).origin === self.location.origin } catch (_) { return false }
}

async function putIfUsable(cache, request, response) {
  if (!response || !response.ok) return null  // null so callers fall back to cache on 5xx/4xx
  const type = response.type
  if (type && type !== 'basic' && type !== 'default') return null
  await cache.put(request, response.clone())
  return response
}

async function precache() {
  const cache = await caches.open(CACHE_NAME)
  await Promise.all(STATIC_ASSETS.map(async asset => {
    try {
      const request = new Request(asset, { cache: 'reload' })
      const response = await fetch(request)
      await putIfUsable(cache, request, response)
    } catch (_) {
      // Keep install resilient: one failed optional asset must not break offline shell.
    }
  }))
}

async function matchCached(request, fallbackUrl = '') {
  return (await caches.match(request, { ignoreSearch: true })) ||
    (fallbackUrl ? await caches.match(fallbackUrl, { ignoreSearch: true }) : null)
}

function timeoutResult(ms) {
  return new Promise(resolve => setTimeout(() => resolve(null), ms))
}

async function networkFirstWithTimeout(request, fallbackUrl = '', timeoutMs = CORE_NETWORK_TIMEOUT_MS) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await matchCached(request, fallbackUrl)
  // putIfUsable returns null for non-ok responses, so a 503 resolves as null
  // and the || cached fallback below kicks in correctly.
  const fresh = fetch(request)
    .then(response => putIfUsable(cache, request, response))
    .catch(() => null)
  if (!cached) return (await fresh) || Response.error()
  return (await Promise.race([fresh, timeoutResult(timeoutMs)])) || cached
}

function isImmutableAsset(request) {
  const path = new URL(request.url).pathname.split('/').pop()
  return self.MT_RELEASE.immutableFiles.includes(path)
}

async function cacheFirstImmutable(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await matchCached(request)
  // Serve immutable code/fonts immediately; keep a background revalidation so
  // the next navigation receives the newest release without blocking this one.
  const revalidate = fetch(request).then(response => putIfUsable(cache, request, response)).catch(() => null)
  if (cached) {
    revalidate.catch(() => null)
    return cached
  }
  return (await revalidate) || Response.error()
}

async function cacheFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await matchCached(request, './index.html')
  const fresh = fetch(request, { cache: 'reload' })
    .then(response => putIfUsable(cache, request, response))
    .catch(() => null)
  if (cached) return cached
  return (await fresh) || Response.error()
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await matchCached(request)
  const fresh = fetch(request)
    .then(response => putIfUsable(cache, request, response))
    .catch(() => null)
  return cached || fresh || caches.match('./index.html', { ignoreSearch: true })
}

self.addEventListener('install', event => {
  event.waitUntil(precache())
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

function routeHash(route = '') {
  const map = {
    dashboard: '#dashboard',
    addTx: '#dashboard?open=addTx',
    transactions: '#transactions',
    wallets: '#wallets',
    reports: '#reports',
    more: '#more',
    upcomingBills: '#more?open=upcomingBills',
    creditCards: '#wallets?open=creditCards',
    goals: '#more?open=goals',
    recurring: '#more?open=recurring',
    budgets: '#more?open=budgets',
    privileges: '#more?open=privileges',
    open: '#dashboard',
  }
  return map[route] || '#dashboard'
}

function notificationRoute(data = {}, action = '') {
  return (action && action !== 'open') ? action : (data.route || 'dashboard')
}

function notificationTargetUrl(data = {}, action = '') {
  const route = notificationRoute(data, action)
  return new URL(`./index.html${routeHash(route)}`, self.location.href).href
}

self.addEventListener('notificationclick', event => {
  event.notification?.close()
  const data = event.notification?.data || {}
  const action = event.action || ''
  const route = notificationRoute(data, action)
  const targetUrl = notificationTargetUrl(data, action)
  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windowClients) {
      const url = new URL(client.url)
      const target = new URL(targetUrl)
      if (url.origin === target.origin && url.pathname === target.pathname) {
        await client.focus()
        // postMessage is reliable on iOS PWA; client.navigate() often fails silently
        try { client.postMessage({ type: 'NOTIFICATION_NAVIGATE', route }) } catch (_) {}
        return
      }
    }
    await clients.openWindow(targetUrl)
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET' || !isSameOrigin(request)) return

  const url = new URL(request.url)
  const path = url.pathname.split('/').pop()
  const acceptsHtml = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')
  const isCoreCode = self.MT_RELEASE.networkFirstFiles.includes(path)

  if (acceptsHtml) {
    event.respondWith(cacheFirstNavigation(request))
    return
  }

  if (isImmutableAsset(request)) {
    event.respondWith(cacheFirstImmutable(request))
    return
  }

  if (isCoreCode) {
    event.respondWith(networkFirstWithTimeout(request, '', CORE_NETWORK_TIMEOUT_MS))
    return
  }

  event.respondWith(staleWhileRevalidate(request))
})
