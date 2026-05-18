/* ============================================================
   Finance Intelligence Platform
   Phase 1: unified context + health scoring
   Phase 2: forecasts + scenarios + goal optimization
   Phase 3: behavior profile + memory + adaptive coaching
   ============================================================ */
'use strict'

const FinanceIntelligence = (() => {
  const PROFILE_KEY = 'mt_financial_profile'
  const MEMORY_KEY = 'mt_financial_memory'
  const FEEDBACK_KEY = 'mt_financial_recommendation_feedback'
  const FEATURE_KEY = 'mt_monthly_financial_features'
  const FEATURE_SCHEMA_VERSION = 2

  const round2 = n => Math.round((Number(n) || 0) * 100) / 100
  const avg = arr => {
    const rows = (arr || []).map(Number).filter(Number.isFinite)
    return rows.length ? rows.reduce((s,v)=>s+v,0) / rows.length : 0
  }
  const pct = (cur, prev) => Math.abs(Number(prev || 0)) > 0 ? ((Number(cur || 0) - Number(prev || 0)) / Math.abs(Number(prev || 0))) * 100 : null
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n || 0)))

  function currentMonth() {
    return typeof THIS_MONTH !== 'undefined'
      ? THIS_MONTH
      : new Date().toISOString().slice(0, 7)
  }

  function prevMonth(month) {
    return Calc.getPreviousMonth ? Calc.getPreviousMonth(month) : ''
  }

  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback } catch(_) { return fallback }
  }

  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch(_) {}
  }

  function recurringMonthlyAmount(r) {
    const amt = Number(r?.amount || 0)
    if (r?.frequency === 'weekly') return amt * 4.3
    if (r?.frequency === 'yearly') return amt / 12
    return amt
  }

  function normalizeMemory(entry = {}) {
    const month = entry.month || String(entry.startDate || '').slice(0,7) || currentMonth()
    return {
      id: entry.id || `mem-${Date.now().toString(36)}`,
      type: entry.type || 'general',
      title: entry.title || 'เหตุการณ์',
      note: entry.note || '',
      month,
      startDate: entry.startDate || `${month}-01`,
      endDate: entry.endDate || entry.startDate || `${month}-28`,
      amount: round2(entry.amount || 0),
      direction: entry.direction || (entry.type === 'bonus' ? 'income' : 'expense'),
      categoryIds: Array.isArray(entry.categoryIds) ? entry.categoryIds : [],
      merchantNames: Array.isArray(entry.merchantNames) ? entry.merchantNames : [],
      excludeFromBaseline: entry.excludeFromBaseline !== false,
      at: entry.at || new Date().toISOString(),
    }
  }

  function memoryForMonth(month) {
    return loadMemory().map(normalizeMemory).filter(m => m.month === month)
  }

  function memoryById(id) {
    return loadMemory().find(m => m.id === id) || null
  }

  function updateMemory(id, patch) {
    const rows = loadMemory().map(m => m.id === id ? normalizeMemory({ ...m, ...patch, id }) : m)
    saveJson(MEMORY_KEY, rows)
    return rows.find(m => m.id === id) || null
  }

  function deleteMemory(id) {
    const rows = loadMemory().filter(m => m.id !== id)
    saveJson(MEMORY_KEY, rows)
    return rows
  }

  function excludedAmountForMonth(month, direction) {
    return memoryForMonth(month)
      .filter(m => m.excludeFromBaseline && (!direction || m.direction === direction))
      .reduce((s,m)=>s+Number(m.amount || 0),0)
  }

  function buildContext(S) {
    const state = S || {}
    const month = currentMonth()
    const previousMonth = prevMonth(month)
    const txs = state.transactions || []
    const cats = state.categories || { expense: [], income: [] }
    const months = Calc.getMonths?.(6) || [month]
    const monthly = Calc.getMonthlyIncomeExpense(txs, month)
    const previous = Calc.getMonthlyIncomeExpense(txs, previousMonth)
    const history = months.map(m => {
      const s = Calc.getMonthlyIncomeExpense(txs, m)
      const excludedExpense = excludedAmountForMonth(m, 'expense')
      const excludedIncome = excludedAmountForMonth(m, 'income')
      const adjustedIncome = Math.max(0, Number(s.income || 0) - excludedIncome)
      const adjustedExpense = Math.max(0, Number(s.expense || 0) - excludedExpense)
      return {
        month:m, income:s.income, expense:s.expense, net:s.netCashflow, savingsRate:s.savingsRate,
        excludedExpense, excludedIncome,
        adjustedIncome, adjustedExpense, adjustedNet: adjustedIncome - adjustedExpense,
      }
    })
    const pastHistory = history.filter(h => h.month !== month && (h.income > 0 || h.expense > 0))
    const expenseCategories = Calc.getCategoryBreakdown(txs, month, { type:'expense', categories:cats.expense || [] })
    const previousExpenseCategories = Calc.getCategoryBreakdown(txs, previousMonth, { type:'expense', categories:cats.expense || [] })
    const merchantBreakdown = Calc.getMerchantBreakdown?.(txs, month) || []
    const budgets = Calc.getBudgetProgress(txs, state.budgets || [], cats, month) || []
    const usable = Calc.getUsableMoney?.(state.wallets || [], state) || { liquid:0, creditDebt:0, upcomingReserved:0, net:0 }
    const credit = Calc.getCreditLiabilitySummary?.(state.wallets || []) || { cards:[], totals:{ statementDue:0, currentCycleSpending:0, committedInstallments:0, totalLiability:0 } }
    const upcoming = typeof App !== 'undefined' && App.getUpcomingItems ? App.getUpcomingItems(30) : []
    const upcomingCommitted = upcoming
      .filter(r => ['credit_due','recurring','scheduled','installment'].includes(r.type))
      .reduce((s,r)=>s+Number(r.amount || 0),0)
    const recurring = (state.recurring || []).filter(r => !['inactive','cancelled'].includes(r.status))
    const recurringMonthlyTotal = recurring.reduce((s,r)=>s+recurringMonthlyAmount(r),0)
    const goals = (state.goals || []).filter(g => g.status === 'active').map(goal => {
      let progress = null
      try { progress = App.getGoalProgress?.(goal) || null } catch(_) {}
      return { goal, progress }
    })
    const avgExpense = avg(pastHistory.map(h => h.adjustedExpense))
    const avgIncome = avg(pastHistory.map(h => h.adjustedIncome))
    const avgNet = avg(pastHistory.map(h => h.adjustedNet))
    const day = new Date().getDate()
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate()
    const elapsedRatio = clamp(day / daysInMonth, 0.05, 1)
    const currentEvents = memoryForMonth(month)
    const projectedExpense = Math.max(0, monthly.expense - excludedAmountForMonth(month, 'expense')) / elapsedRatio
    const projectedIncome = monthly.income > 0 ? monthly.income : avgIncome
    const snapshots = [...(state.netWorthSnapshots || [])].sort((a,b)=>String(a.date).localeCompare(String(b.date)))
    const assets = Calc.getAssetBreakdown?.(state.wallets || [], { cryptoTotal: App.getCryptoPortfolioSummary?.()?.totalValueTHB || 0 }) || null

    return {
      month, previousMonth, txs, cats, monthly, previous, history, pastHistory,
      expenseCategories, previousExpenseCategories, merchantBreakdown, budgets,
      usable, credit, upcoming, upcomingCommitted, recurring, recurringMonthlyTotal,
      goals, avgExpense, avgIncome, avgNet, day, daysInMonth, elapsedRatio,
      projectedExpense, projectedIncome, snapshots, assets, events:currentEvents,
    }
  }

  function healthScore(ctx) {
    const liquidMonths = ctx.avgExpense > 0 ? ctx.usable.liquid / ctx.avgExpense : null
    const savingsRate = Number(ctx.monthly.savingsRate ?? 0)
    const debtRatio = ctx.monthly.income > 0 ? ctx.credit.totals.totalLiability / ctx.monthly.income : null
    const budgetOverruns = ctx.budgets.filter(b => b.monthlyLimit > 0 && b.spent > b.monthlyLimit).length
    const goalsOnTrack = ctx.goals.filter(({goal, progress}) => {
      if (!progress) return false
      if (goal.targetDate && progress.daysLeft < 0) return false
      if (progress.suggestedMonthly && goal.monthlyContribution > 0 && progress.suggestedMonthly > goal.monthlyContribution * 1.2) return false
      return true
    }).length
    const components = {
      liquidity: liquidMonths === null ? 50 : clamp(liquidMonths / 3 * 100, 0, 100),
      savings: clamp(savingsRate / 20 * 100, 0, 100),
      debt: debtRatio === null ? 70 : clamp((1 - debtRatio) * 100, 0, 100),
      discipline: clamp(100 - budgetOverruns * 25, 0, 100),
      goals: ctx.goals.length ? clamp(goalsOnTrack / ctx.goals.length * 100, 0, 100) : 60,
      resilience: clamp(((liquidMonths || 0) / 3 * 60) + ((ctx.upcomingCommitted > 0 && ctx.usable.liquid >= ctx.upcomingCommitted) ? 40 : 0), 0, 100),
    }
    const total = avg(Object.values(components))
    const grade = total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : total >= 40 ? 'D' : 'F'
    return { total:round2(total), grade, components, liquidMonths, debtRatio, budgetOverruns, goalsOnTrack }
  }

  function forecasts(ctx) {
    const budgetLimit = ctx.budgets.reduce((s,b)=>s+Number(b.monthlyLimit || 0),0)
    const budgetSpent = ctx.budgets.reduce((s,b)=>s+Number(b.spent || 0),0)
    const remainingDays = Math.max(0, ctx.daysInMonth - ctx.day)
    const adjustedExpenses = ctx.pastHistory.map(h => Number(h.adjustedExpense || 0)).filter(v => v > 0)
    const variance = avg(adjustedExpenses.map(v => (v - ctx.avgExpense) ** 2))
    const stdev = Math.sqrt(variance || 0)
    const spendForecast = round2(ctx.projectedExpense)
    const lowerBound = round2(Math.max(0, spendForecast - stdev))
    const upperBound = round2(spendForecast + stdev)
    const confidence = adjustedExpenses.length >= 5 ? 'high' : adjustedExpenses.length >= 3 ? 'medium' : 'low'
    const monthEndCash = round2(ctx.usable.liquid + (ctx.projectedIncome - spendForecast) - ctx.upcomingCommitted)
    const categories = ctx.expenseCategories.map(c => ({
      ...c,
      projected: round2(c.amount / ctx.elapsedRatio),
      previousAmount: Number(ctx.previousExpenseCategories.find(p => p.id === c.id)?.amount || 0),
    })).map(c => ({ ...c, deltaPct:pct(c.amount, c.previousAmount) }))
    const budgetRisk = ctx.budgets.map(b => {
      const projected = round2(Number(b.spent || 0) / ctx.elapsedRatio)
      const probability = b.monthlyLimit > 0 ? clamp(projected / b.monthlyLimit * 100, 0, 100) : 0
      return { ...b, projected, probability, risk: probability >= 100 ? 'high' : probability >= 85 ? 'medium' : 'low' }
    }).sort((a,b)=>b.probability-a.probability)
    const goalForecasts = ctx.goals.map(({goal, progress}) => {
      const remaining = Number(progress?.remaining || 0)
      const contribution = Number(goal.monthlyContribution || progress?.suggestedMonthly || 0)
      const monthsToGoal = contribution > 0 ? Math.ceil(remaining / contribution) : null
      return { goal, progress, monthsToGoal }
    })
    return {
      spendForecast, lowerBound, upperBound, confidence, monthEndCash, remainingDays, budgetLimit, budgetSpent,
      budgetRemaining: round2(budgetLimit - budgetSpent),
      categories, budgetRisk, goalForecasts,
    }
  }

  function runScenario(ctx, input = {}) {
    const incomeDelta = Number(input.incomeDelta || 0)
    const expenseDelta = Number(input.expenseDelta || 0)
    const oneOffExpense = Number(input.oneOffExpense || 0)
    const savingsDelta = Number(input.savingsDelta || 0)
    const debtPayment = Number(input.debtPayment || 0)
    const futureIncome = ctx.projectedIncome + incomeDelta
    const futureExpense = ctx.projectedExpense + expenseDelta + oneOffExpense
    const futureNet = futureIncome - futureExpense - savingsDelta - debtPayment
    const monthEndCash = ctx.usable.liquid + futureNet - ctx.upcomingCommitted
    const savingsRate = futureIncome > 0 ? ((futureIncome - futureExpense) / futureIncome) * 100 : null
    return {
      input,
      projectedIncome:round2(futureIncome),
      projectedExpense:round2(futureExpense),
      monthEndCash:round2(monthEndCash),
      savingsRate:savingsRate === null ? null : round2(savingsRate),
      debtAfterPayment:round2(Math.max(0, ctx.credit.totals.totalLiability - debtPayment)),
      risk: monthEndCash < 0 ? 'high' : monthEndCash < ctx.usable.liquid * 0.2 ? 'medium' : 'low',
    }
  }

  function goalOptimization(ctx) {
    const rows = ctx.goals.map(({goal, progress}) => {
      const remaining = Number(progress?.remaining || 0)
      const daysLeft = Number(progress?.daysLeft ?? 9999)
      const current = Number(goal.monthlyContribution || 0)
      const required = Number(progress?.suggestedMonthly || 0)
      const pressure = daysLeft < 0 ? 100 : daysLeft <= 90 ? 80 : daysLeft <= 180 ? 60 : 40
      const gap = Math.max(0, required - current)
      const score = pressure + Math.min(20, gap > 0 ? 20 : 0)
      return { goal, progress, gap, score }
    }).sort((a,b)=>b.score-a.score)
    const availableMonthly = Math.max(0, Number(ctx.projectedIncome || 0) - Number(ctx.projectedExpense || 0))
    let remainingCapacity = availableMonthly
    const allocation = rows.map(r => {
      const allocated = Math.min(r.gap, remainingCapacity)
      remainingCapacity -= allocated
      return { goalId:r.goal.id, goalName:r.goal.name, suggestedIncrease:round2(allocated), unmetGap:round2(Math.max(0, r.gap - allocated)) }
    })
    return {
      priorities: rows,
      totalSuggestedIncrease: round2(rows.reduce((s,r)=>s+r.gap,0)),
      availableMonthly: round2(availableMonthly),
      allocation,
    }
  }

  function behaviorProfile(ctx) {
    const byWeekday = Array.from({ length:7 }, () => 0)
    const postedExpenses = Calc.getPostedTransactions?.(ctx.txs)?.filter(t => t.type === 'expense') || []
    postedExpenses.forEach(t => {
      const d = new Date(t.date)
      byWeekday[d.getDay()] += Calc.getExpenseLedgerAmount(t)
    })
    const weekdays = byWeekday.slice(1,6)
    const weekend = byWeekday[0] + byWeekday[6]
    const weekdayAvg = weekdays.reduce((s,v)=>s+v,0) / 5 || 0
    const weekendAvg = weekend / 2 || 0
    const merchantCounts = {}
    postedExpenses.forEach(t => {
      const key = String(t.merchant || '').trim() || 'ไม่ระบุร้านค้า'
      merchantCounts[key] = (merchantCounts[key] || 0) + 1
    })
    const microSpend = postedExpenses.filter(t => Calc.getExpenseLedgerAmount(t) <= 200)
    const microSpendTotal = microSpend.reduce((s,t)=>s+Calc.getExpenseLedgerAmount(t),0)
    const currentTop = ctx.expenseCategories[0]
    const previousMap = new Map(ctx.previousExpenseCategories.map(c => [c.id, c]))
    const lifestyleInflation = ctx.expenseCategories
      .map(c => ({ ...c, delta: c.amount - Number(previousMap.get(c.id)?.amount || 0) }))
      .filter(c => c.delta > 0)
      .sort((a,b)=>b.delta-a.delta)[0] || null
    const essentialIds = new Set(['utility','health','education','transport'])
    const essential = ctx.expenseCategories.filter(c => essentialIds.has(c.id)).reduce((s,c)=>s+c.amount,0)
    const discretionary = Math.max(0, ctx.monthly.expense - essential)
    const recurringMerchantNames = new Set((ctx.recurring || []).map(r => String(r.merchant || r.name || '').toLowerCase()))
    const merchantRecurrence = Object.entries(merchantCounts)
      .filter(([name, count]) => count >= 2 && !recurringMerchantNames.has(name.toLowerCase()))
      .map(([name, count]) => ({ name, count }))
      .sort((a,b)=>b.count-a.count)
    const txByDay = {}
    postedExpenses.forEach(t => { const day = String(t.date || '').slice(-2); txByDay[day] = (txByDay[day] || 0) + Calc.getExpenseLedgerAmount(t) })
    return {
      weekendBias: weekdayAvg > 0 ? round2(weekendAvg / weekdayAvg) : null,
      microSpendCount: microSpend.length,
      microSpendTotal: round2(microSpendTotal),
      mostFrequentMerchant: Object.entries(merchantCounts).sort((a,b)=>b[1]-a[1])[0] || null,
      topCategory: currentTop || null,
      lifestyleInflation,
      essentialSpend: round2(essential),
      discretionarySpend: round2(discretionary),
      discretionaryRatio: ctx.monthly.expense > 0 ? round2(discretionary / ctx.monthly.expense) : null,
      recurringCandidates: merchantRecurrence,
      paydayWindowSpend: round2(Object.entries(txByDay).filter(([day]) => Number(day) <= 5).reduce((s,[,v])=>s+v,0)),
    }
  }

  function sharedFinance(state = {}) {
    const bills = state.splitBills || []
    const people = new Map((state.splitPeople || []).map(p => [p.id, p]))
    let receivable = 0
    let payable = 0
    let sharedExpense = 0
    const balances = {}
    bills.forEach(bill => {
      try {
        const result = typeof SplitBillCalc !== 'undefined' ? SplitBillCalc.calcResult(bill) : null
        if (!result) return
        sharedExpense += Number(result.finalTotal || 0)
        ;(result.personResults || []).forEach(p => {
          balances[p.id] = (balances[p.id] || 0) + Number(p.net || 0)
        })
      } catch(_) {}
    })
    Object.values(balances).forEach(v => {
      if (v > 0) receivable += v
      if (v < 0) payable += Math.abs(v)
    })
    const rows = Object.entries(balances).map(([id, net]) => ({
      id, name:people.get(id)?.name || 'ไม่ทราบชื่อ', net:round2(net),
    })).sort((a,b)=>Math.abs(b.net)-Math.abs(a.net))
    return {
      billCount:bills.length,
      receivable:round2(receivable),
      payable:round2(payable),
      netSettlement:round2(receivable - payable),
      sharedExpense:round2(sharedExpense),
      balances:rows,
    }
  }

  function actionProposals(ctx) {
    const rows = []
    const recurringNames = new Set((ctx.recurring || []).map(r => String(r.merchant || r.name || '').toLowerCase()))
    const repeatedMerchant = ctx.merchantBreakdown?.find(m => Number(m.count || 0) >= 2 && !recurringNames.has(String(m.merchant || '').toLowerCase()))
    if (repeatedMerchant) {
      rows.push({
        id:'create-recurring-from-merchant',
        type:'create_recurring',
        title:`เพิ่ม "${repeatedMerchant.merchant}" เป็นรายการประจำ`,
        rationale:'พบหลายครั้งในเดือนนี้และยังไม่ได้ตั้งเป็น recurring',
        preview:`สร้างรายการประจำประมาณ ${Math.round(repeatedMerchant.amount / repeatedMerchant.count)} บาท`,
        payload:{ merchant:repeatedMerchant.merchant, amount:round2(repeatedMerchant.amount / repeatedMerchant.count) },
      })
    }
    const h = healthScore(ctx)
    if (h.components.liquidity < 60 && !(ctx.goals || []).some(({goal}) => /ฉุกเฉิน/.test(goal.name || ''))) {
      rows.push({
        id:'create-emergency-goal',
        type:'create_goal',
        title:'สร้างเป้าหมายเงินสำรองฉุกเฉิน',
        rationale:'เงินสำรองยังต่ำกว่าเกณฑ์พื้นฐาน',
        preview:`ตั้งเป้า ${Math.round((ctx.avgExpense || 0) * 3)} บาท`,
        payload:{ targetAmount:round2((ctx.avgExpense || 0) * 3) },
      })
    }
    return rows
  }

  function loadProfile() {
    return loadJson(PROFILE_KEY, {
      riskPreference:'balanced',
      primaryFocus:'resilience',
      preferredSavingsRate:20,
      coachingStyle:'balanced',
      updatedAt:null,
    })
  }

  function saveProfile(profile) {
    const next = { ...loadProfile(), ...profile, updatedAt:new Date().toISOString() }
    saveJson(PROFILE_KEY, next)
    return next
  }

  function loadMemory() {
    return loadJson(MEMORY_KEY, []).map(normalizeMemory)
  }

  function remember(entry) {
    const list = loadMemory()
    list.unshift(normalizeMemory(entry))
    saveJson(MEMORY_KEY, list.slice(0, 100))
    return list[0]
  }

  function recommendationFeedback(id, rating, meta = {}) {
    const list = loadJson(FEEDBACK_KEY, [])
    const next = list.filter(x => !(x.id === id && x.rating === rating))
    next.push({ id, rating, type:meta.type || '', source:meta.source || '', at:new Date().toISOString() })
    saveJson(FEEDBACK_KEY, next.slice(-200))
  }

  function recommendationFeedbackMap() {
    const rows = loadJson(FEEDBACK_KEY, [])
    const map = new Map()
    rows.forEach(r => {
      const cur = map.get(r.id) || { helpful:0, not_helpful:0, acted:0, snoozed:0 }
      if (r.rating === 'helpful') cur.helpful++
      if (r.rating === 'not_helpful') cur.not_helpful++
      if (r.rating === 'acted') cur.acted++
      if (r.rating === 'snoozed') cur.snoozed++
      map.set(r.id, cur)
    })
    return map
  }

  function recommendationFeedbackSummary() {
    const rows = loadJson(FEEDBACK_KEY, [])
    const byType = {}
    rows.forEach(r => {
      const key = r.type || r.id || 'unknown'
      const cur = byType[key] || { helpful:0, not_helpful:0, acted:0, snoozed:0 }
      if (r.rating in cur) cur[r.rating]++
      byType[key] = cur
    })
    return byType
  }

  function adaptiveRecommendations(ctx) {
    const profile = loadProfile()
    const h = healthScore(ctx)
    const f = forecasts(ctx)
    const g = goalOptimization(ctx)
    const b = behaviorProfile(ctx)
    const rows = []
    if (h.components.liquidity < 60) rows.push({ id:'build-emergency-fund', priority:profile.primaryFocus === 'resilience' ? 105 : 95, title:'เร่งสร้างเงินสำรอง', body:'เงินสำรองยังต่ำกว่าเกณฑ์พื้นฐาน ควรกันเงินก่อนลงทุนเพิ่ม' })
    if (f.monthEndCash < 0) rows.push({ id:'protect-cashflow', priority:100, title:'ป้องกันเงินสดติดลบ', body:'คาดการณ์สิ้นเดือนอาจติดลบ ควรลดรายจ่ายและกันเงินสำหรับบิลก่อน' })
    if (f.budgetRisk[0]?.risk === 'high') rows.push({ id:'fix-budget-overrun', priority:85, title:`คุมงบ ${f.budgetRisk[0].label}`, body:`แนวโน้มอาจใช้ถึง ${Math.round(f.budgetRisk[0].projected)} บาท` })
    if (g.priorities[0]?.gap > 0) rows.push({ id:'repair-goal-plan', priority:profile.primaryFocus === 'goals' ? 90 : 70, title:`เร่งเป้าหมาย ${g.priorities[0].goal.name}`, body:`ควรเพิ่มเงินออมอีกประมาณ ${Math.round(g.priorities[0].gap)} บาทต่อเดือน` })
    if (b.weekendBias && b.weekendBias > 1.25) rows.push({ id:'watch-weekend-spend', priority:50, title:'จับตารายจ่ายช่วงวันหยุด', body:'ค่าใช้จ่ายเฉลี่ยวันหยุดสูงกว่าวันธรรมดาชัดเจน' })
    if (b.microSpendTotal > ctx.monthly.expense * 0.2 && ctx.monthly.expense > 0) rows.push({ id:'trim-micro-spend', priority:55, title:'รายจ่ายเล็กสะสมสูง', body:`รายการไม่เกิน 200 บาทรวม ${Math.round(b.microSpendTotal)} บาท` })
    const feedback = recommendationFeedbackMap()
    return rows.map(r => {
      const f = feedback.get(r.id)
      const learned = f ? (f.helpful * 8) + (f.acted * 12) - (f.not_helpful * 14) - (f.snoozed * 3) : 0
      return { ...r, learnedPriority: r.priority + learned, feedback:f || null }
    }).sort((a,b)=>b.learnedPriority-a.learnedPriority)
  }

  function monthlyAutopilot(ctx) {
    const h = healthScore(ctx)
    const f = forecasts(ctx)
    const recs = adaptiveRecommendations(ctx)
    return {
      openingPlan: {
        reserveForBills: round2(ctx.upcomingCommitted),
        suggestedSavings: round2(Math.max(0, ctx.projectedIncome * (loadProfile().preferredSavingsRate || 20) / 100)),
        topFocus: recs[0] || null,
      },
      closingReview: {
        health: h,
        projectedMonthEndCash: f.monthEndCash,
        topLearning: recs[0]?.title || 'ยังไม่มีประเด็นเด่น',
      },
    }
  }

  function featureForMonth(S, month) {
    const state = S || {}
    const txs = state.transactions || []
    const cats = state.categories || { expense: [], income: [] }
    const monthly = Calc.getMonthlyIncomeExpense(txs, month)
    const expenseCategories = Calc.getCategoryBreakdown(txs, month, { type:'expense', categories:cats.expense || [] })
    const previousExpenseCategories = Calc.getCategoryBreakdown(txs, prevMonth(month), { type:'expense', categories:cats.expense || [] })
    const ctx = buildContext({ ...state, transactions:txs })
    const previousMap = new Map(previousExpenseCategories.map(c => [c.id, c]))
    return {
      schemaVersion:FEATURE_SCHEMA_VERSION,
      month,
      generatedAt:new Date().toISOString(),
      metrics:{
        income:round2(monthly.income),
        expense:round2(monthly.expense),
        adjustedIncome:round2(Math.max(0, monthly.income - excludedAmountForMonth(month, 'income'))),
        adjustedExpense:round2(Math.max(0, monthly.expense - excludedAmountForMonth(month, 'expense'))),
        savingsRate:monthly.savingsRate,
      },
      behavior:{
        topCategory:expenseCategories[0] || null,
        biggestCategoryIncrease: expenseCategories
          .map(c => ({ ...c, delta:c.amount - Number(previousMap.get(c.id)?.amount || 0) }))
          .sort((a,b)=>b.delta-a.delta)[0] || null,
      },
      events:memoryForMonth(month),
      health:month === currentMonth() ? healthScore(ctx) : null,
    }
  }

  function loadFeatureStore() {
    const raw = loadJson(FEATURE_KEY, { version:FEATURE_SCHEMA_VERSION, rows:[] })
    if (Array.isArray(raw)) return { version:1, rows:raw }
    return raw && Array.isArray(raw.rows) ? raw : { version:FEATURE_SCHEMA_VERSION, rows:[] }
  }

  function saveFeatureStore(rows) {
    saveJson(FEATURE_KEY, { version:FEATURE_SCHEMA_VERSION, rows })
  }

  function rebuildFeatureStore(S, monthsBack = 12) {
    const months = Calc.getMonths?.(monthsBack) || [currentMonth()]
    const rows = months.map(m => featureForMonth(S, m))
    saveFeatureStore(rows)
    return rows
  }

  return {
    buildContext, healthScore, forecasts, runScenario, goalOptimization,
    behaviorProfile, loadProfile, saveProfile, loadMemory, remember,
    memoryForMonth, memoryById, updateMemory, deleteMemory,
    recommendationFeedback, recommendationFeedbackMap, recommendationFeedbackSummary,
    adaptiveRecommendations, monthlyAutopilot, sharedFinance, actionProposals, featureForMonth,
    loadFeatureStore, rebuildFeatureStore,
  }
})()

if (typeof module !== 'undefined') module.exports = FinanceIntelligence
