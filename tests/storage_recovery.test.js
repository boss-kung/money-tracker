const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'storage_v2.js'), 'utf8')
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')

function fakeLocalStorage() {
  const values = new Map()
  return {
    get length() { return values.size },
    key(index) { return [...values.keys()][index] ?? null },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null },
    setItem(key, value) { values.set(String(key), String(value)) },
    removeItem(key) { values.delete(String(key)) },
    clear() { values.clear() },
  }
}

function loadStorage(localStorage) {
  const context = {
    localStorage,
    module: { exports: {} },
    setTimeout() {},
    console,
  }
  vm.runInNewContext(source, context)
  return context.module.exports
}

function state(transactions = []) {
  return { transactions, wallets: [], settings: {} }
}

test('quarantines corrupt JSON and blocks ordinary writes without changing the raw value', () => {
  const localStorage = fakeLocalStorage()
  const corruptRaw = '{corrupt-json'
  localStorage.setItem('mt_transactions', corruptRaw)
  const Storage = loadStorage(localStorage)

  const hydrated = Storage.init()

  assert.equal(JSON.stringify(hydrated.transactions), '[]')
  assert.equal(localStorage.getItem('mt_transactions'), corruptRaw)
  assert.equal(Storage.hydrationStatus.recoveryMode, true)
  assert.equal(JSON.stringify(Storage.hydrationStatus.corruptCollections), '["transactions"]')
  assert.ok(localStorage.getItem(Storage.hydrationStatus.quarantineKey))
  assert.equal(Storage.saveAll(state([{ id: 'must-not-overwrite' }])), false)
  assert.equal(localStorage.getItem('mt_transactions'), corruptRaw)
})

test('only an explicit recovery write can replace corrupt data', () => {
  const localStorage = fakeLocalStorage()
  const corruptRaw = '{corrupt-json'
  localStorage.setItem('mt_transactions', corruptRaw)
  const Storage = loadStorage(localStorage)
  Storage.init()

  assert.equal(Storage.beginRecoveryWrite(), true)
  assert.equal(Storage.saveAll(state([{ id: 'restored' }])), true)
  assert.equal(Storage.endRecoveryWrite(true), true)
  assert.equal(Storage.hydrationStatus.recoveryMode, false)
  assert.deepEqual(JSON.parse(localStorage.getItem('mt_transactions')), [{ id: 'restored' }])
})

test('a failed recovery write keeps recovery mode active and preserves corrupt bytes', () => {
  const localStorage = fakeLocalStorage()
  const corruptRaw = '{corrupt-json'
  localStorage.setItem('mt_transactions', corruptRaw)
  const Storage = loadStorage(localStorage)
  Storage.init()

  const originalSetItem = localStorage.setItem
  let rejectWallet = true
  localStorage.setItem = (key, value) => {
    if (key === 'mt_wallets' && rejectWallet) {
      rejectWallet = false
      throw new Error('write rejected')
    }
    originalSetItem.call(localStorage, key, value)
  }

  assert.equal(Storage.beginRecoveryWrite(), true)
  assert.equal(Storage.saveAll(state([{ id: 'not-durable' }])), false)
  assert.equal(Storage.endRecoveryWrite(false), false)
  assert.equal(Storage.hydrationStatus.recoveryMode, true)
  assert.equal(localStorage.getItem('mt_transactions'), corruptRaw)
})

test('boot skips billing hydration persistence while recovery mode is active', () => {
  assert.match(appSource, /if \(!Storage\.hydrationStatus\?\.recoveryMode\)\s*\{\s*persist\('billing-hydration'\)/s)
})

test('app exposes a visible storage recovery notice', () => {
  assert.match(appSource, /mt-storage-recovery-notice/)
  assert.match(appSource, /ข้อมูลบางส่วนอ่านไม่ได้/)
})

test('reset is explicitly authorized as a recovery write', () => {
  assert.match(appSource, /Storage\.reset\(\{\s*allowRecovery:\s*true\s*\}\)/)
})

test('backup restore explicitly authorizes recovery writes and aborts on persistence failure', () => {
  assert.match(appSource, /Storage\.beginRecoveryWrite\(\)/)
  assert.match(appSource, /Storage\.endRecoveryWrite\(false\)/)
})
