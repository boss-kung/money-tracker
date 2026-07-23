const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const authSync = fs.readFileSync(path.join(root, 'auth_sync.js'), 'utf8')

function signInPanel() {
  // Anchor on the h1 text itself — the surrounding boilerplate
  // (role="dialog" aria-labelledby=...) is identical across all 3 gate states.
  const titleMarker = '<h1 id="mt-auth-gate-title">กรุณาเข้าสู่ระบบ</h1>'
  const titleIdx = authSync.indexOf(titleMarker)
  assert.ok(titleIdx >= 0, 'sign-in gate h1 not found')
  const start = authSync.lastIndexOf('<div class="mt-auth-gate-panel"', titleIdx)
  return authSync.slice(start, authSync.indexOf('</div>`', titleIdx))
}

test('sign-in gate no longer duplicates the mt-auth-gate-title id or uses an invalid </br> tag', () => {
  const panel = signInPanel()
  const idMatches = panel.match(/id="mt-auth-gate-title"/g) || []
  assert.equal(idMatches.length, 1, 'exactly one element may own id="mt-auth-gate-title" (duplicate IDs break aria-labelledby / assistive tech)')
  assert.equal(panel.includes('</br>'), false, '</br> is not a valid HTML tag — use <br>')
})

test('sign-in gate offers a demo-mode entry point for first-time users', () => {
  const panel = signInPanel()
  assert.ok(panel.includes('data-mt-auth-action="try-demo"'), 'missing a try-demo button on the sign-in gate')
})

test('try-demo action navigates to demo/index.html without depending on app_v2.js having loaded', () => {
  const handlerIdx = authSync.indexOf("if (action === 'try-demo')")
  assert.ok(handlerIdx >= 0, 'try-demo click handler not found')
  const handler = authSync.slice(handlerIdx, handlerIdx + 300)
  assert.ok(handler.includes('demo/index.html'), 'try-demo handler must navigate to demo/index.html')
  assert.equal(/App\.openDemoApp\(\)/.test(handler), false, 'must not call App.openDemoApp() (app_v2.js may not be loaded yet while the auth gate is shown)')
})
