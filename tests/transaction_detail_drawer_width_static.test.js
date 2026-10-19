const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const css = fs.readFileSync(path.join(__dirname, '..', 'style_v2.css'), 'utf8')

test('transaction detail and add-transaction sheets stay edge-to-edge', () => {
  const edgeToEdgeRule = css.lastIndexOf('#overlay-add-tx .sheet,')
  const desktopNarrowRule = css.lastIndexOf('#overlay-tx-detail .sheet {\n    max-width: 620px !important;')
  assert.ok(edgeToEdgeRule > desktopNarrowRule, 'edge-to-edge override must come after the desktop max-width rule')
  assert.match(
    css,
    /#overlay-add-tx \.sheet,\s*#overlay-tx-detail \.sheet\s*\{[^}]*width:\s*100%\s*!important;[^}]*max-width:\s*none\s*!important;[^}]*margin-inline:\s*0\s*!important;/s,
    'drawer sheet width must not be narrowed by a later max-width rule'
  )
})
