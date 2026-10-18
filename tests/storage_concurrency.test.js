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

function state(transactions) {
  return { transactions, wallets: [], settings: {} }
}

test('rejects a stale tab save and preserves the newer persisted snapshot', () => {
  const localStorage = fakeLocalStorage()
  const firstTab = loadStorage(localStorage)
  const staleTab = loadStorage(localStorage)

  firstTab.init()
  staleTab.init()

  assert.equal(firstTab.stateRevision, 0)
  assert.equal(staleTab.stateRevision, 0)
  assert.equal(firstTab.saveAll(state([{ id: 'from-tab-A' }])), true)
  assert.equal(staleTab.saveAll(state([{ id: 'from-tab-B' }])), false)
  assert.deepEqual(JSON.parse(localStorage.getItem('mt_transactions')), [{ id: 'from-tab-A' }])
  assert.equal(staleTab.lastConflict?.expectedRevision, 0)
  assert.equal(staleTab.lastConflict?.actualRevision, 1)
})

test('increments the local revision once for each successful snapshot commit', () => {
  const localStorage = fakeLocalStorage()
  const storage = loadStorage(localStorage)
  storage.init()

  assert.equal(storage.saveAll(state([{ id: 'first' }])), true)
  assert.equal(storage.stateRevision, 1)
  assert.equal(JSON.parse(localStorage.getItem('mt_state_meta')).revision, 1)

  assert.equal(storage.saveAll(state([{ id: 'second' }])), true)
  assert.equal(storage.stateRevision, 2)
  assert.equal(JSON.parse(localStorage.getItem('mt_state_meta')).revision, 2)
})

test('persist exposes a specific stale-tab recovery message', () => {
  assert.match(appSource, /ข้อมูลถูกแก้ไขจากแท็บอื่น/)
})
