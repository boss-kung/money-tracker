const test=require('node:test'), assert=require('node:assert/strict')
const CC=require('../credit_card_cycles.js'), Calc=require('../calculations.js')
test('credit summary separates multiple closed bills from open spending',()=> {
 const card={id:'c',type:'credit',balance:-6000,cycleDay:25,dueAfterCycleDays:10}
 const txs=[{id:'a',type:'expense',walletId:'c',date:'2026-04-10',amount:1000},{id:'b',type:'expense',walletId:'c',date:'2026-05-10',amount:2000},{id:'open',type:'expense',walletId:'c',date:'2026-06-01',amount:3000}]
 let billingCalls=0
 global.App={getCreditCardBillingState:c=>{billingCalls++;return CC.buildCardBillingState({card:c,transactions:txs,refDate:'2026-06-03'})},getCardStatement:()=>{throw new Error('summary must derive statement from shared billing state')},getCreditCardDueInfo:()=>{throw new Error('summary must derive due info from shared billing state')},_getUnpostedInstallmentDebt:()=>500}
 try {
  const summary=Calc.getCreditLiabilitySummary([card])
  assert.equal(summary.totals.statementDue,3000)
  assert.equal(summary.totals.currentCycleSpending,3000)
  assert.equal(summary.totals.totalLiability,6500)
  assert.equal(billingCalls,1)
  const expectedDue=CC.getNextPayableDueInfo({card,transactions:txs,refDate:'2026-06-03'})
  assert.equal(summary.cards[0].nextDueLabel,Calc.getDaysUntilDate(expectedDue.dateStr,'2026-06-03').dueStr)
 } finally { delete global.App }
})
