const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const core = require('../shortcut_profile_core.js')

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/shortcut_profile_cases.json'), 'utf8'))
const rule = {
  format_version: 1,
  variants: [
    { id: 'purchase', direction: 'debit', mustContain: ['uchoose', 'ซื้อสินค้า'], mustNotContain: ['otp'], amount: { before: 'จำนวน ', after: ' thb', occurrence: 1, valueType: 'thb_amount', maxLength: 32 }, date: { before: 'วันที่ ', after: ' เวลา', occurrence: 1, valueType: 'date', maxLength: 16 }, merchant: { before: 'ร้าน ', after: ' จำนวน', occurrence: 1, valueType: 'text', maxLength: 64 } },
    { id: 'refund', direction: 'credit', mustContain: ['uchoose', 'คืนเงิน'], mustNotContain: ['otp'], amount: { before: 'จำนวน ', after: ' thb', occurrence: 1, valueType: 'thb_amount', maxLength: 32 }, date: { before: 'วันที่ ', after: ' เวลา', occurrence: 1, valueType: 'date', maxLength: 16 } },
  ],
}

test('browser matcher matches the shared synthetic complete and review cases', () => {
  assert.equal(core.matchProfileRule(rule, fixture.purchase.text).status, 'complete')
  assert.equal(core.matchProfileRule(rule, fixture.refund.text).status, 'complete')
  assert.equal(core.matchProfileRule(rule, fixture.ignored.text).status, 'ignored')
  assert.equal(core.matchProfileRule(rule, fixture.incomplete.text).status, 'needs_review')
})

test('candidate detector exposes indexed fields without persisting sample text', () => {
  const candidates = core.detectProfileCandidates(fixture.purchase.text)
  assert.ok(candidates.some(item => item.type === 'thb_amount'))
  assert.ok(candidates.some(item => item.type === 'date'))
  assert.ok(candidates.every(item => item.id && Number.isInteger(item.start) && Number.isInteger(item.end)))
  const compiled = core.compileProfileVariantRule({ id: 'purchase', direction: 'debit', samples: [fixture.purchase.text, fixture.purchase.text.replace('120.50', '80.00')], selections: [{ amount: 0 }, { amount: 0 }], mustContain: ['uchoose'] })
  assert.equal(compiled.format_version, 1)
  assert.equal(JSON.stringify(compiled).includes(fixture.purchase.text), false)
})

test('profile core is local-only and never references persistence or network APIs', () => {
  const source = fs.readFileSync(path.join(__dirname, '../shortcut_profile_core.js'), 'utf8')
  assert.doesNotMatch(source, /fetch|localStorage|sessionStorage|clipboard|analytics/i)
})
