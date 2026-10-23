const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const appSource = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')
const hooksSource = fs.readFileSync(path.join(root, 'screen_hooks.js'), 'utf8')
const captureSource = fs.readFileSync(path.join(root, 'shortcut_capture.js'), 'utf8')
const core = require('../shortcut_capture_core.js')

function addTransactionDetailAssignment() {
  const start = appSource.indexOf('  App._renderAddTxDetail = function() {')
  const end = appSource.indexOf('\n  }\n\n})();', start)
  assert.ok(start >= 0 && end > start, 'Add Transaction detail renderer should be extractable')
  return appSource.slice(start, end + '\n  }'.length)
}

function jsonResponse(status, value) {
  return { ok: status >= 200 && status < 300, status, json: async () => value }
}

test('closing a reviewed Shortcut draft releases it but keeps it in the Inbox', async () => {
  const captureId = '22222222-2222-4222-8222-222222222222'
  const calls = []
  const box = { innerHTML: '', querySelector: () => null }
  const state = {
    wallets: [{ id: 'wallet-1', name: 'SCB', icon: '🏦', type: 'bank' }],
    merchants: [],
    transactions: [],
    txMode: 'add',
    editingTxId: null,
    tx: {},
  }
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    navigator: { onLine: true },
    location: { href: 'https://app.example/' },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    localStorage: { getItem: () => null, setItem: () => {} },
    MT_SUPABASE_URL: 'https://supabase.example',
    MT_SUPABASE_ANON_KEY: 'anon',
    MTAuthSync: { state: { user: { id: 'user-1' }, session: { access_token: 'access-1' } } },
    MTShortcutCaptureCore: core,
    MTSafeRender: { jsArg: value => JSON.stringify(value) },
    S: state,
    Calc: { fmtNum: value => String(value), fmt: value => String(value) },
    BNPL_FEATURE_ENABLED: false,
    getFrequentCategories: () => [],
    getTransferableWallets: () => [],
    normalizeTransferDraft: () => {},
    typeColor: () => '#ef4444',
    esc: value => String(value ?? ''),
    fmt: value => String(value ?? ''),
    getTODAY: () => '2026-10-23',
    requestAnimationFrame: callback => callback(),
    document: {
      readyState: 'complete',
      visibilityState: 'visible',
      addEventListener: () => {},
      getElementById: id => id === 'add-tx-content' ? box : null,
      querySelector: () => null,
    },
    addEventListener: () => {},
    fetch: async (url, options = {}) => {
      calls.push({ url, options })
      if (url.endsWith('/claim')) return jsonResponse(200, {
        capture_id: captureId,
        claim_secret: 'claim-secret',
        capture: {
          capture_id: captureId,
          source: 'scb_connect',
          amount: 59,
          direction: 'debit',
          merchant: 'SHOPEE*SHOPEEFOOD',
          captured_at: '2026-10-23T10:00:00Z',
          dedupe_version: 1,
          dedupe_key: 'a'.repeat(64),
        },
      })
      if (url.endsWith('/release')) return jsonResponse(200, { ok: true })
      return jsonResponse(200, { count: 1, items: [{ capture_id: captureId, amount: 59, merchant: 'SHOPEE*SHOPEEFOOD' }] })
    },
  })
  context.App = {
    _getState: () => state,
    openOverlay: () => {},
    closeOverlay: () => { context.closed = (context.closed || 0) + 1 },
    closeAddTx() { this.closeOverlay('overlay-add-tx') },
    getBenefitChannelOptions: () => [['', 'ไม่ระบุ']],
  }

  vm.runInContext(hooksSource, context)
  vm.runInContext(captureSource, context)
  vm.runInContext(addTransactionDetailAssignment(), context)
  context.MTScreenHooks.install(context.App, {
    transactionClose: 'closeAddTx',
    addTransactionDetail: '_renderAddTxDetail',
  })

  await context.MTShortcutCapture.refresh()
  await context.MTShortcutCapture.openDraft(captureId)
  const closeAction = box.innerHTML.match(/class="btn-icon" onclick="([^"]+)"/)?.[1]
  assert.ok(closeAction, 'rendered review drawer should have a close action')

  vm.runInContext(closeAction, context)
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.equal(context.closed, 1)
  assert.equal(calls.filter(call => call.url.endsWith('/release')).length, 1)
  assert.deepEqual(
    Array.from(context.MTShortcutCapture.snapshot().summaries, item => item.capture_id),
    [captureId],
  )
})
