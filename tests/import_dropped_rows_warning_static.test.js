const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')

test('_validateImportPayload reports the original (pre-filter) transaction count', () => {
  const fnStart = app.indexOf('App._validateImportPayload = function')
  assert.ok(fnStart >= 0, '_validateImportPayload not found')
  const fnBody = app.slice(fnStart, app.indexOf('\n  }', fnStart))
  assert.match(fnBody, /originalTransactionCount:\s*data\.transactions\.length/,
    'must report the count before filtering, so callers can show "N skipped out of M in file"')
})

test('import preview flags the dropped-row count next to the transactions tile itself, not only in a footnote', () => {
  const fnStart = app.indexOf('App.openImportPreview = function')
  assert.ok(fnStart >= 0, 'openImportPreview not found')
  const fnBody = app.slice(fnStart, app.indexOf('\n  }', fnStart))
  assert.match(fnBody, /droppedNote/, "the transactions count tile must include an inline '(ข้าม N)' note — otherwise the shown count silently looks like the file's full total")
})

test('import preview lists every distinct skip reason (grouped with counts), not just the first 3 raw warnings', () => {
  const fnStart = app.indexOf('App.openImportPreview = function')
  const fnBody = app.slice(fnStart, app.indexOf('\n  }', fnStart))
  assert.equal(/warnings\.slice\(0,\s*3\)/.test(fnBody), false, 'must not truncate to the first 3 warnings — a file with more than 3 distinct skip reasons would hide the rest')
  assert.match(fnBody, /warningGroups/, 'must group warnings (e.g. by message) so repeated reasons collapse into a count instead of being silently cut off')
})
