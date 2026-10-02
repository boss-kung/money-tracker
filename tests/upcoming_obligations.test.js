const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const CC=require('../credit_card_cycles.js')
function projection(txs,days='2026-06-17') {
 assert.ok(fs.existsSync(require('node:path').join(__dirname,'../upcoming_obligations.js')),'calendar projection module exists')
 const P=require('../upcoming_obligations.js'),card={id:'c',type:'credit',name:'Card',cycleDay:25,dueAfterCycleDays:10}
 const state=CC.buildCardBillingState({card,transactions:txs,refDate:'2026-06-03'})
 return {P,state,rows:P.projectCreditObligations({billingStates:[{...state,card}],transactions:txs,refDate:'2026-06-03',endDate:days})}
}
const purchase={id:'e',type:'expense',walletId:'c',amount:5000,date:'2026-05-10'}
const pay={id:'p',type:'cc_payment',walletId:'cash',toWalletId:'c',amount:5000,date:'2026-06-04',statementId:'c:2026-04-26:2026-05-25'}
test('scheduled payment funds one bill without changing actual debt',()=> {
 const {P,state,rows}=projection([purchase,pay])
 assert.equal(P.getUpcomingCashRequirement(rows),5000)
 assert.equal(rows.find(r=>r.type==='credit_due').plannedAmount,5000)
 assert.equal(state.payableStatements[0].balanceDue,5000)
})
test('partial and discounted plans reserve cash plus remaining bill',()=> {
 for (const [amount,cash,total] of [[5000,4900,4900],[2000,1900,4900]]) {
 const {P,rows}=projection([purchase,{...pay,amount,cashAmount:cash}]);assert.equal(P.getUpcomingCashRequirement(rows),total)
 }
})
test('all closed bills stay visible, including overdue',()=> {
 const {rows}=projection([purchase,{...purchase,id:'old',date:'2026-04-10',amount:1000}])
 assert.deepEqual(rows.filter(r=>r.type==='credit_due').map(r=>r.amount).sort((a,b)=>a-b),[1000,5000])
 assert.ok(rows.some(r=>r.status==='overdue'))
})
test('out-of-horizon plan cannot reduce current cash requirement',()=> {
 const {P,rows}=projection([purchase,{...pay,date:'2026-06-20'}])
 assert.equal(P.getUpcomingCashRequirement(rows),5000)
 assert.equal(rows.length,1)
})
test('late plans remain overdue and income goals liabilities are not cash outflows',()=> {
 const {P,rows}=projection([purchase,{...pay,date:'2026-06-15'}])
 assert.equal(rows.find(r=>r.type==='credit_due').plannedAfterDue,true)
 assert.equal(P.getUpcomingCashRequirement([...rows,{amount:100,type:'recurring',cashflowKind:'income'},{amount:200,type:'goal'},{amount:300,type:'scheduled',cashflowKind:'liability'},{amount:400,type:'upcoming_bill',cashflowKind:'expense'}]),5400)
})
test('app calendar and cash-total adapter use all cycles and deduplicate plans',()=> {
 const src=fs.readFileSync(require.resolve('../app_v2.js'),'utf8')
 const {P,state}=projection([purchase,pay])
 const ctx={App:{getCreditCardBillingState:()=>state,getCreditCardDueInfo:()=>CC.getNextPayableDueInfo({card:{id:'c',cycleDay:25,dueAfterCycleDays:10},transactions:[purchase,pay],refDate:'2026-06-03'})},S:{wallets:[{id:'c',type:'credit'}],transactions:[purchase,pay],recurring:[],upcomingBills:[],goals:[]},today:()=> '2026-06-03',esc:String,MTUpcomingObligations:P}
 vm.runInNewContext(src.slice(src.indexOf('  App.getUpcomingItems = function'),src.indexOf('  function previewCount(',src.indexOf('  App.getUpcomingItems = function'))),ctx)
 assert.equal(ctx.App.getUpcomingCashRequirement(ctx.App.getUpcomingItems(14)),5000)
})
