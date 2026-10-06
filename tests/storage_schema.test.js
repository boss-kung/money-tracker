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

test.beforeEach(() => {
  global.localStorage = fakeLocalStorage()
  Storage.stateRevision = 0
  Storage.isStale = false
  Storage.lastConflict = null
  Storage.lastSaveError = null
  Storage.lastVerifyError = null
  Storage._recoveryWriteAuthorized = false
  Storage.hydrationStatus = { recoveryMode:false, corruptCollections:[], quarantinedAt:null, quarantineKey:'mt_corrupt_quarantine' }
})

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
  assert.deepEqual(writes.filter(key => !['mt_state_lock', 'mt_state_meta'].includes(key)), [])
  assert.equal(writes.filter(key => key === 'mt_state_meta').length, 1)
  state.transactions.push({ id:'new', amount:10 })
  assert.equal(Storage.saveAll(state), true)
  assert.deepEqual(writes.filter(key => !['mt_state_lock', 'mt_state_meta'].includes(key)), ['mt_transactions'])
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

test('dirty market saves do not fail when unrelated optional keys are still missing', () => {
  const data = new Map([
    ['mt_transactions', '[]'],
    ['mt_wallets', '[]'],
    ['mt_settings', '{}'],
  ])
  global.localStorage = {
    get length() { return data.size },
    key(index) { return [...data.keys()][index] ?? null },
    getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null },
    setItem(key, value) { data.set(String(key), String(value)) },
    removeItem(key) { data.delete(String(key)) },
    clear() { data.clear() },
  }

  const state = {
    transactions: [],
    wallets: [],
    settings: {},
    marketPrices: { updatedAt:'2026-10-04T12:00:00.000Z' },
    cryptoSyncMeta: { attemptAt:'2026-10-04T12:00:00.000Z' },
  }
  assert.equal(Storage.saveAll(state, { dirtyKeys:['marketPrices', 'cryptoSyncMeta'] }), true)
  assert.deepEqual(Storage.loadCollection('marketPrices'), state.marketPrices)
  assert.deepEqual(Storage.loadCollection('cryptoSyncMeta'), state.cryptoSyncMeta)
  assert.equal(Storage.lastSaveError, null)
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

test('quota recovery prunes duplicated local backups and retries the whole State save', () => {
  const data = new Map()
  global.localStorage = {
    get length() { return data.size },
    key(index) { return [...data.keys()][index] ?? null },
    getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null },
    setItem(key, value) {
      const backups = JSON.parse(data.get('mt_local_backup_snapshots') || '[]')
      if (key === 'mt_market_prices' && backups.length > 1) {
        throw Object.assign(new Error('quota full'), { name: 'QuotaExceededError' })
      }
      data.set(String(key), String(value))
    },
    removeItem(key) { data.delete(String(key)) },
    clear() { data.clear() },
  }

  const state = { transactions:[], wallets:[], settings:{}, marketPrices:{} }
  assert.equal(Storage.saveAll(state), true)
  localStorage.setItem('mt_local_backup_snapshots', JSON.stringify([
    { id:'newest', payload:{ transactions:[] } },
    { id:'older', payload:{ transactions:[] } },
  ]))

  state.marketPrices = { updatedAt:'2026-10-04T12:00:00.000Z', fx:{ base:'USD', rates:{ THB:32.5 } } }
  assert.equal(Storage.saveAll(state, { dirtyKeys:['marketPrices'] }), true)
  assert.deepEqual(Storage.loadCollection('marketPrices'), state.marketPrices)
  assert.equal(JSON.parse(localStorage.getItem('mt_local_backup_snapshots')).length, 1)
  assert.equal(Storage.lastSaveError, null)
})

test('quota recovery keeps the original snapshot when the retry also fails', () => {
  const data = new Map()
  let rollbackBlocked = true
  let originalTransactionsRaw = ''
  let newWalletRaw = ''
  global.localStorage = {
    get length() { return data.size },
    key(index) { return [...data.keys()][index] ?? null },
    getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null },
    setItem(key, value) {
      const normalizedKey = String(key)
      const normalizedValue = String(value)
      if (normalizedKey === 'mt_wallets' && normalizedValue === newWalletRaw) {
        throw Object.assign(new Error('quota full'), { name: 'QuotaExceededError' })
      }
      if (normalizedKey === 'mt_transactions' && normalizedValue === originalTransactionsRaw && rollbackBlocked) {
        throw Object.assign(new Error('quota full during rollback'), { name: 'QuotaExceededError' })
      }
      if (normalizedKey === 'mt_local_backup_snapshots') {
        const backups = JSON.parse(normalizedValue)
        if (backups.length === 1) rollbackBlocked = false
      }
      data.set(normalizedKey, normalizedValue)
    },
    removeItem(key) { data.delete(String(key)) },
    clear() { data.clear() },
  }

  const state = {
    transactions:[{ id:'old', note:'x'.repeat(120) }],
    wallets:[{ id:'wallet-old' }],
    settings:{},
  }
  assert.equal(Storage.saveAll(state), true)
  originalTransactionsRaw = localStorage.getItem('mt_transactions')
  const originalWalletsRaw = localStorage.getItem('mt_wallets')
  state.transactions = [{ id:'new' }]
  state.wallets = [{ id:'wallet-new', note:'y'.repeat(1200) }]
  newWalletRaw = JSON.stringify(state.wallets)
  localStorage.setItem('mt_local_backup_snapshots', JSON.stringify([
    { id:'newest', payload:{ transactions:[] } },
    { id:'older', payload:{ transactions:[] } },
  ]))

  assert.equal(Storage.saveAll(state, { dirtyKeys:['transactions','wallets'] }), false)
  assert.equal(localStorage.getItem('mt_transactions'), originalTransactionsRaw)
  assert.equal(localStorage.getItem('mt_wallets'), originalWalletsRaw)
})

test('rollback releases shrinking payloads before restoring larger payloads under a byte quota', () => {
  const data = new Map()
  let capacity = Infinity
  const byteLength = value => String(value || '').length
  const totalBytes = () => [...data].reduce((sum, [key, value]) => sum + byteLength(key) + byteLength(value), 0)
  global.localStorage = {
    get length() { return data.size },
    key(index) { return [...data.keys()][index] ?? null },
    getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null },
    setItem(key, value) {
      const normalizedKey = String(key)
      const normalizedValue = String(value)
      const previousEntrySize = data.has(normalizedKey)
        ? byteLength(normalizedKey) + byteLength(data.get(normalizedKey))
        : 0
      const nextTotal = totalBytes() - previousEntrySize + byteLength(normalizedKey) + byteLength(normalizedValue)
      if (nextTotal > capacity) throw Object.assign(new Error('quota full'), { name: 'QuotaExceededError' })
      data.set(normalizedKey, normalizedValue)
    },
    removeItem(key) { data.delete(String(key)) },
    clear() { data.clear() },
  }

  const state = {
    transactions:[{ id:'old', note:'x'.repeat(500) }],
    wallets:[{ id:'wallet-old' }],
    settings:{},
    marketPrices:{},
  }
  assert.equal(Storage.saveAll(state), true)
  const originalTransactionsRaw = localStorage.getItem('mt_transactions')
  const originalWalletsRaw = localStorage.getItem('mt_wallets')
  const originalMarketPricesRaw = localStorage.getItem('mt_market_prices')
  data.set('mt_local_backup_snapshots', JSON.stringify([
    { id:'newest' },
    { id:'older' },
  ]))
  capacity = totalBytes()

  state.transactions = [{ id:'new' }]
  state.wallets = [{ id:'wallet-new', note:'y'.repeat(400) }]
  state.marketPrices = { note:'z'.repeat(200) }

  assert.equal(Storage.saveAll(state, { dirtyKeys:['transactions','wallets','marketPrices'] }), false)
  assert.equal(localStorage.getItem('mt_transactions'), originalTransactionsRaw)
  assert.equal(localStorage.getItem('mt_wallets'), originalWalletsRaw)
  assert.equal(localStorage.getItem('mt_market_prices'), originalMarketPricesRaw)
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

test('backup normalization drops hostile IDs and executable-looking fields', () => {
  const hostile = "x');globalThis.pwned=true;//"
  const normalized = Storage.normalizeBackupPayload({
    transactions: [
      { id: hostile, amount: 10, action: 'globalThis.pwned=true', onclick: 'alert(1)' },
      { id: 'tx-safe', amount: 20, handler: 'run()', code: 'evil()' },
    ],
    wallets: [{ id: 'wallet-safe', name: 'Cash', open: 'javascript:alert(1)' }],
    categories: {
      expense: [{ id: hostile, label: 'bad' }, { id: 'cat-safe', label: 'safe', onload: 'evil()' }],
      income: [],
    },
  })

  assert.deepEqual(normalized.transactions, [{ id: 'tx-safe', amount: 20 }])
  assert.deepEqual(normalized.wallets, [{ id: 'wallet-safe', name: 'Cash' }])
  assert.deepEqual(normalized.categories.expense, [{ id: 'cat-safe', label: 'safe' }])
  assert.ok(Storage.lastNormalizationWarnings.some(warning => warning.reason === 'invalid-id'))
})
