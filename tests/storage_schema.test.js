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

test.beforeEach(() => { global.localStorage = fakeLocalStorage() })

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

test('saving unchanged collections avoids rewriting them while changed data persists', () => {
  const state = { transactions:[], wallets:[], settings:{} }
  assert.equal(Storage.saveAll(state), true)
  const writes = []
  const write = localStorage.setItem
  localStorage.setItem = (key, value) => { writes.push(key); write(key, value) }
  assert.equal(Storage.saveAll(state), true)
  assert.deepEqual(writes, [])
  state.transactions.push({ id:'new', amount:10 })
  assert.equal(Storage.saveAll(state), true)
  assert.deepEqual(writes, ['mt_transactions'])
  assert.deepEqual(Storage.loadCollection('transactions'), state.transactions)
})

test('dirty-key save serializes and verifies only the selected collections', () => {
  const state = { transactions:[], wallets:[{ id:'bank', balance:100 }], settings:{} }
  assert.equal(Storage.saveAll(state), true)
  const reads = []
  const originalGet = localStorage.getItem
  localStorage.getItem = key => {
    reads.push(key)
    return originalGet(key)
  }
  state.transactions.push({ id:'new', amount:10 })
  assert.equal(Storage.saveAll(state, { dirtyKeys:['transactions'] }), true)
  assert.deepEqual(reads.filter(key => key === 'mt_transactions'), ['mt_transactions','mt_transactions','mt_transactions'])
  assert.equal(reads.includes('mt_wallets'), false)
  assert.deepEqual(Storage.loadCollection('transactions'), state.transactions)
  assert.deepEqual(Storage.loadCollection('wallets'), [{ id:'bank', balance:100 }])
})

test('dirty-key rollback restores every payload written before a later failure', () => {
  const state = { transactions:[{ id:'old' }], wallets:[{ id:'bank', balance:100 }], settings:{} }
  assert.equal(Storage.saveAll(state), true)
  const previousTransactions = localStorage.getItem('mt_transactions')
  const previousWallets = localStorage.getItem('mt_wallets')
  state.settings = { ...state.settings, theme: 'dark' }
  const write = localStorage.setItem
  const writes = []
  let failed = false
  localStorage.setItem = (key, value) => {
    writes.push(key)
    if (key === 'mt_wallets' && !failed) {
      failed = true
      throw new Error('quota exceeded')
    }
    write(key, value)
  }
  state.transactions.push({ id:'new' })
  state.wallets[0].balance = 200
  assert.equal(Storage.saveAll(state, { dirtyKeys:['transactions','wallets'] }), false)
  assert.equal(localStorage.getItem('mt_transactions'), previousTransactions)
  assert.equal(localStorage.getItem('mt_wallets'), previousWallets)
  assert.equal(writes.includes('mt_settings'), false)
})

test('a failed changed collection restores the last coherent snapshot including earlier writes', () => {
  const state = { transactions:[{ id:'old' }], wallets:[{ id:'bank', balance:100 }], settings:{ theme:'light' } }
  assert.equal(Storage.saveAll(state), true)
  const previous = new Map(Array.from({ length:localStorage.length }, (_, i) => {
    const key = localStorage.key(i)
    return [key, localStorage.getItem(key)]
  }))
  const write = localStorage.setItem
  let reject = true
  localStorage.setItem = (key, value) => {
    if (key === 'mt_wallets' && reject) { reject = false; throw new Error('quota exceeded') }
    write(key, value)
  }
  state.transactions.push({ id:'new' })
  state.wallets[0].balance = 200
  assert.equal(Storage.saveAll(state), false)
  for (const [key, value] of previous) assert.equal(localStorage.getItem(key), value, key)
})

test('an unchanged payload is still checked against storage during save verification', () => {
  const state = { transactions:[], wallets:[], settings:{} }
  assert.equal(Storage.saveAll(state), true)
  const read = localStorage.getItem
  let reads = 0
  localStorage.getItem = key => {
    if (key === 'mt_transactions' && ++reads > 1) return '[{"id":"unexpected"}]'
    return read(key)
  }
  assert.equal(Storage.saveAll(state), false)
})

test('skipped Loan payload still has per-collection readback verification', () => {
  const state = { transactions:[], wallets:[], settings:{}, loans:[{ id:'loan' }] }
  assert.equal(Storage.saveAll(state), true)
  const read = localStorage.getItem
  let reads = 0
  localStorage.getItem = key => {
    if (key === 'mt_loans' && ++reads > 1) return '[]'
    return read(key)
  }
  assert.equal(Storage.saveAll(state), false)
})

test('backup normalization keeps Split Bill collections object-shaped', () => {
  const normalized = Storage.normalizeBackupPayload({
    transactions: [],
    wallets: [],
    splitBills: [null, 'bad-row', { id: 'bill-1', title: 'Dinner' }],
    splitPeople: [null, { id: 'person-1', name: 'A' }],
    splitBillDraft: { id: 'draft-1', items: [null, { id: 'item-1', price: 10 }] },
  })

  assert.deepEqual(normalized.splitBills, [{ id: 'bill-1', title: 'Dinner' }])
  assert.deepEqual(normalized.splitPeople, [{ id: 'person-1', name: 'A' }])
  assert.deepEqual(normalized.splitBillDraft.items, [{ id: 'item-1', price: 10 }])
})
