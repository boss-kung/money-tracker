const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const Ledger = require('../ledger.js')
const StateCommit = require('../state_commit.js')
const SafeRender = require('../safe_render.js')

const source = fs.readFileSync(require.resolve('../app_v2.js'), 'utf8')
const loanSource = fs.readFileSync(require.resolve('../loans_v2.js'), 'utf8')

function section(start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `missing runtime section: ${start}`)
  return source.slice(from, to)
}

function runtime(wallets, transactions = []) {
  let scans = 0
  let snapshots = 0
  let writes = 0
  let refDate = '2026-10-02'
  let rejectStorage = false
  const state = { wallets, transactions, loans:[], recurring:[], settings:{} }
  let durable = JSON.parse(JSON.stringify(state))
  const notices = []
  const context = {
    S:state, App:{}, window:{ MTLedger:Ledger, MTStateCommit:StateCommit }, MTStateCommit:StateCommit,
    MTLedger:Ledger, MTSafeRender:SafeRender,
    MT_STORAGE_HYDRATED:true, MT_STATE_COMMIT:null,
    Storage:{
      saveAll:() => {
        writes++
        if (rejectStorage) return false
        durable = JSON.parse(JSON.stringify(state))
        return true
      },
      init:() => JSON.parse(JSON.stringify(durable)),
    },
    ensureV4State() {}, getTODAY:() => refDate, today:() => refDate,
    localNow:() => '2026-10-02T00:00:00Z', console:{ warn() {}, error() {} },
    toast:(message, type) => notices.push({ message, type }),
    INVEST_TYPES:new Set(['gold', 'crypto', 'fcd']),
  }
  context.App._ledgerFlows = () => {
    scans++
    return Ledger.compute({ wallets:state.wallets, transactions:state.transactions, loans:state.loans, today:refDate })
  }
  context.App._investmentUnitPriceTHB = () => 100
  context.App.recordNetWorthSnapshot = () => { snapshots++ }
  vm.createContext(context)
  vm.runInContext(section('  function isInvestWallet(w)', '  function isTransferableMoneyWallet(w)'), context)
  vm.runInContext(section('  App.ensureLedgerBaselines = function(', '  App.recordNetWorthSnapshot = function('), context)
  vm.runInContext(section('  App._beforePersistV40 = function()', '  // ── Ledger balance source of truth'), context)
  vm.runInContext(section('function getStateCommit()', 'function moneyFmt('), context)
  vm.runInContext(loanSource.slice(loanSource.indexOf('  function genId()'), loanSource.indexOf('  // ── UI ')), context)
  return {
    context, state,
    counts:() => ({ scans, snapshots, writes }),
    setDate:date => { refDate = date },
    rejectStorage:() => { rejectStorage = true }, notices,
  }
}

test('wallet reconciliation derives baselines and balances with one Ledger scan', () => {
  const { context, state, counts } = runtime(
    [{ id:'bank', type:'bank', balance:900 }, { id:'gold', type:'gold', units:2, balance:200 }],
    [{ id:'expense', type:'expense', walletId:'bank', amount:100, date:'2026-10-02' },
      { id:'buy', type:'investment_buy', walletId:'gold', units:0.5, date:'2026-10-02' }],
  )
  context.App.recalculateWalletBalances({ recordSnapshot:true })
  assert.equal(state.wallets[0].openingBalance, 1000)
  assert.equal(state.wallets[0].balance, 900)
  assert.equal(state.wallets[1].openingUnits, 1.5)
  assert.equal(state.wallets[1].units, 2)
  assert.equal(state.wallets[1].balance, 200)
  assert.deepEqual(counts(), { scans:1, snapshots:1, writes:0 })
})

test('reconciliation refreshes on a new Posted date and in-place Transaction edits', () => {
  const r = runtime([{ id:'bank', type:'bank', openingBalance:1000, balance:1000 }],
    [{ id:'scheduled', type:'expense', walletId:'bank', amount:100, date:'2026-10-03' }])
  r.context.App.recalculateWalletBalances()
  assert.equal(r.state.wallets[0].balance, 1000)
  r.setDate('2026-10-03')
  r.context.App.recalculateWalletBalances()
  assert.equal(r.state.wallets[0].balance, 900)
  r.state.transactions[0].amount = 250
  r.context.App.recalculateWalletBalances()
  assert.equal(r.state.wallets[0].balance, 750)
  assert.equal(r.counts().scans, 3)
})

test('Loan creation reconciles and records its snapshot once through the durable commit', () => {
  const r = runtime([{ id:'bank', type:'bank', openingBalance:1000, balance:1000 }])
  r.context.window.LoanStore.create({ walletId:'bank', amount:100, date:'2026-10-02', borrowerName:'Borrower' })
  assert.equal(r.state.wallets[0].balance, 900)
  assert.equal(r.state.loans.length, 1)
  assert.deepEqual(r.counts(), { scans:1, snapshots:1, writes:1 })
})

function transactionRuntime() {
  const r = runtime([{ id:'bank', type:'bank', openingBalance:1000, balance:1000 }])
  Object.assign(r.state, {
    tx:{ type:'income', amount:'100', walletId:'bank', categoryId:'salary', date:'2026-10-02' },
    txMode:'add', page:'dashboard',
  })
  Object.assign(r.context, {
    Calc:{ genId:() => 'new-transaction' },
    nextTransactionCreationSequence:() => 1,
    cleanTxFromDraft:id => ({ ...r.state.tx, id, amount:Number(r.state.tx.amount) }),
    round2:value => Math.round(Number(value || 0) * 100) / 100,
    document:{ activeElement:null, body:{ classList:{ remove() {} } } },
    notify:r.context.toast,
  })
  Object.assign(r.context.App, {
    validateTransactionDraft:() => null,
    _rewardEstimateForTx:() => null,
    closeOverlay() {}, showPage() {}, render() {},
  })
  vm.runInContext(section('  App.saveTx = function()', '  function isValidImportDate('), r.context)
  return r
}

test('Transaction save returns durable success and reconciles once', () => {
  const r = transactionRuntime()
  assert.equal(r.context.App.saveTx(), true)
  assert.equal(r.state.transactions.length, 1)
  assert.equal(r.state.wallets[0].balance, 1100)
  assert.deepEqual(r.counts(), { scans:1, snapshots:1, writes:1 })
})

test('failed Transaction storage restores the financial state without success feedback', () => {
  const r = transactionRuntime()
  r.rejectStorage()
  assert.equal(r.context.App.saveTx(), false)
  assert.equal(r.state.transactions.length, 0)
  assert.equal(r.state.wallets[0].balance, 1000)
  assert.equal(r.notices.some(notice => notice.type === 'success'), false)
})

function loadBNPL(context) {
  const document = context.document
  delete context.document
  vm.runInContext(fs.readFileSync(require.resolve('../bnpl.js'), 'utf8'), context)
  context.document = document
  context.BNPL = context.window.BNPL
  return context.BNPL
}

test('BNPL plan creation can defer persistence to its enclosing Transaction commit', () => {
  const r = runtime([{ id:'bnpl', type:'bnpl', balance:0, openingBalance:0 }])
  const bnpl = loadBNPL(r.context)
  const data = { walletId:'bnpl', txId:'purchase', totalAmount:900, installments:3, purchaseDate:'2026-10-02' }
  bnpl.store.createPlan(data, { save:false })
  assert.equal(r.state.bnplPlans.length, 1)
  assert.equal(r.state.bnplPlans[0].schedule.reduce((sum, row) => sum + row.amount, 0), 900)
  assert.equal(r.counts().writes, 0)
  bnpl.store.createPlan({ ...data, txId:'standalone' })
  assert.equal(r.counts().writes, 1)
})

test('onboarding first-save nudge follows the durable Transaction result', () => {
  const Hooks = require('../screen_hooks.js')
  Hooks.reset()
  const source = fs.readFileSync(require.resolve('../onboarding.js'), 'utf8')
  let seen = false, nudges = 0
  const state = { transactions:[], txMode:'add' }
  const app = { saveTx(ok) { if (ok) state.transactions.push({ id:'saved' }); return ok } }
  const context = { App:app, MTScreenHooks:Hooks, S:state, _obGet:() => ({ firstTxNudgeSeen:seen }),
    _obPatch:patch => { seen = patch.firstTxNudgeSeen }, setTimeout:fn => fn(), toast:() => nudges++ }
  // Load just the onboarding save integration, with an actual wrapped save seam.
  vm.createContext(context)
  const start = source.indexOf('  const _prevSaveTxOB') >= 0 ? source.indexOf('  const _prevSaveTxOB') : source.indexOf("  MTScreenHooks.register('transactionSave'")
  const end = source.indexOf('  // ════════════════════════════════════════════════════════════\n  // PRIORITY 3:', start)
  vm.runInContext(source.slice(start, end), context)
  Hooks.install(app, { transactionSave:'saveTx' })
  assert.equal(app.saveTx(false), false)
  assert.equal(nudges, 0)
  assert.equal(seen, false)
  assert.equal(app.saveTx(true), true)
  assert.equal(nudges, 1)
  assert.equal(app.saveTx(false), false)
  assert.equal(nudges, 1)
  Hooks.reset()
})
