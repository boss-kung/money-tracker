/* Pure client-side mapping for reviewed iOS Shortcut captures. */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.MTShortcutCaptureCore = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function transactionId(captureId) { return `shortcut:${String(captureId || '')}` }

  function aliasKey(capture) {
    const source = String(capture?.source || '')
    if (capture?.account_last4) return { source, kind: 'account', last4: String(capture.account_last4) }
    if (capture?.card_last4) return { source, kind: 'card', last4: String(capture.card_last4) }
    return null
  }

  function sameAlias(left, right) {
    return Boolean(left && right && left.source === right.source && left.kind === right.kind && left.last4 === right.last4)
  }

  function findWalletByAlias(wallets, key) {
    if (!key) return null
    return (wallets || []).find(wallet => (wallet.shortcutCaptureAliases || []).some(alias => sameAlias(alias, key))) || null
  }

  function datePart(value) {
    const text = String(value || '')
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(text)
    return match ? match[1] : ''
  }

  function bangkokDatePart(value) {
    if (!value) return ''
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date(String(value)))
      const get = type => parts.find(part => part.type === type)?.value || ''
      const result = `${get('year')}-${get('month')}-${get('day')}`
      return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : ''
    } catch (_) { return '' }
  }

  function mapCaptureToDraft(capture, context = {}) {
    const direction = capture?.direction === 'credit' ? 'income' : 'expense'
    const transactionDate = datePart(capture?.transaction_date)
    const transactionDateTime = bangkokDatePart(capture?.transaction_datetime)
    const capturedAtDate = bangkokDatePart(capture?.captured_at)
    const dateSource = transactionDate ? 'transaction_date' : transactionDateTime ? 'transaction_datetime' : 'captured_at'
    const usedCapturedAtFallback = dateSource === 'captured_at'
    const alias = aliasKey(capture)
    const exact = findWalletByAlias(context.wallets, alias)
    const suggestedWallet = exact || (typeof context.suggestWallet === 'function' ? context.suggestWallet(capture) : null)
    const suggestedCategory = typeof context.suggestCategory === 'function' ? context.suggestCategory(capture, direction) : ''
    const amount = Number(capture?.amount)
    const draft = {
      type: direction,
      amount: Number.isFinite(amount) && amount > 0 ? Number(amount).toFixed(2) : '0.00',
      walletId: exact?.id || (typeof suggestedWallet === 'object' ? suggestedWallet?.id : suggestedWallet) || context.defaultWalletId || '',
      toWalletId: '',
      categoryId: suggestedCategory || context.defaultCategoryId || '',
      merchant: String(capture?.merchant || ''),
      note: String(capture?.description || ''),
      date: transactionDate || transactionDateTime || capturedAtDate,
      external: {
        captureId: String(capture?.capture_id || capture?.id || ''),
        source: 'shortcut',
        dedupeVersion: Number(capture?.dedupe_version || 1),
        dedupeKey: String(capture?.dedupe_key || ''),
      },
    }
    return { draft, aliasKey: alias, dateSource, usedCapturedAtFallback }
  }

  function findExistingCaptureTransaction(transactions, captureId) {
    const id = String(captureId || '')
    const deterministic = transactionId(id)
    return (transactions || []).find(tx =>
      tx?.id === deterministic || tx?.external?.captureId === id || tx?.external?.capture_id === id ||
      tx?.shortcutCaptureId === id || tx?.externalCaptureId === id,
    ) || null
  }

  function rememberWalletAlias(wallets, walletId, key) {
    if (!key) return (wallets || []).map(wallet => ({ ...wallet }))
    return (wallets || []).map(wallet => {
      if (wallet.id !== walletId) return { ...wallet }
      const aliases = Array.isArray(wallet.shortcutCaptureAliases) ? wallet.shortcutCaptureAliases : []
      return { ...wallet, shortcutCaptureAliases: aliases.some(alias => sameAlias(alias, key)) ? aliases.map(alias => ({ ...alias })) : [...aliases.map(alias => ({ ...alias })), { source: key.source, kind: key.kind, last4: key.last4 }] }
    })
  }

  function makeAckJob(captureId, transactionIdValue, dedupeVersion, dedupeKey, now = new Date().toISOString()) {
    return { captureId: String(captureId), transactionId: String(transactionIdValue), dedupeVersion: Number(dedupeVersion || 1), dedupeKey: String(dedupeKey || ''), nextAttemptAt: String(now), attempts: 0 }
  }

  function mergeAckJob(queue, job) {
    const clean = makeAckJob(job.captureId, job.transactionId, job.dedupeVersion, job.dedupeKey, job.nextAttemptAt)
    clean.attempts = Number.isFinite(Number(job.attempts)) ? Number(job.attempts) : 0
    const found = (queue || []).findIndex(item => item.captureId === clean.captureId)
    if (found < 0) return [...(queue || []).map(item => ({ ...item })), clean]
    const merged = [...(queue || []).map(item => ({ ...item }))]
    merged[found] = { ...merged[found], ...clean, attempts: Math.max(Number(merged[found].attempts || 0), clean.attempts) }
    return merged
  }

  return { transactionId, aliasKey, findWalletByAlias, mapCaptureToDraft, findExistingCaptureTransaction, rememberWalletAlias, makeAckJob, mergeAckJob }
})

