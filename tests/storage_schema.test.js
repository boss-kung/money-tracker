const test = require('node:test')
const assert = require('node:assert/strict')

function fakeLocalStorage() {
  const data = new Map()
  return {
    get length() { return data.size },
    key(index) { return [...data.keys()][index] ?? null },
    getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null },
    setItem(key, value) { data.set(String(key), String(value)) },
    removeItem(key) { data.delete(String(key)) },
    clear() { data.clear() },
  }
}

global.localStorage = fakeLocalStorage()
const Storage = require('../storage_v2.js')

test('Storage schema drives State save and hydration for every State collection', () => {
  const state = {}
  for (const name of Storage.collectionNames) {
    if (!Storage.isStateCollection(name)) continue
    state[name] = name === 'settings' ? { marker:name } : [{ marker:name }]
  }
  state.categories = { expense:[{ marker:'categories' }], income:[] }
  state.ccBenefits = { marker:'ccBenefits' }
  state.marketPrices = { marker:'marketPrices' }
  state.cryptoSyncMeta = { marker:'cryptoSyncMeta' }
  state.migrations = { marker:'migrations' }
  state.splitBillDraft = { marker:'splitBillDraft' }

  assert.equal(Storage.saveAll(state), true)
  const loaded = Storage.init()
  for (const name of Storage.collectionNames) {
    if (!Storage.isStateCollection(name)) continue
    assert.deepEqual(loaded[name], state[name], `${name} did not round-trip through the schema`)
  }
})

test('auxiliary collections use the same Storage Interface and Vault export schema', () => {
  assert.equal(Storage.saveCollection('financialProfile', { primaryFocus:'resilience' }), true)
  assert.equal(Storage.saveCollection('financialMemory', [{ id:'memory-1' }]), true)

  const payload = Storage.buildExportPayload({ transactions:[], wallets:[] })
  assert.equal(payload.backupSchemaVersion, 4)
  assert.deepEqual(payload.financialProfile, { primaryFocus:'resilience' })
  assert.deepEqual(payload.financialMemory, [{ id:'memory-1' }])
  assert.ok(Storage.collectionNames.includes('financeFeatureStoreMeta'))
})

test('Storage reset is schema-complete', () => {
  for (const name of Storage.collectionNames) Storage.saveCollection(name, { marker:name })
  Storage.reset()
  for (const name of Storage.collectionNames) {
    const fallback = `missing:${name}`
    assert.equal(Storage.loadCollection(name, fallback), fallback, `${name} survived reset`)
  }
})
