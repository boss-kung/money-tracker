const APP_VERSION = '2026.05.11-r1'
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
  './manifest.json',
]

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

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET' || !isSameOrigin(request)) return

  const url = new URL(request.url)
  const path = url.pathname.split('/').pop()
  const acceptsHtml = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')
  const isCoreCode = ['app_v2.js', 'storage_v2.js', 'calculations.js', 'sample-data_v2.js', 'style_v2.css'].includes(path)

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
