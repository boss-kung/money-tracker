/* Auth-scoped transport and orchestration for the reviewed Shortcut inbox. */
;(function (root, factory) {
  const api = factory(root)
  if (root) root.MTShortcutCapture = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const DEVICE_KEY = 'mt_shortcut_client_device'
  const ACK_PREFIX = 'mt_shortcut_ack_queue:'
  const core = root.MTShortcutCaptureCore || (typeof require === 'function' ? require('./shortcut_capture_core.js') : null)
  const summaries = new Map()
  const claims = new Map()
  let activeCaptureId = ''
  let loaded = false

  class TransportError extends Error {
    constructor(code, message = code, status = 0, retryable = false) {
      super(message); this.name = 'TransportError'; this.code = code; this.status = status; this.retryable = retryable
    }
  }

  function authSnapshot() {
    const state = root.MTAuthSync?.state || {}
    return { userId: String(state.user?.id || ''), accessToken: String(state.session?.access_token || '') }
  }

  function sameScope(left, right) { return left.userId === right.userId && left.accessToken === right.accessToken }
  function requireAuth(scope = authSnapshot()) {
    if (!scope.userId || !scope.accessToken) throw new TransportError('AUTH_REQUIRED')
    return scope
  }
  function ensureScope(scope) {
    if (!sameScope(scope, authSnapshot())) throw new TransportError('AUTH_SCOPE_CHANGED')
  }
  function online() { return root.navigator?.onLine !== false }
  function config() {
    const base = String(root.MT_SUPABASE_URL || '').replace(/\/+$/, '')
    if (!base) throw new TransportError('CONFIG_MISSING')
    return { base, anonKey: String(root.MT_SUPABASE_ANON_KEY || '') }
  }
  function endpoint(functionName, path = '') { return `${config().base}/functions/v1/${functionName}${path}` }

  async function request(functionName, path, options = {}, scope = requireAuth()) {
    if (!online()) throw new TransportError('OFFLINE', 'offline', 0, true)
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timeout = setTimeout(() => controller?.abort(), Math.max(1000, Number(options.timeoutMs || 12000)))
    try {
      const response = await root.fetch(endpoint(functionName, path), {
        method: options.method || 'GET',
        headers: { apikey: config().anonKey, Authorization: `Bearer ${scope.accessToken}`, 'Content-Type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller?.signal,
      })
      let payload = null
      try { payload = await response.json() } catch (_) {}
      ensureScope(scope)
      if (!response.ok) {
        const code = String(payload?.code || payload?.error || `HTTP_${response.status}`)
        throw new TransportError(code, code, response.status, response.status >= 500 || response.status === 408 || response.status === 429)
      }
      return payload || {}
    } catch (error) {
      if (error instanceof TransportError) throw error
      if (error?.name === 'AbortError') throw new TransportError('TIMEOUT', 'timeout', 408, true)
      throw new TransportError('NETWORK_ERROR', 'network_error', 0, true)
    } finally {
      clearTimeout(timeout)
    }
  }

  function readQueue(userId) {
    if (!userId) return []
    try {
      const value = JSON.parse(root.localStorage?.getItem(`${ACK_PREFIX}${userId}`) || '[]')
      return Array.isArray(value) ? value.filter(job => job && job.captureId && job.transactionId) : []
    } catch (_) { return [] }
  }
  function writeQueue(userId, queue) {
    if (!userId) return
    try { root.localStorage?.setItem(`${ACK_PREFIX}${userId}`, JSON.stringify(queue)) } catch (_) {}
  }
  function enqueue(job) {
    const scope = authSnapshot()
    if (!scope.userId) return
    writeQueue(scope.userId, core.mergeAckJob(readQueue(scope.userId), job))
  }
  function clientDeviceId() {
    try {
      let value = root.localStorage?.getItem(DEVICE_KEY)
      if (!value) { value = root.crypto?.randomUUID?.() || `00000000-0000-4000-8000-${Math.random().toString(16).slice(2).padStart(12, '0').slice(-12)}`; root.localStorage?.setItem(DEVICE_KEY, value) }
      return value
    } catch (_) { return root.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000000' }
  }

  function toast(message, type = 'info') { try { root.toast?.(message, type) } catch (_) {} }
  function removeSummary(id) { summaries.delete(String(id)) }

  async function refresh() {
    const scope = requireAuth()
    const result = await request('shortcut-inbox', '?view=pending&limit=50', {}, scope)
    ensureScope(scope)
    summaries.clear()
    for (const item of Array.isArray(result.items) ? result.items : []) summaries.set(String(item.capture_id), item)
    loaded = true
    return snapshot()
  }

  async function claim(id) {
    const scope = requireAuth()
    const result = await request('shortcut-inbox', '/claim', { method: 'POST', body: { capture_id: String(id), device_id: clientDeviceId() } }, scope)
    ensureScope(scope)
    claims.set(String(id), { ...result, captureId: String(id) })
    const preview = { ...(summaries.get(String(id)) || {}), capture_id: String(id), ...(result.capture || {}) }
    delete preview.raw_text
    delete preview.relevant_text
    summaries.set(String(id), preview)
    return result
  }
  async function release(id) {
    const capture = claims.get(String(id)); if (!capture) return { ok: true }
    const scope = requireAuth()
    const result = await request('shortcut-inbox', '/release', { method: 'POST', body: { capture_id: String(id), claim_secret: capture.claim_secret } }, scope)
    claims.delete(String(id)); if (activeCaptureId === String(id)) activeCaptureId = ''
    return result
  }
  async function dismiss(id) {
    const capture = claims.get(String(id))
    const result = await request('shortcut-inbox', '/dismiss', { method: 'POST', body: { capture_id: String(id), ...(capture?.claim_secret ? { claim_secret: capture.claim_secret } : {}) } })
    claims.delete(String(id)); removeSummary(id)
    return result
  }
  async function restore(id) {
    const result = await request('shortcut-inbox', '/restore', { method: 'POST', body: { capture_id: String(id) } })
    return result
  }
  async function listTokens() { return request('manage-shortcut-tokens', '') }
  async function createToken(label) { return request('manage-shortcut-tokens', '', { method: 'POST', body: { label } }) }
  async function revokeToken(id) { return request('manage-shortcut-tokens', `/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: {} }) }

  async function acknowledge(capture, scope = requireAuth()) {
    const transactionId = core.transactionId(capture.captureId)
    try {
      const result = await request('shortcut-inbox', '/consume', { method: 'POST', body: { capture_id: capture.captureId, claim_secret: capture.claim_secret, transaction_id: transactionId } }, scope)
      claims.delete(capture.captureId); removeSummary(capture.captureId); if (activeCaptureId === capture.captureId) activeCaptureId = ''
      return result
    } catch (error) {
      if (error.retryable) enqueue(core.makeAckJob(capture.captureId, transactionId, capture.capture?.dedupe_version, capture.capture?.dedupe_key, new Date().toISOString()))
      throw error
    }
  }

  async function retryAcknowledgements() {
    const scope = authSnapshot()
    if (!scope.userId || !scope.accessToken || !online()) return { attempted: 0, remaining: readQueue(scope.userId).length }
    let queue = readQueue(scope.userId); let attempted = 0
    for (const job of queue.slice()) {
      attempted++
      try {
        await request('shortcut-inbox', '/ack', { method: 'POST', body: { capture_id: job.captureId } }, scope)
        queue = queue.filter(item => item.captureId !== job.captureId)
      } catch (error) {
        if (!error.retryable) queue = queue.filter(item => item.captureId !== job.captureId)
        else queue = core.mergeAckJob(queue, { ...job, attempts: Number(job.attempts || 0) + 1, nextAttemptAt: new Date().toISOString() })
      }
    }
    ensureScope(scope); writeQueue(scope.userId, queue)
    return { attempted, remaining: queue.length }
  }

  async function openDraft(id) {
    const capture = claims.get(String(id)) || await claim(id)
    const payload = capture.capture || capture
    const mapped = core.mapCaptureToDraft({ ...payload, capture_id: String(id) }, {
      wallets: root.S?.wallets || [],
      suggestCategory: (value, type) => root.MTQuickCapture?.inferCategoryId?.(`${value.merchant || ''} ${value.description || ''}`, type) || '',
      suggestWallet: value => root.App?._suggestWalletForMerchant?.(value.merchant, value.direction === 'credit' ? 'income' : 'expense') || '',
    })
    root.S.txMode = 'add'
    root.S.editingTxId = null
    root.S.tx = { ...(root.S.tx || {}), ...mapped.draft, externalCapture: { provider: payload.source, captureId: String(id), dedupeVersion: payload.dedupe_version, dedupeKey: payload.dedupe_key } }
    activeCaptureId = String(id)
    root.App?.openOverlay?.('overlay-add-tx')
    root.App?._renderAddTxDetail?.()
    return mapped
  }

  function onTransactionSave(context) {
    if (context?.result !== true || !activeCaptureId) return undefined
    const capture = claims.get(activeCaptureId)
    if (!capture) return undefined
    const type = capture.capture?.direction === 'credit' ? 'income' : 'expense'
    if (['expense', 'income'].includes(type) && capture.capture) {
      const mappedWallet = root.S?.tx?.walletId
      const key = core.aliasKey({ ...capture.capture, direction: type === 'income' ? 'credit' : 'debit' })
      if (key && mappedWallet) {
        root.S.wallets = core.rememberWalletAlias(root.S.wallets || [], mappedWallet, key)
        try { root.persist?.('shortcut.capture.alias', { dirtyKeys: ['wallets'] }) } catch (_) {}
      }
    }
    const promise = acknowledge(capture).catch(error => {
      if (error.code !== 'AUTH_SCOPE_CHANGED') toast('บันทึกแล้ว แต่รอเชื่อมต่อ Inbox เพื่อยืนยัน', 'warn')
      return null
    })
    return promise
  }

  function onTransactionClose() {
    if (!activeCaptureId) return undefined
    const id = activeCaptureId
    if (!online()) { claims.delete(id); activeCaptureId = ''; return undefined }
    return release(id).catch(() => { claims.delete(id); if (activeCaptureId === id) activeCaptureId = '' })
  }

  function snapshot() {
    const scope = authSnapshot()
    return Object.freeze({ loaded, userId: scope.userId, summaries: Object.freeze([...summaries.values()].map(item => ({ ...item }))), activeCaptureId, ackQueue: Object.freeze(readQueue(scope.userId).map(job => ({ ...job }))) })
  }

  const api = Object.freeze({ refresh, claim, release, dismiss, restore, openDraft, listTokens, createToken, revokeToken, retryAcknowledgements, snapshot })
  root.MTScreenHooks?.register?.('transactionSave', 'shortcut-capture.save-before-ack', onTransactionSave, { priority: 200 })
  root.MTScreenHooks?.register?.('transactionClose', 'shortcut-capture.release-claim', onTransactionClose, { priority: 200 })
  root.addEventListener?.('mt:auth-state-changed', () => { summaries.clear(); claims.clear(); activeCaptureId = ''; loaded = false })
  root.addEventListener?.('online', () => { retryAcknowledgements().catch(() => {}) })
  root.addEventListener?.('pageshow', () => { refresh().catch(() => {}); retryAcknowledgements().catch(() => {}) })
  root.document?.addEventListener?.('visibilitychange', () => { if (root.document.visibilityState === 'visible') { refresh().catch(() => {}); retryAcknowledgements().catch(() => {}) } })
  if (root.window === root && root.document) setTimeout(() => { refresh().catch(() => {}); retryAcknowledgements().catch(() => {}) }, 0)
  return api
})

