const fs=require('fs');
const {chromium}=require('/Users/bosskung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root='/Users/bosskung/Document/Money Tracker/';
const prelude=`window.__perf={calls:{},observers:[],long:[]};window.__wrap=(obj,key,prefix)=>{const prev=obj[key];if(typeof prev!=='function')return;obj[key]=function(...args){const start=performance.now();try{return prev.apply(this,args)}finally{const x=__perf.calls[prefix+key]||={count:0,ms:0,max:0};const ms=performance.now()-start;x.count++;x.ms+=ms;x.max=Math.max(x.max,ms)}}};for(const key of Object.keys(CreditCardCycles))__wrap(CreditCardCycles,key,'CC.');for(const key of Object.keys(Calc))__wrap(Calc,key,'Calc.');`;
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
for(const n of [0,1000,5000]){
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(({n})=>{
  const wallets=[{id:'bank',name:'Test bank',type:'bank',balance:50000,openingBalance:50000},...Array.from({length:5},(_,i)=>({id:'c'+i,name:'Test card '+i,type:'credit',balance:0,openingBalance:0,creditLimit:100000,cycleDay:25,dueAfterCycleDays:10}))];
  const tx=Array.from({length:n},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-(i%12));d.setDate(1+i%24);return {id:'t'+i,type:'expense',walletId:i%6===0?'bank':'c'+((i%6)-1),amount:100,ledgerAmount:100,date:[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),categoryId:'food',merchant:'Test',note:''}});
  localStorage.setItem('mt_wallets',JSON.stringify(wallets));localStorage.setItem('mt_transactions',JSON.stringify(tx));localStorage.setItem('mt_categories',JSON.stringify({expense:[{id:'food',name:'Food',icon:'🍜'}],income:[]}));
  const MO=window.MutationObserver;window.__mos=[];window.MutationObserver=class extends MO{constructor(fn){const item={count:0,ms:0,stack:new Error().stack};super((...args)=>{const st=performance.now();fn(...args);item.count++;item.ms+=performance.now()-st});item.instance=this;__mos.push(item)}};
  window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
 },{n});
 await page.route('**/*',route=>{const u=route.request().url();if(u.includes('/app_v2.js'))return route.fulfill({contentType:'text/javascript',body:prelude+fs.readFileSync(root+'app_v2.js','utf8')});return u.startsWith('http://127.0.0.1:8765/')?route.continue():route.abort()});
 const t=Date.now();await page.goto('http://127.0.0.1:8765/index.html?nosw=1&nonoti=1&noapplock=1&noFinanceRebuild=1',{waitUntil:'load'});await page.waitForTimeout(1400);
 const boot=await page.evaluate(()=>({renderStarts:__mtBootLog.filter(e=>e.name==='app.renderDashboard.start').length,calls:__perf.calls,long:__long,observers:__mos.map(({count,ms,stack})=>({count,ms,stack})),tx:S.transactions.length}));
 await page.evaluate(()=>{document.documentElement.classList.remove('mt-auth-gated');document.getElementById('mt-auth-gate')?.remove();for(const k of ['getCreditCardBillingState','getCreditCardDueInfo','getTransactionRewardEstimate','renderDashboard','renderTransactionsList','renderWallets','rebuildFinanceFeaturesIfNeeded','_ledgerFlows'])__wrap(App,k,'App.');__wrap(Storage,'saveAll','Storage.')});
 const operations=[];
 for(const name of ['dashboard','wallets','transactions','persist','finance','quiet-dashboard','quiet-transactions']){
  const measured=await page.evaluate(async name=>{
   if(name.startsWith('quiet')){__mos.forEach(x=>x.instance.disconnect());for(const s of ['dashboard','wallets','transactionList','transactions','reports'])for(const phase of ['before','after'])for(const hook of MTScreenHooks.list(s,phase))if(hook.id.startsWith('animations.'))hook.callback=()=>{}}
   __perf.calls={};__long.length=0;__mos.forEach(x=>{x.count=0;x.ms=0});
   let duration,ok;const st=performance.now();
   if(name==='persist')ok=persist('performance-probe');else if(name==='finance'){MT_DEBUG_FLAGS.noFinanceRebuild=false;App.rebuildFinanceFeaturesIfNeeded({force:true,forceFull:true});MT_DEBUG_FLAGS.noFinanceRebuild=true}else App.showPage(name.replace('quiet-',''));
   duration=performance.now()-st;await new Promise(r=>setTimeout(r,1200));
   return {name,duration,ok,calls:__perf.calls,long:__long.slice(),observerMs:__mos.reduce((s,x)=>s+x.ms,0),observerCalls:__mos.reduce((s,x)=>s+x.count,0),dom:document.querySelectorAll('#app *').length,rows:document.querySelectorAll('#tx-list-content .tx-row, #tx-list-content .tx-row-modern').length};
  },name);operations.push(measured);
 }
 const out={n,elapsed:Date.now()-t,errors,boot,operations};results.push(out);console.log(JSON.stringify(out));await context.close();
}
fs.writeFileSync('/private/tmp/mt-perf-evidence.json',JSON.stringify(results,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
