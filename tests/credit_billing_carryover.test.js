const test = require('node:test')
const assert = require('node:assert/strict')
const CC = require('../credit_card_cycles.js')
const Ledger = require('../ledger.js')
const purchase = (id,date,amount) => ({id,date,amount,type:'expense',walletId:'c'})
const payment = (id,date,amount,statementId) => ({id,date,amount,statementId,type:'cc_payment',walletId:'cash',toWalletId:'c'})
const may = 'c:2026-04-26:2026-05-25', jun = 'c:2026-05-26:2026-06-25', jul = 'c:2026-06-26:2026-07-25'
const makeCard = (carryovers, extra={}) => ({id:'c', type:'credit', cycleDay:25, dueAfterCycleDays:10, ccBilling:{version:2,opening:{statementId:may,start:'2026-04-26',end:'2026-05-25',dueDate:'2026-06-04',provenance:'inferred'},periods:[],carryovers}, ...extra})
function billing(card,transactions,refDate) {
  const state = CC.buildCardBillingState({card,transactions,refDate})
  const flow = Ledger.compute({wallets:[card],transactions,today:refDate})
  const debt = -(Number(card.openingBalance || 0) + Number(flow.cash.c || 0))
  assert.equal(Math.round(state.postedDebt*100), Math.round(Math.max(0,debt)*100))
  assert.equal(state.reconciliation.ok, true)
  return state
}
const row = (state,id) => state.statements.find(r=>r.id===id)
const txs = [purchase('a','2026-05-10',1000),payment('p','2026-06-01',950,may),purchase('b','2026-06-10',500)]

test('carry-forward clears a stale remainder without changing total debt',()=> {
  const before = billing(makeCard(), txs, '2026-07-20')
  assert.equal(row(before,may).status,'overdue')
  const after = billing(makeCard([{id:'co1',fromStatementId:may,toStatementId:jun,amount:50,date:'2026-07-20'}]), txs, '2026-07-20')
  assert.equal(after.postedDebt, before.postedDebt)
  assert.equal(row(after,may).balanceDue,0)
  assert.equal(row(after,may).status,'carried')
  assert.equal(row(after,may).carriedOut,50)
  assert.equal(row(after,jun).balanceDue,550)
  assert.equal(row(after,jun).carriedIn,50)
  assert.ok(after.payableStatements.every(s=>s.id!==may))
})

test('carry-forward never moves more than the remaining balance',()=> {
  const state = billing(makeCard([{id:'co1',fromStatementId:may,toStatementId:jun,amount:999,date:'2026-07-20'}]), txs, '2026-07-20')
  assert.equal(row(state,may).carriedOut,50)
  assert.equal(row(state,jun).balanceDue,550)
})

test('a later payment of the old statement shrinks the carried amount instead of double counting',()=> {
  const paid = [...txs, payment('p2','2026-07-21',50,may)]
  const state = billing(makeCard([{id:'co1',fromStatementId:may,toStatementId:jun,amount:50,date:'2026-07-20'}]), paid, '2026-07-22')
  assert.equal(row(state,may).balanceDue,0)
  assert.equal(row(state,jun).balanceDue,500)
})

test('carry-forward into the open statement and chained carries keep reconciliation',()=> {
  const card = makeCard([{id:'co1',fromStatementId:may,toStatementId:jun,amount:50,date:'2026-07-20'},{id:'co2',fromStatementId:jun,toStatementId:jul,amount:550,date:'2026-07-21'}])
  const state = billing(card, txs, '2026-07-21')
  assert.equal(row(state,jul).status,'open')
  assert.equal(row(state,jul).balanceDue,550)
  assert.deepEqual(state.payableStatements,[])
})

test('invalid or future carry-forward is ignored with a diagnostic',()=> {
  const state = billing(makeCard([{id:'bad',fromStatementId:jun,toStatementId:may,amount:50},{id:'future',fromStatementId:may,toStatementId:jun,amount:50,date:'2026-08-01'}]), txs, '2026-07-20')
  assert.equal(row(state,may).balanceDue,50)
  assert.ok(state.reconciliation.diagnostics.some(d=>d.code==='INVALID_CARRYOVER' && d.carryoverId==='bad'))
})

test('billing migration preserves carryovers',()=> {
  const card = makeCard([{id:'co1',fromStatementId:may,toStatementId:jun,amount:50,date:'2026-07-20'}])
  const next = CC.prepareBillingMigration({wallets:[card],transactions:txs,refDate:'2026-07-20'}).wallets[0]
  assert.deepEqual(next.ccBilling.carryovers, card.ccBilling.carryovers)
})
