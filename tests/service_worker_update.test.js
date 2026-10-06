const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'service-worker_v2.js'), 'utf8')

function loadWorker() {
  const listeners = new Map()
  let skipWaitingCalls = 0
  const self = {
    location: { href: 'https://money.example/service-worker_v2.js', origin: 'https://money.example' },
    registration: { showNotification: async () => {} },
    clients: { claim: async () => {} },
    addEventListener(type, listener) {
      const registered = listeners.get(type) || []
      registered.push(listener)
      listeners.set(type, registered)
    },
    skipWaiting() {
      skipWaitingCalls += 1
      return Promise.resolve()
    },
  }

  vm.runInNewContext(source, {
    self,
    importScripts() {
      self.MT_RELEASE = {
        version: 'test-release',
        coreAssets: [],
        immutableFiles: [],
      }
    },
    caches: {
      open: async () => ({ put: async () => {} }),
      keys: async () => [],
      match: async () => null,
      delete: async () => true,
    },
    clients: {
      matchAll: async () => [],
      openWindow: async () => {},
    },
    fetch: async () => ({ ok: true, type: 'basic', clone() { return this } }),
    Request,
    Response,
    URL,
    setTimeout,
  })

  return {
    listener(type) {
      assert.equal(listeners.get(type)?.length, 1, `${type} listener`)
      return listeners.get(type)[0]
    },
    skipWaitingCalls: () => skipWaitingCalls,
  }
}

test('an updated worker waits for the user before taking control', async () => {
  const worker = loadWorker()
  let installPromise

  worker.listener('install')({
    waitUntil(promise) { installPromise = promise },
  })
  await installPromise

  assert.equal(worker.skipWaitingCalls(), 0, 'install must leave the update waiting so the reload banner can appear')

  worker.listener('message')({ data: { type: 'SKIP_WAITING' } })
  assert.equal(worker.skipWaitingCalls(), 1, 'the reload action should activate the waiting worker')
})
