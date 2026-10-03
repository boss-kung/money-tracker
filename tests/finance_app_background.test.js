const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../app_v2.js'), 'utf8')

function runtime() {
  const timers = new Map()
  const idle = []
  const rebuilds = []
  const contexts = []
  const listeners = new Map()
  let timerId = 0
  let synchronousCalls = 0
  const context = {
    App:{}, S:{transactions:[{id:'t', amount:100}]}, window:{},
    document:{visibilityState:'visible', getElementById:() => null, addEventListener:(name, fn) => listeners.set(name, fn)},
    performance:{now:() => 0}, now:() => '2026-10',
    Calc:{getPreviousMonth:() => '2026-09'},
    setTimeout:fn => { timers.set(++timerId, fn); return timerId },
    clearTimeout:id => timers.delete(id),
    requestIdleCallback:fn => idle.push(fn),
    FinanceIntelligence:{
      isFeatureStoreFresh:() => false,
      loadFeatureStore:() => ({rows:[]}),
      rebuildFeatureStoreIncremental() { synchronousCalls++; return [] },
      rebuildFeatureStoreIncrementalAsync(_state, opts) { return new Promise(resolve => rebuilds.push({opts, resolve})) },
      buildContext() { synchronousCalls++; return {} },
      buildContextAsync(_state, opts) { return new Promise(resolve => contexts.push({opts, resolve})) },
      proactiveBrief:() => ({alerts:[], headline:'ready'}),
    },
  }
  vm.createContext(context)
  const from = source.indexOf('  function financeMark(')
  const to = source.indexOf('  App.saveFinancialMemory = ', from)
  vm.runInContext(source.slice(from, to), context)
  const runTimers = () => { const batch = [...timers.values()]; timers.clear(); batch.forEach(fn => fn()) }
  return {context, rebuilds, contexts, idle, listeners, runTimers, synchronousCalls:() => synchronousCalls}
}

test('finance rebuild awaits the yielding implementation rather than a synchronous full task', async () => {
  const r = runtime()
  const promise = r.context.App.rebuildFinanceFeaturesIfNeeded({force:true})
  assert.equal(typeof promise?.then, 'function')
  assert.equal(r.synchronousCalls(), 0)
  assert.equal(r.rebuilds.length, 1)
  r.rebuilds[0].resolve([{month:'2026-10'}])
  assert.equal((await promise)[0].month, '2026-10')
})

test('automatic rebuild delegates freshness checks to the yielding implementation', async () => {
  const r = runtime()
  r.context.FinanceIntelligence.isFeatureStoreFresh = () => { throw new Error('synchronous ledger scan') }
  const promise = r.context.App.rebuildFinanceFeaturesIfNeeded({reason:'boot'})
  assert.equal(r.rebuilds.length, 1)
  r.rebuilds[0].resolve([{month:'2026-10'}])
  assert.equal((await promise).length, 1)
})

test('a commit invalidates an active rebuild before its outdated results are used', async () => {
  const r = runtime()
  const promise = r.context.App.rebuildFinanceFeaturesIfNeeded({force:true})
  assert.equal(r.rebuilds.length, 1)
  assert.equal(r.rebuilds[0].opts.shouldCancel(), false)
  r.context.S.transactions[0].amount = 200
  r.context.App.scheduleFinanceFeatureRebuild({reason:'saveTx'})
  assert.equal(r.rebuilds[0].opts.shouldCancel(), true)
  r.rebuilds[0].resolve([{month:'2026-10', outdated:true}])
  assert.equal((await promise).length, 0)
})

test('a queued idle callback cannot start an obsolete rebuild after another commit', () => {
  const r = runtime()
  r.context.App.scheduleFinanceFeatureRebuild({reason:'saveTx'})
  r.runTimers()
  assert.equal(r.idle.length, 1)
  r.context.App.scheduleFinanceFeatureRebuild({reason:'deleteTx'})
  r.idle.shift()()
  assert.equal(r.synchronousCalls(), 0)
  assert.equal(r.rebuilds.length, 0)
})

test('a rebuild delayed by a hidden tab resumes when the tab becomes visible', () => {
  const r = runtime()
  r.context.App.scheduleFinanceFeatureRebuild({reason:'saveTx'})
  r.context.document.visibilityState = 'hidden'
  r.runTimers()
  r.context.document.visibilityState = 'visible'
  r.listeners.get('visibilitychange')?.()
  r.runTimers()
  r.idle.shift()?.()
  assert.equal(r.rebuilds.length, 1)
})

test('brief refresh yields and cannot cache results from before an in-place transaction edit', async () => {
  const r = runtime()
  r.context.App.scheduleFinanceBriefRefresh()
  r.runTimers()
  r.idle.shift()()
  assert.equal(r.contexts.length, 1)
  assert.equal(r.synchronousCalls(), 0)
  r.context.S.transactions[0].amount = 200
  r.context.App.scheduleFinanceFeatureRebuild({reason:'saveTx'})
  assert.equal(r.contexts[0].opts.shouldCancel(), true)
  r.contexts[0].resolve({})
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(r.context.App.getCachedFinanceBrief(), null)
})

test('a transaction edit with the same row count immediately invalidates a cached finance brief', () => {
  const r = runtime()
  r.context.App._financeBriefCache = {month:'2026-10', sourceSize:1, brief:{headline:'old'}}
  r.context.App.scheduleFinanceFeatureRebuild({reason:'saveTx'})
  assert.equal(r.context.App.getCachedFinanceBrief(), null)
})

test('opening feature history paints immediately and does not reopen it after navigating away', async () => {
  const r = runtime()
  const screens = []
  let screenNode = {}
  let finish
  const store = {rows:[]}
  r.context.FinanceIntelligence.loadFeatureStore = () => store
  r.context.App.rebuildFinanceFeaturesIfNeeded = () => new Promise(resolve => { finish = resolve })
  r.context.App.openSubScreen = html => screens.push(html)
  r.context.document.getElementById = () => screenNode
  for (const name of ['_financeScreenIntro','_financeEmptyVisual','_financeJourneyLinks','_financeSparkBars']) r.context.App[name] = () => ''
  r.context.mlbl = String
  const from = source.indexOf('  App.openFeatureHistory = ')
  const to = source.indexOf('  App.openGoalRebalanceCompare = ', from)
  vm.runInContext(source.slice(from, to), r.context)
  r.context.App.openFeatureHistory()
  assert.equal(screens.length, 1)
  assert.match(screens[0], /aria-busy="true"/)
  screenNode = null
  store.rows = [{month:'2026-10', metrics:{expense:100}}]
  finish(store.rows)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(screens.length, 1)
})

test('cancelled initial history stays pending and shows rows after the replacement rebuild completes', async () => {
  const r = runtime()
  const renders = []
  r.context.document.getElementById = () => ({getAttribute:() => 'true'})
  const from = source.indexOf('  App.openFeatureHistory = ')
  const to = source.indexOf('  App.openGoalRebalanceCompare = ', from)
  vm.runInContext(source.slice(from, to), r.context)
  r.context.App._renderFeatureHistory = (store, busy) => renders.push({rows:store.rows, busy})
  r.context.App.openFeatureHistory()
  assert.equal(renders[0].busy, true)
  r.context.document.visibilityState = 'hidden'
  r.listeners.get('visibilitychange')()
  r.rebuilds[0].resolve([])
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(renders.at(-1).busy, true)
  r.context.document.visibilityState = 'visible'
  r.listeners.get('visibilitychange')()
  r.runTimers(); r.idle.shift()()
  r.rebuilds[1].resolve([{month:'2026-10', metrics:{expense:100}}])
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(renders.at(-1).busy, false)
  assert.equal(renders.at(-1).rows.length, 1)
})
