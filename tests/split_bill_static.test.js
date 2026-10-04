const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'split_bill.js'), 'utf8')

test('saving a Split Bill checks durable storage before clearing the draft', () => {
  const start = source.indexOf('App._sbSaveBill = function')
  const body = source.slice(start, source.indexOf('\n  // ── Back helper', start))
  assert.match(body, /const saved\s*=\s*SbStore\.upsertBill\(_draft\)/)
  assert.match(body, /if \(!saved\)/)
  assert.ok(body.indexOf('if (!saved)') < body.indexOf('_clearDraft(false)'))
})

test('Split Bill inline handlers use JavaScript-context-safe arguments for imported ids', () => {
  assert.doesNotMatch(source, /_sbSaveEditPerson\('\$\{esc\(p\.id\)\}'\)/)
  assert.match(source, /_sbSaveEditPerson\(\$\{jsArg\(p\.id\)\}\)/)
  const paymentHandler = source.match(/oninput="App\._fmtNum\(this\);\(function\(v,id\).*?App\._sbUpdatePayRemaining\(\)"/)?.[0] || ''
  assert.match(source, /const jsId\s*=\s*jsArg\(id\)/)
  assert.match(paymentHandler, /this\.value,\$\{jsId\}/)
})

test('Split Bill item editing keeps an original snapshot for cancel', () => {
  assert.match(source, /let _editingItemOriginal\s*=\s*null/)
  assert.match(source, /_editingItemOriginal\s*=\s*clone\(_draft\.items\[i\]\)/)
  assert.match(source, /_editingItemOriginal\s*&&[\s\S]*_draft\.items\[_editingItemIdx\]\s*=\s*_editingItemOriginal/)
})

test('deleting a Split Bill archives it instead of removing history', () => {
  const start = source.indexOf('App._sbDelete = function')
  const body = source.slice(start, source.indexOf('\n  // ══════════════════════════════════════════════════════════════\n  //  WIZARD ENTRY', start))
  assert.match(body, /SbStore\.archiveBill\(billId\)/)
})

test('Split Bill history uses the calculated pipeline total consistently', () => {
  const start = source.indexOf('App.openSplitBillScreen = function')
  const body = source.slice(start, source.indexOf('\n  // ══════════════════════════════════════════════════════════════\n  //  BILL DETAIL', start))
  assert.doesNotMatch(body, /b\.manualTotal\s*>\s*0\s*\?/)
  assert.match(body, /runPipeline\(sub, b\.pipeline, b\.rounding\)\.finalTotal/)
})
