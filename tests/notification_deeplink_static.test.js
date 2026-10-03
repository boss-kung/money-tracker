const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const app = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')

test('cold-start open= deep links are read before showPage rewrites the hash', () => {
  const start = app.indexOf('\nfunction init() {')
  const end = app.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start, 'init() not found')
  const body = app.slice(start, end)
  const firstRender = body.indexOf("App.requestRender('initial')")
  assert.ok(firstRender > 0, 'initial render not found')
  // showPage() replaces "#more?open=goals" with "#more", so re-parsing afterwards loses open=.
  assert.equal(body.indexOf('parseAppHashRoute()', firstRender), -1)
  assert.match(body, /const _initOpen = route\.params\.get\('open'\)/)
  assert.ok(body.indexOf('const route = parseAppHashRoute()') < firstRender)
})
