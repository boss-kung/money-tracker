const Calc = {
  // ── Formatting ──────────────────────────────────────────────
  fmt(n) {
    const val = Math.abs(Number(n) || 0)
    const isWhole = val === Math.floor(val)
    return '฿' + val.toLocaleString('en-US', { minimumFractionDigits: isWhole ? 0 : 2, maximumFractionDigits: 2 })
  },

  fmtNum(n) {
    const val = Math.abs(Number(n) || 0)
    const isWhole = val === Math.floor(val)
    return val.toLocaleString('en-US', { minimumFractionDigits: isWhole ? 0 : 2, maximumFractionDigits: 2 })
  },

  fmtSigned(n, type) {
    if (type === 'income')     return '+' + Calc.fmt(n)
    if (type === 'expense')    return '-' + Calc.fmt(n)
    if (type === 'cc_payment') return '-' + Calc.fmt(n)
    return Calc.fmt(n)
  },

  monthLabel(ym) {
    if (!ym) return ''
    const [y, m] = ym.split('-').map(Number)
    const names = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
    return `${names[m - 1]} ${y + 543}`
  },

  labelDate(dateStr) {
    if (!dateStr) return ''
    const today = (typeof getTODAY === 'function') ? getTODAY() : TODAY
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`
    if (dateStr === today)  return 'วันนี้'
    if (dateStr === yStr)   return 'เมื่อวาน'
    const [y, m, d] = dateStr.split('-').map(Number)
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
    return `${d} ${months[m - 1]} ${y + 543}`
  },

  shortDate(dateStr) {
    if (!dateStr) return ''
    const [, m, d] = dateStr.split('-').map(Number)
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
    return `${d} ${months[m - 1]}`
  },

  fmtAssetUnits(n, decimals = 8) {
    const value = Number(n || 0)
    if (!Number.isFinite(value)) return '0'
    if (value === 0) return '0'
    const abs = Math.abs(value)
    const maxDigits = Math.min(8, Math.max(0, Number(decimals || 8)))
    const minDigits = abs > 0 && abs < 1 ? Math.min(maxDigits, 8) : 0
    return value.toLocaleString('en-US', {
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    }).replace(/\.?0+$/, '')
  },

  clampDay(year, monthIndex, day) {
    const last = new Date(year, Number(monthIndex || 0) + 1, 0).getDate()
    return Math.max(1, Math.min(Number(day) || 1, last))
  },

  getCreditCardDueDate(statementEndDate, dueAfterCycleDays = 10) {
    const [y, m, d] = String(statementEndDate || '').split('-').map(Number)
    if (!y || !m || !d) return ''
    const end = new Date(y, m - 1, d)
    end.setDate(end.getDate() + Math.max(1, Number(dueAfterCycleDays || 10)))
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
  },

  getDaysUntilDate(dateStr, refDate = null) {
    const [y, m, d] = String(dateStr || '').split('-').map(Number)
    if (!y || !m || !d) return { daysLeft: 0, dueStr: '' }
    const due = new Date(y, m - 1, d)
    const base = refDate ? new Date(refDate) : new Date()
    const today = new Date(base.getFullYear(), base.getMonth(), base.getDate())
    const dueDate = new Date(due.getFullYear(), due.getMonth(), due.getDate())
    const daysLeft = Math.ceil((dueDate - today) / 86400000)
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
    return { daysLeft, dueStr: `${dueDate.getDate()} ${months[dueDate.getMonth()]}`, dateStr: `${dueDate.getFullYear()}-${String(dueDate.getMonth()+1).padStart(2,'0')}-${String(dueDate.getDate()).padStart(2,'0')}` }
  },

  // Last n months as 'YYYY-MM' strings (newest first)
  getMonths(n = 6) {
    const months = []
    const d = new Date()
    for (let i = 0; i < n; i++) {
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      d.setMonth(d.getMonth() - 1)
    }
    return months
  },

  // Due date info for credit cards
  getDueDate(dueDay) {
    const now = new Date()
    const due = new Date(now.getFullYear(), now.getMonth(), Number(dueDay || now.getDate()))
    if (due < now) due.setMonth(due.getMonth() + 1)
    return Calc.getDaysUntilDate(`${due.getFullYear()}-${String(due.getMonth()+1).padStart(2,'0')}-${String(due.getDate()).padStart(2,'0')}`)
  },

  genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2)
  },

  todayLocalISO() {
    if (typeof getTODAY === 'function') return getTODAY()
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  },

  daysUntilDate(dateStr, refDate = null) {
    const [y, m, d] = String(dateStr || '').split('-').map(Number)
    const [ry, rm, rd] = String(refDate || Calc.todayLocalISO()).split('-').map(Number)
    if (!y || !m || !d || !ry || !rm || !rd) return 0
    const target = new Date(y, m - 1, d)
    const base = new Date(ry, rm - 1, rd)
    return Math.round((target - base) / 86400000)
  },

  // ── Business logic ──────────────────────────────────────────

  // Returns true for transactions that have actually been posted (not future-scheduled).
  // Transactions with scheduled !== true are always posted (backward-compatible with
  // existing data that has no scheduled field).
  // A scheduled transaction whose date has arrived is also treated as posted.
  isPostedTx(t) {
    if (!t || t.scheduled !== true) return true
    const todayStr = (typeof getTODAY === 'function' ? getTODAY() : new Date().toISOString().slice(0, 10))
    return String(t.date || '') <= todayStr
  },

  getExpenseLedgerAmount(t) {
    if (!t) return 0
    if (t.type !== 'expense') return Number(t.amount || 0)
    try {
      if (typeof App !== 'undefined' && typeof App.getLedgerAmountForTx === 'function') {
        return Number(App.getLedgerAmountForTx(t) || 0)
      }
    } catch (_) {}
    if ('ledgerAmount' in t && Number.isFinite(Number(t.ledgerAmount))) {
      return Number(t.ledgerAmount || 0)
    }
    return Number(t.amount || 0)
  },

  getPostedTransactions(transactions) {
    return (transactions || []).filter(t => Calc.isPostedTx(t))
  },

  getPreviousMonth(month) {
    const [y, m] = String(month || '').split('-').map(Number)
    if (!y || !m) return ''
    const dt = new Date(y, m - 2, 1)
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
  },

  getMonthlyTransactions(transactions, month, opts = {}) {
    const { types = null, includeScheduled = false } = opts
    const allowed = Array.isArray(types) ? new Set(types) : null
    return (transactions || []).filter(t => {
      if (!t || !String(t.date || '').startsWith(month)) return false
      if (!includeScheduled && !Calc.isPostedTx(t)) return false
      if (allowed && !allowed.has(t.type)) return false
      return true
    })
  },

  getMonthlyIncomeExpense(transactions, month) {
    const txns = Calc.getMonthlyTransactions(transactions, month)
    let income = 0
    let expense = 0
    let transfer = 0
    let ccPayment = 0
    txns.forEach(t => {
      if (t.type === 'income') income += Number(t.amount || 0)
      else if (t.type === 'expense') expense += Calc.getExpenseLedgerAmount(t)
      else if (t.type === 'transfer') transfer += Number(t.amount || 0)
      else if (t.type === 'cc_payment') ccPayment += Number(t.amount || 0)
    })
    const netCashflow = income - expense
    const savingsRate = income > 0 ? (netCashflow / income) * 100 : null
    return {
      income: Math.round(income * 100) / 100,
      expense: Math.round(expense * 100) / 100,
      transfer: Math.round(transfer * 100) / 100,
      ccPayment: Math.round(ccPayment * 100) / 100,
      netCashflow: Math.round(netCashflow * 100) / 100,
      savingsRate: savingsRate === null ? null : Math.round(savingsRate * 10) / 10,
    }
  },

  getCategoryBreakdown(transactions, month, opts = {}) {
    const {
      type = 'expense',
      categories = [],
      uncategorizedLabel = 'ไม่ระบุหมวดหมู่',
      uncategorizedIcon = '📦',
      uncategorizedColor = '#94A3B8',
    } = opts
    const txns = Calc.getMonthlyTransactions(transactions, month, { types: [type] })
    const total = txns.reduce((sum, t) => {
      const amount = type === 'expense' ? Calc.getExpenseLedgerAmount(t) : Number(t.amount || 0)
      return sum + amount
    }, 0)
    const map = new Map()
    txns.forEach(t => {
      const key = t.categoryId || '__uncategorized__'
      const current = map.get(key) || { id: key, amount: 0, count: 0 }
      current.amount += type === 'expense' ? Calc.getExpenseLedgerAmount(t) : Number(t.amount || 0)
      current.count += 1
      map.set(key, current)
    })
    return [...map.values()]
      .map(row => {
        const cat = row.id === '__uncategorized__' ? null : (categories || []).find(c => c.id === row.id)
        const amount = Math.round(Number(row.amount || 0) * 100) / 100
        return {
          id: row.id,
          amount,
          count: row.count,
          pct: total > 0 ? (amount / total) * 100 : 0,
          label: cat?.label || uncategorizedLabel,
          icon: cat?.icon || uncategorizedIcon,
          color: cat?.color || uncategorizedColor,
        }
      })
      .sort((a, b) => b.amount - a.amount || b.count - a.count)
  },

  getMerchantBreakdown(transactions, month, opts = {}) {
    const {
      uncategorizedLabel = 'ไม่ระบุร้านค้า',
    } = opts
    const txns = Calc.getMonthlyTransactions(transactions, month, { types: ['expense'] })
    const total = txns.reduce((sum, t) => sum + Calc.getExpenseLedgerAmount(t), 0)
    const map = new Map()
    txns.forEach(t => {
      const key = String(t.merchant || '').trim() || '__unknown_merchant__'
      const current = map.get(key) || { merchant: key, amount: 0, count: 0 }
      current.amount += Calc.getExpenseLedgerAmount(t)
      current.count += 1
      map.set(key, current)
    })
    return [...map.values()]
      .map(row => {
        const amount = Math.round(Number(row.amount || 0) * 100) / 100
        return {
          merchant: row.merchant === '__unknown_merchant__' ? uncategorizedLabel : row.merchant,
          amount,
          count: row.count,
          pct: total > 0 ? (amount / total) * 100 : 0,
        }
      })
      .sort((a, b) => b.amount - a.amount || b.count - a.count || String(a.merchant).localeCompare(String(b.merchant)))
  },

  getMonthComparison(transactions, month, opts = {}) {
    const previousMonth = opts.previousMonth || Calc.getPreviousMonth(month)
    const current = Calc.getMonthlyIncomeExpense(transactions, month)
    const previous = previousMonth ? Calc.getMonthlyIncomeExpense(transactions, previousMonth) : null
    const expCats = Calc.getCategoryBreakdown(transactions, month, { type: 'expense', categories: opts.expenseCategories || [] })
    const prevExpCats = previousMonth
      ? Calc.getCategoryBreakdown(transactions, previousMonth, { type: 'expense', categories: opts.expenseCategories || [] })
      : []
    const prevMap = new Map(prevExpCats.map(row => [row.id, row]))
    const topCategory = expCats[0] || null
    const topCategoryDelta = topCategory
      ? Math.round((topCategory.amount - Number(prevMap.get(topCategory.id)?.amount || 0)) * 100) / 100
      : 0
    const compare = (cur, prev) => {
      if (!previous || !(Math.abs(Number(prev || 0)) > 0)) return null
      return ((Number(cur || 0) - Number(prev || 0)) / Math.abs(Number(prev || 0))) * 100
    }
    return {
      month,
      previousMonth,
      current,
      previous,
      incomePctChange: compare(current.income, previous?.income),
      expensePctChange: compare(current.expense, previous?.expense),
      netCashflowDelta: previous ? Math.round((current.netCashflow - Number(previous.netCashflow || 0)) * 100) / 100 : null,
      topCategory,
      topCategoryDelta,
    }
  },

  getAssetBreakdown(wallets, opts = {}) {
    const { cryptoTotal = 0 } = opts
    const rows = Array.isArray(wallets) ? wallets : []
    let cash = 0
    let investment = 0
    let gold = 0
    let fcd = 0
    let liabilities = 0
    rows.forEach(w => {
      if (!w || w.hiddenFromWalletList) return
      const type = String(w.type || '').toLowerCase()
      const value = Number(w.balance || 0)
      if (['cash', 'bank', 'ewallet', 'saving'].includes(type)) cash += Math.max(0, value)
      else if (type === 'gold') gold += Math.max(0, value)
      else if (type === 'fcd') fcd += Math.max(0, value)
      else if (type === 'credit') liabilities += Math.abs(Math.min(0, value))
      else if (type !== 'crypto') investment += Math.max(0, value)
    })
    const crypto = Math.max(0, Number(cryptoTotal || 0))
    const assets = cash + investment + gold + fcd + crypto
    return {
      cash: Math.round(cash * 100) / 100,
      investment: Math.round(investment * 100) / 100,
      gold: Math.round(gold * 100) / 100,
      fcd: Math.round(fcd * 100) / 100,
      crypto: Math.round(crypto * 100) / 100,
      liabilities: Math.round(liabilities * 100) / 100,
      assets: Math.round(assets * 100) / 100,
      netWorth: Math.round((assets - liabilities) * 100) / 100,
    }
  },

  getCreditLiabilitySummary(wallets, opts = {}) {
    const cards = (wallets || []).filter(w => w && w.type === 'credit' && !w.hiddenFromWalletList)
    const items = cards.map(card => {
      const statement = typeof App !== 'undefined' && typeof App.getCardStatement === 'function' ? App.getCardStatement(card.id, opts.refDate) : null
      const due = typeof App !== 'undefined' && typeof App.getCreditCardDueInfo === 'function' ? App.getCreditCardDueInfo(card, opts.refDate) : null
      const committed = typeof App !== 'undefined' && typeof App._getUnpostedInstallmentDebt === 'function' ? Number(App._getUnpostedInstallmentDebt(card.id) || 0) : 0
      const availableLimit = typeof App !== 'undefined' && typeof App.getAvailableCreditForCard === 'function'
        ? Number(App.getAvailableCreditForCard(card) || 0)
        : Math.max(0, Number(card.limit || 0) - Math.abs(Number(card.balance || 0)) - committed)
      return {
        card,
        statementDue: Math.round(Number(statement?.balanceDue || 0) * 100) / 100,
        currentCycleSpending: Math.round(Number(statement?.purchaseTotal || 0) * 100) / 100,
        committedInstallments: Math.round(committed * 100) / 100,
        availableLimit: Math.round(availableLimit * 100) / 100,
        nextDueDate: due?.dateStr || statement?.dueDate || '',
        nextDueLabel: due?.dueStr || '',
        daysLeft: Number(due?.daysLeft ?? 9999),
      }
    })
    const totals = items.reduce((sum, row) => {
      sum.statementDue += row.statementDue
      sum.currentCycleSpending += row.currentCycleSpending
      sum.committedInstallments += row.committedInstallments
      return sum
    }, { statementDue: 0, currentCycleSpending: 0, committedInstallments: 0 })
    return {
      cards: items.sort((a, b) => a.daysLeft - b.daysLeft || String(a.card.name).localeCompare(String(b.card.name))),
      totals: {
        statementDue: Math.round(totals.statementDue * 100) / 100,
        currentCycleSpending: Math.round(totals.currentCycleSpending * 100) / 100,
        committedInstallments: Math.round(totals.committedInstallments * 100) / 100,
        totalLiability: Math.round((totals.statementDue + totals.committedInstallments) * 100) / 100,
      },
    }
  },

  getMonthlyStats(transactions, month) {
    // Only count posted transactions — future-scheduled items (installments, etc.)
    // must not inflate or deflate the reported income/expense for the month.
    const txns = transactions.filter(t => t.date.startsWith(month) && Calc.isPostedTx(t))
    let income = 0, expense = 0
    const byCategory = {}

    txns.forEach(t => {
      if (t.type === 'income')  { income  += t.amount }
      if (t.type === 'expense') {
        const amount = Calc.getExpenseLedgerAmount(t)
        expense += amount
        byCategory[t.categoryId] = (byCategory[t.categoryId] || 0) + amount
      }
    })

    const net         = income - expense
    const savingsRate = income > 0 ? Math.max(0, (net / income) * 100) : 0
    return { income, expense, net, savingsRate, byCategory }
  },

  getBudgetProgress(transactions, budgets, categories, month) {
    const txns = transactions.filter(t => t.date.startsWith(month) && t.type === 'expense' && Calc.isPostedTx(t))
    return budgets.map(b => {
      const spent = txns
        .filter(t => t.categoryId === b.categoryId)
        .reduce((s, t) => s + Calc.getExpenseLedgerAmount(t), 0)
      const cat   = categories.expense.find(c => c.id === b.categoryId)
      const pct   = b.monthlyLimit > 0 ? Math.min((spent / b.monthlyLimit) * 100, 100) : 0
      const over  = spent > b.monthlyLimit
      return { ...b, spent, pct, over, icon: cat?.icon || '📦', label: cat?.label || b.categoryId, color: cat?.color || '#6B7280' }
    }).filter(b => b.monthlyLimit > 0)
  },

  getNetWorth(wallets) {
    let assets = 0, debt = 0
    wallets.forEach(w => {
      if (w.balance >= 0) assets += w.balance
      else                debt   += Math.abs(w.balance)
    })
    return { assets, debt, net: assets - debt }
  },

  getPendingUpcomingBills(state) {
    return (state?.upcomingBills || []).filter(b => b && b.status === 'pending')
  },

  getUpcomingReservedTotal(state) {
    return Math.round(Calc.getPendingUpcomingBills(state)
      .reduce((sum, bill) => sum + Number(bill.amount || 0), 0) * 100) / 100
  },

  getUpcomingReservedByWallet(state, walletId) {
    if (!walletId) return 0
    return Math.round(Calc.getPendingUpcomingBills(state)
      .filter(bill => bill.walletId === walletId)
      .reduce((sum, bill) => sum + Number(bill.amount || 0), 0) * 100) / 100
  },

  getSpendableCashWallets(state) {
    const spendableTypes = new Set(['bank', 'cash', 'ewallet', 'saving'])
    return (state?.wallets || []).filter(wallet =>
      wallet &&
      !wallet.hiddenFromWalletList &&
      spendableTypes.has(String(wallet.type || '').toLowerCase())
    )
  },

  getTotalActualSpendableCash(state) {
    return Math.round(Calc.getSpendableCashWallets(state)
      .reduce((sum, wallet) => sum + Number(wallet.balance || 0), 0) * 100) / 100
  },

  getTotalAvailableCash(state) {
    return Math.round((Calc.getTotalActualSpendableCash(state) - Calc.getUpcomingReservedTotal(state)) * 100) / 100
  },

  getWalletAvailableBalance(state, wallet) {
    if (!wallet) return 0
    const actual = Number(wallet.balance || 0)
    const spendableTypes = new Set(['bank', 'cash', 'ewallet', 'saving'])
    if (!spendableTypes.has(String(wallet.type || '').toLowerCase())) return Math.round(actual * 100) / 100
    return Math.round((actual - Calc.getUpcomingReservedByWallet(state, wallet.id)) * 100) / 100
  },

  groupByDate(transactions) {
    const groups = {}
    transactions.forEach(t => {
      const label = Calc.labelDate(t.date)
      if (!groups[label]) groups[label] = []
      groups[label].push(t)
    })
    return groups
  },
}
