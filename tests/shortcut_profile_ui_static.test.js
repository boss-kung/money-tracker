const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const css = fs.readFileSync(path.join(__dirname, '../style_v2.css'), 'utf8')

function selector(name) {
  return new RegExp(`\\.${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\{`)
}

test('profile wizard has a bounded flex shell and one scroll region', () => {
  assert.match(css, selector('shortcut-profile-shell'))
  assert.match(css, /\.shortcut-profile-shell[^{]*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s)
  assert.match(css, /\.shortcut-profile-shell[^{]*\{[^}]*min-height:\s*0/s)
  assert.match(css, /\.shortcut-profile-scroll[^{]*\{[^}]*overflow-y:\s*auto/s)
  assert.match(css, /\.shortcut-profile-scroll[^{]*\{[^}]*min-height:\s*0/s)
})

test('profile controls use themed surfaces, touch targets and iOS-safe text size', () => {
  assert.match(css, selector('shortcut-profile-sample'))
  assert.match(css, selector('shortcut-profile-candidate'))
  assert.match(css, /\.shortcut-profile-shell\s+(?:input|textarea|select)/)
  assert.match(css, /\.shortcut-profile-shell\s+input[^}]*font-size:\s*16px/s)
  assert.match(css, /\.shortcut-profile-shell\s+textarea[^}]*background:\s*var\(--surface-soft\)/s)
  assert.match(css, /\.shortcut-profile-shell\s+select[^}]*background:\s*var\(--surface-soft\)/s)
  assert.match(css, /\.shortcut-profile-shell[^}]*\.btn[^}]*min-height:\s*44px/s)
  assert.match(css, /\.shortcut-profile-candidate[^}]*min-height:\s*(?:44|48)px/s)
})

test('profile footer respects safe area and dark mode tokens', () => {
  assert.match(css, selector('shortcut-profile-footer'))
  assert.match(css, /\.shortcut-profile-footer[^{]*\{[^}]*padding-bottom:[^}]*safe-area-inset-bottom/s)
  assert.match(css, /html\.dark\s+\.shortcut-profile-shell/)
  assert.match(css, /\.shortcut-profile-stepper[^}]*var\(--border\)/s)
})

test('profile animation has a reduced-motion guard and no horizontal overflow', () => {
  assert.match(css, /\.shortcut-profile-shell[^{]*\{[^}]*overflow-x:\s*hidden/s)
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.shortcut-profile-shell[^{]*\{[^}]*animation:\s*none/s)
})
