const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'auth_sync.js'), 'utf8')
const savedSession = { accessToken: 'old-access', refreshToken: 'saved-refresh', expiresAt: 1, userId: 'owner', email: 'owner@example.test' }
const googleUser = { id: 'owner', email: 'owner@example.test', app_metadata: { provider: 'google' }, identities: [{ provider: 'google' }] }
const refreshedSession = { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'bearer' }
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const pending = () => new Promise(() => {})

// Only time, network, and browser boundaries are replaced; auth/restore/render run unchanged.
function harness(fetch, { saved = savedSession, hash = '', payload = { wallets: [], transactions: [] }, cryptoVault, demo = false, recoveryKey = '', storageMap, failPendingStorage = false, failConfirmedStorage = false } = {}) {
  let now = 1_000_000
  let nextId = 0
  const timers = new Map()
  const listeners = new Map()
  const storage = storageMap || new Map([['mt_auth_sync_state', JSON.stringify(saved)]])
  if (recoveryKey) storage.set('mt_auth_sync_recovery_key', JSON.stringify({ userId: 'owner', key: recoveryKey }))
  let resets = 0
  let reloads = 0
  let applied = 0
  const classes = new Set()
  const elements = new Map(['mt-boot-subtitle', 'mt-boot-bar', 'mt-boot-actions'].map(id => [id, { style: {}, innerHTML: '', textContent: '', querySelector: () => null }]))
  const document = {
    title: 'Money Tracker', visibilityState: 'visible',
    documentElement: { classList: { add: c => classes.add(c), remove: c => classes.delete(c) } },
    getElementById: id => elements.get(id) || null,
    createElement: () => {
      const element = { style: {}, innerHTML: '', querySelector: () => null, remove: () => elements.delete(element.id) }
      return element
    },
    body: { appendChild: element => elements.set(element.id, element) },
    addEventListener: (name, fn) => { const handlers = listeners.get(name) || []; handlers.push(fn); listeners.set(name, handlers) },
  }
  const localStorage = {
    getItem: k => storage.get(k) || null,
    setItem: (k, v) => {
      if (failPendingStorage && k === 'mt_auth_sync_pending_vaults') throw new Error('storage unavailable')
      if (failConfirmedStorage && k === 'mt_auth_sync_recovery_key') throw new Error('storage unavailable')
      storage.set(k, v)
    },
    removeItem: k => storage.delete(k),
  }
  class FakeDate extends Date { static now() { return now } }
  const context = vm.createContext({
    document, localStorage, sessionStorage: localStorage, Date: FakeDate, TextEncoder, AbortController, URL, URLSearchParams,
    setTimeout: (fn, ms = 0) => { const id = ++nextId; timers.set(id, { at: now + ms, fn }); return id },
    clearTimeout: id => timers.delete(id), fetch,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    location: { href: `https://money.example/index.html${hash}`, search: '', hash, reload() { reloads++ } },
    history: { replaceState() {} },
    MT_SUPABASE_URL: 'https://auth.example', MT_SUPABASE_ANON_KEY: 'anon',
    App: { _cloudBuildPayload: () => payload, _cloudApplyPayload(next) { applied++; Object.assign(payload, next) }, _looksLikeDemoData: () => demo },
    MTStorage: { buildExportPayload() {}, normalizeBackupPayload() {}, reset() { resets++ } },
    MTCryptoVault: cryptoVault, crypto: require('node:crypto').webcrypto,
    MTBootScreen: { hold() {}, release() {} },
    addEventListener() {},
  })
  context.window = context
  vm.runInContext(source, context)
  async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve() }
  async function advance(ms) {
    await flush()
    const end = now + ms
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      now = next[1].at
      timers.delete(next[0])
      next[1].fn()
      await flush()
    }
    now = end
    await flush()
  }
  return {
    api: context.MTAuthSync, elements, classes, advance, flush, storage,
    saved: () => JSON.parse(storage.get('mt_auth_sync_state')),
    recovery: () => JSON.parse(storage.get('mt_auth_sync_recovery_key') || 'null'),
    pendingCreation: () => JSON.parse(storage.get('mt_auth_sync_pending_vaults') || '{}').owner || null,
    effects: () => ({ resets, reloads, applied }),
    click: action => { for (const handler of listeners.get('click') || []) handler({ target: { closest: () => ({ dataset: { mtAuthAction: action } }) } }) },
  }
}

function cryptoBoundary() {
  let derivedRecoveryKey
  return {
    derivedKey: () => derivedRecoveryKey,
    vault: {
      DEFAULT_KDF_PARAMS: { iterations: 210000, hash: 'SHA-256', name: 'PBKDF2' },
      randomBytes: () => new Uint8Array(16), bytesToBase64: () => 'test-salt',
      deriveKey: async key => { derivedRecoveryKey = key; return { type: 'secret' } },
      generateDataKey: async () => ({ type: 'secret' }),
      wrapDataKey: async () => ({ wrappedKey: 'wrapped', iv: 'wrapped-iv' }),
      unwrapDataKey: async () => ({ type: 'secret' }),
      decryptVault: async () => ({ wallets: [{ id: 'cloud-wallet' }], transactions: [] }),
      encryptVault: async () => ({ ciphertext: 'ciphertext', iv: 'vault-iv', checksum: 'checksum', schemaVersion: 1 }),
    },
  }
}

for (const honorsAbort of [true, false]) {
  // Removing the deadline or relying solely on fetch's abort must leave this restore stuck.
  test(`hanging refresh releases restoring and retains credentials when fetch ${honorsAbort ? 'honors' : 'ignores'} abort`, async () => {
    const h = harness((_url, options) => new Promise((resolve, reject) => {
      if (honorsAbort) options.signal?.addEventListener('abort', () => reject(new Error('aborted token request')))
    }))
    h.api.initAuthSync()
    await h.advance(12_000)
    assert.equal(h.api.state.restoring, false)
    assert.equal(h.api.state.session, null)
    assert.equal(h.saved().refreshToken, 'saved-refresh')
    assert.match(h.elements.get('mt-boot-actions').innerHTML, /retry-restore/)
    assert.equal(h.classes.has('mt-auth-gated'), true)
  })
}

// Moving JSON consumption outside the deadline must strand restoring.
test('refresh JSON body has the same deadline as fetch', async () => {
  const h = harness(async () => ({ ok: true, status: 200, json: pending }))
  h.api.initAuthSync()
  await h.advance(12_000)
  assert.equal(h.api.state.restoring, false)
  assert.equal(h.saved().refreshToken, 'saved-refresh')
  assert.match(h.elements.get('mt-boot-actions').innerHTML, /retry-restore/)
})

// Broad token-message matching must never erase credentials on a gateway/network error.
for (const failure of ['network', 'gateway', 'rejected']) {
  test(`refresh ${failure} failure ${failure === 'rejected' ? 'clears rejected' : 'retains saved'} credentials`, async () => {
    const h = harness(async () => {
      if (failure === 'network') throw new Error('Network failure requesting /token?grant_type=refresh_token')
      if (failure === 'gateway') return response({ message: 'token service unavailable', error: 'token service unavailable' }, 503)
      return response({ error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }, 400)
    })
    h.api.initAuthSync()
    await h.advance(12_000)
    assert.equal(h.api.state.restoring, false)
    assert.equal(h.saved().refreshToken, failure === 'rejected' ? '' : 'saved-refresh')
    assert.equal(Boolean(h.api.state.restoreError), failure !== 'rejected')
  })
}

// Returning setSession without awaiting it must miss this error in restore's catch.
test('hanging user lookup leaves account gated and exposes retry', async () => {
  const h = harness(async url => url.includes('/token?') ? response(refreshedSession) : pending())
  h.api.initAuthSync()
  await h.advance(8_000)
  assert.equal(h.api.state.restoring, false)
  assert.equal(h.api.state.session, null)
  assert.equal(h.saved().refreshToken, 'new-refresh')
  assert.match(h.elements.get('mt-boot-actions').innerHTML, /retry-restore/)
})

// A stalled vault must not keep boot pending or confirm an empty vault for creation.
test('hanging vault body exposes retry without confirming an empty vault', async () => {
  const h = harness(async url => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    return { ok: true, status: 200, json: pending }
  })
  h.api.initAuthSync()
  await h.advance(8_000)
  assert.equal(h.api.state.restoring, false)
  assert.equal(h.api.state.vaultConfirmedEmpty, false)
  assert.equal(h.saved().refreshToken, 'new-refresh')
  assert.match(h.elements.get('mt-boot-actions').innerHTML, /retry-restore/)
  h.click('retry-restore')
  await h.flush()
  assert.equal(h.api.state.restoring, true)
  assert.equal(h.classes.has('mt-auth-gated'), true)
  await h.advance(8_000)
  assert.equal(h.api.state.restoring, false)
  assert.equal(h.api.state.session, null)
})

// Resolving an abandoned request after retry must never replace the new session.
test('late refresh completion cannot overwrite a successful user retry', async () => {
  let finishAbandoned
  let recovered = false
  const h = harness(async url => {
    if (url.includes('/token?')) {
      if (!recovered) return new Promise(resolve => { finishAbandoned = resolve })
      return response(refreshedSession)
    }
    if (url.endsWith('/user')) return response(googleUser)
    return response([])
  })
  h.api.initAuthSync()
  await h.advance(12_000)
  assert.equal(h.api.state.restoring, false)
  recovered = true
  h.click('retry-restore')
  await h.flush()
  assert.equal(h.api.state.session.access_token, 'new-access')
  finishAbandoned(response({ ...refreshedSession, access_token: 'late-access' }))
  await h.flush()
  assert.equal(h.api.state.session.access_token, 'new-access')
  assert.equal(h.saved().accessToken, 'new-access')
  assert.equal(h.api.state.restoreError, null)
})

// Concurrent init/retry must not rotate the same refresh token twice.
test('concurrent initialization and retry use one restore attempt', async () => {
  let calls = 0
  const h = harness(() => { calls++; return pending() })
  h.api.initAuthSync()
  h.api.initAuthSync()
  h.click('retry-restore')
  await h.flush()
  assert.equal(calls, 1)
  await h.advance(12_000)
  assert.equal(h.api.state.restoring, false)
})

// Fast local restore must remain available when the background request stalls.
test('valid cached session stays usable during a timed out background refresh', async () => {
  const h = harness(pending, { saved: { ...savedSession, expiresAt: 5000 } })
  await h.api.initAuthSync()
  assert.equal(h.api.state.restoring, false)
  assert.equal(h.api.state.session.access_token, 'old-access')
  assert.equal(h.classes.has('mt-auth-gated'), false)
  await h.advance(12_000)
  assert.equal(h.api.state.session.access_token, 'old-access')
  assert.equal(h.saved().refreshToken, 'saved-refresh')
})

// An older successful background request must not restore an account after sign-out.
test('sign-out invalidates a background refresh that completes later', async () => {
  let finishRefresh
  const h = harness(async url => {
    if (url.includes('/token?')) return new Promise(resolve => { finishRefresh = resolve })
    if (url.endsWith('/user')) return response(googleUser)
    return response([])
  }, { saved: { ...savedSession, expiresAt: 5000 } })
  await h.api.initAuthSync()
  await h.api.signOut({ clearLocalData: false })
  finishRefresh(response(refreshedSession))
  await h.flush()
  assert.equal(h.api.state.session, null)
  assert.equal(h.saved().refreshToken, '')
  assert.equal(h.classes.has('mt-auth-gated'), true)
})

// OAuth callback user fetch must enter the same failure path as refresh restore.
test('OAuth callback user timeout keeps credentials available for retry', async () => {
  const h = harness(pending, { saved: {}, hash: '#access_token=callback-access&refresh_token=callback-refresh&expires_in=3600' })
  h.api.initAuthSync()
  await h.advance(8_000)
  assert.equal(h.api.state.restoring, false)
  assert.equal(h.api.state.session, null)
  assert.equal(h.saved().refreshToken, 'callback-refresh')
  assert.match(h.elements.get('mt-boot-actions').innerHTML, /retry-restore/)
})

// Awaiting the first backup POST must never strand boot after authentication succeeds.
test('stalled first vault creation releases boot and reserves one pending write', async () => {
  let writes = 0
  const boundary = cryptoBoundary()
  const h = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') { writes++; return pending() }
    return response([])
  }, { payload: { wallets: [{ id: 'real-wallet' }], transactions: [] }, cryptoVault: boundary.vault })
  h.api.initAuthSync()
  await h.flush()
  assert.equal(h.api.state.restoring, false)
  assert.equal(h.classes.has('mt-auth-gated'), false)
  await h.advance(0)
  assert.equal(h.api.state.creatingVault, true)
  h.api.markDirty()
  h.api.markDirty()
  await h.api.ensureFirstRunBackup()
  h.api.syncNow({ direction: 'push' })
  await h.advance(60_000)
  assert.equal(writes, 1)
  assert.equal(h.api.state.restoring, false)
  assert.equal(h.api.state.locked, true)
  assert.equal(h.recovery(), null)
  assert.equal(h.elements.has('mt-recovery-key-sheet'), false)
})

// Deferring the upload must still save and show the recovery key of the confirmed row.
test('deferred first vault completion saves its original recovery key and prompts the user', async () => {
  let finishWrite
  let row
  const boundary = cryptoBoundary()
  const h = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') {
      row = JSON.parse(options.body)
      return new Promise(resolve => { finishWrite = resolve })
    }
    return response([])
  }, { payload: { wallets: [{ id: 'real-wallet' }], transactions: [] }, cryptoVault: boundary.vault })
  h.api.initAuthSync()
  await h.flush()
  assert.equal(h.api.state.restoring, false)
  await h.advance(0)
  assert.equal(h.recovery(), null)
  finishWrite(response([row]))
  await h.flush()
  assert.equal(h.api.state.creatingVault, false)
  assert.equal(h.api.state.locked, false)
  assert.equal(h.api.state.vaultMeta.ciphertext, 'ciphertext')
  assert.equal(h.recovery().key, boundary.derivedKey())
  assert.equal(h.recovery().userId, 'owner')
  assert.ok(h.elements.get('mt-recovery-key-sheet').innerHTML.includes(boundary.derivedKey()))
})

// Existing first-run demo clearing must finish before the authenticated UI is released.
test('confirmed empty cloud resets demo data without creating a vault', async () => {
  let writes = 0
  const h = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') writes++
    return response([])
  }, { payload: { wallets: [{ id: 'demo-wallet' }], transactions: [] }, demo: true })
  await h.api.initAuthSync()
  await h.advance(0)
  assert.equal(h.effects().resets, 1)
  assert.equal(h.effects().reloads, 1)
  assert.equal(writes, 0)
  assert.equal(h.api.state.creatingVault, false)
})

// User edits become possible during a deferred upload and must not be acknowledged by its older snapshot.
test('edits during first vault creation remain dirty after that write confirms', async () => {
  let finishWrite
  let row
  const payload = { wallets: [{ id: 'real-wallet' }], transactions: [] }
  const boundary = cryptoBoundary()
  const h = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') {
      row = JSON.parse(options.body)
      return new Promise(resolve => { finishWrite = resolve })
    }
    return response([])
  }, { payload, cryptoVault: boundary.vault })
  h.api.initAuthSync()
  await h.flush()
  await h.advance(0)
  payload.transactions.push({ id: 'new-edit' })
  h.api.markDirty()
  finishWrite(response([row]))
  await h.flush()
  assert.equal(h.api.state.dirty, true)
  assert.equal(h.saved().localRevision, 1)
  assert.equal(h.saved().syncedRevision, 0)
})

// Existing-vault decryption may finish after sign-out; stale data must not be applied or rendered.
test('sign-out during existing vault unlock prevents stale apply and recovery prompts', async () => {
  let finishDecrypt
  const boundary = cryptoBoundary()
  boundary.vault.unwrapDataKey = async () => ({ type: 'secret' })
  boundary.vault.decryptVault = () => new Promise(resolve => { finishDecrypt = resolve })
  const row = { user_id: 'owner', ciphertext: 'ciphertext', iv: 'vault-iv', checksum: 'checksum', wrapped_key: 'wrapped', wrapped_key_iv: 'wrapped-iv', salt: 'salt', kdf_params: boundary.vault.DEFAULT_KDF_PARAMS, data_version: 1 }
  const h = harness(async url => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    return response([row])
  }, { cryptoVault: boundary.vault, recoveryKey: 'SAVED-RECOVERY-KEY' })
  h.api.initAuthSync()
  await h.flush()
  await h.api.signOut({ clearLocalData: false })
  finishDecrypt({ wallets: [{ id: 'cloud-wallet' }], transactions: [] })
  await h.flush()
  assert.equal(h.effects().applied, 0)
  assert.equal(h.api.state.session, null)
  assert.equal(h.api.state.dataKey, null)
  assert.equal(h.api.state.vaultMeta, null)
  assert.equal(h.elements.has('mt-recovery-key-sheet'), false)
})

// The first encryption key must survive logout/reload even when its POST commits later.
test('logout while first POST is pending retains its key for matching remote reconciliation on reload', async () => {
  let finishWrite
  let committedRow
  const boundary = cryptoBoundary()
  const h = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') {
      committedRow = JSON.parse(options.body)
      return new Promise(resolve => { finishWrite = resolve })
    }
    return response([])
  }, { payload: { wallets: [{ id: 'real-wallet' }], transactions: [] }, cryptoVault: boundary.vault })
  h.api.initAuthSync()
  await h.flush()
  await h.advance(0)
  const originalKey = boundary.derivedKey()
  assert.equal(h.pendingCreation()?.key, originalKey)
  await h.api.signOut({ clearLocalData: false })
  h.storage.set('mt_auth_sync_recovery_key', JSON.stringify({ userId: 'other-owner', key: 'OTHER-RECOVERY-KEY' }))
  finishWrite(response([committedRow]))
  await h.flush()
  assert.equal(h.pendingCreation()?.key, originalKey)
  assert.equal(h.recovery().key, 'OTHER-RECOVERY-KEY')
  assert.equal(h.recovery().userId, 'other-owner')
  assert.equal(h.api.state.session, null)
  h.storage.set('mt_auth_sync_state', JSON.stringify(savedSession))
  let reloadWrites = 0
  const reloaded = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') reloadWrites++
    return response([committedRow])
  }, { storageMap: h.storage, cryptoVault: cryptoBoundary().vault })
  await reloaded.api.initAuthSync()
  assert.equal(reloaded.recovery().key, originalKey)
  assert.equal(reloaded.pendingCreation(), null)
  assert.equal(reloaded.api.state.locked, false)
  assert.ok(reloaded.elements.get('mt-recovery-key-sheet').innerHTML.includes(originalKey))
  assert.equal(reloadWrites, 0)
})

// A lost POST response must never mint a new encryption key or overwrite a conflicting vault.
test('unknown first POST response preserves pending row and reconciles without another write', async () => {
  let committedRow
  const boundary = cryptoBoundary()
  const h = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') {
      committedRow = JSON.parse(options.body)
      throw new Error('response lost after commit')
    }
    return response([])
  }, { payload: { wallets: [{ id: 'real-wallet' }], transactions: [] }, cryptoVault: boundary.vault })
  h.api.initAuthSync()
  await h.flush()
  await h.advance(0)
  const originalKey = boundary.derivedKey()
  assert.equal(h.pendingCreation()?.key, originalKey)
  assert.equal(h.recovery(), null)
  let writes = 0
  const reloaded = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') writes++
    return response([{ ...committedRow, wrapped_key: 'another-devices-key' }])
  }, { storageMap: h.storage, cryptoVault: cryptoBoundary().vault })
  await reloaded.api.initAuthSync()
  await reloaded.flush()
  assert.equal(writes, 0)
  assert.equal(reloaded.recovery(), null)
  assert.equal(reloaded.pendingCreation()?.key, originalKey)
  assert.equal(reloaded.api.state.locked, true)
})

// A confirmed empty cloud after reload may retry only the already reserved key/row.
test('pending first creation retries the same encrypted row after reload and keeps newer edits dirty', async () => {
  let firstRow
  const boundary = cryptoBoundary()
  const h = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') { firstRow = JSON.parse(options.body); throw new Error('request failed before confirmation') }
    return response([])
  }, { payload: { wallets: [{ id: 'real-wallet' }], transactions: [] }, cryptoVault: boundary.vault })
  h.api.initAuthSync()
  await h.flush()
  await h.advance(0)
  const originalKey = boundary.derivedKey()
  h.storage.set('mt_auth_sync_state', JSON.stringify({ ...h.saved(), dirtyUserId: 'owner', localRevision: 1, syncedRevision: 0 }))
  let retriedRow
  const reloadedBoundary = cryptoBoundary()
  const reloaded = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') { retriedRow = JSON.parse(options.body); return response([retriedRow]) }
    if (options.method === 'PATCH') return pending()
    return response(retriedRow ? [retriedRow] : [])
  }, { storageMap: h.storage, cryptoVault: reloadedBoundary.vault, payload: { wallets: [{ id: 'real-wallet' }], transactions: [{ id: 'new-edit' }] } })
  await reloaded.api.initAuthSync()
  await reloaded.flush()
  await reloaded.advance(0)
  assert.deepEqual(retriedRow, firstRow)
  assert.equal(reloaded.recovery().key, originalKey)
  assert.equal(reloaded.pendingCreation(), null)
  assert.equal(reloaded.saved().localRevision, 1)
  assert.equal(reloaded.saved().syncedRevision, 0)
  assert.equal(reloaded.api.state.dirty, true)
})

// Losing local key storage must prevent any remotely committed encrypted row.
test('first vault POST is blocked when its pending recovery key cannot be saved', async () => {
  let writes = 0
  const h = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') writes++
    return response([])
  }, { payload: { wallets: [{ id: 'real-wallet' }], transactions: [] }, cryptoVault: cryptoBoundary().vault, failPendingStorage: true })
  h.api.initAuthSync()
  await h.flush()
  await h.advance(0)
  assert.equal(writes, 0)
  assert.equal(h.api.state.restoring, false)
  assert.equal(h.api.state.creatingVault, false)
  assert.equal(h.recovery(), null)
})

// A persisted pending row must be recovered even if logout removed all local content.
test('empty local data still reconciles and recovers the reserved first vault row', async () => {
  let originalRow
  const boundary = cryptoBoundary()
  const h = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') { originalRow = JSON.parse(options.body); throw new Error('unknown write outcome') }
    return response([])
  }, { payload: { wallets: [{ id: 'real-wallet' }], transactions: [] }, cryptoVault: boundary.vault })
  h.api.initAuthSync()
  await h.flush()
  await h.advance(0)
  let retriedRow
  const reloaded = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') { retriedRow = JSON.parse(options.body); return response([retriedRow]) }
    return response([])
  }, { storageMap: h.storage, cryptoVault: cryptoBoundary().vault })
  await reloaded.api.initAuthSync()
  await reloaded.flush()
  await reloaded.advance(0)
  assert.deepEqual(retriedRow, originalRow)
  assert.equal(reloaded.effects().applied, 1)
  assert.equal(reloaded.recovery().key, boundary.derivedKey())
  assert.equal(reloaded.pendingCreation(), null)
})

// A failed confirmed-key write must never remove the only durable recovery copy.
test('confirmed recovery storage failure retains pending key after successful POST', async () => {
  const boundary = cryptoBoundary()
  const h = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') return response([JSON.parse(options.body)])
    return response([])
  }, { payload: { wallets: [{ id: 'real-wallet' }], transactions: [] }, cryptoVault: boundary.vault, failConfirmedStorage: true })
  h.api.initAuthSync()
  await h.flush()
  await h.advance(0)
  assert.equal(h.pendingCreation()?.key, boundary.derivedKey())
  assert.equal(h.recovery(), null)
  assert.equal(h.api.state.creatingVault, false)
})

// A matching committed row must not replace local edits newer than its reserved snapshot.
test('matching pending GET retry preserves newer local edits and schedules their later sync', async () => {
  let rejectWrite
  let remoteRow
  let committed = false
  let updates = 0
  const payload = { wallets: [{ id: 'real-wallet' }], transactions: [] }
  const h = harness(async (url, options) => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    if (options.method === 'POST') {
      remoteRow = JSON.parse(options.body)
      return new Promise((_, reject) => { rejectWrite = reject })
    }
    if (options.method === 'PATCH') { updates++; return pending() }
    return response(committed ? [remoteRow] : [])
  }, { payload, cryptoVault: cryptoBoundary().vault })
  h.api.initAuthSync()
  await h.flush()
  await h.advance(0)
  payload.transactions.push({ id: 'new-local-edit' })
  h.api.markDirty()
  committed = true
  rejectWrite(new Error('response lost after commit'))
  await h.flush()
  await h.api.ensureFirstRunBackup()
  assert.equal(h.effects().applied, 0)
  assert.deepEqual(payload.transactions, [{ id: 'new-local-edit' }])
  assert.equal(h.api.state.dirty, true)
  assert.equal(h.saved().syncedRevision, 0)
  await h.advance(0)
  assert.equal(updates, 1)
  assert.equal(h.api.state.dirty, true)
})

// A fresh logout recovery must still replace stale local data when no newer owned edits exist.
test('fresh logout with matching pending row applies recovered data instead of stale local content', async () => {
  const row = { user_id: 'owner', ciphertext: 'ciphertext', iv: 'vault-iv', salt: 'test-salt', wrapped_key: 'wrapped', wrapped_key_iv: 'wrapped-iv', checksum: 'checksum', data_version: 1, schema_version: 1, kdf_params: { iterations: 210000, hash: 'SHA-256', name: 'PBKDF2' } }
  const storage = new Map([
    ['mt_auth_sync_state', JSON.stringify(savedSession)],
    ['mt_auth_fresh_start', '1'],
    ['mt_auth_sync_pending_vaults', JSON.stringify({ owner: { key: 'KNOWN-PENDING-KEY', row, uploadRevision: 0 } })],
  ])
  const payload = { wallets: [{ id: 'stale-local' }], transactions: [{ id: 'stale-local-tx' }] }
  const h = harness(async url => {
    if (url.includes('/token?')) return response(refreshedSession)
    if (url.endsWith('/user')) return response(googleUser)
    return response([row])
  }, { storageMap: storage, payload, cryptoVault: cryptoBoundary().vault })
  await h.api.initAuthSync()
  assert.equal(h.effects().applied, 1)
  assert.deepEqual(payload.transactions, [])
  assert.equal(h.recovery().key, 'KNOWN-PENDING-KEY')
})
