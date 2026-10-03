const fs=require('fs');const {chromium}=require('/Users/bosskung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});const page=await context.newPage();await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8765/')?r.continue():r.abort());await page.goto('http://127.0.0.1:8765/index.html?nosw=1&nonoti=1&noapplock=1&noFinanceRebuild=1');await page.waitForTimeout(1600);await page.evaluate(()=>{document.documentElement.classList.remove('mt-auth-gated');document.getElementById('mt-auth-gate')?.remove()});const results=[];
for(const n of [250,500,1000]){
 const out=await page.evaluate(async n=>{
 S.wallets=[{id:'bank',type:'bank',name:'Test bank',openingBalance:50000,balance:50000},...Array.from({length:5},(_,i)=>({id:'c'+i,type:'credit',name:'Test '+i,creditLimit:100000,openingBalance:0,balance:-10000,cycleDay:25,dueAfterCycleDays:10}))];
 S.categories={expense:[{id:'food',name:'Food',icon:'🍜'}],income:[]};S.ccBenefits={};S.ccBenefitRules=[];
 const txs=Array.from({length:n},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-(i%6));return {id:'t'+i,type:'expense',walletId:'c'+i%5,amount:100,ledgerAmount:100,date:[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),'01'].join('-'),categoryId:'food',createdSequence:i+1,merchant:'Test'}});S.transactions=txs;S.wallets=CreditCardCycles.prepareBillingMigration({wallets:S.wallets,transactions:txs,refDate:getTODAY()}).wallets;
 const measures=[];
 for(const rules of [false,true]){
 S.ccBenefitRules=rules?Array.from({length:5},(_,i)=>App.normalizeBenefitRule({id:'r'+i,cardId:'c'+i,name:'Cashback test',active:true,type:'cashback',cashback:{mode:'percent',rate:1},limits:{maxRewardAmountPerCycle:100}})):[];
 txs.forEach(t=>t.rewardRuleIds=rules?['r'+t.walletId.slice(1)]:[]);
 const tally={};const keys=['getRuleCycleUsage','calculateSelectedRewardEstimate','getTransactionRewardEstimate','getCreditCardBillingState'];const originals={};keys.forEach(key=>{originals[key]=App[key];App[key]=function(...a){const st=performance.now();try{return originals[key].apply(this,a)}finally{const x=tally[key]||={count:0,ms:0};x.count++;x.ms+=performance.now()-st}}});
 const durations=[];for(let i=0;i<3;i++){const st=performance.now();App.renderDashboard();durations.push(performance.now()-st);await new Promise(r=>setTimeout(r,1200))}keys.forEach(k=>App[k]=originals[k]);
 measures.push({rules,durations,tally});
 }
 return {n,measures};
 },n);results.push(out);console.log(JSON.stringify(out));}
fs.writeFileSync('/private/tmp/mt-perf-focus-evidence.json',JSON.stringify(results,null,2));await browser.close()})().catch(e=>{console.error(e);process.exit(1)});
