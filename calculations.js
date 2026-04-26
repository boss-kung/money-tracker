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
    const today = TODAY
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
    let due = new Date(now.getFullYear(), now.getMonth(), dueDay)
    if (due < now) due = new Date(now.getFullYear(), now.getMonth() + 1, dueDay)
    const daysLeft = Math.ceil((due - now) / 86400000)
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
    return { daysLeft, dueStr: `${due.getDate()} ${months[due.getMonth()]}` }
  },

  genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2)
  },

  // ── Business logic ──────────────────────────────────────────
  getMonthlyStats(transactions, month) {
    const txns = transactions.filter(t => t.date.startsWith(month))
    let income = 0, expense = 0
    const byCategory = {}

    txns.forEach(t => {
      if (t.type === 'income')  { income  += t.amount }
      if (t.type === 'expense') { expense += t.amount; byCategory[t.categoryId] = (byCategory[t.categoryId] || 0) + t.amount }
    })

    const net         = income - expense
    const savingsRate = income > 0 ? Math.max(0, (net / income) * 100) : 0
    return { income, expense, net, savingsRate, byCategory }
  },

  getBudgetProgress(transactions, budgets, categories, month) {
    const txns = transactions.filter(t => t.date.startsWith(month) && t.type === 'expense')
    return budgets.map(b => {
      const spent = txns.filter(t => t.categoryId === b.categoryId).reduce((s, t) => s + t.amount, 0)
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
