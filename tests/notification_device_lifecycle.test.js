const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
function fixture({ registerDevice = async () => {}, readSubscription = async () => ({ endpoint: 'https://push.example/a' }) } = {}) {
  const file = path.join(__dirname, '../notification_device_lifecycle.js')
  assert.ok(fs.existsSync(file), 'registration coordinator must exist')
  let scope = { key: 'user-a:install-a' }, enabled = true, blockedReason = '', now = 1000
  const states = []
  const lifecycle = require(file).create({ readScope: () => scope, isEnabled: () => enabled, readBlockReason: () => blockedReason,
    readSubscription, registerDevice, onStatus: s => states.push(s), now: () => now })
  return { lifecycle, states, set scope(v) { scope = v }, set enabled(v) { enabled = v }, set blockedReason(v) { blockedReason = v }, set now(v) { now = v } }
}
test('concurrent callers share registration and ready lifecycle avoids duplicate registration', async () => {
  let count = 0, release
  const f = fixture({ registerDevice: async () => { count++; await new Promise(resolve => { release = resolve }) } })
  const a = f.lifecycle.ensureReady(), b = f.lifecycle.ensureReady()
  await new Promise(resolve => setImmediate(resolve)); assert.equal(count, 1)
  release(); assert.equal((await a).status, 'ready'); assert.equal((await b).status, 'ready')
  await f.lifecycle.ensureReady(); assert.equal(count, 1)
})
test('scope change during browser lookup prevents registration with old subscription', async () => {
  let release, count = 0
  const f = fixture({ readSubscription: () => new Promise(resolve => { release = resolve }), registerDevice: async () => { count++ } })
  const pending = f.lifecycle.ensureReady()
  f.scope = { key: 'user-b:install-b' }; release({ endpoint: 'https://push.example/a' })
  assert.equal((await pending).reason, 'scope-changed'); assert.equal(count, 0)
})
test('reset invalidates old completion even when the same user signs back in', async () => {
  let release, count = 0
  const f = fixture({ registerDevice: async () => { if (++count === 1) await new Promise(resolve => { release = resolve }) } })
  const pending = f.lifecycle.ensureReady(); await new Promise(resolve => setImmediate(resolve))
  f.lifecycle.reset(); release(); assert.equal((await pending).reason, 'scope-changed')
  assert.equal((await f.lifecycle.ensureReady()).status, 'ready'); assert.equal(count, 2)
})
test('registration errors are throttled without marking device ready', async () => {
  let count = 0
  const f = fixture({ registerDevice: async () => { count++; throw new Error('Offline') } })
  await assert.rejects(f.lifecycle.ensureReady(), /Offline/)
  await assert.rejects(f.lifecycle.ensureReady(), /Offline/); assert.equal(count, 1)
  f.now = 62000; await assert.rejects(f.lifecycle.ensureReady(), /Offline/); assert.equal(count, 2)
})
test('disabled, offline and missing-subscription states never register in background', async () => {
  let count = 0
  const f = fixture({ readSubscription: async () => null, registerDevice: async () => { count++ } })
  f.enabled = false; assert.equal((await f.lifecycle.ensureReady()).reason, 'disabled')
  f.enabled = true; f.blockedReason = 'offline'; assert.equal((await f.lifecycle.ensureReady()).reason, 'offline')
  f.blockedReason = ''; assert.equal((await f.lifecycle.ensureReady()).reason, 'subscription-required')
  assert.equal(count, 0)
})
