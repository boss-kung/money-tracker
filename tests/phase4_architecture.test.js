const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')

test('saveTx owns duplicate and double-submit guards instead of a wrapper patch', () => {
  const start = source.indexOf('  App.saveTx = function(forceSkipDuplicateCheck)')
  const end = source.indexOf('  function isValidImportDate(', start)
  assert.ok(start >= 0 && end > start, 'saveTx implementation section missing')
  const block = source.slice(start, end)

  assert.doesNotMatch(source, /const _prevSaveTx = App\.saveTx\?\./)
  assert.match(block, /App\._txSaveInProgress/)
  assert.match(block, /App\._detectDuplicateTx/)
  assert.match(block, /forceSkipDuplicateCheck/)
})

test('report views register extensions instead of replacing renderReports', () => {
  assert.doesNotMatch(source, /const _prevRenderReports = App\.renderReports\?\./)
  assert.match(source, /_reportViewExtensions/)
  assert.match(source, /_reportViewExtensions\.trend/)
  assert.match(source, /_reportViewExtensions\.calendar/)
})

test('delete flows use one dispatcher with ordered feature middleware', () => {
  assert.equal((source.match(/App\.confirmDeleteTx\s*=/g) || []).length, 1)
  assert.equal((source.match(/App\.deleteTxFromSub\s*=/g) || []).length, 1)
  assert.match(source, /App\._deleteTxMiddleware/)
  assert.match(source, /registerDeleteTxMiddleware\?\.\('confirm', 'upcoming-bill'/)
  assert.match(source, /registerDeleteTxMiddleware\?\.\('confirm', 'delete-row-animation'/)
  assert.match(source, /registerDeleteTxMiddleware\?\.\('confirm', 'shared-reimbursement'/)
  assert.doesNotMatch(source, /prevConfirmDeleteTx|prevDeleteTxFromSub|_origConfirmDelete|prevConfirmDeleteShared|prevDeleteTxFromSubShared/)
})

test('financial position delegates liability composition to Ledger', () => {
  const start = source.indexOf('  App.getFinancialPosition = function()')
  const end = source.indexOf('\n  Calc.getNetWorth = function()', start)
  assert.ok(start >= 0 && end > start, 'financial-position adapter section missing')
  const block = source.slice(start, end)

  assert.match(block, /transactions:S\.transactions \|\| \[\]/)
  assert.match(block, /rewardForTx:/)
  assert.doesNotMatch(block, /getCommittedInstallmentDebt/)
})

test('persist migration state uses one canonical before-commit hook', () => {
  assert.equal((source.match(/App\._beforePersistV50\s*=\s*function/g) || []).length, 1)
  const start = source.indexOf('  App._beforePersistV50 = function()')
  const end = source.indexOf('\n  // ──', start)
  assert.ok(start >= 0 && end > start, 'canonical persist hook section missing')
  const block = source.slice(start, end)
  assert.match(block, /migrateToV5\(\)/)
  assert.match(block, /ensureUpcomingBillsState\(\)/)
})

test('demo disables service worker registration for its relative asset root', () => {
  const demoSource = fs.readFileSync(path.join(__dirname, '..', 'demo', 'demo_bootstrap.js'), 'utf8')
  assert.match(demoSource, /MT_DEBUG_FLAGS/)
  assert.match(demoSource, /noServiceWorker:\s*true/)
})
