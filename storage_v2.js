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
const BACKUP_SCHEMA_KEYS = Object.freeze(Object.keys(COLLECTIONS))
const BACKUP_DEFAULTS = Object.freeze(Object.fromEntries(BACKUP_SCHEMA_KEYS.map(name => [name, COLLECTIONS[name].defaultValue({ hasExistingPrimaryData:true })])))

const Storage = {
  collectionNames: BACKUP_SCHEMA_KEYS,
  lastLoadError: null,
  lastSaveError: null,
  lastVerifyError: null,
  _lastStorageToastAt: 0,

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

  isLocalStorageAvailable() {
    try {
      if (typeof localStorage === 'undefined') return false
      const probeKey = '__mt_storage_probe__'
      localStorage.setItem(probeKey, '1')
      const ok = localStorage.getItem(probeKey) === '1'
      localStorage.removeItem(probeKey)
      return ok
    } catch (_) {
      return false
    }
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
    if (!Storage.isLocalStorageAvailable()) {
      Storage.lastLoadError = { key, message: 'localStorage unavailable', at: new Date().toISOString() }
      return null
    }
    try { return JSON.parse(localStorage.getItem(key)) } catch (e) {
      Storage.lastLoadError = { key, message: e?.message || 'JSON parse failed', at: new Date().toISOString() }
      setTimeout(() => {
        if (typeof toast === 'function') toast('พบข้อมูลบางส่วนอ่านไม่ได้ ระบบใช้ค่าปลอดภัยแทน', 'warn')
      }, 0)
      return null
    }
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
    if (!Storage.isLocalStorageAvailable()) {
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
    if (!Storage.isLocalStorageAvailable()) {
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

  verifyState(state, keys = []) {
    const keyList = Array.isArray(keys) && keys.length
      ? keys
      : ['transactions', 'wallets', 'categories', 'settings', 'recurring', 'upcomingBills']
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
    const data = {}
    const hasExistingPrimaryData = typeof localStorage !== 'undefined' && [
      KEYS.transactions,
      KEYS.wallets,
      KEYS.categories,
      KEYS.settings,
    ].some(key => localStorage.getItem(key) !== null)
    Object.entries(COLLECTIONS).forEach(([name, descriptor]) => {
      if (descriptor.state === false) return
      const loaded = Storage.load(descriptor.key)
      data[name] = loaded !== null && loaded !== undefined
        ? loaded
        : descriptor.defaultValue({ hasExistingPrimaryData, name })
    })
    return data
  },

  saveAll(state) {
    if (!state || typeof state !== 'object') return false
    const results = Object.entries(COLLECTIONS)
      .filter(([, descriptor]) => descriptor.state !== false)
      .map(([name, descriptor]) => {
        const value = state[name] !== undefined
          ? state[name]
          : descriptor.defaultValue({ hasExistingPrimaryData:true, name })
        return Storage.save(descriptor.key, value)
      })
    if (!results.every(Boolean)) return false
    const verification = Storage.verifyState(state, ['transactions', 'wallets', 'settings', 'upcomingBills'])
    return verification.ok
  },

  buildExportPayload(state) {
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
      if (descriptor.state === false || descriptor.preferStoredForBackup) {
        value = Storage.load(descriptor.key)
        if (value === null) value = state?.[key]
      }
      payload[key] = value !== undefined && value !== null ? value : JSON.parse(JSON.stringify(fallback))
    })
    return payload
  },

  normalizeBackupPayload(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('ไฟล์สำรองข้อมูลไม่ถูกต้อง')
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
        if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
          if (Array.isArray(incoming.insights)) {
            emptyStore.insights = incoming.insights
              .filter(i => i && typeof i === 'object' && typeof i.id === 'string')
              .map(({ action: _action, ...safe }) => safe)
          }
          if (Array.isArray(incoming.hiddenTypes)) emptyStore.hiddenTypes = incoming.hiddenTypes.filter(t => typeof t === 'string')
          if (Array.isArray(incoming.feedback)) emptyStore.feedback = incoming.feedback.filter(f => f && typeof f === 'object')
          if (typeof incoming.version === 'number') emptyStore.version = incoming.version
        }
        normalized[key] = emptyStore
        return
      }

      if (key === 'splitBillDraft') {
        normalized[key] = incoming && typeof incoming === 'object' && !Array.isArray(incoming)
          ? incoming
          : null
        return
      }

      if (incoming === undefined || incoming === null) {
        normalized[key] = JSON.parse(JSON.stringify(fallback))
      } else if (Array.isArray(fallback)) {
        normalized[key] = Array.isArray(incoming) ? incoming : JSON.parse(JSON.stringify(fallback))
      } else if (typeof fallback === 'object') {
        normalized[key] = typeof incoming === 'object' && !Array.isArray(incoming)
          ? { ...JSON.parse(JSON.stringify(fallback)), ...incoming }
          : JSON.parse(JSON.stringify(fallback))
      } else {
        normalized[key] = incoming
      }
    })
    return normalized
  },

  exportJSON(state, filename = '') {
    const data = Storage.buildExportPayload(state)
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

  reset() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k))
  },
}

if (typeof window !== 'undefined') window.MTStorage = Storage
if (typeof module !== 'undefined' && module.exports) module.exports = Storage
