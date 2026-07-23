const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')
const css = fs.readFileSync(path.join(root, 'style_v2.css'), 'utf8')

test('reports fade-in uses a declarative CSS animation class, not inline opacity + setTimeout', () => {
  const patchMatch = app.match(/_patchRReportsExtra[\s\S]*?N24: insight rows/)
  assert.ok(patchMatch, 'N13 renderReports patch not found')
  const patchBody = patchMatch[0]

  assert.ok(
    patchBody.includes("classList.add('mt-reports-fade-in')"),
    'renderReports patch must toggle the mt-reports-fade-in class'
  )
  assert.equal(
    /content\.style\.opacity\s*=/.test(patchBody),
    false,
    'must not manipulate content.style.opacity directly — that inline-style + setTimeout pattern can be left mid-transition if renderReports() re-enters before the timeout fires'
  )
  assert.equal(
    /setTimeout\(\(\) => \{ content\.style/.test(patchBody),
    false,
    'must not rely on a setTimeout to clear inline transition/opacity styles'
  )
})

test('mt-reports-fade-in keyframes exist and animate opacity 0 -> 1', () => {
  assert.ok(css.includes('@keyframes mt-reports-fade-in'), 'missing @keyframes mt-reports-fade-in')
  assert.ok(css.includes('.mt-reports-fade-in {'), 'missing .mt-reports-fade-in rule')
  const block = css.slice(css.indexOf('@keyframes mt-reports-fade-in'), css.indexOf('.mt-reports-fade-in {') + 200)
  assert.match(block, /from\s*\{\s*opacity:\s*0;?\s*\}/)
  assert.match(block, /to\s*\{\s*opacity:\s*1;?\s*\}/)
})
