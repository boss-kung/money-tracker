const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const css = fs.readFileSync(path.join(root, 'style_v2.css'), 'utf8')

test('.page-scroll reserves enough bottom padding to clear the floating FAB', () => {
  assert.ok(css.includes('--fab-clearance:'), 'missing --fab-clearance custom property')
  assert.ok(css.includes('--fab-mic-clearance:'), 'missing --fab-mic-clearance custom property')

  const marker = '/* Page density */'
  const rule = css.slice(css.indexOf(marker), css.indexOf(marker) + 500)
  assert.match(rule, /padding-bottom:\s*var\(--fab-clearance\)\s*!important/)
})

test('dashboard and transactions lists also clear the quick-capture mic button above the FAB', () => {
  const marker = 'body.is-dashboard #dashboard-content,\nbody.is-transactions #tx-list-content'
  assert.ok(css.includes(marker), 'missing combined dashboard+transactions mic-clearance rule')
  const rule = css.slice(css.indexOf(marker), css.indexOf(marker) + 300)
  assert.match(rule, /padding-bottom:\s*var\(--fab-mic-clearance\)\s*!important/)
})

test('fab-clearance formulas stay derived from the same tokens #fab / #fab-mic use for their own bottom offset', () => {
  const clearanceBlock = css.slice(css.indexOf('--fab-clearance:'), css.indexOf('--fab-mic-clearance:') + 200)
  for (const token of ['var(--nav-h)', 'var(--safe-b)', 'var(--app-bottom-gap)', 'var(--fab-size)']) {
    assert.ok(clearanceBlock.includes(token), `--fab-clearance/--fab-mic-clearance must reference ${token}`)
  }
})

test('#wallets-content ID rule does not reintroduce an ad-hoc padding-bottom that would silently outrank .page-scroll', () => {
  // ID selectors beat the .page-scroll class regardless of source order, so any
  // #wallets-content / #tx-list-content rule MUST reuse the shared clearance
  // variables — a hardcoded calc() here previously masked the .page-scroll fix.
  const walletsRule = css.slice(css.indexOf('#wallets-content { display:block'), css.indexOf('#wallets-content { display:block') + 250)
  assert.ok(walletsRule.includes('padding-bottom:var(--fab-clearance)'), '#wallets-content must reuse var(--fab-clearance)')
})

test('#tx-list-content ID rule reuses the shared mic-clearance variable, not its own calc()', () => {
  const txRule = css.slice(css.indexOf('#tx-list-content {\n  padding:'), css.indexOf('#tx-list-content {\n  padding:') + 150)
  assert.ok(txRule.includes('var(--fab-mic-clearance)'), '#tx-list-content must reuse var(--fab-mic-clearance)')
  assert.equal(/calc\(var\(--nav-h\)/.test(txRule), false, '#tx-list-content must not hand-roll its own nav-h based calc()')
})
