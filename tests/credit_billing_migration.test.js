const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm')
const CC=require('../credit_card_cycles.js')
const StateCommit=require('../state_commit.js')
const card={id:'c',type:'credit',cycleDay:25,dueAfterCycleDays:10,openingBalance:-5000}
const txs=[{id:'p',type:'cc_payment',walletId:'cash',toWalletId:'c',amount:5000,date:'2026-06-01',statementId:'c:2026-04-26:2026-05-25'}]
test('metadata survives migration repetition and changed card settings',()=> {
 const first=CC.prepareBillingMigration({wallets:[card],transactions:txs,refDate:'2026-06-03'})
 assert.equal(first.wallets[0].ccBilling.opening.statementId,'c:2026-04-26:2026-05-25')
 assert.equal(CC.prepareBillingMigration({wallets:first.wallets,transactions:txs,refDate:'2026-06-03'}).changed,false)
 const later=CC.prepareBillingMigration({wallets:[{...first.wallets[0],cycleDay:19,dueAfterCycleDays:20}],transactions:txs,refDate:'2026-07-01'})
 assert.deepEqual(later.wallets[0].ccBilling.opening,first.wallets[0].ccBilling.opening)
 assert.equal(later.wallets[0].ccBilling.periods.find(p=>p.id===txs[0].statementId).dueDate,'2026-06-04')
 assert.equal(txs[0].amount,5000)
})
test('persist migrates billing metadata and rolls it back when the durable commit fails',()=> {
 const src=fs.readFileSync(require.resolve('../app_v2.js'),'utf8')
 const start=src.indexOf('function getStateCommit()')
 const end=src.indexOf('function moneyFmt(',start)
 assert.ok(start>=0&&end>start,'persist must prepare billing metadata before committing')
 let accept=false
 const notices=[]
 const context={S:{wallets:[card],transactions:txs},App:{},window:{MTStateCommit:StateCommit},CreditCardCycles:CC,
  getTODAY:()=> '2026-06-03',MT_STORAGE_HYDRATED:true,MT_STATE_COMMIT:null,Storage:{saveAll:()=>accept},
  toast:(message,type)=>notices.push(type),console:{warn(){},error(){}}}
 vm.createContext(context)
 vm.runInContext(src.slice(start,end),context)
 assert.equal(context.persist('billing-metadata'),false)
 assert.equal(context.S.wallets[0],card)
 assert.deepEqual(notices,['error'])
 accept=true
 assert.equal(context.persist('billing-metadata'),true)
 assert.equal(context.S.wallets[0].ccBilling.version,2)
 const backup=JSON.parse(JSON.stringify(context.S.wallets))
 assert.equal(CC.buildCardBillingState({card:backup[0],transactions:txs,refDate:'2026-07-26'}).postedDebt,0)
})
