const test = require('node:test')
const assert = require('node:assert/strict')

const Calc = require('../calculations.js')

test('positive credit-card balances are credits rather than debt', () => {
  const result = Calc.getNetWorth([
    { id: 'card-credit', type: 'credit', balance: 800 },
    { id: 'card-debt', type: 'credit', balance: -1200 },
    { id: 'cash', type: 'cash', balance: 5000 },
  ])
  assert.equal(result.assets, 5000)
  assert.equal(result.debt, 1200)
})

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
  assert.equal(monthly.cashNetCashflow, -250)
  assert.equal(incomeBreakdown.length, 0)
})

test('cashflow includes actual card cash payment without counting the purchase again', () => {
  const txs = [
    { id:'purchase', type:'expense', amount:5000, walletId:'card', date:'2026-04-10' },
    { id:'payment', type:'cc_payment', amount:5000, walletId:'bank', toWalletId:'card', date:'2026-05-01' },
  ]
  const monthly = Calc.getMonthlyIncomeExpense(txs, '2026-05')
  assert.equal(monthly.expense, 0)
  assert.equal(monthly.cashNetCashflow, -5000)
})

test('cashflow excludes credit-card purchases and counts only their cash payment', () => {
  const monthly = Calc.getMonthlyIncomeExpense([
    { id:'purchase', type:'expense', amount:5000, walletId:'card', date:'2026-05-01' },
    { id:'payment', type:'cc_payment', amount:5000, walletId:'bank', toWalletId:'card', date:'2026-05-02' },
  ], '2026-05', [], [
    { id:'card', type:'credit', balance:-5000 },
    { id:'bank', type:'bank', balance:10000 },
  ])
  assert.equal(monthly.expense, 5000)
  assert.equal(monthly.cashNetCashflow, -5000)
})

test('cashflow includes loan principal outflow and posted repayment inflow', () => {
  const monthly = Calc.getMonthlyIncomeExpense([], '2026-05', [
    {
      id: 'loan-1',
      amount: 2000,
      walletId: 'cash',
      date: '2026-05-02',
      repayments: [{ id: 'rep-1', amount: 700, walletId: 'cash', date: '2026-05-20' }],
    },
  ])
  assert.equal(monthly.cashNetCashflow, -1300)
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
  assert.equal(stats.cashNet, 49750)
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

test('weekly net series uses calendar weeks and excludes reimbursements from income', () => {
  const txs = [
    {
      id: 'salary',
      type: 'income',
      amount: 10000,
      walletId: 'bank',
      date: '2026-05-18',
    },
    {
      id: 'groceries',
      type: 'expense',
      amount: 1500,
      ledgerAmount: 1500,
      walletId: 'cash',
      date: '2026-05-20',
    },
    {
      id: 'refund',
      type: 'income',
      amount: 800,
      walletId: 'cash',
      date: '2026-05-21',
      reimbursesSharedExpenseTxId: 'groceries',
    },
    {
      id: 'rent',
      type: 'expense',
      amount: 4000,
      ledgerAmount: 4000,
      walletId: 'bank',
      date: '2026-05-27',
    },
    {
      id: 'bonus',
      type: 'income',
      amount: 5000,
      walletId: 'bank',
      date: '2026-06-02',
    },
  ]

  const weekly = Calc.getWeeklyNetSeries(txs, { weeks: 3, refDate: '2026-06-03' })

  assert.deepEqual(weekly.map(w => ({ start: w.start, end: w.end, net: w.netCashflow })), [
    { start: '2026-05-18', end: '2026-05-24', net: 8500 },
    { start: '2026-05-25', end: '2026-05-31', net: -4000 },
    { start: '2026-06-01', end: '2026-06-07', net: 5000 },
  ])
  assert.equal(weekly[0].income, 10000)
  assert.equal(weekly[0].expense, 1500)
})
