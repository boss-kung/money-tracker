const test = require('node:test')
const assert = require('node:assert/strict')

const Calc = require('../calculations.js')

test('shared expense counts only personal share in expense reports', () => {
  const txs = [
    {
      id: 'meal',
      type: 'expense',
      amount: 1000,
      ledgerAmount: 250,
      categoryId: 'food',
      walletId: 'cash',
      date: '2026-05-10',
    },
  ]

  const monthly = Calc.getMonthlyIncomeExpense(txs, '2026-05')
  const breakdown = Calc.getCategoryBreakdown(txs, '2026-05', {
    type: 'expense',
    categories: [{ id: 'food', label: 'อาหาร', icon: '🍽️', color: '#f00' }],
  })

  assert.equal(monthly.expense, 250)
  assert.equal(breakdown[0].amount, 250)
})

test('reimbursement increases cash-inflow metadata but not normal income', () => {
  const txs = [
    {
      id: 'meal',
      type: 'expense',
      amount: 1000,
      ledgerAmount: 250,
      categoryId: 'food',
      walletId: 'cash',
      date: '2026-05-10',
    },
    {
      id: 'refund',
      type: 'income',
      amount: 750,
      categoryId: 'other_income',
      walletId: 'cash',
      date: '2026-05-11',
      reimbursesSharedExpenseTxId: 'meal',
      incomeTreatment: 'reimbursement',
    },
  ]

  const monthly = Calc.getMonthlyIncomeExpense(txs, '2026-05')
  const incomeBreakdown = Calc.getCategoryBreakdown(txs, '2026-05', {
    type: 'income',
    categories: [{ id: 'other_income', label: 'อื่นๆ', icon: '💰', color: '#0a0' }],
  })

  assert.equal(monthly.income, 0)
  assert.equal(monthly.reimbursementInflow, 750)
  assert.equal(monthly.netCashflow, -250)
  assert.equal(monthly.cashNetCashflow, 500)
  assert.equal(incomeBreakdown.length, 0)
})

test('legacy monthly stats helper also excludes reimbursements from income', () => {
  const txs = [
    {
      id: 'salary',
      type: 'income',
      amount: 50000,
      categoryId: 'salary',
      walletId: 'bank',
      date: '2026-05-01',
    },
    {
      id: 'meal',
      type: 'expense',
      amount: 1000,
      ledgerAmount: 250,
      categoryId: 'food',
      walletId: 'cash',
      date: '2026-05-10',
    },
    {
      id: 'refund',
      type: 'income',
      amount: 750,
      categoryId: 'other_income',
      walletId: 'cash',
      date: '2026-05-11',
      reimbursesSharedExpenseTxId: 'meal',
    },
  ]

  const stats = Calc.getMonthlyStats(txs, '2026-05')

  assert.equal(stats.income, 50000)
  assert.equal(stats.expense, 250)
  assert.equal(stats.reimbursementInflow, 750)
  assert.equal(stats.net, 49750)
  assert.equal(stats.cashNet, 50500)
})

test('income category breakdown can include reimbursements only when explicitly requested', () => {
  const txs = [
    {
      id: 'refund',
      type: 'income',
      amount: 300,
      categoryId: 'other_income',
      walletId: 'cash',
      date: '2026-05-11',
      reimbursesSharedExpenseTxId: 'meal',
    },
  ]

  const excluded = Calc.getCategoryBreakdown(txs, '2026-05', {
    type: 'income',
    categories: [{ id: 'other_income', label: 'อื่นๆ', icon: '💰', color: '#0a0' }],
  })
  const included = Calc.getCategoryBreakdown(txs, '2026-05', {
    type: 'income',
    includeReimbursements: true,
    categories: [{ id: 'other_income', label: 'อื่นๆ', icon: '💰', color: '#0a0' }],
  })

  assert.equal(excluded.length, 0)
  assert.equal(included[0].amount, 300)
})
