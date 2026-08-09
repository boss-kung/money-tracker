const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ScreenHooks = require('../screen_hooks.js')

test.beforeEach(() => ScreenHooks.reset())

test('screen hooks run after the screen Implementation in deterministic order', () => {
  const calls = []
  const app = { renderMore(value) { calls.push(`render:${value}`); return value * 2 } }
  ScreenHooks.register('more', 'late', () => calls.push('late'), { priority: 200 })
  ScreenHooks.register('more', 'early', ctx => calls.push(`early:${ctx.result}`), { priority: 10 })
  ScreenHooks.install(app, { more: 'renderMore' })

  assert.equal(app.renderMore(4), 8)
  assert.deepEqual(calls, ['render:4', 'early:8', 'late'])
})

test('before and after phases share render metadata without wrapping the Implementation', () => {
  const calls = []
  const app = { renderDashboard() { calls.push('render') } }
  ScreenHooks.register('dashboard', 'snapshot', ctx => {
    calls.push('before')
    ctx.metadata.previous = 42
  }, { phase: 'before' })
  ScreenHooks.register('dashboard', 'animate', ctx => calls.push(`after:${ctx.metadata.previous}`))
  ScreenHooks.install(app, { dashboard: 'renderDashboard' })
  app.renderDashboard()
  assert.deepEqual(calls, ['before', 'render', 'after:42'])
})

test('registering the same id replaces the Adapter instead of stacking it', () => {
  const calls = []
  ScreenHooks.register('dashboard', 'feature', () => calls.push('old'))
  ScreenHooks.register('dashboard', 'feature', () => calls.push('new'))
  ScreenHooks.run('dashboard')
  assert.deepEqual(calls, ['new'])
})

test('a failing Adapter does not prevent later screen extensions', () => {
  const calls = []
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    ScreenHooks.register('wallets', 'broken', () => { throw new Error('nope') }, { priority: 1 })
    ScreenHooks.register('wallets', 'healthy', () => calls.push('healthy'), { priority: 2 })
    ScreenHooks.run('wallets')
  } finally {
    console.warn = originalWarn
  }
  assert.deepEqual(calls, ['healthy'])
})

test('feature modules extend screens through the Seam instead of reassigning render methods', () => {
  const pattern = /App\.(?:renderDashboard|renderWallets|renderReports|renderTransactions|renderMore|_renderAddTxDetail)\s*=/
  for (const file of ['onboarding.js', 'notifications_v2.js', 'split_bill.js', 'loans_v2.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    assert.doesNotMatch(source, pattern, file)
  }
})
