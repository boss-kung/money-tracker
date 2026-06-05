/* ================================================================
   loans_v2.js — ระบบให้ยืมเงิน (Loan Ledger)
   เงินที่ให้ยืมไม่นับเป็นรายจ่าย แต่กระทบยอดกระเป๋า
   ================================================================ */
;(function () {
  'use strict'

  // ── helpers ──────────────────────────────────────────────────
  function genId() {
    return 'loan_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  }
  function genRepId() {
    return 'rep_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  }
  function today() {
    return (typeof getTODAY === 'function' ? getTODAY() : new Date().toISOString().slice(0, 10))
  }
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }
  function fmt(n) {
    if (typeof moneyFmt === 'function') return moneyFmt(n)
    if (typeof Calc !== 'undefined' && Calc.fmt) return Calc.fmt(n)
    return '฿' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  function fmtDate(d) {
    if (!d) return ''
    try {
      const [y, m, day] = d.split('-').map(Number)
      const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
      return `${day} ${months[m - 1]} ${y + 543}`
    } catch (_) { return d }
  }
  function isOverdue(loan) {
    if (!loan.dueDate || loan.status === 'settled') return false
    return today() > loan.dueDate
  }
  function isDueSoon(loan) {
    if (!loan.dueDate || loan.status === 'settled') return false
    const diff = (new Date(loan.dueDate) - new Date(today())) / 86400000
    return diff >= 0 && diff <= 7
  }

  // ── LoanStore — data layer ────────────────────────────────────
  const LoanStore = {
    getAll() { return (typeof S !== 'undefined' ? S.loans : null) || [] },

    getById(id) { return LoanStore.getAll().find(l => l.id === id) || null },

    remaining(loan) {
      const paid = (loan.repayments || []).reduce((s, r) => s + Number(r.amount || 0), 0)
      return Math.max(0, Number(loan.amount || 0) - paid)
    },

    totalOutstanding() {
      return LoanStore.getAll()
        .filter(l => l.status !== 'settled')
        .reduce((s, l) => s + LoanStore.remaining(l), 0)
    },

    outstanding() {
      return LoanStore.getAll().filter(l => l.status !== 'settled')
    },

    settled() {
      return LoanStore.getAll().filter(l => l.status === 'settled')
    },

    _adjustWallet(walletId, delta) {
      if (!walletId || typeof S === 'undefined') return
      const w = (S.wallets || []).find(x => x.id === walletId)
      if (w) w.balance = Math.round((Number(w.balance || 0) + delta) * 100) / 100
    },

    create(data) {
      const loan = {
        id: genId(),
        borrowerName: String(data.borrowerName || '').trim(),
        borrowerContact: String(data.borrowerContact || '').trim(),
        amount: Number(data.amount) || 0,
        walletId: data.walletId || '',
        date: data.date || today(),
        dueDate: data.dueDate || '',
        note: String(data.note || '').trim(),
        status: 'outstanding',
        repayments: [],
        createdAt: new Date().toISOString(),
      }
      if (typeof S !== 'undefined') {
        S.loans = [loan, ...(S.loans || [])]
        LoanStore._adjustWallet(loan.walletId, -loan.amount)
        if (typeof persist === 'function') persist()
      }
      return loan
    },

    update(id, data) {
      if (typeof S === 'undefined') return
      const idx = (S.loans || []).findIndex(l => l.id === id)
      if (idx < 0) return
      const old = S.loans[idx]
      // if amount or walletId changed, reverse old then apply new
      if (data.amount !== undefined && (Number(data.amount) !== old.amount || (data.walletId && data.walletId !== old.walletId))) {
        LoanStore._adjustWallet(old.walletId, old.amount)
        LoanStore._adjustWallet(data.walletId || old.walletId, -Number(data.amount))
      }
      S.loans[idx] = { ...old, ...data, id, repayments: old.repayments }
      if (typeof persist === 'function') persist()
    },

    delete(id) {
      if (typeof S === 'undefined') return
      const loan = LoanStore.getById(id)
      if (!loan) return
      // reverse wallet adjustments
      LoanStore._adjustWallet(loan.walletId, loan.amount)
      ;(loan.repayments || []).forEach(r => LoanStore._adjustWallet(r.walletId, -r.amount))
      S.loans = (S.loans || []).filter(l => l.id !== id)
      if (typeof persist === 'function') persist()
    },

    addRepayment(loanId, data) {
      if (typeof S === 'undefined') return null
      const loan = LoanStore.getById(loanId)
      if (!loan) return null
      const rep = {
        id: genRepId(),
        date: data.date || today(),
        amount: Number(data.amount) || 0,
        walletId: data.walletId || loan.walletId || '',
        note: String(data.note || '').trim(),
      }
      loan.repayments = [...(loan.repayments || []), rep]
      LoanStore._adjustWallet(rep.walletId, rep.amount)
      if (LoanStore.remaining(loan) <= 0) loan.status = 'settled'
      if (typeof persist === 'function') persist()
      return rep
    },

    deleteRepayment(loanId, repId) {
      if (typeof S === 'undefined') return
      const loan = LoanStore.getById(loanId)
      if (!loan) return
      const rep = (loan.repayments || []).find(r => r.id === repId)
      if (!rep) return
      LoanStore._adjustWallet(rep.walletId, -rep.amount)
      loan.repayments = loan.repayments.filter(r => r.id !== repId)
      if (loan.status === 'settled' && LoanStore.remaining(loan) > 0) loan.status = 'outstanding'
      if (typeof persist === 'function') persist()
    },

    markSettled(id, settled = true) {
      if (typeof S === 'undefined') return
      const loan = LoanStore.getById(id)
      if (!loan) return
      loan.status = settled ? 'settled' : 'outstanding'
      if (typeof persist === 'function') persist()
    },
  }

  window.LoanStore = LoanStore

  // ── hook into _ledgerFlows so recalculateWalletBalances includes loans ──
  // recalculateWalletBalances (called at startup) uses _ledgerFlows directly.
  // Without this patch, it resets wallet balances ignoring loans on every reload.
  if (typeof App !== 'undefined') {
    const _patchFlows = () => {
      function _addLoanFlows(result) {
        ;(S.loans || []).forEach(loan => {
          if (loan.walletId)
            result.cash[loan.walletId] = (result.cash[loan.walletId] || 0) - Number(loan.amount || 0)
          ;(loan.repayments || []).forEach(r => {
            if (r.walletId)
              result.cash[r.walletId] = (result.cash[r.walletId] || 0) + Number(r.amount || 0)
          })
        })
        return result
      }

      // Patch _ledgerFlows — the one recalculateWalletBalances actually uses
      if (typeof App._ledgerFlows === 'function') {
        const prevLedger = App._ledgerFlows.bind(App)
        App._ledgerFlows = function () { return _addLoanFlows(prevLedger()) }
      }

      // Also patch _computeWalletFlows for the balance-repair UI
      if (typeof App._computeWalletFlows === 'function') {
        const prevFlows = App._computeWalletFlows.bind(App)
        App._computeWalletFlows = function () { return _addLoanFlows(prevFlows()) }
      }

      // Re-run recalculateWalletBalances so current session has correct balances
      // (it already ran in app_v2.js before loans_v2.js loaded, without loan flows)
      try { App.recalculateWalletBalances?.({ save: false }) } catch (_) {}
      try { if (typeof S !== 'undefined') App.render?.() } catch (_) {}
    }

    if (App._ledgerFlows) {
      _patchFlows()
    } else {
      document.addEventListener('DOMContentLoaded', _patchFlows, { once: true })
    }
  }

  // ── UI ────────────────────────────────────────────────────────

  // draft state for the loan form
  let _draft = null
  let _repDraft = null
  let _editLoanId = null

  function _walletOptions(selectedId) {
    const wallets = (typeof S !== 'undefined' ? S.wallets : []) || []
    const spendable = new Set(['bank', 'cash', 'ewallet', 'saving'])
    return wallets
      .filter(w => w && !w.hiddenFromWalletList && spendable.has(String(w.type || '').toLowerCase()))
      .map(w => `<option value="${esc(w.id)}"${w.id === selectedId ? ' selected' : ''}>${esc(w.icon || '👛')} ${esc(w.name)}</option>`)
      .join('')
  }

  function _walletName(id) {
    const w = ((typeof S !== 'undefined' ? S.wallets : null) || []).find(x => x.id === id)
    return w ? `${w.icon || '👛'} ${w.name}` : '—'
  }

  // ── List Screen ───────────────────────────────────────────────
  App.openLoansScreen = function () {
    App.openSubScreen(_renderLoanList())
    document.getElementById('sub-screen')?.querySelectorAll('[data-loan-id]').forEach(el => {
      el.addEventListener('click', () => App.openLoanDetail(el.dataset.loanId))
    })
  }

  function _renderLoanList() {
    const outstanding = LoanStore.outstanding().sort((a, b) => b.date.localeCompare(a.date))
    const settled = LoanStore.settled().sort((a, b) => b.date.localeCompare(a.date))
    const total = LoanStore.totalOutstanding()
    const hideMoney = typeof S !== 'undefined' && S.settings?.hideMoney

    const loanCard = (l) => {
      const rem = LoanStore.remaining(l)
      const overdue = isOverdue(l)
      const dueSoon = isDueSoon(l)
      const dueLine = l.dueDate
        ? `<span style="font-size:12px;color:${overdue ? 'var(--expense)' : dueSoon ? '#D97706' : 'var(--muted)'}">
            ${overdue ? '⚠️ เกินกำหนด' : dueSoon ? '⏰' : '📅'} ${fmtDate(l.dueDate)}
           </span>`
        : ''
      const paidPct = l.amount > 0 ? Math.min(100, Math.round(((l.amount - rem) / l.amount) * 100)) : 100
      const progressBar = l.status !== 'settled' && l.repayments?.length
        ? `<div style="margin-top:6px;height:4px;background:var(--border);border-radius:2px;overflow:hidden"><div style="width:${paidPct}%;height:100%;background:var(--income);border-radius:2px"></div></div>`
        : ''
      return `<div class="settings-row" style="align-items:flex-start;padding:12px 16px;cursor:pointer" data-loan-id="${esc(l.id)}">
        <div style="font-size:20px;margin-right:12px;margin-top:2px">👤</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:15px">${esc(l.borrowerName)}</div>
          <div style="font-size:13px;color:var(--muted);margin-top:2px">${fmt(l.amount)} · ${fmtDate(l.date)}</div>
          ${dueLine}
          ${l.status !== 'settled' ? `<div style="font-size:13px;font-weight:600;color:var(--expense);margin-top:2px">คงค้าง ${fmt(rem)}</div>` : ''}
          ${progressBar}
        </div>
        <div style="color:var(--muted);font-size:18px;margin-left:8px;margin-top:4px">›</div>
      </div>`
    }

    const outstandingHtml = outstanding.length
      ? outstanding.map(loanCard).join('<div style="height:1px;background:var(--border);margin:0 16px"></div>')
      : `<div style="padding:24px 16px;text-align:center;color:var(--muted);font-size:14px">ไม่มีรายการค้างอยู่</div>`

    const settledHtml = settled.length
      ? `<details style="margin-top:8px">
           <summary style="padding:12px 16px;cursor:pointer;font-size:14px;color:var(--muted);list-style:none;display:flex;align-items:center;justify-content:space-between">
             <span>คืนครบแล้ว (${settled.length})</span><span>›</span>
           </summary>
           <div class="card" style="margin:0 0 8px">
             ${settled.map(loanCard).join('<div style="height:1px;background:var(--border);margin:0 16px"></div>')}
           </div>
         </details>`
      : ''

    return `
      <div class="sub-header">
        <button class="btn-icon" onclick="App.closeSubScreen()">←</button>
        <h2>ให้ยืมเงิน</h2>
        <button class="btn btn-primary btn-sm" onclick="App.openLoanForm()" style="width:auto;padding:8px 14px">+ ให้ยืมใหม่</button>
      </div>
      <div class="sub-scroll" style="padding:12px 16px 40px">
        ${outstanding.length || !settled.length ? `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">ยังค้างอยู่</div>
            <div style="font-size:15px;font-weight:700;color:var(--expense)">${fmt(total)}</div>
          </div>
          <div class="card" style="margin-bottom:8px" id="loans-outstanding-list">
            ${outstandingHtml}
          </div>` : ''}
        ${settledHtml}
      </div>`
  }

  // ── Detail Screen ─────────────────────────────────────────────
  App.openLoanDetail = function (id) {
    const loan = LoanStore.getById(id)
    if (!loan) return
    App.openSubScreen(_renderLoanDetail(loan))
  }

  function _renderLoanDetail(loan) {
    const hideMoney = typeof S !== 'undefined' && S.settings?.hideMoney
    const rem = LoanStore.remaining(loan)
    const overdue = isOverdue(loan)
    const dueSoon = isDueSoon(loan)

    const repRows = (loan.repayments || [])
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(r => `
        <div style="display:flex;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600;color:var(--income)">+${fmt(r.amount)}</div>
            <div style="font-size:12px;color:var(--muted)">${fmtDate(r.date)}${r.walletId ? ' · ' + _walletName(r.walletId) : ''}${r.note ? ' · ' + esc(r.note) : ''}</div>
          </div>
          <button class="btn-icon" style="color:var(--muted);font-size:16px" onclick="App._loanDeleteRepayment('${esc(loan.id)}','${esc(r.id)}')">🗑</button>
        </div>`).join('')

    const progressPct = loan.amount > 0 ? Math.min(100, Math.round(((loan.amount - rem) / loan.amount) * 100)) : 100

    return `
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openLoansScreen()">←</button>
        <h2>${esc(loan.borrowerName)}</h2>
        <div style="display:flex;gap:4px">
          <button class="btn-icon" onclick="App.openLoanForm('${esc(loan.id)}')" title="แก้ไข">✏️</button>
          <button class="btn-icon" onclick="App._loanDeleteConfirm('${esc(loan.id)}')" title="ลบ">🗑</button>
        </div>
      </div>
      <div class="sub-scroll" style="padding:16px 16px 48px">
        <div class="card card-pad" style="margin-bottom:12px">
          <div style="font-size:28px;font-weight:700;margin-bottom:4px">${fmt(loan.amount)}</div>
          <div style="font-size:13px;color:var(--muted)">ให้ยืมเมื่อ ${fmtDate(loan.date)} · ${_walletName(loan.walletId)}</div>
          ${loan.dueDate ? `<div style="font-size:13px;margin-top:4px;color:${overdue ? 'var(--expense)' : dueSoon ? '#D97706' : 'var(--muted)'}">
            ${overdue ? '⚠️ เกินกำหนดแล้ว' : dueSoon ? '⏰ ใกล้ครบกำหนด'  : '📅 ครบกำหนด'} ${fmtDate(loan.dueDate)}
          </div>` : ''}
          ${loan.borrowerContact ? `<div style="font-size:13px;color:var(--muted);margin-top:4px">📞 ${esc(loan.borrowerContact)}</div>` : ''}
          ${loan.note ? `<div style="font-size:13px;color:var(--muted);margin-top:4px">📝 ${esc(loan.note)}</div>` : ''}
        </div>

        ${loan.status !== 'settled' ? `
        <div class="card card-pad" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="font-size:13px;color:var(--muted)">คงค้าง</div>
            <div style="font-size:18px;font-weight:700;color:var(--expense)">${fmt(rem)}</div>
          </div>
          <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="width:${progressPct}%;height:100%;background:var(--income);border-radius:3px;transition:width .3s"></div>
          </div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">คืนมาแล้ว ${progressPct}%</div>
        </div>` : `
        <div style="text-align:center;padding:12px;background:var(--income-bg,#d1fae5);border-radius:12px;margin-bottom:12px">
          <div style="font-size:16px;font-weight:700;color:var(--income)">✅ คืนครบแล้ว</div>
        </div>`}

        <div class="card card-pad" style="margin-bottom:12px">
          <div style="font-size:13px;font-weight:600;color:var(--muted);margin-bottom:8px">ประวัติการรับคืน</div>
          ${repRows || `<div style="font-size:13px;color:var(--muted);text-align:center;padding:8px 0">ยังไม่มีรายการรับคืน</div>`}
        </div>

        ${loan.status !== 'settled' ? `
        <button class="btn btn-primary" onclick="App.openRepaymentForm('${esc(loan.id)}')" style="width:100%;margin-bottom:8px">
          + บันทึกรับคืน
        </button>
        <button class="btn" onclick="App._loanMarkSettled('${esc(loan.id)}')" style="width:100%;color:var(--income)">
          ✅ ทำเครื่องหมายว่าคืนครบแล้ว
        </button>` : `
        <button class="btn" onclick="App._loanMarkSettled('${esc(loan.id)}', false)" style="width:100%;color:var(--muted)">
          ↩️ เปลี่ยนเป็นยังค้างอยู่
        </button>`}
      </div>`
  }

  // ── Loan Form ─────────────────────────────────────────────────
  App.openLoanForm = function (editId) {
    _editLoanId = editId || null
    const existing = editId ? LoanStore.getById(editId) : null
    _draft = existing ? {
      borrowerName: existing.borrowerName,
      borrowerContact: existing.borrowerContact || '',
      amount: String(existing.amount),
      walletId: existing.walletId,
      date: existing.date,
      dueDate: existing.dueDate || '',
      note: existing.note || '',
    } : {
      borrowerName: '',
      borrowerContact: '',
      amount: '',
      walletId: (typeof S !== 'undefined' && (S.wallets || []).find(w => !w.hiddenFromWalletList && ['bank','cash','ewallet','saving'].includes(String(w.type||'').toLowerCase())))?.id || '',
      date: today(),
      dueDate: '',
      note: '',
    }
    App.openSubScreen(_renderLoanForm())
  }

  function _renderLoanForm() {
    const isEdit = !!_editLoanId
    const d = _draft
    return `
      <div class="sub-header">
        <button class="btn-icon" onclick="${isEdit ? `App.openLoanDetail('${esc(_editLoanId)}')` : 'App.openLoansScreen()'}">←</button>
        <h2>${isEdit ? 'แก้ไขรายการ' : 'ให้ยืมเงิน'}</h2>
        <div></div>
      </div>
      <div class="sub-scroll" style="padding:16px 16px 48px">
        <div class="card card-pad" style="margin-bottom:12px">
          <div class="form-group">
            <label class="form-label">ชื่อคนยืม <span style="color:var(--expense)">*</span></label>
            <input class="form-input" id="loan-borrower-name" type="text" placeholder="เช่น สมชาย, น้องบิ๊ก" value="${esc(d.borrowerName)}" maxlength="100" oninput="window._loanDraft('borrowerName',this.value)">
          </div>
          <div class="form-group">
            <label class="form-label">ข้อมูลติดต่อ (ไม่บังคับ)</label>
            <input class="form-input" id="loan-borrower-contact" type="text" placeholder="เบอร์โทร / Line ID" value="${esc(d.borrowerContact)}" maxlength="100" oninput="window._loanDraft('borrowerContact',this.value)">
          </div>
        </div>
        <div class="card card-pad" style="margin-bottom:12px">
          <div class="form-group">
            <label class="form-label">จำนวนเงินที่ให้ยืม <span style="color:var(--expense)">*</span></label>
            <input class="form-input" id="loan-amount" type="number" min="0" step="any" placeholder="0.00" value="${esc(d.amount)}" oninput="window._loanDraft('amount',this.value)" style="font-size:20px;font-weight:700">
          </div>
          <div class="form-group">
            <label class="form-label">กระเป๋าที่จ่ายออก <span style="color:var(--expense)">*</span></label>
            <select class="form-input" id="loan-wallet" onchange="window._loanDraft('walletId',this.value)">
              <option value="">เลือกกระเป๋า</option>
              ${_walletOptions(d.walletId)}
            </select>
          </div>
        </div>
        <div class="card card-pad" style="margin-bottom:12px">
          <div class="form-group">
            <label class="form-label">วันที่ให้ยืม</label>
            <input class="form-input" id="loan-date" type="date" value="${esc(d.date)}" oninput="window._loanDraft('date',this.value)">
          </div>
          <div class="form-group">
            <label class="form-label">วันนัดคืน (ไม่บังคับ)</label>
            <input class="form-input" id="loan-due-date" type="date" value="${esc(d.dueDate)}" oninput="window._loanDraft('dueDate',this.value)">
          </div>
          <div class="form-group">
            <label class="form-label">หมายเหตุ</label>
            <input class="form-input" id="loan-note" type="text" placeholder="เช่น ค่าเช่า, ฉุกเฉิน" value="${esc(d.note)}" maxlength="200" oninput="window._loanDraft('note',this.value)">
          </div>
        </div>
        <button class="btn btn-primary" onclick="App._loanSave()" style="width:100%">
          ${isEdit ? 'บันทึกการแก้ไข' : '💸 บันทึกการให้ยืม'}
        </button>
      </div>`
  }

  window._loanDraft = function (key, val) {
    if (_draft) _draft[key] = val
  }

  App._loanSave = function () {
    if (!_draft) return
    const name = (_draft.borrowerName || '').trim()
    const amount = parseFloat(_draft.amount)
    if (!name) { if (typeof toast === 'function') toast('กรุณากรอกชื่อคนยืม', 'error'); return }
    if (!amount || amount <= 0) { if (typeof toast === 'function') toast('กรุณากรอกจำนวนเงิน', 'error'); return }
    if (!_draft.walletId) { if (typeof toast === 'function') toast('กรุณาเลือกกระเป๋า', 'error'); return }
    if (_editLoanId) {
      LoanStore.update(_editLoanId, { ..._draft, amount })
      if (typeof toast === 'function') toast('บันทึกแล้ว', 'success')
      App.openLoanDetail(_editLoanId)
    } else {
      const loan = LoanStore.create({ ..._draft, amount })
      if (typeof toast === 'function') toast('บันทึกการให้ยืมแล้ว', 'success')
      App.openLoanDetail(loan.id)
    }
    _draft = null
    _editLoanId = null
    if (typeof S !== 'undefined' && S.page === 'more') App.renderMore?.()
  }

  App._loanDeleteConfirm = function (id) {
    const loan = LoanStore.getById(id)
    if (!loan) return
    App.showConfirm({
      title: 'ลบรายการให้ยืม',
      body: `ลบ "${loan.borrowerName}" ${fmt(loan.amount)} ออก?\nยอดจะถูกคืนกลับกระเป๋า`,
      danger: true,
      confirmLabel: 'ลบ',
      onConfirm() {
        LoanStore.delete(id)
        if (typeof toast === 'function') toast('ลบแล้ว', 'success')
        App.openLoansScreen()
        if (typeof S !== 'undefined' && S.page === 'more') App.renderMore?.()
      },
    })
  }

  App._loanMarkSettled = function (id, settled = true) {
    LoanStore.markSettled(id, settled)
    App.openLoanDetail(id)
    if (typeof toast === 'function') toast(settled ? 'ทำเครื่องหมายว่าคืนครบแล้ว' : 'เปลี่ยนเป็นยังค้างอยู่', 'success')
    if (typeof S !== 'undefined' && S.page === 'more') App.renderMore?.()
  }

  // ── Repayment Form ────────────────────────────────────────────
  App.openRepaymentForm = function (loanId) {
    const loan = LoanStore.getById(loanId)
    if (!loan) return
    const rem = LoanStore.remaining(loan)
    _repDraft = {
      loanId,
      amount: String(rem > 0 ? rem : loan.amount),
      walletId: loan.walletId || '',
      date: today(),
      note: '',
    }
    App.openSubScreen(_renderRepaymentForm(loan))
  }

  function _renderRepaymentForm(loan) {
    const d = _repDraft
    return `
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openLoanDetail('${esc(loan.id)}')">←</button>
        <h2>บันทึกรับคืน</h2>
        <div></div>
      </div>
      <div class="sub-scroll" style="padding:16px 16px 48px">
        <div class="card card-pad" style="margin-bottom:12px">
          <div style="font-size:13px;color:var(--muted)">รับคืนจาก</div>
          <div style="font-size:18px;font-weight:700;margin-top:2px">${esc(loan.borrowerName)}</div>
          <div style="font-size:13px;color:var(--expense);margin-top:2px">คงค้าง ${fmt(LoanStore.remaining(loan))}</div>
        </div>
        <div class="card card-pad" style="margin-bottom:12px">
          <div class="form-group">
            <label class="form-label">จำนวนเงินที่รับคืน <span style="color:var(--expense)">*</span></label>
            <input class="form-input" id="rep-amount" type="number" min="0" step="any" placeholder="0.00" value="${esc(d.amount)}" oninput="window._repDraft('amount',this.value)" style="font-size:20px;font-weight:700">
          </div>
          <div class="form-group">
            <label class="form-label">รับเข้ากระเป๋า <span style="color:var(--expense)">*</span></label>
            <select class="form-input" id="rep-wallet" onchange="window._repDraft('walletId',this.value)">
              <option value="">เลือกกระเป๋า</option>
              ${_walletOptions(d.walletId)}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">วันที่รับคืน</label>
            <input class="form-input" id="rep-date" type="date" value="${esc(d.date)}" oninput="window._repDraft('date',this.value)">
          </div>
          <div class="form-group">
            <label class="form-label">หมายเหตุ</label>
            <input class="form-input" id="rep-note" type="text" placeholder="ไม่บังคับ" value="${esc(d.note)}" maxlength="200" oninput="window._repDraft('note',this.value)">
          </div>
        </div>
        <button class="btn btn-primary" onclick="App._repaySave()" style="width:100%">✅ บันทึกรับคืน</button>
      </div>`
  }

  window._repDraft = function (key, val) {
    if (_repDraft) _repDraft[key] = val
  }

  App._repaySave = function () {
    if (!_repDraft) return
    const amount = parseFloat(_repDraft.amount)
    if (!amount || amount <= 0) { if (typeof toast === 'function') toast('กรุณากรอกจำนวนเงิน', 'error'); return }
    if (!_repDraft.walletId) { if (typeof toast === 'function') toast('กรุณาเลือกกระเป๋า', 'error'); return }
    LoanStore.addRepayment(_repDraft.loanId, { ..._repDraft, amount })
    if (typeof toast === 'function') toast('บันทึกการรับคืนแล้ว', 'success')
    App.openLoanDetail(_repDraft.loanId)
    _repDraft = null
    if (typeof S !== 'undefined' && S.page === 'more') App.renderMore?.()
  }

  App._loanDeleteRepayment = function (loanId, repId) {
    App.showConfirm({
      title: 'ลบรายการรับคืน',
      body: 'ลบรายการนี้ออก? ยอดกระเป๋าจะถูกปรับกลับ',
      danger: true,
      confirmLabel: 'ลบ',
      onConfirm() {
        LoanStore.deleteRepayment(loanId, repId)
        if (typeof toast === 'function') toast('ลบแล้ว', 'success')
        App.openLoanDetail(loanId)
      },
    })
  }

})()
