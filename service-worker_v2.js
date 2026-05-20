const APP_VERSION = '2026.05.20-r31'
const CACHE_PREFIX = 'money-tracker-v2'
const CACHE_NAME = `${CACHE_PREFIX}-${APP_VERSION}`

const STATIC_ASSETS = [
  './',
  './index.html',
  './style_v2.css',
  './app_v2.js',
  './storage_v2.js',
  './calculations.js',
  './sample-data_v2.js',
  './ai_insights.js',
  './finance_intelligence.js',
  './ask_my_money_core.js',
  './notification_config.js',
  './notifications_v2.js',
  './manifest.json',
  './assets/icon.svg',
  './assets/fonts/LINESeedSansTH_Rg.ttf',
  './assets/fonts/LINESeedSansTH_Bd.ttf',
  './assets/fonts/LINESeedSansTH_XBd.ttf',
]

self.addEventListener('push', event => {
  let payload = {}
  try { payload = event.data?.json() || {} } catch (_) {}
  const title = payload.title || 'Money Tracker'
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
  if (!response || !response.ok) return response
  const type = response.type
  if (type && type !== 'basic' && type !== 'default') return response
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

async function networkFirst(request, fallbackUrl = '') {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    await putIfUsable(cache, request, response)
    return response
  } catch (_) {
    return (await caches.match(request)) || (fallbackUrl ? await caches.match(fallbackUrl) : null) || Response.error()
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await caches.match(request)
  const fresh = fetch(request)
    .then(response => putIfUsable(cache, request, response))
    .catch(() => null)
  return cached || fresh || caches.match('./index.html')
}

self.addEventListener('install', event => {
  event.waitUntil(precache().then(() => self.skipWaiting()))
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
  const isCoreCode = ['app_v2.js', 'storage_v2.js', 'calculations.js', 'sample-data_v2.js', 'ai_insights.js', 'finance_intelligence.js', 'ask_my_money_core.js', 'notification_config.js', 'notifications_v2.js', 'style_v2.css', 'LINESeedSansTH_Rg.ttf', 'LINESeedSansTH_Bd.ttf', 'LINESeedSansTH_XBd.ttf'].includes(path)

  if (acceptsHtml) {
    event.respondWith(networkFirst(request, './index.html'))
    return
  }

  if (isCoreCode) {
    event.respondWith(networkFirst(request))
    return
  }

  event.respondWith(staleWhileRevalidate(request))
})
