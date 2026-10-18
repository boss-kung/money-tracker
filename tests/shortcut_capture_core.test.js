const test = require('node:test')
const assert = require('node:assert/strict')
const core = require('../shortcut_capture_core.js')

function capture(overrides = {}) {
  return {
    capture_id: 'cap-1',
    source: 'scb_connect', bank: 'SCB', amount: '80.00', currency: 'THB', direction: 'debit',
    merchant: 'MBR9', description: 'MBR9 purchase', account_last4: '4078', card_last4: null,
    transaction_datetime: '2026-10-05T21:39:00+07:00', captured_at: '2026-10-05T21:40:03+07:00',
    capture_method: 'whats_on_screen', dedupe_version: 1, dedupe_key: 'a'.repeat(64), ...overrides,
  }
}

test('maps debit and credit captures into review drafts without inferring transfers', () => {
  const wallets = [{ id: 'w1', name: 'SCB', type: 'bank', shortcutCaptureAliases: [{ source: 'scb_connect', kind: 'account', last4: '4078' }] }]
  const expense = core.mapCaptureToDraft(capture(), {
    wallets, suggestWallet: () => 'wrong-wallet', suggestCategory: () => 'food',
  })
  assert.deepEqual(expense.draft, {
    type: 'expense', amount: '80.00', walletId: 'w1', toWalletId: '', categoryId: 'food', merchant: 'MBR9',
    note: 'MBR9 purchase', date: '2026-10-05', external: { captureId: 'cap-1', source: 'shortcut', dedupeVersion: 1, dedupeKey: 'a'.repeat(64) },
  })
  assert.equal(expense.usedCapturedAtFallback, false)
  assert.equal(core.mapCaptureToDraft(capture({ direction: 'credit', transaction_datetime: null }), { wallets: [], suggestCategory: () => 'salary' }).draft.type, 'income')
  assert.equal(core.mapCaptureToDraft(capture({ direction: 'credit', transaction_datetime: null }), { wallets: [], suggestCategory: () => 'salary' }).draft.date, '2026-10-05')
})

test('uses captured time as an explicit fallback and keeps amounts positive', () => {
  const result = core.mapCaptureToDraft(capture({ transaction_datetime: null, amount: '0.50' }), { wallets: [], suggestCategory: () => '' })
  assert.equal(result.draft.amount, '0.50')
  assert.equal(result.usedCapturedAtFallback, true)
  assert.equal(result.draft.date, '2026-10-05')
})

test('alias priority is exact and merchant suggestion is only a fallback', () => {
  const key = core.aliasKey(capture())
  assert.deepEqual(key, { source: 'scb_connect', kind: 'account', last4: '4078' })
  const wallets = [{ id: 'w1', name: 'SCB', shortcutCaptureAliases: [key] }, { id: 'w2', name: 'MBR9' }]
  assert.equal(core.findWalletByAlias(wallets, key).id, 'w1')
  assert.equal(core.mapCaptureToDraft(capture(), { wallets, suggestWallet: () => 'w2' }).draft.walletId, 'w1')
  const remembered = core.rememberWalletAlias(wallets, 'w2', key)
  assert.equal(remembered.find(w => w.id === 'w2').shortcutCaptureAliases.length, 1)
  assert.equal(core.rememberWalletAlias(remembered, 'w2', key).find(w => w.id === 'w2').shortcutCaptureAliases.length, 1)
  assert.equal(wallets[1].shortcutCaptureAliases, undefined)
})

test('deterministic ids, existing-capture detection, and coalesced ack jobs contain no sensitive text', () => {
  assert.equal(core.transactionId('cap-1'), 'shortcut:cap-1')
  assert.equal(core.findExistingCaptureTransaction([{ id: 'tx-1', external: { captureId: 'cap-1' } }], 'cap-1').id, 'tx-1')
  const job = core.makeAckJob('cap-1', 'shortcut:cap-1', 1, 'a'.repeat(64), '2026-10-18T00:00:00Z')
  const merged = core.mergeAckJob([job], { ...job, attempts: 2, raw_text: 'secret', token: 'secret' })
  assert.equal(merged.length, 1)
  assert.equal(merged[0].attempts, 2)
  assert.equal('raw_text' in merged[0], false)
  assert.equal('token' in merged[0], false)
})

