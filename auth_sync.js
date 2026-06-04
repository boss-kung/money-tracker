;(function (root) {
  'use strict'

  const VAULT_TABLE = 'mt_user_vaults'
  const STATE_KEY = 'mt_auth_sync_state'
  const DEVICE_KEY = 'mt_auth_sync_device'
  const PKCE_VERIFIER_KEY = 'mt_auth_sync_pkce_verifier'
  const DEVICE_RECOVERY_KEY = 'mt_auth_sync_recovery_key'
  let _deviceRecoveryKeyMemory = '' // in-memory primary store; never touches localStorage
  const FRESH_START_KEY = 'mt_auth_fresh_start'
  const DIRTY_DEBOUNCE_MS = 2500
  const STORAGE_BRIDGE_TIMEOUT_MS = 8000
  const GOOGLE_AUTH_OPTIONS = Object.freeze({ provider: 'google' })
  const encoder = new TextEncoder()

  const state = {
    client: null,
    session: null,
    user: null,
    locked: true,
    vaultMeta: null,
    dataKey: null,
    dirty: false,
    syncing: false,
    debounceTimer: null,
    accountMenuOpen: false,
    uiBound: false,
    restoring: false,      // true while restoreSession() is in flight
    restoreError: null,    // last network/transient error during restore (non-null = show retry)
    vaultConfirmedEmpty: false, // true only when pullRemoteVault succeeded AND Supabase returned no row
    creatingVault: false,  // guard against concurrent ensureFirstRunBackup calls from markDirty
  }

  try { document.documentElement.classList.add('mt-auth-gated') } catch (_) {}

  function toastSafe(message, type = 'info') {
    try {
      if (typeof root.toast === 'function') root.toast(message, type)
      else if (root.App?.showToast) root.App.showToast(message, type)
      else console[type === 'error' ? 'error' : 'log'](message)
    } catch (_) {}
  }

  function getConfig() {
    const supabaseUrl = String(root.MT_SUPABASE_URL || '').replace(/\/+$/, '')
    return {
      supabaseUrl,
      anonKey: String(root.MT_SUPABASE_ANON_KEY || ''),
      redirectTo: String(root.MT_AUTH_REDIRECT_URL || cleanRedirectUrl()),
    }
  }

  function cleanRedirectUrl() {
    try {
      const url = new URL(location.href)
      ;['code', 'error', 'error_code', 'error_description'].forEach(key => url.searchParams.delete(key))
      url.hash = ''
      return url.toString()
    } catch (_) {
      return location.href.split('#')[0].split('?code=')[0]
    }
  }

  function configured() {
    const cfg = getConfig()
    return Boolean(cfg.supabaseUrl && cfg.anonKey)
  }

  function storageLoad() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || 'null') || {} } catch (_) { return {} }
  }

  function storageSave(next) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify({ ...storageLoad(), ...next })) } catch (_) {}
  }

  function appStorage() {
    return root.MTStorage || null
  }

  function storageBridgeReady() {
    const storage = appStorage()
    return typeof root.App?._cloudBuildPayload === 'function'
      && typeof root.App?._cloudApplyPayload === 'function'
      && typeof storage?.buildExportPayload === 'function'
      && typeof storage?.normalizeBackupPayload === 'function'
  }

  async function waitForStorageBridge({ timeoutMs = STORAGE_BRIDGE_TIMEOUT_MS } = {}) {
    if (storageBridgeReady()) return true
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 50))
      if (storageBridgeReady()) return true
    }
    throw new Error('ยังเชื่อมต่อระบบบันทึกข้อมูลไม่พร้อม')
  }

  function bytesToBase64Url(bytes) {
    let base64 = ''
    if (typeof root.MTCryptoVault?.bytesToBase64 === 'function') {
      base64 = root.MTCryptoVault.bytesToBase64(bytes)
    } else {
      const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      let binary = ''
      array.forEach(byte => { binary += String.fromCharCode(byte) })
      base64 = btoa(binary)
    }
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }

  function randomPkceVerifier() {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return bytesToBase64Url(bytes)
  }

  async function pkceChallenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier))
    return bytesToBase64Url(digest)
  }

  function deviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY)
      if (!id) {
        id = `mt_device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
        localStorage.setItem(DEVICE_KEY, id)
      }
      return id
    } catch (_) {
      return `mt_session_${Date.now().toString(36)}`
    }
  }

  function authHeaders(session = state.session) {
    const cfg = getConfig()
    return {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${session?.access_token || cfg.anonKey}`,
      'Content-Type': 'application/json',
    }
  }

  function isGoogleSession(session = state.session, user = state.user) {
    const identities = user?.identities || session?.user?.identities || []
    const providers = identities.map(identity => identity?.provider).filter(Boolean)
    const appProvider = user?.app_metadata?.provider || session?.user?.app_metadata?.provider
    return appProvider === 'google' || providers.includes('google')
  }

  function needsVaultUnlock() {
    return state.locked || !state.dataKey
  }

  function debugSnapshot() {
    const saved = storageLoad()
    return {
      version: '2026.06.04-secure-sync18',
      configured: configured(),
      hasSession: Boolean(state.session?.access_token),
      hasRefreshToken: Boolean(saved.refreshToken),
      userId: state.user?.id || saved.userId || '',
      email: state.user?.email || saved.email || '',
      locked: Boolean(state.locked),
      hasDataKey: Boolean(state.dataKey),
      hasVaultMeta: Boolean(state.vaultMeta),
      hasDeviceRecoveryKey: Boolean(readDeviceRecoveryKey()),
      freshStartFlag: isFreshStart(),
      looksLikeDemo: currentDataLooksLikeDemo(),
      vaultVersion: state.vaultMeta?.data_version || null,
      vaultConfirmedEmpty: Boolean(state.vaultConfirmedEmpty),
      dirty: Boolean(state.dirty),
      syncing: Boolean(state.syncing),
      accountMenuOpen: Boolean(state.accountMenuOpen),
      buttonText: document.getElementById('mt-auth-gate')?.innerText || '',
      needsVaultUnlock: needsVaultUnlock(),
    }
  }

  function generateRecoveryKey() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const bytes = new Uint8Array(24)
    crypto.getRandomValues(bytes)
    const chars = [...bytes].map(byte => alphabet[byte % alphabet.length])
    return [0, 4, 8, 12, 16, 20].map(start => chars.slice(start, start + 4).join('')).join('-')
  }

  function readDeviceRecoveryKey() {
    if (_deviceRecoveryKeyMemory) return _deviceRecoveryKeyMemory
    try {
      const stored = localStorage.getItem(DEVICE_RECOVERY_KEY) || ''
      if (stored) _deviceRecoveryKeyMemory = stored
      return stored
    } catch (_) { return '' }
  }

  function saveDeviceRecoveryKey(recoveryKey) {
    const key = String(recoveryKey || '')
    _deviceRecoveryKeyMemory = key
    try { localStorage.setItem(DEVICE_RECOVERY_KEY, key) } catch (_) {}
  }

  function clearDeviceRecoveryKey() {
    _deviceRecoveryKeyMemory = ''
    try { localStorage.removeItem(DEVICE_RECOVERY_KEY) } catch (_) {}
    try { sessionStorage.removeItem(DEVICE_RECOVERY_KEY) } catch (_) {}
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]))
  }

  async function requestAuth(path, options = {}) {
    const cfg = getConfig()
    const response = await fetch(`${cfg.supabaseUrl}/auth/v1${path}`, {
      ...options,
      headers: { apikey: cfg.anonKey, ...(options.headers || {}) },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error_description || data.error || data.msg || `Auth request failed: ${path}`)
    return data
  }

  async function refreshSession(refreshToken) {
    return requestAuth('/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
  }

  async function exchangeCodeForSession(code) {
    const codeVerifier = localStorage.getItem(PKCE_VERIFIER_KEY) || ''
    if (!code || !codeVerifier) throw new Error('Missing OAuth code verifier. Please sign in again.')
    const session = await requestAuth('/token?grant_type=pkce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_code: code, code_verifier: codeVerifier }),
    })
    try { localStorage.removeItem(PKCE_VERIFIER_KEY) } catch (_) {}
    session.expires_at = Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600)
    return session
  }

  async function fetchUser(session = state.session) {
    const cfg = getConfig()
    const response = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${session?.access_token || ''}` },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error_description || data.error || 'Unable to load user')
    return data
  }

  async function parseSessionFromUrl() {
    const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''))
    const query = new URLSearchParams(String(location.search || '').replace(/^\?/, ''))
    if (query.get('error') || hash.get('error')) {
      throw new Error(query.get('error_description') || hash.get('error_description') || query.get('error') || hash.get('error') || 'OAuth sign in failed')
    }
    if (query.get('code')) {
      const session = await exchangeCodeForSession(query.get('code'))
      history.replaceState(null, document.title, cleanRedirectUrl())
      return session
    }
    if (hash.get('access_token')) {
      const session = {
        access_token: hash.get('access_token'),
        refresh_token: hash.get('refresh_token'),
        expires_at: Math.floor(Date.now() / 1000) + Number(hash.get('expires_in') || 3600),
        token_type: hash.get('token_type') || 'bearer',
      }
      history.replaceState(null, document.title, cleanRedirectUrl())
      return session
    }
    return null
  }

  async function setSession(session) {
    state.session = session
    state.user = await fetchUser(session)
    if (!isGoogleSession(session, state.user)) {
      await signOut({ clearLocalData: false })
      throw new Error('บัญชีนี้ไม่ได้เข้าสู่ระบบผ่าน Google')
    }
    storageSave({
      refreshToken: session.refresh_token || storageLoad().refreshToken || '',
      expiresAt: session.expires_at || 0,
      userId: state.user.id,
      email: state.user.email || '',
    })
    await waitForStorageBridge()
    await pullRemoteVault({ silent: true })
    await ensureFirstRunBackup()
    // Case A: vault applied but data is still demo → vault was originally created from sample data.
    if (state.vaultMeta && !needsVaultUnlock() && currentDataLooksLikeDemo()) {
      console.warn('[MTAuthSync] vault contains demo data — showing reset dialog')
      showDemoVaultWarning()
    }
    // Case B: vault exists on cloud but is still locked (new device, key mismatch, unlock failed).
    // Prompt the user to enter their recovery key so data can be decrypted.
    else if (state.vaultMeta && needsVaultUnlock()) {
      console.warn('[MTAuthSync] vault still locked after login — showing recovery sheet')
      showVaultLockedSheet()
    }
    toastSafe(`เข้าสู่ระบบสำเร็จ: ${state.user.email || ''}`, 'success')
    render()
    return state
  }

  // Returns true when Supabase has explicitly rejected the token (not a transient network error).
  function isTokenRejectedError(error) {
    const msg = (error?.message || '').toLowerCase()
    return msg.includes('invalid') || msg.includes('expired') ||
           msg.includes('revoked') || msg.includes('not found') ||
           msg.includes('already used') || msg.includes('token')
  }

  // Retry refresh up to maxAttempts times with a short delay between attempts.
  // Throws immediately (no retry) when Supabase explicitly rejects the token.
  async function refreshSessionWithRetry(refreshToken, maxAttempts = 3) {
    let lastError
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await refreshSession(refreshToken)
      } catch (err) {
        lastError = err
        if (isTokenRejectedError(err)) throw err   // Don't retry a rejected token
        if (attempt < maxAttempts - 1) await new Promise(r => setTimeout(r, 700 * (attempt + 1)))
      }
    }
    throw lastError
  }

  async function restoreSession() {
    const fromUrl = await parseSessionFromUrl()
    if (fromUrl) return setSession(fromUrl)
    const saved = storageLoad()
    if (!saved.refreshToken) return null
    try {
      const refreshed = await refreshSessionWithRetry(saved.refreshToken)
      refreshed.expires_at = Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600)
      state.restoreError = null
      return setSession(refreshed)
    } catch (error) {
      // CRITICAL: only wipe the saved token when Supabase explicitly says it's invalid.
      // Network errors / timeouts must NOT erase a valid refresh token —
      // otherwise every app restart on a slow mobile connection causes permanent logout.
      if (isTokenRejectedError(error)) {
        storageSave({ refreshToken: '', expiresAt: 0 })
        state.restoreError = null
      } else {
        state.restoreError = error.message || 'เชื่อมต่อไม่ได้'
      }
      throw error
    }
  }

  async function signInWithGoogle() {
    const cfg = getConfig()
    if (!configured()) return toastSafe('ยังไม่ได้ตั้งค่า Supabase URL/Anon key', 'warn')
    const verifier = randomPkceVerifier()
    localStorage.setItem(PKCE_VERIFIER_KEY, verifier)
    const challenge = await pkceChallenge(verifier)
    const url = new URL(`${cfg.supabaseUrl}/auth/v1/authorize`)
    url.searchParams.set('provider', GOOGLE_AUTH_OPTIONS.provider)
    url.searchParams.set('redirect_to', cfg.redirectTo)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    // Force Google to show the account picker every time.
    // Without this, Google silently reuses the last signed-in account.
    url.searchParams.set('prompt', 'select_account')
    location.href = url.toString()
  }

  async function signOut({ clearLocalData = true } = {}) {
    clearTimeout(state.debounceTimer)
    state.session = null
    state.user = null
    state.locked = true
    state.dataKey = null
    state.vaultMeta = null
    state.dirty = false
    state.syncing = false
    state.vaultConfirmedEmpty = false
    storageSave({ refreshToken: '', expiresAt: 0, userId: '', email: '' })
    // Recovery key is device-specific and vault-specific — keep it in sessionStorage so
    // the user is auto-unlocked on the next sign-in within the same browser session.
    // Only clear it when the vault itself is deleted (reset-demo-vault).
    try { localStorage.removeItem(PKCE_VERIFIER_KEY) } catch (_) {}
    if (clearLocalData) {
      try { appStorage()?.reset?.() } catch (_) {}
      try { localStorage.setItem(FRESH_START_KEY, '1') } catch (_) {}
    }
    document.documentElement.classList.add('mt-auth-gated')
    renderAuthGate()
    try { location.reload() } catch (_) { render() }
  }

  function confirmSignOut() {
    const message = 'ออกจากระบบ?\n\nข้อมูลบน cloud จะยังอยู่กับบัญชี Google นี้ แต่ข้อมูลในเครื่องนี้จะถูกซ่อนและล้างออกเพื่อไม่ให้ปนกับบัญชีอื่น'
    const ok = typeof root.confirm === 'function' ? root.confirm(message) : true
    if (!ok) return
    signOut({ clearLocalData: true }).catch(error => toastSafe(`ออกจากระบบไม่สำเร็จ: ${error.message}`, 'error'))
  }

  function isFreshStart() {
    try { return localStorage.getItem(FRESH_START_KEY) === '1' } catch (_) { return false }
  }

  function clearFreshStart() {
    try { localStorage.removeItem(FRESH_START_KEY) } catch (_) {}
  }

  function currentDataLooksLikeDemo() {
    return typeof root.App?._looksLikeDemoData === 'function'
      ? root.App._looksLikeDemoData()
      : false
  }

  async function ensureFirstRunBackup() {
    if (!state.session?.access_token || !state.user?.id) return null

    console.debug('[MTAuthSync] ensureFirstRunBackup', {
      hasVaultMeta: !!state.vaultMeta,
      hasDataKey: !!state.dataKey,
      hasSavedKey: !!readDeviceRecoveryKey(),
      freshStart: isFreshStart(),
      looksLikeDemo: currentDataLooksLikeDemo(),
    })

    if (state.vaultMeta || state.dataKey) {
      const savedKey = readDeviceRecoveryKey()
      if (state.vaultMeta && savedKey && !state.dataKey) {
        const freshStart = isFreshStart()
        clearFreshStart()
        // Apply vault data when: (a) fresh start after logout, OR (b) local data is still demo.
        // Never skip-apply when local data is demo — that would leave the user staring at sample data.
        const localIsDemo = currentDataLooksLikeDemo()
        const skipApply = !freshStart && !localIsDemo
        console.debug('[MTAuthSync] unlocking vault', { skipApply, freshStart, localIsDemo })
        try {
          await unlockVault(savedKey, { skipApply, silent: true })
          console.debug('[MTAuthSync] vault unlocked', { stillDemo: currentDataLooksLikeDemo() })
        } catch (err) {
          console.warn('[MTAuthSync] unlockVault failed', err.message)
          // Always surface the failure — silent errors leave the user confused with demo data.
          toastSafe('กู้ข้อมูลอัตโนมัติไม่สำเร็จ — ไปที่เมนูบัญชีเพื่อกรอกรหัสกู้ข้อมูล', 'warn')
        }
      } else {
        console.debug('[MTAuthSync] skipping unlock', { hasSavedKey: !!savedKey, hasDataKey: !!state.dataKey })
        clearFreshStart()
      }
      return state.vaultMeta
    }

    // No vault in memory — but only proceed to create one when we have a confirmed
    // network response that no vault exists on Supabase (vaultConfirmedEmpty = true).
    //
    // If pullRemoteVault failed earlier (network error), vaultConfirmedEmpty stays false.
    // In that case we must NOT create a new vault — doing so would overwrite any existing
    // vault with a fresh key, permanently invalidating the recovery key the user already has.
    if (!state.vaultConfirmedEmpty) {
      console.warn('[MTAuthSync] vault pull unconfirmed — skipping auto-create to prevent overwrite')
      return null
    }

    // Never back up demo/default data; wait until the user has entered real data.
    const looksLikeDemo = currentDataLooksLikeDemo()
    console.debug('[MTAuthSync] no vault, vaultConfirmedEmpty:true, looksLikeDemo:', looksLikeDemo)
    clearFreshStart()
    if (looksLikeDemo) {
      // New user: wipe demo data so they start with a clean slate.
      // After reset(), Storage.init() falls back to DEFAULT_* values for missing keys.
      // Several defaults contain sample data (wallets, bills, budgets, etc.) so we must
      // explicitly write empty values for each to prevent them from reappearing on reload.
      try { appStorage()?.reset?.() } catch (_) {}
      const emptyArrayKeys = [
        'mt_wallets', 'mt_transactions', 'mt_upcoming_bills',
        'mt_budgets', 'mt_income_budgets', 'mt_merchants',
        'mt_reward_accounts', 'mt_privileges',
      ]
      const emptyObjectKeys = ['mt_cc_benefits']
      try {
        emptyArrayKeys.forEach(k => localStorage.setItem(k, '[]'))
        emptyObjectKeys.forEach(k => localStorage.setItem(k, '{}'))
      } catch (_) {}
      try { location.reload() } catch (_) {}
      return null
    }

    // Don't create a vault for empty data — wait until user has added something real
    const payload = (() => { try { return currentPayload() } catch (_) { return null } })()
    const txCount = Array.isArray(payload?.transactions) ? payload.transactions.length : 0
    const walletCount = Array.isArray(payload?.wallets) ? payload.wallets.length : 0
    if (!txCount && !walletCount) return null

    const recoveryKey = generateRecoveryKey()
    // IMPORTANT: save the key only AFTER the vault row is successfully written.
    // If createVaultFromLocalData throws, the key stays unchanged so the next
    // unlock attempt still works with the existing vault.
    const saved = await createVaultFromLocalData(recoveryKey, { silent: true })
    saveDeviceRecoveryKey(recoveryKey)
    showRecoveryKeySheet(recoveryKey)
    return saved
  }

  async function vaultRequest(method, body) {
    const cfg = getConfig()
    if (!state.session?.access_token) throw new Error('ต้องเข้าสู่ระบบก่อน sync')
    const query = method === 'POST'
      ? 'on_conflict=user_id'
      : `user_id=eq.${encodeURIComponent(state.user.id)}`
    const response = await fetch(`${cfg.supabaseUrl}/rest/v1/${VAULT_TABLE}?${query}`, {
      method,
      headers: {
        ...authHeaders(),
        Prefer: method === 'POST' ? 'resolution=merge-duplicates,return=representation' : 'return=representation',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.message || data?.error || `Vault request failed: ${method}`)
    return data
  }

  async function pullRemoteVault({ silent = false } = {}) {
    if (!state.session?.access_token || !state.user?.id) return null
    try {
      const rows = await vaultRequest('GET')
      const row = Array.isArray(rows) ? rows[0] : null
      state.vaultMeta = row || null
      state.locked = row ? true : !state.dataKey
      // Mark that we have a confirmed network answer — safe to create a new vault if row is null.
      state.vaultConfirmedEmpty = !row
      console.debug('[MTAuthSync] pullRemoteVault', { hasVault: !!row, vaultConfirmedEmpty: state.vaultConfirmedEmpty, version: row?.data_version })
      if (!silent) render()
      return row
    } catch (err) {
      // On failure we cannot confirm whether a vault exists — leave vaultConfirmedEmpty unchanged
      // so ensureFirstRunBackup won't risk overwriting an existing vault with a new key.
      console.warn('[MTAuthSync] pullRemoteVault failed', err.message)
      toastSafe(`ดึงข้อมูลจาก cloud ไม่สำเร็จ: ${err.message}`, 'warn')
      return null
    }
  }

  function currentPayload() {
    if (typeof root.App?._cloudBuildPayload === 'function') return root.App._cloudBuildPayload()
    throw new Error('ยังเชื่อมต่อระบบบันทึกข้อมูลไม่พร้อม')
  }

  function applyPayload(payload) {
    if (typeof root.App?._cloudApplyPayload === 'function') return root.App._cloudApplyPayload(payload)
    throw new Error('ยังเชื่อมต่อระบบกู้ข้อมูลไม่พร้อม')
  }

  async function buildEncryptedRow(recoveryKey, payload, previousMeta = null) {
    const cryptoVault = root.MTCryptoVault
    if (!cryptoVault) throw new Error('Crypto vault module is not loaded')
    const salt = previousMeta?.salt || cryptoVault.bytesToBase64(cryptoVault.randomBytes(16))
    const kdfParams = previousMeta?.kdf_params || cryptoVault.DEFAULT_KDF_PARAMS
    const recoveryKeyMaterial = await cryptoVault.deriveKey(recoveryKey, salt, kdfParams)
    let dataKey = state.dataKey
    let wrapped = { wrappedKey: previousMeta?.wrapped_key, iv: previousMeta?.wrapped_key_iv }
    if (!dataKey) {
      if (previousMeta?.wrapped_key && previousMeta?.wrapped_key_iv) {
        dataKey = await cryptoVault.unwrapDataKey(previousMeta.wrapped_key, recoveryKeyMaterial, previousMeta.wrapped_key_iv)
      } else {
        dataKey = await cryptoVault.generateDataKey()
        wrapped = await cryptoVault.wrapDataKey(dataKey, recoveryKeyMaterial)
      }
    }
    if (!wrapped.wrappedKey || !wrapped.iv) wrapped = await cryptoVault.wrapDataKey(dataKey, recoveryKeyMaterial)
    const encrypted = await cryptoVault.encryptVault(payload, dataKey)
    state.dataKey = dataKey
    return {
      user_id: state.user.id,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      salt,
      wrapped_key: wrapped.wrappedKey,
      wrapped_key_iv: wrapped.iv,
      kdf_params: kdfParams,
      schema_version: encrypted.schemaVersion,
      data_version: Number(previousMeta?.data_version || 0) + 1,
      checksum: encrypted.checksum,
      device_id: deviceId(),
    }
  }

  async function createVaultFromLocalData(recoveryKey, options = {}) {
    if (!String(recoveryKey || '').trim()) throw new Error('ต้องมีรหัสกู้ข้อมูลสำหรับปกป้องข้อมูล')
    await waitForStorageBridge()
    const row = await buildEncryptedRow(recoveryKey, currentPayload(), state.vaultMeta)
    const saved = await vaultRequest('POST', row)
    state.vaultMeta = Array.isArray(saved) ? saved[0] : row
    state.locked = false
    state.dirty = false
    render()
    if (!options.silent) toastSafe('บันทึกข้อมูลไว้แล้ว', 'success')
    return state.vaultMeta
  }

  async function deleteVault() {
    if (!state.session?.access_token || !state.user?.id) throw new Error('ต้องเข้าสู่ระบบก่อน')
    const cfg = getConfig()
    const response = await fetch(
      `${cfg.supabaseUrl}/rest/v1/${VAULT_TABLE}?user_id=eq.${encodeURIComponent(state.user.id)}`,
      { method: 'DELETE', headers: authHeaders() }
    )
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data?.message || data?.error || 'ลบ vault ไม่สำเร็จ')
    }
    state.vaultMeta = null
    state.dataKey = null
    state.locked = true
    console.debug('[MTAuthSync] vault deleted')
  }

  async function deleteAccount() {
    await deleteVault()
    const cfg = getConfig()
    const resp = await fetch(`${cfg.supabaseUrl}/functions/v1/delete-account`, {
      method: 'POST',
      headers: authHeaders(),
    })
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      throw new Error(data?.error || data?.message || 'ลบบัญชีไม่สำเร็จ')
    }
    clearDeviceRecoveryKey()
    try { appStorage()?.reset?.() } catch (_) {}
    try { localStorage.clear() } catch (_) {}
    try { sessionStorage.clear() } catch (_) {}
    try { location.reload() } catch (_) { renderAuthGate() }
  }

  async function sendDeleteOtp() {
    const email = state.user?.email
    if (!email) throw new Error('ไม่พบอีเมลของบัญชีนี้')
    await requestAuth('/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, create_user: false }),
    })
  }

  async function verifyOtpAndDelete(token) {
    const email = state.user?.email
    if (!email) throw new Error('ไม่พบอีเมลของบัญชีนี้')
    await requestAuth('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token, type: 'email' }),
    })
    await deleteAccount()
  }

  function showDeleteAccountSheet() {
    document.getElementById('mt-delete-account-sheet')?.remove()
    const el = document.createElement('div')
    el.id = 'mt-delete-account-sheet'
    el.className = 'mt-recovery-key-overlay'
    el.innerHTML = `
      <div class="mt-recovery-key-sheet" role="alertdialog" aria-modal="true" aria-labelledby="mt-delete-account-title">
        <div class="mt-recovery-key-header">
          <h2 id="mt-delete-account-title" style="color:var(--expense)">ลบบัญชีถาวร</h2>
        </div>
        <p>การดำเนินการนี้<strong>ไม่สามารถย้อนกลับได้</strong> และจะ:</p>
        <ul style="text-align:left;padding-left:20px;margin:8px 0;line-height:1.8">
          <li>ลบข้อมูลการเงินทั้งหมดออกจาก cloud ถาวร</li>
          <li>ยกเลิกบัญชี — login ด้วย Google account นี้ไม่ได้อีก</li>
          <li>ล้างข้อมูลทั้งหมดในเครื่องนี้</li>
        </ul>
        <p style="font-size:13px;color:var(--text-secondary)">ระบบจะส่งรหัส OTP ไปยังอีเมล <strong>${esc(state.user?.email || '')}</strong> เพื่อยืนยัน</p>
        <div class="mt-recovery-key-actions" style="flex-direction:column;gap:8px">
          <button class="btn" style="background:var(--expense);color:#fff" type="button" data-mt-auth-action="delete-account-step2">ดำเนินการต่อ — ส่ง OTP</button>
          <button class="btn btn-secondary" type="button" data-mt-auth-action="delete-account-cancel">ยกเลิก</button>
        </div>
      </div>`
    document.body.appendChild(el)
  }

  function showDeleteAccountOtpSheet() {
    document.getElementById('mt-delete-account-sheet')?.remove()
    const el = document.createElement('div')
    el.id = 'mt-delete-account-sheet'
    el.className = 'mt-recovery-key-overlay'
    el.innerHTML = `
      <div class="mt-recovery-key-sheet" role="alertdialog" aria-modal="true" aria-labelledby="mt-delete-otp-title">
        <div class="mt-recovery-key-header">
          <h2 id="mt-delete-otp-title" style="color:var(--expense)">ยืนยันการลบบัญชี</h2>
        </div>
        <p>ส่งรหัส OTP ไปที่ <strong>${esc(state.user?.email || '')}</strong> แล้ว<br>กรอกรหัส 6 หลักจากอีเมลเพื่อยืนยัน</p>
        <input
          id="mt-delete-otp-input"
          class="mt-recovery-key-input form-input"
          type="text"
          inputmode="numeric"
          placeholder="000000"
          maxlength="6"
          autocomplete="one-time-code"
          spellcheck="false"
          style="font-family:monospace;letter-spacing:4px;text-align:center;font-size:22px;margin:12px 0"
        />
        <div class="mt-recovery-key-actions" style="flex-direction:column;gap:8px">
          <button id="mt-delete-otp-confirm" class="btn" style="background:var(--expense);color:#fff;opacity:0.4;pointer-events:none" type="button" data-mt-auth-action="delete-account-confirm-otp" disabled>ลบบัญชีถาวร</button>
          <button class="btn btn-secondary" type="button" data-mt-auth-action="delete-account-cancel">ยกเลิก</button>
          <button class="btn btn-secondary" type="button" data-mt-auth-action="delete-account-resend-otp" style="font-size:12px;padding:6px">ส่งรหัสใหม่อีกครั้ง</button>
        </div>
      </div>`
    document.body.appendChild(el)
    const input = el.querySelector('#mt-delete-otp-input')
    const confirmBtn = el.querySelector('#mt-delete-otp-confirm')
    input?.addEventListener('input', () => {
      const ready = (input.value || '').replace(/\D/g, '').length >= 6
      confirmBtn.disabled = !ready
      confirmBtn.style.opacity = ready ? '1' : '0.4'
      confirmBtn.style.pointerEvents = ready ? '' : 'none'
    })
    setTimeout(() => input?.focus(), 50)
  }

  // Shown when a vault exists on cloud but couldn't be unlocked automatically —
  // either a new device (no key saved here) or a key mismatch (stale/wrong key).
  function showVaultLockedSheet() {
    document.getElementById('mt-recovery-key-sheet')?.remove()
    const el = document.createElement('div')
    el.id = 'mt-recovery-key-sheet'
    el.className = 'mt-recovery-key-overlay'
    el.innerHTML = `
      <div class="mt-recovery-key-sheet" role="dialog" aria-modal="true" aria-labelledby="mt-recovery-key-title">
        <div class="mt-recovery-key-header">
          <h2 id="mt-recovery-key-title">พบข้อมูลของคุณบน Cloud</h2>
        </div>
        <p>กรอกรหัสกู้ข้อมูลที่จดไว้เมื่อ login ครั้งแรก เพื่อดึงข้อมูลกลับมายังเครื่องนี้</p>
        <input
          id="mt-recovery-key-input"
          class="mt-recovery-key-input form-input"
          type="text"
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          style="font-family:monospace;letter-spacing:2px;text-align:center;margin:12px 0"
        />
        <div class="mt-recovery-key-note">รหัสนี้แสดงครั้งแรกเมื่อ login — ถ้าไม่มีรหัสสามารถลบข้อมูลเก่าและเริ่มต้นใหม่ได้</div>
        <div class="mt-recovery-key-actions" style="flex-direction:column;gap:8px">
          <button class="btn btn-primary" type="button" data-mt-auth-action="enter-recovery-key-submit">ดึงข้อมูลกลับมา</button>
          <button class="btn btn-secondary" type="button" data-mt-auth-action="reset-demo-vault" style="color:var(--expense)">ลบข้อมูลเก่าและเริ่มใหม่</button>
        </div>
      </div>`
    document.body.appendChild(el)
    setTimeout(() => el.querySelector('#mt-recovery-key-input')?.focus(), 50)
  }

  function showDemoVaultWarning() {
    document.getElementById('mt-demo-vault-warning')?.remove()
    const el = document.createElement('div')
    el.id = 'mt-demo-vault-warning'
    el.className = 'mt-recovery-key-overlay'
    el.innerHTML = `
      <div class="mt-recovery-key-sheet" role="dialog" aria-modal="true" aria-labelledby="mt-demo-vault-title">
        <div class="mt-recovery-key-header">
          <h2 id="mt-demo-vault-title">พบข้อมูลตัวอย่างใน Cloud</h2>
        </div>
        <p>ข้อมูลที่บันทึกไว้ใน cloud เป็นข้อมูลตัวอย่าง ไม่ใช่ข้อมูลจริงของคุณ</p>
        <p>กด <strong>"ล้างและเริ่มใหม่"</strong> เพื่อลบข้อมูลตัวอย่างออกจาก cloud จากนั้นเพิ่มข้อมูลจริงและระบบจะ sync ให้อัตโนมัติ</p>
        <div class="mt-recovery-key-actions" style="flex-direction:column;gap:8px">
          <button class="btn btn-primary" type="button" data-mt-auth-action="reset-demo-vault" style="background:var(--expense)">ล้างและเริ่มใหม่</button>
          <button class="btn btn-secondary" type="button" data-mt-auth-action="close-demo-vault-warning">ใช้ข้อมูลตัวอย่างต่อ</button>
        </div>
      </div>`
    document.body.appendChild(el)
  }

  async function unlockVault(recoveryKey, options = {}) {
    const row = state.vaultMeta || await pullRemoteVault({ silent: true })
    if (!row) return createVaultFromLocalData(recoveryKey)
    const cryptoVault = root.MTCryptoVault
    const recoveryKeyMaterial = await cryptoVault.deriveKey(recoveryKey, row.salt, row.kdf_params)
    const dataKey = await cryptoVault.unwrapDataKey(row.wrapped_key, recoveryKeyMaterial, row.wrapped_key_iv)
    const payload = await cryptoVault.decryptVault(row.ciphertext, dataKey, row.iv, row.checksum)
    if (!options.skipApply) {
      await waitForStorageBridge()
      try { appStorage()?.createLocalBackup?.(root.App?._cloudState?.(), 'before-cloud-restore') } catch (_) {}
      try {
        applyPayload(payload)
        console.debug('[MTAuthSync] applyPayload done', { stillDemo: currentDataLooksLikeDemo() })
      } catch (err) {
        console.warn('[MTAuthSync] applyPayload failed', err.message)
        throw err
      }
    }
    state.dataKey = dataKey
    state.locked = false
    state.vaultMeta = row
    render()
    if (!options.silent) toastSafe('กู้ข้อมูลสำเร็จ', 'success')
    return payload
  }

  async function pushEncryptedVault(recoveryKey = '') {
    const remote = await pullRemoteVault({ silent: true })
    if (remote && state.vaultMeta && Number(remote.data_version || 0) > Number(state.vaultMeta.data_version || 0)) {
      return handleRemoteConflict(remote)
    }
    if (!state.dataKey && !recoveryKey) throw new Error('ต้องกรอกรหัสกู้ข้อมูลก่อนบันทึก')
    await waitForStorageBridge()
    const row = await buildEncryptedRow(recoveryKey, currentPayload(), remote || state.vaultMeta)
    const saved = await vaultRequest('POST', row)
    state.vaultMeta = Array.isArray(saved) ? saved[0] : row
    state.dirty = false
    render()
    return state.vaultMeta
  }

  async function restoreRemoteWithCurrentKey(remote) {
    if (!state.dataKey) throw new Error('ต้องกรอกรหัสกู้ข้อมูลก่อนดึงข้อมูล')
    const cryptoVault = root.MTCryptoVault
    const payload = await cryptoVault.decryptVault(remote.ciphertext, state.dataKey, remote.iv, remote.checksum)
    await waitForStorageBridge()
    applyPayload(payload)
    state.vaultMeta = remote
    state.dirty = false
    state.locked = false
    render()
    return remote
  }

  async function handleRemoteConflict(remote) {
    const message = 'พบข้อมูลที่บันทึกไว้ใหม่กว่า กด OK เพื่อใช้ข้อมูลนั้น หรือ Cancel เพื่อสำรองข้อมูลในเครื่องก่อน'
    const useRemote = typeof root.confirm === 'function' ? root.confirm(message) : false
    if (useRemote) return restoreRemoteWithCurrentKey(remote)
    try {
      await waitForStorageBridge()
      const payload = currentPayload()
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      appStorage()?.triggerDownload?.(blob, `local-conflict-backup-${new Date().toISOString().slice(0, 10)}.json`)
    } catch (_) {}
    throw new Error('พบข้อมูลที่บันทึกไว้ใหม่กว่า ระบบเสนอให้สำรองข้อมูลในเครื่องก่อน')
  }

  async function syncNow({ direction = 'push', recoveryKey = '', silent = false } = {}) {
    if (state.syncing) return false
    state.syncing = true
    render()
    try {
      if (direction === 'pull') {
        await pullRemoteVault({ silent: true })
        if (state.locked) {
              if (!recoveryKey) throw new Error('ต้องใส่รหัสกู้ข้อมูล')
              await unlockVault(recoveryKey)
        }
      } else {
        await pushEncryptedVault(recoveryKey)
      }
      if (!silent) toastSafe('บันทึกข้อมูลแล้ว', 'success')
      return true
    } finally {
      state.syncing = false
      render()
    }
  }

  function autoSyncIfReady() {
    if (!state.session?.access_token || state.locked || !state.dataKey || state.syncing) return
    syncNow({ direction: 'push', silent: true })
      .catch(err => toastSafe(`บันทึกข้อมูลอัตโนมัติล้มเหลว: ${err.message}`, 'warn'))
  }

  function markDirty() {
    if (!state.session?.access_token) return
    if (state.locked) {
      // New user flow: no vault yet but user just added real data — create vault now
      if (!state.vaultMeta && state.vaultConfirmedEmpty && !currentDataLooksLikeDemo() && !state.creatingVault) {
        state.creatingVault = true
        ensureFirstRunBackup()
          .catch(err => console.warn('[MTAuthSync] ensureFirstRunBackup in markDirty:', err.message))
          .finally(() => { state.creatingVault = false })
      }
      return
    }
    state.dirty = true
    clearTimeout(state.debounceTimer)
    state.debounceTimer = setTimeout(() => {
          syncNow({ direction: 'push' }).catch(error => toastSafe(`บันทึกข้อมูลล้มเหลว: ${error.message}`, 'warn'))
    }, DIRTY_DEBOUNCE_MS)
    render()
  }

  function render() {
    renderAuthGate()
    try { if (root.App?.renderMore && root.App?._cloudState?.()?.page === 'more') root.App.renderMore() } catch (_) {}
  }

  function accountInitial(email) {
    const source = String(email || '').trim()
    return esc((source[0] || 'A').toUpperCase())
  }

  function closeAccountMenu() {
    if (!state.accountMenuOpen) return
    state.accountMenuOpen = false
    render()
  }

  function toggleAccountMenu() {
    state.accountMenuOpen = !state.accountMenuOpen
    render()
  }

  function renderAuthGate() {
    let gate = document.getElementById('mt-auth-gate')
    if (state.session?.access_token) {
      document.documentElement.classList.remove('mt-auth-gated')
      gate?.remove()
      return
    }
    document.documentElement.classList.add('mt-auth-gated')

    // Determine which panel to show
    const saved = storageLoad()
    const hasSavedSession = Boolean(saved.refreshToken || saved.userId)
    const isRestoring = state.restoring
    const hasNetworkError = Boolean(state.restoreError) && hasSavedSession

    let innerHtml
    if (isRestoring) {
      // Quiet loading state — don't show the full login gate while we're refreshing
      innerHtml = `
        <div class="mt-auth-gate-panel" role="status" aria-labelledby="mt-auth-gate-title">
          <div class="mt-auth-gate-mark">💰</div>
          <h1 id="mt-auth-gate-title">กำลังเชื่อมต่อบัญชี...</h1>
        </div>`
    } else if (hasNetworkError) {
      // Network failed but token is preserved — show retry instead of full sign-in
      const email = saved.email ? `<small style="opacity:.6">${esc(saved.email)}</small><br>` : ''
      innerHtml = `
        <div class="mt-auth-gate-panel" role="dialog" aria-modal="true" aria-labelledby="mt-auth-gate-title">
          <div class="mt-auth-gate-mark">💰</div>
          <h1 id="mt-auth-gate-title">เชื่อมต่อไม่ได้</h1>
          ${email}
          <p>ไม่สามารถเชื่อมต่อได้ในขณะนี้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต แล้วลองใหม่</p>
          <button class="btn btn-primary" type="button" data-mt-auth-action="retry-restore">ลองใหม่</button>
          <button class="btn btn-secondary" type="button" data-mt-auth-action="login" style="margin-top:8px">เข้าสู่ระบบด้วย Google</button>
        </div>`
    } else {
      innerHtml = `
        <div class="mt-auth-gate-panel" role="dialog" aria-modal="true" aria-labelledby="mt-auth-gate-title">
          <div class="mt-auth-gate-mark">💰</div>
          <h1 id="mt-auth-gate-title">Financial Tracker</h1></br><h1 id="mt-auth-gate-title">กรุณาเข้าสู่ระบบ</h1>
          <p>ข้อมูลการเงินของคุณจะถูกซ่อนไว้</br>จนกว่าจะเข้าสู่ระบบด้วยบัญชี Google</p>
          <button class="btn btn-primary" type="button" data-mt-auth-action="login">Sign in with Google</button>
        </div>`
    }

    if (!gate) {
      gate = document.createElement('div')
      gate.id = 'mt-auth-gate'
      document.body.appendChild(gate)
    }
    gate.innerHTML = innerHtml

    const loginBtn = gate.querySelector('[data-mt-auth-action="login"]')
    if (loginBtn) {
      loginBtn.disabled = !configured()
      if (!configured()) loginBtn.textContent = 'ยังไม่พร้อมเข้าสู่ระบบ'
    }
  }

  function accountMenuHtml() {
    const email = state.user?.email || storageLoad().email || 'Google'
    const recoverySaved = Boolean(readDeviceRecoveryKey())
    const status = state.syncing ? 'กำลังบันทึก' : (state.dirty ? 'รอบันทึก' : 'บันทึกแล้ว')
    return `
      <div class="mt-account-menu-wrap${state.accountMenuOpen ? ' open' : ''}">
        <button class="mt-account-button" type="button" aria-label="บัญชีและการกู้ข้อมูล" aria-expanded="${state.accountMenuOpen ? 'true' : 'false'}" data-mt-auth-action="toggle-account-menu">
          <span>${accountInitial(email)}</span>
        </button>
        <div class="mt-account-menu-popover" role="menu" aria-label="บัญชีและการกู้ข้อมูล">
          <div class="mt-account-menu-head">
            <div class="mt-account-avatar">${accountInitial(email)}</div>
            <div class="mt-account-summary">
              <div class="mt-account-title">บัญชีและการกู้ข้อมูล</div>
              <div class="mt-account-email">${esc(email)}</div>
              <div class="mt-account-status">${esc(status)}</div>
            </div>
          </div>
          <button class="mt-account-menu-item" type="button" data-mt-auth-action="show-recovery-key" role="menuitem">
            <span class="mt-account-menu-icon">Key</span>
            <span>
              <strong>รหัสกู้ข้อมูล</strong>
              <small>${recoverySaved ? 'ดูและคัดลอกรหัสของเครื่องนี้' : 'ยังไม่มีรหัสบนเครื่องนี้'}</small>
            </span>
          </button>
          <button class="mt-account-menu-item" type="button" data-mt-auth-action="sync" role="menuitem">
            <span class="mt-account-menu-icon">Sync</span>
            <span>
              <strong>บันทึกข้อมูลตอนนี้</strong>
              <small>ส่งข้อมูลที่เข้ารหัสขึ้น cloud</small>
            </span>
          </button>
          <button class="mt-account-menu-item danger" type="button" data-mt-auth-action="confirm-sign-out" role="menuitem">
            <span class="mt-account-menu-icon">Out</span>
            <span>
              <strong>ออกจากระบบ</strong>
              <small>ซ่อนและล้างข้อมูลบัญชีนี้ออกจากเครื่อง</small>
            </span>
          </button>
          <button class="mt-account-menu-item danger" type="button" data-mt-auth-action="delete-account" role="menuitem" style="opacity:0.75">
            <span class="mt-account-menu-icon">🗑</span>
            <span>
              <strong>ลบบัญชีถาวร</strong>
              <small>ลบข้อมูลและยกเลิกบัญชีนี้</small>
            </span>
          </button>
        </div>
      </div>
    `
  }

  async function promptUnlock() {
    const savedKey = readDeviceRecoveryKey()
    const recoveryKey = savedKey || prompt('กรอกรหัสกู้ข้อมูล')
    if (!recoveryKey) return
    try {
      if (state.vaultMeta) await unlockVault(recoveryKey)
      else await ensureFirstRunBackup()
    } catch (error) {
      toastSafe(`กู้ข้อมูลไม่สำเร็จ: ${error.message}`, 'error')
    }
  }

  function showRecoveryKeySheet(recoveryKey) {
    document.getElementById('mt-recovery-key-sheet')?.remove()
    const el = document.createElement('div')
    el.id = 'mt-recovery-key-sheet'
    el.className = 'mt-recovery-key-overlay'
    el.innerHTML = `
      <div class="mt-recovery-key-sheet" role="dialog" aria-modal="true" aria-labelledby="mt-recovery-key-title">
        <div class="mt-recovery-key-header">
          <h2 id="mt-recovery-key-title">เก็บรหัสนี้ไว้เพื่อกู้ข้อมูล</h2>
        </div>
        <p>ถ้าเปลี่ยนเครื่อง ล้าง browser หรือข้อมูลในเครื่องหาย ให้ใช้รหัสนี้เพื่อเอาข้อมูลกลับมา</p>
        <div class="mt-recovery-key-code" id="mt-recovery-key-code">${esc(recoveryKey)}</div>
        <div class="mt-recovery-key-note">แอปไม่เก็บรหัสนี้ไว้บน server เพื่อให้ข้อมูลของคุณเป็นส่วนตัว</div>
        <div class="mt-recovery-key-actions">
          <button class="btn btn-primary" type="button" data-mt-auth-action="copy-recovery-key">คัดลอกรหัส</button>
          <button class="btn btn-secondary" type="button" data-mt-auth-action="close-recovery-key">ปิด</button>
        </div>
      </div>`
    document.body.appendChild(el)
  }

  function showSavedRecoveryKeySheet() {
    const key = readDeviceRecoveryKey()
    if (key) {
      showRecoveryKeySheet(key)
      return
    }
    // No key on this device — show an input form so the user can enter their key
    // and unlock / restore their vault on this device.
    document.getElementById('mt-recovery-key-sheet')?.remove()
    const el = document.createElement('div')
    el.id = 'mt-recovery-key-sheet'
    el.className = 'mt-recovery-key-overlay'
    el.innerHTML = `
      <div class="mt-recovery-key-sheet" role="dialog" aria-modal="true" aria-labelledby="mt-recovery-key-title">
        <div class="mt-recovery-key-header">
          <h2 id="mt-recovery-key-title">กรอกรหัสกู้ข้อมูล</h2>
        </div>
        <p>เครื่องนี้ยังไม่มีรหัสกู้ข้อมูล กรอกรหัสที่เคยจดไว้เพื่อดึงข้อมูลจาก cloud กลับมา</p>
        <input
          id="mt-recovery-key-input"
          class="mt-recovery-key-input form-input"
          type="text"
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          style="font-family:monospace;letter-spacing:2px;text-align:center;margin:12px 0"
        />
        <div class="mt-recovery-key-note">รหัสนี้คือรหัสที่แสดงให้จดเมื่อ login ครั้งแรก</div>
        <div class="mt-recovery-key-actions">
          <button class="btn btn-primary" type="button" data-mt-auth-action="enter-recovery-key-submit">กู้ข้อมูล</button>
          <button class="btn btn-secondary" type="button" data-mt-auth-action="close-recovery-key">ยกเลิก</button>
        </div>
      </div>`
    document.body.appendChild(el)
    setTimeout(() => el.querySelector('#mt-recovery-key-input')?.focus(), 50)
  }

  async function copyRecoveryKeyFromSheet() {
    const key = document.getElementById('mt-recovery-key-code')?.textContent?.trim() || ''
    if (!key) return
    try {
      await navigator.clipboard?.writeText?.(key)
      toastSafe('คัดลอกรหัสแล้ว', 'success')
    } catch (_) {
      toastSafe('คัดลอกอัตโนมัติไม่ได้ ให้กดค้างเพื่อคัดลอกรหัส', 'warn')
    }
  }

  function bindUi() {
    if (state.uiBound) return
    state.uiBound = true
    document.addEventListener('click', event => {
      const action = event.target?.closest?.('[data-mt-auth-action]')?.dataset?.mtAuthAction
      if (!action) {
        if (state.accountMenuOpen && !event.target?.closest?.('.mt-account-menu-wrap')) {
          state.accountMenuOpen = false
          render()
        }
        return
      }
      if (action === 'login') signInWithGoogle().catch(error => toastSafe(`เริ่ม Google login ไม่สำเร็จ: ${error.message}`, 'error'))
      if (action === 'retry-restore') {
        state.restoring = true
        state.restoreError = null
        render()
        restoreSession()
          .catch(error => {
            if (!state.restoreError) toastSafe(`เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่`, 'warn')
            else console.warn('[MTAuthSync] retry restore failed', error.message)
          })
          .finally(() => { state.restoring = false; render() })
      }
      if (action === 'logout') {
        closeAccountMenu()
        confirmSignOut()
      }
      if (action === 'confirm-sign-out') {
        closeAccountMenu()
        confirmSignOut()
      }
      if (action === 'toggle-account-menu') toggleAccountMenu()
      if (action === 'unlock') promptUnlock()
      if (action === 'sync') {
        closeAccountMenu()
        syncNow({ direction: 'push' }).catch(error => toastSafe(`บันทึกข้อมูลล้มเหลว: ${error.message}`, 'error'))
      }
      if (action === 'show-recovery-key') {
        closeAccountMenu()
        showSavedRecoveryKeySheet()
      }
      if (action === 'copy-recovery-key') copyRecoveryKeyFromSheet()
      if (action === 'close-recovery-key') document.getElementById('mt-recovery-key-sheet')?.remove()
      if (action === 'close-demo-vault-warning') document.getElementById('mt-demo-vault-warning')?.remove()
      if (action === 'reset-demo-vault') {
        // Covers both: demo vault warning AND vault-locked sheet "start fresh" button
        document.getElementById('mt-demo-vault-warning')?.remove()
        document.getElementById('mt-recovery-key-sheet')?.remove()
        // Also clear any stale device recovery key so it doesn't interfere next time
        clearDeviceRecoveryKey()
        deleteVault()
          .then(() => {
            try { appStorage()?.reset?.() } catch (_) {}
            toastSafe('ล้าง cloud vault แล้ว — เพิ่มข้อมูลจริงและระบบจะ sync อัตโนมัติ', 'success')
            render()
          })
          .catch(err => toastSafe(`ล้าง vault ไม่สำเร็จ: ${err.message}`, 'error'))
      }
      if (action === 'enter-recovery-key-submit') {
        const input = document.getElementById('mt-recovery-key-input')
        const key = (input?.value || '').trim().toUpperCase()
        if (!key) { toastSafe('กรุณากรอกรหัสกู้ข้อมูล', 'warn'); return }
        document.getElementById('mt-recovery-key-sheet')?.remove()
        unlockVault(key)
          .then(() => { saveDeviceRecoveryKey(key); toastSafe('กู้ข้อมูลสำเร็จ', 'success') })
          .catch(err => {
            // OperationError = wrong recovery key (WebCrypto AES-GCM tag mismatch)
            const isWrongKey = err.name === 'OperationError' || (err.message || '').toLowerCase().includes('operation')
            if (isWrongKey) {
              toastSafe('รหัสกู้ข้อมูลไม่ถูกต้อง — กรุณากรอกรหัสที่จดไว้', 'error')
              showVaultLockedSheet()
            } else {
              toastSafe(`กู้ข้อมูลไม่สำเร็จ: ${err.message}`, 'error')
            }
          })
      }
      if (action === 'delete-account') {
        closeAccountMenu()
        showDeleteAccountSheet()
      }
      if (action === 'delete-account-step2') {
        document.getElementById('mt-delete-account-sheet')?.remove()
        sendDeleteOtp()
          .then(() => showDeleteAccountOtpSheet())
          .catch(err => toastSafe(`ส่ง OTP ไม่สำเร็จ: ${err.message}`, 'error'))
      }
      if (action === 'delete-account-cancel') {
        document.getElementById('mt-delete-account-sheet')?.remove()
      }
      if (action === 'delete-account-resend-otp') {
        sendDeleteOtp()
          .then(() => toastSafe('ส่งรหัส OTP ใหม่แล้ว', 'success'))
          .catch(err => toastSafe(`ส่ง OTP ไม่สำเร็จ: ${err.message}`, 'error'))
      }
      if (action === 'delete-account-confirm-otp') {
        const input = document.getElementById('mt-delete-otp-input')
        const token = (input?.value || '').replace(/\D/g, '').trim()
        if (token.length < 6) { toastSafe('กรุณากรอก OTP ให้ครบ 6 หลัก', 'warn'); return }
        document.getElementById('mt-delete-account-sheet')?.remove()
        verifyOtpAndDelete(token)
          .catch(err => {
            const isWrongOtp = (err.message || '').toLowerCase().includes('token') || (err.message || '').toLowerCase().includes('otp') || (err.message || '').toLowerCase().includes('invalid') || (err.message || '').toLowerCase().includes('expired')
            if (isWrongOtp) {
              toastSafe('รหัส OTP ไม่ถูกต้องหรือหมดอายุ — กรุณาลองใหม่', 'error')
              showDeleteAccountOtpSheet()
            } else {
              toastSafe(`ลบบัญชีไม่สำเร็จ: ${err.message}`, 'error')
            }
          })
      }
    })
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.accountMenuOpen) {
        state.accountMenuOpen = false
        render()
      }
    })
  }

  async function initAuthSync() {
    bindUi()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') autoSyncIfReady()
    }, { passive: true })
    window.addEventListener('pageshow', () => {
      setTimeout(autoSyncIfReady, 1500)
    }, { passive: true })
    if (!configured()) { renderAuthGate(); return state }
    // Show "กำลังเชื่อมต่อ..." while restoring so the full login gate
    // doesn't flash in the user's face on every app open.
    const hasSavedSession = Boolean(storageLoad().refreshToken)
    state.restoring = hasSavedSession
    state.restoreError = null
    renderAuthGate()
    try { await restoreSession() } catch (error) {
      if (state.restoreError) {
        // Network / transient — show retry UI (not a hard "sign in" prompt)
        console.warn('[MTAuthSync] session restore failed (network?)', error.message)
      } else {
        // Token was explicitly rejected — treat as signed-out
        toastSafe(`เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่`, 'warn')
      }
    } finally {
      state.restoring = false
      render()
    }
    return state
  }

  const api = {
    createVaultFromLocalData,
    accountMenuHtml,
    ensureFirstRunBackup,
    initAuthSync,
    isGoogleSession,
    confirmSignOut,
    debugSnapshot,
    markDirty,
    pullRemoteVault,
    pushEncryptedVault,
    signInWithGoogle,
    signOut,
    showSavedRecoveryKeySheet,
    state,
    syncNow,
    toggleAccountMenu,
    unlockVault,
  }

  root.MTAuthSync = api
  try { setTimeout(renderAuthGate, 0) } catch (_) {}
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : window)
