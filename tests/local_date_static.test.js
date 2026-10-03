const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const app = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')

// toISOString() is UTC: in Thailand (UTC+7) it returns yesterday's date from
// 00:00 to 06:59, which shifted calendars, cycle sheets and month views.
test('app_v2 derives "today" and "this month" from the local clock', () => {
  const offenders = app.split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => /new Date\(\)\.toISOString\(\)\.slice\(0,\s*(?:7|10)\)/.test(line))
    .map(({ line, number }) => `${number}: ${line.slice(0, 120)}`)
  assert.deepEqual(offenders, [])
  assert.doesNotMatch(app, /typeof today === 'function'/)
})
