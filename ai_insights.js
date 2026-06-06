/* ============================================================
   AI Insights Engine v1 — Local Rule-Based Insight Engine
   Phase 1: DataSummarizer + 12-rule LocalRuleEngine + InsightStore
   ============================================================ */
'use strict'

const InsightEngine = (() => {
  const STORE_KEY = 'mt_ai_insight_store'
  const CACHE_TTL_MS = 4 * 60 * 60 * 1000
  const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000
  const VERSION = 2

  // ── Helpers ─────────────────────────────────────────────────
  function todayStr() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }

  function daysBetween(a, b) {
    const da = new Date(a), db = new Date(b)
    return Math.round((db - da) / 86400000)
  }

  function simpleHash(str) {
    let h = 0
    for (let i = 0; i < Math.min(str.length, 512); i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
    }
    return Math.abs(h).toString(36)
  }

  function payloadHash(p) {
    try {
      return simpleHash(JSON.stringify({
        liq:      Math.round(p.usable?.liquid || 0),
        exp:      Math.round(p.monthly?.expense || 0),
        inc:      Math.round(p.monthly?.income || 0),
        tc:       p.txCount,
        mo:       p.month,
        ts:       Math.floor(Date.now() / CACHE_TTL_MS),
        bud:      (p.budget || []).map(b => `${b.categoryId}:${Math.round(b.spent || 0)}:${b.limit || 0}`).sort().join(','),
        bills:    (p.billsDue || []).length,
        privExp:  (p.privExpiring || []).length,
        cc:       (p.creditStatements || [])
          .map(row => `${row.card?.id || ''}:${Math.round(Number(row.card?.balance || 0))}:${row.dueInfo?.dateStr || ''}:${row.hasPaymentForDue ? 1 : 0}`)
          .sort()
          .join(','),
      }))
    } catch (_) { return 'err' }
  }

  function expenseAmount(t) {
    try {
      if (typeof Calc !== 'undefined' && typeof Calc.getExpenseLedgerAmount === 'function') {
        return Number(Calc.getExpenseLedgerAmount(t) || 0)
      }
    } catch (_) {}
    return Number(t?.ledgerAmount ?? t?.amount ?? 0) || 0
  }

  function shiftDateStr(dateStr, dayDelta = 0) {
    const [y, m, d] = String(dateStr || '').split('-').map(Number)
    if (!y || !m || !d) return ''
    const next = new Date(y, m - 1, d)
    next.setDate(next.getDate() + Number(dayDelta || 0))
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`
  }

  // ── Store CRUD ───────────────────────────────────────────────
  function emptyStore() {
    return { version: VERSION, lastRefreshed: null, payloadHash: '', insights: [], hiddenTypes: [], feedback: [] }
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY)
      if (!raw) return emptyStore()
      const s = JSON.parse(raw)
      return (s && s.version === VERSION) ? s : emptyStore()
    } catch (_) { return emptyStore() }
  }

  function saveStore(store) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)) } catch (_) {}
  }

  function shouldRefresh(store, newHash) {
    if (!store.lastRefreshed) return true
    if (store.payloadHash !== newHash) return true
    return (Date.now() - new Date(store.lastRefreshed).getTime()) > CACHE_TTL_MS
  }

  // ── Payload Builder ──────────────────────────────────────────
  function buildPayload(S) {
    const txs      = S.transactions || []
    const wallets  = S.wallets || []
    const budgets  = S.budgets || []
    const cats     = S.categories || []
    const goals    = S.goals || []
    const bills    = S.upcomingBills || []
    const recurring= S.recurring || []
    const privs    = S.privileges || []

    const month = (typeof THIS_MONTH !== 'undefined' ? THIS_MONTH
      : (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` })())

    const prevMonth = Calc.getPreviousMonth ? Calc.getPreviousMonth(month)
      : (() => { const d = new Date(month + '-01'); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7) })()

    const today = todayStr()

    // Monthly stats
    let monthly     = { income:0, expense:0, netCashflow:0, savingsRate:null, byCategory:{} }
    let prevMonthly = { income:0, expense:0, netCashflow:0, savingsRate:null }
    try { monthly     = Calc.getMonthlyIncomeExpense(txs, month) }     catch(_) {}
    try { prevMonthly = Calc.getMonthlyIncomeExpense(txs, prevMonth) } catch(_) {}

    // Budget progress
    let budget = []
    try { budget = Calc.getBudgetProgress(txs, budgets, cats, month) } catch(_) {}

    // 6-month history
    const months6 = Calc.getMonths ? Calc.getMonths(6) : [month]
    const history = months6.map(m => {
      try { const s = Calc.getMonthlyIncomeExpense(txs, m); return { month: m, income: s.income, expense: s.expense, net: s.netCashflow, rate: s.savingsRate } }
      catch(_) { return { month: m, income:0, expense:0, net:0, rate:null } }
    })

    // Budget history (4 months for INS-09 — slice(0,-1) gives 3 previous months)
    const months3 = Calc.getMonths ? Calc.getMonths(3) : [month]
    const months4 = Calc.getMonths ? Calc.getMonths(4) : [month]
    const budgetHistory = months4.map(m => {
      try { return { month: m, items: Calc.getBudgetProgress(txs, budgets, cats, m) } }
      catch(_) { return { month: m, items: [] } }
    })

    // Usable money
    let usable = { liquid:0, creditDebt:0, upcomingReserved:0, net:0 }
    try { if (typeof Calc.getUsableMoney === 'function') usable = Calc.getUsableMoney(wallets, S) } catch(_) {}

    // Upcoming items
    let upcoming = []
    try { if (typeof App !== 'undefined' && App.getUpcomingItems) upcoming = App.getUpcomingItems(14) } catch(_) {}

    const upcomingCommitted = upcoming
      .filter(r => ['credit_due','recurring','scheduled','installment'].includes(r.type))
      .reduce((s, r) => s + Number(r.amount || 0), 0)

    // Credit card statements
    const creditCards = wallets.filter(w => w.type === 'credit' && !w.archived)
    const creditStatements = creditCards.map(card => {
      let stmt = null, dueInfo = null
      try { if (typeof App !== 'undefined' && App.getCardStatement) stmt = App.getCardStatement(card.id) } catch(_) {}
      try { if (typeof App !== 'undefined' && App.getCreditCardDueInfo) dueInfo = App.getCreditCardDueInfo(card) } catch(_) {}
      const dueDate = String(dueInfo?.dateStr || stmt?.dueDate || '')
      const alertWindowStart = shiftDateStr(dueDate, -3)
      const hasPaymentForDue = (Number(stmt?.paidTotal || 0) > 0 && (!dueDate || String(stmt?.dueDate || '') === dueDate))
        || txs.some(t => {
          if (!t || t.type !== 'cc_payment' || String(t.toWalletId || '') !== String(card.id)) return false
          if (!(Number(t.amount || 0) > 0)) return false
          if (stmt?.id && String(t.statementId || '') === String(stmt.id)) return true
          const date = String(t.date || '')
          if (stmt?.end && stmt?.dueDate && date > String(stmt.end) && date <= String(stmt.dueDate)) return true
          return !!(date && alertWindowStart && dueDate && date >= alertWindowStart && date <= dueDate)
        })
      return { card, stmt, dueInfo, hasPaymentForDue }
    })

    // Pending bills with daysLeft
    const billsDue = bills
      .filter(b => b.status === 'pending')
      .map(b => ({ ...b, daysLeft: daysBetween(today, b.dueDate || b.date || today) }))

    // Goal progress
    const goalProgress = goals.filter(g => g.status === 'active').map(g => {
      let progress = null
      try { if (typeof App !== 'undefined' && App.getGoalProgress) progress = App.getGoalProgress(g) } catch(_) {}
      return { goal: g, progress }
    })

    // Expiring privileges (≤ 7 days)
    const privExpiring = privs.filter(p => {
      if (p.status !== 'active' || !p.expiryDate) return false
      return daysBetween(today, p.expiryDate) <= 7 && daysBetween(today, p.expiryDate) >= 0
    })

    // Merchant breakdown (current month)
    let merchantBreakdown = []
    try { if (Calc.getMerchantBreakdown) merchantBreakdown = Calc.getMerchantBreakdown(txs, month) } catch(_) {}

    // Merchant history (last 3 months, top 10 each) for INS-08
    const recurringMerchants = new Set(
      recurring.map(r => (r.merchant || r.name || '').toLowerCase().trim()).filter(Boolean)
    )
    const merchantCounts = {}
    months3.forEach(m => {
      try {
        const bd = Calc.getMerchantBreakdown ? Calc.getMerchantBreakdown(txs, m) : []
        bd.slice(0, 10).forEach(item => {
          const key = (item.merchant || item.name || '').toLowerCase().trim()
          if (!key || key === 'อื่นๆ' || key === 'other' || recurringMerchants.has(key)) return
          if (!merchantCounts[key]) merchantCounts[key] = { name: item.merchant || item.name, count: 0, total: 0 }
          merchantCounts[key].count++
          merchantCounts[key].total += Number(item.amount || item.total || 0)
        })
      } catch(_) {}
    })
    const unregisteredRecurring = Object.values(merchantCounts).filter(m => m.count >= 3)

    // Stale asset prices for INS-11
    const stalePrices = []
    try {
      if (typeof App !== 'undefined' && App.getMarketFreshnessText) {
        ;['crypto','gold','fcd'].forEach(kind => {
          try { const t = App.getMarketFreshnessText(kind); if (t && /เก่า|manual|สำรอง/.test(t)) stalePrices.push(kind) } catch(_) {}
        })
      }
    } catch(_) {}

    // Today's transactions (and 3-day window) for INS-10 duplicate check
    const todayTxs = txs.filter(t => (t.date || '') === today && t.type === 'expense')
    const d3 = new Date(); d3.setDate(d3.getDate() - 3)
    const _d3Str = `${d3.getFullYear()}-${String(d3.getMonth()+1).padStart(2,'0')}-${String(d3.getDate()).padStart(2,'0')}`
    const recentExpTxs = txs.filter(t => t.type === 'expense' && (t.date || '') >= _d3Str && (t.date || '') <= today)

    // Projection helpers
    const dayOfMonth  = new Date().getDate()
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate()
    const monthFraction = Math.max(0.05, dayOfMonth / daysInMonth)
    const projectedExpense = monthly.expense / monthFraction
    const daysLeft = daysInMonth - dayOfMonth

    // Monthly recurring total for INS-15
    const monthlyRecurringTotal = recurring
      .filter(r => r.status !== 'inactive' && r.status !== 'cancelled')
      .reduce((s, r) => {
        const amt = Number(r.amount || 0)
        if (r.frequency === 'weekly') return s + amt * 4.3
        if (r.frequency === 'yearly') return s + amt / 12
        return s + amt
      }, 0)

    return {
      month, prevMonth, txCount: txs.length,
      monthly, prevMonthly, budget, budgetHistory, history,
      usable, upcoming, upcomingCommitted,
      creditCards, creditStatements,
      billsDue, goalProgress, privExpiring,
      merchantBreakdown, unregisteredRecurring, stalePrices, todayTxs, recentExpTxs,
      dayOfMonth, daysInMonth, monthFraction, projectedExpense, daysLeft,
      recurringMerchants, monthlyRecurringTotal,
    }
  }

  // ── Rule Engine ──────────────────────────────────────────────
  function runRules(payload) {
    const insights = []
    const { month } = payload

    function add(type, key, { title, body, severity, urgency, impact, action, evidence }) {
      insights.push({
        id: `INS-${type}-${simpleHash(String(key))}-${month}`,
        type, title, body, severity,
        urgency: urgency || 5, impact: impact || 5,
        action: action || null, evidence: evidence || {},
        generatedAt: new Date().toISOString(),
        state: 'active', seenCount: 0, lastSeenAt: null,
        snoozedUntil: null, dismissedAt: null, actedAt: null, userRating: null,
      })
    }

    // ── INS-01: Cashflow Risk ──────────────────────────────────
    try {
      const liquid = Number(payload.usable.liquid || 0)
      const obligations = payload.upcomingCommitted
      const gap = liquid - obligations
      if (gap < 0 && obligations > 0) {
        add('01', 'cashflow-critical', {
          title: 'สภาพคล่องตึงตัว',
          body: `เงินพร้อมใช้ ฿${Math.round(liquid).toLocaleString('en-US')} อาจไม่พอรองรับภาระที่จะถึง ฿${Math.round(obligations).toLocaleString('en-US')} ควรเตรียมสภาพคล่องล่วงหน้า`,
          severity: 'critical', urgency: 9, impact: 8,
          action: { label: 'ดูกระเป๋าเงิน', fn: "App.showPage('wallets')" },
          evidence: { liquid, obligations, gap },
        })
      } else if (liquid > 0 && obligations > 0 && gap < liquid * 0.2) {
        add('01', 'cashflow-warn', {
          title: 'สภาพคล่องควรระวัง',
          body: `หลังหักภาระใน 14 วัน จะเหลือเผื่อเพียง ฿${Math.round(gap).toLocaleString('en-US')} ควรชะลอรายจ่ายที่ไม่จำเป็น`,
          severity: 'warning', urgency: 6, impact: 7,
          action: { label: 'ดูรายการที่จะถึง', fn: "App.openUpcomingScreen?.()" },
          evidence: { liquid, obligations, gap },
        })
      }
    } catch(_) {}

    // ── INS-02: Budget Overrun ─────────────────────────────────
    try {
      payload.budget.forEach(b => {
        if (!b.monthlyLimit || b.monthlyLimit <= 0) return
        const pct = b.spent / b.monthlyLimit
        const key = b.categoryId || b.id || b.label
        if (pct >= 1.0) {
          add('02', key + '-over', {
            title: `งบ "${b.label}" เกินแล้ว`,
            body: `ใช้ไป ฿${Math.round(b.spent).toLocaleString('en-US')} จากงบ ฿${Math.round(b.monthlyLimit).toLocaleString('en-US')} (${Math.round(pct*100)}%) ควรหยุดใช้จ่ายหมวดนี้ชั่วคราว`,
            severity: 'critical', urgency: 8, impact: 7,
            action: { label: 'ดูงบประมาณ', fn: "App.openBudgetScreen()" },
            evidence: { spent: b.spent, limit: b.monthlyLimit, pct, label: b.label },
          })
        } else if (pct >= 0.85) {
          add('02', key + '-warn', {
            title: `งบ "${b.label}" ใกล้เต็ม`,
            body: `ใช้ไปแล้ว ${Math.round(pct*100)}% เหลือ ฿${Math.round(b.monthlyLimit - b.spent).toLocaleString('en-US')} ควรชะลอรายจ่ายหมวดนี้`,
            severity: 'warning', urgency: 6, impact: 5,
            action: { label: 'ดูงบประมาณ', fn: "App.openBudgetScreen()" },
            evidence: { spent: b.spent, limit: b.monthlyLimit, pct, label: b.label },
          })
        }
      })
    } catch(_) {}

    // ── INS-03: Credit Card Due Soon ───────────────────────────
    try {
      payload.creditStatements.forEach(({ card, dueInfo, hasPaymentForDue }) => {
        if (!dueInfo) return
        if (hasPaymentForDue) return
        const daysLeft = Number(dueInfo.daysLeft)
        if (daysLeft < 0 || daysLeft > 7) return
        const amount = Math.abs(Number(card.balance || 0))
        if (amount <= 0) return
        const canPay = Number(payload.usable.liquid || 0) >= amount
        const urgency = Math.max(1, 10 - daysLeft)
        const dueLabel = daysLeft === 0 ? 'ครบกำหนดวันนี้' : `ครบกำหนดใน ${daysLeft} วัน`
        add('03', card.id + (daysLeft <= 3 ? '-urgent' : '-7d'), {
          title: `${card.name} ${dueLabel}`,
          body: `ยอดค้างชำระ ฿${Calc.fmtNum(amount)}${canPay ? ' — เงินพร้อมใช้เพียงพอ' : ' — ควรโอนเงินเตรียมไว้ล่วงหน้า'}`,
          severity: daysLeft <= 3 ? 'critical' : 'warning', urgency, impact: 8,
          action: { label: 'ชำระบัตร', fn: `App.openCCPay('${card.id}')` },
          evidence: { cardId: card.id, daysLeft, amount, canPay },
        })
      })
    } catch(_) {}

    // ── INS-04: Upcoming Bill Due ──────────────────────────────
    try {
      payload.billsDue.filter(b => b.daysLeft <= 3).slice(0, 3).forEach(b => {
        const bname = b.title || b.name || 'บิล'
        const label = b.daysLeft < 0
          ? `${bname} เลยกำหนดแล้ว!`
          : b.daysLeft === 0
          ? `${bname} ครบกำหนดวันนี้!`
          : `${bname} ครบกำหนดใน ${b.daysLeft} วัน`
        const bodyExtra = b.daysLeft < 0 ? ` — เลยกำหนดไป ${Math.abs(b.daysLeft)} วัน ควรจัดการทันที` : ''
        add('04', (b.id || bname) + String(b.daysLeft), {
          title: label,
          body: `฿${Calc.fmtNum(b.amount)}${bodyExtra}`,
          severity: b.daysLeft < 0 ? 'critical' : 'warning',
          urgency: b.daysLeft < 0 ? 10 : 8, impact: 6,
          action: { label: 'ดูรายการรอจ่าย', fn: "App.openUpcomingBillsScreen()" },
          evidence: { billId: b.id, daysLeft: b.daysLeft, amount: b.amount },
        })
      })
    } catch(_) {}

    // ── INS-05: Goal Behind Track ──────────────────────────────
    try {
      payload.goalProgress.forEach(({ goal, progress }) => {
        if (!progress || !progress.remaining || progress.remaining <= 0) return
        const monthlyGap = progress.suggestedMonthly && goal.monthlyContribution > 0
          && progress.suggestedMonthly > goal.monthlyContribution * 1.2
        const overdue = goal.targetDate && progress.daysLeft < 0
        const nearDeadline = goal.targetDate && progress.daysLeft >= 0 && progress.daysLeft < 30 && !goal.monthlyContribution
        if (!monthlyGap && !overdue && !nearDeadline) return
        const suffix = goal.targetDate
          ? (overdue ? ` · เลยกำหนด ${Math.abs(progress.daysLeft)} วัน` : ` · ${progress.daysLeft} วัน`)
          : ''
        add('05', goal.id, {
          title: `"${goal.name}" อาจตามไม่ทัน`,
          body: `เหลือ ฿${Math.round(progress.remaining).toLocaleString('en-US')}${suffix} — ลองเพิ่มเงินออมหรือขยับวันเป้าหมาย`,
          severity: overdue ? 'critical' : 'warning', urgency: 5, impact: 6,
          action: { label: 'ดูเป้าหมาย', fn: "App.openGoalsScreen()" },
          evidence: { goalId: goal.id, remaining: progress.remaining, daysLeft: progress.daysLeft },
        })
      })
    } catch(_) {}

    // ── INS-06: Expiring Privilege ─────────────────────────────
    try {
      payload.privExpiring.slice(0, 2).forEach(p => {
        const d = daysBetween(todayStr(), p.expiryDate)
        if (d < 0) return
        add('06', p.id || p.title, {
          title: `"${p.title}" หมดอายุใน ${d} วัน`,
          body: `มูลค่าประมาณ ฿${Calc.fmtNum(p.estimatedSaving)} — อย่าลืมใช้ก่อนหมดอายุ`,
          severity: d <= 2 ? 'warning' : 'info', urgency: 6, impact: 4,
          action: { label: 'ดูสิทธิพิเศษ', fn: "App.openPrivilegesScreen?.('expiring')" },
          evidence: { privId: p.id, daysLeft: d, value: p.estimatedSaving },
        })
      })
    } catch(_) {}

    // ── INS-07: Spending Concentration ────────────────────────
    try {
      const top = (payload.merchantBreakdown || [])[0]
      if (top && payload.monthly.expense > 0) {
        const topKey = (top.merchant || top.name || '').toLowerCase().trim()
        const topAmount = Number(top.amount || top.total || 0)
        const pct = (topAmount / payload.monthly.expense) * 100
        if (pct > 35 && topAmount > 500 && !payload.recurringMerchants?.has(topKey)) {
          add('07', top.merchant || top.name, {
            title: 'รายจ่ายกระจุกตัวสูง',
            body: `"${top.merchant || top.name}" คิดเป็น ${pct.toFixed(0)}% ของรายจ่ายเดือนนี้ (฿${Math.round(topAmount).toLocaleString('en-US')}) — ควร negotiate ราคาหรือกระจายร้านค้า`,
            severity: 'info', urgency: 3, impact: 5,
            action: { label: 'ดูรายงาน', fn: "App.showPage('reports')" },
            evidence: { merchant: top.merchant || top.name, pct, total: topAmount },
          })
        }
      }
    } catch(_) {}

    // ── INS-08: Unregistered Recurring ────────────────────────
    try {
      if (payload.unregisteredRecurring.length > 0) {
        const top = payload.unregisteredRecurring.sort((a,b) => b.total - a.total)[0]
        add('08', top.name, {
          title: `"${top.name}" อาจเป็นรายการประจำ`,
          body: `ปรากฏทุกเดือนย้อนหลัง 3 เดือน เฉลี่ย ฿${Math.round(top.total/3).toLocaleString('en-US')}/เดือน — เพิ่มเป็น Recurring เพื่อวางแผนได้ดีกว่า`,
          severity: 'info', urgency: 2, impact: 3,
          action: { label: 'เพิ่มรายการประจำ', fn: "App.openRecurringScreen()" },
          evidence: { merchant: top.name, months: top.count, avgMonthly: top.total/3 },
        })
      }
    } catch(_) {}

    // ── INS-09: Repeat Budget Overrun ─────────────────────────
    try {
      const prevItems = (payload.budgetHistory || []).slice(0, -1)
      const overCounts = {}
      prevItems.forEach(({ items }) => {
        ;(items || []).forEach(b => {
          if (b.spent && b.monthlyLimit && b.spent > b.monthlyLimit) {
            const key = b.categoryId || b.id || b.label
            if (!overCounts[key]) overCounts[key] = { label: b.label, count: 0 }
            overCounts[key].count++
          }
        })
      })
      const repeat = Object.values(overCounts).filter(c => c.count >= 2)
      if (repeat.length) {
        const top = repeat.sort((a,b) => b.count - a.count)[0]
        add('09', top.label, {
          title: `งบ "${top.label}" เกินซ้ำ ${top.count} เดือนติด`,
          body: `หมวดนี้เกินงบ ${top.count} เดือนต่อเนื่อง — ลองปรับงบให้สอดคล้องความเป็นจริงหรือลดรายจ่ายในหมวดนี้`,
          severity: 'warning', urgency: 4, impact: 6,
          action: { label: 'ปรับงบประมาณ', fn: "App.openBudgetScreen()" },
          evidence: { label: top.label, count: top.count },
        })
      }
    } catch(_) {}

    // ── INS-10: Duplicate Transaction ─────────────────────────
    // ตรวจสอบใน 3 วันย้อนหลัง พร้อม ±1 THB tolerance เพื่อจับ double-tap/off-by-one
    try {
      const recentTxs = payload.recentExpTxs || payload.todayTxs || []
      const flagged = []
      for (let i = 0; i < recentTxs.length; i++) {
        const a = recentTxs[i]
        for (let j = i + 1; j < recentTxs.length; j++) {
          const b = recentTxs[j]
          if (a.id === b.id) continue
          const sameMerchant = (a.merchant||'').toLowerCase() === (b.merchant||'').toLowerCase() && (a.merchant||'').trim() !== ''
          const sameWallet = (a.walletId||'') === (b.walletId||'')
          const amountClose = Math.abs(Number(a.amount||0) - Number(b.amount||0)) <= 1
          if (sameMerchant && sameWallet && amountClose) { flagged.push([a, b]); break }
        }
        if (flagged.length) break
      }
      if (flagged.length > 0) {
        const [t1, t2] = flagged[0]
        const t = t1
        const personalAmount = expenseAmount(t)
        const sharedHint = t.sharedExpense?.enabled && Math.abs(personalAmount - Number(t.amount || 0)) > 0.01
          ? ` (นับเข้างบ ฿${Calc.fmtNum(personalAmount)})`
          : ''
        const dateHint = t1.date !== t2.date ? ` (${t1.date} / ${t2.date})` : ` วันนี้`
        add('10', `${t.amount}-${t.merchant||''}`, {
          title: 'อาจมีรายการซ้ำกัน',
          body: `"${t.merchant||'รายการ'}" ฿${Calc.fmtNum(t.amount)}${sharedHint} บันทึกซ้ำกัน${dateHint} — ตรวจสอบว่าไม่ได้บันทึกซ้ำ`,
          severity: 'warning', urgency: 7, impact: 5,
          action: { label: 'ดูรายการ', fn: "App.showPage('transactions')" },
          evidence: { merchant: t.merchant, amount: t.amount, budgetAmount: personalAmount, count: 2 },
        })
      }
    } catch(_) {}

    // ── INS-11: Stale Asset Prices ────────────────────────────
    try {
      if (payload.stalePrices.length > 0) {
        const lbl = { crypto:'คริปโต', gold:'ทองคำ', fcd:'เงินตราต่างประเทศ' }
        const labels = payload.stalePrices.map(k => lbl[k]||k).join(', ')
        add('11', payload.stalePrices.join('-'), {
          title: 'ราคาสินทรัพย์อาจไม่ล่าสุด',
          body: `${labels} — กำลังใช้ราคาสำรอง ควร Sync ราคาใหม่เพื่อความแม่นยำของมูลค่าสุทธิ`,
          severity: 'info', urgency: 3, impact: 4,
          action: { label: 'ไปหน้ากระเป๋า', fn: "App.showPage('wallets')" },
          evidence: { kinds: payload.stalePrices },
        })
      }
    } catch(_) {}

    // ── INS-12: Daily Budget / Savings Forecast ───────────────
    try {
      const { budget, daysLeft, dayOfMonth, projectedExpense, monthly } = payload
      if (dayOfMonth < 7) {
        // Too early in month — no forecast
      } else if (budget.length > 0) {
        const totalLimit = budget.reduce((s,b) => s + (b.monthlyLimit||0), 0)
        const totalSpent = budget.reduce((s,b) => s + (b.spent||0), 0)
        if (totalLimit > 0) {
          const remaining = totalLimit - totalSpent
          const dailyBudget = daysLeft > 0 ? remaining / daysLeft : 0
          const onTrack = projectedExpense <= totalLimit
          add('12', 'budget-forecast', {
            title: onTrack ? 'อยู่ในงบ' : 'แนวโน้มเกินงบ',
            body: onTrack
              ? `เหลืองบ ฿${Math.max(0,Math.round(remaining)).toLocaleString('en-US')} ใน ${daysLeft} วัน — ใช้ได้วันละประมาณ ฿${Math.max(0,Math.round(dailyBudget)).toLocaleString('en-US')}`
              : `คาดว่าเดือนนี้จะใช้ ฿${Math.round(projectedExpense).toLocaleString('en-US')} เกินงบรวม ฿${Math.round(totalLimit).toLocaleString('en-US')}`,
            severity: onTrack ? 'positive' : 'warning', urgency: onTrack ? 2 : 5, impact: 4,
            action: { label: 'ดูงบประมาณ', fn: "App.openBudgetScreen()" },
            evidence: { totalLimit, totalSpent, remaining, dailyBudget, daysLeft, onTrack },
          })
        }
      } else if (monthly.income > 0) {
        const sr = (monthly.income - projectedExpense) / monthly.income * 100
        add('12', 'savings-forecast', {
          title: sr >= 20 ? 'อัตราออมอยู่ในเกณฑ์ดี' : sr >= 0 ? 'ควรเพิ่มอัตราออม' : 'รายจ่ายอาจเกินรายรับ',
          body: sr >= 20
            ? `คาดว่าเดือนนี้จะออมได้ ${sr.toFixed(0)}% ยอดเยี่ยม!`
            : sr >= 0
            ? `คาดว่าเดือนนี้จะออมได้ ${sr.toFixed(0)}% ลองตั้งเป้าออมอัตโนมัติก่อนใช้จ่าย`
            : `คาดว่ารายจ่ายจะเกินรายรับ ฿${Math.round(Math.abs(monthly.income - projectedExpense)).toLocaleString('en-US')} ควรลดรายจ่ายที่ไม่จำเป็น`,
          severity: sr >= 20 ? 'positive' : sr >= 0 ? 'info' : 'warning',
          urgency: sr < 0 ? 5 : 2, impact: 4,
          action: { label: 'ดูรายงาน', fn: "App.showPage('reports')" },
          evidence: { projectedExpense, income: monthly.income, savingsRate: sr },
        })
      }
    } catch(_) {}

    // ── INS-13: Month-over-Month ──────────────────────────────
    try {
      const expDiff = payload.prevMonthly.expense > 0
        ? (payload.monthly.expense - payload.prevMonthly.expense) / payload.prevMonthly.expense * 100
        : null
      const incDiff = payload.prevMonthly.income > 0
        ? (payload.monthly.income - payload.prevMonthly.income) / payload.prevMonthly.income * 100
        : null
      const expBig  = expDiff !== null && expDiff > 15
      const incDown = incDiff !== null && incDiff < -10
      if (expBig || incDown) {
        const parts = []
        if (expBig)  parts.push(`รายจ่ายเพิ่ม ${expDiff.toFixed(0)}% จากเดือนก่อน`)
        if (incDown) parts.push(`รายรับลด ${Math.abs(incDiff).toFixed(0)}% จากเดือนก่อน`)
        add('13', `mom-${month}`, {
          title: 'แนวโน้มเปลี่ยนแปลงจากเดือนก่อน',
          body: parts.join(' · ') + (expBig && incDown ? ' — ควรตรวจรายการผิดปกติทันที' : ''),
          severity: expBig && incDown ? 'critical' : 'warning', urgency: 5, impact: 6,
          action: { label: 'ดูรายงาน', fn: "App.showPage('reports')" },
          evidence: { expDiff, incDiff },
        })
      }
    } catch(_) {}

    // ── INS-14: Emergency Fund ────────────────────────────────
    try {
      const liquid = Number(payload.usable.liquid || 0)
      const monthsWithExp = payload.history.filter(h => h.expense > 0)
      if (monthsWithExp.length >= 2) {
        const avgExp = monthsWithExp.reduce((s, h) => s + h.expense, 0) / monthsWithExp.length
        const months = liquid / avgExp
        if (months < 1) {
          add('14', 'emergency-critical', {
            title: 'เงินสำรองฉุกเฉินต่ำมาก',
            body: `เงินพร้อมใช้ ฿${Math.round(liquid).toLocaleString('en-US')} ยังไม่ถึง 1 เดือนของค่าใช้จ่ายเฉลี่ย (฿${Math.round(avgExp).toLocaleString('en-US')}) ควรหยุดลงทุนชั่วคราวและสะสมเงินสำรองก่อน`,
            severity: 'critical', urgency: 8, impact: 9,
            action: { label: 'ดูกระเป๋าเงิน', fn: "App.showPage('wallets')" },
            evidence: { liquid, avgExp, months },
          })
        } else if (months < 3) {
          add('14', 'emergency-warn', {
            title: 'เงินสำรองฉุกเฉินยังไม่ถึงเป้า',
            body: `ปัจจุบันมี ${months.toFixed(1)} เดือน (฿${Math.round(liquid).toLocaleString('en-US')}) เป้าหมายคือ 3 เดือน (฿${Math.round(avgExp*3).toLocaleString('en-US')}) ควรเพิ่มเงินสำรองก่อนลงทุนเพิ่ม`,
            severity: 'warning', urgency: 5, impact: 9,
            action: { label: 'ดูกระเป๋าเงิน', fn: "App.showPage('wallets')" },
            evidence: { liquid, avgExp, months },
          })
        }
      }
    } catch(_) {}

    // ── INS-15: Fixed Cost Ratio ──────────────────────────────
    try {
      const { monthlyRecurringTotal, monthly } = payload
      if (monthly.income > 0 && monthlyRecurringTotal > 0) {
        const ratio = monthlyRecurringTotal / monthly.income
        if (ratio > 0.55) {
          add('15', 'fixed-cost-ratio', {
            title: 'ค่าใช้จ่ายคงที่สูง',
            body: `รายจ่ายประจำ ฿${Math.round(monthlyRecurringTotal).toLocaleString('en-US')}/เดือน คิดเป็น ${(ratio*100).toFixed(0)}% ของรายรับ — เหลือ flexibility น้อย ควร review subscription หรือรายจ่ายที่ตัดออกได้`,
            severity: ratio > 0.7 ? 'warning' : 'info', urgency: 3, impact: 7,
            action: { label: 'ดูรายการประจำ', fn: "App.openRecurringScreen()" },
            evidence: { ratio, monthlyFixed: monthlyRecurringTotal, income: monthly.income },
          })
        }
      }
    } catch(_) {}

    // ── INS-16: Income Irregularity ──────────────────────────
    try {
      if (payload.dayOfMonth >= 15) {
        const pastInc = payload.history
          .filter(h => h.month !== payload.month && h.income > 0)
          .map(h => h.income)
        if (pastInc.length >= 2) {
          const avgInc = pastInc.reduce((s, v) => s + v, 0) / pastInc.length
          if (payload.monthly.income < avgInc * 0.7) {
            add('16', `income-drop-${payload.month}`, {
              title: 'รายรับต่ำกว่าค่าเฉลี่ย',
              body: `รายรับเดือนนี้ ฿${Math.round(payload.monthly.income).toLocaleString('en-US')} ต่ำกว่าค่าเฉลี่ย ${pastInc.length} เดือนที่ผ่านมา (฿${Math.round(avgInc).toLocaleString('en-US')}) — ตรวจสอบว่ายังไม่ได้บันทึกรายรับบางส่วน`,
              severity: 'warning', urgency: 4, impact: 7,
              action: { label: 'ดูรายรับ', fn: "App.showPage('transactions')" },
              evidence: { income: payload.monthly.income, avgInc, months: pastInc.length },
            })
          }
        }
      }
    } catch(_) {}

    return insights
  }

  // ── Ranking ──────────────────────────────────────────────────
  function rankAndFilter(insights, store) {
    // dismissed = time-based: re-surfaces after DISMISS_TTL_MS (30 days)
    const dismissedMap = new Map((store.insights||[]).filter(i => i.state === 'dismissed' && i.dismissedAt).map(i => [i.id, new Date(i.dismissedAt).getTime()]))
    const snoozedMap  = new Map((store.insights||[]).filter(i => i.state === 'snoozed' && i.snoozedUntil).map(i => [i.id, i.snoozedUntil]))
    const seenMap     = new Map((store.insights||[]).map(i => [i.id, i.seenCount||0]))
    const ratingMap   = new Map((store.feedback||[]).map(f => [f.insightId, f.rating]))
    const hiddenTypes = new Set(store.hiddenTypes||[])
    const now = Date.now()

    const SEV_BONUS = { critical: 5, warning: 2, info: 0, positive: -1 }

    return insights
      .filter(i => {
        const dismissedAt = dismissedMap.get(i.id)
        if (dismissedAt && (now - dismissedAt) < DISMISS_TTL_MS) return false
        if (hiddenTypes.has(i.type)) return false
        const su = snoozedMap.get(i.id)
        if (su && new Date(su).getTime() > now) return false
        return true
      })
      .map(i => {
        const seenPenalty  = Math.min(3, seenMap.get(i.id)||0) * 0.5
        const ratingBonus  = ratingMap.get(i.id) === 'helpful' ? 2 : ratingMap.get(i.id) === 'not_helpful' ? -3 : 0
        const sevBonus     = (SEV_BONUS[i.severity]||0) * 0.3
        const score        = i.urgency * 0.4 + i.impact * 0.3 + sevBonus - seenPenalty + ratingBonus
        return { ...i, score }
      })
      .sort((a, b) => b.score - a.score)
  }

  // ── Main API ─────────────────────────────────────────────────
  function refresh(S_state) {
    const S = S_state || (typeof window !== 'undefined' && window.S) || {}
    const payload  = buildPayload(S)
    const hash     = payloadHash(payload)
    const store    = loadStore()

    if (!shouldRefresh(store, hash)) {
      return rankAndFilter(store.insights, store)
    }

    const rawInsights = runRules(payload)
    const merged = rawInsights.map(fresh => {
      const existing = (store.insights||[]).find(e => e.id === fresh.id)
      if (!existing) return fresh
      return {
        ...fresh,
        seenCount:    existing.seenCount || 0,
        lastSeenAt:   existing.lastSeenAt,
        state:        existing.state || 'active',
        snoozedUntil: existing.snoozedUntil,
        dismissedAt:  existing.dismissedAt,
        actedAt:      existing.actedAt,
        userRating:   existing.userRating,
      }
    })

    store.insights      = merged
    store.lastRefreshed = new Date().toISOString()
    store.payloadHash   = hash
    saveStore(store)

    return rankAndFilter(merged, store)
  }

  function getTopN(n, placement, S_state) {
    const ranked = refresh(S_state)
    const PLACEMENT_FILTER = {
      dashboard: i => i.severity === 'critical' || i.severity === 'warning' || i.urgency >= 6 || i.severity === 'positive',
      reports:   () => true,
      tx:        i => ['01','02','12'].includes(i.type),
    }
    const filter = PLACEMENT_FILTER[placement] || (() => true)
    return ranked.filter(filter).slice(0, n || 3)
  }

  function markSeen(id) {
    const store = loadStore()
    const ins = (store.insights||[]).find(i => i.id === id)
    if (ins) { ins.seenCount = (ins.seenCount||0) + 1; ins.lastSeenAt = new Date().toISOString() }
    saveStore(store)
  }

  function markDismissed(id) {
    const store = loadStore()
    const ins = (store.insights||[]).find(i => i.id === id)
    if (ins) { ins.state = 'dismissed'; ins.dismissedAt = new Date().toISOString() }
    else store.insights.push({ id, state: 'dismissed', dismissedAt: new Date().toISOString() })
    saveStore(store)
  }

  function markActed(id) {
    const store = loadStore()
    const ins = (store.insights||[]).find(i => i.id === id)
    if (ins) { ins.state = 'acted'; ins.actedAt = new Date().toISOString() }
    saveStore(store)
  }

  function snooze(id, days) {
    const store = loadStore()
    const ins = (store.insights||[]).find(i => i.id === id)
    const until = new Date(); until.setDate(until.getDate() + (days||1))
    if (ins) { ins.state = 'snoozed'; ins.snoozedUntil = until.toISOString() }
    else store.insights.push({ id, state: 'snoozed', snoozedUntil: until.toISOString() })
    saveStore(store)
  }

  function rate(id, rating) {
    const store = loadStore()
    store.feedback = (store.feedback||[]).filter(f => f.insightId !== id)
    store.feedback.push({ insightId: id, rating, at: new Date().toISOString() })
    const ins = (store.insights||[]).find(i => i.id === id)
    if (ins) ins.userRating = rating
    saveStore(store)
    try { FinanceIntelligence?.recommendationFeedback?.(id, rating, { source:'insight', type:ins?.type || '' }) } catch(_) {}
  }

  function invalidate() {
    const store = loadStore()
    store.lastRefreshed = null
    store.payloadHash   = ''
    store.insights      = []
    saveStore(store)
  }

  return {
    buildPayload, runRules, rankAndFilter,
    getTopN, refresh, markSeen, markDismissed, markActed, snooze, rate, invalidate,
    loadStore, saveStore,
  }
})()
