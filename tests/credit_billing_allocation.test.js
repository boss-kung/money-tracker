const test = require('node:test')
const assert = require('node:assert/strict')
const CC = require('../credit_card_cycles.js')
const Ledger = require('../ledger.js')
const card = {id:'c', type:'credit', cycleDay:25, dueAfterCycleDays:10}
const purchase = (id,date,amount) => ({id,date,amount,type:'expense',walletId:'c'})
const payment = (id,date,amount,statementId) => ({id,date,amount,statementId,type:'cc_payment',walletId:'cash',toWalletId:'c'})
const credit = (id,date,amount,statementId) => ({id,date,amount,statementId,type:'income',walletId:'c'})
const sid = 'c:2026-04-26:2026-05-25'
function billing(transactions,refDate='2026-06-26',extra={}) {
  assert.equal(typeof CC.buildCardBillingState, 'function')
  const c = {...card,...extra}
  const state = CC.buildCardBillingState({card:c,transactions,refDate})
  const flow = Ledger.compute({wallets:[c],transactions,today:refDate})
  const balance = Number(c.openingBalance || 0) + Number(flow.cash.c || 0)
  assert.equal(Math.round((state.statements.reduce((s,r)=>s+r.balanceDue,0)-state.creditBalance)*100), Math.round(-balance*100) || 0)
  return state
}
test('paid opening debt stays paid after the next cycle',()=> {
  const txs=[payment('p','2026-06-01',5000,sid)]
  for (const ref of ['2026-06-03','2026-06-26','2026-08-26']) assert.deepEqual(billing(txs,ref,{openingBalance:-5000}).payableStatements,[])
})
test('prepayment pays open spending and is not charged again at close',()=> {
  const txs=[purchase('e','2026-06-01',1000),payment('p','2026-06-03',1000,sid)]
  assert.deepEqual(billing(txs).payableStatements,[])
})
test('payment surplus settles other cycles and remains as credit',()=> {
  const txs=[purchase('a','2026-05-10',1000),purchase('b','2026-06-10',1000),payment('p','2026-07-01',2500,sid)]
  const result=billing(txs,'2026-07-02')
  assert.deepEqual(result.payableStatements,[])
  assert.equal(result.creditBalance,500)
  assert.equal(result.allocations.reduce((sum,a)=>sum+a.amount,0),2000)
})
test('statement credit after cycle end reduces the referenced bill',()=> {
  const result=billing([purchase('e','2026-05-10',1000),credit('c1','2026-06-01',100,sid)],'2026-06-03')
  assert.equal(result.payableStatements[0].balanceDue,900)
})
test('late untagged payments and initial positive credit are applied',()=> {
  assert.deepEqual(billing([purchase('e','2026-05-10',1000),payment('p','2026-06-20',1000)]).payableStatements,[])
  assert.equal(billing([purchase('e','2026-05-10',1000)],'2026-06-03',{openingBalance:2000}).creditBalance,1000)
})
test('future payment does not hide partial debt and discounts reduce full debt',()=> {
  const txs=[purchase('e','2026-05-10',5000),{...payment('p','2026-06-01',2000,sid),cashAmount:1900,discountAmount:100},payment('future','2026-06-10',3000,sid)]
  assert.equal(billing(txs,'2026-06-03').payableStatements[0].balanceDue,3000)
})
test('allocation is deterministic and includes card transfers',()=> {
  const txs=[purchase('e','2026-05-10',1000),{id:'t',type:'transfer',walletId:'cash',toWalletId:'c',amount:300,date:'2026-05-20'},credit('r','2026-05-20',100,'other:bad')]
  const a=billing(txs,'2026-06-03'),b=billing([...txs].reverse(),'2026-06-03')
  assert.equal(a.payableStatements[0].balanceDue,600)
  assert.deepEqual(a.allocations,b.allocations)
  assert.ok(a.reconciliation.diagnostics.length)
})
test('credited money before a purchase retains transaction provenance',()=> {
  const result=billing([payment('p','2026-05-01',1000),purchase('e','2026-05-10',750)],'2026-06-03')
  assert.equal(result.creditBalance,250)
  assert.deepEqual(result.allocations.map(a=>[a.transactionId,a.amount]),[['p',750]])
})

test('closed statement boundaries survive changed cycle settings',()=> {
 const txs=[purchase('e','2026-05-10',1000)]
 const migrated=CC.prepareBillingMigration({wallets:[card],transactions:txs,refDate:'2026-06-03'}).wallets[0]
 const result=billing(txs,'2026-06-03',{...migrated,cycleDay:19,dueAfterCycleDays:20})
 assert.equal(result.payableStatements[0].id,sid)
 assert.equal(result.payableStatements[0].dueDate,'2026-06-04')
})
test('future tagged payment cannot move opening debt into an open cycle',()=> {
 const result=billing([payment('future','2026-07-01',5000,'c:2026-05-26:2026-06-25')],'2026-06-03',{openingBalance:-5000})
 assert.equal(result.payableStatements[0].id,sid)
 assert.equal(result.payableStatements[0].balanceDue,5000)
})
test('transfer to the same credit wallet has zero billing effect',()=> {
 assert.equal(billing([{id:'self',type:'transfer',walletId:'c',toWalletId:'c',date:'2026-05-10',amount:1000}],'2026-06-03').creditBalance,0)
})
