const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8')

test('boot screen skeleton has been removed', () => {
  const removedTokens = [
    'id="mt-boot-screen"',
    'mt-boot-shell',
    'mt-boot-hero',
    'mt-boot-metrics',
    'mt-boot-list',
    'mt-boot-row',
    'mt-boot-nav',
    'mt-boot-fab',
    '@keyframes mtBootShimmer',
  ]

  for (const token of removedTokens) {
    assert.equal(index.includes(token), false, `boot skeleton token should be removed: ${token}`)
  }
})

test('html/body paint the skeleton background colour so the WebView never flashes white', () => {
  // The first <style> in the head must set the skeleton base colour on html/body
  // before any boot script runs, and must NOT reintroduce a hardcoded pre-body
  // fake skeleton.
  const headStyle = index.slice(0, index.indexOf('</head>'))
  assert.ok(/html,\s*body\s*\{[^}]*background:\s*#EEF6FF/i.test(headStyle), 'missing light skeleton background on html/body')
  assert.ok(index.includes('background: #09111F'), 'missing dark skeleton background')
  assert.equal(index.includes('mt-boot-dom-ready'), false, 'removed pre-body skeleton class should not return')
  assert.equal(index.includes('mtBootPreBodyShimmer'), false, 'removed pre-body shimmer should not return')
})

test('iOS cold-start launch screens are defined so there is no native white flash', () => {
  // Without apple-touch-startup-image, iOS shows a white launch screen before the
  // WebView paints. Require theme-aware startup images matching the skeleton bg.
  assert.ok(index.includes('rel="apple-touch-startup-image"'), 'missing apple-touch-startup-image links')
  assert.ok(index.includes('prefers-color-scheme: light) and (orientation: portrait)'), 'missing light launch image media query')
  assert.ok(index.includes('prefers-color-scheme: dark) and (orientation: portrait)'), 'missing dark launch image media query')
  assert.ok(index.includes('./assets/splash/splash-'), 'startup images should point at generated splash assets')
})

test('boot screen does not show the old branded loading panel', () => {
  const forbiddenTokens = [
    'mt-boot-title',
    'mt-boot-subtitle',
    'mt-boot-bar',
    'mtBootBounce',
    'mtBootSlide',
    'กำลังเตรียมข้อมูลการเงิน',
  ]

  for (const token of forbiddenTokens) {
    assert.equal(index.includes(token), false, `old loading token should be removed: ${token}`)
  }
})
