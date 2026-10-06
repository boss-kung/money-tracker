const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')

function blockBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `missing source marker: ${startMarker}`)
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length
  assert.ok(end > start, `missing end marker for ${startMarker}`)
  return source.slice(start, end)
}

test('shared commitMutation helper rolls back before success callbacks', () => {
  assert.match(source, /function commitMutation\(\{ mutate, rollback, onSuccess \}\)/)
  assert.match(source, /const committed = persist\(\)/)
  assert.match(source, /if \(!committed\)\s*\{[\s\S]*?rollback\?\.\(\)/)
  assert.match(source, /onSuccess\?\.\(\)/)
})

test('recurring and category mutations gate UX on durable commit', () => {
  for (const [start, end] of [
    ['App.saveRecurring = function(id)', 'App.snoozeRecurring = function(id'],
    ['App.snoozeRecurring = function(id', 'App.deleteWallet = function(id'],
    ['saveCategory(id)', 'saveMerchant(id)'],
    ['saveMerchant(id)', 'App.deleteCategory = function(id)'],
    ['App.deleteCategory = function(id)', 'App.unarchiveCategory = function(id)'],
    ['App.unarchiveCategory = function(id)', 'App.maybeShowBackupReminder = function()'],
  ]) {
    const block = blockBetween(start, end)
    assert.match(block, /commitMutation\(/, `${start} must use commitMutation`)
  }
})

test('goal save and archive mutations gate UX on durable commit', () => {
  const save = blockBetween('App.saveGoal = function(goalId = \'\')', 'App.archiveGoal = function(goalId)')
  const archive = blockBetween('App.archiveGoal = function(goalId)', 'App.deleteGoal = function(goalId)')
  assert.match(save, /commitMutation\(/)
  assert.match(archive, /commitMutation\(/)
})

test('wallet, transaction save, and transaction delete flows use the shared commit boundary', () => {
  const wallet = blockBetween('App.saveWallet = function()', 'App.saveCCBenefit = function(id)')
  const saveTx = blockBetween('App.saveTx = function(forceSkipDuplicateCheck)', 'function isValidImportDate')
  const swipeDelete = blockBetween('App._bindTxRows = function(containerId)', '// Touch swipe detection')
  const confirmDelete = blockBetween('App._confirmDeleteTxCore = function()', 'App._deleteTxFromSubCore = function')
  const subDelete = blockBetween('App._deleteTxFromSubCore = function(id', 'App.confirmDeleteTx = function')
  for (const [name, block] of [['wallet', wallet], ['saveTx', saveTx], ['swipe delete', swipeDelete], ['detail delete', confirmDelete], ['sub-screen delete', subDelete]]) {
    assert.match(block, /commitMutation\(/, `${name} must use commitMutation`)
  }
})
