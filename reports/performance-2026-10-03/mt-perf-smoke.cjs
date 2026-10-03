const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { chromium } = require('/Users/bosskung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel:'chrome', headless:true })
  const results = []
  try {
    for (const scenario of ['production-deep-link', 'demo-navigation', 'pin-unlock', 'feature-history-resume']) {
      const context = await browser.newContext({ viewport:{width:390,height:844}, serviceWorkers:'block' })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:8765/') ? route.continue() : route.abort())
      if (scenario === 'pin-unlock') {
        const salt = Buffer.alloc(16, 7)
        const config = { enabled:true, pinLength:6, salt:salt.toString('base64'), hash:crypto.pbkdf2Sync('123456', salt, 210000, 32, 'sha256').toString('base64'), iterations:210000, biometric:{enabled:false} }
        await page.addInitScript(config => localStorage.setItem('mt_app_lock', JSON.stringify(config)), config)
      }
      const suffix = '?nosw=1&nonoti=1&noFinanceRebuild=1'
      const url = scenario === 'demo-navigation'
        ? `http://127.0.0.1:8765/demo/index.html${suffix}&noapplock=1`
        : `http://127.0.0.1:8765/index.html${suffix}${scenario === 'pin-unlock' ? '' : '&noapplock=1'}${scenario === 'production-deep-link' ? '#dashboard?open=addTx' : ''}`
      await page.goto(url, { waitUntil:'load' })
      if (scenario === 'pin-unlock') {
        await page.waitForTimeout(350)
        const locked = await page.evaluate(() => ({ locked:MTAppLock.status().locked, overlay:document.getElementById('mt-app-lock')?.classList.contains('open'), privacy:document.documentElement.classList.contains('mt-app-lock-open') }))
        assert.equal(locked.locked, true)
        assert.equal(locked.overlay, true)
        assert.equal(locked.privacy, true)
        await page.evaluate(async () => { for (const digit of '123456') MTAppLock.press(digit); await MTAppLock.verify() })
        await page.waitForFunction(() => !MTAppLock.status().locked && !document.documentElement.classList.contains('mt-app-lock-open') && !document.getElementById('mt-app-lock')?.classList.contains('open'))
      }
      await page.waitForFunction(() => MT_STORAGE_HYDRATED && !!document.querySelector('#dashboard-content .mt-net-card'))
      if (scenario === 'production-deep-link') {
        await page.waitForFunction(() => document.getElementById('overlay-add-tx')?.classList.contains('open'))
        await page.evaluate(() => App.closeAddTx())
      }
      const pages = await page.evaluate(() => {
        // The disposable production profile has no account; remove its auth gate
        // only inside this test to inspect the financial screen renderers.
        document.documentElement.classList.remove('mt-auth-gated')
        document.getElementById('mt-auth-gate')?.remove()
        return ['dashboard','transactions','wallets','reports','more'].map(page => {
          App.showPage(page)
          const content = document.getElementById(page === 'transactions' ? 'tx-list-content' : `${page}-content`)
          return {page, active:document.getElementById(`page-${page}`)?.classList.contains('active'), content:!!content?.innerHTML.trim()}
        })
      })
      assert.ok(pages.every(row => row.active && row.content), JSON.stringify(pages))
      if (scenario === 'feature-history-resume') {
        const busy = await page.evaluate(() => {
          MT_DEBUG_FLAGS.noFinanceRebuild = false
          localStorage.removeItem('mt_monthly_financial_features')
          localStorage.removeItem('mt_finance_feature_store_meta')
          window.__historyHidden = false
          Object.defineProperty(document,'visibilityState',{configurable:true,get:() => __historyHidden ? 'hidden' : 'visible'})
          window.__historyReleased = []
          window.__historyOriginalTask = scheduler.postTask.bind(scheduler)
          scheduler.postTask = (callback,opts) => new Promise(resolve => __historyReleased.push(() => __historyOriginalTask(callback,opts).then(resolve)))
          App.openFeatureHistory()
          return document.getElementById('finance-feature-history')?.getAttribute('aria-busy')
        })
        assert.equal(busy, 'true')
        await page.evaluate(() => {
          __historyHidden = true
          document.dispatchEvent(new Event('visibilitychange'))
          scheduler.postTask = __historyOriginalTask
          __historyReleased.forEach(release => release())
        })
        await page.waitForFunction(() => __mtBootLog.some(row => row.name === 'financeApp.rebuild.cancel'))
        assert.equal(await page.locator('#finance-feature-history').getAttribute('aria-busy'), 'true')
        await page.evaluate(() => { __historyHidden=false; document.dispatchEvent(new Event('visibilitychange')) })
        await page.waitForFunction(() => FinanceIntelligence.loadFeatureStore().rows.length === 12 && document.getElementById('finance-feature-history')?.getAttribute('aria-busy') === 'false')
        await page.evaluate(() => { delete document.visibilityState; App.closeSubScreen() })
      }
      assert.deepEqual(errors, [])
      results.push({scenario, pages, errors})
      console.log(JSON.stringify({scenario, pass:true, errors}))
      await context.close()
    }
    fs.writeFileSync('/private/tmp/mt-perf-smoke-evidence.json', JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
