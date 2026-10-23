const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

test('capture suggestions expose category and merchant lookup without save actions', () => {
  const source = fs.readFileSync('quick_capture.js', 'utf8')
  assert.match(source, /MTQuickCapture/) 
  assert.match(source, /inferCategoryId/)
  assert.match(source, /matchMerchant/)
  assert.doesNotMatch(source, /MTQuickCapture\s*=\s*\{[^}]*save/i)
})

