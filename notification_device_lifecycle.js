/* One authenticated installation registration shared by all notification writers. */
;(function(root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.MTNotificationDeviceLifecycle = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function create({ readScope, isEnabled, readSubscription, registerDevice, readBlockReason = () => '', onStatus = () => {}, now = () => Date.now() }) {
    let generation = 0, ready = null, pending = null, blocked = null
    const sameScope = (a, b) => Boolean(a && b && a.key === b.key && a.generation === b.generation)
    function skipped(reason, scope) {
      const result = { status: 'skipped', reason, scope }
      onStatus(result)
      return result
    }
    function block(scopeKey, error) {
      if (readScope()?.key !== scopeKey) return
      ready = null
      const ownership = error.code === 'DEVICE_OWNERSHIP_MISMATCH' || (error.status === 403 && error.message === 'Notification device belongs to another user')
      blocked = { key: scopeKey, until: ownership ? Infinity : now() + 60000, error }
      onStatus({ status: 'error', code: error.code, error: error.message })
    }
    function invalidate(scopeKey) {
      if (ready?.scope.key === scopeKey) ready = null
    }
    function reset() {
      const previous = pending?.promise
      generation++
      ready = pending = blocked = null
      return previous
    }
    async function ensureReady({ activation = false, scope = readScope() } = {}) {
      if (!scope) return skipped('unauthenticated', scope)
      if (!sameScope(scope, readScope())) return skipped('scope-changed', scope)
      if (!activation && !isEnabled()) return skipped('disabled', scope)
      const reason = readBlockReason()
      if (reason) return skipped(reason, scope)
      if (blocked?.key === scope.key && blocked.until > now() && !activation) throw blocked.error
      if (ready && sameScope(ready.scope, scope)) return { status: 'ready', scope }
      if (pending && sameScope(pending.scope, scope)) return pending.promise
      const startingGeneration = generation
      const isCurrent = () => generation === startingGeneration && sameScope(scope, readScope())
      const attempt = { scope, promise: null }
      attempt.promise = (async () => {
        try {
          const subscription = await readSubscription()
          if (!isCurrent()) return { status: 'skipped', reason: 'scope-changed' }
          if (!activation && !isEnabled()) return skipped('disabled', scope)
          const currentReason = readBlockReason()
          if (currentReason) return skipped(currentReason, scope)
          if (!subscription) return skipped('subscription-required', scope)
          onStatus({ status: 'registering' })
          await registerDevice(scope, subscription)
          if (!isCurrent()) return { status: 'skipped', reason: 'scope-changed' }
          ready = { scope }
          blocked = null
          onStatus({ status: 'ready' })
          return { status: 'ready', scope }
        } catch (error) {
          if (isCurrent()) block(scope.key, error)
          throw error
        } finally {
          if (pending === attempt) pending = null
        }
      })()
      pending = attempt
      return attempt.promise
    }
    return { ensureReady, invalidate, reset, block }
  }
  return { create }
})
