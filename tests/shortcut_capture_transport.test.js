const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const modulePath = path.join(__dirname, '..', 'shortcut_capture.js')
const core = require('../shortcut_capture_core.js')

function storage() {
  const values = new Map()
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    dump: () => Object.fromEntries(values),
  }
}

function response(status, value) {
  return { ok: status >= 200 && status < 300, status, json: async () => value }
}

function setup({ fetchImpl, userId = 'user-1', token = 'access-1', online = true } = {}) {
  const calls = []
  const listeners = {}
  global.localStorage = storage()
  global.navigator = { onLine: online }
  global.location = { href: 'https://app.example/' }
  global.MT_SUPABASE_URL = 'https://supabase.example'
  global.MT_SUPABASE_ANON_KEY = 'anon'
  global.MTAuthSync = { state: { user: { id: userId }, session: { access_token: token } } }
  global.MTShortcutCaptureCore = core
  global.S = { wallets: [{ id: 'wallet-1', type: 'bank' }], transactions: [], tx: {} }
  global.App = { openOverlay: () => {}, _renderAddTxDetail: () => {}, saveAll: () => true }
  global.persist = () => true
  global.toast = () => {}
  global.MTScreenHooks = { register: (screen, id, callback) => { listeners[`${screen}:${id}`] = callback } }
  global.addEventListener = (name, callback) => { listeners[`window:${name}`] = callback }
  global.document = { addEventListener: (name, callback) => { listeners[`document:${name}`] = callback }, visibilityState: 'visible' }
  global.fetch = async (url, options) => {
    calls.push({ url, options, userId: global.MTAuthSync.state.user.id })
    return fetchImpl ? fetchImpl(url, options, calls) : response(200, { items: [], next_cursor: null })
  }
  delete require.cache[require.resolve(modulePath)]
  const api = require(modulePath)
  return { api, calls, listeners, storage: global.localStorage }
}

test('requests capture auth scope and clear old-user summaries on account change', async () => {
  let release
  const env = setup({ fetchImpl: () => new Promise(resolve => { release = resolve }) })
  const pending = env.api.refresh()
  global.MTAuthSync.state = { user: { id: 'user-2' }, session: { access_token: 'access-2' } }
  env.listeners['window:mt:auth-state-changed']?.()
  release(response(200, { items: [{ capture_id: 'old' }], next_cursor: null }))
  await assert.rejects(pending, error => error.code === 'AUTH_SCOPE_CHANGED')
  assert.deepEqual(env.api.snapshot().summaries, [])
})

test('offline refresh is skipped and queued acknowledgement survives until online retry', async () => {
  const env = setup({ online: false, fetchImpl: async () => { throw new Error('network') } })
  await env.api.retryAcknowledgements()
  assert.equal(env.calls.length, 0)
  assert.deepEqual(env.api.snapshot().ackQueue, [])
})

test('claim uses one stable non-secret browser device UUID and save hook acknowledges only true saves', async () => {
  const capture = { capture_id: '22222222-2222-4222-8222-222222222222', capture: { source: 'scb_connect', amount: '80.00', direction: 'debit', merchant: 'MBR9', description: 'MBR9', account_last4: '4078', captured_at: '2026-10-18T00:00:00Z', dedupe_version: 1, dedupe_key: 'a'.repeat(64) }, claim_secret: 'claim-secret' }
  const env = setup({ fetchImpl: async (url, options) => url.endsWith('/claim') ? response(200, capture) : response(200, { status: 'consumed' }) })
  await env.api.claim(capture.capture_id)
  await env.api.openDraft(capture.capture_id)
  assert.equal('raw_text' in env.api.snapshot().summaries[0], false)
  const claimCall = env.calls.find(call => call.url.endsWith('/claim'))
  const claimBody = JSON.parse(claimCall.options.body)
  assert.match(claimBody.device_id, /^[0-9a-f-]{36}$/)
  const firstDevice = claimBody.device_id
  await env.api.claim(capture.capture_id)
  assert.equal(JSON.parse(env.calls.filter(call => call.url.endsWith('/claim'))[1].options.body).device_id, firstDevice)

  const saveHook = env.listeners['transactionSave:shortcut-capture.save-before-ack']
  assert.ok(saveHook)
  await saveHook({ result: false })
  assert.equal(env.calls.filter(call => call.url.endsWith('/consume')).length, 0)
  global.S.wallets = [{ id: 'wallet-1', type: 'bank' }]
  await saveHook({ result: true })
  assert.equal(env.calls.filter(call => call.url.endsWith('/consume')).length, 1)
})

test('opens a capture draft through the app state accessor when state is not a window global', async () => {
  const captureId = '22222222-2222-4222-8222-222222222222'
  const appState = { wallets: [{ id: 'wallet-1', type: 'bank' }], transactions: [], tx: {} }
  const env = setup({ fetchImpl: async url => url.endsWith('/claim')
    ? response(200, { capture_id: captureId, capture: { source: 'scb_connect', amount: '80.00', direction: 'debit', merchant: 'MBR9', description: 'MBR9', account_last4: '4078', captured_at: '2026-10-18T00:00:00Z', dedupe_version: 1, dedupe_key: 'a'.repeat(64) }, claim_secret: 'claim-secret' })
    : response(200, { items: [] }) })
  delete global.S
  global.App._getState = () => appState

  await env.api.openDraft(captureId)

  assert.equal(appState.txMode, 'add')
  assert.equal(appState.editingTxId, null)
  assert.equal(appState.tx.merchant, 'MBR9')
  assert.equal(appState.tx.externalCapture.captureId, captureId)
})

test('transient acknowledgement failure queues once and retry is scoped to the current user', async () => {
  const captureId = '22222222-2222-4222-8222-222222222222'
  const env = setup({ fetchImpl: async url => url.endsWith('/claim')
    ? response(200, { capture_id: captureId, capture: { source: 'scb_connect', amount: '80.00', direction: 'debit', merchant: 'MBR9', description: 'MBR9', account_last4: '4078', captured_at: '2026-10-18T00:00:00Z', dedupe_version: 1, dedupe_key: 'a'.repeat(64) }, claim_secret: 'claim-secret' })
    : response(503, { error: 'inbox_failed' }) })
  await env.api.claim(captureId)
  await env.api.openDraft(captureId)
  await env.listeners['transactionSave:shortcut-capture.save-before-ack']({ result: true })
  await env.listeners['transactionSave:shortcut-capture.save-before-ack']({ result: true })
  assert.equal(env.api.snapshot().ackQueue.length, 1)
  global.MTAuthSync.state = { user: { id: 'user-2' }, session: { access_token: 'access-2' } }
  await env.api.retryAcknowledgements()
  assert.equal(env.calls.filter(call => call.url.endsWith('/ack')).length, 0)
})

