const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

test('quick capture exposes only the pure category suggestion seam', () => {
  const source = fs.readFileSync('quick_capture.js', 'utf8')
  assert.match(source, /MTQuickCapture/) 
  assert.match(source, /inferCategoryId/)
  assert.doesNotMatch(source, /MTQuickCapture\s*=\s*\{[^}]*save/i)
})

