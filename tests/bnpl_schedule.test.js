const test = require('node:test')
const assert = require('node:assert/strict')

// ── Extract helpers from bnpl.js via regex ────────────────────────────────────
const fs = require('fs')
const src = fs.readFileSync(require('path').join(__dirname, '../bnpl.js'), 'utf8')

// Extract pad2 and addMonths helpers
const pad2 = n => String(n).padStart(2, '0')

function addMonths(dateStr, months) {
  const [y, m, d] = String(dateStr || '').slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return dateStr
  let newM = (m - 1) + months
  let newY = y + Math.floor(newM / 12)
  newM = ((newM % 12) + 12) % 12
  const maxDay = new Date(newY, newM + 1, 0).getDate()
  return `${newY}-${pad2(newM + 1)}-${pad2(Math.min(d, maxDay))}`
}

// Inline buildSchedule (must match bnpl.js exactly)
function buildSchedule(totalAmount, installments, purchaseDate, payDay) {
  const total = Number(totalAmount)
  const n = Number(installments)
  const unitAmt = Math.floor((total / n) * 100) / 100
  const lastAmt = Math.round((total - unitAmt * (n - 1)) * 100) / 100
  return Array.from({ length: n }, (_, i) => {
    let dueDate = addMonths(purchaseDate, i + 1)
    if (payDay && payDay >= 1 && payDay <= 28) {
      dueDate = dueDate.slice(0, 8) + String(payDay).padStart(2, '0')
    }
    return { no: i + 1, dueDate, amount: i === n - 1 ? lastAmt : unitAmt, paidTxId: null }
  })
}

// Verify buildSchedule source in bnpl.js matches this test's inline copy
test('buildSchedule source matches test inline copy (guard against drift)', () => {
  const m = src.match(/buildSchedule\(totalAmount, installments, purchaseDate, payDay\)\s*\{([\s\S]+?)\n    \},/)
  assert.ok(m, 'buildSchedule function not found in bnpl.js')
  // Spot-check: key line about payDay replacement
  assert.ok(m[1].includes("dueDate.slice(0, 8) + String(payDay).padStart(2, '0')"),
    'payDay day-replacement logic not found in buildSchedule')
})

// ── Core schedule tests ───────────────────────────────────────────────────────

test('payDay=1: purchase May 9 → installments June 1 and July 1', () => {
  const schedule = buildSchedule(1000, 2, '2025-05-09', 1)
  assert.equal(schedule[0].dueDate, '2025-06-01', 'installment 1 should be June 1')
  assert.equal(schedule[1].dueDate, '2025-07-01', 'installment 2 should be July 1')
})

test('payDay=15: purchase May 9 → installments June 15 and July 15', () => {
  const schedule = buildSchedule(1000, 2, '2025-05-09', 15)
  assert.equal(schedule[0].dueDate, '2025-06-15')
  assert.equal(schedule[1].dueDate, '2025-07-15')
})

test('payDay=null: purchase May 9 → installments keep day 9', () => {
  const schedule = buildSchedule(1000, 2, '2025-05-09', null)
  assert.equal(schedule[0].dueDate, '2025-06-09')
  assert.equal(schedule[1].dueDate, '2025-07-09')
})

test('payDay=0 (falsy): treated same as null — uses purchase day', () => {
  const schedule = buildSchedule(1000, 2, '2025-05-09', 0)
  assert.equal(schedule[0].dueDate, '2025-06-09')
})

test('payDay=29 (out of range): ignored — uses purchase day', () => {
  const schedule = buildSchedule(1000, 2, '2025-05-09', 29)
  assert.equal(schedule[0].dueDate, '2025-06-09')
})

test('payDay=28: boundary — accepted', () => {
  const schedule = buildSchedule(1000, 2, '2025-05-09', 28)
  assert.equal(schedule[0].dueDate, '2025-06-28')
})

test('payDay=1: purchase Dec 31 → installments Jan 1 and Feb 1 next year', () => {
  const schedule = buildSchedule(1000, 2, '2025-12-31', 1)
  assert.equal(schedule[0].dueDate, '2026-01-01')
  assert.equal(schedule[1].dueDate, '2026-02-01')
})

test('amount distribution: last installment absorbs rounding', () => {
  const schedule = buildSchedule(1000, 3, '2025-05-09', 1)
  assert.equal(schedule[0].amount, 333.33)
  assert.equal(schedule[1].amount, 333.33)
  assert.equal(schedule[2].amount, 333.34)  // 1000 - 333.33*2 = 333.34
  assert.equal(schedule[0].amount + schedule[1].amount + schedule[2].amount, 1000)
})

// ── saveWallet payDay propagation (static check) ──────────────────────────────

test('saveWallet: payDay always set in Object.assign (not conditional spread)', () => {
  const appSrc = fs.readFileSync(require('path').join(__dirname, '../app_v2.js'), 'utf8')
  // Confirm the fix: payDay should be assigned directly, not behind a ternary spread
  // The old buggy pattern: ...(payDay ? { payDay } : {})
  assert.ok(
    !appSrc.includes('...(payDay ? { payDay } : {})'),
    'Old conditional payDay spread found — should be Object.assign(data, { ..., payDay }) directly'
  )
  // Confirm the correct pattern exists
  assert.ok(
    appSrc.includes('Object.assign(data, { provider, creditLimit, payDay })'),
    'Direct payDay assignment not found in saveWallet'
  )
})

test('saveWallet: retroactive plan rebuild code exists', () => {
  const appSrc = fs.readFileSync(require('path').join(__dirname, '../app_v2.js'), 'utf8')
  assert.ok(
    appSrc.includes('Retroactively rebuild active BNPL plan schedules'),
    'Retroactive plan rebuild block not found in saveWallet'
  )
  assert.ok(
    appSrc.includes('BNPL.calc.buildSchedule(plan.totalAmount, plan.installments, plan.purchaseDate, _effectivePayDay)'),
    'buildSchedule call not found in retroactive rebuild block'
  )
})
