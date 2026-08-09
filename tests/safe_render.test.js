const test = require('node:test')
const assert = require('node:assert/strict')
const { escapeHtml, jsArg } = require('../safe_render.js')

function decodeAttribute(value) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

test('escapeHtml encodes every HTML text and attribute delimiter', () => {
  assert.equal(escapeHtml(`<img src=x onerror="x"> O'Reilly & Co`), '&lt;img src=x onerror=&quot;x&quot;&gt; O&#39;Reilly &amp; Co')
})

test('jsArg keeps hostile input inside one JavaScript string argument', () => {
  const hostile = `x');globalThis.pwned=true;//\"<&\u2028`
  const source = `capture(${decodeAttribute(jsArg(hostile))})`
  let captured = ''
  Function('capture', source)(value => { captured = value })
  assert.equal(captured, hostile)
  assert.doesNotMatch(jsArg(hostile), /[<>]/)
  assert.doesNotMatch(jsArg(hostile), /globalThis\.pwned=true;\/\/"/)
})
