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
  const fmt     = n => '฿' + Number(n||0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})
  const notify  = (msg, type='info') => { try { toast(msg, type) } catch(_) {} }
  const r2      = n => Math.round((Number(n)||0) * 100) / 100
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
    saveBills:    b  => { try { localStorage.setItem(BILLS_KEY,  JSON.stringify(b)); return true } catch(_) { return false } },
    loadPeople:   () => { try { return JSON.parse(localStorage.getItem(PEOPLE_KEY)||'[]')||[] } catch(_) { return [] } },
    savePeople:   p  => { try { localStorage.setItem(PEOPLE_KEY, JSON.stringify(p)); return true } catch(_) { return false } },
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
      { id: 'discount', type: 'discount', label: 'ส่วนลด',         enabled: false, mode: 'percent', value: 0  },
      { id: 'service',  type: 'service',  label: 'Service Charge', enabled: false, mode: 'percent', value: 10 },
      { id: 'vat',      type: 'vat',      label: 'VAT',            enabled: false, mode: 'percent', value: 7  },
    ]
  }

  function newDraft(base = {}) {
    return {
      id:          base.id       || genId(),
      title:       base.title    || '',
      date:        base.date     || todayStr(),
      manualTotal: Number(base.manualTotal) || 0,
      peopleIds:   Array.isArray(base.peopleIds) ? [...base.peopleIds] : [],
      items:       Array.isArray(base.items) ? JSON.parse(JSON.stringify(base.items)) : [],
      pipeline:    Array.isArray(base.pipeline) ? JSON.parse(JSON.stringify(base.pipeline)) : defaultPipeline(),
      payments:    base.payments ? { ...base.payments } : {},
      rounding:    base.rounding ?? false,
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

  function roundSatang(satang) {
    const s = satang % 100
    if (s <= 12) return satang - s
    if (s <= 37) return satang - s + 25
    if (s <= 62) return satang - s + 50
    if (s <= 87) return satang - s + 75
    return satang - s + 100
  }

  function runPipeline(subtotal, pipeline) {
    let amount = r2(subtotal)
    const steps = [{ label: 'ยอดอาหาร', amount, delta: 0, type: 'base' }]
    for (const p of (pipeline||[])) {
      if (!p.enabled) continue
      let raw = p.mode === 'percent' ? amount * (Number(p.value)||0) / 100 : (Number(p.value)||0)
      const delta = p.type === 'discount' ? -Math.abs(r2(raw)) : Math.abs(r2(raw))
      amount = r2(amount + delta)
      steps.push({ label: p.label, amount, delta, type: p.type, mode: p.mode, value: p.value })
    }
    return { finalTotal: amount, steps }
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
    const { finalTotal } = runPipeline(sub, draft.pipeline)
    const shares = {}

    if (sub > 0) {
      let alloc = 0
      const ids = Object.keys(byPerson)
      ids.forEach((id, i) => {
        if (i < ids.length - 1) { shares[id] = r2(byPerson[id] / sub * finalTotal); alloc += shares[id] }
        else                     { shares[id] = r2(finalTotal - alloc) }
      })
    } else if (draft.peopleIds.length) {
      const n = draft.peopleIds.length
      let alloc = 0
      draft.peopleIds.forEach((id, i) => {
        if (i < n-1) { shares[id] = r2(finalTotal / n); alloc += shares[id] }
        else          { shares[id] = r2(finalTotal - alloc) }
      })
    }

    // Quarter-satang rounding — last person absorbs rounding error
    if (draft.rounding && Object.keys(shares).length > 0) {
      let roundedTotal = 0
      const ids = Object.keys(shares)
      ids.forEach((id, i) => {
        if (i < ids.length - 1) {
          shares[id] = roundSatang(Math.round(shares[id] * 100)) / 100
          roundedTotal += shares[id]
        } else {
          shares[id] = r2(finalTotal - roundedTotal)
        }
      })
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
    const { finalTotal: calcTotal } = runPipeline(sub, draft.pipeline)

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

  // ── Wizard state ─────────────────────────────────────────────
  let _draft = null
  let _step  = 1
  let _editingItemIdx = -1

  const STEP_TITLES = ['','ข้อมูลบิล','เพิ่มคน','รายการอาหาร','ส่วนลด / SC / VAT','ใครจ่ายไปแล้ว','สรุป']
  const noAnim = { animate: false }

  function stepBar() {
    return `<div style="display:flex;gap:3px;padding:4px 16px 0">
      ${[1,2,3,4,5,6].map(n=>`<div style="flex:1;height:3px;border-radius:2px;background:${_step>=n?'var(--primary)':'var(--border)'}"></div>`).join('')}
    </div>`
  }

  function stepHeader(backFn) {
    return `<div class="sub-header">
      <button class="btn-icon" onclick="${backFn}">←</button>
      <h2 style="flex:1">${esc(STEP_TITLES[_step])}</h2>
      <span style="font-size:12px;color:var(--muted)">${_step}/6</span>
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
      ? result.transfers.map(t => `${t.fromName} โอนให้ ${t.toName} ${fmt(t.amount)}`).join('\n')
      : 'ทุกคนเสมอกันแล้ว 🎉'
    const shareLines = result.personResults.map(p => `${p.name}: ${fmt(p.finalShare)}`).join('\n')
    return [
      `🍽️ ${bill.title||'หารบิล'}  ${thaiDate(bill.date)}`,
      div,
      '💸 สรุปการโอน',
      transferLines,
      div,
      '💰 ส่วนแบ่งต่อคน',
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
      const total = b.manualTotal > 0 ? b.manualTotal : runPipeline(sub, b.pipeline).finalTotal
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
        <button class="btn btn-secondary btn-sm" onclick="App.openSplitPeopleScreen()" style="width:auto">👥</button>
        <button class="btn btn-primary btn-sm" onclick="App.openSplitBillForm()" style="width:auto;margin-left:6px">+ บิล</button>
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

    const personRows = result.personResults.map(p => `
      <div class="detail-row">
        <div style="flex:1">
          <div style="font-weight:600">${esc(p.name)}</div>
          <div style="font-size:12px;color:var(--muted)">ส่วนแบ่ง ${fmt(p.finalShare)} · จ่าย ${fmt(p.paid)}</div>
        </div>
        <div style="text-align:right;font-weight:700;color:${p.net>0?'var(--income)':p.net<0?'var(--expense)':'var(--muted)'}">
          ${p.net>0?`ได้คืน ${fmt(p.net)}`:p.net<0?`ต้องจ่าย ${fmt(-p.net)}`:'เสมอกัน'}
        </div>
      </div>`).join('')

    const transferRows = result.transfers.length
      ? result.transfers.map(t=>`
          <div class="detail-row">
            <div style="font-weight:600">${esc(t.fromName)}<span style="color:var(--muted);font-weight:400;font-size:13px"> โอนให้ </span>${esc(t.toName)}</div>
            <div style="font-weight:800;color:var(--primary)">${fmt(t.amount)}</div>
          </div>`).join('')
      : `<div style="color:var(--muted);font-size:13px;padding:8px 0">ทุกคนเสมอกันแล้ว 🎉</div>`

    const warnHtml = result.warnings.map(w =>
      `<div style="background:var(--elevated);border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:13px;color:var(--expense)">⚠️ ${esc(w)}</div>`
    ).join('')

    const copyText = _lineText(bill, result)

    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openSplitBillScreen()">←</button>
        <h2 style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(bill.title||'ไม่มีชื่อ')}</h2>
        <button class="btn btn-secondary btn-sm" onclick="App.openSplitBillForm('${esc(billId)}')" style="width:auto">✏️</button>
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

        <div class="sec-title">สรุปต่อคน</div>
        <div class="card card-pad">${personRows||'<div style="color:var(--muted)">ยังไม่มีคน</div>'}</div>

        <div class="sec-title">โอนเงิน</div>
        <div class="card card-pad">${transferRows}</div>

        <button class="btn btn-secondary" onclick="App._sbDetailCopyLine()" style="margin-top:16px;width:100%">📋 คัดลอกสำหรับส่ง LINE</button>
        <textarea id="sb-detail-copy" style="position:absolute;left:-9999px;top:0;opacity:0;width:1px;height:1px">${esc(copyText)}</textarea>

        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-secondary flex-1" onclick="App.openSplitBillForm('${esc(billId)}')">✏️ แก้ไข</button>
          <button class="btn btn-secondary flex-1" onclick="App._sbCopy('${esc(billId)}')">⧉ ทำซ้ำ</button>
          <button class="btn btn-outline flex-1" onclick="App._sbDelete('${esc(billId)}')">🗑</button>
        </div>
      </div>`)
  }

  App._sbDetailCopyLine = function () {
    const el = document.getElementById('sb-detail-copy')
    if (el) _clipCopy(el.value, 'sb-detail-copy')
  }

  App._sbCopy = function (billId) {
    const bill = SbStore.getBill(billId); if (!bill) return
    const copy = { ...JSON.parse(JSON.stringify(bill)), id: genId(), title: (bill.title||'บิล') + ' (สำเนา)', date: todayStr(), payments: {}, createdAt: nowISO(), updatedAt: nowISO() }
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
  App.openSplitBillForm = function (billId = '') {
    const existing = billId ? SbStore.getBill(billId) : null
    _draft = newDraft(existing ? JSON.parse(JSON.stringify(existing)) : {})
    _step  = 1
    _editingItemIdx = -1
    _sbRender()
  }

  function _sbRender(opts) {
    switch (_step) {
      case 1: return _sbStep1(opts)
      case 2: return _sbStep2(opts)
      case 3: return _sbStep3(opts)
      case 4: return _sbStep4(opts)
      case 5: return _sbStep5(opts)
      case 6: return _sbStep6(opts)
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  STEP 1
  // ══════════════════════════════════════════════════════════════
  function _sbStep1(opts) {
    App.openSubScreen(`
      ${stepHeader('App.openSplitBillScreen()')}
      <div class="sub-scroll" style="padding:16px 16px 40px">
        <div class="form-group">
          <label class="form-label">ชื่อบิล</label>
          <input class="form-input" id="sb1-title" value="${esc(_draft.title)}" placeholder="เช่น ข้าวเย็นวันศุกร์">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="form-group">
            <label class="form-label">วันที่</label>
            <input class="form-input" type="date" id="sb1-date" value="${esc(_draft.date)}">
          </div>
          <div class="form-group">
            <label class="form-label">ราคารวมจากบิล (฿)</label>
            <input class="form-input" type="number" inputmode="decimal" id="sb1-total" value="${_draft.manualTotal||''}" placeholder="0 = ไม่ระบุ">
          </div>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-top:-4px;margin-bottom:12px">
          ใส่ราคาจากใบเสร็จเพื่อให้ระบบเช็กว่าคำนวณตรงกัน
        </div>
        ${navRow('ถัดไป: เพิ่มคน →', 'App._sbNext1()')}
      </div>`, opts)
  }

  App._sbNext1 = function () {
    _draft.title       = document.getElementById('sb1-title')?.value.trim() || 'บิลใหม่'
    _draft.date        = document.getElementById('sb1-date')?.value || todayStr()
    _draft.manualTotal = Number(document.getElementById('sb1-total')?.value) || 0
    _step = 2; _sbRender()
  }

  // ══════════════════════════════════════════════════════════════
  //  STEP 2
  // ══════════════════════════════════════════════════════════════
  function _sbStep2(opts) {
    const people   = SbStore.loadPeople().filter(p => !p.archived)
    const selected = _draft.peopleIds

    const chips = people.map(p => {
      const on = selected.includes(p.id)
      return `<button class="chip sb-person-chip${on?' active':''}" onclick="App._sbTogglePerson('${esc(p.id)}')">
        ${esc(p.emoji||'👤')} ${esc(p.name)}
      </button>`
    }).join('')

    App.openSubScreen(`
      ${stepHeader('App._sbBack()')}
      <div class="sub-scroll" style="padding:16px 16px 40px">
        ${chips ? `<div class="chips" style="flex-wrap:wrap;gap:8px;padding:0 0 16px">${chips}</div>` : ''}
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <input class="form-input" id="sb2-newname" placeholder="พิมพ์ชื่อแล้วกด +"
            style="flex:1" onkeydown="if(event.key==='Enter')App._sbQuickAdd()">
          <button class="btn btn-secondary" onclick="App._sbQuickAdd()"
            style="width:auto;padding:0 18px;font-size:20px;line-height:1">+</button>
        </div>
        ${navRow(`ถัดไป →  (${selected.length} คน)`, 'App._sbNext2()', 'App._sbBack()')}
      </div>`, opts)
  }

  App._sbTogglePerson = function (id) {
    const i = _draft.peopleIds.indexOf(id)
    if (i >= 0) {
      _draft.peopleIds.splice(i, 1)
      ;(_draft.items||[]).forEach(item => {
        item.participants = (item.participants||[]).filter(p => p.personId !== id)
      })
    } else {
      _draft.peopleIds.push(id)
    }
    _sbStep2(noAnim)
  }

  App._sbQuickAdd = function () {
    const input = document.getElementById('sb2-newname')
    const name  = input?.value.trim()
    if (!name) return
    const person = { id: genId(), name, emoji: '👤', color: '#2563EB', note: '', archived: false, createdAt: nowISO(), updatedAt: nowISO() }
    SbStore.upsertPerson(person)
    _draft.peopleIds.push(person.id)
    _sbStep2(noAnim)
  }

  App._sbNext2 = function () {
    if (!_draft.peopleIds.length) return notify('เลือกอย่างน้อย 1 คน', 'error')
    ;(_draft.items||[]).forEach(item => {
      if (!item.participants?.length) {
        item.participants = _draft.peopleIds.map(id => ({ personId: id, ratio: 1 }))
      }
    })
    _step = 3; _sbRender()
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
        style="${on?'background:var(--primary);color:#fff;border-color:var(--primary)':''}">
        ${esc(label)}
      </button>`
    }).join('')

    let ratioInputs = ''
    if (item.splitMode === 'ratio') {
      const activeParts = (item.participants||[]).filter(p => _draft.peopleIds.includes(p.personId))
      ratioInputs = `<div style="margin-top:8px">${activeParts.map(p => `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0">
          <span style="flex:1;font-size:13px">${esc(pName(p.personId))}</span>
          <input class="form-input" type="number" inputmode="decimal" id="sbi-ratio-${esc(p.personId)}" value="${p.ratio||1}" style="width:70px;text-align:center">
          <span style="color:var(--muted);font-size:13px">ส่วน</span>
        </div>`).join('')}</div>`
    }

    const discEnabled = item.discount?.enabled
    const discMode    = item.discount?.mode || 'percent'
    const discVal     = item.discount?.value || ''
    // For legacy items with qty/pricePerUnit, compute display price
    const displayPrice = item.price != null ? (item.price || '') : ((Number(item.qty)||1) * (Number(item.pricePerUnit)||0) || '')

    return `<div class="card" style="padding:14px;border:2px solid var(--primary)">
      <input class="form-input" id="sbi-name" value="${esc(item.name)}" placeholder="ชื่อรายการ เช่น ผัดไทย" style="margin-bottom:8px;font-weight:600">

      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="color:var(--muted);font-size:13px;white-space:nowrap">ราคา ฿</span>
        <input class="form-input" type="number" inputmode="decimal" id="sbi-price" value="${displayPrice}" placeholder="0" style="flex:1;text-align:right">
      </div>

      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;margin-bottom:${discEnabled?'0':'6'}px">
        <button class="toggle${discEnabled?' on':''}" onclick="App._sbItemToggleDiscount()" aria-label="ส่วนลดรายการนี้"></button>
        <span style="font-size:13px;color:var(--muted)">ส่วนลดรายการนี้</span>
      </div>
      ${discEnabled ? `
      <div style="display:flex;gap:6px;margin-bottom:8px;margin-top:4px">
        <select class="form-input" id="sbi-disc-mode" style="flex:0 0 auto;width:135px">
          <option value="percent" ${discMode==='percent'?'selected':''}>% เปอร์เซ็นต์</option>
          <option value="fixed"   ${discMode==='fixed'  ?'selected':''}>฿ จำนวนเงิน</option>
        </select>
        <input class="form-input" type="number" inputmode="decimal" id="sbi-disc-val" value="${discVal}" placeholder="0" style="flex:1;text-align:right">
      </div>` : ''}

      <div style="margin-bottom:8px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">วิธีหาร</div>
        <div class="chips" style="padding:0;gap:6px">
          <button class="chip${item.splitMode!=='ratio'?' active':''}" onclick="App._sbItemSetMode('equal')">เท่ากัน</button>
          <button class="chip${item.splitMode==='ratio'?' active':''}" onclick="App._sbItemSetMode('ratio')">สัดส่วน</button>
        </div>
      </div>

      <div style="margin-bottom:10px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">ใครกินรายการนี้</div>
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
        ${items.length && !editing ? `<div class="card" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-size:13px;color:var(--muted)">ยอดรายการรวม</span>
          <span style="font-weight:800;color:var(--primary)">${fmt(sub)}</span>
        </div>` : ''}
        ${!editing ? navRow('ถัดไป: ส่วนลด / SC / VAT →', 'App._sbNext3()', 'App._sbBack()') : ''}
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

  App._sbNext3 = function () { _step = 4; _sbRender() }

  function _sbItemSaveFields() {
    const item = _draft.items[_editingItemIdx]
    if (!item) return
    item.name  = document.getElementById('sbi-name')?.value.trim() || ''
    item.price = Number(document.getElementById('sbi-price')?.value) || 0
    // Clear legacy fields if present
    delete item.qty; delete item.pricePerUnit
    if (!item.discount) item.discount = { enabled: false, mode: 'percent', value: 0 }
    const discModeEl = document.getElementById('sbi-disc-mode')
    const discValEl  = document.getElementById('sbi-disc-val')
    if (discModeEl) item.discount.mode  = discModeEl.value
    if (discValEl)  item.discount.value = Number(discValEl.value) || 0
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
  //  STEP 4 — ส่วนลด / SC / VAT + rounding
  // ══════════════════════════════════════════════════════════════
  function _sbStep4(opts) {
    const sub = itemSubtotal(_draft)
    const pipeline = _draft.pipeline
    const { finalTotal, steps } = runPipeline(sub, pipeline)

    const pipelineRows = pipeline.map((p, i) => {
      const isFirst   = i === 0
      const isLast    = i === pipeline.length - 1
      const signLabel = p.type === 'discount' ? '−' : '+'
      return `<div class="card card-pad" style="margin-bottom:6px;opacity:${p.enabled?1:0.5}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${p.enabled?'8':'0'}px">
          <button class="toggle${p.enabled?' on':''}" onclick="App._sbPipeToggle(${i})" aria-label="${esc(p.label)}"></button>
          <span style="font-weight:600;flex:1">${signLabel} ${esc(p.label)}</span>
          <div style="display:flex;gap:4px">
            ${!isFirst?`<button class="btn-icon" onclick="App._sbPipeMove(${i},-1)">↑</button>`:'<div style="width:32px"></div>'}
            ${!isLast ?`<button class="btn-icon" onclick="App._sbPipeMove(${i}, 1)">↓</button>`:'<div style="width:32px"></div>'}
          </div>
        </div>
        ${p.enabled ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            <div class="form-group" style="margin:0">
              <label class="form-label">ประเภท</label>
              <select class="form-input" id="pipe-mode-${i}" onchange="App._sbPipeSave()">
                <option value="percent" ${p.mode==='percent'?'selected':''}>% (เปอร์เซ็นต์)</option>
                <option value="fixed"   ${p.mode==='fixed'?'selected':''}>฿ (จำนวนเงิน)</option>
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">${p.mode==='percent'?'%':'฿'}</label>
              <input class="form-input" type="number" inputmode="decimal" id="pipe-val-${i}" value="${p.value||''}" oninput="App._sbPipeSave()">
            </div>
          </div>` : ''}
      </div>`
    }).join('')

    const previewRows = steps.map((s, i) => `
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;${i===steps.length-1?'font-weight:800;border-top:1px solid var(--border);padding-top:8px;margin-top:4px':''}">
        <span style="color:${i===0||i===steps.length-1?'var(--text)':'var(--muted)'}">${esc(s.label)}</span>
        <span style="${s.delta<0?'color:var(--income)':s.delta>0?'color:var(--expense)':''}">
          ${i>0&&i<steps.length-1?(s.delta>=0?'+':'')+fmt(Math.abs(s.delta)):''}
          ${i>0?`= ${fmt(s.amount)}`:fmt(s.amount)}
        </span>
      </div>`).join('')

    App.openSubScreen(`
      ${stepHeader('App._sbBack()')}
      <div class="sub-scroll" style="padding:16px 16px 40px">
        ${sub > 0
          ? `<div class="card" style="padding:12px 14px;margin-bottom:14px">${previewRows}</div>`
          : `<div style="color:var(--muted);font-size:13px;margin-bottom:14px">ยังไม่มีรายการอาหาร (ยอดจะคำนวณเมื่อเพิ่มรายการแล้ว)</div>`}
        <div style="font-size:13px;color:var(--muted);margin-bottom:8px">เปิด/ปิด และลำดับการคำนวณ</div>
        ${pipelineRows}
        <div class="card card-pad" style="margin-top:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="toggle${_draft.rounding?' on':''}" onclick="App._sbToggleRounding()" aria-label="ปัดเศษ"></button>
            <div>
              <div style="font-weight:600">ปัดเศษ (ทุก 25 สตางค์)</div>
              <div style="font-size:12px;color:var(--muted)">ปัดยอดต่อคนเป็น 0 / 25 / 50 / 75 สตางค์</div>
            </div>
          </div>
        </div>
        ${navRow('ถัดไป: ใครจ่าย →', 'App._sbNext4()', 'App._sbBack()')}
      </div>`, opts)
  }

  App._sbToggleRounding = function () {
    _sbPipeSaveAll()
    _draft.rounding = !_draft.rounding
    _sbStep4(noAnim)
  }

  App._sbPipeToggle = function (i) {
    _sbPipeSaveAll()
    _draft.pipeline[i].enabled = !_draft.pipeline[i].enabled
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
      if (valEl)  p.value = Number(valEl.value) || 0
    })
  }

  App._sbNext4 = function () { _sbPipeSaveAll(); _step = 5; _sbRender() }

  // ══════════════════════════════════════════════════════════════
  //  STEP 5 — ใครจ่ายไปแล้ว
  // ══════════════════════════════════════════════════════════════
  function _sbStep5(opts) {
    const { finalTotal } = runPipeline(itemSubtotal(_draft), _draft.pipeline)

    const rows = _draft.peopleIds.map(id => {
      const paid    = _draft.payments[id] || ''
      const hasPaid = Number(paid) > 0
      const safeId  = esc(id)
      return `<div class="detail-row" style="align-items:center">
        <div style="flex:1;font-weight:600">${esc(pName(id))}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="color:var(--muted)">฿</span>
          <div style="position:relative;display:flex;align-items:center">
            <input class="form-input" type="number" inputmode="decimal" id="pay-${safeId}"
              value="${paid}" placeholder="0"
              style="width:110px;text-align:right;padding-right:${hasPaid?'28':'10'}px"
              oninput="(function(v,id){var x=document.getElementById('pay-x-'+id);if(x){x.style.display=v?'flex':'none'};document.getElementById('pay-'+id).style.paddingRight=v?'28px':'10px'})(this.value,'${safeId}')">
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
        <div style="font-size:13px;color:var(--muted);margin-bottom:10px">ระบุว่าใครจ่ายเงินไปแล้วเท่าไหร่ ถ้าไม่ได้จ่ายเว้นว่างไว้</div>
        <div class="card card-pad">${rows||'<div style="color:var(--muted)">ยังไม่มีคน</div>'}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:8px">"ทั้งหมด" = ${fmt(finalTotal)}</div>
        ${navRow('ถัดไป: สรุป →', 'App._sbNext5()', 'App._sbBack()')}
      </div>`, opts)
  }

  App._sbPayAll = function (personId) {
    _sbSavePayments()
    const { finalTotal } = runPipeline(itemSubtotal(_draft), _draft.pipeline)
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
      _draft.payments[id] = el ? (Number(el.value) || 0) : (_draft.payments[id] || 0)
    })
  }

  App._sbNext5 = function () { _sbSavePayments(); _step = 6; _sbRender() }

  // ══════════════════════════════════════════════════════════════
  //  STEP 6 — สรุป
  // ══════════════════════════════════════════════════════════════
  function _sbStep6(opts) {
    const result = calcResult(_draft)

    const transferRows = result.transfers.length
      ? result.transfers.map(t => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="font-weight:600;font-size:15px">
              ${esc(t.fromName)}<span style="color:var(--muted);font-weight:400;font-size:13px"> โอนให้ </span>${esc(t.toName)}
            </div>
            <div style="font-size:20px;font-weight:800;color:var(--primary)">${fmt(t.amount)}</div>
          </div>`).join('')
      : `<div style="text-align:center;padding:16px 0;color:var(--muted)">ทุกคนเสมอกันแล้ว 🎉</div>`

    const detailRows = result.personResults.map(p => `
      <div class="detail-row" style="font-size:13px">
        <div style="flex:1">${esc(p.name)}</div>
        <div style="text-align:right;color:var(--muted)">ส่วนแบ่ง ${fmt(p.finalShare)}</div>
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
          <summary style="font-size:13px;color:var(--muted);cursor:pointer;padding:4px 0">ดูรายละเอียดต่อคน</summary>
          <div class="card card-pad" style="margin-top:8px">${detailRows}</div>
        </details>

        <button class="btn btn-secondary" onclick="App._sbCopyLine()" style="margin-bottom:8px;width:100%">📋 คัดลอกสำหรับส่ง LINE</button>
        <textarea id="sb6-copy-text" style="position:absolute;left:-9999px;top:0;opacity:0;width:1px;height:1px">${esc(copyText)}</textarea>

        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-secondary" onclick="App._sbBack()" style="width:auto;padding:0 20px">←</button>
          <button class="btn btn-primary" onclick="App._sbSaveBill()" style="flex:1">💾 บันทึกบิล</button>
        </div>
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
    notify('บันทึกบิลแล้ว 🎉', 'success')
    const id = _draft.id; _draft = null
    App.openSplitBillDetail(id)
  }

  // ── Back helper ───────────────────────────────────────────────
  App._sbBack = function () {
    if (_step === 3 && _editingItemIdx !== -1) {
      App._sbItemCancel()
      return
    }
    if (_step <= 1) return App.openSplitBillScreen()
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
          <div class="settings-row" style="gap:8px;align-items:center">
            <input class="form-input" id="sbp-edit-${esc(p.id)}" value="${esc(p.name)}"
              style="flex:1;padding:8px 10px;font-size:14px"
              onkeydown="if(event.key==='Enter')App._sbSaveEditPerson('${esc(p.id)}');if(event.key==='Escape')App.openSplitPeopleScreen()">
            <button class="btn btn-primary btn-sm" onclick="App._sbSaveEditPerson('${esc(p.id)}')" style="width:auto;padding:8px 14px">บันทึก</button>
            <button class="btn-icon" onclick="App.openSplitPeopleScreen()" style="color:var(--muted)">✕</button>
          </div>`
      }
      return `
        <div class="settings-row">
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
          <input class="form-input" id="sbp-newname" placeholder="พิมพ์ชื่อสมาชิก..."
            style="flex:1;padding:10px 14px;font-size:14px"
            onkeydown="if(event.key==='Enter')App._sbAddPerson()">
          <button class="btn btn-primary" onclick="App._sbAddPerson()" style="width:auto;padding:10px 18px;flex-shrink:0">+</button>
        </div>
        ${people.length
          ? `<div class="card card-pad">${rows}</div>`
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
    SbStore.upsertPerson({ id: genId(), name, emoji:'👤', color:'#2563EB', note:'', archived:false, createdAt: nowISO(), updatedAt: nowISO() })
    notify('เพิ่มสมาชิกแล้ว', 'success')
    App.openSplitPeopleScreen()
  }

  App._sbSaveEditPerson = function (personId) {
    const name = document.getElementById(`sbp-edit-${personId}`)?.value.trim()
    if (!name) return notify('กรุณากรอกชื่อ', 'error')
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
    try {
      const content = document.getElementById('more-content'); if (!content) return
      const inner   = content.firstElementChild;               if (!inner)   return
      if (inner.querySelector('.sb-more-section')) return
      const billCount = SbStore.loadBills().length
      const sec = document.createElement('div'); sec.className = 'sb-more-section'
      sec.innerHTML = `
        <div class="sec-title">คำนวณ</div>
        <div class="card card-pad">
          <div class="settings-row" onclick="App.openSplitBillScreen()">
            <div class="s-icon">🍽️</div><div class="s-label">หารบิล</div>
            ${billCount?`<div class="s-value">${billCount} บิล`:''}
            <div class="s-arrow">›</div>
          </div>
        </div>`
      const header = inner.querySelector('.more-sticky-header')
      if (header) header.insertAdjacentElement('afterend', sec)
      else inner.prepend(sec)
    } catch(_) {}
  }

  // ══════════════════════════════════════════════════════════════
  //  EXPORT / IMPORT
  // ══════════════════════════════════════════════════════════════
  const _prevExport = App.exportData?.bind(App)
  App.exportData = function () {
    const _orig = Storage.buildExportPayload?.bind(Storage)
    if (_orig) {
      Storage.buildExportPayload = function (state) {
        const p = _orig(state)
        try { p.splitBills = SbStore.loadBills(); p.splitPeople = SbStore.loadPeople() } catch(_) {}
        Storage.buildExportPayload = _orig; return p
      }
    }
    _prevExport?.()
  }

  const _prevImport = App.importData?.bind(App)
  App.importData = function (input) {
    const _origNorm = Storage.normalizeBackupPayload?.bind(Storage)
    if (_origNorm) {
      Storage.normalizeBackupPayload = function (raw) {
        const n = _origNorm(raw)
        if (Array.isArray(raw.splitBills))  try { SbStore.saveBills(raw.splitBills)   } catch(_) {}
        if (Array.isArray(raw.splitPeople)) try { SbStore.savePeople(raw.splitPeople) } catch(_) {}
        Storage.normalizeBackupPayload = _origNorm; return n
      }
    }
    _prevImport?.(input)
  }

  // ── Init ──────────────────────────────────────────────────────
  try { if (typeof S !== 'undefined' && S.page === 'more') App.renderMore?.() } catch(_) {}
})()
