const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')

test('reviewed captures are deterministic, metadata-bearing transactions only after save', () => {
  assert.match(source, /externalCapture/)
  assert.match(source, /shortcut:\$\{[^}]*captureId/)
  assert.match(source, /externalCapture/)
  assert.match(source, /dedupeKey/)
  assert.match(source, /existingCapture[\s\S]{0,700}return false/)
})

test('capture drafts reject recurring/installment fan-out while leaving transfer edits available', () => {
  assert.match(source, /externalCapture[\s\S]{0,500}isRecurring[\s\S]{0,500}isInstallment/)
  assert.match(source, /รายการจาก Shortcut|shortcut capture/i)
  assert.match(source, /transactionClose:\s*'closeAddTx'/)
})

test('existing capture metadata is preserved through cleanTxFromDraft edits', () => {
  const start = source.indexOf('  function cleanTxFromDraft(id)')
  const end = source.indexOf('  App.saveTx = function()', start)
  assert.ok(start >= 0 && end > start)
  const clean = source.slice(start, end)
  assert.match(clean, /existingTx[\s\S]{0,500}externalCapture/)
  assert.match(clean, /externalCapture,?\s*\n?\s*}/)
})

