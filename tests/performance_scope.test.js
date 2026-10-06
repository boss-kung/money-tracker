const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const app = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')

test('reward refresh exposes an affected card/cycle scope instead of requiring every transaction', () => {
  assert.match(app, /App\.getAffectedRewardTransactionIds\s*=\s*function/)
  assert.match(app, /getCyclePeriodForDate\(cardId, effectiveDate, rule\)/)
  assert.match(app, /transactionIds\s*=/)
  assert.match(app, /refreshTransactionRewardEstimates\?\.\(\{\s*transactionIds/)
})

test('transaction save forwards dirty collections after the durable commit seam', () => {
  assert.match(app, /persist\('transaction',\s*\{[\s\S]{0,500}dirtyKeys:/)
  assert.match(app, /dirtyKeys:[^\]]*transactions/)
  assert.match(app, /toast\(isEdit \? 'แก้ไขรายการแล้ว' : 'บันทึกรายการแล้ว', 'success'\)/)
})

test('market sync coalesces idle work and skips unchanged or failed writes', () => {
  assert.match(app, /scheduleIdleMarketSync\s*=\s*function/)
  assert.match(app, /marketDataChanged/)
  assert.match(app, /if \(!marketDataChanged\) return/)
  assert.doesNotMatch(app, /setTimeout\(\(\) => \{\s*try \{ App\.maybeAutoSyncCryptoPrices\?\.\('startup'\)/)
})
