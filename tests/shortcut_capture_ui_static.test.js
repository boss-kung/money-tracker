const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const quick = fs.readFileSync(path.join(root, 'quick_capture.js'), 'utf8')
const css = fs.readFileSync(path.join(root, 'style_v2.css'), 'utf8')

test('the floating Shortcut launcher uses an explicit accessible text label', () => {
  assert.match(quick, /btn\.id\s*=\s*'fab-shortcut'/)
  assert.match(quick, /btn\.textContent\s*=\s*'รายการจาก Shortcut'/)
  assert.match(quick, /aria-label',\s*'รายการจาก Shortcut'/)
  assert.doesNotMatch(quick, /btn\.id\s*=\s*'fab-mic'/)
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
  assert.match(mobileRules, /input\.form-input[^\{]*#qc-input[^\{]*\{\s*font-size:\s*16px\s*!important/)
  assert.match(mobileRules, /\.form-input\[type="date"\]\s*\{\s*font-size:\s*16px\s*!important/)
})
