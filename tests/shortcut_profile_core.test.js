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

test('amount candidates mark currency-confirmed values and date/time overlaps without changing indexed ids', () => {
  const text = fixture.purchase.text
  const candidates = core.detectProfileAmountCandidates(text)
  const confirmed = candidates.filter(item => item.currencyConfirmed)
  assert.equal(confirmed.length, 1)
  assert.match(confirmed[0].value, /120\.50/)
  assert.ok(confirmed[0].id)
  assert.ok(candidates.some(item => item.overlapsDateOrTime))
  assert.ok(candidates.every(item => Number.isInteger(item.start) && Number.isInteger(item.end)))
})

test('draft validation requires explicit direction, shared required phrase, and selected amounts', () => {
  const samples = [fixture.purchase.text, fixture.purchase.text.replace('120.50', '80.00')]
  const amountSelections = samples.map(sample => core.detectProfileAmountCandidates(sample).find(item => item.currencyConfirmed)?.id)
  const valid = core.validateProfileDraft({ appLabel: 'UCHOOSE', samples, direction: 'debit', amountSelections, mustContain: ['UCHOOSE'], mustNotContain: [] })
  assert.equal(valid.valid, true)
  assert.deepEqual(valid.errors, {})

  const missingDirection = core.validateProfileDraft({ appLabel: 'UCHOOSE', samples, direction: null, amountSelections, mustContain: ['UCHOOSE'], mustNotContain: [] })
  assert.equal(missingDirection.valid, false)
  assert.equal(missingDirection.errors.direction, 'เลือกทิศทางรายการ')

  const nonSharedAnchor = core.validateProfileDraft({ appLabel: 'UCHOOSE', samples, direction: 'debit', amountSelections, mustContain: ['ไม่อยู่ในทั้งสองตัวอย่าง'], mustNotContain: [] })
  assert.equal(nonSharedAnchor.valid, false)
  assert.equal(nonSharedAnchor.errors.mustContain, 'คำที่ต้องมีต้องพบในตัวอย่างทั้งสองรายการ')
})

test('draft validation enforces the 32,768 UTF-16-unit sample limit and rejects duplicate samples', () => {
  const base = 'UCHOOSE จำนวน 1 THB '
  const atLimit = `${base}${'x'.repeat(32768 - base.length)}`
  const overLimit = `${base}${'x'.repeat(32769 - base.length)}`
  const amountSelections = [atLimit, atLimit].map(sample => core.detectProfileAmountCandidates(sample).find(item => item.currencyConfirmed)?.id)
  const boundary = core.validateProfileDraft({ appLabel: 'UCHOOSE', samples: [atLimit, atLimit.replace('จำนวน 1', 'จำนวน 2')], direction: 'debit', amountSelections, mustContain: ['UCHOOSE'], mustNotContain: [] })
  assert.equal(boundary.valid, true)
  const duplicate = core.validateProfileDraft({ appLabel: 'UCHOOSE', samples: [atLimit, atLimit], direction: 'debit', amountSelections, mustContain: ['UCHOOSE'], mustNotContain: [] })
  assert.equal(duplicate.errors.samples, 'ตัวอย่างแจ้งเตือนต้องไม่เหมือนกัน')

  const tooLong = core.validateProfileDraft({ appLabel: 'UCHOOSE', samples: [overLimit, atLimit], direction: 'debit', amountSelections: [null, amountSelections[1]], mustContain: ['UCHOOSE'], mustNotContain: [] })
  assert.equal(tooLong.valid, false)
  assert.equal(tooLong.errors.sample_0, 'ตัวอย่างยาวเกิน 32,768 ตัวอักษร')
})
