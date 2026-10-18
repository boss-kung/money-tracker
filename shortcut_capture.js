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
  let inboxView = 'pending'
  let inboxError = ''
  let tokenResult = null

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

  function escapeHtml(value) {
    if (root.MTSafeRender?.escapeHtml) return root.MTSafeRender.escapeHtml(value)
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]))
  }

  function safeSummary(item) {
    const allowed = ['capture_id', 'status', 'accepted_at', 'updated_at', 'source', 'bank', 'amount', 'currency', 'direction', 'merchant', 'description', 'account_last4', 'card_last4', 'transaction_datetime', 'captured_at', 'capture_method']
    return Object.fromEntries(allowed.filter(key => item && Object.prototype.hasOwnProperty.call(item, key)).map(key => [key, item[key]]))
  }

  async function refresh(view = 'pending') {
    const scope = requireAuth()
    const selectedView = view === 'dismissed' ? 'dismissed' : 'pending'
    const result = await request('shortcut-inbox', `?view=${selectedView}&limit=50`, {}, scope)
    ensureScope(scope)
    summaries.clear()
    for (const item of Array.isArray(result.items) ? result.items : []) summaries.set(String(item.capture_id), safeSummary(item))
    loaded = true
    inboxError = ''
    updateInboxBadge()
    return snapshot()
  }

  async function claim(id) {
    const scope = requireAuth()
    const result = await request('shortcut-inbox', '/claim', { method: 'POST', body: { capture_id: String(id), device_id: clientDeviceId() } }, scope)
    ensureScope(scope)
    claims.set(String(id), { ...result, captureId: String(id) })
    const preview = safeSummary({ ...(summaries.get(String(id)) || {}), capture_id: String(id), ...(result.capture || {}) })
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
    return Object.freeze({ loaded, userId: scope.userId, summaries: Object.freeze([...summaries.values()].map(item => safeSummary(item))), activeCaptureId, ackQueue: Object.freeze(readQueue(scope.userId).map(job => ({ ...job }))) })
  }

  function dateLabel(value) {
    if (!value) return ''
    try { return new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) } catch (_) { return String(value) }
  }

  function amountLabel(item) {
    const amount = Number(item?.amount)
    if (!Number.isFinite(amount)) return ''
    return `${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${String(item?.currency || 'THB')}`
  }

  function renderInboxMarkup(state = snapshot(), view = inboxView, error = inboxError) {
    const items = Array.isArray(state.summaries) ? state.summaries : []
    const dismissed = view === 'dismissed'
    const rows = items.map(item => {
      const id = escapeHtml(item.capture_id)
      const title = escapeHtml(item.merchant || item.description || item.bank || item.source || 'รายการจาก Shortcut')
      const detail = escapeHtml([item.bank || item.source, item.account_last4 ? `บัญชี ••••${item.account_last4}` : '', item.card_last4 ? `บัตร ••••${item.card_last4}` : ''].filter(Boolean).join(' · '))
      const date = escapeHtml(dateLabel(item.transaction_datetime || item.captured_at || item.accepted_at))
      const amount = escapeHtml(amountLabel(item))
      const status = escapeHtml(item.status || (dismissed ? 'dismissed' : 'pending'))
      return `<article class="shortcut-inbox-item" data-shortcut-inbox-id="${id}">
        <button type="button" class="shortcut-inbox-open" data-shortcut-inbox-action="${dismissed ? 'restore' : 'open'}" data-shortcut-inbox-id="${id}" aria-label="${dismissed ? 'กู้คืนรายการ' : 'ตรวจสอบรายการ'} ${title}">
          <span class="shortcut-inbox-item-main"><strong>${title}</strong><span>${detail || 'ไม่พบข้อมูลบัญชีหรือบัตร'}${date ? ` · ${date}` : ''}</span></span>
          <span class="shortcut-inbox-item-amount">${amount || '—'}<small>${status}</small></span>
        </button>
        <button type="button" class="shortcut-inbox-dismiss" data-shortcut-inbox-action="${dismissed ? 'restore' : 'dismiss'}" data-shortcut-inbox-id="${id}">${dismissed ? 'กู้คืน' : 'ซ่อน'}</button>
      </article>`
    }).join('')
    const body = error
      ? `<div class="shortcut-inbox-state shortcut-inbox-error" role="alert">เชื่อมต่อ Inbox ไม่สำเร็จ · ${escapeHtml(error.message || error.code || 'ลองใหม่อีกครั้ง')}</div>`
      : rows || `<div class="shortcut-inbox-state">${dismissed ? 'ยังไม่มีรายการที่ซ่อน' : (state.loaded ? 'ยังไม่มีรายการรอตรวจสอบ' : 'กำลังโหลดรายการ…')}</div>`
    return `<section class="shortcut-inbox-screen" aria-label="Shortcut Inbox">
      <div class="sub-header shortcut-inbox-sub-header"><button type="button" class="btn-icon" data-shortcut-inbox-action="close" aria-label="ย้อนกลับ">←</button><h2>รายการจาก Shortcut</h2><div></div></div>
      <div class="shortcut-inbox-header"><div><h2>รายการจาก Shortcut</h2><p>${dismissed ? 'รายการที่ซ่อนไว้ กู้คืนกลับมารีวิวได้' : 'ตรวจสอบและแก้ไขก่อนกดบันทึกจริง'}</p></div>
        <div class="shortcut-inbox-header-actions"><button type="button" class="shortcut-inbox-nav" data-shortcut-inbox-action="toggle-view">${dismissed ? 'กลับ Inbox' : 'รายการที่ซ่อน'}</button><button type="button" class="shortcut-inbox-nav" data-shortcut-inbox-action="refresh">รีเฟรช</button></div>
      </div>
      <div class="shortcut-inbox-list">${body}</div>
      <p class="shortcut-inbox-footnote">ข้อมูลต้นฉบับจะเปิดดูได้ในหน้าตรวจสอบเท่านั้น และจะไม่ถูกบันทึกจนกว่าคุณจะกดบันทึก</p>
    </section>`
  }

  function rerenderInbox(error = null) {
    inboxError = error || ''
    if (!root.document?.querySelector?.('.shortcut-inbox-screen')) return
    root.App?.openSubScreen?.(renderInboxMarkup(snapshot(), inboxView, inboxError), { animate: false })
    bindInboxActions()
  }

  function bindInboxActions() {
    const doc = root.document
    const screen = doc?.querySelector?.('.shortcut-inbox-screen')
    if (!screen) return
    screen.querySelectorAll('[data-shortcut-inbox-action]').forEach(button => {
      if (button.dataset.shortcutInboxBound) return
      button.dataset.shortcutInboxBound = '1'
      button.addEventListener('click', async event => {
        event.preventDefault()
        const action = button.dataset.shortcutInboxAction
        const id = button.dataset.shortcutInboxId
        try {
          if (action === 'close') {
            root.App?.closeSubScreen?.()
          } else if (action === 'open') {
            await openDraft(id)
            injectReviewDisclosure()
          } else if (action === 'dismiss') {
            root.App?.showConfirm?.({ title: 'ซ่อนรายการนี้?', body: 'รายการจะย้ายไปอยู่ในรายการที่ซ่อน และกู้คืนได้ภายหลัง', danger: true, confirmLabel: 'ซ่อนรายการ', onConfirm: async () => { await dismiss(id); await openInbox(inboxView) } })
          } else if (action === 'restore') {
            await restore(id)
            await openInbox(inboxView)
          } else if (action === 'toggle-view') {
            await openInbox(inboxView === 'pending' ? 'dismissed' : 'pending')
          } else if (action === 'refresh') {
            await openInbox(inboxView)
          }
        } catch (error) {
          toast(error?.message || 'ดำเนินการไม่สำเร็จ', 'error')
          rerenderInbox(error)
        }
      })
    })
  }

  async function openInbox(view = 'pending') {
    inboxView = view === 'dismissed' ? 'dismissed' : 'pending'
    inboxError = ''
    root.App?.openSubScreen?.(renderInboxMarkup(snapshot(), inboxView), { animate: false })
    bindInboxActions()
    try { await refresh(inboxView); rerenderInbox() } catch (error) { rerenderInbox(error) }
  }

  function renderTokenMarkup(result = {}, issue = null) {
    const tokens = Array.isArray(result?.tokens) ? result.tokens : []
    const rows = tokens.map(item => `<div class="shortcut-token-row"><div><strong>${escapeHtml(item.label || 'iOS Shortcut')}</strong><small>${escapeHtml(item.secret_prefix || '')} · ${item.revoked_at ? 'ถูกยกเลิก' : 'ใช้งานอยู่'}</small></div>${item.revoked_at ? '' : `<button type="button" class="shortcut-token-revoke" data-shortcut-token-id="${escapeHtml(item.id)}">ยกเลิก</button>`}</div>`).join('')
    const issued = tokenResult?.token ? `<div class="shortcut-token-issued" role="status"><strong>คัดลอก Token นี้ตอนนี้</strong><p>Token จะแสดงครั้งเดียวและจะไม่สามารถดูซ้ำได้</p><code>${escapeHtml(tokenResult.token)}</code><button type="button" class="btn btn-primary shortcut-token-copy" data-shortcut-token-copy="${escapeHtml(tokenResult.token)}">คัดลอก Token</button></div>` : ''
    return `<section class="shortcut-token-screen"><div class="sub-header shortcut-token-sub-header"><button type="button" class="btn-icon" data-shortcut-token-action="close" aria-label="ย้อนกลับ">←</button><h2>เชื่อมต่อ iOS Shortcut</h2><div></div></div><div class="shortcut-inbox-header"><div><h2>เชื่อมต่อ iOS Shortcut</h2><p>สร้าง Token สำหรับส่งแจ้งเตือนเข้า Money Tracker</p></div></div>
      ${issue ? `<div class="shortcut-inbox-state shortcut-inbox-error" role="alert">${escapeHtml(issue.message || issue.code || 'โหลด Token ไม่สำเร็จ')}</div>` : ''}
      ${issued}<form class="shortcut-token-form" data-shortcut-token-form><label for="shortcut-token-label">ชื่ออุปกรณ์หรือ Shortcut</label><div><input id="shortcut-token-label" class="form-input" maxlength="64" required placeholder="เช่น iPhone ส่วนตัว"><button type="submit" class="btn btn-primary">สร้าง Token</button></div></form>
      <div class="shortcut-token-list">${rows || '<div class="shortcut-inbox-state">ยังไม่มี Token</div>'}</div>
    </section>`
  }

  function bindTokenActions() {
    const doc = root.document
    const screen = doc?.querySelector?.('.shortcut-token-screen')
    if (!screen) return
    screen.querySelector('[data-shortcut-token-action="close"]')?.addEventListener('click', () => root.App?.closeSubScreen?.())
    screen.querySelector('[data-shortcut-token-form]')?.addEventListener('submit', async event => {
      event.preventDefault()
      const label = screen.querySelector('#shortcut-token-label')?.value || ''
      try { tokenResult = await createToken(label); await openTokenSettings({ preserveIssued: true }) } catch (error) { rerenderToken(error) }
    })
    screen.querySelectorAll('.shortcut-token-revoke').forEach(button => button.addEventListener('click', () => {
      root.App?.showConfirm?.({ title: 'ยกเลิก Token นี้?', body: 'Shortcut ที่ใช้ Token นี้จะส่งข้อมูลไม่ได้อีก', danger: true, confirmLabel: 'ยกเลิก Token', onConfirm: async () => { try { await revokeToken(button.dataset.shortcutTokenId); await openTokenSettings() } catch (error) { rerenderToken(error) } } })
    }))
    screen.querySelector('.shortcut-token-copy')?.addEventListener('click', async event => {
      const button = event.currentTarget
      try { await root.navigator?.clipboard?.writeText(button.dataset.shortcutTokenCopy || ''); button.textContent = 'คัดลอกแล้ว'; button.disabled = true } catch (_) { toast('คัดลอกไม่สำเร็จ ให้แตะค้างที่ Token', 'warn') }
    })
  }

  function rerenderToken(error = null) {
    if (!root.document?.querySelector?.('.shortcut-token-screen')) return
    root.App?.openSubScreen?.(renderTokenMarkup({}, error), { animate: false })
    bindTokenActions()
  }

  async function openTokenSettings({ preserveIssued = false } = {}) {
    if (!preserveIssued) tokenResult = null
    root.App?.openSubScreen?.(renderTokenMarkup({ tokens: [] }), { animate: false })
    bindTokenActions()
    try { const result = await listTokens(); root.App?.openSubScreen?.(renderTokenMarkup(result), { animate: false }); bindTokenActions() } catch (error) { rerenderToken(error) }
  }

  function updateInboxBadge() {
    const badge = root.document?.querySelector?.('.shortcut-inbox-badge')
    if (badge) { const count = summaries.size; badge.textContent = count > 99 ? '99+' : String(count); badge.hidden = count < 1 }
  }

  function injectTransactionsInbox() {
    const doc = root.document
    const content = doc?.querySelector?.('#page-transactions')
    if (!content) return
    let button = doc.getElementById?.('shortcut-inbox-button')
    if (!button) {
      button = doc.createElement('button')
      button.id = 'shortcut-inbox-button'
      button.type = 'button'
      button.className = 'shortcut-inbox-button'
      button.innerHTML = '<span>📥 รายการจาก Shortcut</span><span class="shortcut-inbox-badge" hidden>0</span>'
      button.addEventListener('click', () => openInbox())
      const header = content.querySelector('.page-header')
      ;(header || content).appendChild(button)
    }
    updateInboxBadge()
  }

  function injectTokenSettings() {
    const doc = root.document
    const content = doc?.querySelector?.('#more-content')
    if (!content || doc.getElementById?.('shortcut-token-settings')) return
    const wrapper = doc.createElement('div')
    wrapper.id = 'shortcut-token-settings'
    wrapper.className = 'shortcut-token-settings'
    wrapper.innerHTML = '<div class="sec-title">เชื่อมต่อ</div><div class="card card-pad"><button type="button" class="settings-row shortcut-token-settings-row"><span class="s-icon">📱</span><span class="s-label">เชื่อมต่อ iOS Shortcut<div class="shortcut-token-settings-help">จัดการ Token สำหรับแจ้งเตือนจาก LINE</div></span><span class="s-arrow">›</span></button></div>'
    const settingsPane = content.querySelector('.more-tab-pane[data-pane="settings"]') || content
    settingsPane.appendChild(wrapper)
    wrapper.querySelector('button')?.addEventListener('click', openTokenSettings)
  }

  function injectReviewDisclosure() {
    const raw = claims.get(activeCaptureId)?.capture?.raw_text || claims.get(activeCaptureId)?.capture?.relevant_text
    const doc = root.document
    if (!raw || !doc) return
    const host = doc.querySelector?.('#overlay-add-tx .add-detail-actions, #overlay-add-tx .sub-scroll, #overlay-add-tx')
    if (!host || host.querySelector('.shortcut-inbox-raw')) return
    const details = doc.createElement('details')
    details.className = 'shortcut-inbox-raw'
    details.innerHTML = `<summary>ดูข้อความต้นฉบับ</summary><pre>${escapeHtml(raw)}</pre>`
    host.appendChild(details)
  }

  const api = Object.freeze({ refresh, claim, release, dismiss, restore, openDraft, openInbox, openTokenSettings, listTokens, createToken, revokeToken, retryAcknowledgements, snapshot })
  root.MTScreenHooks?.register?.('transactionSave', 'shortcut-capture.save-before-ack', onTransactionSave, { priority: 200 })
  root.MTScreenHooks?.register?.('transactionClose', 'shortcut-capture.release-claim', onTransactionClose, { priority: 200 })
  root.MTScreenHooks?.register?.('transactions', 'shortcut-capture.inbox-button', injectTransactionsInbox, { priority: 200 })
  root.MTScreenHooks?.register?.('more', 'shortcut-capture.token-settings', injectTokenSettings, { priority: 200 })
  root.MTScreenHooks?.register?.('addTransactionDetail', 'shortcut-capture.review-disclosure', injectReviewDisclosure, { priority: 200 })
  root.addEventListener?.('mt:auth-state-changed', () => { summaries.clear(); claims.clear(); activeCaptureId = ''; loaded = false })
  root.addEventListener?.('online', () => { retryAcknowledgements().catch(() => {}) })
  root.addEventListener?.('pageshow', () => { refresh().catch(() => {}); retryAcknowledgements().catch(() => {}) })
  root.document?.addEventListener?.('visibilitychange', () => { if (root.document.visibilityState === 'visible') { refresh().catch(() => {}); retryAcknowledgements().catch(() => {}) } })
  if (root.window === root && root.document) setTimeout(() => { refresh().catch(() => {}); retryAcknowledgements().catch(() => {}) }, 0)
  return api
})

