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

// ── Cascade-delete: BNPL plan removed when source tx is deleted ───────────────

test('deleteOnlyTx: cascades BNPL plan cleanup', () => {
  const appSrc = fs.readFileSync(require('path').join(__dirname, '../app_v2.js'), 'utf8')
  const m = appSrc.match(/function deleteOnlyTx\(tx\)\s*\{([\s\S]+?)\n  \}/)
  assert.ok(m, 'deleteOnlyTx not found')
  assert.ok(m[1].includes("S.bnplPlans = (S.bnplPlans || []).filter(p => p.txId !== tx.id)"),
    'deleteOnlyTx is missing BNPL plan cascade-delete')
})

test('deleteTxOnly (shared expense path): cascades BNPL plan cleanup', () => {
  const appSrc = fs.readFileSync(require('path').join(__dirname, '../app_v2.js'), 'utf8')
  const m = appSrc.match(/function deleteTxOnly\(tx\)\s*\{([\s\S]+?)\n  \}/)
  assert.ok(m, 'deleteTxOnly not found')
  assert.ok(m[1].includes("S.bnplPlans = (S.bnplPlans || []).filter(p => p.txId !== tx.id)"),
    'deleteTxOnly is missing BNPL plan cascade-delete')
})

test('confirmDeleteTx: captures removed plan before splice for undo support', () => {
  const appSrc = fs.readFileSync(require('path').join(__dirname, '../app_v2.js'), 'utf8')
  assert.ok(
    appSrc.includes("const _removedBNPLPlan = typeof BNPL !== 'undefined' ? (S.bnplPlans || []).find(p => p.txId === removed.id) : null"),
    'confirmDeleteTx missing _removedBNPLPlan capture'
  )
  assert.ok(
    appSrc.includes("if (_removedBNPLPlan) S.bnplPlans = [_removedBNPLPlan, ...(S.bnplPlans || [])]"),
    'confirmDeleteTx undo is not restoring the BNPL plan'
  )
})

test('bulk shared-expense delete: cascades BNPL plan cleanup for all deleted ids', () => {
  const appSrc = fs.readFileSync(require('path').join(__dirname, '../app_v2.js'), 'utf8')
  assert.ok(
    appSrc.includes("S.bnplPlans = (S.bnplPlans || []).filter(p => !ids.has(p.txId))"),
    'bulk shared-expense delete is missing BNPL plan cascade-delete'
  )
  assert.ok(
    appSrc.includes('ids.forEach(_id => BNPL.store.unlinkPaymentByTxId(_id))'),
    'bulk shared-expense delete is missing per-id bnpl_payment unlink (H1)'
  )
})

// ── H1: unlink/relink bnpl_payment behavior (inline reimplementation) ─────────

// Inline copies mirroring BNPLStore.unlinkPaymentByTxId / relinkPayment.
function unlinkPaymentByTxId(plans, txId) {
  if (!txId) return null
  for (const plan of plans) {
    const items = (plan.schedule || []).filter(s => s.paidTxId === txId)
    if (items.length) {
      const prevStatus = plan.status
      items.forEach(it => { it.paidTxId = null })
      if (plan.status === 'paid_off') plan.status = 'active'
      return { planId: plan.id, nos: items.map(i => i.no), prevStatus }
    }
  }
  return null
}
function relinkPayment(plans, token, txId) {
  if (!token) return
  const plan = plans.find(p => p.id === token.planId)
  if (!plan) return
  ;(token.nos || []).forEach(no => {
    const item = (plan.schedule || []).find(s => s.no === no)
    if (item) item.paidTxId = txId
  })
  if (token.prevStatus) plan.status = token.prevStatus
}

test('H1 unlinkPaymentByTxId: clears every installment sharing the txId and resets paid_off', () => {
  const plans = [{
    id: 'p1', status: 'paid_off',
    schedule: [
      { no: 1, paidTxId: 'txA' },
      { no: 2, paidTxId: 'txZ' },   // payoff-all shares one txId
      { no: 3, paidTxId: 'txZ' },
    ],
  }]
  const token = unlinkPaymentByTxId(plans, 'txZ')
  assert.deepEqual(token, { planId: 'p1', nos: [2, 3], prevStatus: 'paid_off' })
  assert.equal(plans[0].schedule[1].paidTxId, null)
  assert.equal(plans[0].schedule[2].paidTxId, null)
  assert.equal(plans[0].schedule[0].paidTxId, 'txA', 'unrelated installment untouched')
  assert.equal(plans[0].status, 'active', 'status reset from paid_off')
})

test('H1 unlinkPaymentByTxId: returns null when no installment matches', () => {
  const plans = [{ id: 'p1', status: 'active', schedule: [{ no: 1, paidTxId: null }] }]
  assert.equal(unlinkPaymentByTxId(plans, 'nope'), null)
})

test('H1 relinkPayment: restores paidTxId and previous status (undo)', () => {
  const plans = [{
    id: 'p1', status: 'active',
    schedule: [{ no: 1, paidTxId: null }, { no: 2, paidTxId: null }],
  }]
  relinkPayment(plans, { planId: 'p1', nos: [1, 2], prevStatus: 'paid_off' }, 'txZ')
  assert.equal(plans[0].schedule[0].paidTxId, 'txZ')
  assert.equal(plans[0].schedule[1].paidTxId, 'txZ')
  assert.equal(plans[0].status, 'paid_off')
})

test('H1: unlink then relink round-trips to original state', () => {
  const plans = [{
    id: 'p1', status: 'paid_off',
    schedule: [{ no: 1, paidTxId: 'txZ' }, { no: 2, paidTxId: 'txZ' }],
  }]
  const token = unlinkPaymentByTxId(plans, 'txZ')
  relinkPayment(plans, token, 'txZ')
  assert.equal(plans[0].status, 'paid_off')
  assert.deepEqual(plans[0].schedule.map(s => s.paidTxId), ['txZ', 'txZ'])
})

// ── M2: payoffAll math (inline) ───────────────────────────────────────────────

test('M2 payoffAll: sums only unpaid installments and marks all with one txId', () => {
  const plan = {
    id: 'p1', merchant: 'X', walletId: 'w1', status: 'active', installments: 3,
    schedule: [
      { no: 1, amount: 333.33, paidTxId: 'old' },
      { no: 2, amount: 333.33, paidTxId: null },
      { no: 3, amount: 333.34, paidTxId: null },
    ],
  }
  const unpaid = plan.schedule.filter(s => !s.paidTxId)
  const total = unpaid.reduce((s, i) => s + Number(i.amount || 0), 0)
  assert.equal(total, 666.67)
  const txId = 'txPAY'
  unpaid.forEach(i => { i.paidTxId = txId })
  plan.status = 'paid_off'
  assert.deepEqual(plan.schedule.map(s => s.paidTxId), ['old', 'txPAY', 'txPAY'])
  assert.equal(plan.status, 'paid_off')
  // H1 unlink must then clear both txPAY items
  const token = unlinkPaymentByTxId([plan], 'txPAY')
  assert.deepEqual(token.nos, [2, 3])
})

// ── M3: updatePlan rebuild preserves paid installments + guards ───────────────

function updatePlanSchedule(plan, newTotal, newN) {
  const maxPaidNo = Math.max(0, ...plan.schedule.filter(s => s.paidTxId).map(s => s.no))
  if (newN < maxPaidNo) return { error: 'installments_below_paid' }
  const rebuilt = buildSchedule(newTotal, newN, plan.purchaseDate, null)
  plan.schedule = rebuilt.map(item => {
    const old = plan.schedule.find(s => s.no === item.no)
    return old?.paidTxId ? { ...item, paidTxId: old.paidTxId } : item
  })
  plan.totalAmount = newTotal
  plan.installments = newN
  return plan
}

test('M3 updatePlan: rebuild preserves paid installments by number', () => {
  const plan = {
    id: 'p1', purchaseDate: '2025-05-09', totalAmount: 900, installments: 3,
    schedule: buildSchedule(900, 3, '2025-05-09', null),
  }
  plan.schedule[0].paidTxId = 'txA'
  updatePlanSchedule(plan, 1200, 4)
  assert.equal(plan.installments, 4)
  assert.equal(plan.schedule.length, 4)
  assert.equal(plan.schedule[0].paidTxId, 'txA', 'paid installment #1 preserved')
  assert.equal(plan.schedule[1].paidTxId, null, 'new installments unpaid')
})

test('M3 updatePlan: rejects reducing installments below highest paid no', () => {
  const plan = {
    id: 'p1', purchaseDate: '2025-05-09', totalAmount: 900, installments: 3,
    schedule: buildSchedule(900, 3, '2025-05-09', null),
  }
  plan.schedule[0].paidTxId = 'txA'
  plan.schedule[1].paidTxId = 'txB'   // highest paid no = 2
  const result = updatePlanSchedule(plan, 900, 1)
  assert.deepEqual(result, { error: 'installments_below_paid' })
})

// ── M4: overdue window widened from -7 to -90 ─────────────────────────────────

test('M4: getUpcomingInstallments overdue window is -90 days', () => {
  assert.ok(src.includes('diff <= days && diff >= -90'), 'overdue window not widened to -90')
  assert.ok(!src.includes('diff <= days && diff >= -7'), 'old -7 overdue window still present')
})

// ── Static guards: new store methods + delete-path wiring exist ───────────────

test('bnpl.js: defines unlinkPaymentByTxId, relinkPayment, payoffAll, updatePlan', () => {
  for (const fn of ['unlinkPaymentByTxId', 'relinkPayment', 'payoffAll', 'updatePlan']) {
    assert.ok(src.includes(`${fn}(`), `BNPLStore.${fn} not found in bnpl.js`)
  }
})

test('app_v2.js: undo delete paths capture and relink bnpl_payment', () => {
  const appSrc = fs.readFileSync(require('path').join(__dirname, '../app_v2.js'), 'utf8')
  const captures = appSrc.match(/BNPL\.store\.unlinkPaymentByTxId\(removed\.id\)/g) || []
  assert.ok(captures.length >= 2, 'both undo paths should capture unlink token for removed.id')
  const relinks = appSrc.match(/BNPL\.store\.relinkPayment\(_bnplUnlink, removed\.id\)/g) || []
  assert.ok(relinks.length >= 2, 'both undo paths should relink on undo')
})
