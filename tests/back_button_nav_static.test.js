const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')

function patchBlock() {
  const start = app.indexOf('_patchHistoryBackNav')
  assert.ok(start >= 0, '_patchHistoryBackNav block not found')
  return app.slice(start, app.length)
}

test('registers a single popstate listener to intercept the hardware/OS back button', () => {
  const block = patchBlock()
  assert.ok(block.includes("addEventListener('popstate'"), 'missing popstate listener')
})

test('wraps openOverlay/closeOverlay, openSubScreen/closeSubScreen, and showConfirm', () => {
  const block = patchBlock()
  for (const fn of ['App.openOverlay', 'App.closeOverlay', 'App.openSubScreen', 'App.closeSubScreen', 'App.showConfirm']) {
    assert.ok(block.includes(`${fn} = function`), `missing wrapper for ${fn}`)
  }
})

test('popLayer refuses to consume history it never pushed (depth guard)', () => {
  const block = patchBlock()
  const fnStart = block.indexOf('function popLayer')
  assert.ok(fnStart >= 0, 'popLayer not found')
  const fn = block.slice(fnStart, fnStart + 200)
  assert.match(fn, /if \(depth <= 0\) return/, 'popLayer must bail out before calling history.back() when depth is already 0 — otherwise a mismatched close call walks back real app/browser history')
})

test('open/close tracking is synchronous (own state), not derived from animation-delayed CSS classes', () => {
  const block = patchBlock()
  // openOverlay/closeOverlay must consult a plain Set we control, not classList,
  // because closeOverlay/closeSubScreen animate out over ~280-380ms before their
  // .open class is actually removed — classList right after calling them is stale.
  assert.ok(block.includes('openOverlayIds.has(id)'), 'openOverlay/closeOverlay must check openOverlayIds, not classList')
  assert.ok(block.includes('subScreenRequestedOpen'), 'openSubScreen/closeSubScreen must check subScreenRequestedOpen, not classList')
})

test('closeTopLayer prioritizes confirm dialog, then overlay, then sub-screen', () => {
  const block = patchBlock()
  const fnStart = block.indexOf('function closeTopLayer')
  const fnEnd = block.indexOf('window.addEventListener', fnStart)
  const fn = block.slice(fnStart, fnEnd)
  const confirmIdx = fn.indexOf('v23-confirm-overlay')
  const overlayIdx = fn.indexOf('.overlay.open')
  const subScreenIdx = fn.indexOf("getElementById('sub-screen')")
  assert.ok(confirmIdx >= 0 && overlayIdx > confirmIdx && subScreenIdx > overlayIdx,
    'closeTopLayer must check confirm dialog, then overlay, then sub-screen in that order — the topmost visual layer must close first')
})

test('closeTopLayer reuses the same close path the user would (closeAddTx special-cased, closeOverlay otherwise)', () => {
  const block = patchBlock()
  const fnStart = block.indexOf('function closeTopLayer')
  const fnEnd = block.indexOf('window.addEventListener', fnStart)
  const fn = block.slice(fnStart, fnEnd)
  assert.ok(fn.includes("top.id === 'overlay-add-tx'") && fn.includes('App.closeAddTx'), 'must special-case overlay-add-tx to closeAddTx (it resets tx draft state beyond what closeOverlay does)')
  assert.ok(fn.includes('App.closeOverlay?.(top.id)'), 'must fall back to closeOverlay for other overlays')
})
