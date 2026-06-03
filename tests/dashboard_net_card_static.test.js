const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')
const css = fs.readFileSync(path.join(root, 'style_v2.css'), 'utf8')

test('dashboard net card exposes approved finance-card regions', () => {
  const requiredAppTokens = [
    'mt-net-hero',
    'mt-net-main',
    'mt-net-status',
    'mt-net-ring',
    'mt-net-sparkline',
    'mt-net-metric-icon',
    'สินทรัพย์สุทธิ',
    'เงินพร้อมใช้',
    'สถานะการเงิน',
    'Healthy',
    'รายรับ',
    'รายจ่าย',
    'หนี้สิน',
    'บิลค้างจ่าย',
  ]

  for (const token of requiredAppTokens) {
    assert.ok(app.includes(token), `missing app token: ${token}`)
  }
})

test('dashboard net card keeps animation hooks and dark mode styling', () => {
  const requiredCssTokens = [
    '.mt-net-card',
    '.mt-net-card::before',
    '.mt-net-value',
    '.mt-net-split',
    '.mt-net-ring',
    '.mt-net-sparkline',
    'html.dark .mt-net-card',
    '@keyframes mt-aurora',
  ]

  for (const token of requiredCssTokens) {
    assert.ok(css.includes(token), `missing css token: ${token}`)
  }

  assert.equal(css.includes('.mt-net-card::after'), false)
})

test('dashboard net card mobile metrics use icon plus text rows', () => {
  const netCardCss = css.slice(css.indexOf('.mt-net-card {'), css.indexOf('.mt-alert-card {'))
  const requiredCssTokens = [
    '@media (max-width: 560px)',
    'grid-template-columns: repeat(2, minmax(0, 1fr))',
    '.mt-net-metric {',
    'grid-template-columns: 40px minmax(0, 1fr)',
    '.mt-net-metric-icon {',
    'grid-row: 1 / 4',
    'margin-bottom: 0',
    '.mt-net-split .mt-divider { display: none; }',
  ]

  for (const token of requiredCssTokens) {
    assert.ok(netCardCss.includes(token), `missing mobile metric css token: ${token}`)
  }

  assert.equal(netCardCss.includes('border-left: 1px solid rgba(255,255,255,.18)'), false)
  assert.equal(netCardCss.includes('border-top: 1px solid rgba(255,255,255,.18)'), false)
})

test('dashboard net card background does not use grid-line texture', () => {
  assert.equal(css.includes('repeating-linear-gradient'), false)
})
