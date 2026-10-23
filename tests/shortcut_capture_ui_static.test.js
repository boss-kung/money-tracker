const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const quick = fs.readFileSync(path.join(root, 'quick_capture.js'), 'utf8')
const capture = fs.readFileSync(path.join(root, 'shortcut_capture.js'), 'utf8')
const css = fs.readFileSync(path.join(root, 'style_v2.css'), 'utf8')

test('one icon-only accessible launcher opens Shortcut Inbox instead of Quick Capture', async () => {
  let button, opened, insertions = 0
  const handlers = {}
  const hooks = {}
  const doc = {
    getElementById: id => id === 'fab' ? { insertAdjacentElement: (_, value) => { button = value; insertions++ } } : button,
    createElement: () => ({ setAttribute: (key, value) => { handlers[key] = value }, addEventListener: (key, value) => { handlers[key] = value } }),
    addEventListener: () => {},
  }
  vm.runInNewContext(capture, {
    document: doc, App: { openSubScreen: html => { opened = html } },
    MTShortcutCaptureCore: require('../shortcut_capture_core.js'),
    MTScreenHooks: { register: (screen, id, callback) => { hooks[id] = callback } },
  })
  assert.equal(button.id, 'fab-shortcut')
  assert.equal(handlers['aria-label'], 'รายการจาก Shortcut')
  assert.match(button.innerHTML, /<svg[^>]*aria-hidden="true"/)
  assert.doesNotMatch(button.innerHTML, /รายการจาก Shortcut/)
  await handlers.click()
  assert.match(opened, /Shortcut Inbox/)
  hooks['shortcut-capture.inbox-button']()
  assert.equal(insertions, 1)
  assert.doesNotMatch(quick, /openQuickCapture|overlay-quick-capture|qc-mic-btn|บันทึกเร็ว/)
})

test('only the Add Transaction overlay and sheet are forced to the full viewport width', () => {
  const overlayStart = css.indexOf('#overlay-add-tx {')
  assert.notEqual(overlayStart, -1, 'missing scoped Add Transaction overlay rule')
  const overlayRule = css.slice(overlayStart, css.indexOf('}', overlayStart) + 1)
  assert.match(overlayRule, /position:\s*fixed\s*!important/)
  assert.match(overlayRule, /inset:\s*0\s*!important/)
  assert.match(overlayRule, /width:\s*100vw\s*!important/)

  const sheetStart = css.indexOf('#overlay-add-tx > #sheet-add-tx {')
  assert.notEqual(sheetStart, -1, 'missing scoped Add Transaction sheet rule')
  const sheetRule = css.slice(sheetStart, css.indexOf('}', sheetStart) + 1)
  assert.match(sheetRule, /width:\s*100vw\s*!important/)
  assert.match(sheetRule, /max-width:\s*none\s*!important/)
})

test('mobile transaction and Shortcut inputs keep iOS from auto-zooming below 16px', () => {
  const mobileStart = css.lastIndexOf('@media (max-width: 480px)')
  assert.notEqual(mobileStart, -1, 'missing narrow-mobile form rules')
  const mobileRules = css.slice(mobileStart, mobileStart + 500)
  assert.match(mobileRules, /input\.form-input[^\{]*\.search-input[^\{]*\{\s*font-size:\s*16px\s*!important/)
  assert.match(mobileRules, /\.form-input\[type="date"\]\s*\{\s*font-size:\s*16px\s*!important/)
})
