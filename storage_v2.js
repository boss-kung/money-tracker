function cloneStorageDefault(value) {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value))
}

// One schema owns local keys, defaults, State hydration, backup inclusion, and reset.
// Collections with state:false keep their own in-memory models but still cross the
// same Storage Interface for local persistence and encrypted Vault export.
const COLLECTIONS = Object.freeze({
  transactions:        { key:'mt_transactions', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_TRANSACTIONS !== 'undefined' ? DEFAULT_TRANSACTIONS : []) },
  wallets:             { key:'mt_wallets', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_WALLETS !== 'undefined' ? DEFAULT_WALLETS : []) },
  categories:          { key:'mt_categories', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_CATEGORIES !== 'undefined' ? DEFAULT_CATEGORIES : { expense:[], income:[] }) },
  budgets:             { key:'mt_budgets', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_BUDGETS !== 'undefined' ? DEFAULT_BUDGETS : []) },
  settings:            { key:'mt_settings', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_SETTINGS !== 'undefined' ? DEFAULT_SETTINGS : {}) },
  recurring:           { key:'mt_recurring', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_RECURRING !== 'undefined' ? DEFAULT_RECURRING : []) },
  upcomingBills:       { key:'mt_upcoming_bills', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_UPCOMING_BILLS !== 'undefined' ? DEFAULT_UPCOMING_BILLS : []) },
  merchants:           { key:'mt_merchants', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_MERCHANTS !== 'undefined' ? DEFAULT_MERCHANTS : []) },
  ccBenefits:          { key:'mt_cc_benefits', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_CC_BENEFITS !== 'undefined' ? DEFAULT_CC_BENEFITS : {}) },
  ccBenefitRules:      { key:'mt_cc_benefit_rules', state:true,  defaultValue:() => [] },
  incomeBudgets:       { key:'mt_income_budgets', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_INCOME_BUDGETS !== 'undefined' ? DEFAULT_INCOME_BUDGETS : []) },
  marketPrices:        { key:'mt_market_prices', state:true,  defaultValue:() => ({}) },
  rewardLedger:        { key:'mt_reward_ledger', state:true,  defaultValue:() => [] },
  netWorthSnapshots:   { key:'mt_net_worth_snapshots', state:true,  defaultValue:() => [] },
  investmentSnapshots: { key:'mt_investment_snapshots', state:true,  defaultValue:() => [] },
  creditLimitGroups:   { key:'mt_credit_limit_groups', state:true,  defaultValue:() => [] },
  rewardAccounts:      { key:'mt_reward_accounts', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_REWARD_ACCOUNTS !== 'undefined' ? DEFAULT_REWARD_ACCOUNTS : []) },
  cryptoAssets:        { key:'mt_crypto_assets', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_CRYPTO_ASSETS !== 'undefined' ? DEFAULT_CRYPTO_ASSETS : []) },
  cryptoHoldings:      { key:'mt_crypto_holdings', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_CRYPTO_HOLDINGS !== 'undefined' ? DEFAULT_CRYPTO_HOLDINGS : []) },
  cryptoTransactions:  { key:'mt_crypto_transactions', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_CRYPTO_TRANSACTIONS !== 'undefined' ? DEFAULT_CRYPTO_TRANSACTIONS : []) },
  cryptoSyncMeta:      { key:'mt_crypto_sync_meta', state:true,  defaultValue:() => ({}) },
  goals:               { key:'mt_goals', state:true,  defaultValue:() => [] },
  privileges:          { key:'mt_privileges', state:true,  defaultValue:ctx => cloneStorageDefault(typeof DEFAULT_PRIVILEGES !== 'undefined' && !ctx?.hasExistingPrimaryData ? DEFAULT_PRIVILEGES : []) },
  creditCardPromoSearches: { key:'mt_credit_card_promo_searches', state:true, defaultValue:() => [] },
  creditCardPromotions:    { key:'mt_credit_card_promotions', state:true, defaultValue:() => [] },
  splitBills:          { key:'mt_split_bills', state:true,  preferStoredForBackup:true, defaultValue:() => [] },
  splitPeople:         { key:'mt_split_people', state:true,  preferStoredForBackup:true, defaultValue:() => [] },
  splitBillDraft:      { key:'mt_split_bill_draft', state:true,  preferStoredForBackup:true, defaultValue:() => null },
  loans:               { key:'mt_loans', state:true,  preferStoredForBackup:true, defaultValue:() => [] },
  bnplPlans:           { key:'mt_bnpl_plans', state:true,  preferStoredForBackup:true, defaultValue:() => [] },
  migrations:          { key:'mt_migrations', state:true,  defaultValue:() => cloneStorageDefault(typeof DEFAULT_MIGRATIONS !== 'undefined' ? DEFAULT_MIGRATIONS : { cryptoCentralizedV1:false }) },
  aiInsightStore:      { key:'mt_ai_insight_store', state:false, defaultValue:() => ({ version:2, lastRefreshed:null, payloadHash:'', insights:[], hiddenTypes:[], feedback:[] }) },
  financialProfile:    { key:'mt_financial_profile', state:false, defaultValue:() => ({}) },
  financialMemory:     { key:'mt_financial_memory', state:false, defaultValue:() => [] },
  monthlyFinancialFeatures: { key:'mt_monthly_financial_features', state:false, defaultValue:() => [] },
  financeFeatureStoreMeta: { key:'mt_finance_feature_store_meta', state:false, defaultValue:() => ({}) },
  financialRecommendationFeedback: { key:'mt_financial_recommendation_feedback', state:false, defaultValue:() => [] },
  financialActionLog:  { key:'mt_financial_action_log', state:false, defaultValue:() => [] },
  financialLifePlans:  { key:'mt_financial_life_plans', state:false, defaultValue:() => [] },
})

const KEYS = Object.freeze(Object.fromEntries(Object.entries(COLLECTIONS).map(([name, descriptor]) => [name, descriptor.key])))
const BACKUP_SCHEMA_VERSION = 4
const LOCAL_BACKUP_KEY = 'mt_local_backup_snapshots'
const LOCAL_BACKUP_LIMIT = 3
const LOCAL_STATE_META_KEY = 'mt_state_meta'
const LOCAL_STATE_LOCK_KEY = 'mt_state_lock'
const LOCAL_STATE_LOCK_TTL_MS = 4000
const LOCAL_RECOVERY_QUARANTINE_KEY = 'mt_corrupt_quarantine'
const LOCAL_RECOVERY_QUARANTINE_LIMIT = 12
const BACKUP_SCHEMA_KEYS = Object.freeze(Object.keys(COLLECTIONS))
const BACKUP_DEFAULTS = Object.freeze(Object.fromEntries(BACKUP_SCHEMA_KEYS.map(name => [name, COLLECTIONS[name].defaultValue({ hasExistingPrimaryData:true })])))

const Storage = {
  collectionNames: BACKUP_SCHEMA_KEYS,
  stateRevision: 0,
  isStale: false,
  lastConflict: null,
  hydrationStatus: { recoveryMode: false, corruptCollections: [], quarantinedAt: null, quarantineKey: LOCAL_RECOVERY_QUARANTINE_KEY },
  lastLoadError: null,
  lastSaveError: null,
  lastVerifyError: null,
  _lastStorageToastAt: 0,
  lastNormalizationWarnings: [],
  _writerId: `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  _syncInstalled: false,
  _broadcastChannel: null,

  _readStateMeta() {
    if (!Storage.isLocalStorageReadable()) return { revision: 0, writerId: '', savedAt: '' }
    try {
      const raw = localStorage.getItem(LOCAL_STATE_META_KEY)
      if (!raw) return { revision: 0, writerId: '', savedAt: '' }
      const parsed = JSON.parse(raw)
      const revision = Number(parsed?.revision)
      return {
        revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
        writerId: String(parsed?.writerId || ''),
        savedAt: String(parsed?.savedAt || ''),
      }
    } catch (_) {
      return { revision: 0, writerId: '', savedAt: '' }
    }
  },

  _installCrossTabSync() {
    if (Storage._syncInstalled) return
    Storage._syncInstalled = true
    const observeRevision = revision => {
      const next = Number(revision)
      if (!Number.isSafeInteger(next) || next <= Storage.stateRevision) return
      Storage.isStale = true
    }
    try {
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('storage', event => {
          if (event?.key !== LOCAL_STATE_META_KEY || !event.newValue) return
          try { observeRevision(JSON.parse(event.newValue)?.revision) } catch (_) {}
        })
      }
    } catch (_) {}
    try {
      if (typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function') {
        Storage._broadcastChannel = new window.BroadcastChannel('money-tracker-state')
        Storage._broadcastChannel.onmessage = event => observeRevision(event?.data?.revision)
      }
    } catch (_) {
      Storage._broadcastChannel = null
    }
  },

  _publishRevision(revision) {
    try {
      Storage._broadcastChannel?.postMessage({ revision, writerId: Storage._writerId })
    } catch (_) {}
  },

  _acquireStateLock() {
    if (!Storage.isLocalStorageReadable() || typeof localStorage.setItem !== 'function') return null
    const now = Date.now()
    const owner = Storage._writerId
    const lock = { owner, expiresAt: now + LOCAL_STATE_LOCK_TTL_MS }
    try {
      const existingRaw = localStorage.getItem(LOCAL_STATE_LOCK_KEY)
      if (existingRaw) {
        const existing = JSON.parse(existingRaw)
        if (existing?.owner && existing.owner !== owner && Number(existing.expiresAt) > now) return null
      }
      localStorage.setItem(LOCAL_STATE_LOCK_KEY, JSON.stringify(lock))
      const written = JSON.parse(localStorage.getItem(LOCAL_STATE_LOCK_KEY) || '{}')
      return written.owner === owner ? lock : null
    } catch (_) {
      return null
    }
  },

  _releaseStateLock(lock) {
    if (!lock) return
    try {
      const current = JSON.parse(localStorage.getItem(LOCAL_STATE_LOCK_KEY) || '{}')
      if (current.owner === lock.owner) localStorage.removeItem(LOCAL_STATE_LOCK_KEY)
    } catch (_) {}
  },

  _rejectStaleSave(expectedRevision, actualRevision) {
    Storage.isStale = true
    Storage.lastConflict = {
      expectedRevision,
      actualRevision,
      writerId: Storage._writerId,
      at: new Date().toISOString(),
    }
    Storage.lastSaveError = null
    return false
  },

  _readRaw(key) {
    if (!Storage.isLocalStorageReadable()) return { status: 'unavailable', raw: null, value: null }
    let raw
    try { raw = localStorage.getItem(key) } catch (error) {
      Storage.lastLoadError = { key, message: error?.message || 'localStorage read failed', at: new Date().toISOString() }
      return { status: 'unavailable', raw: null, value: null, error }
    }
    if (raw === null) return { status: 'missing', raw: null, value: null }
    try {
      return { status: 'valid', raw, value: JSON.parse(raw) }
    } catch (error) {
      Storage.lastLoadError = { key, message: error?.message || 'JSON parse failed', at: new Date().toISOString() }
      return { status: 'corrupt', raw, value: null, error }
    }
  },

  _quarantineCorrupt(entries) {
    if (!Array.isArray(entries) || !entries.length) return null
    const createdAt = new Date().toISOString()
    const rows = entries.map(entry => ({
      collection: entry.collection,
      key: entry.key,
      raw: entry.raw,
      message: entry.message || 'JSON parse failed',
      quarantinedAt: createdAt,
    }))
    try {
      let previous = []
      try {
        const parsed = JSON.parse(localStorage.getItem(LOCAL_RECOVERY_QUARANTINE_KEY) || '[]')
        if (Array.isArray(parsed)) previous = parsed
      } catch (_) {}
      localStorage.setItem(
        LOCAL_RECOVERY_QUARANTINE_KEY,
        JSON.stringify([...rows, ...previous].slice(0, LOCAL_RECOVERY_QUARANTINE_LIMIT)),
      )
    } catch (_) {}
    return createdAt
  },

  beginRecoveryWrite() {
    if (!Storage.hydrationStatus?.recoveryMode) return false
    Storage._recoveryWriteAuthorized = true
    return true
  },

  endRecoveryWrite(success = false) {
    const completed = success === true && Storage._recoveryWriteAuthorized === true
    Storage._recoveryWriteAuthorized = false
    if (!completed) return false
    Storage.hydrationStatus = {
      ...Storage.hydrationStatus,
      recoveryMode: false,
      corruptCollections: [],
    }
    return true
  },

  _stripDangerousKeys(obj) {
    if (!obj || typeof obj !== 'object') return obj
    const dangerous = new Set(['__proto__', 'constructor', 'prototype'])
    const clean = Array.isArray(obj) ? [] : {}
    for (const key of Object.keys(obj)) {
      if (dangerous.has(key)) continue
      const val = obj[key]
      clean[key] = (val && typeof val === 'object') ? Storage._stripDangerousKeys(val) : val
    }
    return clean
  },

  _stripExecutableFields(value) {
    if (Array.isArray(value)) return value.map(item => Storage._stripExecutableFields(item))
    if (!value || typeof value !== 'object') return value
    const clean = {}
    for (const key of Object.keys(value)) {
      if (/^(?:on[a-z]+|action|open|skip|handler|fn|code)$/i.test(key)) continue
      clean[key] = Storage._stripExecutableFields(value[key])
    }
    return clean
  },

  _normalizeImportedValue(value, collection) {
    if (Array.isArray(value)) return Storage._normalizeImportedArray(value, collection)
    if (!value || typeof value !== 'object') return value
    const clean = {}
    for (const key of Object.keys(value)) {
      if (/^(?:on[a-z]+|action|open|skip|handler|fn|code)$/i.test(key)) continue
      clean[key] = Storage._normalizeImportedValue(value[key], `${collection}.${key}`)
    }
    return clean
  },

  _isSafeImportedId(value) {
    return typeof value === 'string'
      && value.length > 0
      && value.length <= 160
      && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  },

  _normalizeImportedArray(value, collection) {
    if (!Array.isArray(value)) return value
    const rows = []
    value.forEach((row, index) => {
      const clean = Storage._normalizeImportedValue(row, collection)
      if (clean && typeof clean === 'object' && !Array.isArray(clean) && Object.prototype.hasOwnProperty.call(clean, 'id')) {
        if (!Storage._isSafeImportedId(clean.id)) {
          Storage.lastNormalizationWarnings.push({
            collection,
            index,
            reason: 'invalid-id',
            message: `${collection}[${index}] ถูกข้ามเพราะ id ไม่ปลอดภัย`,
          })
          return
        }
      }
      rows.push(clean)
    })
    return rows
  },

  isLocalStorageReadable() {
    try {
      return typeof localStorage !== 'undefined'
        && typeof localStorage.getItem === 'function'
        && typeof localStorage.key === 'function'
    } catch (_) {
      return false
    }
  },

  isLocalStorageWritable() {
    try {
      if (!Storage.isLocalStorageReadable() || typeof localStorage.setItem !== 'function') return false
      const probeKey = '__mt_storage_probe__'
      localStorage.setItem(probeKey, '1')
      const ok = localStorage.getItem(probeKey) === '1'
      localStorage.removeItem(probeKey)
      return ok
    } catch (_) {
      return false
    }
  },

  // Kept as a compatibility alias for callers that only need to read state.
  isLocalStorageAvailable() {
    return Storage.isLocalStorageReadable()
  },

  _stringify(data) {
    return JSON.stringify(data)
  },

  triggerDownload(blob, filename = 'download.json') {
    const downloadName = String(filename || 'download.json')
    const downloadViaAnchor = () => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = downloadName
      a.rel = 'noopener'
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()

      if (!('download' in HTMLAnchorElement.prototype)) {
        try { window.open(url, '_blank', 'noopener') } catch (_) {}
      }

      setTimeout(() => {
        try { a.remove() } catch (_) {}
        try { URL.revokeObjectURL(url) } catch (_) {}
      }, 1500)
      return true
    }

    const canShareFile = typeof navigator !== 'undefined'
      && typeof navigator.share === 'function'
      && typeof File !== 'undefined'
    if (canShareFile) {
      try {
        const file = new File([blob], downloadName, { type: blob?.type || 'application/octet-stream' })
        const shareResult = navigator.share({ files: [file], title: downloadName })
        if (shareResult && typeof shareResult.then === 'function') {
          shareResult.catch(() => {
            try { downloadViaAnchor() } catch (_) {}
          })
        }
        return true
      } catch (_) {
        try { return downloadViaAnchor() } catch (_) { return false }
      }
    }

    try { return downloadViaAnchor() } catch (_) { return false }
  },

  load(key) {
    const result = Storage._readRaw(key)
    if (result.status === 'corrupt') {
      setTimeout(() => {
        if (typeof toast === 'function') toast('พบข้อมูลบางส่วนอ่านไม่ได้ ระบบใช้ค่าปลอดภัยแทน', 'warn')
      }, 0)
    }
    return result.value
  },

  loadCollection(nameOrKey, fallback) {
    const entry = Object.entries(COLLECTIONS).find(([name, descriptor]) => name === nameOrKey || descriptor.key === nameOrKey)
    if (!entry) return fallback
    const [name, descriptor] = entry
    const value = Storage.load(descriptor.key)
    if (value !== null && value !== undefined) return value
    return fallback !== undefined ? cloneStorageDefault(fallback) : descriptor.defaultValue({ hasExistingPrimaryData:true, name })
  },

  isStateCollection(name) {
    return COLLECTIONS[name]?.state !== false
  },

  saveCollection(nameOrKey, value) {
    const entry = Object.entries(COLLECTIONS).find(([name, descriptor]) => name === nameOrKey || descriptor.key === nameOrKey)
    if (!entry) return false
    return Storage.save(entry[1].key, value)
  },

  save(key, data, _retried = false) {
    if (Storage.hydrationStatus?.recoveryMode && !Storage._recoveryWriteAuthorized) {
      Storage.lastSaveError = { key, message: 'recovery mode blocks implicit writes', at: new Date().toISOString() }
      return false
    }
    if (!Storage.isLocalStorageWritable()) {
      Storage.lastSaveError = { key, message: 'localStorage unavailable', at: new Date().toISOString() }
      setTimeout(() => {
        if (typeof toast === 'function') toast('อุปกรณ์นี้ไม่พร้อมบันทึก local storage กรุณาส่งออกข้อมูลสำรองไว้ก่อน', 'error')
      }, 0)
      return false
    }
    try {
      const payload = Storage._stringify(data)
      localStorage.setItem(key, payload)
      const readBack = localStorage.getItem(key)
      if (readBack !== payload) {
        Storage.lastSaveError = { key, message: 'readback mismatch after save', at: new Date().toISOString() }
        return false
      }
      if (Storage.lastSaveError?.key === key) Storage.lastSaveError = null
      if (Storage.lastVerifyError?.key === key) Storage.lastVerifyError = null
      return true
    } catch (e) {
      const isQuotaError = e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      // Local backup snapshots + the standalone pre-import backup each embed a full
      // dataset copy — they're the most likely reason routine saves start hitting
      // the quota. Free them once and retry before surfacing failure to the user.
      if (isQuotaError && !_retried && key !== LOCAL_BACKUP_KEY) {
        try { localStorage.removeItem('mt_pre_import_backup') } catch (_) {}
        const freed = Storage.pruneLocalBackups(1)
        if (freed) return Storage.save(key, data, true)
      }
      Storage.lastSaveError = { key, message: e?.message || 'save failed', at: new Date().toISOString() }
      const canToast = Date.now() - Number(Storage._lastStorageToastAt || 0) > 1200
      if (isQuotaError) {
        // Defer toast call — Storage may be loaded before App
        setTimeout(() => {
          if (canToast && typeof toast === 'function') {
            Storage._lastStorageToastAt = Date.now()
            toast('พื้นที่จัดเก็บเต็ม กรุณาส่งออกข้อมูลก่อนเพิ่มรายการใหม่', 'error')
          }
        }, 0)
      } else {
        setTimeout(() => {
          if (canToast && typeof toast === 'function') {
            Storage._lastStorageToastAt = Date.now()
            toast('บันทึกข้อมูลไม่สำเร็จ กรุณาส่งออกข้อมูลสำรองไว้ก่อน', 'error')
          }
        }, 0)
      }
      return false
    }
  },

  verifyKey(key, expectedData) {
    if (!Storage.isLocalStorageReadable()) {
      Storage.lastVerifyError = { key, message: 'localStorage unavailable', at: new Date().toISOString() }
      return false
    }
    try {
      const actualRaw = localStorage.getItem(key)
      const expectedRaw = Storage._stringify(expectedData)
      const ok = actualRaw === expectedRaw
      if (!ok) {
        Storage.lastVerifyError = { key, message: 'stored payload does not match expected data', at: new Date().toISOString() }
      } else if (Storage.lastVerifyError?.key === key) {
        Storage.lastVerifyError = null
      }
      return ok
    } catch (e) {
      Storage.lastVerifyError = { key, message: e?.message || 'verify failed', at: new Date().toISOString() }
      return false
    }
  },

  verifyState(state, keys = undefined) {
    // An explicit empty list is meaningful for dirty saves: the write loop has
    // already read back those keys, so do not silently fall back to unrelated
    // collections that may not exist on older or quota-constrained devices.
    const keyList = keys === undefined
      ? ['transactions', 'wallets', 'categories', 'settings', 'recurring', 'upcomingBills']
      : (Array.isArray(keys) ? keys : [keys])
    const failures = []
    keyList.forEach(name => {
      const storageKey = KEYS[name]
      if (!storageKey) return
      const expected = state?.[name]
      if (!Storage.verifyKey(storageKey, expected === undefined ? BACKUP_DEFAULTS[name] : expected)) {
        failures.push(name)
      }
    })
    return { ok: failures.length === 0, failures }
  },

  // Load all app data, seeding defaults on first run
  init() {
    // Stale one-shot backup keys that each duplicated the full dataset and were
    // never cleaned up, contributing to localStorage quota exhaustion:
    //   mt_pre_import_backup    — superseded by the createLocalBackup rotation
    //   mt_pre_migration_backup — one-time safety net for the statusNormV1 migration
    try { localStorage.removeItem('mt_pre_import_backup') } catch (_) {}
    try { localStorage.removeItem('mt_pre_migration_backup') } catch (_) {}
    Storage._installCrossTabSync()
    const meta = Storage._readStateMeta()
    Storage.stateRevision = meta.revision
    Storage.isStale = false
    Storage.lastConflict = null
    Storage._recoveryWriteAuthorized = false
    Storage.hydrationStatus = {
      recoveryMode: false,
      corruptCollections: [],
      quarantinedAt: null,
      quarantineKey: LOCAL_RECOVERY_QUARANTINE_KEY,
    }
    const data = {}
    const corruptEntries = []
    const hasExistingPrimaryData = typeof localStorage !== 'undefined' && [
      KEYS.transactions,
      KEYS.wallets,
      KEYS.categories,
      KEYS.settings,
    ].some(key => {
      try { return localStorage.getItem(key) !== null } catch (_) { return false }
    })
    Object.entries(COLLECTIONS).forEach(([name, descriptor]) => {
      if (descriptor.state === false) return
      const result = Storage._readRaw(descriptor.key)
      if (result.status === 'corrupt') corruptEntries.push({
        collection: name,
        key: descriptor.key,
        raw: result.raw,
        message: result.error?.message || 'JSON parse failed',
      })
      data[name] = result.status === 'valid'
        ? result.value
        : descriptor.defaultValue({ hasExistingPrimaryData, name })
    })
    if (corruptEntries.length) {
      const quarantinedAt = Storage._quarantineCorrupt(corruptEntries)
      Storage.hydrationStatus = {
        recoveryMode: true,
        corruptCollections: corruptEntries.map(entry => entry.collection),
        quarantinedAt,
        quarantineKey: LOCAL_RECOVERY_QUARANTINE_KEY,
      }
    }
    return data
  },

  saveAll(state, { dirtyKeys = undefined, _quotaRetried = false, _rollbackSnapshot = null } = {}) {
    if (!state || typeof state !== 'object') return false
    if (Storage.hydrationStatus?.recoveryMode && !Storage._recoveryWriteAuthorized) {
      Storage.lastSaveError = { key: '*', message: 'recovery mode blocks implicit state writes', at: new Date().toISOString() }
      return false
    }
    if (!Storage.isLocalStorageReadable()) {
      Storage.lastSaveError = { key: '*', message: 'localStorage unavailable', at: new Date().toISOString() }
      return false
    }

    const currentMeta = Storage._readStateMeta()
    const baselineRevision = Number(Storage.stateRevision || 0)
    if (Storage.isStale && currentMeta.revision === baselineRevision) {
      return Storage._rejectStaleSave(baselineRevision, currentMeta.revision)
    }
    if (currentMeta.revision !== baselineRevision) return Storage._rejectStaleSave(baselineRevision, currentMeta.revision)
    const lock = Storage._acquireStateLock()
    if (!lock) {
      Storage.lastSaveError = { key: LOCAL_STATE_LOCK_KEY, message: 'another tab is saving state', at: new Date().toISOString() }
      return false
    }
    const requestedNames = Array.isArray(dirtyKeys) && dirtyKeys.length
      ? new Set(dirtyKeys.map(name => {
          const entry = Object.entries(COLLECTIONS).find(([collectionName, descriptor]) => collectionName === name || descriptor.key === name)
          return entry?.[0] || String(name)
        }))
      : null
    const entries = Object.entries(COLLECTIONS).filter(([name, descriptor]) => {
      if (descriptor.state === false) return false
      return !requestedNames || requestedNames.has(name)
    })
    const previous = new Map()
    const serialized = new Map()
    const rollbackSnapshot = _rollbackSnapshot instanceof Map ? _rollbackSnapshot : previous
    const restoreSnapshot = snapshot => {
      const entries = [...snapshot].map(([key, raw]) => {
        let current = null
        try { current = localStorage.getItem(key) } catch (_) {}
        const currentSize = current === null || current === undefined ? 0 : String(current).length
        const targetSize = raw === null || raw === undefined ? 0 : String(raw).length
        return { key, raw, releasedBytes: currentSize - targetSize }
      }).sort((a, b) => b.releasedBytes - a.releasedBytes)
      entries.forEach(({ key, raw }) => {
        try {
          if (raw === null || raw === undefined) localStorage.removeItem(key)
          else localStorage.setItem(key, raw)
        } catch (_) {}
      })
    }
    let committed = false
    let saveError = null
    try {
      const lockedMeta = Storage._readStateMeta()
      if (lockedMeta.revision !== baselineRevision) return Storage._rejectStaleSave(baselineRevision, lockedMeta.revision)
      previous.set(LOCAL_STATE_META_KEY, localStorage.getItem(LOCAL_STATE_META_KEY))
      entries.forEach(([name, descriptor]) => {
        const value = state[name] !== undefined
          ? state[name]
          : descriptor.defaultValue({ hasExistingPrimaryData:true, name })
        previous.set(descriptor.key, localStorage.getItem(descriptor.key))
        serialized.set(descriptor.key, Storage._stringify(value))
      })
      for (const [key, payload] of serialized) {
        // The full snapshot remains available for verification and rollback.
        // Avoid synchronous storage writes for collections that did not change.
        if (previous.get(key) !== payload) localStorage.setItem(key, payload)
        if (localStorage.getItem(key) !== payload) throw new Error(`readback mismatch after save: ${key}`)
      }
      const requiredVerificationKeys = requestedNames
        ? ['transactions', 'wallets', 'settings', 'upcomingBills'].filter(name => requestedNames.has(name))
        : ['transactions', 'wallets', 'settings', 'upcomingBills']
      const verification = Storage.verifyState(state, requiredVerificationKeys)
      if (!verification.ok) throw new Error(`state verification failed: ${verification.failures.join(', ')}`)
      const nextMeta = {
        revision: baselineRevision + 1,
        writerId: Storage._writerId,
        savedAt: new Date().toISOString(),
      }
      localStorage.setItem(LOCAL_STATE_META_KEY, Storage._stringify(nextMeta))
      if (localStorage.getItem(LOCAL_STATE_META_KEY) !== Storage._stringify(nextMeta)) {
        throw new Error('state metadata readback mismatch after save')
      }
      committed = true
    } catch (e) {
      saveError = e
    } finally {
      if (!committed) {
        // Best-effort rollback restores the last coherent snapshot. Existing values
        // are never replaced by a partially-written state when one key fails.
        restoreSnapshot(rollbackSnapshot)
      }
      Storage._releaseStateLock(lock)
    }

    if (committed) {
      Storage.lastSaveError = null
      Storage.lastVerifyError = null
      Storage.lastConflict = null
      Storage.stateRevision = baselineRevision + 1
      Storage.isStale = false
      Storage._publishRevision(Storage.stateRevision)
      return true
    }

    const isQuotaError = saveError?.name === 'QuotaExceededError'
      || saveError?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    if (isQuotaError && !_quotaRetried) {
      let freedSpace = false
      try {
        if (localStorage.getItem('mt_pre_import_backup') !== null) {
          localStorage.removeItem('mt_pre_import_backup')
          freedSpace = true
        }
      } catch (_) {}
      if (Storage.pruneLocalBackups(1)) freedSpace = true
      if (freedSpace) {
        return Storage.saveAll(state, {
          dirtyKeys,
          _quotaRetried: true,
          _rollbackSnapshot: rollbackSnapshot,
        })
      }
    }

    Storage.lastSaveError = { key: '*', message: saveError?.message || 'save failed', at: new Date().toISOString() }
    return false
  },

  buildExportPayload(state, { preferState = false } = {}) {
    const payload = {
      backupSchemaVersion: BACKUP_SCHEMA_VERSION,
      source: 'money-tracker-v2',
      appVersion: state?.settings?.storageMeta?.appVersion || state?.appVersion || '',
      exportedAt: new Date().toISOString(),
    }
    BACKUP_SCHEMA_KEYS.forEach(key => {
      const fallback = BACKUP_DEFAULTS[key]
      const descriptor = COLLECTIONS[key]
      let value = state?.[key]
      if (!preferState && (descriptor.state === false || descriptor.preferStoredForBackup)) {
        value = Storage.load(descriptor.key)
        if (value === null) value = state?.[key]
      }
      payload[key] = value !== undefined && value !== null ? value : JSON.parse(JSON.stringify(fallback))
    })
    return payload
  },

  normalizeBackupPayload(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('ไฟล์สำรองข้อมูลไม่ถูกต้อง')
    Storage.lastNormalizationWarnings = []
    const backup = Storage._stripDangerousKeys({ ...raw })
    const schemaVersion = Number(backup.backupSchemaVersion || backup.version || 1)
    if (!Array.isArray(backup.transactions) || !Array.isArray(backup.wallets)) throw new Error('ไม่พบข้อมูลหลักของแอป')
    const normalized = {
      backupSchemaVersion: schemaVersion,
      source: backup.source || '',
      exportedAt: backup.exportedAt || '',
      appVersion: backup.appVersion || '',
    }
    BACKUP_SCHEMA_KEYS.forEach(key => {
      const fallback = BACKUP_DEFAULTS[key]
      const incoming = backup[key]

      // aiInsightStore is regenerated locally from transaction data — never import action.fn
      // from external backup files to prevent code injection via crafted backup files
      if (key === 'aiInsightStore') {
        const emptyStore = JSON.parse(JSON.stringify(fallback))
        const safeIncoming = Storage._normalizeImportedValue(incoming, key)
        if (safeIncoming && typeof safeIncoming === 'object' && !Array.isArray(safeIncoming)) {
          if (Array.isArray(safeIncoming.insights)) {
            emptyStore.insights = safeIncoming.insights
              .filter(i => i && typeof i === 'object' && typeof i.id === 'string')
              .map(i => Storage._stripExecutableFields(i))
          }
          if (Array.isArray(safeIncoming.hiddenTypes)) emptyStore.hiddenTypes = safeIncoming.hiddenTypes.filter(t => typeof t === 'string')
          if (Array.isArray(safeIncoming.feedback)) emptyStore.feedback = safeIncoming.feedback.filter(f => f && typeof f === 'object')
          if (typeof safeIncoming.version === 'number') emptyStore.version = safeIncoming.version
        }
        normalized[key] = emptyStore
        return
      }

      if (key === 'splitBillDraft') {
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
          normalized[key] = null
          return
        }
        const draft = Storage._normalizeImportedValue(incoming, key)
        if (Array.isArray(draft.items)) draft.items = Storage._normalizeImportedArray(draft.items, `${key}.items`).filter(item => item && typeof item === 'object' && !Array.isArray(item))
        if (Array.isArray(draft.peopleIds)) draft.peopleIds = draft.peopleIds.filter(id => typeof id === 'string' || typeof id === 'number').map(String)
        if (Array.isArray(draft.pipeline)) draft.pipeline = draft.pipeline.filter(step => step && typeof step === 'object' && !Array.isArray(step))
        if (!draft.payments || typeof draft.payments !== 'object' || Array.isArray(draft.payments)) draft.payments = {}
        normalized[key] = draft
        return
      }

      if (key === 'splitBills' || key === 'splitPeople') {
        normalized[key] = Storage._normalizeImportedArray(incoming, key)
          ?.filter(row => row && typeof row === 'object' && !Array.isArray(row)) || []
        return
      }

      if (incoming === undefined || incoming === null) {
        normalized[key] = JSON.parse(JSON.stringify(fallback))
      } else if (Array.isArray(fallback)) {
        normalized[key] = Array.isArray(incoming)
          ? Storage._normalizeImportedArray(incoming, key)
          : JSON.parse(JSON.stringify(fallback))
      } else if (typeof fallback === 'object') {
        normalized[key] = typeof incoming === 'object' && !Array.isArray(incoming)
          ? Storage._normalizeImportedValue({ ...JSON.parse(JSON.stringify(fallback)), ...incoming }, key)
          : JSON.parse(JSON.stringify(fallback))
      } else {
        normalized[key] = incoming
      }
    })
    return normalized
  },

  exportJSON(state, filename = '', options = {}) {
    const data = Storage.buildExportPayload(state, options)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    return Storage.triggerDownload(blob, filename || `backup-${(typeof getTODAY === 'function' ? getTODAY() : TODAY)}.json`)
  },

  createLocalBackup(state, reason = 'manual') {
    try {
      const snapshot = {
        id: `backup-${Date.now()}`,
        reason,
        createdAt: new Date().toISOString(),
        payload: Storage.buildExportPayload(state),
      }
      let rows = []
      try { rows = JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY) || '[]') } catch (_) { rows = [] }
      rows = [snapshot, ...(Array.isArray(rows) ? rows : [])].slice(0, LOCAL_BACKUP_LIMIT)
      try {
        localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(rows))
      } catch (e) {
        rows = rows.slice(0, 2)
        localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(rows))
      }
      return snapshot
    } catch (e) {
      Storage.lastSaveError = { key: LOCAL_BACKUP_KEY, message: e?.message || 'backup failed', at: new Date().toISOString() }
      setTimeout(() => {
        if (typeof toast === 'function') toast('สร้าง backup อัตโนมัติไม่สำเร็จ กรุณาส่งออก JSON เองก่อนทำรายการเสี่ยง', 'warn')
      }, 0)
      return null
    }
  },

  getLatestLocalBackup(reasons = null) {
    let rows = []
    try { rows = JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY) || '[]') } catch (_) { rows = [] }
    if (!Array.isArray(rows)) return null
    const match = reasons ? rows.find(r => reasons.includes(r?.reason)) : rows[0]
    return match || null
  },

  // Frees space by dropping older local backup snapshots. Each snapshot embeds
  // a full copy of the dataset, so the rotating array (LOCAL_BACKUP_LIMIT) can
  // itself be a major contributor to hitting the localStorage quota.
  pruneLocalBackups(keep = 1) {
    try {
      let rows = []
      try { rows = JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY) || '[]') } catch (_) { rows = [] }
      if (!Array.isArray(rows) || rows.length <= keep) return false
      localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(rows.slice(0, keep)))
      return true
    } catch (_) {
      try { localStorage.removeItem(LOCAL_BACKUP_KEY) } catch (_) {}
      return true
    }
  },

  // Byte size of every key this app owns in localStorage, sorted largest first.
  // Lets the UI show the user what's actually consuming their quota instead of
  // guessing, and drives the emergency "free up space" action.
  getUsageReport() {
    const rows = []
    let total = 0
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key === null) continue
        const value = localStorage.getItem(key) || ''
        const bytes = key.length + value.length
        total += bytes
        rows.push({ key, bytes })
      }
    } catch (_) {}
    rows.sort((a, b) => b.bytes - a.bytes)
    return { totalBytes: total, rows }
  },

  // Emergency relief when the quota is already full: drops every rotating local
  // backup snapshot (each one embeds a full dataset copy) plus any leftover
  // one-off backup keys. Does NOT touch live app data (transactions, wallets, etc).
  freeUpEmergencySpace() {
    let freedKeys = []
    try {
      if (localStorage.getItem(LOCAL_BACKUP_KEY) !== null) { localStorage.removeItem(LOCAL_BACKUP_KEY); freedKeys.push(LOCAL_BACKUP_KEY) }
      if (localStorage.getItem('mt_pre_import_backup') !== null) { localStorage.removeItem('mt_pre_import_backup'); freedKeys.push('mt_pre_import_backup') }
      if (localStorage.getItem('mt_boot_last_log') !== null) { localStorage.removeItem('mt_boot_last_log'); freedKeys.push('mt_boot_last_log') }
    } catch (_) {}
    return freedKeys
  },

  importJSON(file, onSuccess, onError) {
    if (!file) { onError('ไม่พบไฟล์'); return }
    if (file.size > 10 * 1024 * 1024) { onError('ไฟล์ backup ต้องมีขนาดไม่เกิน 10MB'); return }
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result)
        onSuccess(Storage.normalizeBackupPayload(data))
      } catch (err) {
        onError(err.message)
      }
    }
    reader.readAsText(file)
  },

  reset({ allowRecovery = false } = {}) {
    if (Storage.hydrationStatus?.recoveryMode && !allowRecovery) return false
    Object.values(KEYS).forEach(k => {
      try { localStorage.removeItem(k) } catch (_) {}
    })
    try { localStorage.removeItem(LOCAL_STATE_META_KEY) } catch (_) {}
    try { localStorage.removeItem(LOCAL_STATE_LOCK_KEY) } catch (_) {}
    try { localStorage.removeItem(LOCAL_BACKUP_KEY) } catch (_) {}
    try { localStorage.removeItem('mt_pre_import_backup') } catch (_) {}
    try { localStorage.removeItem('mt_pre_migration_backup') } catch (_) {}
    Storage.stateRevision = 0
    Storage.isStale = false
    Storage.lastConflict = null
    Storage._recoveryWriteAuthorized = false
    Storage.hydrationStatus = {
      ...Storage.hydrationStatus,
      recoveryMode: false,
      corruptCollections: [],
    }
    return true
  },
}

if (typeof window !== 'undefined') window.MTStorage = Storage
if (typeof module !== 'undefined' && module.exports) module.exports = Storage
