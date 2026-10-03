const test = require('node:test')
const assert = require('node:assert/strict')

const DerivedRuntime = require('../derived_runtime.js')

test('memo store reuses values within a state revision and recomputes after invalidation', () => {
  const store = DerivedRuntime.createMemoStore()
  let computations = 0

  const first = store.memoize('billing', 'card:2026-10-03', () => ({ run: ++computations }))
  const second = store.memoize('billing', 'card:2026-10-03', () => ({ run: ++computations }))

  assert.equal(first, second)
  assert.equal(computations, 1)
  assert.equal(store.revision(), 0)

  store.invalidate('transaction-save')
  const afterChange = store.memoize('billing', 'card:2026-10-03', () => ({ run: ++computations }))

  assert.notEqual(afterChange, first)
  assert.equal(afterChange.run, 2)
  assert.equal(store.revision(), 1)
})

test('render coordinator coalesces boot requests and keeps rendering available afterwards', () => {
  const scheduled = []
  const renders = []
  const coordinator = DerivedRuntime.createRenderCoordinator({
    schedule: callback => scheduled.push(callback),
    render: reasons => renders.push([...reasons]),
  })

  coordinator.request('initial')
  coordinator.request('dashboard-extension')
  coordinator.request('onboarding')

  assert.equal(scheduled.length, 1)
  assert.deepEqual(renders, [])
  scheduled.shift()()
  assert.deepEqual(renders, [['initial', 'dashboard-extension', 'onboarding']])

  coordinator.request('user-refresh')
  assert.equal(scheduled.length, 1)
  scheduled.shift()()
  assert.deepEqual(renders[1], ['user-refresh'])
})

test('render requests raised during a render are delivered in a following frame', () => {
  const scheduled = []
  const renders = []
  let coordinator
  coordinator = DerivedRuntime.createRenderCoordinator({
    schedule: callback => scheduled.push(callback),
    render: reasons => {
      renders.push([...reasons])
      if (renders.length === 1) coordinator.request('follow-up')
    },
  })

  coordinator.request('initial')
  scheduled.shift()()
  assert.deepEqual(renders, [['initial']])
  assert.equal(scheduled.length, 1)
  scheduled.shift()()
  assert.deepEqual(renders, [['initial'], ['follow-up']])
})
