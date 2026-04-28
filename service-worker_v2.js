const CACHE_NAME = 'money-tracker-new-version-v1.1'

// Core app files: always network-first so code updates land immediately
const NETWORK_FIRST = new Set([
  './index.html',
  './style_v2.css',
  './app_v2.js',
  './storage_v2.js',
  './calculations.js',
  './sample-data_v2.js',
])

// Static assets: cache-first (manifest, icons, fonts)
const STATIC_ASSETS = [
  './manifest.json',
]

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll([...NETWORK_FIRST, ...STATIC_ASSETS]))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)
  const path = './' + url.pathname.split('/').pop()

  if (NETWORK_FIRST.has(path)) {
    // Network-first: serve fresh copy; fall back to cache on error
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone))
          }
          return res
        })
        .catch(() => caches.match(e.request).then(cached => cached || caches.match('./index.html')))
    )
    return
  }

  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request)
      .then(cached => cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone))
        }
        return res
      }))
      .catch(() => caches.match('./index.html'))
  )
})
