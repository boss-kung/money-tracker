const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm')
const src=fs.readFileSync(require.resolve('../app_v2.js'),'utf8')
function saveContext(future=false) {
 const card={id:'c',type:'credit',name:'Card'},source={id:'cash',type:'bank',balance:500}
 const fields={'cc-pay-wallet':{value:'cash'},'cc-pay-amount':{value:'1000'},'cc-pay-statement':{value:'selected-cycle'}}
 const errors=[]
 const ctx={S:{wallets:[card,source],transactions:future?[{id:'edit',type:'cc_payment',walletId:'cash',toWalletId:'c',amount:1000,date:'2026-07-01'}]:[],payingCardId:'c',editingCCPaymentId:future?'edit':null,page:'wallets'},App:{getCreditCardDueInfo:()=>({statement:{id:'oldest-cycle'}}),getCardStatement:()=>({id:'oldest-cycle'}),getCreditCardBillingState:()=>({statements:[{id:'selected-cycle'}]}),_isPostedTx:t=>t.date<='2026-06-03',getCCPaymentCashAmount:t=>t.amount,_showFieldError:(id,msg)=>errors.push(msg),recalculateWalletBalances(){},closeOverlay(){},renderWallets(){}},walletById:id=>id==='c'?card:source,isCCPaymentSourceWallet:()=>true,Calc:{genId:()=> 'new'},document:{getElementById:id=>fields[id]||null,querySelector:()=>null},today:()=> '2026-06-03',nowISO:()=>'',nextTransactionCreationSequence:()=>1,persist:()=>true,money:String,toast(){}}
 vm.runInNewContext(src.slice(src.indexOf('  App.saveCCPay = function()'),src.indexOf('  // ── Installment center + recurring due schedule')),ctx)
 return {ctx,fields,errors,source}
}
test('save uses explicitly selected statement',()=> {
 const {ctx,source}=saveContext();source.balance=5000;ctx.App.saveCCPay()
 assert.equal(ctx.S.transactions[0].statementId,'selected-cycle')
})
test('editing an unposted payment does not invent source balance',()=> {
 const {ctx,errors}=saveContext(true);ctx.App.saveCCPay()
 assert.equal(ctx.S.transactions[0].id,'edit')
 assert.ok(errors.some(e=>e.includes('ไม่เพียงพอ')))
})
test('persist failure rolls a newly saved payment back',()=> {
 const {ctx,source}=saveContext();source.balance=5000;ctx.persist=()=>false;ctx.App.saveCCPay()
 assert.equal(ctx.S.transactions.length,0)
})
