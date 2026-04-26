const KEYS = {
  transactions:  'mt_transactions',
  wallets:       'mt_wallets',
  categories:    'mt_categories',
  budgets:       'mt_budgets',
  settings:      'mt_settings',
  recurring:     'mt_recurring',
  merchants:     'mt_merchants',
  ccBenefits:    'mt_cc_benefits',
  incomeBudgets: 'mt_income_budgets',
  marketPrices:  'mt_market_prices',
}

const Storage = {
  load(key) {
    try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
  },

  save(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data))
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        // Defer toast call — Storage may be loaded before App
        setTimeout(() => {
          if (typeof toast === 'function') toast('พื้นที่จัดเก็บเต็ม กรุณาส่งออกข้อมูลก่อนเพิ่มรายการใหม่', 'error')
        }, 0)
      } else {
        throw e
      }
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
    data.incomeBudgets = Storage.load(KEYS.incomeBudgets)  || JSON.parse(JSON.stringify(typeof DEFAULT_INCOME_BUDGETS !== 'undefined' ? DEFAULT_INCOME_BUDGETS : []))
    data.marketPrices  = Storage.load(KEYS.marketPrices) || {}
    return data
  },

  saveAll(state) {
    Storage.save(KEYS.transactions,  state.transactions)
    Storage.save(KEYS.wallets,       state.wallets)
    Storage.save(KEYS.categories,    state.categories)
    Storage.save(KEYS.budgets,       state.budgets)
    Storage.save(KEYS.settings,      state.settings)
    Storage.save(KEYS.recurring,     state.recurring)
    Storage.save(KEYS.merchants,     state.merchants)
    Storage.save(KEYS.ccBenefits,    state.ccBenefits)
    Storage.save(KEYS.incomeBudgets, state.incomeBudgets)
    Storage.save(KEYS.marketPrices, state.marketPrices || {})
  },

  exportJSON(state) {
    const data = {
      exportedAt: new Date().toISOString(),
      version: 2,
      transactions:  state.transactions,
      wallets:       state.wallets,
      categories:    state.categories,
      budgets:       state.budgets,
      recurring:     state.recurring,
      merchants:     state.merchants,
      ccBenefits:    state.ccBenefits,
      incomeBudgets: state.incomeBudgets,
      marketPrices: state.marketPrices || {},
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `money-tracker-${TODAY}.json`
    a.click()
    URL.revokeObjectURL(url)
  },

  importJSON(file, onSuccess, onError) {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result)
        if (!data.transactions || !data.wallets) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง')
        onSuccess(data)
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
