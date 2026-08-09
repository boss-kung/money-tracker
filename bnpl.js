;(function () {
  'use strict'

  // ── helpers ────────────────────────────────────────────────────────────────
  function genId() { return 'bnpl_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36) }
  function pad2(n) { return String(n).padStart(2, '0') }
  function todayStr() { return typeof getTODAY === 'function' ? getTODAY() : new Date().toISOString().slice(0, 10) }
  const SafeRender = globalThis.MTSafeRender || (typeof require === 'function' ? require('./safe_render.js') : null)
  const esc = SafeRender.escapeHtml
  const jsArg = SafeRender.jsArg
  function money(n) {
    if (typeof Calc !== 'undefined' && Calc.fmt) return Calc.fmt(n)
    return '฿' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  function fmtDate(d) {
    if (!d) return ''
    try {
      const [y, m, day] = d.split('-').map(Number)
      const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
      return `${day} ${months[m - 1]} ${y + 543}`
    } catch (_) { return d }
  }
  function addMonths(dateStr, months) {
    const [y, m, d] = String(dateStr || '').slice(0, 10).split('-').map(Number)
    if (!y || !m || !d) return dateStr
    let newM = (m - 1) + months
    let newY = y + Math.floor(newM / 12)
    newM = ((newM % 12) + 12) % 12
    const maxDay = new Date(newY, newM + 1, 0).getDate()
    return `${newY}-${pad2(newM + 1)}-${pad2(Math.min(d, maxDay))}`
  }
  function daysBetween(a, b) {
    return Math.round((new Date(a) - new Date(b)) / 86400000)
  }

  // ── BNPLCalc ────────────────────────────────────────────────────────────────
  const BNPLCalc = {
    buildSchedule(totalAmount, installments, purchaseDate, payDay) {
      const total = Number(totalAmount)
      const n = Number(installments)
      const unitAmt = Math.floor((total / n) * 100) / 100
      const lastAmt = Math.round((total - unitAmt * (n - 1)) * 100) / 100
      return Array.from({ length: n }, (_, i) => {
        // If payDay is set, use that fixed day-of-month instead of purchase day
        let dueDate = addMonths(purchaseDate, i + 1)
        if (payDay && payDay >= 1 && payDay <= 28) {
          dueDate = dueDate.slice(0, 8) + String(payDay).padStart(2, '0')
        }
        return { no: i + 1, dueDate, amount: i === n - 1 ? lastAmt : unitAmt, paidTxId: null }
      })
    },
    getUsedCredit(wallet) {
      return Math.abs(Math.min(0, Number(wallet?.balance || 0)))
    },
    getAvailableCredit(wallet) {
      const limit = Number(wallet?.creditLimit || 0)
      return Math.max(0, limit + Number(wallet?.balance || 0))
    },
    getUsagePct(wallet) {
      const limit = Number(wallet?.creditLimit || 0)
      if (limit <= 0) return 0
      return Math.min(100, Math.round(BNPLCalc.getUsedCredit(wallet) / limit * 100))
    },
  }

  // ── BNPLStore ───────────────────────────────────────────────────────────────
  const BNPLStore = {
    getAll() { return (typeof S !== 'undefined' ? S.bnplPlans : null) || [] },
    getActive() { return BNPLStore.getAll().filter(p => p.status === 'active') },
    getByWallet(walletId) { return BNPLStore.getAll().filter(p => p.walletId === walletId) },
    getById(id) { return BNPLStore.getAll().find(p => p.id === id) || null },

    getRemainingAmount(plan) {
      return (plan?.schedule || []).filter(s => !s.paidTxId).reduce((sum, s) => sum + Number(s.amount || 0), 0)
    },

    createPlan({ walletId, txId, merchant, purchaseDate, totalAmount, installments }) {
      const wallet = (typeof S !== 'undefined' ? S.wallets : [])?.find(w => w.id === walletId)
      const payDay = wallet?.payDay || null
      const plan = {
        id: genId(),
        walletId,
        txId,
        merchant: merchant || '',
        purchaseDate: purchaseDate || todayStr(),
        totalAmount: Number(totalAmount),
        installments: Number(installments),
        interestRate: 0,
        schedule: BNPLCalc.buildSchedule(Number(totalAmount), Number(installments), purchaseDate || todayStr(), payDay),
        status: 'active',
        createdAt: new Date().toISOString(),
      }
      if (typeof S !== 'undefined') {
        S.bnplPlans = S.bnplPlans || []
        S.bnplPlans.unshift(plan)
      }
      if (typeof persist === 'function') persist()
      return plan
    },

    payInstallment(planId, no, { walletId: sourceWalletId, date } = {}) {
      const plan = BNPLStore.getById(planId)
      if (!plan) return null
      const item = plan.schedule.find(s => s.no === no)
      if (!item || item.paidTxId) return null

      // Defense-in-depth: validate source wallet type
      const sourceWallet = (typeof S !== 'undefined' ? S.wallets : [])?.find(w => w.id === sourceWalletId)
      const validSourceTypes = new Set(['bank', 'cash', 'ewallet', 'saving'])
      if (sourceWallet && !validSourceTypes.has(sourceWallet.type)) {
        console.warn('[BNPL] payInstallment: invalid source wallet type', sourceWallet.type)
        return null
      }

      const txId = 'tx_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
      const tx = {
        id: txId,
        type: 'bnpl_payment',
        amount: Number(item.amount),
        walletId: sourceWalletId,
        toWalletId: plan.walletId,
        bnplPlanId: planId,
        bnplInstallmentNo: no,
        date: date || todayStr(),
        note: `จ่ายงวด ${no}/${plan.installments} ${plan.merchant || 'BNPL'}`.trim(),
      }
      if (typeof S !== 'undefined') {
        S.transactions = S.transactions || []
        S.transactions.unshift(tx)
      }

      item.paidTxId = txId
      if (plan.schedule.every(s => s.paidTxId)) plan.status = 'paid_off'

      try { App?.recalculateWalletBalances?.({ save: false }) } catch (_) {}
      if (typeof persist === 'function') persist()
      return tx
    },

    deletePlan(planId) {
      if (typeof S === 'undefined') return
      S.bnplPlans = (S.bnplPlans || []).filter(p => p.id !== planId)
      if (typeof persist === 'function') persist()
    },

    // ── H1: unlink installment(s) when their bnpl_payment tx is deleted ──
    // Clears every schedule item whose paidTxId === txId (single pay OR payoff-all
    // share one txId). Returns an undo token, or null if nothing matched.
    unlinkPaymentByTxId(txId) {
      if (typeof S === 'undefined' || !txId) return null
      for (const plan of (S.bnplPlans || [])) {
        const items = (plan.schedule || []).filter(s => s.paidTxId === txId)
        if (items.length) {
          const prevStatus = plan.status
          items.forEach(it => { it.paidTxId = null })
          if (plan.status === 'paid_off') plan.status = 'active'
          return { planId: plan.id, nos: items.map(i => i.no), prevStatus }
        }
      }
      return null
    },

    // Undo counterpart: re-link paidTxId on the captured installments + restore status.
    relinkPayment(token, txId) {
      if (!token || typeof S === 'undefined') return
      const plan = (S.bnplPlans || []).find(p => p.id === token.planId)
      if (!plan) return
      ;(token.nos || []).forEach(no => {
        const item = (plan.schedule || []).find(s => s.no === no)
        if (item) item.paidTxId = txId
      })
      if (token.prevStatus) plan.status = token.prevStatus
    },

    // ── M2: pay off all remaining installments in one transaction ──
    payoffAll(planId, { walletId: sourceWalletId, date } = {}) {
      const plan = BNPLStore.getById(planId)
      if (!plan) return null
      const unpaid = plan.schedule.filter(s => !s.paidTxId)
      if (!unpaid.length) return null

      const sourceWallet = (typeof S !== 'undefined' ? S.wallets : [])?.find(w => w.id === sourceWalletId)
      const validSourceTypes = new Set(['bank', 'cash', 'ewallet', 'saving'])
      if (sourceWallet && !validSourceTypes.has(sourceWallet.type)) {
        console.warn('[BNPL] payoffAll: invalid source wallet type', sourceWallet.type)
        return null
      }

      const total = unpaid.reduce((s, i) => s + Number(i.amount || 0), 0)
      const txId = 'tx_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
      const tx = {
        id: txId,
        type: 'bnpl_payment',
        amount: Number(total),
        walletId: sourceWalletId,
        toWalletId: plan.walletId,
        bnplPlanId: planId,
        bnplPayoffAll: true,
        date: date || todayStr(),
        note: `ปิดยอดทั้งหมด ${plan.merchant || 'BNPL'}`.trim(),
      }
      if (typeof S !== 'undefined') {
        S.transactions = S.transactions || []
        S.transactions.unshift(tx)
      }
      unpaid.forEach(i => { i.paidTxId = txId })
      plan.status = 'paid_off'

      try { App?.recalculateWalletBalances?.({ save: false }) } catch (_) {}
      if (typeof persist === 'function') persist()
      return tx
    },

    // ── M3: edit an existing plan (merchant / total / installments) ──
    // Rebuilds the schedule when total or installment count changes, preserving
    // already-paid installments, and syncs the source expense tx amount/merchant.
    updatePlan(planId, { merchant, totalAmount, installments } = {}) {
      const plan = BNPLStore.getById(planId)
      if (!plan) return null
      const srcTx = (typeof S !== 'undefined' ? S.transactions : [])?.find(t => t.id === plan.txId)
      if (merchant !== undefined) {
        plan.merchant = merchant
        if (srcTx) srcTx.merchant = merchant
      }
      const newTotal = totalAmount != null && totalAmount !== '' ? Number(totalAmount) : plan.totalAmount
      const newN = installments != null && installments !== '' ? Number(installments) : plan.installments
      const structureChanged = newTotal !== plan.totalAmount || newN !== plan.installments
      if (structureChanged) {
        if (!(newTotal > 0) || !(newN >= 1)) return { error: 'invalid_values' }
        const maxPaidNo = Math.max(0, ...plan.schedule.filter(s => s.paidTxId).map(s => s.no))
        if (newN < maxPaidNo) return { error: 'installments_below_paid' }
        const wallet = (typeof S !== 'undefined' ? S.wallets : [])?.find(w => w.id === plan.walletId)
        const rebuilt = BNPLCalc.buildSchedule(newTotal, newN, plan.purchaseDate, wallet?.payDay || null)
        plan.schedule = rebuilt.map(item => {
          const old = plan.schedule.find(s => s.no === item.no)
          return old?.paidTxId ? { ...item, paidTxId: old.paidTxId } : item
        })
        plan.totalAmount = newTotal
        plan.installments = newN
        plan.status = plan.schedule.every(s => s.paidTxId) ? 'paid_off' : 'active'
        if (srcTx && newTotal !== Number(srcTx.amount)) srcTx.amount = newTotal
      }
      try { App?.recalculateWalletBalances?.({ save: false }) } catch (_) {}
      if (typeof persist === 'function') persist()
      return plan
    },

    getUpcomingInstallments(days = 60) {
      const t = todayStr()
      const result = []
      BNPLStore.getActive().forEach(plan => {
        const wallet = (typeof S !== 'undefined' ? S.wallets : [])?.find(w => w.id === plan.walletId)
        plan.schedule.forEach(item => {
          if (item.paidTxId) return
          const diff = daysBetween(item.dueDate, t) // positive = future
          if (diff <= days && diff >= -90) {
            result.push({
              planId: plan.id,
              no: item.no,
              installments: plan.installments,
              dueDate: item.dueDate,
              amount: item.amount,
              merchant: plan.merchant,
              walletId: plan.walletId,
              walletName: wallet?.name || 'BNPL',
              walletIcon: wallet?.icon || '🛍️',
              isOverdue: item.dueDate < t,
            })
          }
        })
      })
      return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    },
  }

  // ── BNPLui ─────────────────────────────────────────────────────────────────
  const BNPLui = {

    // ── Wallet card HTML (structure mirrors CC card in app_v2.js _walletCard) ──
    walletCard(w, ctx = {}) {
      const used = BNPLCalc.getUsedCredit(w)
      const avail = BNPLCalc.getAvailableCredit(w)
      const pct = BNPLCalc.getUsagePct(w)
      const activePlans = BNPLStore.getByWallet(w.id).filter(p => p.status === 'active')

      const nextDueItem = activePlans
        .flatMap(p => p.schedule.filter(s => !s.paidTxId).map(s => ({ ...s, planId: p.id, installments: p.installments, merchant: p.merchant })))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null

      const t = todayStr()
      const daysLeft = nextDueItem ? daysBetween(nextDueItem.dueDate, t) : null
      const isOverdue = daysLeft !== null && daysLeft < 0
      const isDueSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7

      const bgColor = w.color || '#6c48c5'
      const colorStyle = `--wallet-color:${bgColor};--wallet-color-2:${bgColor}BB`

      const name = `${w.icon || '🛍️'} ${w.name || ''}`.trim()
      const planBadge = activePlans.length > 0 ? ` · ${activePlans.length} แผน` : ''
      const typeLabel = `BNPL${w.provider ? ` · ${esc(w.provider)}` : ''}${planBadge}`

      const payBtn = nextDueItem && !ctx.reorderMode
        ? `<button type="button" class="wallet-chip-btn wc-card-pay-btn" onclick="event.stopPropagation();BNPL.ui.openPayModal(${jsArg(nextDueItem.planId)},${nextDueItem.no})">จ่ายงวด</button>`
        : ''

      const limitSection = w.creditLimit
        ? `<div class="wc-limit"><div class="wc-prog-bar"><div class="wc-prog-fill" style="width:${pct}%;background:${pct > 80 ? 'rgba(252,165,165,.95)' : 'rgba(255,255,255,.9)'}"></div></div><div class="wc-prog-info"><span>ค้าง ${money(used)}</span><span>คงเหลือ ${money(avail)}</span></div></div>`
        : ''

      const dueStrip = nextDueItem
        ? `<div class="cc-due-strip${isOverdue ? ' urgent' : isDueSoon ? ' soon' : ''}"><span>${money(nextDueItem.amount)}</span><span>งวด ${nextDueItem.no}/${nextDueItem.installments} ${fmtDate(nextDueItem.dueDate)}</span><span class="wc-days-left${isOverdue ? ' overdue' : isDueSoon ? ' soon' : ''}">${isOverdue ? 'เกินกำหนด' : daysLeft === 0 ? 'วันนี้' : daysLeft + ' วัน'}</span></div>`
        : ''

      return `<div ${ctx.dataAttrs || ''} class="wallet-card wallet-card-colored wallet-card-bnpl${ctx.dragCls || ''}" style="${colorStyle}"${ctx.reorderMode ? '' : ` onclick="BNPL.ui.openPlanList(${jsArg(w.id)})"`}>
        ${ctx.dragHandle || ''}
        <div class="wc-header">
          <div><div class="wc-name">${esc(name)}</div><div class="wc-type">${typeLabel}</div></div>
          <div class="wc-card-actions">${payBtn}${ctx.editBtn || ''}</div>
        </div>
        <div class="wc-balance">-${money(used)}</div>
        ${limitSection}
        ${dueStrip}
      </div>`
    },

    // ── Plan list sub-screen ──
    openPlanList(walletId) {
      if (typeof App === 'undefined' || typeof S === 'undefined') return
      S._bnplPlanListWalletId = walletId
      const wallet = S.wallets?.find(w => w.id === walletId) || {}
      App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>${esc(wallet.icon || '🛍️')} ${esc(wallet.name || 'BNPL')}</h2><button class="btn btn-secondary btn-sm" onclick="App.openWalletForm(${jsArg(walletId)})" style="width:auto">แก้ไข</button></div><div class="sub-scroll"><div id="bnpl-plan-hero">${BNPLui._heroHtml(wallet)}</div><div id="bnpl-plans-content" style="padding:12px 16px 40px">${BNPLui._planListHtml(walletId)}${BNPLui._paymentHistoryHtml(walletId)}</div></div>`)
    },

    // Re-render plan list (+ history) and hero in-place without closing the sub-screen.
    _refreshPlanScreen() {
      const walletId = typeof S !== 'undefined' ? S._bnplPlanListWalletId : null
      if (!walletId) return
      const plansEl = document.getElementById('bnpl-plans-content')
      if (plansEl) plansEl.innerHTML = BNPLui._planListHtml(walletId) + BNPLui._paymentHistoryHtml(walletId)
      const heroEl = document.getElementById('bnpl-plan-hero')
      const w = typeof S !== 'undefined' ? S.wallets?.find(x => x.id === walletId) : null
      if (heroEl && w) heroEl.innerHTML = BNPLui._heroHtml(w)
    },

    // ── M6: payment history for this BNPL wallet ──
    _paymentHistoryHtml(walletId) {
      const txs = ((typeof S !== 'undefined' ? S.transactions : []) || [])
        .filter(t => t.type === 'bnpl_payment' && t.toWalletId === walletId)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      if (!txs.length) return ''
      const rows = txs.map(t => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px"><span style="flex:1;min-width:0">${fmtDate(t.date)} · ${esc(t.note || 'จ่าย BNPL')}</span><span style="font-weight:500;white-space:nowrap;margin-left:8px">-${money(t.amount)}</span></div>`).join('')
      return `<details style="margin-top:14px"><summary style="font-size:13px;opacity:.6;cursor:pointer;padding:8px 0;list-style:none">ประวัติการจ่าย (${txs.length})</summary><div style="margin-top:4px">${rows}</div></details>`
    },

    _heroHtml(wallet) {
      const used = BNPLCalc.getUsedCredit(wallet)
      const avail = BNPLCalc.getAvailableCredit(wallet)
      const pct = BNPLCalc.getUsagePct(wallet)
      const color = wallet.color || '#6c48c5'
      return `<div class="cc-hero" style="background:linear-gradient(135deg,${color},${color}BB);color:#fff;border:0"><div style="font-size:13px;opacity:.75;margin-bottom:4px">ยอดค้างชำระ</div><div class="big">${money(used)}</div>${wallet.creditLimit ? `<div style="background:rgba(255,255,255,.2);border-radius:999px;height:8px;overflow:hidden;margin:12px 0 6px"><div style="height:100%;width:${pct}%;background:${pct > 80 ? '#FCA5A5' : 'rgba(255,255,255,.88)'};border-radius:999px"></div></div><div style="font-size:12px;opacity:.78">ใช้ ${pct.toFixed(0)}% · คงเหลือ ${money(avail)}</div>` : `<div style="font-size:12px;opacity:.65;margin-top:6px">ไม่ได้ตั้งวงเงิน</div>`}</div>`
    },

    _planListHtml(walletId) {
      const plans = BNPLStore.getByWallet(walletId)
      const active = plans.filter(p => p.status === 'active')
      const done = plans.filter(p => p.status === 'paid_off')
      const t = todayStr()

      const planCard = (plan) => {
        const paidCount = plan.schedule.filter(s => s.paidTxId).length
        const pct = Math.round(paidCount / plan.installments * 100)
        const next = plan.schedule.find(s => !s.paidTxId)
        const nextLabel = next
          ? `<div style="font-size:12px;opacity:.65;margin-top:3px">ถัดไป: งวด ${next.no} · ${fmtDate(next.dueDate)} · ${money(next.amount)}</div>`
          : `<div style="font-size:12px;color:#22c55e;margin-top:3px">ชำระครบแล้ว ✓</div>`

        const scheduleRows = plan.schedule.map(s => {
          const isPaid = !!s.paidTxId
          const isOver = !isPaid && s.dueDate < t
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:13px;border-bottom:1px solid var(--border)${isPaid ? ';opacity:.45' : isOver ? ';color:#ef4444' : ''}"><span>${isPaid ? '✓' : isOver ? '⚠️' : '○'} งวด ${s.no}/${plan.installments} · ${fmtDate(s.dueDate)}</span><span style="font-weight:500">${money(s.amount)}</span></div>`
        }).join('')

        const payBtn = next && plan.status === 'active'
          ? `<button type="button" class="btn btn-primary btn-sm" style="margin-top:10px;width:100%" onclick="BNPL.ui.openPayModal(${jsArg(plan.id)},${next.no})">จ่ายงวด ${next.no}/${plan.installments}</button>`
          : ''
        const editBtn = `<button type="button" class="btn btn-secondary btn-sm" style="margin-top:8px;width:100%" onclick="BNPL.ui.openEditPlan(${jsArg(plan.id)})">แก้ไขแผน</button>`

        return `<div class="card card-pad" style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:15px">${esc(plan.merchant || 'ไม่ระบุร้าน')}</div>
              <div style="font-size:12px;opacity:.6;margin-top:2px">${fmtDate(plan.purchaseDate)} · ${money(plan.totalAmount)}</div>
            </div>
            <span style="font-size:11px;background:var(--surface-soft,#F8FAFC);padding:3px 8px;border-radius:20px;white-space:nowrap">${paidCount}/${plan.installments} งวด</span>
          </div>
          <div class="wc-prog-bar" style="margin:8px 0 2px"><div class="wc-prog-fill" style="width:${pct}%;background:${pct >= 100 ? '#22c55e' : 'var(--accent,#6c48c5)'}"></div></div>
          ${nextLabel}
          <details style="margin-top:10px"><summary style="font-size:12px;cursor:pointer;opacity:.6;list-style:none;display:flex;align-items:center;gap:4px"><span>▸</span> รายละเอียดงวด</summary><div style="margin-top:6px">${scheduleRows}</div></details>
          ${payBtn}
          ${editBtn}
        </div>`
      }

      if (active.length === 0 && done.length === 0) {
        return '<div style="text-align:center;padding:48px 16px;opacity:.5;font-size:14px">ยังไม่มีแผนผ่อน<br><small>บันทึกรายจ่ายผ่าน BNPL แล้วเลือกจำนวนงวด</small></div>'
      }

      return `${active.map(planCard).join('')}${done.length > 0 ? `<details style="margin-top:4px"><summary style="font-size:13px;opacity:.55;cursor:pointer;padding:8px 0">ชำระแล้ว (${done.length})</summary><div style="margin-top:8px">${done.map(planCard).join('')}</div></details>` : ''}`
    },

    closePlanList() {
      if (typeof App !== 'undefined') App.closeSubScreen?.()
      if (typeof S !== 'undefined') S._bnplPlanListWalletId = null
    },

    // ── Pay installment modal ──
    openPayModal(planId, no) {
      const plan = BNPLStore.getById(planId)
      if (!plan) return
      const item = plan.schedule.find(s => s.no === no)
      if (!item || item.paidTxId) return

      const overlay = document.getElementById('overlay-bnpl-pay')
      if (!overlay) return
      const content = document.getElementById('bnpl-pay-content')
      if (content) content.innerHTML = BNPLui._payModalHtml(plan, item)
      overlay.classList.add('open')
    },

    _payModalHtml(plan, item) {
      const wallets = (typeof S !== 'undefined' ? S.wallets : []) || []
      const sourceWallets = wallets.filter(w => ['bank', 'cash', 'ewallet', 'saving'].includes(w.type) && !w.hiddenFromWalletList)
      const walletOpts = sourceWallets.map(w =>
        `<option value="${esc(w.id)}">${esc(w.icon || '')} ${esc(w.name)}</option>`
      ).join('')
      const t = todayStr()
      const isOverdue = item.dueDate < t
      const dueLabel = isOverdue
        ? `<div style="margin-top:4px;font-size:12px;color:#ef4444">⚠️ เกินกำหนด ${fmtDate(item.dueDate)}</div>`
        : `<div style="margin-top:4px;font-size:12px;opacity:.65">ครบกำหนด ${fmtDate(item.dueDate)}</div>`

      // M2: offer pay-off-all when more than one installment remains
      const remaining = plan.schedule.filter(s => !s.paidTxId)
      const remainingTotal = remaining.reduce((s, i) => s + Number(i.amount || 0), 0)
      const payoffOption = remaining.length > 1
        ? `<label style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--surface-soft,#F8FAFC);border-radius:10px;margin-bottom:12px;cursor:pointer;font-size:13px">
            <input type="checkbox" id="bnpl-payoff-all" onchange="BNPL.ui._togglePayoff('${esc(plan.id)}',${item.no})" style="width:auto">
            <span>ปิดยอดทั้งหมด (${remaining.length} งวดที่เหลือ · ${money(remainingTotal)})</span>
          </label>`
        : ''

      return `<div style="padding:4px 0">
        <div style="text-align:center;padding:20px 0 16px">
          <div style="font-size:14px;font-weight:600">${esc(plan.merchant || 'BNPL')}</div>
          <div style="font-size:13px;opacity:.65;margin-top:2px" id="bnpl-pay-sub">งวด ${item.no} จาก ${plan.installments} งวด</div>
          ${dueLabel}
          <div class="big" style="margin-top:10px" id="bnpl-pay-amount">${money(item.amount)}</div>
        </div>
        ${payoffOption}
        <div class="form-group">
          <label class="form-label">จากบัญชี</label>
          <select class="form-input" id="bnpl-pay-wallet">${walletOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">วันที่จ่าย</label>
          <input class="form-input" type="date" id="bnpl-pay-date" value="${t}">
        </div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button type="button" class="btn btn-secondary" style="flex:1" onclick="BNPL.ui.closePayModal()">ยกเลิก</button>
          <button type="button" class="btn btn-primary" style="flex:1" onclick="BNPL.ui._confirmPay(${jsArg(plan.id)},${item.no})">ยืนยันจ่าย</button>
        </div>
      </div>`
    },

    // M2: live-update amount/subtitle when toggling pay-off-all
    _togglePayoff(planId, no) {
      const plan = BNPLStore.getById(planId)
      if (!plan) return
      const item = plan.schedule.find(s => s.no === no)
      const payoff = document.getElementById('bnpl-payoff-all')?.checked
      const remaining = plan.schedule.filter(s => !s.paidTxId)
      const remainingTotal = remaining.reduce((s, i) => s + Number(i.amount || 0), 0)
      const amountEl = document.getElementById('bnpl-pay-amount')
      const subEl = document.getElementById('bnpl-pay-sub')
      if (amountEl) amountEl.textContent = payoff ? money(remainingTotal) : money(item?.amount || 0)
      if (subEl) subEl.textContent = payoff ? `ปิดยอดทั้งหมด ${remaining.length} งวด` : `งวด ${no} จาก ${plan.installments} งวด`
    },

    _confirmPay(planId, no) {
      const sourceWalletId = document.getElementById('bnpl-pay-wallet')?.value
      const date = document.getElementById('bnpl-pay-date')?.value
      if (!sourceWalletId) {
        if (typeof App !== 'undefined') App.toast?.('กรุณาเลือกบัญชีที่จ่าย', 'error')
        return
      }
      const payoff = document.getElementById('bnpl-payoff-all')?.checked
      const tx = payoff
        ? BNPLStore.payoffAll(planId, { walletId: sourceWalletId, date })
        : BNPLStore.payInstallment(planId, no, { walletId: sourceWalletId, date })
      if (tx) {
        BNPLui.closePayModal()
        BNPLui._refreshPlanScreen()
        try { App?.render?.() } catch (_) {}
        try { App?.toast?.(payoff ? 'ปิดยอดทั้งหมดแล้ว ✓' : 'บันทึกการชำระงวดแล้ว ✓', 'success') } catch (_) {}
      }
    },

    closePayModal() {
      document.getElementById('overlay-bnpl-pay')?.classList.remove('open')
    },

    // ── M3: edit plan modal ──
    openEditPlan(planId) {
      const plan = BNPLStore.getById(planId)
      if (!plan) return
      const overlay = document.getElementById('overlay-bnpl-edit')
      if (!overlay) return
      const content = document.getElementById('bnpl-edit-content')
      if (content) content.innerHTML = BNPLui._editPlanHtml(plan)
      overlay.classList.add('open')
    },

    _editPlanHtml(plan) {
      const paidCount = plan.schedule.filter(s => s.paidTxId).length
      const minInstallments = Math.max(1, paidCount)
      const note = paidCount > 0
        ? `<div style="font-size:12px;opacity:.6;margin-top:6px">จ่ายไปแล้ว ${paidCount} งวด — ลดจำนวนงวดต่ำกว่านี้ไม่ได้ และงวดที่จ่ายแล้วจะคงไว้</div>`
        : ''
      return `<div style="padding:4px 0">
        <div class="form-group">
          <label class="form-label">ชื่อร้าน / รายการ</label>
          <input class="form-input" type="text" id="bnpl-edit-merchant" value="${esc(plan.merchant || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">ยอดรวม</label>
          <input class="form-input" type="number" min="0" inputmode="decimal" id="bnpl-edit-total" value="${Number(plan.totalAmount)}">
          <div style="font-size:12px;opacity:.6;margin-top:6px">เปลี่ยนยอดรวมจะอัปเดตรายจ่ายต้นทางด้วย</div>
        </div>
        <div class="form-group">
          <label class="form-label">จำนวนงวด</label>
          <input class="form-input" type="number" min="${minInstallments}" inputmode="numeric" id="bnpl-edit-installments" value="${Number(plan.installments)}">
          ${note}
        </div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button type="button" class="btn btn-secondary" style="flex:1" onclick="BNPL.ui.closeEditModal()">ยกเลิก</button>
          <button type="button" class="btn btn-primary" style="flex:1" onclick="BNPL.ui._confirmEdit(${jsArg(plan.id)})">บันทึก</button>
        </div>
      </div>`
    },

    _confirmEdit(planId) {
      const merchant = document.getElementById('bnpl-edit-merchant')?.value ?? ''
      const totalAmount = document.getElementById('bnpl-edit-total')?.value
      const installments = document.getElementById('bnpl-edit-installments')?.value
      const result = BNPLStore.updatePlan(planId, { merchant, totalAmount, installments })
      if (result && result.error) {
        const msg = result.error === 'installments_below_paid'
          ? 'ลดจำนวนงวดต่ำกว่างวดที่จ่ายแล้วไม่ได้'
          : 'กรุณากรอกยอดรวมและจำนวนงวดให้ถูกต้อง'
        try { App?.toast?.(msg, 'error') } catch (_) {}
        return
      }
      if (result) {
        BNPLui.closeEditModal()
        BNPLui._refreshPlanScreen()
        try { App?.render?.() } catch (_) {}
        try { App?.toast?.('แก้ไขแผนแล้ว ✓', 'success') } catch (_) {}
      }
    },

    closeEditModal() {
      document.getElementById('overlay-bnpl-edit')?.classList.remove('open')
    },

    // ── Inject overlay HTML into DOM (pay + edit modals — plan list uses sub-screen) ──
    injectOverlays() {
      if (document.getElementById('overlay-bnpl-pay')) return
      document.body.insertAdjacentHTML('beforeend', `
        <div class="overlay" id="overlay-bnpl-pay" onclick="if(event.target===this||event.target.classList.contains('overlay-backdrop'))BNPL.ui.closePayModal()">
          <div class="overlay-backdrop"></div>
          <div class="sheet">
            <div class="sheet-handle"></div>
            <div class="sheet-header">
              <span class="sheet-title">จ่ายงวด BNPL</span>
              <button class="sheet-close" onclick="BNPL.ui.closePayModal()">✕</button>
            </div>
            <div class="sheet-body" id="bnpl-pay-content"></div>
          </div>
        </div>
        <div class="overlay" id="overlay-bnpl-edit" onclick="if(event.target===this||event.target.classList.contains('overlay-backdrop'))BNPL.ui.closeEditModal()">
          <div class="overlay-backdrop"></div>
          <div class="sheet">
            <div class="sheet-handle"></div>
            <div class="sheet-header">
              <span class="sheet-title">แก้ไขแผนผ่อน</span>
              <button class="sheet-close" onclick="BNPL.ui.closeEditModal()">✕</button>
            </div>
            <div class="sheet-body" id="bnpl-edit-content"></div>
          </div>
        </div>
      `)
    },
  }

  // ── Global exposure ─────────────────────────────────────────────────────────
  window.BNPL = { store: BNPLStore, calc: BNPLCalc, ui: BNPLui }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => BNPLui.injectOverlays())
  } else {
    BNPLui.injectOverlays()
  }
})()
