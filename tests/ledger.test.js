const test = require('node:test')
const assert = require('node:assert/strict')

const Ledger = require('../ledger.js')

const wallets = [
  { id:'cash', type:'bank', openingBalance:1000 },
  { id:'card', type:'credit', openingBalance:0 },
  { id:'gold', type:'gold', openingUnits:1 },
]

test('Ledger computes every Transaction flow and excludes future Scheduled Transactions', () => {
  const transactions = [
    { id:'income', type:'income', walletId:'cash', amount:500, date:'2026-08-01' },
    { id:'expense', type:'expense', walletId:'cash', amount:100, date:'2026-08-02' },
    { id:'transfer', type:'transfer', walletId:'cash', toWalletId:'card', amount:50, date:'2026-08-03' },
    { id:'payment', type:'cc_payment', walletId:'cash', toWalletId:'card', amount:80, cashAmount:75, date:'2026-08-04' },
    { id:'gold-buy', type:'investment_buy', walletId:'gold', cashWalletId:'cash', amount:200, units:.5, date:'2026-08-05' },
    { id:'future', type:'expense', walletId:'cash', amount:999, date:'2026-09-01', scheduled:true },
  ]
  const flows = Ledger.compute({ transactions, wallets, today:'2026-08-09' })
  assert.equal(flows.cash.cash, 75)
  assert.equal(flows.cash.card, 130)
  assert.equal(flows.units.gold, .5)
})

test('Ledger owns credit reward discount semantics and persisted Ledger Amount preference', () => {
  const tx = { type:'expense', walletId:'card', amount:1000, ledgerAmount:950 }
  assert.equal(Ledger.getLedgerAmountForTx(tx, { wallets }), 950)
  assert.equal(Ledger.getLedgerAmountForTx(tx, {
    wallets,
    preferStored:false,
    rewardForTx:() => ({ discount:125 }),
  }), 875)
})

test('Ledger includes Loan principal and repayments without a runtime patch', () => {
  const flows = Ledger.compute({
    wallets,
    loans:[{ id:'loan', walletId:'cash', amount:300, repayments:[{ walletId:'cash', amount:120 }] }],
  })
  assert.equal(flows.cash.cash, -180)
})

test('Ledger validates Wallet references and reconciles cash and investment Wallets', () => {
  const issues = Ledger.validateIntegrity({
    wallets,
    transactions:[{ id:'bad', type:'transfer', walletId:'missing', toWalletId:'cash', amount:10, date:'2026-08-01' }],
    today:'2026-08-09',
  })
  assert.deepEqual(issues, [{ txId:'bad', date:'2026-08-01', field:'walletId', value:'missing' }])

  const rows = Ledger.reconcileWallets({
    wallets,
    flows:{ cash:{ cash:250 }, units:{ gold:.5 } },
    investmentUnitPrice:wallet => wallet.id === 'gold' ? 2000 : 0,
  })
  assert.deepEqual(rows.find(row => row.id === 'cash'), { id:'cash', balance:1250 })
  assert.deepEqual(rows.find(row => row.id === 'gold'), { id:'gold', units:1.5, balance:3000 })
})
