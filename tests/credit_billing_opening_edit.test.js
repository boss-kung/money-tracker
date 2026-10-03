const test = require('node:test')
const assert = require('node:assert/strict')
const CC = require('../credit_card_cycles.js')
const may = 'c:2026-04-26:2026-05-25', jun = 'c:2026-05-26:2026-06-25', jul = 'c:2026-06-26:2026-07-25'
const purchase = (id,date,amount) => ({id,date,amount,type:'expense',walletId:'c'})
const makeCard = (opening, openingBalance=-3000) => ({id:'c', type:'credit', cycleDay:25, dueAfterCycleDays:10, openingBalance, ccBilling:{version:2,opening,periods:[]}})
const openingAt = (id,start,end,dueDate) => ({statementId:id,start,end,dueDate,provenance:'explicit'})

test('opening debt follows the statement the user picked',()=> {
  const card = makeCard(openingAt(jun,'2026-05-26','2026-06-25','2026-07-07'))
  const state = CC.buildCardBillingState({card,transactions:[purchase('a','2026-05-10',100)],refDate:'2026-07-01'})
  const row = id => state.statements.find(r=>r.id===id)
  assert.equal(row(jun).openingDebt,3000)
  assert.equal(row(jun).dueDate,'2026-07-07')
  assert.equal(row(may).openingDebt,0)
  assert.equal(state.postedDebt,3100)
})

test('an explicit opening in the open statement is kept by billing migration and is not payable yet',()=> {
  const card = makeCard(openingAt(jul,'2026-06-26','2026-07-25','2026-08-04'))
  const next = CC.prepareBillingMigration({wallets:[card],transactions:[],refDate:'2026-07-10'}).wallets[0]
  assert.deepEqual(next.ccBilling.opening, card.ccBilling.opening)
  const state = CC.buildCardBillingState({card:next,transactions:[],refDate:'2026-07-10'})
  assert.equal(state.openStatement.id, jul)
  assert.equal(state.openStatement.openingDebt, 3000)
  assert.deepEqual(state.payableStatements, [])
})

test('a starting credit balance has no opening debt row amount',()=> {
  const card = makeCard(openingAt(may,'2026-04-26','2026-05-25','2026-06-04'), 500)
  const state = CC.buildCardBillingState({card,transactions:[purchase('a','2026-05-10',300)],refDate:'2026-06-01'})
  assert.equal(state.statements.find(r=>r.id===may).openingDebt,0)
  assert.equal(state.creditBalance,200)
})
