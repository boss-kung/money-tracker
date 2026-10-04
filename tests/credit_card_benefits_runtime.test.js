const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('../app_v2.js'), 'utf8')

function section(start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0, `missing section start: ${start}`)
  assert.ok(to > from, `missing section end: ${end}`)
  return source.slice(from, to)
}

test('an explicit empty reward-rule selection never falls back to automatic eligibility', () => {
  const context = {
    getRuleEligibility: () => ({ matched: true }),
  }
  vm.createContext(context)
  vm.runInContext(
    `${section('  function txExplicitRewardRuleIds', '  function benefitCalculationAmount')}\n` +
    `result = txShouldCountForRule({ rewardRuleIds: [] }, { id: 'rule-1' }, 'rule-1')`,
    context,
  )

  assert.equal(context.result, false)
})

test('promotion import preserves exclusions and does not turn campaign-only limits into cycle limits', () => {
  let sequence = 0
  const context = {
    App: { normalizeBenefitRule: rule => rule },
    genId: () => `generated-${++sequence}`,
    money: value => String(value),
    categoryIdsFromTexts: values => values.map(value => `cat:${value}`),
  }
  vm.createContext(context)
  vm.runInContext(section('  App._promotionDraftToRuleDrafts = function', '  App._renderBenefitImportPreview = function'), context)

  const [draft] = context.App._promotionDraftToRuleDrafts('card-1', {
    sourceUrl: 'https://bank.example/promo',
    title: 'Campaign-capped cashback',
    summary: '',
    reward: { kind: 'cashback', cashbackRate: 5 },
    eligibility: {
      requiresRegistration: true,
      registrationUrl: '',
      minSpendPerCycle: null,
      minSpendPerTx: 500,
      categoriesText: ['travel'],
      merchantNames: ['Airline'],
      channel: ['online'],
    },
    limits: {
      maxRewardPerTx: null,
      maxRewardPerCycle: null,
      maxRewardPerMonth: null,
      maxRewardPerCampaign: 1000,
      maxUsesPerCard: 2,
      maxUsesTotal: 100,
    },
    validity: { startDate: '2026-10-01', endDate: '2026-12-31' },
    exclusions: {
      excludedCategoriesText: ['cash advance'],
      excludedMerchantNames: ['Excluded Shop'],
      excludedKeywords: ['MCC 6011'],
    },
    notes: { freeText: [] },
    confidence: { overall: 0.95 },
  })

  assert.equal(draft.rule.limits.maxRewardAmountPerCycle, null)
  assert.deepEqual(draft.rule.suggestedConditions.excludedMerchants, ['Excluded Shop'])
  assert.equal(draft.rule.active, false)
  assert.ok(draft.reviewFields.includes('campaignLimits'))
  assert.ok(draft.reviewFields.includes('registration'))
  assert.ok(draft.warnings.some(message => message.includes('ตลอดโปรโมชัน')))
})

test('legacy cashback migration preserves the every-Baht block before reward calculation', () => {
  const state = {
    ccBenefits: {
      'card-1': { cashback: { enabled:true, percent:1, everyBaht:500 } },
    },
    ccBenefitRules: [],
    migrations: {},
  }
  const context = {
    S: state,
    App: {},
    genId: () => 'generated-rule',
    parseRuleNumber: value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null,
    normalizeCompareText: value => String(value || '').toLowerCase(),
    normalizeTrackChannels: () => [],
    benefitCalculationAmount: tx => Number(tx.amount || 0),
    getRuleEligibility: () => ({ matched:true, reasons:[] }),
    getBenefitCapScopes: () => ['merchant', 'channel'],
    getTriggerTrackChannels: () => [],
    channelMatchesAny: () => true,
    normalizeBenefitCompareValue: (_type, value) => value,
    formatTrackChannelLabel: () => '',
    resolveBenefitTxDate: tx => tx.date,
    rewardTotalForRuleResult: row => Number(row.cashback || 0) + Number(row.discount || 0) + Number(row.points || 0),
    today: () => '2026-10-04',
    money: value => String(value),
  }
  vm.createContext(context)
  vm.runInContext(section('  function normalizeBenefitRule', '  App.normalizeBenefitRule = normalizeBenefitRule'), context)
  vm.runInContext(section('  function buildLegacyBenefitRules', '  App.getCyclePeriodForDate = function'), context)
  vm.runInContext(section('  App.applyBenefitRule = function', '  App.getOptimalBenefitSelection = function'), context)

  context.App.ensureCCBenefitRulesState()

  const rule = context.S.ccBenefitRules[0]
  assert.equal(rule.cashback.everyBaht, 500)
  assert.equal(context.App.applyBenefitRule({ amount:950, date:'2026-10-04' }, rule).cashback, 5)

  state.ccBenefitRules = [{
    id:'legacy-cashback-card-1', cardId:'card-1', source:'legacy', type:'cashback',
    cashback:{ mode:'percent', rate:1, everyBaht:null },
  }]
  context.App.ensureCCBenefitRulesState()
  assert.equal(context.S.ccBenefitRules[0].cashback.everyBaht, 500)
})

test('a rule with merchant and channel conditions requires both to match', () => {
  const context = {
    App: { getBenefitChannelOptions: () => [] },
    categoryConditionMatches: () => true,
    benefitCalculationAmount: tx => Number(tx.amount || 0),
    resolveBenefitTxDate: tx => tx.date,
    resolveBenefitTxChannel: tx => tx.channel,
    ruleIsInActiveWindow: () => true,
    today: () => '2026-10-04',
  }
  vm.createContext(context)
  vm.runInContext(section('  function normalizeCompareText', '  function canonicalMerchantText'), context)
  vm.runInContext(section('  function canonicalMerchantText', '  function expandRuleSubsets'), context)
  vm.runInContext(section('  const ONLINE_CHANNEL_ALIASES', '  function normalizeTrackChannels'), context)
  vm.runInContext(section('  function getRuleEligibility', '  function txExplicitRewardRuleIds'), context)

  const result = vm.runInContext(`getRuleEligibility(
    { amount: 1000, merchant: 'Airline', channel: 'offline', date: '2026-10-04' },
    { suggestedConditions: { merchants: ['Airline'], channels: ['online'] } }
  )`, context)

  assert.equal(result.merchantMatch, true)
  assert.equal(result.channelMatch, false)
  assert.equal(result.matched, false)
})

test('a rule with any merchant/channel mode matches either condition', () => {
  const context = {
    App: { getBenefitChannelOptions: () => [] },
    categoryConditionMatches: () => true,
    benefitCalculationAmount: tx => Number(tx.amount || 0),
    resolveBenefitTxDate: tx => tx.date,
    resolveBenefitTxChannel: tx => tx.channel,
    ruleIsInActiveWindow: () => true,
    today: () => '2026-10-04',
  }
  vm.createContext(context)
  vm.runInContext(section('  function normalizeCompareText', '  function canonicalMerchantText'), context)
  vm.runInContext(section('  function canonicalMerchantText', '  function expandRuleSubsets'), context)
  vm.runInContext(section('  const ONLINE_CHANNEL_ALIASES', '  function normalizeTrackChannels'), context)
  vm.runInContext(section('  function getRuleEligibility', '  function txExplicitRewardRuleIds'), context)

  const result = vm.runInContext(`getRuleEligibility(
    { amount: 1000, merchant: 'Other Shop', channel: 'online', date: '2026-10-04' },
    { suggestedConditions: { merchants: ['Airline'], channels: ['online'], merchantChannelMatchMode: 'any' } }
  )`, context)

  assert.equal(result.merchantMatch, false)
  assert.equal(result.channelMatch, true)
  assert.equal(result.matched, true)
  assert.equal(result.capScope, 'channel')
})

test('duplicate reward confirmation keeps the entered values available until recording starts', () => {
  let dialogRemoved = false
  let valuesAvailableDuringConfirm = false
  const context = {
    App: {
      _confirmRecordRewards() {
        valuesAvailableDuringConfirm = !dialogRemoved
      },
    },
    document: {
      getElementById: () => ({ remove() { dialogRemoved = true } }),
    },
  }
  vm.createContext(context)
  vm.runInContext(section('  App._forceRecordRewards = function', '  // ── ═══════════════════════════════════════════════════════\n  // DATA HEALTH CHECK'), context)

  context.App._forceRecordRewards('card-1', 'statement-1')

  assert.equal(valuesAvailableDuringConfirm, true)
})

test('manual rule toggle replaces an exclusive selection instead of stacking it', () => {
  const state = { tx: { type:'expense', walletId:'card-1', amount:100, date:'2026-10-04', rewardRuleIds:['exclusive'] } }
  const rules = [
    { id:'exclusive', allowStacking:false },
    { id:'stackable', allowStacking:true },
  ]
  const context = {
    S: state,
    App: {
      getSuggestedBenefitRules: () => rules,
      calculateSelectedRewardEstimate: (_draft, ids) => ({ ids:[...ids] }),
      _renderAddTxDetail() {},
    },
    today: () => '2026-10-04',
    notify() {},
    document: { querySelector: () => null },
    requestAnimationFrame: callback => callback(),
  }
  vm.createContext(context)
  vm.runInContext(section('  function normalizeSelectedBenefitRules', '  function inferCategoryIdsFromText'), context)
  vm.runInContext(section('  App._toggleTxRewardRule = function', '  App._creditCycleOptions = function'), context)

  context.App._toggleTxRewardRule('stackable')

  assert.deepEqual(Array.from(state.tx.rewardRuleIds), ['stackable'])
})

test('reward estimation defensively excludes incompatible stacked rules', () => {
  const rules = [
    { id:'exclusive', name:'Exclusive', active:true, allowStacking:false, priority:10 },
    { id:'stackable', name:'Stackable', active:true, allowStacking:true, priority:5 },
  ]
  const context = {
    S: {},
    App: {
      getCreditCardBenefitRules: () => rules,
      getRuleCycleUsage: () => ({}),
      applyBenefitRule: (_tx, rule) => ({ ruleId:rule.id, ruleName:rule.name, cashback:10, discount:0, points:0, potentialCashback:10, potentialDiscount:0, potentialPoints:0, warnings:[] }),
    },
    ensureCCBenefitRulesState() {},
    walletById: () => ({ id:'card-1', type:'credit' }),
    getCyclePeriodForDate: () => ({ start:'2026-10-01', end:'2026-10-31' }),
    resolveBenefitTxDate: tx => tx.date,
    getTriggerTrackChannels: () => [],
    today: () => '2026-10-04',
    summarizeUnlockConfidence: row => ({ unlockConfidence:1, weightedRewardValue:row.cashback, rewardNowValue:row.cashback, rewardPotentialValue:row.cashback, confidenceReason:'' }),
    getStackingWarnings: () => [],
  }
  vm.createContext(context)
  vm.runInContext(section('  function normalizeSelectedBenefitRules', '  function inferCategoryIdsFromText'), context)
  vm.runInContext(section('  App.calculateSelectedRewardEstimate = function', '  App.getTransactionRewardEstimate = function'), context)

  const estimate = context.App.calculateSelectedRewardEstimate(
    { type:'expense', walletId:'card-1', amount:100, date:'2026-10-04' },
    ['exclusive', 'stackable'],
  )

  assert.equal(estimate.cashback, 10)
  assert.deepEqual(Array.from(estimate.rules, row => row.ruleId), ['exclusive'])
})

function walletDeletionRuntime(state, persistResult = true) {
  const context = {
    S: state,
    App: { closeOverlay() {}, render() {} },
    walletById: id => state.wallets.find(wallet => wallet.id === id),
    persist: () => persistResult,
    toast() {},
  }
  vm.createContext(context)
  vm.runInContext(section('  App.deleteWallet = function', '  App.deleteCategory = function'), context)
  return context
}

test('deleting an unreferenced credit card cascades its benefit configuration', () => {
  const state = {
    wallets:[{ id:'card-1', type:'credit' }, { id:'cash-1', type:'cash' }],
    transactions:[], recurring:[], loans:[], bnplPlans:[], rewardLedger:[],
    ccBenefits:{ 'card-1':{ cashback:true }, 'other':{} },
    ccBenefitRules:[{ id:'rule-1', cardId:'card-1' }, { id:'rule-2', cardId:'other' }],
    creditCardPromotions:[{ id:'promo-1', cardId:'card-1' }, { id:'promo-2', cardId:'other' }],
    creditCardPromoSearches:[{ id:'search-1', cardId:'card-1' }, { id:'search-2', cardId:'other' }],
  }
  const context = walletDeletionRuntime(state)

  context.App.deleteWallet('card-1')

  assert.deepEqual(Array.from(state.wallets, row => row.id), ['cash-1'])
  assert.equal(state.ccBenefits['card-1'], undefined)
  assert.deepEqual(Array.from(state.ccBenefitRules, row => row.id), ['rule-2'])
  assert.deepEqual(Array.from(state.creditCardPromotions, row => row.id), ['promo-2'])
  assert.deepEqual(Array.from(state.creditCardPromoSearches, row => row.id), ['search-2'])
})

test('a credit card referenced by reward history is archived instead of deleted', () => {
  const card = { id:'card-1', type:'credit' }
  const state = {
    wallets:[card], transactions:[], recurring:[], loans:[], bnplPlans:[],
    rewardLedger:[{ id:'reward-1', cardId:'card-1' }],
    ccBenefits:{ 'card-1':{} }, ccBenefitRules:[],
  }
  const context = walletDeletionRuntime(state)

  context.App.deleteWallet('card-1')

  assert.equal(state.wallets.length, 1)
  assert.equal(card.archived, true)
  assert.ok(state.ccBenefits['card-1'])
})

test('credit-card deletion restores cascaded benefit data when persistence fails', () => {
  const card = { id:'card-1', type:'credit' }
  const benefit = { cashback:true }
  const rule = { id:'rule-1', cardId:'card-1' }
  const state = {
    wallets:[card], transactions:[], recurring:[], loans:[], bnplPlans:[], rewardLedger:[],
    ccBenefits:{ 'card-1':benefit }, ccBenefitRules:[rule],
    creditCardPromotions:[], creditCardPromoSearches:[],
  }
  const context = walletDeletionRuntime(state, false)

  context.App.deleteWallet('card-1')

  assert.equal(state.wallets[0], card)
  assert.equal(state.ccBenefits['card-1'], benefit)
  assert.equal(state.ccBenefitRules[0], rule)
})

test('active benefit rules reject incomplete rewards, thresholds, and reversed dates', () => {
  const context = { App:{} }
  vm.createContext(context)
  vm.runInContext(section('  function validateBenefitRule', '  function buildLegacyBenefitRules'), context)

  assert.match(context.App.validateBenefitRule({
    active:true, type:'cashback', cashback:{mode:'percent', rate:null},
    rewardTrigger:{mode:'none'}, validity:{mode:'always'},
  }), /cashback|เงินคืน/i)
  assert.match(context.App.validateBenefitRule({
    active:true, type:'cashback', cashback:{mode:'percent', rate:5},
    rewardTrigger:{mode:'cycle_spend_threshold', thresholdAmount:null}, validity:{mode:'always'},
  }), /threshold|ยอดสะสม/i)
  assert.match(context.App.validateBenefitRule({
    active:true, type:'cashback', cashback:{mode:'percent', rate:5},
    rewardTrigger:{mode:'none'}, validity:{mode:'range', startDate:'2026-12-01', endDate:'2026-10-01'},
  }), /วัน|date/i)
  assert.equal(context.App.validateBenefitRule({
    active:true, type:'cashback', cashback:{mode:'percent', rate:5},
    rewardTrigger:{mode:'none'}, validity:{mode:'range', startDate:'2026-10-01', endDate:'2026-12-01'},
  }), '')
})

test('toggling a benefit rule rolls back when durable persistence fails', () => {
  const rule = { id:'rule-1', cardId:'card-1', active:true }
  const context = {
    S: { ccBenefitRules:[rule] },
    App: { ensureCCBenefitRulesState() {}, validateBenefitRule: () => '' },
    persist: () => false,
    notify() {},
  }
  vm.createContext(context)
  vm.runInContext(section('  App.toggleCCBenefitRule = function', '  App.deleteCCBenefitRule = function'), context)

  context.App.toggleCCBenefitRule('rule-1')

  assert.equal(rule.active, true)
})

test('benefit suggestions choose cycle boundaries from the effective override date', () => {
  const cycleDates = []
  const rule = {
    id:'rule-1', active:true, priority:0, isBaseRule:false,
    suggestedConditions:{},
    rewardTrigger:{mode:'cycle_spend_threshold', thresholdAmount:1000, trackChannels:['online']},
    limits:{maxRewardAmountPerMerchantPerCycle:100},
  }
  const context = {
    App: {
      getCreditCardBenefitRules: () => [rule],
      getRuleCycleUsage: () => ({ trackChannelSpendBefore:0 }),
    },
    ensureCCBenefitRulesState() {},
    getRuleEligibility: () => ({ matched:true, merchantMatch:true, channelMatch:true, timeMatch:true }),
    getBenefitCapScopes: () => ['merchant', 'channel'],
    getCyclePeriodForDate: (_cardId, refDate) => {
      cycleDates.push(refDate)
      return { start:'2026-11-01', end:'2026-11-30' }
    },
    resolveBenefitTxDate: tx => tx.benefitDateOverride || tx.date,
    getTriggerTrackChannels: () => ['online'],
    normalizeBenefitCompareValue: (_type, value) => Number(value || 0),
    rewardUsedForRuleScope: () => 0,
    formatTrackChannelLabel: () => 'online',
    getFullyUsedReasonForRule: () => '',
    today: () => '2026-10-04',
  }
  vm.createContext(context)
  vm.runInContext(section('  App.getSuggestedBenefitRules = function', '  App.getRuleCycleUsage = function'), context)

  context.App.getSuggestedBenefitRules({
    id:'tx-1', type:'expense', walletId:'card-1', amount:100,
    date:'2026-10-31', benefitDateOverride:'2026-11-01', merchant:'Shop', channel:'online',
  })

  assert.ok(cycleDates.length >= 2)
  assert.ok(cycleDates.every(date => date === '2026-11-01'))
})

test('point-rule suggestions detect exhausted merchant caps in point units', () => {
  const context = {
    benefitValueAtOrAboveCap: (_type, value, cap) => Number(value || 0) >= Number(cap || 0),
    getBenefitCapScopes: () => ['merchant', 'channel'],
  }
  vm.createContext(context)
  vm.runInContext(section('  function rewardUsedForRuleType', '  App.getSuggestedBenefitRules = function'), context)

  const reason = vm.runInContext(`getFullyUsedReasonForRule(
    { type:'points', validity:{statementCycleHint:'calendar_month'}, limits:{maxRewardAmountPerMerchantPerCycle:100} },
    { merchant:'Shop' },
    { matched:true, merchantMatch:true, channelMatch:true },
    { cashbackUsedByMerchantBefore:0, pointsUsedByMerchantBefore:100 }
  )`, context)

  assert.equal(reason, 'ร้านนี้ครบแล้ว')
})

test('any-mode channel matches ignore an exhausted merchant cap', () => {
  const context = {
    benefitValueAtOrAboveCap: (_type, value, cap) => Number(value || 0) >= Number(cap || 0),
    getBenefitCapScopes: (_rule, eligibility) => eligibility.capScopes,
  }
  vm.createContext(context)
  vm.runInContext(section('  function rewardUsedForRuleType', '  App.getSuggestedBenefitRules = function'), context)

  const reason = vm.runInContext(`getFullyUsedReasonForRule(
    { type:'cashback', validity:{statementCycleHint:'calendar_month'}, limits:{maxRewardAmountPerMerchantPerCycle:30, maxRewardAmountPerChannelPerCycle:30} },
    { merchant:'Shop X', channel:'A' },
    { matched:true, merchantMatch:true, channelMatch:true, capScopes:['channel'] },
    { cashbackUsedByMerchantBefore:30, cashbackUsedByChannelBefore:0 }
  )`, context)

  assert.equal(reason, '')
})

test('rule status treats an exhausted eligible-spend cap as fully used even with a reward cap', () => {
  const context = {
    App: {},
    benefitValueAtOrAboveCap: (_type, value, cap) => Number(value || 0) >= Number(cap || 0),
    getBenefitCapScopes: () => ['merchant', 'channel'],
  }
  vm.createContext(context)
  vm.runInContext(section('  function rewardUsedForRuleType', '  App.getSuggestedBenefitRules = function'), context)

  const reason = vm.runInContext(`getFullyUsedReasonForRule(
    { type:'cashback', validity:{statementCycleHint:'calendar_month'}, limits:{maxEligibleSpendPerCycle:100, maxRewardAmountPerCycle:1000} },
    {},
    { matched:true, merchantMatch:true, channelMatch:true },
    { eligibleSpendUsedBefore:100, cashbackUsedBefore:1 }
  )`, context)

  assert.equal(reason, 'ยอดใช้จ่ายครบแล้วเดือนนี้')
})

test('legacy migration keeps custom rules and adds missing enabled legacy rules', () => {
  const state = {
    ccBenefits: {
      'card-1': { cashback: { enabled:true, percent:1, everyBaht:500 } },
    },
    ccBenefitRules: [{ id:'custom', cardId:'card-1', type:'cashback', cashback:{mode:'percent',rate:2} }],
    migrations: {},
  }
  const context = {
    S: state,
    App: {},
    genId: () => 'generated-rule',
    parseRuleNumber: value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null,
    normalizeCompareText: value => String(value || '').toLowerCase(),
    normalizeTrackChannels: () => [],
  }
  vm.createContext(context)
  vm.runInContext(section('  function normalizeBenefitRule', '  App.normalizeBenefitRule = normalizeBenefitRule'), context)
  vm.runInContext(section('  function buildLegacyBenefitRules', '  App.getCyclePeriodForDate = function'), context)

  context.App.ensureCCBenefitRulesState()

  assert.deepEqual(Array.from(state.ccBenefitRules, rule => rule.id), ['custom', 'legacy-cashback-card-1'])
  assert.equal(state.ccBenefitRules[1].cashback.everyBaht, 500)
})

test('disabled legacy benefit data does not create an active migrated rule', () => {
  const state = {
    ccBenefits: {
      'card-1': { enabled:false, cashback: { enabled:false, percent:1, everyBaht:500 } },
    },
    ccBenefitRules: [],
    migrations: {},
  }
  const context = {
    S: state,
    App: {},
    genId: () => 'generated-rule',
    parseRuleNumber: value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null,
    normalizeCompareText: value => String(value || '').toLowerCase(),
    normalizeTrackChannels: () => [],
  }
  vm.createContext(context)
  vm.runInContext(section('  function normalizeBenefitRule', '  App.normalizeBenefitRule = normalizeBenefitRule'), context)
  vm.runInContext(section('  function buildLegacyBenefitRules', '  App.getCyclePeriodForDate = function'), context)

  context.App.ensureCCBenefitRulesState()

  assert.equal(state.ccBenefitRules.length, 0)
})

test('step three form values are copied into the draft before navigating back', () => {
  const values = {
    'ccbr-trigger-threshold':'2000',
    'ccbr-limit-reward-tx':'50',
    'ccbr-limit-reward-cycle':'100',
    'ccbr-limit-eligible-tx':'500',
    'ccbr-limit-eligible-cycle':'3000',
    'ccbr-limit-eligible-merchant':'200',
    'ccbr-limit-reward-merchant':'30',
    'ccbr-limit-eligible-channel':'1000',
    'ccbr-limit-reward-channel':'50',
    'ccbr-priority':'7',
  }
  const classes = {
    'ccbr-trigger-toggle':['on'],
    'ccbr-grant-every':['active'],
    'ccbr-stacking':['on'],
    'ccbr-base':['on'],
  }
  const context = {
    App: { _ccbrDraft: {
      _step:3, type:'cashback', _trackChannels:['online'],
      rewardTrigger:{mode:'cycle_spend_threshold'}, limits:{},
    } },
    document: {
      getElementById(id) {
        return {
          value: values[id] || '',
          classList: { contains(name) { return (classes[id] || []).includes(name) } },
        }
      },
    },
  }
  vm.createContext(context)
  vm.runInContext(section('  App._ccbrReadStep = function', '  App._ccbrStep1Html = function'), context)

  context.App._ccbrReadStep(3)

  assert.equal(context.App._ccbrDraft.rewardTrigger.thresholdAmount, 2000)
  assert.equal(context.App._ccbrDraft.rewardTrigger.grantMode, 'every_threshold')
  assert.equal(context.App._ccbrDraft.limits.maxRewardAmountPerCycle, 100)
  assert.equal(context.App._ccbrDraft.limits.maxRewardAmountPerChannelPerCycle, 50)
  assert.equal(context.App._ccbrDraft.priority, 7)
})

test('point-rule cap form uses point units while eligible-spend caps stay in Baht', () => {
  const context = {
    App: { getBenefitChannelOptions: () => [['online', 'ออนไลน์']] },
    S: { categories: { expense: [] } },
    getTriggerTrackChannels: () => [],
    esc: value => String(value || ''),
  }
  vm.createContext(context)
  vm.runInContext(section('  App._ccbrSetType = function', '  App._ccbrRenderStep = function'), context)

  const html = context.App._ccbrStep3Html({
    type:'points', allowStacking:true, isBaseRule:false,
    points:{bahtPerPoint:10, multiplier:1}, limits:{}, rewardTrigger:{}, _trackChannels:[],
  })

  assert.match(html, /id="ccbr-limit-reward-tx"[\s\S]*?>คะแนน<\/span>/)
  assert.match(html, /id="ccbr-limit-eligible-tx"[\s\S]*?>฿<\/span>/)
})
