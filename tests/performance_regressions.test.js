const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const demo = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8')
const onboarding = fs.readFileSync(path.join(root, 'onboarding.js'), 'utf8')
const release = require('../release_manifest.js')

test('derived runtime loads before the application in production and demo', () => {
  for (const html of [index, demo]) {
    const runtime = html.indexOf('derived_runtime.js')
    const application = html.indexOf('app_v2.js')
    assert.ok(runtime >= 0, 'derived runtime script should be present')
    assert.ok(application > runtime, 'derived runtime must load before app_v2.js')
  }
  assert.ok(release.coreAssets.includes('./derived_runtime.js'))
})

test('persist invalidates derived calculations and reward and billing paths use revision memoization', () => {
  assert.match(app, /function persist\([\s\S]{0,500}MT_DERIVED_MEMO\.invalidate/)
  assert.match(app, /App\.getRuleCycleUsage\s*=\s*function[\s\S]{0,800}MT_DERIVED_MEMO\.memoize/)
  assert.match(app, /App\.getTransactionRewardEstimate\s*=\s*function[\s\S]{0,800}MT_DERIVED_MEMO\.memoize/)
  assert.match(app, /App\.getCreditCardBillingState\s*=\s*function[\s\S]{0,500}MT_DERIVED_MEMO\.memoize/)
})

test('initial page render is scheduled through the coalescing coordinator', () => {
  assert.match(app, /createRenderCoordinator/)
  assert.match(app, /App\.requestRender\('initial'\)/)
  assert.match(app, /App\.requestRender\('features-ready'\)/)
  assert.doesNotMatch(app, /try \{ App\.render\(\) \} catch \(err\) \{ console\.warn\('\[Money Tracker\] boot render failed'/)
  assert.doesNotMatch(app, /\/\/ Initial render\s+const renderStart = performance\.now\(\)\s+App\.showPage\(S\.page\)/)
  assert.match(onboarding, /App\.requestRender\('onboarding-ready'\)/)
  assert.doesNotMatch(onboarding, /if\s*\(p === 'dashboard'\)\s*App\.renderDashboard\(\)/)
})
