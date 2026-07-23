const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')

test('openCCPay escapes wallet name/icon before interpolating into <option> and header HTML', () => {
  const fnStart = app.indexOf('openCCPay(cardId) {')
  assert.ok(fnStart >= 0, 'openCCPay not found')
  const fnBody = app.slice(fnStart, app.indexOf('\n  },', fnStart))
  assert.equal(/\$\{w\.name\}/.test(fnBody), false, 'wallet name must not be interpolated raw — wallet names are user-controlled (including via JSON import) and this renders via innerHTML')
  assert.match(fnBody, /\$\{esc\(w\.name\)\}/, 'wallet name in the source-wallet <option> must be escaped')
  assert.match(fnBody, /\$\{esc\(card\.name\)\}/, 'card name in the header must be escaped')
})

test('App._withUndo escapes its label before assigning innerHTML — closes off every call site at once', () => {
  const fnStart = app.indexOf('App._withUndo = function')
  assert.ok(fnStart >= 0, '_withUndo not found')
  const fnBody = app.slice(fnStart, app.indexOf('\n  }', fnStart))
  assert.match(fnBody, /bar\.innerHTML = `<span class="mt-undo-bar-label">\$\{escLabel\}/,
    '_withUndo must escape its label before building innerHTML — it is called with raw user-controlled names/labels (removed.name, g.merchant, r.name, etc.) from ~9 call sites throughout the file')
})
