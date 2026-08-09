/* ============================================================
   State Commit Module
   One Interface for durable local writes and post-commit observers.
   ============================================================ */
'use strict'

;(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.MTStateCommit = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  class StateCommitError extends Error {
    constructor(code, message, cause = null) {
      super(message)
      this.name = 'StateCommitError'
      this.code = code
      this.cause = cause || undefined
    }
  }

  function create({ readState, isReady = () => true, storage, beforeCommit = [], afterCommit = [] } = {}) {
    if (typeof readState !== 'function') throw new TypeError('State Commit requires readState')
    if (!storage || typeof storage.saveAll !== 'function') throw new TypeError('State Commit requires a storage adapter')

    const before = [...beforeCommit].filter(fn => typeof fn === 'function')
    const after = [...afterCommit].filter(fn => typeof fn === 'function')

    function addBeforeCommit(fn) {
      if (typeof fn !== 'function') throw new TypeError('beforeCommit hook must be a function')
      before.push(fn)
      return () => {
        const index = before.indexOf(fn)
        if (index >= 0) before.splice(index, 1)
      }
    }

    function addAfterCommit(fn) {
      if (typeof fn !== 'function') throw new TypeError('afterCommit observer must be a function')
      after.push(fn)
      return () => {
        const index = after.indexOf(fn)
        if (index >= 0) after.splice(index, 1)
      }
    }

    function commit({ reason = 'unspecified' } = {}) {
      if (!isReady()) {
        return { ok: false, reason, error: new StateCommitError('NOT_READY', 'State storage is not hydrated') }
      }

      const state = readState()
      if (!state || typeof state !== 'object') {
        return { ok: false, reason, error: new StateCommitError('INVALID_STATE', 'State Commit could not read state') }
      }

      try {
        before.forEach(fn => fn(state, { reason }))
      } catch (error) {
        return { ok: false, reason, error: new StateCommitError('PREPARE_FAILED', 'State preparation failed', error) }
      }

      let saved = false
      try {
        saved = storage.saveAll(state) === true
      } catch (error) {
        return { ok: false, reason, error: new StateCommitError('WRITE_FAILED', 'State storage threw while saving', error) }
      }
      if (!saved) {
        return { ok: false, reason, error: new StateCommitError('WRITE_FAILED', 'State storage rejected the save') }
      }

      const observerErrors = []
      after.forEach(fn => {
        try { fn(state, { reason }) } catch (error) { observerErrors.push(error) }
      })
      return { ok: true, reason, observerErrors }
    }

    return Object.freeze({ commit, addBeforeCommit, addAfterCommit })
  }

  return Object.freeze({ create, StateCommitError })
})
