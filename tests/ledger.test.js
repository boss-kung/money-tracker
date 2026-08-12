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

test('Ledger treats every future-dated Transaction as Scheduled until its date', () => {
  const tx = { id:'future-manual', type:'expense', walletId:'cash', amount:500, date:'2026-09-01' }
  assert.equal(Ledger.isPostedTx(tx, '2026-08-09'), false)
  assert.equal(Ledger.compute({ transactions:[tx], wallets, today:'2026-08-09' }).cash.cash, undefined)
  assert.equal(Ledger.isPostedTx(tx, '2026-09-01'), true)
})

test('Ledger applies Loan principal and repayments only when their dates are Posted', () => {
  const flows = Ledger.compute({
    wallets,
    today:'2026-08-09',
    loans:[{
      id:'loan', walletId:'cash', amount:300, date:'2026-08-01',
      repayments:[
        { walletId:'cash', amount:120, date:'2026-08-05' },
        { walletId:'cash', amount:180, date:'2026-09-01' },
      ],
    }],
  })
  assert.equal(flows.cash.cash, -180)

  const futureLoan = Ledger.compute({
    wallets,
    today:'2026-08-09',
    loans:[{ id:'future-loan', walletId:'cash', amount:900, date:'2026-09-01', repayments:[] }],
  })
  assert.equal(futureLoan.cash.cash, undefined)
})

test('Financial Position reports Loan receivables without adding them back to assets', () => {
  const position = Ledger.getFinancialPosition({
    wallets:[
      { id:'cash', type:'bank', balance:1000 },
      { id:'card', type:'credit', balance:-200 },
      { id:'bnpl', type:'bnpl', balance:-100 },
      { id:'excluded', type:'saving', balance:5000, excludeFromNetWorth:true },
    ],
    loans:[{
      id:'loan', amount:300, date:'2026-08-01',
      repayments:[{ amount:100, date:'2026-08-05' }],
    }],
    today:'2026-08-09',
    cryptoValue:50,
    committedLiabilities:400,
  })
  assert.deepEqual(position, {
    walletAssets:1000,
    receivables:200,
    crypto:50,
    assets:1050,
    walletLiabilities:300,
    committedLiabilities:400,
    liabilities:700,
    net:350,
  })
})

test('Financial Position deducts outstanding Loan cash until it is repaid', () => {
  const loan = {
    id:'loan', walletId:'cash', amount:300, date:'2026-08-01',
    repayments:[{ walletId:'cash', amount:100, date:'2026-08-05' }],
  }
  const flows = Ledger.compute({
    wallets:[{ id:'cash', type:'bank', openingBalance:1000 }],
    loans:[loan],
    today:'2026-08-09',
  })
  const [cash] = Ledger.reconcileWallets({
    wallets:[{ id:'cash', type:'bank', openingBalance:1000 }],
    flows,
  })
  const position = Ledger.getFinancialPosition({
    wallets:[{ id:'cash', type:'bank', balance:cash.balance }],
    loans:[loan],
    today:'2026-08-09',
  })

  assert.equal(cash.balance, 800)
  assert.equal(position.receivables, 200)
  assert.equal(position.assets, 800)
  assert.equal(position.net, 800)
})

test('Loan repayment validation rejects future dates and overpayment', () => {
  const loan = { amount:300, date:'2026-08-01', repayments:[{ amount:100, date:'2026-08-05' }] }
  assert.equal(Ledger.validateLoanRepayment(loan, { amount:200, date:'2026-08-09' }, '2026-08-09').ok, true)
  assert.equal(Ledger.validateLoanRepayment(loan, { amount:201, date:'2026-08-09' }, '2026-08-09').code, 'OVERPAYMENT')
  assert.equal(Ledger.validateLoanRepayment(loan, { amount:50, date:'2026-08-10' }, '2026-08-09').code, 'FUTURE_DATE')
  assert.equal(Ledger.validateLoanRepayment(loan, { amount:50, date:'2026-07-31' }, '2026-08-09').code, 'BEFORE_LOAN_DATE')
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
