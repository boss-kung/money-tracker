const fs = require('node:fs')
const assert = require('node:assert/strict')
const { chromium } = require('/Users/bosskung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
;(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true})
  try {
    const context = await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}})
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:8765/') ? route.continue() : route.abort())
    await page.addInitScript(() => {
      localStorage.setItem('mt_auth_sync_state', JSON.stringify({refreshToken:'synthetic-refresh',accessToken:'synthetic-access',expiresAt:1,userId:'synthetic-user'}))
      window.__recoverNetwork = false
      window.__authRequests = []
      const original = window.fetch
      window.fetch = function(url, options) {
        if (String(url).includes('/auth/v1/') || String(url).includes('/rest/v1/mt_user_vaults')) {
          __authRequests.push({path:new URL(url).pathname,hasSignal:!!options?.signal,at:performance.now()})
          // Deliberately ignore AbortSignal; the independent deadline must still settle.
          if (!__recoverNetwork) return new Promise(() => {})
          const body = String(url).includes('/token?') ? {access_token:'synthetic-new-access',refresh_token:'synthetic-new-refresh',expires_in:3600}
            : String(url).endsWith('/user') ? {id:'synthetic-user',email:'synthetic@example.test',app_metadata:{provider:'google'},identities:[{provider:'google'}]}
            : [{user_id:'synthetic-user',data_version:1}]
          return Promise.resolve(new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}}))
        }
        return original.apply(this,arguments)
      }
    })
    await page.goto('http://127.0.0.1:8765/index.html?nosw=1&nonoti=1&noapplock=1&noFinanceRebuild=1',{waitUntil:'load'})
    await page.waitForFunction(() => !MTAuthSync.state.restoring && !!MTAuthSync.state.restoreError, null, {timeout:16000})
    const timeout = await page.evaluate(() => ({at:performance.now(),restoring:MTAuthSync.state.restoring,error:MTAuthSync.state.restoreError,gated:document.documentElement.classList.contains('mt-auth-gated'),refreshPreserved:!!JSON.parse(localStorage.getItem('mt_auth_sync_state')).refreshToken,requests:__authRequests}))
    assert.equal(timeout.gated,true)
    assert.equal(timeout.refreshPreserved,true)
    assert.ok(timeout.requests.every(row=>row.hasSignal))
    await page.evaluate(() => { __recoverNetwork=true })
    await page.locator('[data-mt-auth-action="retry-restore"]').first().click()
    await page.waitForFunction(() => !MTAuthSync.state.restoring && MTAuthSync.state.user?.id === 'synthetic-user')
    const retry = await page.evaluate(() => ({restoring:MTAuthSync.state.restoring,error:MTAuthSync.state.restoreError,hasSession:!!MTAuthSync.state.session,gated:document.documentElement.classList.contains('mt-auth-gated')}))
    assert.equal(retry.error,null)
    assert.equal(retry.hasSession,true)
    assert.equal(retry.gated,false)
    assert.deepEqual(errors,[])
    const evidence = {timeout,retry,errors}
    fs.writeFileSync('/private/tmp/mt-perf-auth-after-evidence.json',JSON.stringify(evidence,null,2))
    console.log(JSON.stringify(evidence))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode=1 })
