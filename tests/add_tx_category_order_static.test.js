const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')

function functionBody(name) {
  const marker = `${name} = function`
  const start = appSource.indexOf(marker)
  assert.notEqual(start, -1, `${name} should exist`)
  const next = appSource.indexOf('\n  App.', start + marker.length)
  assert.notEqual(next, -1, `${name} body should be bounded by the next App function`)
  return appSource.slice(start, next)
}

test('add transaction category grid moves the active category to the front on rerender', () => {
  const body = functionBody('App._renderAddTxDetail')

  assert.match(body, /_activeCatId\s*=\s*S\.tx\.categoryId\s*\|\|\s*''/)
  assert.match(body, /_frontCatId\s*=\s*_suggestedCatId\s*\|\|\s*_activeCatId/)
  assert.match(body, /allCats\.find\(c\s*=>\s*c\.id\s*===\s*_frontCatId\)/)
  assert.match(body, /allCats\.filter\(c\s*=>\s*c\.id\s*!==\s*_frontCatId\)/)
})

test('add transaction keeps other category last unless other is the active category', () => {
  assert.match(appSource, /const isOtherActive\s*=\s*Array\.from\(grid\.children\)\.some/)
  assert.match(appSource, /btn\.dataset\.catid\s*===\s*S\.tx\?\.categoryId/)
  assert.match(appSource, /lbl\s*===\s*'อื่น'\s*\|\|\s*lbl\s*===\s*'อื่นๆ'/)
  assert.match(appSource, /if\s*\(!hasSuggestion\s*&&\s*!isOtherActive\)/)
})
