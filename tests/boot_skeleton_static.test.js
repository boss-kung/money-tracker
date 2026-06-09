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
