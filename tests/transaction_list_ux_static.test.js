const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const appSource = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')
const authSource = fs.readFileSync(path.join(root, 'auth_sync.js'), 'utf8')
const css = fs.readFileSync(path.join(root, 'style_v2.css'), 'utf8')

test('transaction rows use configured merchant emoji as the primary row icon when available', () => {
  assert.match(appSource, /function findMerchantForTx\(/)
  assert.match(appSource, /const merchant = findMerchantForTx\(tx\)/)
  assert.match(appSource, /const merchantIcon = merchant\?\.emoji/)
  assert.match(appSource, /const icon = merchantIcon \|\|/)
  assert.match(appSource, /const bg = v\.merchant\?\.color/)
})

test('cloud auto-sync stays quiet on success but still warns on failures', () => {
  assert.match(authSource, /const shouldToastSuccess = !silent && direction !== 'pull'/)
  assert.match(authSource, /if \(shouldToastSuccess\) toastSafe\('บันทึกข้อมูลแล้ว', 'success'\)/)
  assert.match(authSource, /syncNow\(\{ direction: 'push', silent: true \}\)[\s\S]{0,120}\.catch\(err => toastSafe\(`บันทึกข้อมูลอัตโนมัติล้มเหลว/)
})

test('transaction screen keeps only a thin sticky bar while filters open below it', () => {
  assert.match(appSource, /<div class="tx-sticky-slim">/)
  assert.match(appSource, /<div id="tx-filter-panel" class="tx-filter-panel/)
  assert.match(css, /#page-transactions \.page-header\s*\{[\s\S]*position:\s*static/)
  assert.match(css, /\.tx-sticky-slim\s*\{[\s\S]*position:\s*sticky/)
  assert.match(css, /\.tx-sticky-slim\s*\{[\s\S]*display:\s*grid/)
  assert.match(css, /\.tx-filter-panel\s*\{[\s\S]*position:\s*static/)
  assert.match(css, /#page-transactions \.tx-summary-cards[\s\S]*position:\s*static/)
})
