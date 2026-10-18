const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const Calc = require('../calculations.js')
const Ledger = require('../ledger.js')

test('money aggregation rounds at the satang boundary and keeps scheduled rows out of actuals', () => {
  const transactions = [
    { id:'i1', type:'income', walletId:'cash', amount:0.1, date:'2026-10-05' },
    { id:'i2', type:'income', walletId:'cash', amount:0.2, date:'2026-10-05' },
    { id:'e1', type:'expense', walletId:'cash', categoryId:'food', amount:0.1, date:'2026-10-05' },
    { id:'e2', type:'expense', walletId:'cash', categoryId:'food', amount:0.2, date:'2026-10-05' },
    { id:'future', type:'expense', walletId:'cash', categoryId:'food', amount:100, date:'2026-10-20', scheduled:true },
  ]
  const actual = Calc.getMonthlyIncomeExpense(transactions, '2026-10')
  const stats = Calc.getMonthlyStats(transactions, '2026-10')
  const budget = Calc.getBudgetProgress(transactions, [{ categoryId:'food', monthlyLimit:0.3 }], { expense:[{ id:'food', label:'อาหาร' }] }, '2026-10')[0]

  assert.equal(Calc.isSafeMoneyAmount(0.1 + 0.2), true)
  assert.equal(actual.income, 0.3)
  assert.equal(actual.expense, 0.3)
  assert.equal(actual.netCashflow, 0)
  assert.equal(stats.income, actual.income)
  assert.equal(stats.expense, actual.expense)
  assert.equal(stats.savingsRate, actual.savingsRate)
  assert.equal(budget.spent, 0.3)
  assert.equal(budget.over, false)
  assert.equal(Calc.getMonthlyScheduledTotals(transactions, '2026-10').expense, 100)
})

test('money validator rejects non-finite and unsafe-cent amounts', () => {
  assert.equal(Calc.isSafeMoneyAmount(NaN), false)
  assert.equal(Calc.isSafeMoneyAmount(Infinity), false)
  assert.equal(Calc.isSafeMoneyAmount(Number.MAX_SAFE_INTEGER), false)
  assert.equal(Calc.isSafeMoneyAmount(Number.MAX_SAFE_INTEGER / 100), true)
})

test('ledger validates every transaction wallet reference, including BNPL and investment cash/source aliases', () => {
  const wallets = [{ id:'cash' }, { id:'bnpl' }, { id:'gold' }]
  const issues = Ledger.validateIntegrity({
    wallets,
    today:'2026-10-06',
    transactions:[
      { id:'bnpl-missing', type:'bnpl_payment', walletId:'cash', date:'2026-10-01', amount:10 },
      { id:'buy-missing', type:'investment_buy', walletId:'gold', date:'2026-10-01', amount:10, units:1 },
      { id:'sell-legacy', type:'investment_sell', walletId:'gold', sourceWalletId:'cash', date:'2026-10-01', amount:10, units:1 },
    ],
  })
  assert.deepEqual(issues.map(issue => [issue.txId, issue.field]), [
    ['bnpl-missing', 'toWalletId'],
    ['buy-missing', 'cashWalletId|sourceWalletId'],
  ])
  assert.deepEqual(Ledger.getTransactionWalletReferenceIds({ type:'investment_buy', walletId:'gold', sourceWalletId:'cash' }), ['gold', 'cash'])
})

test('BNPL edit validation reverts the original expense exactly once', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')
  const blockStart = source.indexOf('  App.validateTransactionDraft = function')
  const blockEnd = source.indexOf('  // ── ═══════════════════════════════════════════════════════', blockStart + 40)
  const block = source.slice(blockStart, blockEnd)
  assert.ok(blockStart >= 0 && blockEnd > blockStart)
  assert.match(block, /const available = limit \+ effectiveBalance\(tx\.walletId\)/)
  assert.doesNotMatch(block, /const available = limit \+ effectiveBalance\(tx\.walletId\) \+ origAmt/)
})

test('BNPL edit validation handles same-wallet and wallet-change boundaries', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')
  const start = source.indexOf('  App.validateTransactionDraft = function')
  const end = source.indexOf('  // ── ═══════════════════════════════════════════════════════', start + 40)
  const context = {
    App: {
      _normalizeInstallmentCount: () => 2,
      getCreditLimitForCard: wallet => Number(wallet.creditLimit || 0),
      getCCPaymentCashAmount: tx => Number(tx.amount || 0),
      _isSafeMoneyAmount: value => Number.isFinite(Number(value)) && Number.isSafeInteger(Math.round(Number(value) * 100)),
    },
    S: {
      wallets: [
        { id:'bnpl-a', type:'bnpl', creditLimit:1000, balance:-800 },
        { id:'bnpl-b', type:'bnpl', creditLimit:1000, balance:-800 },
      ],
      transactions: [{ id:'old', type:'expense', walletId:'bnpl-a', amount:200 }],
    },
    Calc: { isSafeMoneyAmount: value => Number.isFinite(Number(value)) && Number.isSafeInteger(Math.round(Number(value) * 100)) },
    FIELD_MAX: { merchant:100, note:100 },
    walletById: id => context.S.wallets.find(wallet => wallet.id === id),
    isTransferableMoneyWallet: () => true,
    _fieldTooLong: () => null,
    money: String,
  }
  vm.createContext(context)
  vm.runInContext(source.slice(start, end), context)
  const draft = walletId => ({ type:'expense', amount:400, walletId, categoryId:'food', bnplInstallments:0 })
  assert.equal(context.App.validateTransactionDraft(draft('bnpl-a'), { isEdit:true, editingTxId:'old' }), null)
  assert.match(context.App.validateTransactionDraft({ ...draft('bnpl-a'), amount:401 }, { isEdit:true, editingTxId:'old' }), /ไม่พอ/)
  assert.match(context.App.validateTransactionDraft({ ...draft('bnpl-b'), amount:201 }, { isEdit:true, editingTxId:'old' }), /ไม่พอ/)
})

test('reporting consumers use the shared posted-only monthly contract', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')
  const intelligence = fs.readFileSync(path.join(__dirname, '..', 'finance_intelligence.js'), 'utf8')
  assert.match(app, /getMonthlyStats[\s\S]*getMonthlyIncomeExpense/)
  assert.match(intelligence, /Calc\.getMonthlyIncomeExpense\(txs, month\)/)
})
