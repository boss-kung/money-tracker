/* Explicit Seam for extending App screen rendering without monkey-patching. */
;(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.MTScreenHooks = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const hooks = new Map()
  const installed = new WeakMap()

  function list(screen, phase = 'after') {
    return [...(hooks.get(screen) || new Map()).values()]
      .filter(entry => entry.phase === phase)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  }

  function register(screen, id, callback, options = {}) {
    if (!screen || !id || typeof callback !== 'function') {
      throw new TypeError('screen, id, and callback are required')
    }
    const entries = hooks.get(screen) || new Map()
    const phase = options.phase === 'before' ? 'before' : 'after'
    entries.set(id, {
      id,
      callback,
      phase,
      priority: Number.isFinite(options.priority) ? options.priority : 100,
    })
    hooks.set(screen, entries)
    return function unregister() {
      entries.delete(id)
      if (entries.size === 0) hooks.delete(screen)
    }
  }

  function run(screen, context = {}, phase = 'after') {
    for (const hook of list(screen, phase)) {
      try {
        hook.callback(context)
      } catch (error) {
        console.warn(`[screen hook:${screen}:${hook.id}]`, error)
      }
    }
  }

  function install(app, mapping) {
    if (!app || !mapping) return
    const appMethods = installed.get(app) || new Map()
    for (const [screen, method] of Object.entries(mapping)) {
      if (appMethods.has(method) || typeof app[method] !== 'function') continue
      const implementation = app[method]
      app[method] = function (...args) {
        const context = { app: this, args, result: undefined, screen, method, metadata: {} }
        run(screen, context, 'before')
        const result = implementation.apply(this, args)
        context.result = result
        run(screen, context, 'after')
        return result
      }
      appMethods.set(method, implementation)
    }
    installed.set(app, appMethods)
  }

  function reset() {
    hooks.clear()
  }

  return Object.freeze({ register, run, install, list, reset })
})
