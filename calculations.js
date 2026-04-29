const Calc = {
  // ── Formatting ──────────────────────────────────────────────
  fmt(n) {
    return '฿' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
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
