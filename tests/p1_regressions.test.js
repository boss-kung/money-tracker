const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function loadStorage(localStorage) {
  const source = read('storage_v2.js')
  const context = { localStorage, module: { exports: {} }, setTimeout() {}, console }
  context.window = context
  require('node:vm').runInNewContext(source, context)
  return context.module.exports
}

test('Storage loads readable data when localStorage writes are unavailable', () => {
  const values = new Map([
    ['mt_transactions', JSON.stringify([{ id: 'tx-1' }])],
    ['mt_wallets', JSON.stringify([{ id: 'wallet-1' }])],
  ])
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }) },
    removeItem: key => values.delete(key),
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size },
  }
  const Storage = loadStorage(localStorage)
  assert.equal(Storage.isLocalStorageReadable(), true)
  assert.equal(Storage.isLocalStorageWritable(), false)
  const state = Storage.init()
  assert.equal(JSON.stringify(state.transactions), JSON.stringify([{ id: 'tx-1' }]))
  assert.equal(JSON.stringify(state.wallets), JSON.stringify([{ id: 'wallet-1' }]))
})

test('Storage.saveAll rolls every collection back when one write fails', () => {
  const values = new Map([
    ['mt_transactions', 'old-transactions'],
    ['mt_wallets', 'old-wallets'],
  ])
  let writes = 0
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      writes += 1
      if (writes === 2) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' })
      values.set(key, String(value))
    },
    removeItem: key => values.delete(key),
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size },
  }
  const Storage = loadStorage(localStorage)
  const ok = Storage.saveAll({ transactions: [{ id: 'new' }], wallets: [{ id: 'new-wallet' }] })
  assert.equal(ok, false)
  assert.equal(values.get('mt_transactions'), 'old-transactions')
  assert.equal(values.get('mt_wallets'), 'old-wallets')
})

test('import validation rejects impossible dates, non-finite amounts, and unlinked transfers', () => {
  const source = read('app_v2.js')
  assert.match(source, /isValidImportDate/)
  assert.match(source, /Number\.isFinite\(amount\)/)
  assert.match(source, /transfer.*walletId.*toWalletId/s)
})

test('credit-card payment sources are restricted to money wallets at save time', () => {
  const source = read('app_v2.js')
  assert.match(source, /TRANSFERABLE_MONEY_TYPES|isTransferableMoneyWallet|isCCPaymentSourceWallet/)
  assert.match(source, /isCCPaymentSourceWallet\(source\)/)
})

test('credit-card payment editing must use a dedicated path so discount fields stay consistent', () => {
  const source = read('app_v2.js')
  assert.match(source, /if \(tx\.type === 'cc_payment'\)\s*\{\s*App\.openCCPay\(tx\.toWalletId, tx\.id\)/s)
  assert.match(source, /editingCCPaymentId/)
  assert.match(source, /const editId = S\.editingCCPaymentId/)
  assert.match(source, /const tx = \{[\s\S]{0,120}id: editId \|\| Calc\.genId\(\), type:'cc_payment'/)
  assert.match(source, /if \(!persist\(\)\) \{[\s\S]{0,320}S\.editingCCPaymentId = editId \|\| null/s)
})

test('cloud vault updates use compare-and-swap and do not upsert over a newer row', () => {
  const source = read('auth_sync.js')
  assert.match(source, /method === 'PATCH'/)
  assert.match(source, /data_version=eq\./)
  assert.match(source, /const knownMeta = state\.vaultMeta/)
  assert.match(source, /remote\??\.data_version[\s\S]*knownVersion/s)
  assert.match(source, /!knownMeta \|\| remoteVersion > knownVersion/)
  assert.doesNotMatch(source, /Prefer: method === 'POST' \? 'resolution=merge-duplicates/)
})

test('cloud dirty revision survives reload and is acknowledged only after upload', () => {
  const source = read('auth_sync.js')
  assert.match(source, /localRevision/)
  assert.match(source, /syncedRevision/)
  assert.match(source, /state\.dirtyRevision[\s\S]*localRevision/s)
  assert.match(source, /syncedRevision[\s\S]*uploadRevision/s)
  assert.match(source, /const uploadCompleted = Number\(state\.dirtyRevision \|\| 0\) === uploadRevision/)
  assert.match(source, /acknowledgeDurableRevision\(uploadRevision, \{ dirty: !uploadCompleted \}\)/)
})

test('cloud merge carries loan and BNPL collections', () => {
  const source = read('app_v2.js')
  assert.match(source, /\['transactions'.*'loans'.*'bnplPlans'/s)
})

test('rescue restore preserves loan and BNPL collections', () => {
  const source = read('rescue.html')
  assert.match(source, /mt_loans/)
  assert.match(source, /mt_bnpl_plans/)
  assert.match(source, /loans:\s*'mt_loans'/)
  assert.match(source, /bnplPlans:\s*'mt_bnpl_plans'/)
})

test('cashflow comparison callers pass wallet and loan context', () => {
  const source = read('app_v2.js')
  assert.match(source, /Calc\.getMonthComparison\(S\.transactions, month, \{[\s\S]{0,220}loans:\s*S\.loans/s)
})

test('benefit import deduplicates duplicate drafts within the same card', () => {
  const source = read('app_v2.js')
  assert.match(source, /normalized\.id = genId\(\)[\s\S]{0,100}existingByKey\.set\(key, normalized\)/s)
})

test('device recovery keys are scoped to the signed-in user', () => {
  const source = read('auth_sync.js')
  assert.match(source, /_deviceRecoveryKeyOwnerId/)
  assert.match(source, /JSON\.stringify\(\{ userId: _deviceRecoveryKeyOwnerId, key \}\)/)
  assert.match(source, /_userOwnsRecoveryKey\(stored\.userId\)/)
})

test('export remains available when durable local save fails', () => {
  const source = read('app_v2.js')
  assert.match(source, /const exportOk = Storage\.exportJSON\(S[\s\S]{0,120}preferState: true/)
  assert.doesNotMatch(source, /if \(!saved\) \{[\s\S]{0,180}return\s*\}/)
})

test('emergency export prefers current in-memory auxiliary collections', () => {
  const values = new Map([['mt_loans', JSON.stringify([{ id: 'stale' }])]])
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size },
  }
  const Storage = loadStorage(localStorage)
  const payload = Storage.buildExportPayload({ transactions: [], wallets: [], loans: [{ id: 'current' }] }, { preferState: true })
  assert.deepEqual(payload.loans, [{ id: 'current' }])
})

test('delete-account server verifies a one-time OTP before deleting the user', () => {
  const source = read('supabase/functions/delete-account/index.ts')
  assert.match(source, /otp|otp_hash|expires_at/i)
  assert.match(source, /delete\(\).*mt_delete_otps|from\('mt_delete_otps'\)/s)
  assert.match(source, /admin\.deleteUser/)
})

test('reset state includes every persisted financial collection', () => {
  const source = read('app_v2.js')
  for (const key of ['ccBenefitRules', 'rewardLedger', 'cryptoHoldings', 'cryptoTransactions', 'splitBills', 'loans', 'bnplPlans']) {
    assert.match(source, new RegExp(`${key}\\s*:`), `${key} missing from reset state`)
  }
})
