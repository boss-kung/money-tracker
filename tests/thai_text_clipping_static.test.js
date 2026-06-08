const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const css = fs.readFileSync(path.join(__dirname, '..', 'style_v2.css'), 'utf8')

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'm'))
  assert.ok(match, `${selector} rule should exist`)
  return match[1]
}

test('modern transaction titles use a Thai-safe line-height while keeping ellipsis', () => {
  const baseTitle = ruleBody('.tx-title')
  const modernTitle = ruleBody('.tx-row-modern .tx-title')

  assert.match(baseTitle, /overflow:\s*hidden/)
  assert.match(baseTitle, /text-overflow:\s*ellipsis/)
  assert.match(baseTitle, /white-space:\s*nowrap/)
  assert.match(modernTitle, /line-height:\s*1\.(3[5-9]|4\d)\s*!important/)
})
