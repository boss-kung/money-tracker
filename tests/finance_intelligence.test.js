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
  FI.recommendationFeedback('trim-micro-spend', 'not_relevant')
  const map = FI.recommendationFeedbackMap()
  assert.equal(map.get('trim-micro-spend').not_relevant, 1)
})

test('forecast exposes confidence interval and goal optimizer allocates capacity', () => {
  const ctx = FI.buildContext({ transactions:[], categories:{ expense:[], income:[] }, wallets:[], recurring:[], goals:[] })
  const f = FI.forecasts(ctx)
  assert.ok(f.upperBound >= f.lowerBound)
  assert.ok(['low','medium','high'].includes(f.confidence))
  const trace = FI.forecastExplanation(ctx, f)
  assert.ok(trace.formula.includes('เงินสิ้นเดือน'))
  assert.ok(trace.sources.includes('บิล/รายการที่จะถึง'))
  const g = FI.goalOptimization(ctx)
  assert.equal(Array.isArray(g.allocation), true)
})

test('forecast accuracy summary and richer behavior classifier are available', () => {
  const store = {
    version: 2,
    rows: [{ month:'2026-04', forecast:{ predictedExpense:25000, actualExpense:30000 } }],
  }
  localStorage.setItem('mt_monthly_financial_features', JSON.stringify(store))
  const acc = FI.forecastAccuracySummary()
  assert.equal(acc.count, 1)
  assert.equal(acc.mape, 0.17)
  const ctx = FI.buildContext({ transactions:[], categories:{ expense:[], income:[] }, wallets:[], recurring:[], goals:[] })
  const b = FI.behaviorProfile(ctx)
  assert.equal('semiEssentialSpend' in b, true)
})

test('category accuracy, seasonality, and rebalance scenarios are exposed', () => {
  localStorage.setItem('mt_monthly_financial_features', JSON.stringify({
    version: 2,
    rows: [
      { month:'2025-05', categoryActuals:{ food:1000 }, categoryForecasts:{ food:900 } },
      { month:'2026-04', categoryActuals:{ food:800 }, categoryForecasts:{ food:850 } },
    ],
  }))
  assert.equal(FI.categoryForecastAccuracy('food').count, 2)
  assert.equal(typeof FI.categorySeasonality('food').factor, 'number')
  const ctx = FI.buildContext({ transactions:[], categories:{ expense:[], income:[] }, wallets:[], recurring:[], goals:[] })
  assert.equal(Array.isArray(FI.goalRebalanceScenarios(ctx)), true)
})

test('action logs can be recorded and undone', () => {
  const row = FI.recordActionLog({ type:'create_goal', title:'test', payload:{ goalId:'g1' } })
  assert.ok(row.id)
  FI.markActionUndone(row.id)
  assert.ok(FI.loadActionLog().find(x => x.id === row.id).undoneAt)
})

test('scenario compare and personalization expose decision-ready summaries', () => {
  const ctx = FI.buildContext({ transactions:[], categories:{ expense:[], income:[] }, wallets:[], recurring:[], goals:[] })
  const rows = FI.compareScenarios(ctx, [
    { name:'ฐาน', input:{} },
    { name:'รายรับเพิ่ม', input:{ incomeDelta:10000 } },
  ])
  assert.equal(rows.length, 2)
  assert.ok(rows[1].deltaCash > rows[0].deltaCash)
  assert.ok(FI.inferredArchetype(ctx).label)
  assert.ok(FI.personalizedGuidance(ctx).topLever)
})

test('proactive brief and life planning summarize next actions', () => {
  const ctx = FI.buildContext({ transactions:[], categories:{ expense:[], income:[] }, wallets:[], recurring:[], goals:[] })
  const brief = FI.proactiveBrief(ctx)
  assert.ok(brief.headline)
  const copilot = FI.copilotBrief(ctx)
  assert.equal(Array.isArray(copilot.alerts), true)
  assert.ok(copilot.weeklyReview.title)
  assert.equal(Array.isArray(copilot.monthlyClose.checklist), true)
  assert.ok(copilot.notificationReady.alertCount >= 0)
  assert.equal(Array.isArray(FI.proactiveAlertQueue(ctx)), true)
  const recs = FI.adaptiveRecommendations(ctx)
  if (recs[0]) assert.ok(recs[0].explanation.sources.length > 0)
  FI.saveLifePlan({ title:'บ้าน', targetAmount:1200000, currentAmount:200000, targetDate:'2030-05-01' })
  const summary = FI.lifePlanningSummary(ctx)
  assert.equal(summary.plans.length, 1)
  assert.ok(summary.requiredMonthlyTotal > 0)
})
