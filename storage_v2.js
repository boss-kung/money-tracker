const KEYS = {
  transactions:        'mt_transactions',
  wallets:             'mt_wallets',
  categories:          'mt_categories',
  budgets:             'mt_budgets',
  settings:            'mt_settings',
  recurring:           'mt_recurring',
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
  migrations:          'mt_migrations',
}

const BACKUP_SCHEMA_VERSION = 2
const LOCAL_BACKUP_KEY = 'mt_local_backup_snapshots'
const LOCAL_BACKUP_LIMIT = 5
const BACKUP_SCHEMA_KEYS = [
  'transactions',
  'wallets',
  'categories',
  'budgets',
  'incomeBudgets',
  'recurring',
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
  'migrations',
  'settings',
]

const BACKUP_DEFAULTS = {
  transactions: [],
  wallets: [],
  categories: { expense: [], income: [] },
  budgets: [],
  incomeBudgets: [],
  recurring: [],
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
  migrations: { cryptoCentralizedV1: false },
  settings: {},
}

const Storage = {
  lastLoadError: null,
  lastSaveError: null,
  _lastStorageToastAt: 0,

  load(key) {
    try { return JSON.parse(localStorage.getItem(key)) } catch (e) {
      Storage.lastLoadError = { key, message: e?.message || 'JSON parse failed', at: new Date().toISOString() }
      setTimeout(() => {
        if (typeof toast === 'function') toast('พบข้อมูลบางส่วนอ่านไม่ได้ ระบบใช้ค่าปลอดภัยแทน', 'warn')
      }, 0)
      return null
    }
  },

  save(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data))
      if (Storage.lastSaveError?.key === key) Storage.lastSaveError = null
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

  // Load all app data, seeding defaults on first run
  init() {
    const data = {}
    data.transactions  = Storage.load(KEYS.transactions)  || JSON.parse(JSON.stringify(DEFAULT_TRANSACTIONS))
    data.wallets       = Storage.load(KEYS.wallets)        || JSON.parse(JSON.stringify(DEFAULT_WALLETS))
    data.categories    = Storage.load(KEYS.categories)     || JSON.parse(JSON.stringify(DEFAULT_CATEGORIES))
    data.budgets       = Storage.load(KEYS.budgets)        || JSON.parse(JSON.stringify(DEFAULT_BUDGETS))
    data.settings      = Storage.load(KEYS.settings)       || JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
    data.recurring     = Storage.load(KEYS.recurring)      || JSON.parse(JSON.stringify(DEFAULT_RECURRING))
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
      Storage.save(KEYS.migrations,          state.migrations          || { cryptoCentralizedV1: false }),
    ]
    return results.every(Boolean)
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
      const value = state?.[key]
      payload[key] = value !== undefined ? value : JSON.parse(JSON.stringify(fallback))
    })
    return payload
  },

  normalizeBackupPayload(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('ไฟล์สำรองข้อมูลไม่ถูกต้อง')
    const backup = { ...raw }
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

  exportJSON(state) {
    const data = Storage.buildExportPayload(state)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `money-tracker-${(typeof getTODAY === 'function' ? getTODAY() : TODAY)}.json`
    a.click()
    URL.revokeObjectURL(url)
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
