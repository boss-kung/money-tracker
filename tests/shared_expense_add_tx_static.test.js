const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')

test('quick shared expense lets users edit their personal share in add tx', () => {
  assert.match(
    appSource,
    /App\.setSharedExpenseField\('myShare', this\.value\)/,
    'Add Tx shared expense panel should expose an editable personal share input'
  )
  assert.match(
    appSource,
    /const rawMyShare = Number\(raw\.myShare\)/,
    'shared expense normalization should preserve a manually entered personal share'
  )
})
