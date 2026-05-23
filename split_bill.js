/* ============================================================
   Split Bill v2 — 6-step flow
   Standalone module. No wallet/transaction/report dependency.
   ============================================================ */
;(function () {
  'use strict'
  if (typeof App === 'undefined') return

  // ── Constants ────────────────────────────────────────────────
  const BILLS_KEY  = 'mt_split_bills'
  const PEOPLE_KEY = 'mt_split_people'

  // ── Utilities ────────────────────────────────────────────────
  const esc     = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))
  const nowISO  = () => new Date().toISOString()
  const genId   = () => Date.now().toString(36) + Math.random().toString(36).slice(2)
  const fmt     = n => { const v = Number(n||0); return '฿' + (v === 0 ? '0' : v.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})) }
  const notify  = (msg, type='info') => { try { toast(msg, type) } catch(_) {} }
  const r2      = n => Math.round((Number(n)||0) * 100) / 100
  const numVal  = el => parseFloat(String(el?.value||'').replace(/,/g,'')) || 0
  const todayStr = () => {
    try { if (typeof getTODAY === 'function') return getTODAY() } catch(_) {}
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
  const thaiDate = s => {
    if (!s) return ''
    const [y,m,d] = s.split('-').map(Number)
    return `${d} ${['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][m-1]} ${y+543}`
  }

  // ── Store ────────────────────────────────────────────────────
  const SbStore = {
    loadBills:    () => { try { return JSON.parse(localStorage.getItem(BILLS_KEY)||'[]')||[] } catch(_) { return [] } },
    saveBills:    b  => { try { localStorage.setItem(BILLS_KEY,  JSON.stringify(b)); if (typeof S !== 'undefined') S.splitBills = b; return true } catch(_) { return false } },
    loadPeople:   () => { try { return JSON.parse(localStorage.getItem(PEOPLE_KEY)||'[]')||[] } catch(_) { return [] } },
    savePeople:   p  => { try { localStorage.setItem(PEOPLE_KEY, JSON.stringify(p)); if (typeof S !== 'undefined') S.splitPeople = p; return true } catch(_) { return false } },
    getBill:      id => SbStore.loadBills().find(b => b.id === id) || null,
    getPerson:    id => SbStore.loadPeople().find(p => p.id === id) || null,
    upsertBill:   bill => {
      const list = SbStore.loadBills(); const i = list.findIndex(b => b.id === bill.id)
      if (i >= 0) list[i] = bill; else list.unshift(bill); return SbStore.saveBills(list)
    },
    deleteBill:   id => SbStore.saveBills(SbStore.loadBills().filter(b => b.id !== id)),
    upsertPerson: person => {
      const list = SbStore.loadPeople(); const i = list.findIndex(p => p.id === person.id)
      if (i >= 0) list[i] = person; else list.unshift(person); return SbStore.savePeople(list)
    },
    deletePerson: id => SbStore.savePeople(SbStore.loadPeople().filter(p => p.id !== id)),
  }

  // ── Data helpers ─────────────────────────────────────────────
  function defaultPipeline() {
    return [
      { id: 'discount', type: 'discount', label: 'ส่วนลด',         enabled: false, mode: 'percent', value: 0,  base: 'running' },
      { id: 'service',  type: 'service',  label: 'Service Charge', enabled: false, mode: 'percent', value: 10, base: 'running' },
      { id: 'vat',      type: 'vat',      label: 'VAT',            enabled: false, mode: 'percent', value: 7,  base: 'running' },
    ]
  }

  function newDraft(base = {}) {
    return {
      id:          base.id       || genId(),
      title:       base.title    || '',
      date:        base.date     || todayStr(),
      manualTotal: Number(base.manualTotal) || 0,
      ownerPersonId: base.ownerPersonId || '',
      linkedTransactionId: base.linkedTransactionId || '',
      peopleIds:   Array.isArray(base.peopleIds) ? [...base.peopleIds] : [],
      items:       Array.isArray(base.items) ? JSON.parse(JSON.stringify(base.items)) : [],
      pipeline:    Array.isArray(base.pipeline) ? JSON.parse(JSON.stringify(base.pipeline)) : defaultPipeline(),
      payments:    base.payments ? { ...base.payments } : {},
      rounding:    (() => {
        const r = base.rounding
        if (!r || r === false || r === 0) return { mode: 'off', amount: 0 }
        if (r === true || r === 25) return { mode: 'satang25', amount: 0 }
        if (typeof r === 'object' && r !== null) return { mode: r.mode || 'off', amount: Number(r.amount) || 0 }
        return { mode: 'off', amount: 0 }
      })(),
      createdAt:   base.createdAt || nowISO(),
      updatedAt:   nowISO(),
    }
  }

  // ── Calculator ───────────────────────────────────────────────
  function itemEffectivePrice(item) {
    // Support legacy format (qty × pricePerUnit) and new format (price)
    const base = item.price != null
      ? Number(item.price) || 0
      : (Number(item.qty)||1) * (Number(item.pricePerUnit)||0)
    if (!item.discount?.enabled) return r2(base)
    const disc = item.discount.mode === 'percent'
      ? base * (Number(item.discount.value)||0) / 100
      : Number(item.discount.value)||0
    return r2(base - Math.max(0, disc))
  }

  function itemSubtotal(draft) {
    return r2((draft.items||[]).reduce((s, item) => s + itemEffectivePrice(item), 0))
  }

  function roundToUnit(satang, unit) {
    const r = satang % unit
    return r <= unit / 2 ? satang - r : satang - r + unit
  }

  function runPipeline(subtotal, pipeline, rounding = false) {
    const foodBase = r2(subtotal)
    let amount = foodBase
    const steps = [{ label: 'ยอดอาหาร', amount, delta: 0, type: 'base' }]
    for (const p of (pipeline||[])) {
      if (!p.enabled) continue
      const base = p.base === 'food' ? foodBase : amount
      let raw = p.mode === 'percent' ? base * (Number(p.value)||0) / 100 : (Number(p.value)||0)
      const delta = p.type === 'discount' ? -Math.abs(r2(raw)) : Math.abs(r2(raw))
      amount = r2(amount + delta)
      steps.push({ label: p.label, amount, delta, type: p.type, mode: p.mode, value: p.value, base: p.base })
    }
    let roundingDelta = 0
    const rm = (typeof rounding === 'object' && rounding !== null) ? rounding
      : { mode: rounding > 0 ? 'satang25' : 'off', amount: 0 }
    if (rm.mode === 'satang25') {
      const rounded = roundToUnit(Math.round(amount * 100), 25) / 100
      roundingDelta = r2(rounded - amount)
      amount = rounded
    } else if (rm.mode === 'custom') {
      roundingDelta = r2(Number(rm.amount) || 0)
      amount = r2(amount + roundingDelta)
    }
    return { finalTotal: amount, steps, roundingDelta }
  }

  function calcShares(draft) {
    const byPerson = {}
    draft.peopleIds.forEach(id => { byPerson[id] = 0 })

    ;(draft.items||[]).forEach(item => {
      const total = itemEffectivePrice(item)
      const parts = (item.participants||[]).filter(p => draft.peopleIds.includes(p.personId))
      if (!parts.length) return
      if (item.splitMode === 'ratio') {
        const sum = parts.reduce((s,p) => s + (Number(p.ratio)||1), 0)
        parts.forEach(p => { byPerson[p.personId] = r2(byPerson[p.personId] + (Number(p.ratio)||1)/sum * total) })
      } else {
        parts.forEach(p => { byPerson[p.personId] = r2(byPerson[p.personId] + total / parts.length) })
      }
    })

    const sub = r2(Object.values(byPerson).reduce((s,v)=>s+v,0))
    const { finalTotal } = runPipeline(sub, draft.pipeline, draft.rounding)
    const shares = {}
    const ceilSatang = n => Math.ceil(Number(n.toFixed(4)) * 100) / 100

    if (sub > 0) {
      const ids = Object.keys(byPerson)
      ids.forEach(id => { shares[id] = ceilSatang(byPerson[id] / sub * finalTotal) })
    } else if (draft.peopleIds.length) {
      draft.peopleIds.forEach(id => { shares[id] = ceilSatang(finalTotal / draft.peopleIds.length) })
    }

    return { shares, sub, finalTotal }
  }

  function calcResult(draft) {
    const people  = SbStore.loadPeople()
    const pNameFn = id => { const p = people.find(x=>x.id===id); return p ? p.name : '?' }
    const { shares, finalTotal } = calcShares(draft)
    const payments = draft.payments || {}

    const personResults = draft.peopleIds.map(id => {
      const finalShare = r2(shares[id] || 0)
      const paid       = r2(payments[id] || 0)
      const net        = r2(paid - finalShare)
      return { id, name: pNameFn(id), finalShare, paid, net }
    })

    const creditors = personResults.filter(p=>p.net> 0.005).map(p=>({...p,amt:Math.round(p.net*100)})).sort((a,b)=>b.amt-a.amt)
    const debtors   = personResults.filter(p=>p.net<-0.005).map(p=>({...p,amt:Math.round(-p.net*100)})).sort((a,b)=>b.amt-a.amt)
    const transfers = []
    let ci=0, di=0
    while (ci < creditors.length && di < debtors.length) {
      const c = creditors[ci], d = debtors[di]
      const amt = Math.min(c.amt, d.amt)
      if (amt > 0) transfers.push({ from: d.id, fromName: d.name, to: c.id, toName: c.name, amount: r2(amt/100) })
      c.amt -= amt; d.amt -= amt
      if (c.amt <= 0) ci++
      if (d.amt <= 0) di++
    }

    const warnings = []
    const sub = itemSubtotal(draft)
    const { finalTotal: calcTotal } = runPipeline(sub, draft.pipeline, draft.rounding)

    if (draft.manualTotal > 0 && Math.abs(r2(draft.manualTotal - calcTotal)) > 0.5) {
      const diff = r2(draft.manualTotal - calcTotal)
      if (diff > 0) warnings.push(`ยอดคำนวณ ${fmt(calcTotal)} น้อยกว่ายอดบิล ${fmt(draft.manualTotal)} อยู่ ${fmt(diff)} — อาจมีรายการที่ยังไม่ได้เพิ่ม หรือยังไม่ได้เปิด VAT/SC`)
      else          warnings.push(`ยอดคำนวณ ${fmt(calcTotal)} มากกว่ายอดบิล ${fmt(draft.manualTotal)} อยู่ ${fmt(Math.abs(diff))} — กรุณาตรวจสอบราคารายการ`)
    }

    const totalPaid = draft.peopleIds.reduce((s,id) => s + r2(payments[id]||0), 0)
    if (draft.peopleIds.length && Math.abs(r2(totalPaid - finalTotal)) > 0.5) {
      warnings.push(`ยอดที่จ่ายรวม ${fmt(totalPaid)} ${totalPaid < finalTotal ? 'น้อยกว่า' : 'มากกว่า'} ยอดสุดท้าย ${fmt(finalTotal)}`)
    }

    return { personResults, transfers, finalTotal, calcTotal, warnings }
  }

  window.SplitBillCalc = { calcResult, runPipeline, itemSubtotal, calcShares }
  window.SbStore = SbStore

  function findTx(id) {
    if (!id || typeof S === 'undefined') return null
    return (S.transactions || []).find(t => t.id === id) || null
  }

  function splitBillOwnerSummary(bill) {
    const result = calcResult(bill)
    const ownerId = bill?.ownerPersonId || ''
    const owner = ownerId ? SbStore.getPerson(ownerId) : null
    const ownerResult = ownerId ? result.personResults.find(p => p.id === ownerId) || null : null
    const paidAmount = r2(ownerId ? Number((bill.payments || {})[ownerId] || 0) : 0)
    const shareAmount = r2(ownerResult?.finalShare || 0)
    const reimbursableAmount = r2(Math.max(0, paidAmount - shareAmount))
    return {
      result,
      ownerId,
      owner,
      ownerName: owner?.name || '',
      paidAmount,
      shareAmount,
      reimbursableAmount,
    }
  }

  function splitBillLinkState(bill) {
    if (!bill) return { status: 'missing_bill', billId: '', billTitle: '', message: 'ไม่พบบิลหารที่เคยเชื่อมไว้' }
    const summary = splitBillOwnerSummary(bill)
    const billTitle = bill.title || 'บิลร่วม'
    const linkedTxId = bill.linkedTransactionId || ''
    if (!summary.ownerId) {
      return {
        status: 'needs_owner',
        billId: bill.id,
        billTitle,
        linkedTxId,
        expected: summary,
        message: 'เลือกคนที่เป็นเราเพื่อสร้างรายการจ่าย',
      }
    }
    if (!(summary.paidAmount > 0)) {
      return {
        status: 'needs_payment',
        billId: bill.id,
        billTitle,
        linkedTxId,
        expected: summary,
        message: 'ระบุยอดที่เราจ่ายก่อน จึงจะสร้างรายการจ่ายได้',
      }
    }
    if (!linkedTxId) {
      return {
        status: 'unlinked',
        billId: bill.id,
        billTitle,
        linkedTxId: '',
        expected: summary,
        message: 'ยังไม่ได้สร้างรายการจ่ายจากบิลนี้',
      }
    }
    const tx = findTx(linkedTxId)
    if (!tx) {
      return {
        status: 'orphaned',
        billId: bill.id,
        billTitle,
        linkedTxId,
        expected: summary,
        message: 'ไม่พบรายการจ่ายที่เคยเชื่อมไว้',
      }
    }
    const diffs = []
    if (Math.abs(Number(tx.amount || 0) - summary.paidAmount) > 0.005) diffs.push('ยอดที่เราจ่าย')
    if (Math.abs(Number((tx.ledgerAmount ?? tx.amount) || 0) - summary.shareAmount) > 0.005) diffs.push('ส่วนของเรา')
    if (String(tx.date || '') !== String(bill.date || '')) diffs.push('วันที่')
    const txTitle = String(tx.merchant || '').trim()
    const billTitleText = String(bill.title || '').trim()
    if (billTitleText && txTitle && txTitle !== billTitleText) diffs.push('ชื่อรายการ')
    return {
      status: diffs.length ? 'mismatch' : 'linked',
      billId: bill.id,
      billTitle,
      linkedTxId,
      tx,
      expected: summary,
      diffFields: diffs,
      message: diffs.length ? `ข้อมูลยังไม่ตรงกัน: ${diffs.join(', ')}` : 'เชื่อมกับรายการจ่ายแล้ว',
    }
  }

  function defaultExpenseCategoryId() {
    const cats = (S?.categories?.expense || []).filter(c => !c.archived)
    return cats.find(c => /อาหาร|กิน|food|restaurant/i.test(`${c.id} ${c.label}`))?.id || cats[0]?.id || ''
  }

  function defaultWalletId() {
    return (S?.wallets || []).find(w => w.type !== 'credit' && !w.archived)?.id
      || (S?.wallets || []).find(w => !w.archived)?.id
      || ''
  }

  App.getSplitBillLinkState = function (billId) {
    return splitBillLinkState(SbStore.getBill(billId))
  }

  App.getSplitBillLinkStateByTxId = function (txId) {
    const tx = findTx(txId)
    if (!tx?.splitBillId) return null
    const bill = SbStore.getBill(tx.splitBillId)
    if (!bill) {
      return {
        status: 'missing_bill',
        billId: tx.splitBillId,
        billTitle: tx.merchant || 'บิลร่วม',
        linkedTxId: tx.id,
        tx,
        expected: {
          ownerId: tx.splitBillOwnerPersonId || '',
          ownerName: '',
          paidAmount: r2(Number(tx.amount || 0)),
          shareAmount: r2(Number(tx.ledgerAmount || 0)),
          reimbursableAmount: r2(Math.max(0, Number(tx.amount || 0) - Number(tx.ledgerAmount || 0))),
        },
        message: 'ไม่พบบิลหารที่เคยเชื่อมไว้',
      }
    }
    const state = splitBillLinkState(bill)
    if (state.linkedTxId && state.linkedTxId !== tx.id) {
      return {
        ...state,
        status: 'mismatch',
        tx,
        message: 'บิลนี้กำลังเชื่อมกับรายการจ่ายอื่นอยู่',
      }
    }
    return { ...state, tx }
  }

  App.linkSplitBillToTransaction = function (billId, txId) {
    const bill = SbStore.getBill(billId)
    if (!bill) return false
    bill.linkedTransactionId = txId
    bill.updatedAt = nowISO()
    return SbStore.upsertBill(bill)
  }

  App.openSplitBillLinkedTxForm = function (billId) {
    const bill = SbStore.getBill(billId)
    const state = splitBillLinkState(bill)
    if (!bill) return notify('ไม่พบบิล', 'error')
    if (state.status === 'needs_owner' || state.status === 'needs_payment') {
      notify(state.message, 'info')
      return App.openSplitBillForm(billId)
    }
    const tx = state.linkedTxId ? findTx(state.linkedTxId) : null
    const expected = state.expected
    const date = bill.date || todayStr()
    S.txMode = tx ? 'edit' : 'add'
    S.editingTxId = tx?.id || null
    S.tx = {
      step: 'detail',
      type: 'expense',
      amount: String(expected.paidAmount || 0),
      calcOp: '',
      calcLeft: '',
      walletId: tx?.walletId || defaultWalletId(),
      toWalletId: '',
      categoryId: tx?.categoryId || defaultExpenseCategoryId(),
      merchant: bill.title || tx?.merchant || '',
      channel: tx?.channel || '',
      note: tx?.note || '',
      date,
      isRecurring: false,
      isInstallment: false,
      installmentMonths: '',
      sharedExpense: { enabled:false, peopleCount:2, myShare:0, reimbursableAmount:0, status:'pending' },
      splitBillId: bill.id,
      splitBillOwnerPersonId: expected.ownerId || '',
      splitBillOwnerShare: expected.shareAmount || 0,
      splitBillOwnerPaidAmount: expected.paidAmount || 0,
      rewardRuleIds: Array.isArray(tx?.rewardRuleIds) ? [...new Set(tx.rewardRuleIds.filter(Boolean))] : [],
      txSuggestedFields: {},
      rewardEstimate: tx?.rewardEstimate || null,
      rewardIncludePoints: tx?.rewardIncludePoints !== false,
      rewardIncludeCashback: tx?.rewardIncludeCashback !== false,
      recurrenceType: 'monthly',
      everyDays: 30,
      durationMonths: '',
      recurringDayOfMonth: parseInt(String(date).slice(-2), 10) || 1,
    }
    App._renderAddTxDetail?.()
    App.openOverlay?.('overlay-add-tx')
  }

  App.openSplitBillLinkedTransaction = function (billId) {
    const state = splitBillLinkState(SbStore.getBill(billId))
    if (!state.linkedTxId) return App.openSplitBillLinkedTxForm(billId)
    if (state.status === 'mismatch' || state.status === 'orphaned') return App.openSplitBillLinkedTxForm(billId)
    App.openTxDetail?.(state.linkedTxId)
  }

  App._fmtNum = function (el) {
    if (!el) return
    const raw    = el.value.replace(/[^0-9.]/g, '')
    const dot    = raw.indexOf('.')
    const intPart = dot >= 0 ? raw.slice(0, dot) : raw
    const decPart = dot >= 0 ? raw.slice(dot)    : ''
    const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + decPart
    const pos = el.selectionStart
    const diff = formatted.length - el.value.length
    el.value = formatted
    try { el.setSelectionRange(pos + diff, pos + diff) } catch (_) {}
  }

  // ── Wizard state ─────────────────────────────────────────────
  const DRAFT_KEY = 'mt_split_bill_draft'
  let _draft = null
  let _step  = 1
  let _editingItemIdx = -1

  function _saveDraft()  { if (_draft) try { const draft = { ..._draft, _step }; localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); if (typeof S !== 'undefined') S.splitBillDraft = draft } catch (_) {} }
  function _clearDraft() { try { localStorage.removeItem(DRAFT_KEY); if (typeof S !== 'undefined') S.splitBillDraft = null } catch (_) {} }
  function _loadDraft()  { try { const r = localStorage.getItem(DRAFT_KEY); return r ? JSON.parse(r) : null } catch (_) { return null } }

  const STEP_TITLES = ['','ข้อมูลบิล & คน','รายการอาหาร','ส่วนลด / ค่าบริการอื่น','ระบุคนจ่าย','สรุป']
  const noAnim = { animate: false }

  function stepBar() {
    return `<div class="ccbr-steps">
      ${[1,2,3,4,5].map(n=>`<div class="ccbr-step-dot${n===_step?' active':n<_step?' done':''}"></div>`).join('')}
    </div>`
  }

  function stepHeader(backFn) {
    return `<div class="sub-header">
      <button class="btn-icon" onclick="${backFn}">←</button>
      <h2 style="flex:1">${esc(STEP_TITLES[_step])}</h2>
      <span style="font-size:12px;color:var(--muted)">${_step}/5</span>
    </div>${stepBar()}`
  }

  function navRow(nextLabel, nextFn, backFn) {
    return `<div style="display:flex;gap:8px;padding:16px 0 0">
      ${backFn ? `<button class="btn btn-secondary" onclick="${backFn}" style="width:auto;padding:0 20px">←</button>` : ''}
      <button class="btn btn-primary" onclick="${nextFn}" style="flex:1">${nextLabel}</button>
    </div>`
  }

  function pName(id) {
    const p = SbStore.getPerson(id)
    return p ? `${p.emoji||'👤'} ${p.name}` : '?'
  }

  function _lineText(bill, result) {
    const div = '──────────────'
    const transferLines = result.transfers.length
      ? result.transfers.map(t => `• ${t.fromName} โอนให้ ${t.toName} ${fmt(t.amount)}`).join('\n')
      : 'ทุกคนไม่ติดค้างแล้ว 🎉'
    const shareLines = result.personResults.map(p => `• ${p.name}: ${fmt(p.finalShare)}`).join('\n')
    return [
      `🍽️ ${bill.title||'หารบิล'}  ${thaiDate(bill.date)}`,
      div,
      '💸 สรุปการโอน',
      transferLines,
      div,
      '💰 ยอดจ่ายต่อคน',
      shareLines,
      div,
      `ยอดรวม ${fmt(result.finalTotal)}`,
    ].join('\n')
  }

  function _fallbackCopy(elId) {
    const el = document.getElementById(elId)
    if (!el) return
    const prev = el.style.cssText
    el.style.cssText = 'position:static;opacity:1;left:auto'
    el.select()
    try { document.execCommand('copy'); notify('คัดลอกแล้ว', 'success') } catch(_) { notify('กรุณา copy เอง', 'info') }
    el.style.cssText = prev
  }

  function _clipCopy(text, elId) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => notify('คัดลอกแล้ว', 'success'))
        .catch(() => _fallbackCopy(elId))
    } else {
      _fallbackCopy(elId)
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  HOME / HISTORY
  // ══════════════════════════════════════════════════════════════
  App.openSplitBillScreen = function () {
    const bills = SbStore.loadBills()

    const cards = bills.map(b => {
      const sub   = itemSubtotal(b)
      const total = b.manualTotal > 0 ? b.manualTotal : runPipeline(sub, b.pipeline, b.rounding).finalTotal
      const n     = (b.peopleIds||[]).length
      return `<div class="card card-pad sb-bill-row" onclick="App.openSplitBillDetail('${esc(b.id)}')">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.title||'ไม่มีชื่อ')}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">${thaiDate(b.date)} · ${n} คน</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-weight:800;color:var(--primary)">${fmt(total)}</div>
          </div>
        </div>
      </div>`
    }).join('')

    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.closeSubScreen()">←</button>
        <h2 style="flex:1">หารบิล</h2>
        <button class="btn btn-secondary btn-sm" onclick="App.openSplitPeopleScreen()" style="width:auto">สมาชิก</button>
        <button class="btn btn-primary btn-sm" onclick="App.openSplitBillForm()" style="width:auto;margin-left:6px">+ เพิ่มบิล</button>
      </div>
      <div class="sub-scroll" style="padding:12px 16px 40px">
        ${bills.length
          ? `<div style="display:flex;flex-direction:column;gap:8px">${cards}</div>`
          : `<div style="text-align:center;padding:48px 0;color:var(--muted)">
              <div style="font-size:40px">🍽️</div>
              <div style="font-weight:700;margin-top:8px">ยังไม่มีบิล</div>
              <div style="font-size:13px;margin-top:4px">แตะ + บิล เพื่อเริ่ม</div>
            </div>`}
      </div>`)
  }

  // ══════════════════════════════════════════════════════════════
  //  BILL DETAIL
  // ══════════════════════════════════════════════════════════════
  App.openSplitBillDetail = function (billId) {
    const bill = SbStore.getBill(billId)
    if (!bill) return notify('ไม่พบบิล', 'error')
    const result = calcResult(bill)
    const linkState = splitBillLinkState(bill)
    const ownerSummary = linkState.expected || splitBillOwnerSummary(bill)

    const personRows = result.personResults.map(p => `
      <div class="detail-row">
        <div style="flex:1">
          <div style="font-weight:600">${esc(p.name)}</div>
          <div style="font-size:12px;color:var(--muted)">ยอดจ่าย ${fmt(p.finalShare)} · จ่ายไปแล้ว ${fmt(p.paid)}</div>
        </div>
        <div style="text-align:right;font-weight:700;color:${p.net>0?'var(--income)':p.net<0?'var(--expense)':'var(--muted)'}">
          ${p.net>0?`ได้คืน ${fmt(p.net)}`:p.net<0?`ต้องจ่าย ${fmt(-p.net)}`:'ไม่ติดค้าง'}
        </div>
      </div>`).join('')

    const transferRows = result.transfers.length
      ? result.transfers.map(t=>`
          <div class="detail-row">
            <div style="display:flex;align-items:center;gap:6px;font-weight:600">
              <span>${esc(t.fromName)}</span>
              <span style="color:var(--primary);font-size:18px;line-height:1">→</span>
              <span>${esc(t.toName)}</span>
            </div>
            <div style="font-weight:800;color:var(--primary)">${fmt(t.amount)}</div>
          </div>`).join('')
      : `<div style="color:var(--muted);font-size:13px;padding:8px 0">ทุกคนไม่ติดค้างแล้ว 🎉</div>`

    const warnHtml = result.warnings.map(w =>
      `<div style="background:var(--elevated);border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:13px;color:var(--expense)">⚠️ ${esc(w)}</div>`
    ).join('')
    const linkTone = linkState.status === 'linked'
      ? { bg: 'rgba(34,197,94,.10)', color: 'var(--success,#22c55e)' }
      : linkState.status === 'mismatch'
        ? { bg: 'rgba(245,158,11,.10)', color: 'var(--warning,#f59e0b)' }
        : linkState.status === 'needs_owner' || linkState.status === 'needs_payment'
          ? { bg: 'rgba(100,116,139,.10)', color: 'var(--muted)' }
          : { bg: 'rgba(239,68,68,.08)', color: 'var(--expense)' }
    const linkCard = `
      <div class="card card-pad" style="margin-bottom:12px;background:${linkTone.bg};border:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
          <div>
            <div style="font-size:12px;color:var(--muted)">รายการจ่ายที่เชื่อม</div>
            <div style="font-weight:700;color:${linkTone.color};margin-top:4px">${esc(linkState.message)}</div>
            ${ownerSummary.ownerName ? `<div style="font-size:12px;color:var(--muted);margin-top:6px">เรา: ${esc(ownerSummary.ownerName)} · จ่าย ${fmt(ownerSummary.paidAmount)} · ส่วนเรา ${fmt(ownerSummary.shareAmount)}</div>` : ''}
          </div>
          ${ownerSummary.reimbursableAmount > 0 ? `<div style="text-align:right;flex-shrink:0"><div style="font-size:12px;color:var(--muted)">เพื่อนค้างเรา</div><div style="font-weight:800;color:var(--income)">${fmt(ownerSummary.reimbursableAmount)}</div></div>` : ''}
        </div>
      </div>`
    const linkButtons = linkState.status === 'linked'
      ? `<button class="btn btn-primary flex-1" onclick="App.openSplitBillLinkedTransaction('${esc(billId)}')">เปิดรายการจ่าย</button>`
      : `<button class="btn btn-primary flex-1" onclick="App.openSplitBillLinkedTxForm('${esc(billId)}')">${linkState.status === 'mismatch' ? 'อัปเดตรายการจ่าย' : 'สร้างรายการจ่าย'}</button>`

    const copyText = _lineText(bill, result)

    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openSplitBillScreen()">←</button>
        <h2 style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(bill.title||'ไม่มีชื่อ')}</h2>
        <button class="btn btn-secondary btn-sm" onclick="App.openSplitBillForm('${esc(billId)}')" style="width:auto">✏️ แก้ไข</button>
      </div>
      <div class="sub-scroll" style="padding:12px 16px 40px">
        <div style="font-size:13px;color:var(--muted);margin-bottom:10px">📅 ${thaiDate(bill.date)}</div>

        <div class="card" style="padding:14px;margin-bottom:12px;text-align:center">
          <div style="font-size:12px;color:var(--muted)">ยอดสุดท้าย</div>
          <div style="font-size:28px;font-weight:800;color:var(--primary)">${fmt(result.finalTotal)}</div>
          ${bill.manualTotal&&Math.abs(r2(bill.manualTotal-result.finalTotal))>0.5
            ?`<div style="font-size:12px;color:var(--muted)">ยอดบิล: ${fmt(bill.manualTotal)}</div>`:''}
        </div>

        ${warnHtml}
        ${linkCard}

        <div class="sec-title">สรุปต่อคน</div>
        <div class="card card-pad" style="padding: 0px 10px;">${personRows||'<div style="color:var(--muted)">ยังไม่มีคน</div>'}</div>

        <div class="sec-title">โอนเงิน</div>
        <div class="card card-pad" style="padding: 0px 10px;">${transferRows}</div>

        <textarea id="sb-detail-copy" style="position:absolute;left:-9999px;top:0;opacity:0;width:1px;height:1px">${esc(copyText)}</textarea>

        <div style="display:flex;gap:8px;margin-top:16px">
          ${linkButtons}
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-secondary flex-1" onclick="App.openSplitBillForm('${esc(billId)}')">✏️ แก้ไข</button>
          <button class="btn btn-secondary flex-1" onclick="App._sbCopy('${esc(billId)}')">⧉ ทำซ้ำ</button>
          <button class="btn btn-secondary flex-1" onclick="App._sbDetailCopyLine()">📋 ข้อความ</button>
        </div>
        <div style="height:1px;background:var(--border);margin:12px 0"></div>
        <button class="btn btn-outline" onclick="App._sbDelete('${esc(billId)}')" style="width:100%;color:var(--expense);border-color:var(--expense)">🗑 ลบบิล</button>
      </div>`)
  }

  App._sbDetailCopyLine = function () {
    const el = document.getElementById('sb-detail-copy')
    if (el) _clipCopy(el.value, 'sb-detail-copy')
  }

  App._sbCopy = function (billId) {
    const bill = SbStore.getBill(billId); if (!bill) return
    const copy = { ...JSON.parse(JSON.stringify(bill)), id: genId(), linkedTransactionId: '', title: (bill.title||'บิล') + ' (สำเนา)', date: todayStr(), payments: {}, createdAt: nowISO(), updatedAt: nowISO() }
    SbStore.upsertBill(copy)
    notify('ทำสำเนาบิลแล้ว', 'success')
    App.openSplitBillDetail(copy.id)
  }

  App._sbDelete = function (billId) {
    const bill = SbStore.getBill(billId); if (!bill) return
    const go = () => { SbStore.deleteBill(billId); notify('ลบบิลแล้ว', 'success'); App.openSplitBillScreen() }
    if (App.showConfirm) App.showConfirm({ title:'ลบบิล', danger:true, confirmLabel:'ลบ', body:`ลบ "${bill.title||'บิล'}"?`, onConfirm: go })
    else if (confirm(`ลบ "${bill.title||'บิล'}"?`)) go()
  }

  // ══════════════════════════════════════════════════════════════
  //  WIZARD ENTRY
  // ══════════════════════════════════════════════════════════════
  App.openSplitBillForm = function (billId = '', opts = {}) {
    const existing = billId ? SbStore.getBill(billId) : null
    if (existing) {
      _draft = newDraft(JSON.parse(JSON.stringify(existing)))
      _step  = 1
    } else if (opts?.draftData) {
      _draft = newDraft(opts.draftData)
      _step  = 1
    } else {
      const saved = _loadDraft()
      if (saved) {
        const { _step: savedStep, ...draftData } = saved
        _draft = newDraft(draftData)
        _step  = Number(savedStep) || 1
      } else {
        _draft = newDraft({})
        _step  = 1
      }
    }
    _editingItemIdx = -1
    _sbRender()
  }

  let _sbPrevStep = 1

  function _sbRender(opts) {
    const animate = !opts || opts.animate !== false
    const dir = _step >= _sbPrevStep ? 'next' : 'prev'
    _sbPrevStep = _step

    switch (_step) {
      case 1: _sbStep1(noAnim); break
      case 2: _sbStep3(noAnim); break
      case 3: _sbStep4(noAnim); break
      case 4: _sbStep5(noAnim); break
      case 5: _sbStep6(noAnim); break
    }

    if (animate) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const scroll = document.querySelector('#sub-screen .sub-scroll')
        if (!scroll) return
        const cls = dir === 'prev' ? 'ccbr-panel-prev' : 'ccbr-panel-next'
        scroll.classList.add(cls)
        setTimeout(() => scroll.classList.remove('ccbr-panel-prev', 'ccbr-panel-next'), 1000)
      }))
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  STEP 1 — ข้อมูลบิล + คน (merged)
  // ══════════════════════════════════════════════════════════════
  function _sbStep1(opts) {
    const people   = SbStore.loadPeople().filter(p => !p.archived)
    const selected = _draft.peopleIds
    const ownerOptions = selected.map(id => {
      const person = SbStore.getPerson(id)
      if (!person) return ''
      return `<option value="${esc(id)}"${_draft.ownerPersonId === id ? ' selected' : ''}>${esc(person.name)}</option>`
    }).join('')

    const chips = people.map(p => {
      const on = selected.includes(p.id)
      return `<button class="chip sb-person-chip${on?' active':''}" onclick="App._sbTogglePerson('${esc(p.id)}')" style="min-width:60px">
        ${esc(p.emoji||'👤')} ${esc(p.name)}
      </button>`
    }).join('')

    App.openSubScreen(`
      ${stepHeader('App.openSplitBillScreen()')}
      <div class="sub-scroll" style="padding:16px 16px 40px">
        <div class="form-group">
          <label class="form-label">ชื่อบิล</label>
          <input class="form-input" id="sb1-title" value="${esc(_draft.title)}" placeholder="เช่น ข้าวเย็นวันศุกร์">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:4px">
          <div class="form-group">
            <label class="form-label">วันที่</label>
            <input class="form-input" type="date" id="sb1-date" value="${esc(_draft.date)}">
          </div>
          <div class="form-group">
            <label class="form-label">ยอดบิล (฿)</label>
            <input class="form-input" type="text" inputmode="decimal" id="sb1-total" value="${_draft.manualTotal||''}" placeholder="ไม่ระบุ" oninput="App._fmtNum(this)">
          </div>
        </div>
        <div class="mt-divider" style="border-bottom:1px solid var(--border)"></div>
        <div style="display:flex;align-items:center;margin-top:4px;margin-bottom:8px">
          <span class="sec-title" style="font-size: 18px !important;color:var(--primary);margin: 0 !important;flex:1">สมาชิกในบิลนี้</span>
          <div style="display:flex;gap:6px">
            <button onclick="App._sbSelectAllPeople()" style="font-size:11px !important;color:var(--muted);background:transparent;border:1px solid var(--border);border-radius:8px;padding:2px 8px">เลือกทั้งหมด</button>
            <button onclick="App._sbClearAllPeople()" style="font-size:11px !important;color:var(--muted);background:transparent;border:1px solid var(--border);border-radius:8px;padding:2px 8px">ล้าง</button>
          </div>
        </div>
        ${chips ? `<div class="chips" style="flex-wrap:wrap;gap:8px;padding:0 0 12px">${chips}</div>` : ''}
        <div style="display:flex;gap:8px;margin-bottom:4px">
          <input class="form-input" id="sb2-newname" placeholder="พิมพ์ชื่อสมาชิกแล้วกด +"
            style="flex:1" onkeydown="if(event.key==='Enter')App._sbQuickAdd()">
          <button class="btn btn-secondary" onclick="App._sbQuickAdd()"
            style="width:80px;padding:0 18px;font-size:20px;line-height:1">+ เพิ่ม</button>
        </div>
        <div class="form-group">
          <label class="form-label">คนที่เป็นเรา <span style="color:var(--muted);font-weight:400">(ไว้ใช้เชื่อมรายการจ่าย)</span></label>
          <select class="form-input" id="sb1-owner">
            <option value="">ยังไม่ระบุ</option>
            ${ownerOptions}
          </select>
        </div>

        ${navRow(`ถัดไป: รายการอาหาร → (${selected.length} คน)`, 'App._sbNext1()')}
      </div>`, opts)
  }

  App._sbNext1 = function () {
    _draft.title       = document.getElementById('sb1-title')?.value.trim() || 'บิลใหม่'
    _draft.date        = document.getElementById('sb1-date')?.value || todayStr()
    _draft.manualTotal = numVal(document.getElementById('sb1-total'))
    _draft.ownerPersonId = document.getElementById('sb1-owner')?.value || ''
    const _sbTErr = (window._fieldTooLong || function(){})(  _draft.title, (window.FIELD_MAX || {}).title || 100, 'ชื่อบิล')
    if (_sbTErr) return notify(_sbTErr, 'error')
    if (!_draft.peopleIds.length) return notify('เลือกอย่างน้อย 1 คน', 'error')
    if (_draft.ownerPersonId && !_draft.peopleIds.includes(_draft.ownerPersonId)) _draft.ownerPersonId = ''
    ;(_draft.items||[]).forEach(item => {
      if (!item.participants?.length) {
        item.participants = _draft.peopleIds.map(id => ({ personId: id, ratio: 1 }))
      }
    })
    _step = 2; _saveDraft(); _sbRender()
  }

  App._sbTogglePerson = function (id) {
    const i = _draft.peopleIds.indexOf(id)
    if (i >= 0) {
      _draft.peopleIds.splice(i, 1)
      if (_draft.ownerPersonId === id) _draft.ownerPersonId = ''
      ;(_draft.items||[]).forEach(item => {
        item.participants = (item.participants||[]).filter(p => p.personId !== id)
      })
    } else {
      _draft.peopleIds.push(id)
    }
    _sbStep1(noAnim)
  }

  App._sbSelectAllPeople = function () {
    const people = SbStore.loadPeople().filter(p => !p.archived)
    people.forEach(p => { if (!_draft.peopleIds.includes(p.id)) _draft.peopleIds.push(p.id) })
    _sbStep1(noAnim)
  }

  App._sbClearAllPeople = function () {
    _draft.peopleIds = []
    _draft.ownerPersonId = ''
    _sbStep1(noAnim)
  }

  App._sbQuickAdd = function () {
    const input = document.getElementById('sb2-newname')
    const name  = input?.value.trim()
    if (!name) return
    const person = { id: genId(), name, emoji: '👤', color: '#2563EB', note: '', archived: false, createdAt: nowISO(), updatedAt: nowISO() }
    SbStore.upsertPerson(person)
    _draft.peopleIds.push(person.id)
    _sbStep1(noAnim)
  }

  // ══════════════════════════════════════════════════════════════
  //  STEP 3 — รายการอาหาร (inline form, no sub-screen)
  // ══════════════════════════════════════════════════════════════
  function _sbItemFormHtml(item) {
    const personChips = _draft.peopleIds.map(id => {
      const ip     = (item.participants||[]).find(p=>p.personId===id)
      const on     = !!ip
      const person = SbStore.getPerson(id)
      const label  = person ? person.name : '?'
      return `<button class="chip${on?' active':''}" onclick="App._sbItemTogglePerson('${esc(id)}')"
        style="${on?'background:var(--primary);color:#fff;border-color:var(--primary);min-width:60px!important;':'min-width:60px!important'}">
        ${esc(label)}
      </button>`
    }).join('')

    let ratioInputs = ''
    if (item.splitMode === 'ratio') {
  const activeParts = (item.participants || []).filter(p => _draft.peopleIds.includes(p.personId))
  ratioInputs = `<div style="padding-top:8px; display:flex; gap:16px; flex-wrap:wrap; padding-bottom:8px;">
    ${activeParts.map(p => `
      <div style="display:flex; flex-direction:column; align-items:center; gap:6px; min-width:70px;">
        <span style="font-size:13px; text-align:center; white-space:nowrap;">${esc(pName(p.personId))}</span>
        <input class="form-input" type="number" inputmode="decimal" id="sbi-ratio-${esc(p.personId)}" value="${p.ratio||1}" style="width:70px;text-align:center;padding: 0px !important;min-height: 36px !important;">
        <span style="color:var(--muted); font-size:13px;">ส่วน</span>
      </div>
    `).join('')}
  </div>`
}

    const discEnabled = item.discount?.enabled
    const discMode    = item.discount?.mode || 'percent'
    const discVal     = item.discount?.value || ''
    // For legacy items with qty/pricePerUnit, compute display price
    const displayPrice = item.price != null ? (item.price || '') : ((Number(item.qty)||1) * (Number(item.pricePerUnit)||0) || '')

    return `<div class="card" style="padding:14px;border:2px solid var(--primary)">
      <input class="form-input" id="sbi-name" value="${esc(item.name)}" placeholder="ชื่อรายการ เช่น ผัดไทย" style="margin-bottom:8px;font-weight:600">
      <div style="display:grid;grid-template-columns:68% 32%;gap:4px;padding: 8px 0px;">
      <div>
        <span style="color:var(--muted);font-size:13px;white-space:nowrap">ราคา ฿</span>
      </div>
      <div></div>
      <input class="form-input" type="text" inputmode="decimal" id="sbi-price" value="${displayPrice}" placeholder="0" oninput="App._fmtNum(this)" style="flex:1">
      <div style="display:flex;align-items:center;gap:8px;margin:0px 0px 4px 10px">
        <button class="toggle${discEnabled?' on':''}" onclick="App._sbItemToggleDiscount()" aria-label="ส่วนลด"></button>
        <span style="font-size:13px;color:var(--muted)">ส่วนลด</span>
      </div>
      </div>
      ${discEnabled ? `
      <div style="display:flex;gap:6px;margin-bottom:8px;margin-top:4px">
        <select class="form-input" id="sbi-disc-mode" style="flex:0 0 auto;width:45%">
          <option value="percent" ${discMode==='percent'?'selected':''}>ลด % เปอร์เซ็นต์</option>
          <option value="fixed"   ${discMode==='fixed'  ?'selected':''}>ลด ฿ จำนวนเงิน</option>
        </select>
        <input class="form-input" type="text" inputmode="decimal" id="sbi-disc-val" value="${discVal}" placeholder="0" oninput="App._fmtNum(this)" style="flex:1;text-align:right">
      </div>` : ''}

      <div style="margin-bottom:8px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">วิธีหาร</div>
        <div class="chips" style="padding:0">
          <button class="chip${item.splitMode!=='ratio'?' active':''}" onclick="App._sbItemSetMode('equal')" style="min-width: 70px !important;">เท่ากัน</button>
          <button class="chip${item.splitMode==='ratio'?' active':''}" onclick="App._sbItemSetMode('ratio')" style="min-width: 70px !important;">สัดส่วน</button>
        </div>
      </div>

      <div style="margin-bottom:10px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">เลือกคนที่กินรายการนี้</div>
        <div class="chips" style="flex-wrap:wrap;gap:6px;padding:0">${personChips}</div>
      </div>

      ${ratioInputs}

      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-secondary" onclick="App._sbItemCancel()" style="flex:1">ยกเลิก</button>
        <button class="btn btn-primary" onclick="App._sbItemSave()" style="flex:1">ตกลง</button>
      </div>
    </div>`
  }

  function _sbStep3(opts) {
    const items = _draft.items || []
    const sub   = itemSubtotal(_draft)

    const rows = items.map((item, i) => {
      if (i === _editingItemIdx) return _sbItemFormHtml(item)

      const price    = itemEffectivePrice(item)
      const discHtml = item.discount?.enabled
        ? `<span style="color:var(--income);font-size:11px;margin-left:4px">-${item.discount.mode==='percent'?item.discount.value+'%':fmt(item.discount.value)}</span>`
        : ''
      const who = (item.participants||[]).map(p => {
        const person = SbStore.getPerson(p.personId)
        return person ? (person.emoji||'👤') : '?'
      }).join('')

      return `<div class="card card-pad sb-item-row" onclick="App._sbEditItem(${i})">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.name||'รายการที่'+(i+1))}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">
              ${item.splitMode==='ratio'?'สัดส่วน · ':''}${who||'ไม่มีคน'}${discHtml}
            </div>
          </div>
          <div style="font-weight:700;color:var(--primary);flex-shrink:0">${fmt(price)}</div>
          <button class="btn-icon" onclick="event.stopPropagation();App._sbDeleteItem(${i})" style="color:var(--muted)">✕</button>
        </div>
      </div>`
    }).join('')

    const editing = _editingItemIdx !== -1

    App.openSubScreen(`
      ${stepHeader('App._sbBack()')}
      <div class="sub-scroll" style="padding:16px 16px 40px">
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px">${rows}</div>
        ${!editing ? `<button class="btn btn-secondary" onclick="App._sbAddItem()" style="margin-bottom:16px">+ เพิ่มรายการ</button>` : ''}
        ${items.length && !editing ? `<div class="card" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;border-color: var(--primary) !important;">
          <span style="font-size:16px!important;color:var(--muted)">ยอดรายการรวม</span>
          <span style="font-size:18px!important;font-weight:800;color:var(--primary)">${fmt(sub)}</span>
        </div>` : ''}
        ${!editing ? navRow('ถัดไป: ส่วนลด / ค่าบริการอื่น →', 'App._sbNext3()', 'App._sbBack()') : ''}
      </div>`, opts)

    if (editing) {
      setTimeout(() => document.getElementById('sbi-name')?.focus(), 80)
    }
  }

  App._sbAddItem = function () {
    if (!_draft.items) _draft.items = []
    _draft.items.push({
      id: genId(), name: '', price: 0,
      discount: { enabled: false, mode: 'percent', value: 0 },
      splitMode: 'equal',
      participants: _draft.peopleIds.map(id => ({ personId: id, ratio: 1 })),
    })
    _editingItemIdx = _draft.items.length - 1
    _sbStep3(noAnim)
  }

  App._sbEditItem = function (i) {
    if (_editingItemIdx !== -1) _sbItemSaveFields()
    _editingItemIdx = i
    _sbStep3(noAnim)
  }

  App._sbDeleteItem = function (i) {
    if (_editingItemIdx === i)       _editingItemIdx = -1
    else if (_editingItemIdx > i)    _editingItemIdx--
    _draft.items.splice(i, 1)
    _sbStep3(noAnim)
  }

  App._sbNext3 = function () { _step = 3; _saveDraft(); _sbRender() }

  function _sbItemSaveFields() {
    const item = _draft.items[_editingItemIdx]
    if (!item) return
    item.name  = document.getElementById('sbi-name')?.value.trim() || ''
    item.price = numVal(document.getElementById('sbi-price'))
    // Clear legacy fields if present
    delete item.qty; delete item.pricePerUnit
    if (!item.discount) item.discount = { enabled: false, mode: 'percent', value: 0 }
    const discModeEl = document.getElementById('sbi-disc-mode')
    const discValEl  = document.getElementById('sbi-disc-val')
    if (discModeEl) item.discount.mode  = discModeEl.value
    if (discValEl)  item.discount.value = numVal(discValEl)
    if (item.splitMode === 'ratio') {
      ;(item.participants||[]).forEach(p => {
        const el = document.getElementById(`sbi-ratio-${p.personId}`)
        if (el) p.ratio = Number(el.value) || 1
      })
    }
  }

  App._sbItemTogglePerson = function (personId) {
    _sbItemSaveFields()
    const item = _draft.items[_editingItemIdx]; if (!item) return
    const i = (item.participants||[]).findIndex(p => p.personId === personId)
    if (i >= 0) item.participants.splice(i, 1)
    else (item.participants = item.participants||[]).push({ personId, ratio: 1 })
    _sbStep3(noAnim)
  }

  App._sbItemSetMode = function (mode) {
    _sbItemSaveFields()
    const item = _draft.items[_editingItemIdx]; if (!item) return
    item.splitMode = mode
    _sbStep3(noAnim)
  }

  App._sbItemToggleDiscount = function () {
    _sbItemSaveFields()
    const item = _draft.items[_editingItemIdx]; if (!item) return
    if (!item.discount) item.discount = { enabled: false, mode: 'percent', value: 0 }
    item.discount.enabled = !item.discount.enabled
    _sbStep3(noAnim)
  }

  App._sbItemSave = function () {
    _sbItemSaveFields()
    const item = _draft.items[_editingItemIdx]
    if (item && !item.name && !item.price) _draft.items.splice(_editingItemIdx, 1)
    _editingItemIdx = -1
    _sbStep3(noAnim)
  }

  App._sbItemCancel = function () {
    // Check draft (not DOM) — new items have name='' and price=0
    const item = _draft.items[_editingItemIdx]
    if (item && !item.name && !item.price) _draft.items.splice(_editingItemIdx, 1)
    _editingItemIdx = -1
    _sbStep3(noAnim)
  }

  // ══════════════════════════════════════════════════════════════
  //  STEP 4 — ส่วนลด / ค่าบริการอื่น SC / VAT + rounding
  // ══════════════════════════════════════════════════════════════
  function _sbBuildPreviewRows() {
    const sub = itemSubtotal(_draft)
    const { finalTotal, steps, roundingDelta } = runPipeline(sub, _draft.pipeline, _draft.rounding)
    const lines = []
    lines.push(`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
        <span>ยอดอาหาร</span><span>${fmt(sub)}</span>
      </div>`)
    steps.slice(1).forEach(s => {
      const sign  = s.delta < 0 ? '−' : '+'
      const color = s.delta < 0 ? 'var(--income)' : 'var(--expense)'
      const note  = s.base === 'food' ? `<span style="font-size:11px;margin-left:4px">(จากยอดอาหาร)</span>` : ''
      lines.push(`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
        <span style="color:var(--muted)">${esc(s.label)}${note}</span>
        <span style="color:${color}">${sign} ${fmt(Math.abs(s.delta))}</span>
      </div>`)
    })
    if (_draft.rounding.mode !== 'off' && roundingDelta !== 0) {
      const sign  = roundingDelta < 0 ? '−' : '+'
      const color = roundingDelta < 0 ? 'var(--income)' : 'var(--expense)'
      lines.push(`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
        <span style="color:var(--muted)">ปัดเศษ</span>
        <span style="color:${color}">${sign} ${fmt(Math.abs(roundingDelta))}</span>
      </div>`)
    }
    lines.push(`<div style="display:flex;justify-content:space-between;padding:10px 0 2px;font-size:16px;font-weight:800;border-top:1px solid var(--border);margin-top:8px;color:var(--primary)">
        <span>ยอดรวม</span><span>${fmt(finalTotal)}</span>
      </div>`)
    return lines.join('')
  }

  App._sbUpdatePreview = function () {
    const card = document.getElementById('sb-preview-card')
    if (!card) return
    _sbPipeSaveAll()
    const el = document.getElementById('rounding-custom')
    if (el) {
      const sign = _draft.rounding.amount > 0 ? 1 : -1
      _draft.rounding.amount = sign * (Math.abs(Number(el.value)) / 100 || 0)
    }
    card.innerHTML = _sbBuildPreviewRows()
  }

  function _sbStep4(opts) {
    const sub = itemSubtotal(_draft)
    const pipeline = _draft.pipeline
    const rm = _draft.rounding

    const pillBtn = (label, active, onclick) =>
      `<button onclick="${onclick}" style="border:1px solid ${active?'var(--primary)':'var(--border)'};border-radius:12px;padding:2px 10px;font-size:12px;background:${active?'var(--primary)':'transparent'};color:${active?'#fff':'var(--muted)'};">${label}</button>`

    const pipelineRows = pipeline.map((p, i) => {
      const isFirst   = i === 0
      const isLast    = i === pipeline.length - 1
      const showBasePills = p.enabled && p.mode === 'percent' && p.type !== 'discount'
      return `<div class="card card-pad" style="margin-bottom:6px;opacity:${p.enabled?1:0.5}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${p.enabled?'8':'0'}px">
          <button class="toggle${p.enabled?' on':''}" onclick="App._sbPipeToggle(${i})" aria-label="${esc(p.label)}"></button>
          <span style="font-weight:600;flex:1">${esc(p.label)}</span>
          <div style="display:flex;gap:4px">
            ${!isFirst?`<button class="btn-icon" onclick="App._sbPipeMove(${i},-1)">↑</button>`:'<div style="width:32px"></div>'}
            ${!isLast ?`<button class="btn-icon" onclick="App._sbPipeMove(${i}, 1)">↓</button>`:'<div style="width:32px"></div>'}
          </div>
        </div>
        ${p.enabled ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            <select class="form-input" id="pipe-mode-${i}" onchange="App._sbPipeSave();App._sbUpdatePreview()">
              <option value="percent" ${p.mode==='percent'?'selected':''}>% (เปอร์เซ็นต์)</option>
              <option value="fixed"   ${p.mode==='fixed'?'selected':''}>฿ (จำนวนเงิน)</option>
            </select>
            <input class="form-input" type="text" inputmode="decimal" id="pipe-val-${i}" value="${p.value||''}" oninput="App._fmtNum(this);App._sbPipeSave();App._sbUpdatePreview()">
          </div>
          ${showBasePills ? `
          <div style="display:flex;gap:4px;margin-top:8px">
            ${pillBtn('ยอดสะสม', p.base !== 'food', `App._sbPipeBaseToggle(${i},'running')`)}
            ${pillBtn('ยอดอาหาร', p.base === 'food', `App._sbPipeBaseToggle(${i},'food')`)}
          </div>` : ''}` : ''}
      </div>`
    }).join('')

    App.openSubScreen(`
      ${stepHeader('App._sbBack()')}
      <div class="sub-scroll" style="padding:16px 16px 40px">
        ${sub > 0
          ? `<div id="sb-preview-card" class="card" style="padding:12px 14px;margin-bottom:14px">${_sbBuildPreviewRows()}</div>`
          : `<div style="color:var(--muted);font-size:13px;margin-bottom:14px">ยังไม่มีรายการอาหาร (ยอดจะคำนวณเมื่อเพิ่มรายการแล้ว)</div>`}
        ${pipelineRows}
        <div class="card card-pad" style="margin-top:8px">
          <div style="display:flex;gap:10px;align-items:center;">
            <button class="toggle${rm.mode!=='off'?' on':''}" onclick="App._sbToggleRounding()" aria-label="ปัดเศษ" style="align-self: flex-start"></button>
            <div style="flex:1">
              <div style="font-weight:600">ปัดเศษยอดรวมบิล</div>
              ${rm.mode !== 'off' ? `
              <div style="display:flex;gap:4px;margin-top:6px">
                ${pillBtn('ทุก 25 สต.', rm.mode==='satang25', "App._sbSetRoundingMode('satang25')")}
                ${pillBtn('กำหนดเอง',   rm.mode==='custom',   "App._sbSetRoundingMode('custom')")}
              </div>
              ${rm.mode === 'custom' ? `
              <div style="display:flex;align-items:center;gap:6px;margin-top:6px">
                <button onclick="App._sbToggleRoundingSign()" style="width:28px;height:28px;border-radius:50%;border:1.5px solid var(--primary);background:${rm.amount>0?'transparent':'var(--primary)'};color:${rm.amount>0?'var(--primary)':'#fff'};font-size:16px;font-weight:700;line-height:1;padding:0;flex-shrink:0">${rm.amount>0?'+':'−'}</button>
                <input class="form-input" type="number" inputmode="numeric" id="rounding-custom" value="${Math.round(Math.abs(rm.amount)*100)||''}" placeholder="0" min="0" max="99" step="1" oninput="if(this.value !== '' && this.value > 99) this.value = 99; if(this.value !== '' && this.value < 0) this.value = 0; App._sbUpdatePreview()" style="width:70px;padding:0px 10px !important;min-height:36px !important;">
                <span style="font-size:13px;color:var(--muted)">สตางค์</span>
              </div>` : ''}` : ''}
            </div>
          </div>
        </div>
        ${navRow('ถัดไป: ระบุคนจ่าย →', 'App._sbNext4()', 'App._sbBack()')}
      </div>`, opts)
  }

  App._sbToggleRounding = function () {
    _sbPipeSaveAll()
    _draft.rounding = _draft.rounding.mode !== 'off'
      ? { mode: 'off', amount: 0 }
      : { mode: 'satang25', amount: 0 }
    _sbStep4(noAnim)
  }

  App._sbSetRoundingMode = function (mode) {
    _sbPipeSaveAll()
    _draft.rounding = { mode, amount: _draft.rounding.amount || 0 }
    _sbStep4(noAnim)
  }

  App._sbToggleRoundingSign = function () {
    const el = document.getElementById('rounding-custom')
    const absVal = el ? Math.abs(Number(el.value) || 0) / 100 : Math.abs(_draft.rounding.amount || 0)
    _draft.rounding.amount = _draft.rounding.amount > 0 ? -absVal : absVal
    _sbStep4(noAnim)
  }

  App._sbPipeToggle = function (i) {
    _sbPipeSaveAll()
    _draft.pipeline[i].enabled = !_draft.pipeline[i].enabled
    _sbStep4(noAnim)
  }

  App._sbPipeBaseToggle = function (i, val) {
    _sbPipeSaveAll()
    _draft.pipeline[i].base = val
    _sbStep4(noAnim)
  }

  App._sbPipeMove = function (i, dir) {
    _sbPipeSaveAll()
    const j = i + dir
    if (j < 0 || j >= _draft.pipeline.length) return
    ;[_draft.pipeline[i], _draft.pipeline[j]] = [_draft.pipeline[j], _draft.pipeline[i]]
    _sbStep4(noAnim)
  }

  App._sbPipeSave = function () { _sbPipeSaveAll() }

  function _sbPipeSaveAll() {
    ;(_draft.pipeline||[]).forEach((p, i) => {
      const modeEl = document.getElementById(`pipe-mode-${i}`)
      const valEl  = document.getElementById(`pipe-val-${i}`)
      if (modeEl) p.mode  = modeEl.value
      if (valEl)  p.value = numVal(valEl)
    })
  }

  App._sbNext4 = function () { _sbPipeSaveAll(); _step = 4; _saveDraft(); _sbRender() }

  // ══════════════════════════════════════════════════════════════
  //  STEP 5 — ใครจ่ายไปแล้ว
  // ══════════════════════════════════════════════════════════════
  function _sbStep5(opts) {
    const { finalTotal } = runPipeline(itemSubtotal(_draft), _draft.pipeline, _draft.rounding)

    const { shares } = calcShares(_draft)
    const rows = _draft.peopleIds.map(id => {
      const person  = SbStore.getPerson(id)
      const name    = person ? person.name : '?'
      const share   = r2(shares[id] || 0)
      const paidRaw = _draft.payments[id] || 0
      const paid    = paidRaw ? String(paidRaw).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''
      const hasPaid = paidRaw > 0
      const safeId  = esc(id)
      return `<div class="detail-row" style="align-items:center">
        <div style="flex:4">
          <div style="font-weight:600">${esc(name)}</div>
          <div style="font-size:12px;color:var(--muted)">ยอดจ่าย ${fmt(share)}</div>
        </div>
        <div style="display:flex;flex:5;align-items:center;gap:6px">
          <span style="color:var(--muted)">฿</span>
          <div style="position:relative;display:flex;align-items:center;flex:1">
            <input class="form-input" type="text" inputmode="decimal" id="pay-${safeId}"
              value="${paid||''}" placeholder="0"
              style="width:100%;text-align:right;padding-right:${hasPaid?'28':'10'}px !important"
              oninput="App._fmtNum(this);(function(v,id){var n=parseFloat(v.replace(/,/g,''))||0;var x=document.getElementById('pay-x-'+id);if(x){x.style.display=n>0?'flex':'none'};document.getElementById('pay-'+id).style.setProperty('padding-right',n>0?'28px':'10px','important')})(this.value,'${safeId}');App._sbUpdatePayRemaining()">
            <button id="pay-x-${safeId}" onclick="App._sbPayClear('${safeId}')"
              style="display:${hasPaid?'flex':'none'};position:absolute;right:6px;background:none;border:none;cursor:pointer;color:var(--muted);padding:2px;align-items:center;font-size:13px;line-height:1">✕</button>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="App._sbPayAll('${safeId}')" style="width:auto;padding:0 10px;font-size:12px">ทั้งหมด</button>
        </div>
      </div>`
    }).join('')

    App.openSubScreen(`
      ${stepHeader('App._sbBack()')}
      <div class="sub-scroll" style="padding:16px 16px 40px">
        <div style="font-size:13px;color:var(--muted);margin-bottom:10px">ระบุว่าใครจ่ายเงินไปแล้วบ้าง ถ้าไม่ได้จ่ายเว้นว่างไว้</div>
        <div class="card card-pad">
          ${rows||'<div style="color:var(--muted)">ยังไม่มีคน</div>'}
          <div id="sb-pay-remaining" style="padding-top:8px;margin-top:4px;font-size:14px"></div>
          <div style="padding-top:4px;font-size:16px;color:var(--muted)">ยอดรวมทั้งหมด <span style="font-weight:800;font-size:18px;color:var(--primary)">${fmt(finalTotal)}</span></div>
        </div>
        ${navRow('ถัดไป: สรุป →', 'App._sbNext5()', 'App._sbBack()')}
      </div>`, opts)
    App._sbUpdatePayRemaining()
  }

  App._sbPayAll = function (personId) {
    _sbSavePayments()
    const { finalTotal } = runPipeline(itemSubtotal(_draft), _draft.pipeline, _draft.rounding)
    _draft.payments[personId] = finalTotal
    _sbStep5(noAnim)
  }

  App._sbPayClear = function (personId) {
    _sbSavePayments()
    _draft.payments[personId] = 0
    _sbStep5(noAnim)
  }

  function _sbSavePayments() {
    _draft.peopleIds.forEach(id => {
      const el = document.getElementById(`pay-${id}`)
      _draft.payments[id] = el ? numVal(el) : (_draft.payments[id] || 0)
    })
  }

  App._sbNext5 = function () { _sbSavePayments(); _step = 5; _saveDraft(); _sbRender() }

  App._sbUpdatePayRemaining = function () {
    const el = document.getElementById('sb-pay-remaining')
    if (!el) return
    const { finalTotal } = runPipeline(itemSubtotal(_draft), _draft.pipeline, _draft.rounding)
    let paid = 0
    _draft.peopleIds.forEach(id => {
      const inp = document.getElementById(`pay-${id}`)
      paid = r2(paid + (inp ? numVal(inp) : (_draft.payments[id] || 0)))
    })
    const remaining = r2(finalTotal - paid)
    if (remaining === 0) {
      el.innerHTML = `<span style="color:var(--success,#22c55e);font-weight:600">ครบแล้ว</span>`
    } else if (remaining > 0) {
      el.innerHTML = `ยังขาดอีก <span style="font-weight:700;color:var(--warning,#f59e0b)">${fmt(remaining)}</span>`
    } else {
      el.innerHTML = `จ่ายเกินมา <span style="font-weight:700;color:var(--muted)">${fmt(Math.abs(remaining))}</span>`
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  STEP 6 — สรุป
  // ══════════════════════════════════════════════════════════════
  function _sbStep6(opts) {
    const result = calcResult(_draft)

    const transferRows = result.transfers.length
      ? result.transfers.map(t => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:15px">
              <span>${esc(t.fromName)}</span>
              <span style="color:var(--primary);font-size:18px;line-height:1">→</span>
              <span>${esc(t.toName)}</span>
            </div>
            <div style="font-size:20px;font-weight:800;color:var(--primary)">${fmt(t.amount)}</div>
          </div>`).join('')
      : `<div style="text-align:center;padding:16px 0;color:var(--muted)">ทุกคนไม่ติดค้างแล้ว 🎉</div>`

    const detailRows = result.personResults.map(p => `
      <div class="detail-row" style="font-size:13px">
        <div style="flex:1">${esc(p.name)}</div>
        <div style="text-align:right;color:var(--muted)">ยอดจ่าย ${fmt(p.finalShare)}</div>
      </div>`).join('')

    const warnHtml = result.warnings.map(w =>
      `<div style="font-size:12px;color:var(--expense);margin-bottom:4px">⚠️ ${esc(w)}</div>`
    ).join('')

    const copyText = _lineText(_draft, result)

    App.openSubScreen(`
      ${stepHeader('App._sbBack()')}
      <div class="sub-scroll" style="padding:16px 16px 40px">
        <div class="card" style="padding:14px;margin-bottom:12px;text-align:center">
          <div style="font-size:12px;color:var(--muted)">ยอดสุดท้าย</div>
          <div style="font-size:28px;font-weight:800;color:var(--primary)">${fmt(result.finalTotal)}</div>
          ${_draft.manualTotal&&Math.abs(r2(_draft.manualTotal-result.finalTotal))>0.5
            ?`<div style="font-size:12px;color:var(--muted)">ยอดบิล: ${fmt(_draft.manualTotal)}</div>`:''}
        </div>

        ${warnHtml}

        <div style="margin-bottom:16px">${transferRows}</div>

        <details style="margin-bottom:16px">
          <summary style="font-size:13px;color:var(--muted);cursor:pointer;padding:4px 0">ยอดจ่ายต่อคน</summary>
          <div class="card card-pad" style="margin-top:8px;padding:0px 10px">${detailRows}</div>
        </details>

        <textarea id="sb6-copy-text" style="position:absolute;left:-9999px;top:0;opacity:0;width:1px;height:1px">${esc(copyText)}</textarea>
        <button class="btn btn-primary" onclick="App._sbSaveBill()" style="width:100%;margin-bottom:8px">💾 บันทึกบิล</button>
        <button class="btn btn-secondary" onclick="App._sbCopyLine()" style="width:100%">📋 ข้อความ</button>
      </div>`, opts)
  }

  App._sbCopyLine = function () {
    const el = document.getElementById('sb6-copy-text')
    if (el) _clipCopy(el.value, 'sb6-copy-text')
  }

  App._sbSaveBill = function () {
    if (!_draft) return
    _draft.updatedAt = nowISO()
    SbStore.upsertBill(_draft)
    _clearDraft()
    notify('บันทึกบิลแล้ว 🎉', 'success')
    const id = _draft.id; _draft = null
    App.openSplitBillDetail(id)
  }

  // ── Back helper ───────────────────────────────────────────────
  App._sbBack = function () {
    if (_step === 2 && _editingItemIdx !== -1) {
      App._sbItemCancel()
      return
    }
    if (_step <= 1) { _clearDraft(); return App.openSplitBillScreen() }
    _step--; _sbRender()
  }

  // ══════════════════════════════════════════════════════════════
  //  PEOPLE MANAGEMENT
  // ══════════════════════════════════════════════════════════════
  App.openSplitPeopleScreen = function (_editingId) {
    const people = SbStore.loadPeople()
    const rows = people.map(p => {
      if (_editingId === p.id) {
        return `
          <div class="settings-row" style="padding: 0px 8px 0px 0px;gap:8px;align-items:center">
            <input class="form-input" id="sbp-edit-${esc(p.id)}" value="${esc(p.name)}"
              style="flex:1;padding:8px 10px;font-size:14px"
              onkeydown="if(event.key==='Enter')App._sbSaveEditPerson('${esc(p.id)}');if(event.key==='Escape')App.openSplitPeopleScreen()">
            <button class="btn btn-primary btn-sm" onclick="App._sbSaveEditPerson('${esc(p.id)}')" style="width:auto;padding:8px 14px">บันทึก</button>
            <button class="btn-icon" onclick="App.openSplitPeopleScreen()" style="color:var(--muted)">✕</button>
          </div>`
      }
      return `
        <div class="settings-row" style="padding:0px 8px">
          <div class="s-label" style="flex:1">${esc(p.name)}</div>
          <button class="btn-icon" onclick="App.openSplitPeopleScreen('${esc(p.id)}')" style="color:var(--muted);font-size:13px" title="แก้ไข">✏️</button>
          <button class="btn-icon" onclick="App._sbDeletePerson('${esc(p.id)}')" style="color:var(--expense);font-size:13px" title="ลบ">🗑</button>
        </div>`
    }).join('')

    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openSplitBillScreen()">←</button>
        <h2>สมาชิก</h2>
        <div style="width:32px"></div>
      </div>
      <div class="sub-scroll" style="padding:12px 16px 40px">
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <input class="form-input" id="sbp-newname" placeholder="พิมพ์ชื่อสมาชิกแล้วกด +"
            style="flex:1;padding:10px 14px;font-size:14px"
            onkeydown="if(event.key==='Enter')App._sbAddPerson()">
          <button class="btn btn-primary" onclick="App._sbAddPerson()" style="width:70px;padding:10px 18px;flex-shrink:0">+ เพิ่ม</button>
        </div>
        ${people.length
          ? `<div class="card card-pad" style="padding:3px 8px">${rows}</div>`
          : `<div style="text-align:center;padding:32px 0;color:var(--muted)"><div style="font-size:32px">👥</div><div style="margin-top:8px">ยังไม่มีสมาชิก</div></div>`}
      </div>`, noAnim)
    if (_editingId) {
      setTimeout(() => document.getElementById(`sbp-edit-${_editingId}`)?.focus(), 80)
    } else {
      setTimeout(() => document.getElementById('sbp-newname')?.focus(), 80)
    }
  }

  App._sbAddPerson = function () {
    const name = document.getElementById('sbp-newname')?.value.trim()
    if (!name) return notify('กรุณากรอกชื่อ', 'error')
    const _sbpErr = (window._fieldTooLong || function(){})(name, (window.FIELD_MAX || {}).name || 50, 'ชื่อสมาชิก')
    if (_sbpErr) return notify(_sbpErr, 'error')
    SbStore.upsertPerson({ id: genId(), name, emoji:'👤', color:'#2563EB', note:'', archived:false, createdAt: nowISO(), updatedAt: nowISO() })
    notify('เพิ่มสมาชิกแล้ว', 'success')
    App.openSplitPeopleScreen()
  }

  App._sbSaveEditPerson = function (personId) {
    const name = document.getElementById(`sbp-edit-${personId}`)?.value.trim()
    if (!name) return notify('กรุณากรอกชื่อ', 'error')
    const _sbpeErr = (window._fieldTooLong || function(){})(name, (window.FIELD_MAX || {}).name || 50, 'ชื่อสมาชิก')
    if (_sbpeErr) return notify(_sbpeErr, 'error')
    const existing = SbStore.getPerson(personId); if (!existing) return
    SbStore.upsertPerson({ ...existing, name, updatedAt: nowISO() })
    notify('แก้ไขแล้ว', 'success')
    App.openSplitPeopleScreen()
  }

  App._sbDeletePerson = function (personId) {
    const p = SbStore.getPerson(personId); if (!p) return
    const go = () => { SbStore.deletePerson(personId); notify('ลบแล้ว', 'success'); App.openSplitPeopleScreen() }
    if (App.showConfirm) App.showConfirm({ title:'ลบสมาชิก', danger:true, confirmLabel:'ลบ', body:`ลบ "${p.name}"?`, onConfirm: go })
    else if (confirm(`ลบ "${p.name}"?`)) go()
  }

  // ══════════════════════════════════════════════════════════════
  //  CSS
  // ══════════════════════════════════════════════════════════════
  if (!document.getElementById('sb-styles')) {
    const s = document.createElement('style'); s.id = 'sb-styles'
    s.textContent = `.sb-bill-row{cursor:pointer;transition:opacity .15s}.sb-bill-row:active{opacity:.8}.sb-item-row{cursor:pointer;transition:opacity .15s}.sb-item-row:active{opacity:.8}.flex-1{flex:1}`
    document.head.appendChild(s)
  }

  // ══════════════════════════════════════════════════════════════
  //  PATCH renderMore
  // ══════════════════════════════════════════════════════════════
  const _prevRenderMoreSB = App.renderMore?.bind(App)
  App.renderMore = function () {
    _prevRenderMoreSB?.()
    // หารบิล is now part of the วางแผน tab in the 3-tab More layout — skip standalone injection
  }

  // ── Init ──────────────────────────────────────────────────────
  try { if (typeof S !== 'undefined' && S.page === 'more') App.renderMore?.() } catch(_) {}
})()
