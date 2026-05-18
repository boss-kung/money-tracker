const KEYS = {
  transactions:        'mt_transactions',
  wallets:             'mt_wallets',
  categories:          'mt_categories',
  budgets:             'mt_budgets',
  settings:            'mt_settings',
  recurring:           'mt_recurring',
  upcomingBills:       'mt_upcoming_bills',
  merchants:           'mt_merchants',
  ccBenefits:          'mt_cc_benefits',
  ccBenefitRules:      'mt_cc_benefit_rules',
  incomeBudgets:       'mt_income_budgets',
  marketPrices:        'mt_market_prices',
  rewardLedger:        'mt_reward_ledger',
  netWorthSnapshots:   'mt_net_worth_snapshots',
  investmentSnapshots: 'mt_investment_snapshots',
  creditLimitGroups:   'mt_credit_limit_groups',
  rewardAccounts:      'mt_reward_accounts',
  cryptoAssets:        'mt_crypto_assets',
  cryptoHoldings:      'mt_crypto_holdings',
  cryptoTransactions:  'mt_crypto_transactions',
  cryptoSyncMeta:      'mt_crypto_sync_meta',
  goals:               'mt_goals',
  privileges:          'mt_privileges',
  creditCardPromoSearches: 'mt_credit_card_promo_searches',
  creditCardPromotions:    'mt_credit_card_promotions',
  splitBills:          'mt_split_bills',
  splitPeople:         'mt_split_people',
  splitBillDraft:      'mt_split_bill_draft',
  migrations:          'mt_migrations',
  aiInsightStore:      'mt_ai_insight_store',
  financialMemory:     'mt_financial_memory',
  monthlyFinancialFeatures: 'mt_monthly_financial_features',
  financialRecommendationFeedback: 'mt_financial_recommendation_feedback',
}

const BACKUP_SCHEMA_VERSION = 3
const LOCAL_BACKUP_KEY = 'mt_local_backup_snapshots'
const LOCAL_BACKUP_LIMIT = 5
const BACKUP_SCHEMA_KEYS = [
  'transactions',
  'wallets',
  'categories',
  'budgets',
  'incomeBudgets',
  'recurring',
  'upcomingBills',
  'merchants',
  'ccBenefits',
  'ccBenefitRules',
  'creditLimitGroups',
  'rewardAccounts',
  'rewardLedger',
  'marketPrices',
  'netWorthSnapshots',
  'investmentSnapshots',
  'cryptoAssets',
  'cryptoHoldings',
  'cryptoTransactions',
  'cryptoSyncMeta',
  'goals',
  'privileges',
  'creditCardPromoSearches',
  'creditCardPromotions',
  'splitBills',
  'splitPeople',
  'splitBillDraft',
  'migrations',
  'settings',
  'aiInsightStore',
  'financialMemory',
  'monthlyFinancialFeatures',
  'financialRecommendationFeedback',
]

const BACKUP_DEFAULTS = {
  transactions: [],
  wallets: [],
  categories: { expense: [], income: [] },
  budgets: [],
  incomeBudgets: [],
  recurring: [],
  upcomingBills: [],
  merchants: [],
  ccBenefits: {},
  ccBenefitRules: [],
  creditLimitGroups: [],
  rewardAccounts: [],
  rewardLedger: [],
  marketPrices: {},
  netWorthSnapshots: [],
  investmentSnapshots: [],
  cryptoAssets: [],
  cryptoHoldings: [],
  cryptoTransactions: [],
  cryptoSyncMeta: {},
  goals: [],
  privileges: [],
  creditCardPromoSearches: [],
  creditCardPromotions: [],
  splitBills: [],
  splitPeople: [],
  splitBillDraft: null,
  migrations: { cryptoCentralizedV1: false },
  settings: {},
  aiInsightStore: { version: 1, lastRefreshed: null, payloadHash: '', insights: [], hiddenTypes: [], feedback: [] },
  financialMemory: [],
  monthlyFinancialFeatures: [],
  financialRecommendationFeedback: [],
}

const Storage = {
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

  save(key, data) {
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
      Storage.lastSaveError = { key, message: e?.message || 'save failed', at: new Date().toISOString() }
      const canToast = Date.now() - Number(Storage._lastStorageToastAt || 0) > 1200
      if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
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
    const data = {}
    const hasExistingPrimaryData = typeof localStorage !== 'undefined' && [
      KEYS.transactions,
      KEYS.wallets,
      KEYS.categories,
      KEYS.settings,
    ].some(key => localStorage.getItem(key) !== null)
    data.transactions  = Storage.load(KEYS.transactions)  || JSON.parse(JSON.stringify(DEFAULT_TRANSACTIONS))
    data.wallets       = Storage.load(KEYS.wallets)        || JSON.parse(JSON.stringify(DEFAULT_WALLETS))
    data.categories    = Storage.load(KEYS.categories)     || JSON.parse(JSON.stringify(DEFAULT_CATEGORIES))
    data.budgets       = Storage.load(KEYS.budgets)        || JSON.parse(JSON.stringify(DEFAULT_BUDGETS))
    data.settings      = Storage.load(KEYS.settings)       || JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
    data.recurring     = Storage.load(KEYS.recurring)      || JSON.parse(JSON.stringify(DEFAULT_RECURRING))
    data.upcomingBills = Storage.load(KEYS.upcomingBills)  || JSON.parse(JSON.stringify(typeof DEFAULT_UPCOMING_BILLS !== 'undefined' ? DEFAULT_UPCOMING_BILLS : []))
    data.merchants     = Storage.load(KEYS.merchants)      || JSON.parse(JSON.stringify(DEFAULT_MERCHANTS))
    data.ccBenefits    = Storage.load(KEYS.ccBenefits)     || JSON.parse(JSON.stringify(typeof DEFAULT_CC_BENEFITS !== 'undefined' ? DEFAULT_CC_BENEFITS : {}))
    data.ccBenefitRules = Storage.load(KEYS.ccBenefitRules) || []
    data.incomeBudgets       = Storage.load(KEYS.incomeBudgets)       || JSON.parse(JSON.stringify(typeof DEFAULT_INCOME_BUDGETS !== 'undefined' ? DEFAULT_INCOME_BUDGETS : []))
    data.marketPrices        = Storage.load(KEYS.marketPrices)        || {}
    data.rewardLedger        = Storage.load(KEYS.rewardLedger)        || []
    data.netWorthSnapshots   = Storage.load(KEYS.netWorthSnapshots)   || []
    data.investmentSnapshots = Storage.load(KEYS.investmentSnapshots) || []
    data.creditLimitGroups   = Storage.load(KEYS.creditLimitGroups)   || []
    data.rewardAccounts      = Storage.load(KEYS.rewardAccounts)      || []
    data.cryptoAssets        = Storage.load(KEYS.cryptoAssets)        || JSON.parse(JSON.stringify(typeof DEFAULT_CRYPTO_ASSETS !== 'undefined' ? DEFAULT_CRYPTO_ASSETS : []))
    data.cryptoHoldings      = Storage.load(KEYS.cryptoHoldings)      || JSON.parse(JSON.stringify(typeof DEFAULT_CRYPTO_HOLDINGS !== 'undefined' ? DEFAULT_CRYPTO_HOLDINGS : []))
    data.cryptoTransactions  = Storage.load(KEYS.cryptoTransactions)  || JSON.parse(JSON.stringify(typeof DEFAULT_CRYPTO_TRANSACTIONS !== 'undefined' ? DEFAULT_CRYPTO_TRANSACTIONS : []))
    data.cryptoSyncMeta      = Storage.load(KEYS.cryptoSyncMeta)      || {}
    data.goals               = Storage.load(KEYS.goals)               || JSON.parse(JSON.stringify(typeof DEFAULT_GOALS !== 'undefined' ? DEFAULT_GOALS : []))
    data.creditCardPromoSearches = Storage.load(KEYS.creditCardPromoSearches) || []
    data.creditCardPromotions    = Storage.load(KEYS.creditCardPromotions)    || []
    data.splitBills              = Storage.load(KEYS.splitBills)              || []
    data.splitPeople             = Storage.load(KEYS.splitPeople)             || []
    data.splitBillDraft          = Storage.load(KEYS.splitBillDraft)          || null
    const loadedPrivileges   = Storage.load(KEYS.privileges)
    data.privileges          = loadedPrivileges || JSON.parse(JSON.stringify(
      typeof DEFAULT_PRIVILEGES !== 'undefined'
        ? (hasExistingPrimaryData ? [] : DEFAULT_PRIVILEGES)
        : []
    ))
    data.migrations          = Storage.load(KEYS.migrations)          || JSON.parse(JSON.stringify(typeof DEFAULT_MIGRATIONS !== 'undefined' ? DEFAULT_MIGRATIONS : { cryptoCentralizedV1: false }))
    return data
  },

  saveAll(state) {
    const results = [
      Storage.save(KEYS.transactions,  state.transactions),
      Storage.save(KEYS.wallets,       state.wallets),
      Storage.save(KEYS.categories,    state.categories),
      Storage.save(KEYS.budgets,       state.budgets),
      Storage.save(KEYS.settings,      state.settings),
      Storage.save(KEYS.recurring,     state.recurring),
      Storage.save(KEYS.upcomingBills, state.upcomingBills || []),
      Storage.save(KEYS.merchants,     state.merchants),
      Storage.save(KEYS.ccBenefits,    state.ccBenefits),
      Storage.save(KEYS.ccBenefitRules, state.ccBenefitRules || []),
      Storage.save(KEYS.incomeBudgets,       state.incomeBudgets),
      Storage.save(KEYS.marketPrices,        state.marketPrices        || {}),
      Storage.save(KEYS.rewardLedger,        state.rewardLedger        || []),
      Storage.save(KEYS.netWorthSnapshots,   state.netWorthSnapshots   || []),
      Storage.save(KEYS.investmentSnapshots, state.investmentSnapshots || []),
      Storage.save(KEYS.creditLimitGroups,   state.creditLimitGroups   || []),
      Storage.save(KEYS.rewardAccounts,      state.rewardAccounts      || []),
      Storage.save(KEYS.cryptoAssets,        state.cryptoAssets        || []),
      Storage.save(KEYS.cryptoHoldings,      state.cryptoHoldings      || []),
      Storage.save(KEYS.cryptoTransactions,  state.cryptoTransactions  || []),
      Storage.save(KEYS.cryptoSyncMeta,      state.cryptoSyncMeta      || {}),
      Storage.save(KEYS.goals,               state.goals               || []),
      Storage.save(KEYS.privileges,          state.privileges          || []),
      Storage.save(KEYS.creditCardPromoSearches, state.creditCardPromoSearches || []),
      Storage.save(KEYS.creditCardPromotions,    state.creditCardPromotions    || []),
      Storage.save(KEYS.splitBills,              state.splitBills              || []),
      Storage.save(KEYS.splitPeople,             state.splitPeople             || []),
      Storage.save(KEYS.splitBillDraft,          state.splitBillDraft          || null),
      Storage.save(KEYS.migrations,          state.migrations          || { cryptoCentralizedV1: false }),
    ]
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
      let value = state?.[key]
      if (['splitBills', 'splitPeople', 'splitBillDraft'].includes(key)) {
        value = Storage.load(KEYS[key])
        if (value === null) value = state?.[key]
      }
      if (value === undefined && key === 'aiInsightStore') {
        try { value = JSON.parse(localStorage.getItem(KEYS.aiInsightStore) || 'null') } catch (_) { value = null }
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
