const test = require('node:test')
const assert = require('node:assert/strict')
const Ask = require('../ask_my_money_core.js')

test('parses shared finance and follow-up comparison intents', () => {
  assert.equal(Ask.parseIntent('การเงินร่วม'), 'shared_finance')
  assert.equal(Ask.parseIntent('แล้วเทียบเดือนก่อนล่ะ', { lastIntent:'expense' }), 'comparison')
})

test('parses month and forecast ranges', () => {
  const opts = {
    now: () => '2026-05',
    prevMonth: () => '2026-04',
    monthLabel: m => m,
    getMonths: n => Array.from({ length:n }, (_, i) => `m${i}`),
  }
  assert.deepEqual(Ask.parseRange('เดือนก่อนใช้เท่าไร', opts), { kind:'month', month:'2026-04', label:'เดือน2026-04' })
  assert.equal(Ask.parseRange('เงินพอถึงสิ้นเดือนไหม', opts).kind, 'forecast')
})
