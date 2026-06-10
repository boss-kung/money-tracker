const APP_VERSION = '2026.06.10-uiv2-r97'
const CACHE_PREFIX = 'money-tracker-v2'
const CACHE_NAME = `${CACHE_PREFIX}-${APP_VERSION}`
const CORE_NETWORK_TIMEOUT_MS = 900

const STATIC_ASSETS = [
  './',
  './index.html',
  './style_v2.css',
  './ui_v2.css',
  './app_v2.js',
  './storage_v2.js',
  './app_lock.js',
  './calculations.js',
  './sample-data_v2.js',
  './ai_insights.js',
  './finance_intelligence.js',
  './ask_my_money_core.js',
  './notification_config.js',
  './notifications_v2.js',
  './onboarding.js',
  './loans_v2.js',
  './auth_sync.js',
  './credit_card_cycles.js',
  './crypto_vault.js',
  './split_bill.js',
  './quick_capture.js',
  './thai_bank_holidays.js',
  './manifest.json',
  './assets/icon.svg',
  './assets/icon-180.png',
  './assets/fonts/LINESeedSansTH_Rg.ttf',
  './assets/fonts/LINESeedSansTH_Bd.ttf',
  './assets/fonts/LINESeedSansTH_XBd.ttf',
  './assets/fonts/tabler-icons-subset.woff2',
]

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

async function networkFirst(request, fallbackUrl = '') {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    const saved = await putIfUsable(cache, request, response)
    // Fall back to cache on 5xx/4xx so a transient server error never breaks the app.
    return saved || (await matchCached(request, fallbackUrl)) || response
  } catch (_) {
    return (await matchCached(request, fallbackUrl)) || Response.error()
  }
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
  const isCoreCode = ['app_v2.js', 'storage_v2.js', 'calculations.js', 'sample-data_v2.js', 'ai_insights.js', 'finance_intelligence.js', 'ask_my_money_core.js', 'notification_config.js', 'notifications_v2.js', 'onboarding.js', 'loans_v2.js', 'auth_sync.js', 'app_lock.js', 'credit_card_cycles.js', 'crypto_vault.js', 'split_bill.js', 'quick_capture.js', 'thai_bank_holidays.js', 'style_v2.css', 'LINESeedSansTH_Rg.ttf', 'LINESeedSansTH_Bd.ttf', 'LINESeedSansTH_XBd.ttf', 'icon-180.png'].includes(path)

  if (acceptsHtml) {
    event.respondWith(cacheFirstNavigation(request))
    return
  }

  if (isCoreCode) {
    event.respondWith(networkFirstWithTimeout(request, '', CORE_NETWORK_TIMEOUT_MS))
    return
  }

  event.respondWith(staleWhileRevalidate(request))
})
