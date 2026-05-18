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
  const FEEDBACK_RATINGS = new Set(['helpful','not_relevant','already_knew','acted','snoozed','hide_type'])
  const ACTION_LOG_KEY = 'mt_financial_action_log'
  const LIFE_PLAN_KEY = 'mt_financial_life_plans'

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
    const accuracy = forecastAccuracySummary()
    const confidence = adjustedExpenses.length >= 5 && (accuracy.mape === null || accuracy.mape <= 0.2)
      ? 'high'
      : adjustedExpenses.length >= 3 ? 'medium' : 'low'
    const monthEndCash = round2(ctx.usable.liquid + (ctx.projectedIncome - spendForecast) - ctx.upcomingCommitted)
    const categories = ctx.expenseCategories.map(c => ({
      ...c,
      seasonality: categorySeasonality(c.id),
      projected: round2((c.amount / ctx.elapsedRatio) * categorySeasonality(c.id).factor),
      previousAmount: Number(ctx.previousExpenseCategories.find(p => p.id === c.id)?.amount || 0),
    })).map(c => ({ ...c, deltaPct:pct(c.amount, c.previousAmount), accuracy:categoryForecastAccuracy(c.id) }))
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
      spendForecast, lowerBound, upperBound, confidence, accuracy, monthEndCash, remainingDays, budgetLimit, budgetSpent,
      budgetRemaining: round2(budgetLimit - budgetSpent),
      categories, budgetRisk, goalForecasts,
    }
  }

  function categorySeasonality(categoryId) {
    const rows = loadFeatureStore().rows
    const currentMonthNo = Number(currentMonth().slice(-2))
    const sameMonth = rows.map(r => ({
      month:r.month,
      amount:Number(r.categoryActuals?.[categoryId] || 0),
      monthNo:Number(String(r.month || '').slice(-2)),
    })).filter(r => r.amount > 0)
    const sameMonthRows = sameMonth.filter(r => r.monthNo === currentMonthNo)
    const baseline = avg(sameMonth.map(r => r.amount))
    const sameMonthAvg = avg(sameMonthRows.map(r => r.amount))
    const factor = baseline > 0 && sameMonthAvg > 0 ? clamp(sameMonthAvg / baseline, 0.75, 1.35) : 1
    return { factor:round2(factor), sampleSize:sameMonthRows.length }
  }

  function categoryForecastAccuracy(categoryId) {
    const rows = loadFeatureStore().rows
      .map(r => ({
        predicted:Number(r.categoryForecasts?.[categoryId]),
        actual:Number(r.categoryActuals?.[categoryId]),
      }))
      .filter(r => Number.isFinite(r.predicted) && r.predicted > 0 && Number.isFinite(r.actual) && r.actual >= 0)
    if (!rows.length) return { count:0, mape:null }
    return {
      count:rows.length,
      mape:round2(avg(rows.map(r => Math.abs(r.actual-r.predicted) / Math.max(1, r.actual)))),
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

  function compareScenarios(ctx, scenarios = []) {
    const baseline = runScenario(ctx, {})
    return scenarios.map((scenario, index) => {
      const result = runScenario(ctx, scenario.input || {})
      return {
        id: scenario.id || `scenario-${index + 1}`,
        name: scenario.name || `Scenario ${index + 1}`,
        note: scenario.note || '',
        ...result,
        deltaCash: round2(result.monthEndCash - baseline.monthEndCash),
        deltaSavingsRate: result.savingsRate === null || baseline.savingsRate === null
          ? null
          : round2(result.savingsRate - baseline.savingsRate),
      }
    })
  }

  function goalOptimization(ctx) {
    const rows = ctx.goals.map(({goal, progress}) => {
      const remaining = Number(progress?.remaining || 0)
      const daysLeft = Number(progress?.daysLeft ?? 9999)
      const current = Number(goal.monthlyContribution || 0)
      const required = Number(progress?.suggestedMonthly || 0)
      const pressure = daysLeft < 0 ? 100 : daysLeft <= 90 ? 80 : daysLeft <= 180 ? 60 : 40
      const gap = Math.max(0, required - current)
      const type = /ฉุกเฉิน/.test(goal.name || '') ? 'emergency'
        : /หนี้|debt/.test(goal.name || '') ? 'debt'
        : daysLeft <= 180 ? 'near_term'
        : 'long_term'
      const typeBoost = { emergency:40, debt:30, near_term:20, long_term:0 }[type]
      const score = pressure + Math.min(20, gap > 0 ? 20 : 0) + typeBoost
      const minContribution = Number(goal.minimumContribution || 0)
      return { goal, progress, gap, score, type, minContribution }
    }).sort((a,b)=>b.score-a.score)
    const availableMonthly = Math.max(0, Number(ctx.projectedIncome || 0) - Number(ctx.projectedExpense || 0))
    let remainingCapacity = availableMonthly
    const allocation = rows.map(r => {
      const baseline = Math.min(r.minContribution, remainingCapacity)
      remainingCapacity -= baseline
      const allocated = Math.min(r.gap, remainingCapacity)
      remainingCapacity -= allocated
      return {
        goalId:r.goal.id,
        goalName:r.goal.name,
        type:r.type,
        baselineContribution:round2(baseline),
        suggestedIncrease:round2(allocated),
        unmetGap:round2(Math.max(0, r.gap - allocated)),
      }
    })
    return {
      priorities: rows,
      totalSuggestedIncrease: round2(rows.reduce((s,r)=>s+r.gap,0)),
      availableMonthly: round2(availableMonthly),
      allocation,
    }
  }

  function goalRebalanceScenarios(ctx) {
    const base = goalOptimization(ctx)
    const makeScenario = (name, factorMap) => {
      const rows = base.priorities.map(r => {
        const factor = factorMap[r.type] ?? 1
        return { ...r, adjustedGap:round2(r.gap * factor) }
      })
      let remaining = base.availableMonthly
      const allocation = rows.map(r => {
        const amount = Math.min(r.adjustedGap, remaining)
        remaining -= amount
        return { goalName:r.goal.name, type:r.type, amount:round2(amount) }
      })
      return { name, allocation, unallocated:round2(remaining) }
    }
    return [
      makeScenario('สมดุล', {}),
      makeScenario('เร่งความมั่นคง', { emergency:1.3, long_term:0.7 }),
      makeScenario('เร่งเป้าหมายใกล้ถึง', { near_term:1.3, long_term:0.7 }),
    ]
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
    const semiEssentialIds = new Set(['food'])
    const classified = ctx.expenseCategories.map(c => ({
      ...c,
      class: essentialIds.has(c.id) ? 'essential' : semiEssentialIds.has(c.id) ? 'semi_essential' : 'discretionary',
    }))
    const essential = classified.filter(c => c.class === 'essential').reduce((s,c)=>s+c.amount,0)
    const semiEssential = classified.filter(c => c.class === 'semi_essential').reduce((s,c)=>s+c.amount,0)
    const discretionary = Math.max(0, ctx.monthly.expense - essential)
    const recurringMerchantNames = new Set((ctx.recurring || []).map(r => String(r.merchant || r.name || '').toLowerCase()))
    const merchantRecurrence = Object.entries(merchantCounts)
      .filter(([name, count]) => count >= 2 && !recurringMerchantNames.has(name.toLowerCase()))
      .map(([name, count]) => ({ name, count }))
      .sort((a,b)=>b.count-a.count)
    const txByDay = {}
    postedExpenses.forEach(t => { const day = String(t.date || '').slice(-2); txByDay[day] = (txByDay[day] || 0) + Calc.getExpenseLedgerAmount(t) })
    const merchantRules = postedExpenses.reduce((acc, t) => {
      const merchant = String(t.merchant || '').toLowerCase()
      if (/netflix|spotify|youtube|apple/.test(merchant)) acc.subscriptionLike += Calc.getExpenseLedgerAmount(t)
      if (/grab|bolt|taxi/.test(merchant)) acc.transportConvenience += Calc.getExpenseLedgerAmount(t)
      if (/shopee|lazada/.test(merchant)) acc.marketplace += Calc.getExpenseLedgerAmount(t)
      return acc
    }, { subscriptionLike:0, transportConvenience:0, marketplace:0 })
    return {
      weekendBias: weekdayAvg > 0 ? round2(weekendAvg / weekdayAvg) : null,
      microSpendCount: microSpend.length,
      microSpendTotal: round2(microSpendTotal),
      mostFrequentMerchant: Object.entries(merchantCounts).sort((a,b)=>b[1]-a[1])[0] || null,
      topCategory: currentTop || null,
      lifestyleInflation,
      essentialSpend: round2(essential),
      semiEssentialSpend: round2(semiEssential),
      discretionarySpend: round2(discretionary),
      discretionaryRatio: ctx.monthly.expense > 0 ? round2(discretionary / ctx.monthly.expense) : null,
      categoryClasses: classified,
      recurringCandidates: merchantRecurrence,
      paydayWindowSpend: round2(Object.entries(txByDay).filter(([day]) => Number(day) <= 5).reduce((s,[,v])=>s+v,0)),
      merchantRules:{
        subscriptionLike:round2(merchantRules.subscriptionLike),
        transportConvenience:round2(merchantRules.transportConvenience),
        marketplace:round2(merchantRules.marketplace),
      },
    }
  }

  function inferredArchetype(ctx) {
    const h = healthScore(ctx)
    const b = behaviorProfile(ctx)
    if (h.components.liquidity < 45) return { id:'stabilizer', label:'สายตั้งหลัก', focus:'resilience' }
    if (ctx.credit?.totals?.totalLiability > Math.max(1, ctx.monthly.income) * 0.5) return { id:'debt_clearer', label:'สายเคลียร์หนี้', focus:'debt' }
    if ((ctx.goals || []).length >= 2) return { id:'goal_builder', label:'สายพิชิตเป้าหมาย', focus:'goals' }
    if ((ctx.assets?.netWorth || 0) > (ctx.avgExpense || 0) * 6) return { id:'wealth_builder', label:'สายต่อยอดสินทรัพย์', focus:'growth' }
    if ((b.discretionaryRatio || 0) > 0.45) return { id:'optimizer', label:'สายปรับพฤติกรรม', focus:'discipline' }
    return { id:'balanced', label:'สายสมดุล', focus:'balanced' }
  }

  function personalizedGuidance(ctx) {
    const profile = loadProfile()
    const archetype = inferredArchetype(ctx)
    const h = healthScore(ctx)
    const b = behaviorProfile(ctx)
    const topLever = h.components.liquidity < 60
      ? 'กันเงินสำรองก่อน'
      : b.microSpendTotal > ctx.monthly.expense * 0.15
        ? 'ลดรายจ่ายย่อยสะสม'
        : profile.primaryFocus === 'goals'
          ? 'เร่งเป้าหมายหลัก'
          : 'รักษา cashflow ให้เสถียร'
    return {
      archetype,
      preferredTone: profile.coachingStyle,
      scorecard: {
        resilience: round2(h.components.resilience),
        discipline: round2(h.components.discipline),
        goalReadiness: round2(h.components.goals),
      },
      topLever,
      recommendedFocus: profile.primaryFocus === 'resilience' && archetype.focus !== 'balanced'
        ? archetype.focus
        : profile.primaryFocus,
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

  function proactiveBrief(ctx) {
    const h = healthScore(ctx)
    const f = forecasts(ctx)
    const recs = adaptiveRecommendations(ctx)
    const shared = sharedFinance(typeof S !== 'undefined' ? S : {})
    const alerts = []
    if (f.monthEndCash < 0) alerts.push({ level:'high', title:'เงินสดสิ้นเดือนเสี่ยงติดลบ', body:`คาดการณ์ ${Math.round(f.monthEndCash)} บาท` })
    if (f.budgetRisk[0]?.risk === 'high') alerts.push({ level:'medium', title:`งบ ${f.budgetRisk[0].label} เสี่ยงเกิน`, body:`แนวโน้ม ${Math.round(f.budgetRisk[0].projected)} บาท` })
    if (shared.receivable > 0) alerts.push({ level:'info', title:'มีเงินรอรับจากหารบิล', body:`ประมาณ ${Math.round(shared.receivable)} บาท` })
    return {
      generatedAt:new Date().toISOString(),
      headline: h.total >= 70 ? 'ภาพรวมยังแข็งแรง' : 'มีจุดที่ควรดูแลวันนี้',
      today: {
        health:h,
        projectedMonthEndCash:f.monthEndCash,
        remainingBudget:f.budgetRemaining,
      },
      alerts,
      nextBestAction: recs[0] || null,
      openingBrief: monthlyAutopilot(ctx).openingPlan,
      closingBrief: monthlyAutopilot(ctx).closingReview,
    }
  }

  function normalizeLifePlan(plan = {}) {
    const targetDate = plan.targetDate || ''
    const targetAmount = round2(plan.targetAmount || 0)
    const currentAmount = round2(plan.currentAmount || 0)
    return {
      id: plan.id || `life-${Date.now().toString(36)}`,
      type: plan.type || 'other',
      title: plan.title || 'แผนชีวิต',
      targetAmount,
      currentAmount,
      targetDate,
      priority: plan.priority || 'medium',
      linkedGoalId: plan.linkedGoalId || '',
      createdAt: plan.createdAt || new Date().toISOString(),
    }
  }

  function loadLifePlans() {
    return loadJson(LIFE_PLAN_KEY, []).map(normalizeLifePlan)
  }

  function saveLifePlan(plan) {
    const rows = loadLifePlans()
    const next = normalizeLifePlan(plan)
    const idx = rows.findIndex(r => r.id === next.id)
    if (idx >= 0) rows[idx] = next
    else rows.unshift(next)
    saveJson(LIFE_PLAN_KEY, rows.slice(0,100))
    return next
  }

  function deleteLifePlan(id) {
    const rows = loadLifePlans().filter(p => p.id !== id)
    saveJson(LIFE_PLAN_KEY, rows)
    return rows
  }

  function lifePlanningSummary(ctx) {
    const today = new Date()
    const plans = loadLifePlans().map(plan => {
      const remaining = Math.max(0, plan.targetAmount - plan.currentAmount)
      const monthsLeft = plan.targetDate
        ? Math.max(1, Math.ceil((new Date(plan.targetDate) - today) / (1000 * 60 * 60 * 24 * 30.4375)))
        : null
      const requiredMonthly = monthsLeft ? round2(remaining / monthsLeft) : null
      return { ...plan, remaining, monthsLeft, requiredMonthly }
    })
    const requiredMonthlyTotal = round2(plans.reduce((s,p)=>s+Number(p.requiredMonthly || 0),0))
    const availableMonthly = round2(Math.max(0, Number(ctx.projectedIncome || 0) - Number(ctx.projectedExpense || 0)))
    return {
      plans,
      requiredMonthlyTotal,
      availableMonthly,
      gap: round2(Math.max(0, requiredMonthlyTotal - availableMonthly)),
      feasible: requiredMonthlyTotal <= availableMonthly,
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
    const normalizedRating = FEEDBACK_RATINGS.has(rating) ? rating : 'helpful'
    const list = loadJson(FEEDBACK_KEY, [])
    const next = list.filter(x => !(x.id === id && x.rating === normalizedRating))
    next.push({
      id,
      rating: normalizedRating,
      type:meta.type || '',
      source:meta.source || '',
      reason:meta.reason || '',
      context:meta.context || null,
      at:new Date().toISOString(),
    })
    saveJson(FEEDBACK_KEY, next.slice(-200))
  }

  function recommendationFeedbackMap() {
    const rows = loadJson(FEEDBACK_KEY, [])
    const map = new Map()
    rows.forEach(r => {
      const cur = map.get(r.id) || { helpful:0, not_relevant:0, already_knew:0, acted:0, snoozed:0, hide_type:0 }
      if (r.rating === 'helpful') cur.helpful++
      if (r.rating === 'not_relevant') cur.not_relevant++
      if (r.rating === 'already_knew') cur.already_knew++
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
      const cur = byType[key] || { helpful:0, not_relevant:0, already_knew:0, acted:0, snoozed:0, hide_type:0 }
      if (r.rating in cur) cur[r.rating]++
      byType[key] = cur
    })
    return byType
  }

  function loadActionLog() {
    return loadJson(ACTION_LOG_KEY, [])
  }

  function recordActionLog(entry) {
    const rows = loadActionLog()
    rows.unshift({ id:`act-${Date.now().toString(36)}`, at:new Date().toISOString(), undoneAt:null, ...entry })
    saveJson(ACTION_LOG_KEY, rows.slice(0,100))
    return rows[0]
  }

  function markActionUndone(id) {
    const rows = loadActionLog().map(r => r.id === id ? { ...r, undoneAt:new Date().toISOString() } : r)
    saveJson(ACTION_LOG_KEY, rows)
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
    const personalization = personalizedGuidance(ctx)
    if (personalization.archetype.id === 'optimizer' && b.merchantRules.marketplace > 0) rows.push({ id:'reduce-marketplace-drift', priority:58, title:'ช้อป marketplace เริ่มเด่น', body:`เดือนนี้รวม ${Math.round(b.merchantRules.marketplace)} บาท` })
    const feedback = recommendationFeedbackMap()
    return rows.map(r => {
      const f = feedback.get(r.id)
      const outcomeBoost = loadJson(FEEDBACK_KEY, []).filter(x => x.id === r.id && x.source === 'outcome').length * 6
      const learned = (f ? (f.helpful * 8) + (f.acted * 12) - (f.not_relevant * 14) - (f.already_knew * 5) - (f.snoozed * 3) - (f.hide_type * 100) : 0) + outcomeBoost
      return { ...r, learnedPriority: r.priority + learned, feedback:f || null }
    }).sort((a,b)=>b.learnedPriority-a.learnedPriority)
  }

  function recordRecommendationOutcome(id, outcome, metrics = {}) {
    recommendationFeedback(id, 'acted', { source:'outcome', context:{ outcome, metrics } })
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
    const categoryActuals = Object.fromEntries(expenseCategories.map(c => [c.id, round2(c.amount)]))
    const categoryForecasts = Object.fromEntries(expenseCategories.map(c => [c.id, round2(c.amount)]))
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
      categoryActuals,
      categoryForecasts,
      events:memoryForMonth(month),
      health:month === currentMonth() ? healthScore(ctx) : null,
      forecast:{
        predictedExpense: month === currentMonth() ? forecasts(ctx).spendForecast : null,
        actualExpense:round2(monthly.expense),
      },
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

  function forecastAccuracyRows() {
    return loadFeatureStore().rows
      .map(r => ({
        month:r.month,
        predicted:Number(r.forecast?.predictedExpense),
        actual:Number(r.forecast?.actualExpense),
      }))
      .filter(r => Number.isFinite(r.predicted) && r.predicted > 0 && Number.isFinite(r.actual) && r.actual >= 0)
  }

  function forecastAccuracySummary() {
    const rows = forecastAccuracyRows()
    if (!rows.length) return { count:0, mape:null, bias:null }
    const ape = rows.map(r => Math.abs(r.actual - r.predicted) / Math.max(1, r.actual))
    const bias = rows.map(r => r.predicted - r.actual)
    return {
      count:rows.length,
      mape:round2(avg(ape)),
      bias:round2(avg(bias)),
    }
  }

  return {
    buildContext, healthScore, forecasts, runScenario, compareScenarios, goalOptimization, goalRebalanceScenarios,
    behaviorProfile, inferredArchetype, personalizedGuidance, loadProfile, saveProfile, loadMemory, remember,
    memoryForMonth, memoryById, updateMemory, deleteMemory,
    recommendationFeedback, recommendationFeedbackMap, recommendationFeedbackSummary, recordRecommendationOutcome,
    loadActionLog, recordActionLog, markActionUndone,
    adaptiveRecommendations, monthlyAutopilot, proactiveBrief, sharedFinance, actionProposals, featureForMonth,
    loadLifePlans, saveLifePlan, deleteLifePlan, lifePlanningSummary,
    loadFeatureStore, rebuildFeatureStore, forecastAccuracyRows, forecastAccuracySummary, categoryForecastAccuracy, categorySeasonality,
  }
})()

if (typeof module !== 'undefined') module.exports = FinanceIntelligence
