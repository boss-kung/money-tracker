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

function namedFunctionBody(name) {
  const marker = `function ${name}`
  const start = appSource.indexOf(marker)
  assert.notEqual(start, -1, `${name} should exist`)
  const next = appSource.indexOf('\n  function ', start + marker.length)
  assert.notEqual(next, -1, `${name} body should be bounded by the next function`)
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

test('add transaction next-cycle benefit toggle uses the selected rule cycle with a five-day window', () => {
  const body = functionBody('App.getBenefitCycleShiftOption')

  assert.match(body, /resolveBenefitShiftRule\s*\(\s*txDraft\s*\)/)
  assert.match(body, /getOpenCyclePeriodForDate\s*\(\s*cardId\s*,\s*txDate\s*,\s*rule\s*\)/)
  assert.match(body, /shiftDateStr\s*\(\s*nextCycleStart\s*,\s*-5\s*\)/)
  assert.doesNotMatch(body, /shiftDateStr\s*\(\s*nextCycleStart\s*,\s*-3\s*\)/)
})

test('selected benefit estimate starts its cycle from the effective benefit date override', () => {
  const body = functionBody('App.calculateSelectedRewardEstimate')

  assert.match(body, /getCyclePeriodForDate\s*\(\s*card\.id\s*,\s*resolveBenefitTxDate\s*\(\s*txDraft\s*\)\s*\|\|\s*today\(\)\s*,\s*rule\s*\)/)
  assert.doesNotMatch(body, /getCyclePeriodForDate\s*\(\s*card\.id\s*,\s*txDraft\.date\s*\|\|\s*today\(\)\s*,\s*rule\s*\)/)
})

test('cashback benefit rules can round eligible spend down to every-Baht blocks', () => {
  const normalizeBody = namedFunctionBody('normalizeBenefitRule')
  const formBody = functionBody('App._ccbrStep1Html')
  const readBody = functionBody('App._ccbrReadStep')
  const applyBody = functionBody('App.applyBenefitRule')

  assert.match(normalizeBody, /everyBaht:\s*parseRuleNumber\(cashback\.everyBaht,\s*null\)/)
  assert.match(formBody, /id="ccbr-val-every"/)
  assert.match(readBody, /everyBaht:\s*readNum\('ccbr-val-every'\)/)
  assert.match(applyBody, /cashbackBaseAmount\s*=/)
  assert.match(applyBody, /Math\.floor\(eligibleAmount\s*\/\s*cashbackEveryBaht\)\s*\*\s*cashbackEveryBaht/)
  assert.match(applyBody, /cashbackBaseAmount\s*\*\s*\(Number\(cashbackCfg\.rate\s*\|\|\s*0\)\s*\/\s*100\)/)
})

test('cycle-spend-threshold cashback only rewards newly crossed blocks, not every tx after the first crossing', () => {
  const applyBody = functionBody('App.applyBenefitRule')

  // "every_threshold" must count only the NEW blocks crossed by this tx (delta), not the
  // cumulative total — otherwise every later tx keeps re-earning the reward once cumulative
  // spend first passes the threshold (e.g. a "5,000 per 10,000 baht, max 2,000 per cycle" rule
  // would hit its cap after ~20,000 baht of spend instead of the intended 100,000 baht).
  assert.match(applyBody, /Math\.floor\(cycleSpendAfter\s*\/\s*thresholdAmount\)\s*-\s*Math\.floor\(cycleSpendBefore\s*\/\s*thresholdAmount\)/)
  // "once_per_cycle" must only fire on the tx that actually crosses the threshold, not on
  // every subsequent tx once cumulative spend is already above it.
  assert.match(applyBody, /cycleSpendBefore\s*<\s*thresholdAmount\s*&&\s*cycleSpendAfter\s*>=\s*thresholdAmount/)
  // Fixed cashback must scale with the number of blocks this tx actually crossed.
  assert.match(applyBody, /Number\(cashbackCfg\.fixedAmount\s*\|\|\s*0\)\s*\*\s*triggerCount/)
})
