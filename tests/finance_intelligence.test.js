const test = require('node:test')
const assert = require('node:assert/strict')

global.localStorage = (() => {
  const map = new Map()
  return {
    getItem: k => map.has(k) ? map.get(k) : null,
    setItem: (k,v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  }
})()

global.THIS_MONTH = '2026-05'
global.Calc = {
  getPreviousMonth: m => m === '2026-05' ? '2026-04' : '2026-03',
  getMonths: () => ['2026-05','2026-04','2026-03'],
  getMonthlyIncomeExpense: (_txs, m) => ({
    '2026-05': { income: 50000, expense: 20000, netCashflow:30000, savingsRate:60 },
    '2026-04': { income: 40000, expense: 30000, netCashflow:10000, savingsRate:25 },
    '2026-03': { income: 40000, expense: 25000, netCashflow:15000, savingsRate:37.5 },
  }[m] || { income:0, expense:0, netCashflow:0, savingsRate:null }),
  getCategoryBreakdown: () => [],
  getMerchantBreakdown: () => [],
  getBudgetProgress: () => [],
  getUsableMoney: () => ({ liquid:90000, creditDebt:0, upcomingReserved:0, net:90000 }),
  getCreditLiabilitySummary: () => ({ cards:[], totals:{ totalLiability:0 } }),
  getAssetBreakdown: () => ({ netWorth:90000 }),
  getPostedTransactions: txs => txs,
  getExpenseLedgerAmount: t => t.amount,
}
global.App = {
  getUpcomingItems: () => [],
  getCryptoPortfolioSummary: () => ({ totalValueTHB:0 }),
  getGoalProgress: () => null,
}

const FI = require('../finance_intelligence.js')

test('event-aware memory adjusts historical baseline', () => {
  FI.remember({ title:'ทริป', month:'2026-04', amount:10000, direction:'expense', excludeFromBaseline:true })
  const ctx = FI.buildContext({ transactions:[], categories:{ expense:[], income:[] }, wallets:[], recurring:[], goals:[] })
  assert.equal(ctx.history.find(h => h.month === '2026-04').adjustedExpense, 20000)
  assert.equal(ctx.avgExpense, 22500)
})

test('feature store persists versioned rows', () => {
  FI.rebuildFeatureStore({ transactions:[], categories:{ expense:[], income:[] }, wallets:[], recurring:[], goals:[] }, 3)
  const store = FI.loadFeatureStore()
  assert.equal(store.version, 2)
  assert.equal(store.rows.length, 3)
})

test('feedback changes recommendation ordering score', () => {
  FI.recommendationFeedback('trim-micro-spend', 'not_helpful')
  const map = FI.recommendationFeedbackMap()
  assert.equal(map.get('trim-micro-spend').not_helpful, 1)
})

test('forecast exposes confidence interval and goal optimizer allocates capacity', () => {
  const ctx = FI.buildContext({ transactions:[], categories:{ expense:[], income:[] }, wallets:[], recurring:[], goals:[] })
  const f = FI.forecasts(ctx)
  assert.ok(f.upperBound >= f.lowerBound)
  assert.ok(['low','medium','high'].includes(f.confidence))
  const g = FI.goalOptimization(ctx)
  assert.equal(Array.isArray(g.allocation), true)
})
