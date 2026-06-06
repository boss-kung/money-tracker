;(function () {
  'use strict'

  // ── helpers ────────────────────────────────────────────────────────────────
  function genId() { return 'bnpl_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36) }
  function pad2(n) { return String(n).padStart(2, '0') }
  function todayStr() { return typeof getTODAY === 'function' ? getTODAY() : new Date().toISOString().slice(0, 10) }
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
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

    getUpcomingInstallments(days = 60) {
      const t = todayStr()
      const result = []
      BNPLStore.getActive().forEach(plan => {
        const wallet = (typeof S !== 'undefined' ? S.wallets : [])?.find(w => w.id === plan.walletId)
        plan.schedule.forEach(item => {
          if (item.paidTxId) return
          const diff = daysBetween(item.dueDate, t) // positive = future
          if (diff <= days && diff >= -7) {
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

    // ── Wallet card HTML ──
    walletCard(w) {
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

      const progressSection = w.creditLimit
        ? `<div class="wc-prog-bar" style="margin-top:8px"><div class="wc-prog-fill" style="width:${pct}%;background:${pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : 'rgba(255,255,255,0.75)'}"></div></div>
           <div class="wc-prog-info"><span>ค้าง ${money(used)}</span><span>วงเงินเหลือ ${money(avail)}</span></div>`
        : `<div style="margin-top:8px;font-size:14px;font-weight:600;color:rgba(255,255,255,.9)">${money(used)}<span style="font-size:11px;font-weight:400;opacity:.7;margin-left:4px">ค้างชำระ</span></div>`

      const dueStrip = nextDueItem
        ? `<div class="cc-due-strip" style="margin-top:8px${isOverdue ? ';color:#fca5a5' : isDueSoon ? ';color:#fde68a' : ''}">
            <span>${money(nextDueItem.amount)}</span>
            <span>งวด ${nextDueItem.no}/${nextDueItem.installments} ${fmtDate(nextDueItem.dueDate)}</span>
            <span class="wc-days-left${isOverdue ? ' overdue' : isDueSoon ? ' soon' : ''}">${isOverdue ? 'เกินกำหนด' : daysLeft === 0 ? 'วันนี้' : daysLeft + ' วัน'}</span>
           </div>`
        : ''

      const btnPlans = `<button type="button" class="wallet-chip-btn" onclick="event.stopPropagation();BNPL.ui.openPlanList('${esc(w.id)}')">แผนผ่อน${activePlans.length > 0 ? ` (${activePlans.length})` : ''}</button>`
      const btnPay = nextDueItem
        ? `<button type="button" class="wallet-chip-btn wc-card-pay-btn" onclick="event.stopPropagation();BNPL.ui.openPayModal('${esc(nextDueItem.planId)}',${nextDueItem.no})">จ่ายงวด</button>`
        : ''

      return `<div class="wallet-card wallet-card-colored" style="${colorStyle};cursor:pointer" onclick="BNPL.ui.openPlanList('${esc(w.id)}')">
        <div class="wc-header">
          <span class="wc-icon">${esc(w.icon || '🛍️')}</span>
          <div class="wc-title-wrap">
            <span class="wc-name">${esc(w.name)}</span>
            <span class="wc-type-label">BNPL${w.provider ? ` · ${esc(w.provider)}` : ''}</span>
          </div>
        </div>
        ${progressSection}
        ${dueStrip}
        <div class="wc-chip-row" style="margin-top:8px">${btnPlans}${btnPay}</div>
      </div>`
    },

    // ── Plan list sheet ──
    openPlanList(walletId) {
      const overlay = document.getElementById('overlay-bnpl-plans')
      if (!overlay) return
      const wallet = (typeof S !== 'undefined' ? S.wallets : [])?.find(w => w.id === walletId) || {}
      const titleEl = overlay.querySelector('.sheet-title')
      if (titleEl) titleEl.textContent = `แผนผ่อน — ${wallet.name || 'BNPL'}`
      const content = document.getElementById('bnpl-plans-content')
      if (content) content.innerHTML = BNPLui._planListHtml(walletId)
      overlay.classList.add('open')
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
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:13px;border-bottom:1px solid var(--border-soft,rgba(0,0,0,.06));${isPaid ? 'opacity:.45' : ''}${isOver ? 'color:#ef4444' : ''}">
            <span>${isPaid ? '✓' : isOver ? '⚠️' : '○'} งวด ${s.no}/${plan.installments} &nbsp;·&nbsp; ${fmtDate(s.dueDate)}</span>
            <span style="font-weight:500">${money(s.amount)}</span>
          </div>`
        }).join('')

        const payBtn = next && plan.status === 'active'
          ? `<button type="button" class="btn btn-primary btn-sm" style="margin-top:10px;width:100%" onclick="BNPL.ui.openPayModal('${esc(plan.id)}',${next.no});BNPL.ui.closePlanList()">จ่ายงวด ${next.no}/${plan.installments}</button>`
          : ''

        return `<div class="card card-pad" style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:15px">${esc(plan.merchant || 'ไม่ระบุร้าน')}</div>
              <div style="font-size:12px;opacity:.6;margin-top:2px">${fmtDate(plan.purchaseDate)} · ${money(plan.totalAmount)}</div>
            </div>
            <span style="font-size:11px;background:var(--surface2,#f3f4f6);padding:3px 8px;border-radius:20px;white-space:nowrap">${paidCount}/${plan.installments} งวด</span>
          </div>
          <div class="wc-prog-bar" style="margin:8px 0 2px"><div class="wc-prog-fill" style="width:${pct}%;background:${pct >= 100 ? '#22c55e' : 'var(--accent,#6c48c5)'}"></div></div>
          ${nextLabel}
          <details style="margin-top:10px"><summary style="font-size:12px;cursor:pointer;opacity:.6;list-style:none;display:flex;align-items:center;gap:4px"><span>▸</span> รายละเอียดงวด</summary>
            <div style="margin-top:6px">${scheduleRows}</div>
          </details>
          ${payBtn}
        </div>`
      }

      if (active.length === 0 && done.length === 0) {
        return '<div style="text-align:center;padding:48px 16px;opacity:.5;font-size:14px">ยังไม่มีแผนผ่อน<br><small>บันทึกรายจ่ายผ่าน BNPL แล้วเลือกจำนวนงวด</small></div>'
      }

      return `
        ${active.map(planCard).join('')}
        ${done.length > 0 ? `<details style="margin-top:4px"><summary style="font-size:13px;opacity:.55;cursor:pointer;padding:8px 0">ชำระแล้ว (${done.length})</summary><div style="margin-top:8px">${done.map(planCard).join('')}</div></details>` : ''}
      `
    },

    closePlanList() {
      document.getElementById('overlay-bnpl-plans')?.classList.remove('open')
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
        ? `<span style="color:#ef4444;font-size:12px">เกินกำหนด ${fmtDate(item.dueDate)}</span>`
        : `<span style="font-size:12px;opacity:.65">ครบกำหนด ${fmtDate(item.dueDate)}</span>`

      return `<div style="padding:4px 0">
        <div class="form-group">
          <label class="form-label">แผนผ่อน</label>
          <div style="font-weight:600;font-size:15px">${esc(plan.merchant || 'BNPL')}</div>
          <div style="margin-top:3px;display:flex;align-items:center;gap:6px">
            <span style="font-size:13px;opacity:.65">งวด ${item.no} จาก ${plan.installments} งวด</span>
            ${dueLabel}
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">ยอดที่ต้องจ่าย</label>
          <div style="font-size:24px;font-weight:700;color:var(--accent,#6c48c5)">${money(item.amount)}</div>
        </div>
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
          <button type="button" class="btn btn-primary" style="flex:1" onclick="BNPL.ui._confirmPay('${esc(plan.id)}',${item.no})">ยืนยันจ่าย</button>
        </div>
      </div>`
    },

    _confirmPay(planId, no) {
      const sourceWalletId = document.getElementById('bnpl-pay-wallet')?.value
      const date = document.getElementById('bnpl-pay-date')?.value
      if (!sourceWalletId) {
        if (typeof App !== 'undefined') App.toast?.('กรุณาเลือกบัญชีที่จ่าย', 'error')
        return
      }
      const tx = BNPLStore.payInstallment(planId, no, { walletId: sourceWalletId, date })
      if (tx) {
        BNPLui.closePayModal()
        try { App?.render?.() } catch (_) {}
        try { App?.toast?.('บันทึกการชำระงวดแล้ว ✓', 'success') } catch (_) {}
      }
    },

    closePayModal() {
      document.getElementById('overlay-bnpl-pay')?.classList.remove('open')
    },

    // ── Inject overlay HTML into DOM ──
    injectOverlays() {
      if (document.getElementById('overlay-bnpl-plans')) return
      document.body.insertAdjacentHTML('beforeend', `
        <div class="overlay" id="overlay-bnpl-plans" onclick="if(event.target===this||event.target.classList.contains('overlay-backdrop'))BNPL.ui.closePlanList()">
          <div class="overlay-backdrop"></div>
          <div class="sheet">
            <div class="sheet-handle"></div>
            <div class="sheet-header">
              <span class="sheet-title">แผนผ่อน BNPL</span>
              <button class="sheet-close" onclick="BNPL.ui.closePlanList()">✕</button>
            </div>
            <div class="sheet-body" id="bnpl-plans-content"></div>
          </div>
        </div>
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
