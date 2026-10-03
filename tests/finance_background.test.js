const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function fixture() {
  const stored = new Map()
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-03T12:00:00+07:00'])) }
    static now() { return new FixedDate().getTime() }
  }
  const sandbox = vm.createContext({ Date:FixedDate, setTimeout, THIS_MONTH:'2026-10', App:{ getUpcomingItems:() => [] },
    localStorage:{ getItem:k => stored.get(k) || null, setItem:(k,v) => stored.set(k,String(v)) } })
  for (const filename of ['calculations.js','finance_intelligence.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..',filename),'utf8'), sandbox)
  }
  const FI = vm.runInContext('FinanceIntelligence',sandbox)
  const Calc = vm.runInContext('Calc',sandbox)
  const state = {
    transactions:[
      { id:'old', date:'2026-09-01', type:'expense', amount:300, categoryId:'food' },
      { id:'income', date:'2026-10-01', type:'income', amount:30000 },
      { id:'posted', date:'2026-10-02', type:'expense', amount:900, ledgerAmount:600, categoryId:'food' },
      { id:'future', date:'2026-10-20', type:'expense', amount:999, scheduled:true, categoryId:'food' },
    ],
    categories:{ expense:[{id:'food',label:'Food'}], income:[] },
    wallets:[{id:'cash',type:'cash',balance:12000},{id:'card',type:'credit',balance:-500}],
    budgets:[{categoryId:'food',monthlyLimit:2000}], goals:[], recurring:[], settings:{},
  }
  return { FI, Calc, state, stored, sandbox }
}

// A historical row must not consult today's liabilities/upcoming obligations.
test('historical feature rows never compute a current financial context', () => {
  const {FI,Calc,state} = fixture()
  const liability = Calc.getCreditLiabilitySummary
  let currentContexts = 0
  Calc.getCreditLiabilitySummary = function(...args) { currentContexts++; return liability.apply(this,args) }
  const row = FI.featureForMonth(state,'2026-09')
  assert.equal(row.metrics.expense,300)
  assert.equal(row.health,null)
  assert.equal(currentContexts,0)
  FI.rebuildFeatureStore(state,12)
  assert.equal(currentContexts,1)
})

test('asynchronous context yields between real calculation phases and preserves posted money', async () => {
  const {FI,Calc,state} = fixture()
  let calculationsSinceYield = 0
  let largestChunk = 0
  let yields = 0
  for (const name of ['getMonthlyIncomeExpense','getCategoryBreakdown','getMerchantBreakdown','getBudgetProgress','getCreditLiabilitySummary','getAssetBreakdown']) {
    const calculate = Calc[name]
    Calc[name] = function(...args) {
      calculationsSinceYield++
      return calculate.apply(this,args)
    }
  }
  const ctx = await FI.buildContextAsync(state,{yieldControl:async () => {
    largestChunk = Math.max(largestChunk,calculationsSinceYield)
    calculationsSinceYield = 0
    yields++
  }})
  largestChunk = Math.max(largestChunk,calculationsSinceYield)
  assert.ok(yields >= 8)
  assert.equal(largestChunk,1)
  assert.equal(ctx.monthly.income,30000)
  assert.equal(ctx.monthly.expense,600)
  assert.equal(ctx.budgets[0].spent,600)
  assert.equal(ctx.credit.totals.totalLiability,500)
  assert.equal(ctx.assets.netWorth,11500)
  assert.equal(FI.forecasts(ctx).spendForecast,6200)
})

test('cold credit billing builds are separated by yields before aggregate context phases', async () => {
  const {FI,Calc,state,sandbox} = fixture()
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','credit_card_cycles.js'),'utf8'),sandbox)
  const CC = sandbox.CreditCardCycles
  state.wallets = Array.from({length:5},(_,i) => ({id:`c${i}`,type:'credit',name:`Card ${i}`,balance:-500,openingBalance:-500,cycleDay:25,dueAfterCycleDays:10}))
  const cache = new Map()
  let coldSinceYield = 0
  let largestColdChunk = 0
  sandbox.App.getCreditCardBillingState = card => {
    if (!cache.has(card.id)) {
      coldSinceYield++
      cache.set(card.id,CC.buildCardBillingState({card,transactions:state.transactions,refDate:'2026-10-03'}))
    }
    return cache.get(card.id)
  }
  await FI.buildContextAsync(state,{yieldControl:async () => {
    largestColdChunk = Math.max(largestColdChunk,coldSinceYield)
    coldSinceYield = 0
  }})
  assert.equal(cache.size,5)
  assert.equal(largestColdChunk,1)
})

test('background full rebuild yields before publication and preserves completed predictions', async () => {
  const {FI,Calc,state,stored} = fixture()
  const oldStore = JSON.stringify({version:2,rows:[{month:'2026-09',forecast:{predictedExpense:777},categoryForecasts:{food:444},health:{total:88}}]})
  const oldMeta = JSON.stringify({sourceHash:'old'})
  stored.set('mt_monthly_financial_features',oldStore)
  stored.set('mt_finance_feature_store_meta',oldMeta)
  const liability = Calc.getCreditLiabilitySummary
  let currentContexts = 0
  let yields = 0
  Calc.getCreditLiabilitySummary = function(...args) { currentContexts++; return liability.apply(this,args) }
  const rows = await FI.rebuildFeatureStoreIncrementalAsync(state,{forceFull:true,yieldControl:async () => {
    yields++
    assert.equal(stored.get('mt_monthly_financial_features'),oldStore)
    assert.equal(stored.get('mt_finance_feature_store_meta'),oldMeta)
  }})
  assert.ok(yields >= 12)
  assert.equal(rows.length,12)
  assert.equal(currentContexts,1)
  const past = rows.find(row => row.month === '2026-09')
  assert.equal(past.forecast.predictedExpense,777)
  assert.equal(past.forecast.actualExpense,300)
  assert.equal(past.categoryForecasts.food,444)
  assert.equal(past.health.total,88)
  const current = rows.find(row => row.month === '2026-10')
  assert.equal(current.metrics.expense,600)
  assert.equal(current.forecast.predictedExpense,6200)
  assert.equal(current.categoryForecasts.food,6200)
  assert.equal(FI.loadFeatureStore().rows.length,12)
  assert.equal(FI.loadFeatureStoreMeta().mode,'full')
})

test('feature freshness detects an older transaction edit without count or latest marker changes', () => {
  const {FI,state} = fixture()
  FI.rebuildFeatureStore(state)
  assert.equal(FI.isFeatureStoreFresh(state),true)
  state.transactions[0].amount = 450
  assert.equal(FI.isFeatureStoreFresh(state),false)
})

test('an in-place edit during background rebuild discards all computed rows and metadata', async () => {
  const {FI,Calc,state,stored} = fixture()
  FI.rebuildFeatureStore(state)
  const before = new Map(stored)
  let contextReady = false
  const liability = Calc.getCreditLiabilitySummary
  Calc.getCreditLiabilitySummary = function(...args) { contextReady = true; return liability.apply(this,args) }
  let changed = false
  await assert.rejects(FI.rebuildFeatureStoreIncrementalAsync(state,{forceFull:true,yieldControl:async () => {
    if (contextReady && !changed) { changed = true; state.transactions[0].amount = 456 }
  }}),{name:'AbortError'})
  assert.equal(changed,true)
  assert.deepEqual(stored,before)
})

test('cancellation after the final monthly row prevents both publication writes', async () => {
  const {FI,Calc,state,stored} = fixture()
  FI.rebuildFeatureStore(state)
  const before = new Map(stored)
  let lastRowCalculated = false
  let cancelled = false
  const monthly = Calc.getMonthlyIncomeExpense
  Calc.getMonthlyIncomeExpense = function(txs,month,...args) {
    if (month === '2025-11') lastRowCalculated = true
    return monthly.call(this,txs,month,...args)
  }
  await assert.rejects(FI.rebuildFeatureStoreIncrementalAsync(state,{
    forceFull:true, shouldCancel:() => cancelled,
    yieldControl:async () => { if (lastRowCalculated) cancelled = true },
  }),{name:'AbortError'})
  assert.equal(lastRowCalculated,true)
  assert.deepEqual(stored,before)
})

test('background context cancellation stops before any financial phase begins', async () => {
  const {FI,Calc,state} = fixture()
  let phases = 0
  const monthly = Calc.getMonthlyIncomeExpense
  Calc.getMonthlyIncomeExpense = function(...args) { phases++; return monthly.apply(this,args) }
  let cancelled = false
  await assert.rejects(FI.buildContextAsync(state,{
    shouldCancel:() => cancelled,
    yieldControl:async () => { cancelled = true },
  }),{name:'AbortError'})
  assert.equal(phases,0)
})

test('incremental background rebuild reuses a supplied current context', async () => {
  const {FI,Calc,state} = fixture()
  FI.rebuildFeatureStore(state)
  state.transactions[0].amount = 450
  const ctx = FI.buildContext(state)
  let currentContexts = 0
  const liability = Calc.getCreditLiabilitySummary
  Calc.getCreditLiabilitySummary = function(...args) { currentContexts++; return liability.apply(this,args) }
  const rows = await FI.rebuildFeatureStoreIncrementalAsync(state,{force:true,ctx,yieldControl:async () => {}})
  assert.equal(currentContexts,0)
  assert.equal(rows.find(row => row.month === '2026-09').metrics.expense,450)
  assert.equal(rows.find(row => row.month === '2026-10').metrics.expense,600)
  assert.equal(FI.loadFeatureStoreMeta().mode,'incremental')
  assert.equal(FI.isFeatureStoreFresh(state),true)
})

test('a fresh-store skip cannot return stale rows when a source changes during signature yields', async () => {
  const {FI,state,stored} = fixture()
  FI.rebuildFeatureStore(state)
  const before = new Map(stored)
  let yields = 0
  await assert.rejects(FI.rebuildFeatureStoreIncrementalAsync(state,{yieldControl:async () => {
    if (++yields === 3) state.transactions[0].amount = 450
  }}),{name:'AbortError'})
  assert.deepEqual(stored,before)
})

test('default background scheduling lets a main-thread timer run before features publish', async () => {
  const {FI,state,stored} = fixture()
  const rebuild = FI.rebuildFeatureStoreIncrementalAsync(state,{forceFull:true})
  await new Promise(resolve => setTimeout(resolve,0))
  assert.equal(stored.has('mt_monthly_financial_features'),false)
  const rows = await rebuild
  assert.equal(rows.length,12)
  assert.equal(stored.has('mt_monthly_financial_features'),true)
})

test('background continuations let foreground tasks run even when boosted scheduler yielding is available', async () => {
  for (const hasPostTask of [true,false]) {
    const {FI,Calc,state,sandbox} = fixture()
    let foregroundRan = false
    let firstPhaseAfterForeground = null
    const monthly = Calc.getMonthlyIncomeExpense
    Calc.getMonthlyIncomeExpense = function(...args) {
      if (firstPhaseAfterForeground === null) firstPhaseAfterForeground = foregroundRan
      return monthly.apply(this,args)
    }
    // Model the scheduler boundary: boosted continuations run ahead of normal
    // queued tasks, whereas explicitly background tasks wait for them.
    sandbox.scheduler = {yield:() => Promise.resolve()}
    if (hasPostTask) sandbox.scheduler.postTask = (callback,opts = {}) => {
      if (opts.priority !== 'background') return Promise.resolve(callback())
      return new Promise(resolve => setTimeout(() => resolve(callback()),0))
    }
    const foreground = new Promise(resolve => setTimeout(() => { foregroundRan = true; resolve() },0))
    const ctx = await FI.buildContextAsync(state)
    await foreground
    assert.equal(firstPhaseAfterForeground,true)
    assert.equal(ctx.monthly.expense,600)
  }
})

test('feature freshness includes settings, budget amounts, card metadata, memory and profile', () => {
  const mutations = [
    ({state}) => { state.settings.reserveDays = 45 },
    ({state}) => { state.budgets[0].monthlyLimit = 3000 },
    ({state}) => { state.wallets[1].cycleDay = 20 },
    ({state}) => { state.ccBenefitRules = [{id:'rule',rate:2}] },
    ({FI}) => { FI.remember({id:'event',month:'2026-09',amount:100}) },
    ({FI}) => { FI.saveProfile({preferredSavingsRate:30}) },
  ]
  for (const mutate of mutations) {
    const data = fixture()
    data.FI.rebuildFeatureStore(data.state)
    mutate(data)
    assert.equal(data.FI.isFeatureStoreFresh(data.state),false)
  }
})
