const fs = require('node:fs')
const assert = require('node:assert/strict')
const { chromium } = require('/Users/bosskung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const beforeSource = fs.readFileSync('/private/tmp/mt-finance-before-r131.js', 'utf8')

;(async () => {
  const browser = await chromium.launch({ channel:'chrome', headless:true })
  const results = []
  try {
    for (const mode of ['before', 'after']) {
      for (let run = 1; run <= 3; run++) {
        const context = await browser.newContext({viewport:{width:390,height:844}, serviceWorkers:'block'})
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        await page.route('**/*', route => {
          const url = route.request().url()
          if (!url.startsWith('http://127.0.0.1:8765/')) return route.abort()
          if (mode === 'before' && url.includes('/finance_intelligence.js')) return route.fulfill({contentType:'application/javascript', body:beforeSource})
          return route.continue()
        })
        await page.addInitScript(() => {
          const wallets = [{id:'bank',type:'bank',name:'Synthetic bank',openingBalance:50000,balance:50000}, ...Array.from({length:5}, (_, i) => ({id:`c${i}`,type:'credit',name:`Synthetic card ${i}`,creditLimit:100000,openingBalance:0,balance:0,cycleDay:25,dueAfterCycleDays:10}))]
          const transactions = Array.from({length:5000}, (_, i) => {
            const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - i % 12)
            return {id:`t${i}`,type:'expense',walletId:`c${i % 5}`,amount:100,ledgerAmount:100,date:[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),'01'].join('-'),createdSequence:i+1,categoryId:'food',merchant:'Synthetic shop',rewardRuleIds:[]}
          })
          for (const [key, value] of Object.entries({mt_wallets:wallets,mt_transactions:transactions,mt_cc_benefit_rules:[],mt_cc_benefits:{},mt_categories:{expense:[{id:'food',label:'Food',icon:'🍜'}],income:[]}})) localStorage.setItem(key, JSON.stringify(value))
          window.__backgroundLongTasks = []
          new PerformanceObserver(list => __backgroundLongTasks.push(...list.getEntries().map(row => ({start:row.startTime,duration:row.duration})))).observe({type:'longtask',buffered:true})
        })
        await page.goto('http://127.0.0.1:8765/index.html?nosw=1&nonoti=1&noapplock=1&noFinanceRebuild=1', {waitUntil:'load'})
        await page.waitForTimeout(2200)
        const measurement = await page.evaluate(async mode => {
          let creditSummaries = 0
          const original = Calc.getCreditLiabilitySummary
          Calc.getCreditLiabilitySummary = function(...args) { creditSummaries++; return original.apply(this,args) }
          localStorage.removeItem('mt_monthly_financial_features')
          localStorage.removeItem('mt_finance_feature_store_meta')
          App.invalidateDerivedState('benchmark-cold-billing')
          document.documentElement.classList.remove('mt-auth-gated')
          document.getElementById('mt-auth-gate')?.remove()
          MT_DEBUG_FLAGS.noFinanceRebuild = false
          let ticks = 0
          let lastTick = performance.now()
          let longestGap = 0
          const timer = setInterval(() => { const now = performance.now(); longestGap = Math.max(longestGap, now-lastTick); lastTick=now; ticks++ }, 16)
          const start = performance.now()
          const rows = mode === 'before'
            ? FinanceIntelligence.rebuildFeatureStore(S, 12)
            : await App.rebuildFinanceFeaturesIfNeeded({reason:'benchmark',force:true,forceFull:true})
          const end = performance.now()
          const ticksDuring = ticks
          await new Promise(resolve => setTimeout(resolve, 60))
          clearInterval(timer)
          Calc.getCreditLiabilitySummary = original
          return {duration:end-start,creditSummaries,ticksDuring,longestGap,rows:rows.length,expenseTotal:rows.reduce((sum,row)=>sum+row.metrics.expense,0),longTasks:__backgroundLongTasks.filter(row=>row.start+row.duration>=start&&row.start<=end),start,end}
        }, mode)
        assert.equal(measurement.rows, 12)
        assert.equal(measurement.expenseTotal, 500000)
        assert.deepEqual(errors, [])
        results.push({mode,run,errors,...measurement})
        console.log(JSON.stringify({mode,run,...measurement,errors}))
        if (mode === 'after') { assert.equal(measurement.creditSummaries, 1); assert.ok(measurement.ticksDuring > 0) }
        await context.close()
      }
    }
    fs.writeFileSync('/private/tmp/mt-perf-background-evidence.json', JSON.stringify(results,null,2))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode=1 })
