const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const capture = fs.readFileSync(path.join(root, 'shortcut_capture.js'), 'utf8')
const app = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')
const css = fs.readFileSync(path.join(root, 'ui_v2.css'), 'utf8')
const loader = fs.readFileSync(path.join(root, 'feature_loader.js'), 'utf8')
const manifest = require('../release_manifest.js')

test('capture feature is ordered after quick capture and both assets are deferred and offline cached', () => {
  assert.match(loader, /capture:\s*\[[^\]]*quick_capture\.js[^\]]*shortcut_capture_core\.js[^\]]*shortcut_capture\.js/s)
  assert.ok(manifest.deferredAssets.includes('./shortcut_capture_core.js'))
  assert.ok(manifest.deferredAssets.includes('./shortcut_capture.js'))
  assert.ok(manifest.coreAssets.includes('./shortcut_capture_core.js'))
  assert.ok(manifest.coreAssets.includes('./shortcut_capture.js'))
})

test('inbox and token settings use hooks, escaped review disclosure, and confirmation before dismiss', () => {
  assert.match(capture, /MTScreenHooks\?\.register\?\.\('transactions'/)
  assert.match(capture, /MTScreenHooks\?\.register\?\.\('more'/)
  assert.match(capture, /MTScreenHooks\?\.register\?\.\('addTransactionDetail'/)
  assert.match(capture, /shortcut-inbox-raw[^<]*|shortcut-inbox-raw/)
  assert.match(capture, /showConfirm/)
  assert.match(capture, /Copy|คัดลอก/)
  assert.match(capture, /escapeHtml|escape/)
  assert.doesNotMatch(capture, /openDraft\([^)]*\)[\s\S]{0,500}saveTx\(/)
})

test('Shortcut settings stay visible before the deferred capture feature loads', () => {
  assert.match(app, /shortcut-token-settings/)
  assert.match(app, /เชื่อมต่อ iOS Shortcut/)
  assert.match(app, /รูปแบบแจ้งเตือนธนาคาร/)
  assert.match(app, /ensureFeatureAndCall\('capture'/)
  assert.match(capture, /openShortcutProfileSettings/)
})

test('fallback date warning is scoped to an unchanged Shortcut draft date', () => {
  assert.match(capture, /shortcut-capture-date-warning/)
  assert.match(capture, /ไม่พบวันที่รายการ จึงใช้วันที่รับแจ้งเตือน โปรดตรวจสอบ/)
  assert.match(capture, /tx-date/)
  assert.match(capture, /activeDateFallback/)
})

test('responsive inbox and token controls have accessible touch-target styles', () => {
  for (const name of ['shortcut-inbox-', 'shortcut-token-']) assert.match(css, new RegExp(`\\.${name}`))
  assert.match(css, /shortcut-inbox[^}]*min-height:\s*44px/s)
  assert.match(css, /shortcut-inbox[^}]*safe-area|safe-area[^}]*shortcut-inbox/s)
})

