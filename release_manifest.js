/* Single release contract shared by the app shell, service worker, and tests. */
;(function (root, factory) {
  const manifest = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = manifest
  if (root) root.MT_RELEASE = manifest
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'
  const version = '2026.08.09-architecture-r121'
  const coreAssets = Object.freeze([
    './',
    './index.html',
    './release_manifest.js',
    './style_v2.css',
    './ui_v2.css',
    './app_v2.js',
    './safe_render.js',
    './state_commit.js',
    './ledger.js',
    './screen_hooks.js',
    './gold_market.js',
    './storage_v2.js',
    './app_lock.js',
    './calculations.js',
    './sample-data_v2.js',
    './ai_insights.js',
    './finance_intelligence.js',
    './ask_my_money_core.js',
    './notification_config.js',
    './notifications_v2.js',
    './onboarding.js',
    './loans_v2.js',
    './auth_sync.js',
    './credit_card_cycles.js',
    './crypto_vault.js',
    './bnpl.js',
    './split_bill.js',
    './quick_capture.js',
    './thai_bank_holidays.js',
    './manifest.json',
    './assets/icon.svg',
    './assets/icon-180.png',
    './assets/fonts/LINESeedSansTH_Rg.ttf',
    './assets/fonts/LINESeedSansTH_Bd.ttf',
    './assets/fonts/LINESeedSansTH_XBd.ttf',
    './assets/fonts/tabler-icons-subset.woff2',
  ])
  const networkFirstFiles = Object.freeze(coreAssets
    .map(asset => asset.split('/').pop())
    .filter(name => /\.(?:js|css|ttf|woff2)$/.test(name)))
  return Object.freeze({ version, coreAssets, networkFirstFiles })
})
