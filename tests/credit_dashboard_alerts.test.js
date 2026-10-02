const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const CC=require('../credit_card_cycles.js')
test('dashboard selector keeps partial and overdue bills and all cycles',()=> {
 const src=fs.readFileSync(require.resolve('../app_v2.js'),'utf8');const start=src.indexOf('  App.getCreditCardAlertRows = function')
 assert.ok(start>=0,'shared dashboard selector must exist')
 const context={App:{getCreditCardPayableStatements:card=>CC.getPayableStatements({card,refDate:'2026-06-03',transactions:[{id:'e',type:'expense',walletId:'c',date:'2026-05-10',amount:5000},{id:'p',type:'cc_payment',toWalletId:'c',date:'2026-06-01',amount:2000} ]})},S:{wallets:[]}}
 vm.runInNewContext(src.slice(start,src.indexOf('  App.getCreditCardDueInfo = function',start)),context)
 const rows=context.App.getCreditCardAlertRows([{id:'c',type:'credit',cycleDay:25,dueAfterCycleDays:10}])
 assert.equal(rows[0].used,3000)
 assert.equal(rows[0].due.daysLeft,1)
 context.App.getCreditCardPayableStatements=()=>[{id:'over',balanceDue:1000,daysLeft:-10,dueDate:'2026-05-24'},{id:'due',balanceDue:2000,daysLeft:2,dueDate:'2026-06-05'}]
 assert.equal(context.App.getCreditCardAlertRows([{id:'c',type:'credit'}]).length,2)
})
