;(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory()
  else root.CreditCardCycles = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const DAY_MS = 86400000

  function pad2(n) { return String(n).padStart(2, '0') }

  function parseDate(dateStr) {
    const [y, m, d] = String(dateStr || '').slice(0, 10).split('-').map(Number)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '')) || !y || !m || !d) return null
    const date = new Date(y, m - 1, d)
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null
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

  const cents = value => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : 0
  const baht = value => value / 100
  function parseStatementId(card, value) {
    const prefix = `${card?.id}:`
    if (!String(value || '').startsWith(prefix)) return null
    const parts = String(value).slice(prefix.length).split(':')
    if (parts.length !== 2 || !parseDate(parts[0]) || !parseDate(parts[1]) || parts[0] > parts[1] || daysBetween(parts[1], parts[0]) > 62) return null
    return { id:value, start:parts[0], end:parts[1], dueDate:resolveDueDate(card, parts[1]) }
  }

  function prepareBillingMigration({ wallets = [], transactions = [], refDate }) {
    let changed = false
    const diagnostics = []
    const next = wallets.map(card => {
      if (card?.type !== 'credit' || !parseDate(refDate)) return card
      const relevant = transactions.filter(tx => tx && (tx.walletId === card.id || tx.toWalletId === card.id))
      const periods = new Map()
      for (const p of card.ccBilling?.periods || []) {
        const parsed = parseStatementId(card, p.id)
        if (parsed && parsed.start === p.start && parsed.end === p.end && parseDate(p.dueDate)) periods.set(p.id, {...parsed, dueDate:p.dueDate})
      }
      for (const tx of relevant) {
        const tagged = parseStatementId(card, tx.statementId)
        if (tagged && !periods.has(tagged.id)) periods.set(tagged.id, tagged)
        if (parseDate(tx.date) && String(tx.date) <= refDate && ['expense','transfer'].includes(tx.type) && tx.walletId === card.id) {
          const period = getStatementPeriod(card, tx.date, {includeOpen:true})
          if (period.end < refDate && ![...periods.values()].some(p => tx.date >= p.start && tx.date <= p.end)) {
            const id = statementId(card.id, period.start, period.end)
            periods.set(id, {id,...period,dueDate:resolveDueDate(card, period.end)})
          }
        }
      }
      // Freeze every closed boundary, even empty periods, before settings change.
      let cursor = refDate
      const earliest = relevant.map(tx => String(tx.date || '')).filter(d => parseDate(d) && d <= refDate).sort()[0] || refDate
      for (let i=0; i<2400; i++) {
        const p = getStatementPeriod(card,cursor)
        if (!p) break
        const id=statementId(card.id,p.start,p.end)
        if (![...periods.values()].some(old => old.end === p.end)) periods.set(id,{id,...p,dueDate:resolveDueDate(card,p.end)})
        if (p.end < earliest) break
        cursor=p.start
      }
      const oldOpening = card.ccBilling?.opening
      let opening = oldOpening && parseStatementId(card,oldOpening.statementId) && parseDate(oldOpening.dueDate)
        ? {...oldOpening} : null
      if (!opening) {
        const tagged = relevant.map(tx=>parseStatementId(card,tx.statementId)).filter(Boolean).sort((a,b)=>a.end.localeCompare(b.end))[0]
        const period = tagged || getStatementPeriod(card,earliest)
        opening={statementId:tagged?.id || statementId(card.id,period.start,period.end),start:period.start,end:period.end,dueDate:tagged?.dueDate || resolveDueDate(card,period.end),provenance:'inferred'}
      }
      periods.set(opening.statementId,{id:opening.statementId,start:opening.start,end:opening.end,dueDate:opening.dueDate})
      const ccBilling={version:2,opening,periods:[...periods.values()].sort((a,b)=>a.end.localeCompare(b.end)||a.id.localeCompare(b.id))}
      if (JSON.stringify(card.ccBilling) === JSON.stringify(ccBilling)) return card
      changed=true
      diagnostics.push({cardId:card.id,code:'BILLING_METADATA_PREPARED'})
      return {...card,ccBilling}
    })
    return {wallets:next,changed,diagnostics}
  }

  function buildCardBillingState({card,transactions=[],refDate,amountForTx,isPostedTx,rewardForTx,count=6}) {
    const empty={statements:[],payableStatements:[],openStatement:null,allocations:[],creditBalance:0,postedDebt:0,reconciliation:{ok:true,diagnostics:[]}}
    if (!card?.id || !parseDate(refDate)) return empty
    const normalized=prepareBillingMigration({wallets:[card],transactions,refDate}).wallets[0]
    const rows=new Map(), allocations=[], diagnostics=[]
    const ensure = period => {
      const id=period.id || period.statementId || statementId(card.id,period.start,period.end)
      if (!rows.has(id)) rows.set(id,{id,cardId:card.id,start:period.start,end:period.end,dueDate:period.dueDate || resolveDueDate(card,period.end),purchases:[],payments:[],credits:[],purchaseTotal:0,openingDebt:0,paidTotal:0,creditTotal:0,balanceDue:0,reward:{points:0,cashback:0,discount:0},_balance:0})
      return rows.get(id)
    }
    normalized.ccBilling.periods.forEach(ensure)
    const openPeriod=getStatementPeriod(card,refDate,{includeOpen:true})
    const open=ensure(openPeriod)
    let cursor=refDate
    for (let i=0;i<Math.max(6,Math.min(2400,count));i++) {
      const p=getStatementPeriod(card,cursor)
      if (!p) break
      if (![...rows.values()].some(r=>r.end===p.end)) ensure(p)
      cursor=p.start
    }
    const baseline=cents(card.openingBalance)
    const baselineRow=ensure(normalized.ccBilling.opening)
    baselineRow.openingDebt=baht(Math.max(0,-baseline))
    baselineRow.openingDebtIncluded=baseline<0
    baselineRow._balance=Math.max(0,-baseline)
    const pools=baseline>0 ? [{transactionId:'opening-credit',remaining:baseline,kind:'credit'}] : []
    const addAllocation = (pool,row,amount,tx) => {
      if (!(amount>0)) return
      row._balance-=amount
      row[pool.kind==='payment'?'paidTotal':'creditTotal']+=baht(amount)
      allocations.push({transactionId:pool.transactionId,statementId:row.id,amount:baht(amount),kind:pool.kind})
      const list=pool.kind==='payment'?row.payments:row.credits
      const source=tx || pool.tx
      if (source && !list.some(t=>t.id===source.id)) list.push(source)
    }
    const spendCredit = row => {
      for (const pool of pools) {
        const amount=Math.min(row._balance,pool.remaining)
        addAllocation(pool,row,amount)
        pool.remaining-=amount
      }
    }
    const events=transactions.filter(t=>t && (t.walletId===card.id || t.toWalletId===card.id) && isPostedAt(t,refDate,isPostedTx) && (!t.date || String(t.date)<=refDate))
      .slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')) || Number(a.createdSequence||0)-Number(b.createdSequence||0) || String(a.createdAt||'').localeCompare(String(b.createdAt||'')) || String(a.id||'').localeCompare(String(b.id||'')))
    let signed=-baseline
    for (const tx of events) {
      const amount=cents(tx.type==='expense' && typeof amountForTx==='function' ? amountForTx(tx) : tx.ledgerAmount ?? tx.amount)
      if (!Number.isFinite(Number(tx.amount)) || amount<0) {diagnostics.push({transactionId:tx.id,code:'INVALID_AMOUNT'});continue}
      let direction=0,kind='credit'
      if (tx.walletId===card.id && (tx.type==='expense' || tx.type==='transfer')) direction=1
      if ((tx.type==='income' && tx.walletId===card.id) || (['transfer','cc_payment'].includes(tx.type) && tx.toWalletId===card.id)) direction=-1
      if (!direction || !amount) continue
      signed+=direction*amount
      if (direction>0) {
        const date=parseDate(tx.date)?tx.date:refDate
        const period=[...rows.values()].filter(p=>date>=p.start && date<=p.end).sort((a,b)=>a.end.localeCompare(b.end))[0] || getStatementPeriod(card,date,{includeOpen:true})
        const row=ensure(period)
        row._balance+=amount
        row.purchaseTotal+=baht(amount)
        row.purchases.push(tx)
        spendCredit(row)
      } else {
        kind=tx.type==='cc_payment'?'payment':'credit'
        const pool={transactionId:tx.id,kind,remaining:amount,tx}
        const tagged=tx.statementId ? parseStatementId(card,tx.statementId) : null
        if (tx.statementId && !tagged) diagnostics.push({transactionId:tx.id,code:'INVALID_STATEMENT_REFERENCE'})
        const target=tagged ? ensure(tagged) : null
        const eligible=[...rows.values()].filter(r=>r._balance>0).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.start.localeCompare(b.start)||a.id.localeCompare(b.id))
        const ordered=target ? [target,...eligible.filter(r=>r.id!==target.id)] : eligible
        for (const row of ordered) {
          const used=Math.min(pool.remaining,row._balance)
          addAllocation(pool,row,used,tx)
          pool.remaining-=used
          if (!pool.remaining) break
        }
        if (pool.remaining) pools.push(pool)
      }
    }
    const statements=[...rows.values()].map(row=> {
      row.balanceDue=baht(row._balance)
      delete row._balance
      row.purchaseTotal=baht(cents(row.purchaseTotal));row.paidTotal=baht(cents(row.paidTotal));row.creditTotal=baht(cents(row.creditTotal))
      row.daysLeft=daysBetween(row.dueDate,refDate)
      const isOpen=row.end>=refDate
      row.paid=row.balanceDue<=0 && (row.purchaseTotal+row.openingDebt)>0
      row.status=isOpen?'open':row.balanceDue<=0?'paid':row.daysLeft<0?'overdue':(row.paidTotal+row.creditTotal)>0?'partial':'unpaid'
      row.reward=row.purchases.reduce((sum,tx)=> {
        const reward=typeof rewardForTx==='function'?rewardForTx(tx):{}
        for (const key of ['points','cashback','discount']) sum[key]+=Number(reward?.[key]||0)
        return sum
      },{points:0,cashback:0,discount:0})
      row.reward.points=Math.floor(row.reward.points)
      row.reward.cashback=baht(cents(row.reward.cashback));row.reward.discount=baht(cents(row.reward.discount))
      return row
    }).sort((a,b)=>b.end.localeCompare(a.end)||a.id.localeCompare(b.id))
    const creditBalance=baht(pools.reduce((sum,p)=>sum+p.remaining,0))
    const net=cents(statements.reduce((sum,row)=>sum+row.balanceDue,0))-cents(creditBalance)
    return {statements,payableStatements:statements.filter(r=>r.end<refDate && r.balanceDue>0).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.id.localeCompare(b.id)),openStatement:statements.find(r=>r.id===open.id),allocations,creditBalance,postedDebt:baht(Math.max(0,signed)),reconciliation:{ok:net===signed,diagnostics}}
  }

  function getCardStatement(options) {
    const period=getStatementPeriod(options.card,options.refDate,{includeOpen:options.includeOpen})
    if (!period) return null
    const state=buildCardBillingState({...options,refDate:options.postedRefDate || options.refDate})
    return state.statements.find(r=>r.end===period.end) || null
  }
  function shiftStatementRef(statement,deltaCycles) { return deltaCycles<0?statement.start:addDays(statement.end,1) }
  function getStatementHistory(options) {
    const state=buildCardBillingState(options)
    const period=getStatementPeriod(options.card,options.refDate,{includeOpen:options.includeOpen})
    return period ? state.statements.filter(r=>r.end<=period.end).slice(0,options.count ?? 6) : []
  }
  function getPayableStatements(options) {
    return buildCardBillingState(options).payableStatements.filter(r=>options.includeOverdue!==false || r.daysLeft>=0)
  }
  function getNextPayableDueInfo(options) {
    const st=getPayableStatements(options)[0]
    return st ? {daysLeft:st.daysLeft,dueStr:st.dueDate,dateStr:st.dueDate,statementId:st.id,amount:st.balanceDue,statement:st}:null
  }
  function getCreditDueNotificationRows({cards=[],hideAmounts=false,maxDays=7,...options}) {
    return cards.flatMap(card=>getPayableStatements({...options,card}).filter(s=>s.daysLeft<=maxDays).map(s=>({id:card.id,statementId:s.id,title:card.name,dueDate:s.dueDate,daysLeft:s.daysLeft,amount:hideAmounts?null:s.balanceDue,amountDue:s.balanceDue,cycleStart:s.start,cycleEnd:s.end})))
  }

  return {
    buildCardBillingState,
    prepareBillingMigration,
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
