;(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory()
  else root.CreditCardCycles = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const DAY_MS = 86400000

  function pad2(n) { return String(n).padStart(2, '0') }

  function parseDate(dateStr) {
    const [y, m, d] = String(dateStr || '').slice(0, 10).split('-').map(Number)
    if (!y || !m || !d) return null
    return new Date(y, m - 1, d)
  }

  function dateStr(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  }

  function clampDay(year, monthIndex, day) {
    return Math.min(Math.max(1, Number(day || 1)), new Date(year, monthIndex + 1, 0).getDate())
  }

  function addDays(value, days) {
    const d = parseDate(value)
    if (!d) return ''
    d.setDate(d.getDate() + Number(days || 0))
    return dateStr(d)
  }

  function daysBetween(dateIso, refIso) {
    const date = parseDate(dateIso)
    const ref = parseDate(refIso)
    if (!date || !ref) return 0
    return Math.round((date - ref) / DAY_MS)
  }

  function clampCycleDay(day) { return Math.min(31, Math.max(1, Number(day || 25))) }
  function clampDueAfter(days) { return Math.min(60, Math.max(1, Number(days || 10))) }
  function statementId(cardId, start, end) { return `${cardId}:${start}:${end}` }

  function getStatementPeriod(card, refDate, opts = {}) {
    const ref = parseDate(refDate)
    if (!card || !ref) return null
    const cycleDay = clampCycleDay(card.cycleDay || 25)
    const ry = ref.getFullYear()
    const rm = ref.getMonth()
    const rd = ref.getDate()
    let end = new Date(ry, rm, clampDay(ry, rm, cycleDay))
    if (opts.includeOpen === true && rd > cycleDay) {
      const next = new Date(ry, rm + 1, 1)
      end = new Date(next.getFullYear(), next.getMonth(), clampDay(next.getFullYear(), next.getMonth(), cycleDay))
    } else if (opts.includeOpen !== true && rd <= cycleDay) {
      const prev = new Date(ry, rm - 1, 1)
      end = new Date(prev.getFullYear(), prev.getMonth(), clampDay(prev.getFullYear(), prev.getMonth(), cycleDay))
    }
    const prevOfEnd = new Date(end.getFullYear(), end.getMonth() - 1, 1)
    const prevEndD = clampDay(prevOfEnd.getFullYear(), prevOfEnd.getMonth(), cycleDay)
    const start = new Date(prevOfEnd.getFullYear(), prevOfEnd.getMonth(), prevEndD + 1)
    return { start: dateStr(start), end: dateStr(end) }
  }

  function resolveDueDate(card, statementEnd) {
    if (!statementEnd) return ''
    if (String(card?.dueDateMode || 'afterCycle') === 'fixedDay' && Number(card?.dueDay || 0) > 0) {
      const end = parseDate(statementEnd)
      if (!end) return ''
      let due = new Date(end.getFullYear(), end.getMonth(), clampDay(end.getFullYear(), end.getMonth(), Number(card.dueDay)))
      if (dateStr(due) <= statementEnd) {
        const next = new Date(end.getFullYear(), end.getMonth() + 1, 1)
        due = new Date(next.getFullYear(), next.getMonth(), clampDay(next.getFullYear(), next.getMonth(), Number(card.dueDay)))
      }
      return dateStr(due)
    }
    return addDays(statementEnd, clampDueAfter(card?.dueAfterCycleDays || 10))
  }

  function getCardStatement({ card, transactions = [], refDate, rewardForTx, amountForTx, isPostedTx, includeOpen = false }) {
    const period = getStatementPeriod(card, refDate, { includeOpen })
    if (!period || !card?.id) return null
    const dueDate = resolveDueDate(card, period.end)
    const id = statementId(card.id, period.start, period.end)
    const purchases = transactions.filter(t =>
      t && t.type === 'expense' &&
      String(t.walletId || '') === String(card.id) &&
      String(t.date || '') >= period.start &&
      String(t.date || '') <= period.end &&
      (typeof isPostedTx === 'function' ? isPostedTx(t) : t.scheduled !== true)
    )
    const payments = transactions.filter(t => {
      if (!t || t.type !== 'cc_payment' || String(t.toWalletId || '') !== String(card.id)) return false
      if (String(t.statementId || '') === id) return true
      const txDate = String(t.date || '')
      return txDate > period.end && txDate <= dueDate
    })
    const purchaseTotal = Math.round(purchases.reduce((sum, tx) => sum + Number(typeof amountForTx === 'function' ? amountForTx(tx) : tx.amount || 0), 0) * 100) / 100
    const paidTotal = Math.round(payments.reduce((sum, tx) => sum + Number(tx.amount || 0), 0) * 100) / 100
    const balanceDue = Math.max(0, Math.round((purchaseTotal - paidTotal) * 100) / 100)
    const reward = purchases.reduce((sum, tx) => {
      const est = typeof rewardForTx === 'function' ? rewardForTx(tx) : { points:0, cashback:0, discount:0 }
      sum.points += Number(est.points || 0)
      sum.cashback += Number(est.cashback || 0)
      sum.discount += Number(est.discount || 0)
      return sum
    }, { points:0, cashback:0, discount:0 })
    reward.points = Math.floor(reward.points)
    reward.cashback = Math.round(reward.cashback * 100) / 100
    reward.discount = Math.round(reward.discount * 100) / 100
    return { id, cardId:card.id, start:period.start, end:period.end, dueDate, dueAfterCycleDays:clampDueAfter(card.dueAfterCycleDays || 10), purchases, payments, purchaseTotal, paidTotal, balanceDue, paid:balanceDue <= 0 && purchaseTotal > 0, reward }
  }

  function shiftStatementRef(statement, deltaCycles) {
    return addDays(deltaCycles < 0 ? statement.start : statement.end, deltaCycles < 0 ? -1 : 1)
  }

  function getStatementHistory({ card, transactions = [], refDate, count = 6, rewardForTx, amountForTx, isPostedTx, includeOpen = false }) {
    const rows = []
    let cursor = refDate
    const seen = new Set()
    for (let i = 0; i < count; i++) {
      const st = getCardStatement({ card, transactions, refDate:cursor, rewardForTx, amountForTx, isPostedTx, includeOpen })
      if (!st || seen.has(st.id)) break
      rows.push(st)
      seen.add(st.id)
      cursor = shiftStatementRef(st, -1)
      if (!cursor) break
    }
    return rows
  }

  function getPayableStatements({ card, transactions = [], refDate, lookback = 6, rewardForTx, amountForTx, isPostedTx, includeOverdue = true }) {
    return getStatementHistory({ card, transactions, refDate, count:lookback, rewardForTx, amountForTx, isPostedTx })
      .filter(st => Number(st.balanceDue || 0) > 0)
      .filter(st => includeOverdue || String(st.dueDate || '') >= String(refDate || ''))
      .map(st => ({ ...st, daysLeft:daysBetween(st.dueDate, refDate) }))
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
  }

  function getNextPayableDueInfo({ card, transactions = [], refDate, rewardForTx, amountForTx, isPostedTx }) {
    const st = getPayableStatements({ card, transactions, refDate, rewardForTx, amountForTx, isPostedTx })[0]
    if (!st) return null
    return { daysLeft:st.daysLeft, dueStr:st.dueDate, dateStr:st.dueDate, statementId:st.id, amount:st.balanceDue, statement:st }
  }

  function getCreditDueNotificationRows({ cards = [], transactions = [], refDate, hideAmounts = false, maxDays = 7, rewardForTx, amountForTx, isPostedTx }) {
    return cards.flatMap(card =>
      getPayableStatements({ card, transactions, refDate, rewardForTx, amountForTx, isPostedTx })
        .filter(st => Number(st.daysLeft) <= Number(maxDays))
        .map(st => ({
          id: card.id,
          statementId: st.id,
          title: card.name,
          dueDate: st.dueDate,
          daysLeft: st.daysLeft,
          amount: hideAmounts ? null : st.balanceDue,
          amountDue: st.balanceDue,
          cycleStart: st.start,
          cycleEnd: st.end,
        }))
    ).slice(0, 25)
  }

  return {
    addDays,
    daysBetween,
    getStatementPeriod,
    getCardStatement,
    getStatementHistory,
    getPayableStatements,
    getNextPayableDueInfo,
    getCreditDueNotificationRows,
  }
})
