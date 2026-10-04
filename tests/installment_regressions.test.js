const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const appSource = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')

function loadBNPL() {
  delete require.cache[require.resolve('../bnpl.js')]
  return require('../bnpl.js')
}

test('BNPL normalizes only finite integer installment counts', () => {
  const BNPL = loadBNPL()
  assert.equal(BNPL.calc.normalizeInstallments(15, 2), 15)
  assert.equal(BNPL.calc.normalizeInstallments('03', 2), 3)
  assert.equal(BNPL.calc.normalizeInstallments('', 2), null)
  assert.equal(BNPL.calc.normalizeInstallments(2.5, 2), null)
  assert.equal(BNPL.calc.normalizeInstallments('not-a-number', 2), null)
})

test('BNPL buildSchedule rejects a fractional installment count', () => {
  const BNPL = loadBNPL()
  assert.deepEqual(BNPL.calc.buildSchedule(1000, 2.5, '2026-01-01', null), [])
})

test('BNPL createPlan rejects invalid installment counts without mutating state', () => {
  const previousState = global.S
  global.S = { wallets:[{ id:'bnpl', type:'bnpl', payDay:null }], bnplPlans:[] }
  try {
    const BNPL = loadBNPL()
    const result = BNPL.store.createPlan({
      walletId:'bnpl', txId:'purchase', merchant:'Test', purchaseDate:'2026-01-01',
      totalAmount:1000, installments:2.5,
    }, { save:false })
    assert.deepEqual(result, { error:'invalid_installments' })
    assert.deepEqual(global.S.bnplPlans, [])
  } finally {
    global.S = previousState
  }
})

test('BNPL updatePlan rejects fractional installment counts', () => {
  const previousState = global.S
  global.S = { wallets:[{ id:'bnpl', type:'bnpl', payDay:null }], bnplPlans:[] }
  try {
    const BNPL = loadBNPL()
    const created = BNPL.store.createPlan({
      walletId:'bnpl', txId:'purchase', merchant:'Test', purchaseDate:'2026-01-01',
      totalAmount:1000, installments:3,
    }, { save:false })
    const result = BNPL.store.updatePlan(created.id, { installments:2.5 })
    assert.deepEqual(result, { error:'invalid_installments' })
    assert.equal(global.S.bnplPlans[0].installments, 3)
  } finally {
    global.S = previousState
  }
})

test('BNPL custom installment input does not rerender the detail form on every key', () => {
  assert.doesNotMatch(
    appSource,
    /placeholder="หรือกรอกจำนวนงวดเอง"[^\n]*oninput="[^"]*App\._renderAddTxDetail\(\)"/,
    'custom BNPL input must keep its DOM node while the user types'
  )
})

test('transaction save validates manual credit-card installment counts', () => {
  assert.match(appSource, /App\._normalizeInstallmentCount\s*=\s*function/)
  assert.match(appSource, /(?:draft|tx)\.isInstallment[\s\S]{0,500}กรุณาระบุจำนวนงวดเป็นจำนวนเต็มอย่างน้อย 2 งวด/)
})

test('BNPL wallet payday changes use payment-preserving schedule rebuilds', () => {
  assert.match(appSource, /BNPL\.calc\.rebuildSchedulePreservingPayments\(/)
  assert.doesNotMatch(
    appSource,
    /BNPL\.calc\.buildSchedule\(plan\.totalAmount, plan\.installments, plan\.purchaseDate, _effectivePayDay\)/,
    'wallet edits must not rebuild from the full principal while keeping old paid rows'
  )
})

test('data health checks installment group completeness and totals', () => {
  assert.match(appSource, /const installmentGroups = new Map\(\)/)
  assert.match(appSource, /installmentGroups\.forEach\(/)
  assert.match(appSource, /installment group .*duplicate installmentNo/i)
  assert.match(appSource, /installment group .*total mismatch/i)
})

test('JSON import rejects malformed installment metadata', () => {
  assert.match(appSource, /if \(t\.isInstallment\) \{[\s\S]{0,900}installmentGroupId/)
  assert.match(appSource, /ข้ามรายการผ่อนที่มี metadata ไม่ครบถ้วน/)
})

test('CSV export includes installment metadata needed to audit schedules', () => {
  assert.match(appSource, /'installmentGroupId','installmentNo','installmentMonths','installmentTotalAmount','isInstallment'/)
  assert.match(appSource, /t\.installmentMonths \|\| ''/)
  assert.match(appSource, /t\.installmentTotalAmount \|\| ''/)
})

test('demo loads BNPL logic so its installment flow matches production', () => {
  const demoSource = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8')
  assert.match(demoSource, /<script src="\.\.\/bnpl\.js[^>]*><\/script>/)
})
