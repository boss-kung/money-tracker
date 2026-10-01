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

  function monthIndex(dateIso) {
    const date = parseDate(dateIso)
    return date ? date.getFullYear() * 12 + date.getMonth() : null
  }

  function clampCycleDay(day) { return Math.min(31, Math.max(1, Number(day || 25))) }
  function clampDueAfter(days) { return Math.min(60, Math.max(1, Number(days || 10))) }
  function clampFixedDueDay(day) { return Math.min(31, Math.max(1, Number(day || 23))) }
  function statementId(cardId, start, end) { return `${cardId}:${start}:${end}` }

  function isPostedAt(tx, refDate, predicate) {
    if (!tx) return false
    if (typeof predicate === 'function') return predicate(tx) === true
    const date = String(tx.date || '')
    return !date || date <= String(refDate || '')
  }

  const DEFAULT_THAI_BANK_HOLIDAYS_MMDD = [
    '01-01',
    '04-06',
    '04-13', '04-14', '04-15',
    '05-01',
    '05-05',
    '06-03',
    '07-28',
    '08-12',
    '10-13',
    '10-23',
    '12-05',
    '12-10',
    '12-31',
  ]

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

  function isWeekendDateStr(value) {
    const d = parseDate(value)
    if (!d) return false
    const dow = d.getDay()
    return dow === 0 || dow === 6
  }

  function normalizeHolidayEntries(input) {
    const list = Array.isArray(input)
      ? input
      : String(input || '').split(/[\n,;]+/)
    return [...new Set(list
      .map(v => String(v || '').trim())
      .filter(Boolean)
      .map(v => {
        const ymd = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
        if (ymd) return `${ymd[1]}-${pad2(ymd[2])}-${pad2(ymd[3])}`
        const mmdd = v.match(/^(\d{1,2})-(\d{1,2})$/)
        if (mmdd) return `${pad2(mmdd[1])}-${pad2(mmdd[2])}`
        const slash = v.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
        if (slash) {
          if (slash[3]) {
            let year = Number(slash[3])
            if (year < 100) year += 2000
            return `${year}-${pad2(slash[2])}-${pad2(slash[1])}`
          }
          return `${pad2(slash[2])}-${pad2(slash[1])}`
        }
        return null
      })
      .filter(Boolean)
    )]
  }

  function isHolidayDateStr(value, customHolidays = [], includeDefaults = true) {
    if (!value) return false
    const holidayApi = typeof globalThis !== 'undefined' ? globalThis.ThaiBankHolidays : null
    if (includeDefaults && holidayApi?.has?.(value)) return true
    const pool = new Set(normalizeHolidayEntries(customHolidays))
    if (includeDefaults) DEFAULT_THAI_BANK_HOLIDAYS_MMDD.forEach(day => pool.add(day))
    const mmdd = String(value).slice(5)
    return pool.has(value) || pool.has(mmdd)
  }

  function shiftBackwardsToBusinessDay(value, opts = {}) {
    const {
      customHolidays = [],
      includeDefaultHolidays = true,
      maxIterations = 20,
    } = opts
    let cursor = value
    for (let i = 0; i < maxIterations; i++) {
      if (!isWeekendDateStr(cursor) && !isHolidayDateStr(cursor, customHolidays, includeDefaultHolidays)) return cursor
      const prev = addDays(cursor, -1)
      if (!prev || prev === cursor) break
      cursor = prev
    }
    return cursor
  }

  function buildFixedDueDateForCycleEnd(statementEnd, cycleDay, fixedDueDay) {
    const end = parseDate(statementEnd)
    if (!end) return ''
    const cycle = clampCycleDay(cycleDay)
    const fixedDay = clampFixedDueDay(fixedDueDay)
    const monthOffset = fixedDay <= cycle ? 1 : 0
    const dueBase = new Date(end.getFullYear(), end.getMonth() + monthOffset, 1)
    const dueDay = clampDay(dueBase.getFullYear(), dueBase.getMonth(), fixedDay)
    return dateStr(new Date(dueBase.getFullYear(), dueBase.getMonth(), dueDay))
  }

  function resolveDueDate(card, statementEnd) {
    if (!statementEnd) return ''
    if (String(card?.dueDateMode || 'afterCycle') === 'fixedDay') {
      const fixedDay = clampFixedDueDay(card?.fixedDueDay || card?.dueDay || 23)
      const raw = buildFixedDueDateForCycleEnd(statementEnd, card?.cycleDay || 25, fixedDay)
      if (!raw) return ''
      if (card?.holidayShiftEnabled === false) return raw
      return shiftBackwardsToBusinessDay(raw, {
        customHolidays: card?.customHolidays || [],
        includeDefaultHolidays: card?.includeDefaultHolidays !== false,
      })
    }
    return addDays(statementEnd, clampDueAfter(card?.dueAfterCycleDays || 10))
  }

  function legacyPaymentStatementId(card, payment, transactions = []) {
    const paymentDate = String(payment?.date || '')
    const parsedPayment = parseDate(paymentDate)
    if (!parsedPayment || !card?.id) return ''
    const cycleDay = clampCycleDay(card.cycleDay || 25)
    const candidates = []
    // A due date can be at most 60 days after a cycle end. Scan a generous
    // window so legacy rows without statementId still get one deterministic
    // allocation even when the card has not been opened for many months.
    for (let offset = -12; offset <= 0; offset++) {
      const month = new Date(parsedPayment.getFullYear(), parsedPayment.getMonth() + offset, 1)
      const endDay = clampDay(month.getFullYear(), month.getMonth(), cycleDay)
      const periodRef = dateStr(new Date(month.getFullYear(), month.getMonth(), endDay + 1))
      const period = getStatementPeriod(card, periodRef, { includeOpen:false })
      if (!period || String(period.end) >= paymentDate) continue
      const dueDate = resolveDueDate(card, period.end)
      if (!dueDate || paymentDate > dueDate) continue
      const hasPurchase = transactions.some(tx => tx && tx.type === 'expense'
        && String(tx.walletId || '') === String(card.id)
        && String(tx.date || '') >= period.start
        && String(tx.date || '') <= period.end)
      if (hasPurchase) candidates.push({ id:statementId(card.id, period.start, period.end), dueDate, end:period.end })
    }
    candidates.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || String(a.end).localeCompare(String(b.end)))
    return candidates[0]?.id || ''
  }

  function getCardStatement({ card, transactions = [], refDate, postedRefDate, rewardForTx, amountForTx, isPostedTx, includeOpen = false }) {
    const period = getStatementPeriod(card, refDate, { includeOpen })
    if (!period || !card?.id) return null
    const dueDate = resolveDueDate(card, period.end)
    const id = statementId(card.id, period.start, period.end)
    const purchases = transactions.filter(t =>
      t && t.type === 'expense' &&
      String(t.walletId || '') === String(card.id) &&
      String(t.date || '') >= period.start &&
      String(t.date || '') <= period.end &&
      isPostedAt(t, postedRefDate || refDate, isPostedTx)
    )
    const payments = transactions.filter(t => {
      if (!t || t.type !== 'cc_payment' || String(t.toWalletId || '') !== String(card.id)) return false
      if (!isPostedAt(t, postedRefDate || refDate, isPostedTx)) return false
      if (String(t.statementId || '') === id) return true
      const txDate = String(t.date || '')
      // A non-empty statementId is an explicit allocation. Never let the
      // date-based legacy fallback allocate that same payment to another
      // statement as well.
      if (String(t.statementId || '')) return false
      return txDate > period.end && txDate <= dueDate
        && legacyPaymentStatementId(card, t, transactions) === id
    })
    const credits = transactions.filter(t =>
      t && t.type === 'income' && String(t.walletId || '') === String(card.id) &&
      String(t.date || '') >= period.start && String(t.date || '') <= period.end &&
      isPostedAt(t, postedRefDate || refDate, isPostedTx)
    )
    const purchaseTotal = Math.round(purchases.reduce((sum, tx) => sum + Number(typeof amountForTx === 'function' ? amountForTx(tx) : tx.amount || 0), 0) * 100) / 100
    const paidTotal = Math.round(payments.reduce((sum, tx) => sum + Number(tx.amount || 0), 0) * 100) / 100
    const creditTotal = Math.round(credits.reduce((sum, tx) => sum + Number(tx.amount || 0), 0) * 100) / 100
    const balanceDue = Math.max(0, Math.round((purchaseTotal - paidTotal - creditTotal) * 100) / 100)
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
    return { id, cardId:card.id, start:period.start, end:period.end, dueDate, dueAfterCycleDays:clampDueAfter(card.dueAfterCycleDays || 10), purchases, payments, credits, purchaseTotal, paidTotal, creditTotal, balanceDue, paid:balanceDue <= 0 && purchaseTotal > 0, reward }
  }

  function shiftStatementRef(statement, deltaCycles) {
    // getStatementPeriod treats the cycle day itself as the closed period. The
    // first day of the current period therefore selects the immediately prior
    // period; subtracting one day skipped an entire statement every time.
    return deltaCycles < 0 ? statement.start : addDays(statement.end, 1)
  }

  function getStatementHistory({ card, transactions = [], refDate, count = 6, rewardForTx, amountForTx, isPostedTx, includeOpen = false }) {
    const rows = []
    let cursor = refDate
    let includeOpenForCursor = includeOpen
    const seen = new Set()
    for (let i = 0; i < count; i++) {
      const st = getCardStatement({
        card, transactions, refDate:cursor, postedRefDate:refDate,
        rewardForTx, amountForTx, isPostedTx,
        includeOpen:includeOpenForCursor,
      })
      if (!st || seen.has(st.id)) break
      rows.push(st)
      seen.add(st.id)
      cursor = shiftStatementRef(st, -1)
      // Only the first row may be the currently open cycle. Once the cursor
      // moves to the previous boundary, use closed-cycle semantics so a
      // cycle starting after the card's cycle day does not resolve forward.
      includeOpenForCursor = false
      if (!cursor) break
    }
    return rows
  }

  function getPayableStatements({ card, transactions = [], refDate, lookback = 6, rewardForTx, amountForTx, isPostedTx, includeOverdue = true }) {
    const refMonth = monthIndex(refDate)
    const relevantDates = transactions
      .filter(tx => tx && ['expense', 'cc_payment'].includes(tx.type))
      .filter(tx => String(tx.walletId || tx.toWalletId || '') === String(card?.id || '') || String(tx.toWalletId || '') === String(card?.id || ''))
      .filter(tx => isPostedAt(tx, refDate, isPostedTx))
      .map(tx => monthIndex(tx.date))
      .filter(value => value !== null)
    const oldestMonth = relevantDates.length ? Math.min(...relevantDates) : refMonth
    const historyCount = Math.max(Number(lookback) || 0, refMonth !== null && oldestMonth !== null
      ? Math.max(0, refMonth - oldestMonth) + 3
      : Number(lookback) || 0)
    const rows = getStatementHistory({ card, transactions, refDate, count:historyCount, rewardForTx, amountForTx, isPostedTx })
    // openingBalance is the signed card baseline. Carry an opening debt into
    // the next payable statement once, so a card opened with an existing debt
    // cannot appear debt-free until a new purchase is made.
    const openingDebt = Math.max(0, -Number(card?.openingBalance || 0))
    if (openingDebt > 0 && rows.length && !rows.some(row => row.openingDebtIncluded)) {
      const first = rows[0]
      const combinedBalance = Math.max(0, Math.round((Number(first.purchaseTotal || 0) + openingDebt - Number(first.paidTotal || 0) - Number(first.creditTotal || 0)) * 100) / 100)
      rows[0] = { ...first, openingDebt, openingDebtIncluded:true, purchaseTotal:Math.round((Number(first.purchaseTotal || 0) + openingDebt) * 100) / 100, balanceDue:combinedBalance, paid:combinedBalance <= 0 }
    }
    return rows
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
    buildFixedDueDateForCycleEnd,
    getStatementPeriod,
    resolveDueDate,
    shiftBackwardsToBusinessDay,
    getCardStatement,
    getStatementHistory,
    getPayableStatements,
    getNextPayableDueInfo,
    getCreditDueNotificationRows,
  }
})
