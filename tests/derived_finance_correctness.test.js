const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function insightTestGlobals() {
  global.localStorage = {
    getItem: () => null,
    setItem: () => {},
  }
  global.THIS_MONTH = '2026-06'
  global.Calc = {
    getPreviousMonth: () => '2026-05',
    getMonths: () => ['2026-06'],
    getMonthlyIncomeExpense: () => ({ income:50000, expense:10000, netCashflow:40000, savingsRate:80 }),
    getBudgetProgress: () => [],
    getUsableMoney: () => ({ liquid:100000, creditDebt:3000, upcomingReserved:0, net:97000 }),
    getMerchantBreakdown: () => [],
    getExpenseLedgerAmount: tx => Number(tx.amount || 0),
  }
  global.App = {
    getUpcomingItems: () => [],
    getCardStatement: () => ({ id:'card:statement', purchaseTotal:5000, paidTotal:2000, balanceDue:3000, dueDate:'2026-06-12' }),
    getCreditCardDueInfo: () => ({ statementId:'card:statement', amount:3000, daysLeft:3, dateStr:'2026-06-12' }),
    getGoalProgress: () => null,
  }
}

test('Credit Due insight uses statement balanceDue and remains visible after a partial payment', () => {
  insightTestGlobals()
  delete require.cache[require.resolve('../ai_insights.js')]
  const Insight = require('../ai_insights.js')
  const payload = Insight.buildPayload({
    transactions:[], budgets:[], categories:{ expense:[], income:[] }, goals:[],
    upcomingBills:[], recurring:[], privileges:[],
    wallets:[{ id:'card', name:'Card', type:'credit', balance:-9000 }],
  })
  assert.equal(payload.creditStatements[0].hasPaymentForDue, false)
  const dueInsight = Insight.runRules(payload).find(row => row.type === '03')
  assert.ok(dueInsight)
  assert.equal(dueInsight.evidence.amount, 3000)
})

test('BNPL rebuild keeps paid amounts immutable and distributes only the remaining principal', () => {
  delete require.cache[require.resolve('../bnpl.js')]
  const BNPL = require('../bnpl.js')
  const plan = {
    purchaseDate:'2026-01-01', totalAmount:900, installments:3,
    schedule:BNPL.calc.buildSchedule(900, 3, '2026-01-01', null),
  }
  plan.schedule[0].paidTxId = 'paid-300'
  const rebuilt = BNPL.calc.rebuildSchedulePreservingPayments(plan, 1200, 4, null)
  assert.equal(rebuilt.error, undefined)
  assert.deepEqual(rebuilt.schedule.map(row => row.amount), [300, 300, 300, 300])
  assert.equal(rebuilt.schedule[0].paidTxId, 'paid-300')
  assert.equal(rebuilt.schedule.reduce((sum, row) => sum + row.amount, 0), 1200)
})

test('BNPL rebuild rejects totals below already-paid principal', () => {
  delete require.cache[require.resolve('../bnpl.js')]
  const BNPL = require('../bnpl.js')
  const plan = {
    purchaseDate:'2026-01-01', totalAmount:900, installments:3,
    schedule:BNPL.calc.buildSchedule(900, 3, '2026-01-01', null),
  }
  plan.schedule[0].paidTxId = 'paid-300'
  assert.equal(BNPL.calc.rebuildSchedulePreservingPayments(plan, 299, 3, null).error, 'total_below_paid')
})

test('live Crypto valuation has no hidden haircut', () => {
  const source = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')
  assert.doesNotMatch(source, /LIVE_CRYPTO_THB_DISCOUNT_FACTOR/)
  assert.match(source, /if \(live > 0\) return Number\(live\.toFixed\(8\)\)/)
})

test('Dashboard, Report, Wallet summary and Snapshot consume the shared Financial Position', () => {
  const source = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')
  assert.match(source, /App\.getFinancialPosition\s*=\s*function/)
  assert.match(source, /const dashboardNetWorth = Number\(currentNetWorth\.net \|\| 0\)/)
  assert.match(source, /const nw = App\.getFinancialPosition\(\)/)
  assert.match(source, /const assetBreakdown = App\.getFinancialPosition\(\)/)
  assert.match(source, /const walletPosition = App\.getFinancialPosition\(\)/)
})

test('visibility is presentation-only; excludeFromNetWorth controls financial totals', () => {
  delete require.cache[require.resolve('../calculations.js')]
  const CalcModule = require('../calculations.js')
  const wallets = [
    { type:'bank', balance:1000, hiddenFromWalletList:true },
    { type:'saving', balance:9000, excludeFromNetWorth:true },
    { type:'credit', balance:-200, hiddenFromWalletList:true },
  ]
  assert.deepEqual(CalcModule.getNetWorth(wallets), { assets:1000, debt:200, net:800 })
  assert.equal(CalcModule.getAssetBreakdown(wallets).assets, 1000)
  assert.equal(CalcModule.getAssetBreakdown(wallets).liabilities, 200)
})

test('Loan UI cannot manually settle an outstanding receivable', () => {
  const source = fs.readFileSync(path.join(root, 'loans_v2.js'), 'utf8')
  assert.doesNotMatch(source, /ทำเครื่องหมายว่าคืนครบแล้ว/)
  assert.match(source, /validateLoanRepayment/)
})
