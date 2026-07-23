const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const css = fs.readFileSync(path.join(root, 'style_v2.css'), 'utf8')

test('.wc-edit-btn gets an invisible ::before hit-area reaching the 44px touch minimum', () => {
  const rule = css.slice(css.indexOf('.wc-edit-btn {'), css.indexOf('.wc-edit-btn::before'))
  assert.match(rule, /position:\s*relative/, '.wc-edit-btn must be position:relative for the ::before hit-area to anchor to it')
  const pseudo = css.slice(css.indexOf('.wc-edit-btn::before'), css.indexOf('.wc-edit-btn::before') + 200)
  assert.match(pseudo, /inset:\s*-6px -10px -5px -3px/, 'hit-area inset must reach 31+3+10=44 width and 33+6+5=44 height')
})

test('.wallet-tab uses real padding (not a hit-area pseudo) to reach 44px, since its scroll-container parent clips overflow', () => {
  const rule = css.slice(css.indexOf('.wallet-tab {'), css.indexOf('.wallet-tab {') + 400)
  assert.match(rule, /min-height:\s*44px/, '.wallet-tab must have a real min-height of 44px')
  assert.equal(css.includes('.wallet-tab::before'), false, '.wallet-tab should not use a ::before hit-area rule — .wallet-tab-bar has overflow-x:auto, which computes overflow-y to auto too and would clip an absolutely-positioned pseudo reaching past the tab')
})

test('.wc-card-pay-btn reaches 44px height on colored (credit card) wallets specifically, not just the base rule', () => {
  // The base .wc-card-pay-btn rule alone is not enough: a more specific
  // .wallet-card.wallet-card-colored .wc-card-pay-btn rule re-overrides
  // min-height back down to 32px !important for every credit card (the
  // only place this button actually renders) — both must be fixed.
  // Anchor on a leading newline so this doesn't match the tail of the
  // longer ".wallet-card.wallet-card-colored .wc-card-pay-btn {" selector.
  const baseIdx = css.indexOf('\n.wc-card-pay-btn {')
  assert.ok(baseIdx >= 0, 'standalone .wc-card-pay-btn rule not found')
  const baseRule = css.slice(baseIdx, baseIdx + 200)
  assert.match(baseRule, /min-height:\s*44px\s*!important/, 'base .wc-card-pay-btn rule must set min-height: 44px')

  const coloredRuleMarker = '.wallet-card.wallet-card-colored .wc-card-pay-btn {\n  min-height: 44px !important;\n}'
  assert.ok(css.includes(coloredRuleMarker), 'a second, more specific rule must re-assert min-height:44px for .wallet-card-colored .wc-card-pay-btn, since the earlier combined selector rule sets it back to 32px !important')
})

test('.wallet-section-refresh-btn gets an invisible ::before hit-area reaching the 44px touch minimum', () => {
  const rule = css.slice(css.indexOf('.wallet-section-refresh-btn{'), css.indexOf('.wallet-section-refresh-btn::before'))
  assert.match(rule, /position:relative/, '.wallet-section-refresh-btn must be position:relative for the ::before hit-area to anchor to it')
  const pseudo = css.slice(css.indexOf('.wallet-section-refresh-btn::before'), css.indexOf('.wallet-section-refresh-btn::before') + 200)
  assert.match(pseudo, /inset:-6px -6px -6px -8px/, 'hit-area inset must reach 33+8+6=47 width and 36+6+6=48 height')
})
