const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const Runtime = require('../derived_runtime.js')
const Cycles = require('../credit_card_cycles.js')
const Calc = require('../calculations.js')
const Ledger = require('../ledger.js')
const source = fs.readFileSync(require.resolve('../app_v2.js'), 'utf8')

function section(start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from)
  return source.slice(from, to)
}

function runtime() {
  let date = '2026-10-03'
  let builds = 0
  let estimates = 0
  const card = { id:'c', type:'credit', openingBalance:0, balance:-100, cycleDay:25, dueAfterCycleDays:10 }
  const state = { wallets:[card], transactions:[], ccBenefits:{}, ccBenefitRules:[], settings:{} }
  const context = {
    S:state, App:{}, Calc,
    window:{ MTDerivedRuntime:Runtime, MTLedger:Ledger },
    CreditCardCycles:{ ...Cycles, buildCardBillingState:options => { builds++; return Cycles.buildCardBillingState(options) } },
    getTODAY:() => date, today:() => date,
    walletById:id => state.wallets.find(row => row.id === id),
    benefitCalculationAmount:tx => Number(tx.benefitBaseAmount || tx.amount || 0),
    ensureV4State() {}, console,
  }
  context.App.decorateRewardEstimateValues = (_cardId, estimate) => estimate
  context.App.calculateSelectedRewardEstimate = tx => {
    estimates++
    return { cashback:Number(tx.amount) / 100, discount:0, points:0, rules:[] }
  }
  context.App._validateLedgerIntegrity = () => []
  context.App._ledgerFlows = () => Ledger.compute({ wallets:state.wallets, transactions:state.transactions, today:date })
  context.App.ensureLedgerBaselines = () => {}
  context.App._investmentUnitPriceV4 = () => 0
  vm.createContext(context)
  vm.runInContext(section('const MT_DERIVED_MEMO = ', 'function getStateCommit()'), context)
  vm.runInContext("App.invalidateDerivedState = reason => MT_DERIVED_MEMO.invalidate(reason)", context)
  vm.runInContext(section('  App.getTransactionRewardEstimate = function', '  App._toggleTxRewardRule = function'), context)
  vm.runInContext(section('  App._creditCycleOptions = function', '  App._renderCCCyclePager = function'), context)
  vm.runInContext(section('  App.recalculateWalletBalances = function', '  App.recordNetWorthSnapshot = function'), context)
  vm.runInContext(section('  App.refreshTransactionRewardEstimates = function', '  function normalizeSharedExpenseDraft'), context)
  Object.assign(context, {
    normalizeCompareText:value => String(value || '').toLowerCase(),
    resolveBenefitTxDate:tx => tx.benefitDateOverride || tx.date,
    resolveBenefitTxChannel:tx => tx.channel || '',
    txShouldCountForRule:(tx, _rule, id) => (tx.rewardRuleIds || []).includes(id),
    getRuleEligibility:() => ({matched:true, merchantMatch:true, channelMatch:true, reasons:[]}),
    merchantTextsMatch:(a, b) => a === b,
    channelMatchesAny:(channels, channel) => channels.includes(channel),
    getTriggerTrackChannels:trigger => trigger.trackChannels || [],
    rewardTotalForRuleResult:row => Number(row.cashback || 0) + Number(row.discount || 0) + Number(row.points || 0),
    normalizeBenefitCompareValue:(_key, value) => value,
    formatTrackChannelLabel:() => '', money:String,
  })
  context.App._isPostedTx = tx => tx.date <= date
  vm.runInContext(section('  App.getRuleCycleUsage = function', '  // Returns per-merchant'), context)
  vm.runInContext(section('  App.applyBenefitRule = function', '  App.getOptimalBenefitSelection = function'), context)
  return { context, state, card, counts:() => ({ builds, estimates }), setDate:value => { date = value } }
}

test('billing, statement, due and cycle detail reuse one engine result', () => {
  const r = runtime()
  r.state.transactions.push({ id:'t', type:'expense', walletId:'c', amount:100, date:'2026-09-01' })
  const state = r.context.App.getCreditCardBillingState(r.card)
  assert.equal(r.context.App.getCardStatement('c'), state.statements.find(row => row.end === '2026-09-25'))
  assert.equal(r.context.App.getCreditCardDueInfo(r.card).statement, state.payableStatements[0])
  assert.equal(r.context.App._getCCDetailStatementAtOffset(r.card, 0), state.openStatement)
  assert.equal(r.counts().builds, 1)
})

test('reconciliation invalidates cached bills after an in-place transaction edit before persist', () => {
  const r = runtime()
  const tx = { id:'t', type:'expense', walletId:'c', amount:100, date:'2026-10-01' }
  r.state.transactions.push(tx)
  assert.equal(r.context.App.getCreditCardBillingState(r.card).openStatement.purchaseTotal, 100)
  tx.amount = 250
  // Keep the cached card key unchanged to prove the invalidation comes from reconciliation.
  r.context.App._ledgerFlows = () => ({ cash:{c:-100}, units:{} })
  r.context.App.recalculateWalletBalances()
  assert.equal(r.context.App.getCreditCardBillingState(r.card).openStatement.purchaseTotal, 250)
})

test('reward refresh invalidates earlier cycle usage before recomputing stored estimates', () => {
  const r = runtime()
  const tx = { id:'t', type:'expense', walletId:'c', amount:100, date:'2026-10-01', rewardRuleIds:['r'] }
  r.state.transactions.push(tx)
  assert.equal(r.context.App.getTransactionRewardEstimate(tx).cashback, 1)
  r.context.App.calculateSelectedRewardEstimate = () => ({ cashback:5, rules:[] })
  r.context.App._rewardEstimateForTx = row => r.context.App.getTransactionRewardEstimate(row)
  r.context.App.refreshTransactionRewardEstimates()
  assert.equal(tx.rewardEstimate.cashback, 5)
})

test('changing the day refreshes estimates even for the same historical billing date', () => {
  const r = runtime()
  const tx = { id:'t', type:'expense', walletId:'c', amount:100, date:'2026-10-01', rewardRuleIds:['r'] }
  r.state.transactions.push(tx)
  const before = r.context.App.getCreditCardBillingState(r.card, '2026-10-03')
  r.setDate('2026-10-04')
  const after = r.context.App.getCreditCardBillingState(r.card, '2026-10-03')
  assert.notEqual(after, before)
  assert.equal(r.counts().estimates, 2)
})

test('updated stored estimates cannot collide with an earlier reward cache entry', () => {
  const r = runtime()
  const tx = { id:'t', rewardRuleIds:[], rewardEstimate:{ cashback:1 } }
  assert.equal(r.context.App.getTransactionRewardEstimate(tx).cashback, 1)
  tx.rewardEstimate = { cashback:7 }
  assert.equal(r.context.App.getTransactionRewardEstimate(tx).cashback, 7)
})

test('cycle detail preserves adjacent empty historical cycles beyond six months', () => {
  const r = runtime()
  const expected = Cycles.getStatementHistory({ card:r.card, transactions:[], refDate:'2026-10-03', count:11, includeOpen:true })[9]
  const actual = r.context.App._getCCDetailStatementAtOffset(r.card, 9)
  assert.ok(actual)
  assert.equal(actual.id, expected.id)
})

test('boot render requests wait for delayed storage hydration', () => {
  let scheduled
  let renders = 0
  const context = {
    window:{ MTDerivedRuntime:Runtime }, S:{page:'dashboard'}, MT_STORAGE_HYDRATED:false,
    App:{showPage() { renders++ }}, requestAnimationFrame:callback => { scheduled = callback },
    performance:{now:() => 0}, requestHideBootScreen() {},
  }
  vm.createContext(context)
  vm.runInContext(section('let MT_FIRST_RENDER_DONE = ', 'App.invalidateDerivedState = '), context)
  context.App.requestRender('feature-ready')
  scheduled()
  assert.equal(renders, 0)
  context.MT_STORAGE_HYDRATED = true
  context.App.requestRender('initial')
  scheduled()
  assert.equal(renders, 1)
})

test('cached cycle usage preserves same-day threshold ordering and resets on deletion and undo', () => {
  const r = runtime()
  const rule = {id:'r', type:'cashback', cashback:{mode:'fixed', fixedAmount:200}, rewardTrigger:{mode:'cycle_spend_threshold', thresholdAmount:10000, grantMode:'every_threshold', trackChannels:['online']}}
  const first = {id:'a', type:'expense', walletId:'c', amount:7090, date:'2026-10-01', createdSequence:1, rewardRuleIds:['r'], channel:'online'}
  const second = {...first, id:'b', createdSequence:2}
  r.state.transactions.push(second, first)
  const usage = (tx, skipMemo = false) => r.context.App.getRuleCycleUsage('r', 'c', '2026-10-01', '2026-10-31', tx.id, ['online'], '', 'online', rule, tx.date, skipMemo)
  assert.deepEqual(usage(second), usage(second, true))
  assert.equal(r.context.App.applyBenefitRule(first, rule, usage(first)).cashback, 0)
  assert.equal(r.context.App.applyBenefitRule(second, rule, usage(second)).cashback, 200)
  r.state.transactions.pop()
  r.context.App.refreshTransactionRewardEstimates()
  assert.equal(r.context.App.applyBenefitRule(second, rule, usage(second)).cashback, 0)
  r.state.transactions.push(first)
  r.context.App.refreshTransactionRewardEstimates()
  assert.equal(r.context.App.applyBenefitRule(second, rule, usage(second)).cashback, 200)
})

test('a changed cycle cap recomputes usage without reusing the previous rule configuration', () => {
  const r = runtime()
  const rule = {id:'r', type:'cashback', cashback:{mode:'percent', rate:10}, limits:{maxRewardAmountPerCycle:100}}
  const first = {id:'a', type:'expense', walletId:'c', amount:1000, date:'2026-10-01', createdSequence:1, rewardRuleIds:['r']}
  const second = {...first, id:'b', createdSequence:2}
  r.state.transactions.push(second, first)
  const usage = () => r.context.App.getRuleCycleUsage('r', 'c', '2026-10-01', '2026-10-31', second.id, [], '', '', rule, second.date)
  assert.equal(r.context.App.applyBenefitRule(second, rule, usage()).cashback, 0)
  rule.limits.maxRewardAmountPerCycle = 150
  assert.equal(r.context.App.applyBenefitRule(second, rule, usage()).cashback, 50)
})
