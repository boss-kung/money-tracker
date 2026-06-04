;(function (root) {
  'use strict'

  const VAULT_TABLE = 'mt_user_vaults'
  const STATE_KEY = 'mt_auth_sync_state'
  const DEVICE_KEY = 'mt_auth_sync_device'
  const PKCE_VERIFIER_KEY = 'mt_auth_sync_pkce_verifier'
  const DIRTY_DEBOUNCE_MS = 2500
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
  }

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
      version: '2026.06.04-secure-sync4',
      configured: configured(),
      hasSession: Boolean(state.session?.access_token),
      hasRefreshToken: Boolean(saved.refreshToken),
      userId: state.user?.id || saved.userId || '',
      email: state.user?.email || saved.email || '',
      locked: Boolean(state.locked),
      hasDataKey: Boolean(state.dataKey),
      hasVaultMeta: Boolean(state.vaultMeta),
      vaultVersion: state.vaultMeta?.data_version || null,
      dirty: Boolean(state.dirty),
      syncing: Boolean(state.syncing),
      buttonText: document.getElementById('mt-auth-sync')?.innerText || '',
      needsVaultUnlock: needsVaultUnlock(),
    }
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
      await signOut()
      throw new Error('บัญชีนี้ไม่ได้เข้าสู่ระบบผ่าน Google')
    }
    storageSave({
      refreshToken: session.refresh_token || storageLoad().refreshToken || '',
      expiresAt: session.expires_at || 0,
      userId: state.user.id,
      email: state.user.email || '',
    })
    await pullRemoteVault({ silent: true })
    render()
    return state
  }

  async function restoreSession() {
    const fromUrl = await parseSessionFromUrl()
    if (fromUrl) return setSession(fromUrl)
    const saved = storageLoad()
    if (!saved.refreshToken) return null
    try {
      const refreshed = await refreshSession(saved.refreshToken)
      refreshed.expires_at = Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600)
      return setSession(refreshed)
    } catch (error) {
      storageSave({ refreshToken: '', expiresAt: 0 })
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
    location.href = url.toString()
  }

  async function signOut() {
    state.session = null
    state.user = null
    state.locked = true
    state.dataKey = null
    state.vaultMeta = null
    storageSave({ refreshToken: '', expiresAt: 0, userId: '', email: '' })
    render()
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
    const rows = await vaultRequest('GET')
    const row = Array.isArray(rows) ? rows[0] : null
    state.vaultMeta = row || null
    state.locked = row ? true : !state.dataKey
    if (!silent) render()
    return row
  }

  function currentPayload() {
    if (typeof root.App?._cloudBuildPayload === 'function') return root.App._cloudBuildPayload()
    throw new Error('Cloud sync is not connected to app storage yet')
  }

  function applyPayload(payload) {
    if (typeof root.App?._cloudApplyPayload === 'function') return root.App._cloudApplyPayload(payload)
    throw new Error('Cloud restore is not connected to app storage yet')
  }

  async function buildEncryptedRow(passphrase, payload, previousMeta = null) {
    const cryptoVault = root.MTCryptoVault
    if (!cryptoVault) throw new Error('Crypto vault module is not loaded')
    const salt = previousMeta?.salt || cryptoVault.bytesToBase64(cryptoVault.randomBytes(16))
    const kdfParams = previousMeta?.kdf_params || cryptoVault.DEFAULT_KDF_PARAMS
    const passphraseKey = await cryptoVault.deriveKey(passphrase, salt, kdfParams)
    let dataKey = state.dataKey
    let wrapped = { wrappedKey: previousMeta?.wrapped_key, iv: previousMeta?.wrapped_key_iv }
    if (!dataKey) {
      if (previousMeta?.wrapped_key && previousMeta?.wrapped_key_iv) {
        dataKey = await cryptoVault.unwrapDataKey(previousMeta.wrapped_key, passphraseKey, previousMeta.wrapped_key_iv)
      } else {
        dataKey = await cryptoVault.generateDataKey()
        wrapped = await cryptoVault.wrapDataKey(dataKey, passphraseKey)
      }
    }
    if (!wrapped.wrappedKey || !wrapped.iv) wrapped = await cryptoVault.wrapDataKey(dataKey, passphraseKey)
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

  async function createVaultFromLocalData(passphrase) {
    if (!String(passphrase || '').trim()) throw new Error('ต้องมี passphrase สำหรับเข้ารหัสข้อมูล')
    const row = await buildEncryptedRow(passphrase, currentPayload(), state.vaultMeta)
    const saved = await vaultRequest('POST', row)
    state.vaultMeta = Array.isArray(saved) ? saved[0] : row
    state.locked = false
    state.dirty = false
    render()
    toastSafe('สร้าง secure cloud vault แล้ว', 'success')
    return state.vaultMeta
  }

  async function unlockVault(passphrase, options = {}) {
    const row = state.vaultMeta || await pullRemoteVault({ silent: true })
    if (!row) return createVaultFromLocalData(passphrase)
    const cryptoVault = root.MTCryptoVault
    const passphraseKey = await cryptoVault.deriveKey(passphrase, row.salt, row.kdf_params)
    const dataKey = await cryptoVault.unwrapDataKey(row.wrapped_key, passphraseKey, row.wrapped_key_iv)
    const payload = await cryptoVault.decryptVault(row.ciphertext, dataKey, row.iv, row.checksum)
    if (!options.skipApply) {
      try { root.Storage?.createLocalBackup?.(root.App?._cloudState?.(), 'before-cloud-restore') } catch (_) {}
      applyPayload(payload)
    }
    state.dataKey = dataKey
    state.locked = false
    state.vaultMeta = row
    render()
    toastSafe('ปลดล็อก cloud sync แล้ว', 'success')
    return payload
  }

  async function pushEncryptedVault(passphrase = '') {
    const remote = await pullRemoteVault({ silent: true })
    if (remote && state.vaultMeta && Number(remote.data_version || 0) > Number(state.vaultMeta.data_version || 0)) {
      return handleRemoteConflict(remote)
    }
    if (!state.dataKey && !passphrase) throw new Error('ต้องปลดล็อก vault ก่อน sync')
    const row = await buildEncryptedRow(passphrase, currentPayload(), remote || state.vaultMeta)
    const saved = await vaultRequest('POST', row)
    state.vaultMeta = Array.isArray(saved) ? saved[0] : row
    state.dirty = false
    render()
    return state.vaultMeta
  }

  async function restoreRemoteWithCurrentKey(remote) {
    if (!state.dataKey) throw new Error('ต้องปลดล็อก vault ก่อนดึงข้อมูล remote')
    const cryptoVault = root.MTCryptoVault
    const payload = await cryptoVault.decryptVault(remote.ciphertext, state.dataKey, remote.iv, remote.checksum)
    applyPayload(payload)
    state.vaultMeta = remote
    state.dirty = false
    state.locked = false
    render()
    return remote
  }

  async function handleRemoteConflict(remote) {
    const message = 'พบข้อมูล cloud ใหม่กว่า กด OK เพื่อใช้ข้อมูล cloud หรือ Cancel เพื่อ export backup ข้อมูลในเครื่องก่อน'
    const useRemote = typeof root.confirm === 'function' ? root.confirm(message) : false
    if (useRemote) return restoreRemoteWithCurrentKey(remote)
    try {
      const payload = currentPayload()
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      root.Storage?.triggerDownload?.(blob, `local-conflict-backup-${new Date().toISOString().slice(0, 10)}.json`)
    } catch (_) {}
    throw new Error('Remote vault is newer. Local backup was offered before overwrite.')
  }

  async function syncNow({ direction = 'push', passphrase = '' } = {}) {
    if (state.syncing) return false
    state.syncing = true
    render()
    try {
      if (direction === 'pull') {
        await pullRemoteVault({ silent: true })
        if (state.locked) {
          if (!passphrase) throw new Error('ต้องใส่ passphrase เพื่อดึงข้อมูล cloud')
          await unlockVault(passphrase)
        }
      } else {
        await pushEncryptedVault(passphrase)
      }
      toastSafe('Cloud sync สำเร็จ', 'success')
      return true
    } finally {
      state.syncing = false
      render()
    }
  }

  function markDirty() {
    if (!state.session?.access_token || state.locked) return
    state.dirty = true
    clearTimeout(state.debounceTimer)
    state.debounceTimer = setTimeout(() => {
      syncNow({ direction: 'push' }).catch(error => toastSafe(`Cloud sync ล้มเหลว: ${error.message}`, 'warn'))
    }, DIRTY_DEBOUNCE_MS)
    render()
  }

  function render() {
    let rootEl = document.getElementById('mt-auth-sync')
    if (!rootEl) {
      rootEl = document.createElement('div')
      rootEl.id = 'mt-auth-sync'
      rootEl.className = 'mt-auth-sync'
      document.body.appendChild(rootEl)
    }
    if (!configured()) {
      rootEl.innerHTML = '<button class="mt-auth-btn" type="button" disabled>Cloud sync ยังไม่ตั้งค่า</button>'
      return
    }
    if (!state.session?.access_token) {
      rootEl.innerHTML = '<button class="mt-auth-btn" type="button" data-mt-auth-action="login">Sign in with Google</button>'
      return
    }
    const email = state.user?.email || 'Google account'
    const needsUnlock = needsVaultUnlock()
    const label = needsUnlock
      ? (state.vaultMeta ? 'Unlock cloud vault' : 'Create cloud vault')
      : (state.syncing ? 'Syncing...' : (state.dirty ? 'Sync pending' : 'Cloud sync'))
    rootEl.innerHTML = `<button class="mt-auth-btn ${needsUnlock ? 'warn' : ''}" type="button" data-mt-auth-action="${needsUnlock ? 'unlock' : 'sync'}">${label}</button><button class="mt-auth-link" type="button" data-mt-auth-action="logout">${email}</button>`
  }

  async function promptUnlock() {
    const passphrase = prompt(state.vaultMeta ? 'ใส่ cloud sync passphrase' : 'ตั้ง cloud sync passphrase ใหม่')
    if (!passphrase) return
    try {
      if (state.vaultMeta) await unlockVault(passphrase)
      else await createVaultFromLocalData(passphrase)
    } catch (error) {
      toastSafe(`ปลดล็อกไม่สำเร็จ: ${error.message}`, 'error')
    }
  }

  function bindUi() {
    document.addEventListener('click', event => {
      const action = event.target?.closest?.('[data-mt-auth-action]')?.dataset?.mtAuthAction
      if (!action) return
      if (action === 'login') signInWithGoogle().catch(error => toastSafe(`เริ่ม Google login ไม่สำเร็จ: ${error.message}`, 'error'))
      if (action === 'logout') signOut()
      if (action === 'unlock') promptUnlock()
      if (action === 'sync') syncNow({ direction: 'push' }).catch(error => toastSafe(`Cloud sync ล้มเหลว: ${error.message}`, 'error'))
    })
  }

  async function initAuthSync() {
    render()
    bindUi()
    if (!configured()) return state
    try { await restoreSession() } catch (error) { toastSafe(`Auth restore ล้มเหลว: ${error.message}`, 'warn') }
    render()
    return state
  }

  const api = {
    createVaultFromLocalData,
    initAuthSync,
    isGoogleSession,
    debugSnapshot,
    markDirty,
    pullRemoteVault,
    pushEncryptedVault,
    signInWithGoogle,
    signOut,
    state,
    syncNow,
    unlockVault,
  }

  root.MTAuthSync = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : window)
