const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '../shortcut_profiles.js'), 'utf8')

test('profile wizard exposes two local sample stages and a local test before save', () => {
  assert.match(source, /data-profile-sample="0"/)
  assert.match(source, /data-profile-sample="1"/)
  assert.match(source, /ทดสอบในเครื่อง/)
  assert.match(source, /ต้องมีตัวอย่างแจ้งเตือน 2 รายการ/)
  assert.match(source, /compiled_rule/)
})

test('profile wizard never sends or persists raw samples', () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(/)
  assert.match(source, /createProfile\(input\)/)
  assert.doesNotMatch(source, /createProfile\([^)]*sample/i)
  assert.match(source, /MT-PROFILE:/)
})

test('profile wizard uses user-supplied anchors instead of hardcoding one bank', () => {
  assert.match(source, /data-profile-field="must_contain"/)
  assert.match(source, /data-profile-field="must_not_contain"/)
  assert.match(source, /const mustContain = parseAnchors\(/)
  assert.match(source, /mustNotContain: parseAnchors\(/)
  assert.doesNotMatch(source, /mustContain:\s*\[\s*['"]uchoose['"]\s*\]/i)
})
