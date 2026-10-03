;(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.MTDerivedRuntime = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function createMemoStore({ readEpoch } = {}) {
    let stateRevision = 0
    const namespaces = new Map()
    let epoch = typeof readEpoch === 'function' ? readEpoch() : undefined

    function memoize(namespace, key, compute) {
      if (typeof compute !== 'function') throw new TypeError('memoize requires a compute function')
      if (typeof readEpoch === 'function') {
        const nextEpoch = readEpoch()
        if (nextEpoch !== epoch) {
          epoch = nextEpoch
          invalidate()
        }
      }
      const name = String(namespace || 'default')
      let cache = namespaces.get(name)
      if (!cache) {
        cache = new Map()
        namespaces.set(name, cache)
      }
      if (cache.has(key)) return cache.get(key)
      const value = compute()
      cache.set(key, value)
      return value
    }

    function invalidate() {
      stateRevision += 1
      namespaces.clear()
      return stateRevision
    }

    return Object.freeze({
      memoize,
      invalidate,
      revision: () => stateRevision,
    })
  }

  function createRenderCoordinator({ render, schedule } = {}) {
    if (typeof render !== 'function') throw new TypeError('render coordinator requires a render function')
    const enqueue = typeof schedule === 'function' ? schedule : callback => setTimeout(callback, 0)
    const pendingReasons = new Set()
    let scheduled = false

    function flush() {
      scheduled = false
      if (!pendingReasons.size) return
      const reasons = [...pendingReasons]
      pendingReasons.clear()
      try {
        render(reasons)
      } finally {
        if (pendingReasons.size && !scheduled) {
          scheduled = true
          enqueue(flush)
        }
      }
    }

    function request(reason = 'unspecified') {
      pendingReasons.add(String(reason || 'unspecified'))
      if (scheduled) return
      scheduled = true
      enqueue(flush)
    }

    return Object.freeze({
      request,
      flush,
      isScheduled: () => scheduled,
    })
  }

  return Object.freeze({ createMemoStore, createRenderCoordinator })
})
