const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8')

test('boot screen renders an app-shell skeleton immediately', () => {
  const requiredTokens = [
    'id="mt-boot-screen"',
    'aria-label="กำลังเปิดแอป"',
    'mt-boot-shell',
    'mt-boot-hero',
    'mt-boot-metrics',
    'mt-boot-list',
    'mt-boot-row',
    'mt-boot-nav',
    'mt-boot-fab',
    '@keyframes mtBootShimmer',
  ]

  for (const token of requiredTokens) {
    assert.ok(index.includes(token), `missing boot skeleton token: ${token}`)
  }
})

test('pre-body skeleton paints before boot scripts can delay the body', () => {
  const firstScriptIndex = index.indexOf('<script>')
  const preBodyStyleIndex = index.indexOf('html:not(.mt-boot-dom-ready)::before')
  const bootReadyScriptIndex = index.indexOf("document.documentElement.classList.add('mt-boot-dom-ready')")

  assert.notEqual(firstScriptIndex, -1, 'missing first inline script')
  assert.notEqual(preBodyStyleIndex, -1, 'missing pre-body skeleton style')
  assert.notEqual(bootReadyScriptIndex, -1, 'missing boot DOM ready class script')
  assert.ok(preBodyStyleIndex < firstScriptIndex, 'pre-body skeleton must be defined before the first boot script')
  assert.ok(index.includes('@keyframes mtBootPreBodyShimmer'), 'missing pre-body shimmer animation')
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
