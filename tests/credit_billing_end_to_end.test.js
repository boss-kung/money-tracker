const test=require('node:test'),assert=require('node:assert/strict')
const CC=require('../credit_card_cycles.js'),Ledger=require('../ledger.js'),Upcoming=require('../upcoming_obligations.js'),Snapshot=require('../notification_snapshot.js')
test('baseline to full settlement agrees across ledger billing calendar and snapshot after rollover',()=> {
 let card={id:'c',type:'credit',name:'Test',cycleDay:25,dueAfterCycleDays:10,openingBalance:-1000}
 const txs=[{id:'purchase',type:'expense',walletId:'c',amount:500,date:'2026-05-10'}]
 card=CC.prepareBillingMigration({wallets:[card],transactions:txs,refDate:'2026-06-03'}).wallets[0]
 const anchor=card.ccBilling.opening.statementId
 const additions=[null,{id:'partial',type:'cc_payment',walletId:'cash',toWalletId:'c',amount:600,cashAmount:550,date:'2026-06-01',statementId:anchor},{id:'cashback',type:'income',walletId:'c',amount:100,date:'2026-06-02',statementId:anchor},{id:'full',type:'cc_payment',walletId:'cash',toWalletId:'c',amount:800,date:'2026-06-03',statementId:anchor}]
 for(const [index,tx] of additions.entries()) {
  if(tx)txs.push(tx)
  const state=CC.buildCardBillingState({card,transactions:txs,refDate:'2026-06-03'})
  const expected=[1500,900,800,0][index]
  assert.equal(state.payableStatements.reduce((sum,p)=>sum+p.balanceDue,0),expected)
  const ledger=Ledger.compute({wallets:[card],transactions:txs,today:'2026-06-03'})
  assert.equal(-(card.openingBalance+(ledger.cash.c || 0)),expected || -0)
  const rows=Upcoming.projectCreditObligations({billingStates:[{...state,card}],transactions:txs,refDate:'2026-06-03',endDate:'2026-09-03'})
  assert.equal(Upcoming.getUpcomingCashRequirement(rows),expected)
  const signals=Snapshot.buildCreditSignals({billingStates:[state],snapshotDate:'2026-06-03'})
  assert.equal(signals.length>0,expected>0)
 }
 for(const refDate of ['2026-07-26','2027-01-01']) {
  const state=CC.buildCardBillingState({card,transactions:txs,refDate})
  assert.deepEqual(state.payableStatements,[])
  assert.deepEqual(Snapshot.buildCreditSignals({billingStates:[state],snapshotDate:refDate}),[])
 }
})
