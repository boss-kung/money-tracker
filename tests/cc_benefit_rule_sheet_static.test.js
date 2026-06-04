const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')

function functionBody(name) {
  const marker = `${name} = function`
  const start = appSource.indexOf(marker)
  assert.notEqual(start, -1, `${name} should exist`)
  const next = appSource.indexOf('\n  App.', start + marker.length)
  assert.notEqual(next, -1, `${name} body should be bounded by the next App function`)
  return appSource.slice(start, next)
}

test('rule transaction sheet uses calendar-month cycles when a benefit rule is calendar based', () => {
  const body = functionBody('App._openRuleTransactionsSheetImpl')

  assert.match(body, /statementCycleHint\s*\|\|\s*'statement_cycle'/)
  assert.match(body, /calendar_month/)
  assert.match(body, /cycle\s*=\s*cycleForRuleSheet/)
})

test('rule transaction sheet records diagnostics without showing the debug evidence section', () => {
  const body = functionBody('App._openRuleTransactionsSheetImpl')

  assert.doesNotMatch(body, /showRuleTransactionDebug\s*=\s*false/)
  assert.match(body, /App\._lastRuleTransactionsDebug\s*=\s*diagnostic/)
  assert.doesNotMatch(appSource, /DEBUG หลักฐานรายการ rule/)
  assert.doesNotMatch(appSource, /คัดลอก debug JSON/)
})

test('rule transaction sheet and diagnostics do not call private benefit amount helper out of scope', () => {
  const sheetBody = functionBody('App._openRuleTransactionsSheetImpl')
  const debugBody = functionBody('App.getBenefitRuleDebugData')

  assert.doesNotMatch(sheetBody, /[^.\w]benefitCalculationAmount\s*\(/)
  assert.doesNotMatch(debugBody, /[^.\w]benefitCalculationAmount\s*\(/)
  assert.match(sheetBody, /calcBenefitAmount\s*=/)
  assert.match(debugBody, /calcBenefitAmount\s*=/)
})
