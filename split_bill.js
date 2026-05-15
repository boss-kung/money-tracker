/* ============================================================
   Split Bill — Phase 1-5
   Standalone module. No dependency on wallet/transaction/report.
   Attaches to window.App and window.SplitBillCalc.
   ============================================================ */
;(function () {
  'use strict'
  if (typeof App === 'undefined') return

  // ── Constants ────────────────────────────────────────────────
  const BILLS_KEY   = 'mt_split_bills'
  const PEOPLE_KEY  = 'mt_split_people'

  // ── Utilities ────────────────────────────────────────────────
  const esc     = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))
  const nowISO  = () => new Date().toISOString()
  const genId   = () => Date.now().toString(36) + Math.random().toString(36).slice(2)
  const fmt     = n  => typeof Calc !== 'undefined' ? Calc.fmt(n) : ('฿' + Number(n||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2}))
  const notify  = (msg, type='info') => { try { toast(msg, type) } catch(_) {} }

  // Integer satang helpers to avoid float drift
  const toSatang   = n => Math.round((Number(n) || 0) * 100)
  const fromSatang = n => n / 100

  // YYYY-MM-DD local today
  const todayStr = () => {
    try { if (typeof getTODAY === 'function') return getTODAY() } catch(_) {}
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }

  const thaiDate = dateStr => {
    if (!dateStr) return ''
    const [y,m,d] = dateStr.split('-').map(Number)
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
    return `${d} ${months[m-1]} ${y+543}`
  }

  // ── Store ─────────────────────────────────────────────────────
  const SbStore = {
    loadBills()         { try { return JSON.parse(localStorage.getItem(BILLS_KEY) || '[]') || [] } catch(_) { return [] } },
    saveBills(bills)    { try { localStorage.setItem(BILLS_KEY, JSON.stringify(bills)); return true } catch(_) { return false } },
    loadPeople()        { try { return JSON.parse(localStorage.getItem(PEOPLE_KEY) || '[]') || [] } catch(_) { return [] } },
    savePeople(people)  { try { localStorage.setItem(PEOPLE_KEY, JSON.stringify(people)); return true } catch(_) { return false } },
    getBill(id)         { return this.loadBills().find(b => b.id === id) || null },
    getPerson(id)       { return this.loadPeople().find(p => p.id === id) || null },
    upsertBill(bill) {
      const bills = this.loadBills()
      const idx = bills.findIndex(b => b.id === bill.id)
      if (idx >= 0) bills[idx] = bill; else bills.unshift(bill)
      return this.saveBills(bills)
    },
    deleteBill(id) {
      const bills = this.loadBills().filter(b => b.id !== id)
      return this.saveBills(bills)
    },
    upsertPerson(person) {
      const people = this.loadPeople()
      const idx = people.findIndex(p => p.id === person.id)
      if (idx >= 0) people[idx] = person; else people.unshift(person)
      return this.savePeople(people)
    },
    deletePerson(id) {
      const people = this.loadPeople().filter(p => p.id !== id)
      return this.savePeople(people)
    },
  }

  // ── Data normalizers ─────────────────────────────────────────
  function normalizePerson(raw = {}) {
    return {
      id:        raw.id        || genId(),
      name:      raw.name      || 'ไม่ระบุชื่อ',
      emoji:     raw.emoji     || '👤',
      color:     raw.color     || '#2563EB',
      note:      raw.note      || '',
      archived:  raw.archived  || false,
      createdAt: raw.createdAt || nowISO(),
      updatedAt: raw.updatedAt || nowISO(),
    }
  }

  function normalizeBill(raw = {}) {
    return {
      id:         raw.id         || genId(),
      title:      raw.title      || 'บิลใหม่',
      date:       raw.date       || todayStr(),
      note:       raw.note       || '',
      currency:   'THB',
      totalMode:  raw.totalMode  || 'manual',
      manualTotal: Number(raw.manualTotal) || 0,
      breakdown: {
        baseAmount: Number(raw.breakdown?.baseAmount) || 0,
        service:  { enabled: false, type: 'percent', value: 10, allocation: 'proportional', ...(raw.breakdown?.service  || {}) },
        vat:      { enabled: false, type: 'percent', value: 7, base: 'base', allocation: 'proportional', ...(raw.breakdown?.vat      || {}) },
        tip:      { enabled: false, amount: 0, allocation: 'proportional', ...(raw.breakdown?.tip      || {}) },
        discount: { enabled: false, type: 'fixed', value: 0, allocation: 'proportional', ...(raw.breakdown?.discount  || {}) },
      },
      deposits:     Array.isArray(raw.deposits)     ? raw.deposits     : [],
      participants: Array.isArray(raw.participants) ? raw.participants : [],
      items:        Array.isArray(raw.items)        ? raw.items        : [],
      splitMethod:  raw.splitMethod  || 'equal',
      rounding: {
        mode: 'cent', assignTo: 'largestPayer', personId: '', ...(raw.rounding || {})
      },
      overrides: raw.overrides || {},
      createdAt: raw.createdAt || nowISO(),
      updatedAt: raw.updatedAt || nowISO(),
    }
  }

  // ── Calculator ───────────────────────────────────────────────
  const SplitBillCalc = {

    calculateBill(bill, allPeople) {
      const b = JSON.parse(JSON.stringify(bill))
      const warnings = []

      const included = (b.participants || []).filter(p => p.included !== false)
      if (!included.length) {
        warnings.push({ code: 'NO_PARTICIPANTS', msg: 'ยังไม่มีผู้เข้าร่วม' })
        return { totalToSplit: 0, people: [], settlementPlan: [], warnings, roundingAdjustment: 0 }
      }

      // Step 2: totalToSplit
      const totalToSplit = this._calcTotal(b, warnings)
      const totalSatang  = toSatang(totalToSplit)
      if (totalSatang <= 0) warnings.push({ code: 'ZERO_TOTAL', msg: 'ยอดรวมต้องมากกว่า 0' })

      // Step 3: base shares (in satang)
      const baseShares = this._calcBaseShares(b, included, totalSatang, warnings)

      // Step 6: personal adjustments
      const adjShares = this._applyAdjustments(b, baseShares)

      // Step 7: share overrides
      const { shares: rawShares, overrideApplied } = this._applyShareOverrides(b, adjShares)

      // Step 8: rounding
      const { shares: finalShares, roundingAdjustment } = this._applyRounding(rawShares, totalSatang)

      // Step 9: paid amounts (in satang)
      const paidMap = this._calcPaidAmounts(b)

      // Check paid vs total
      const totalPaidSatang = Object.values(paidMap).reduce((s, v) => s + v, 0)
      const paidDiff = Math.abs(totalPaidSatang - totalSatang)
      if (paidDiff > 5) {
        warnings.push({
          code: totalPaidSatang < totalSatang ? 'UNDERPAID' : 'OVERPAID',
          msg: totalPaidSatang < totalSatang
            ? `ยอดที่จ่ายน้อยกว่าบิล ${fmt(fromSatang(totalSatang - totalPaidSatang))}`
            : `ยอดที่จ่ายเกินบิล ${fmt(fromSatang(totalPaidSatang - totalSatang))}`
        })
      }

      // Step 10: net per person
      const people = included.map(p => {
        const finalShare = fromSatang(finalShares[p.personId] || 0)
        const paidAmount = fromSatang(paidMap[p.personId] || 0)
        const net = Math.round((paidAmount - finalShare) * 100) / 100
        return {
          personId: p.personId,
          finalShare,
          paidAmount,
          net,
          status: Math.abs(net) < 0.005 ? 'even' : net > 0 ? 'getsBack' : 'owes',
          isOverridden: overrideApplied[p.personId] || false,
        }
      })

      // Step 11: settlement
      let settlementPlan = this._generateSettlement(people)

      // Step 12: settlement overrides
      if (Array.isArray(b.overrides?.settlementPlan)) {
        settlementPlan = b.overrides.settlementPlan.map(t => ({ ...t, isOverridden: true }))
      }

      return { totalToSplit, people, settlementPlan, warnings, roundingAdjustment }
    },

    _calcTotal(b, warnings) {
      if (b.overrides?.total != null) return Number(b.overrides.total) || 0

      if (b.totalMode === 'breakdown') {
        const br = b.breakdown || {}
        const base = Number(br.baseAmount) || 0

        let service = 0
        if (br.service?.enabled) {
          service = br.service.type === 'percent'
            ? base * (Number(br.service.value) || 0) / 100
            : Number(br.service.value) || 0
        }

        let vatBase = base
        if (br.vat?.base === 'afterService') vatBase = base + service

        let vat = 0
        if (br.vat?.enabled) {
          vat = br.vat.type === 'percent'
            ? vatBase * (Number(br.vat.value) || 0) / 100
            : Number(br.vat.value) || 0
        }

        const tip      = br.tip?.enabled      ? (Number(br.tip.amount) || 0) : 0
        const discount = br.discount?.enabled
          ? (br.discount.type === 'percent' ? base * (Number(br.discount.value)||0)/100 : Number(br.discount.value)||0)
          : 0

        return Math.max(0, base + service + vat + tip - discount)
      }

      return Number(b.manualTotal) || 0
    },

    _calcBaseShares(b, included, totalSatang, warnings) {
      const method = b.splitMethod || 'equal'
      const shares = {}

      // payerOnly → share = 0
      const shareRecipients = included.filter(p => p.role !== 'payerOnly')
      included.filter(p => p.role === 'payerOnly').forEach(p => { shares[p.personId] = 0 })

      if (!shareRecipients.length) return shares

      switch (method) {
        case 'equal': {
          const n = shareRecipients.length
          const base = Math.floor(totalSatang / n)
          let rem = totalSatang - base * n
          shareRecipients.forEach(p => { shares[p.personId] = base })
          const assignee = this._roundingAssignee(b, shareRecipients)
          if (assignee) shares[assignee] = (shares[assignee] || 0) + rem
          break
        }
        case 'shareUnit': {
          const totalUnits = shareRecipients.reduce((s, p) => s + (Number(p.shareInput?.unit) || 0), 0)
          if (!totalUnits) {
            warnings.push({ code: 'ZERO_UNITS', msg: 'หน่วยรวมต้องมากกว่า 0' })
            shareRecipients.forEach(p => { shares[p.personId] = 0 })
            break
          }
          let allocated = 0
          shareRecipients.forEach((p, i) => {
            const u = Number(p.shareInput?.unit) || 0
            if (i < shareRecipients.length - 1) {
              shares[p.personId] = Math.floor((u / totalUnits) * totalSatang)
            } else {
              shares[p.personId] = totalSatang - allocated
            }
            allocated += shares[p.personId]
          })
          break
        }
        case 'percent': {
          const totalPct = shareRecipients.reduce((s, p) => s + (Number(p.shareInput?.percent) || 0), 0)
          if (Math.abs(totalPct - 100) > 0.01) {
            warnings.push({ code: 'PERCENT_MISMATCH', msg: `เปอร์เซ็นต์รวมได้ ${totalPct.toFixed(2)}% (ควรได้ 100%)` })
          }
          let allocated = 0
          shareRecipients.forEach((p, i) => {
            const pct = Number(p.shareInput?.percent) || 0
            if (i < shareRecipients.length - 1) {
              shares[p.personId] = Math.round((pct / 100) * totalSatang)
            } else {
              shares[p.personId] = totalSatang - allocated
            }
            allocated += shares[p.personId]
          })
          break
        }
        case 'fixed': {
          let fixedTotal = 0
          shareRecipients.forEach(p => {
            const s = toSatang(Number(p.shareInput?.fixedAmount) || 0)
            shares[p.personId] = s
            fixedTotal += s
          })
          if (Math.abs(fixedTotal - totalSatang) > 1) {
            warnings.push({ code: 'FIXED_MISMATCH', msg: `ยอดที่กำหนด ${fmt(fromSatang(fixedTotal))} ไม่ตรงกับบิล ${fmt(fromSatang(totalSatang))}` })
          }
          break
        }
        case 'manual': {
          let manTotal = 0
          shareRecipients.forEach(p => {
            const s = toSatang(Number(p.shareInput?.manualAmount) || 0)
            shares[p.personId] = s
            manTotal += s
          })
          if (Math.abs(manTotal - totalSatang) > 1) {
            warnings.push({ code: 'MANUAL_MISMATCH', msg: `ยอดที่กรอกรวม ${fmt(fromSatang(manTotal))} ไม่ตรงกับบิล ${fmt(fromSatang(totalSatang))}` })
          }
          break
        }
        case 'itemized':
        case 'hybrid': {
          included.forEach(p => { shares[p.personId] = 0 })
          const items = b.items || []
          let itemTotalSatang = 0

          items.forEach(item => {
            const itemSatang = toSatang(Number(item.amount) || 0)
            itemTotalSatang += itemSatang
            const itemParts = (item.participants || []).filter(ip =>
              included.some(p => p.personId === ip.personId)
            )
            if (!itemParts.length || item.splitMode === 'exclude') return

            switch (item.splitMode || 'equal') {
              case 'equal': {
                const n = itemParts.length
                const base = Math.floor(itemSatang / n)
                const rem  = itemSatang - base * n
                itemParts.forEach(ip => { shares[ip.personId] = (shares[ip.personId]||0) + base })
                if (rem && itemParts[0]) shares[itemParts[0].personId] += rem
                break
              }
              case 'singleOwner':
                if (itemParts[0]) shares[itemParts[0].personId] = (shares[itemParts[0].personId]||0) + itemSatang
                break
              case 'shareUnit': {
                const tu = itemParts.reduce((s, ip) => s + (Number(ip.unit)||0), 0)
                if (!tu) break
                let al = 0
                itemParts.forEach((ip, i) => {
                  const amt = i < itemParts.length - 1 ? Math.floor((Number(ip.unit)||0)/tu*itemSatang) : itemSatang - al
                  shares[ip.personId] = (shares[ip.personId]||0) + amt
                  al += amt
                })
                break
              }
              case 'percent': {
                let al = 0
                itemParts.forEach((ip, i) => {
                  const amt = i < itemParts.length - 1 ? Math.round((Number(ip.percent)||0)/100*itemSatang) : itemSatang - al
                  shares[ip.personId] = (shares[ip.personId]||0) + amt
                  al += amt
                })
                break
              }
              case 'fixed':
                itemParts.forEach(ip => { shares[ip.personId] = (shares[ip.personId]||0) + toSatang(Number(ip.fixedAmount)||0) })
                break
            }
          })

          if (items.length && Math.abs(itemTotalSatang - totalSatang) > 100) {
            warnings.push({ code: 'ITEM_TOTAL_MISMATCH', msg: `ยอดรายการ ${fmt(fromSatang(itemTotalSatang))} ไม่ตรงกับบิล ${fmt(fromSatang(totalSatang))}` })
          }

          // hybrid: remaining distributed equally among non-itemized
          if (method === 'hybrid') {
            const itemized = toSatang(Object.values(shares).reduce((s,v)=>s+v,0))
            const remaining = totalSatang - itemized
            if (remaining > 0) {
              const eq = shareRecipients.filter(p => !p.shareInput?.mode || p.shareInput?.mode === 'equal')
              if (eq.length) {
                const base = Math.floor(remaining / eq.length)
                const rem  = remaining - base * eq.length
                eq.forEach(p => { shares[p.personId] = (shares[p.personId]||0) + base })
                if (rem && eq[0]) shares[eq[0].personId] += rem
              }
            }
          }
          break
        }
        default:
          shareRecipients.forEach(p => { shares[p.personId] = 0 })
      }

      return shares
    },

    _roundingAssignee(b, recipients) {
      if (!recipients.length) return null
      const mode = b.rounding?.assignTo || 'largestPayer'
      if (mode === 'specificPerson' && b.rounding?.personId) return b.rounding.personId
      if (mode === 'lastPerson') return recipients[recipients.length - 1]?.personId
      if (mode === 'firstPerson') return recipients[0]?.personId
      // largestPayer → first by default (largest is determined by context)
      return recipients[0]?.personId
    },

    _applyAdjustments(b, shares) {
      const result = { ...shares }
      ;(b.participants || []).filter(p => p.included !== false).forEach(p => {
        const adj = p.personalAdjustments || {}
        const delta = toSatang(Number(adj.extraCharge)||0)
                    + toSatang(Number(adj.manualAdd)||0)
                    - toSatang(Number(adj.discount)||0)
                    - toSatang(Number(adj.manualSubtract)||0)
        if (delta) result[p.personId] = (result[p.personId] || 0) + delta
      })
      return result
    },

    _applyShareOverrides(b, shares) {
      const result = { ...shares }
      const overrideApplied = {}
      if (b.overrides?.sharesByPerson && typeof b.overrides.sharesByPerson === 'object') {
        Object.entries(b.overrides.sharesByPerson).forEach(([pid, amt]) => {
          result[pid] = toSatang(Number(amt) || 0)
          overrideApplied[pid] = true
        })
      }
      return { shares: result, overrideApplied }
    },

    _applyRounding(shares, totalSatang) {
      const result = {}
      Object.entries(shares).forEach(([id, s]) => { result[id] = Math.round(s) })
      const sumShares = Object.values(result).reduce((s,v)=>s+v,0)
      return { shares: result, roundingAdjustment: fromSatang(totalSatang - sumShares) }
    },

    _calcPaidAmounts(b) {
      const paid = {}
      ;(b.participants || []).filter(p => p.included !== false).forEach(p => {
        let s = 0
        ;(p.paidInputs || []).forEach(inp => {
          const a = toSatang(Number(inp.amount) || 0)
          s += inp.type === 'refund' ? -a : a
        })
        paid[p.personId] = s
      })
      ;(b.deposits || []).forEach(d => {
        if (!d.personId) return
        const used     = toSatang(Number(d.amountUsedInBill) || 0)
        const refunded = toSatang(Number(d.amountRefunded)   || 0)
        paid[d.personId] = (paid[d.personId] || 0) + Math.max(0, used - refunded)
      })
      return paid
    },

    _generateSettlement(people) {
      const creditors = people.filter(p => p.net >  0.005).map(p => ({ personId: p.personId, amt: Math.round(p.net*100) })).sort((a,b)=>b.amt-a.amt)
      const debtors   = people.filter(p => p.net < -0.005).map(p => ({ personId: p.personId, amt: Math.round(-p.net*100) })).sort((a,b)=>b.amt-a.amt)
      const plan = []
      let ci = 0, di = 0
      while (ci < creditors.length && di < debtors.length) {
        const c = creditors[ci], d = debtors[di]
        const amt = Math.min(c.amt, d.amt)
        if (amt > 0) plan.push({ fromPersonId: d.personId, toPersonId: c.personId, amount: fromSatang(amt), isOverridden: false })
        c.amt -= amt; d.amt -= amt
        if (c.amt <= 0) ci++
        if (d.amt <= 0) di++
      }
      return plan
    },
  }

  // Expose globally so tests can call SplitBillCalc.calculateBill directly
  window.SplitBillCalc = SplitBillCalc

  // ── Wizard State ─────────────────────────────────────────────
  let _draft = null       // current bill being edited
  let _draftStep = 1      // 1-7

  function draftBill() {
    if (!_draft) _draft = normalizeBill({})
    return _draft
  }

  // ══════════════════════════════════════════════════════════════
  //  HOME SCREEN
  // ══════════════════════════════════════════════════════════════
  App.openSplitBillScreen = function () {
    const bills  = SbStore.loadBills()
    const people = SbStore.loadPeople()

    // Compute my net across all bills
    let totalOwes = 0, totalGetsBack = 0
    bills.forEach(b => {
      try {
        const r = SplitBillCalc.calculateBill(b, people)
        r.people.forEach(p => {
          if (p.net < 0) totalOwes    += Math.abs(p.net)
          if (p.net > 0) totalGetsBack += p.net
        })
      } catch(_) {}
    })

    const billCards = bills.map(b => {
      const pCount = (b.participants||[]).filter(p=>p.included!==false).length
      let totalToSplit = 0
      try { totalToSplit = SplitBillCalc._calcTotal(b, []) } catch(_) {}
      return `<div class="card card-pad sb-bill-row" onclick="App.openSplitBillDetail('${esc(b.id)}')">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-size:26px;line-height:1">🧾</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.title)}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">${thaiDate(b.date)} · ${pCount} คน</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-weight:700;color:var(--primary)">${fmt(totalToSplit)}</div>
            <div style="font-size:11px;color:var(--muted)">ยอดรวม</div>
          </div>
        </div>
      </div>`
    }).join('')

    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.closeSubScreen()">←</button>
        <h2>หารบิล</h2>
        <button class="btn btn-primary btn-sm" onclick="App.openSplitBillForm()" style="width:auto">+ เพิ่มบิล</button>
      </div>
      <div class="sub-scroll" style="padding:12px 16px 40px">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
          <div class="card" style="padding:12px;text-align:center">
            <div style="font-size:12px;color:var(--muted)">ต้องจ่ายเพิ่ม</div>
            <div style="font-size:16px;font-weight:800;color:var(--expense);margin-top:2px">${fmt(totalOwes)}</div>
          </div>
          <div class="card" style="padding:12px;text-align:center">
            <div style="font-size:12px;color:var(--muted)">ได้รับคืน</div>
            <div style="font-size:16px;font-weight:800;color:var(--income);margin-top:2px">${fmt(totalGetsBack)}</div>
          </div>
          <div class="card" style="padding:12px;text-align:center">
            <div style="font-size:12px;color:var(--muted)">บิลทั้งหมด</div>
            <div style="font-size:16px;font-weight:800;color:var(--primary);margin-top:2px">${bills.length}</div>
          </div>
        </div>

        <div class="settings-row" onclick="App.openSplitPeopleScreen()" style="margin-bottom:4px">
          <div class="s-icon">👥</div>
          <div class="s-label">จัดการสมาชิก</div>
          <div class="s-value">${SbStore.loadPeople().filter(p=>!p.archived).length} คน</div>
          <div class="s-arrow">›</div>
        </div>

        ${bills.length ? `
          <div class="sec-title" style="margin-top:8px">บิลล่าสุด</div>
          <div style="display:flex;flex-direction:column;gap:8px">${billCards}</div>
        ` : `<div style="text-align:center;padding:40px 0;color:var(--muted)">
          <div style="font-size:36px;margin-bottom:8px">🧾</div>
          <div style="font-weight:700">ยังไม่มีบิล</div>
          <div style="font-size:13px;margin-top:4px">แตะ + เพิ่มบิล เพื่อเริ่ม</div>
        </div>`}
      </div>`)
  }

  // ══════════════════════════════════════════════════════════════
  //  BILL DETAIL
  // ══════════════════════════════════════════════════════════════
  App.openSplitBillDetail = function (billId) {
    const bill   = SbStore.getBill(billId)
    if (!bill) return notify('ไม่พบบิล', 'error')
    const people = SbStore.loadPeople()
    const result = SplitBillCalc.calculateBill(bill, people)

    const personName = pid => {
      const p = people.find(x => x.id === pid)
      return p ? `${p.emoji} ${p.name}` : '?'
    }

    const statusBadge = s => {
      if (s === 'getsBack') return `<span style="color:var(--income);font-weight:700">ได้รับคืน</span>`
      if (s === 'owes')     return `<span style="color:var(--expense);font-weight:700">ต้องจ่ายเพิ่ม</span>`
      return `<span style="color:var(--muted)">เสมอกัน</span>`
    }

    const peopleRows = result.people.map(p => `
      <div class="detail-row">
        <div style="flex:1">
          <div style="font-weight:600">${esc(personName(p.personId))}</div>
          <div style="font-size:12px;color:var(--muted)">ส่วนแบ่ง ${fmt(p.finalShare)} · จ่ายแล้ว ${fmt(p.paidAmount)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700;color:${p.net>0?'var(--income)':p.net<0?'var(--expense)':'var(--muted)'}">${p.net>0?'+':''}${fmt(Math.abs(p.net))}</div>
          <div style="font-size:11px">${statusBadge(p.status)}${p.isOverridden?' <span class="sb-override-badge">แก้เอง</span>':''}</div>
        </div>
      </div>`).join('')

    const settlementRows = result.settlementPlan.length
      ? result.settlementPlan.map(t => `
        <div class="detail-row">
          <div>${esc(personName(t.fromPersonId))} → ${esc(personName(t.toPersonId))}</div>
          <div style="font-weight:700;color:var(--primary)">${fmt(t.amount)}${t.isOverridden?' <span class="sb-override-badge">แก้เอง</span>':''}</div>
        </div>`).join('')
      : `<div style="color:var(--muted);font-size:13px;padding:8px 0">ไม่มีรายการโอน</div>`

    const warnHtml = result.warnings.length
      ? `<div style="background:var(--elevated);border-radius:8px;padding:10px 12px;margin-bottom:12px">
          ${result.warnings.map(w=>`<div style="font-size:13px;color:var(--expense)">⚠️ ${esc(w.msg)}</div>`).join('')}
        </div>` : ''

    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openSplitBillScreen()">←</button>
        <h2 style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(bill.title)}</h2>
        <button class="btn btn-secondary btn-sm" onclick="App.openSplitBillForm('${esc(billId)}')" style="width:auto">✏️</button>
      </div>
      <div class="sub-scroll" style="padding:12px 16px 40px">
        <div style="display:flex;gap:8px;font-size:13px;color:var(--muted);margin-bottom:8px">
          <span>📅 ${thaiDate(bill.date)}</span>
          ${bill.note?`<span>· ${esc(bill.note)}</span>`:''}
        </div>

        <div class="card" style="padding:14px;margin-bottom:12px">
          <div style="font-size:13px;color:var(--muted)">ยอดรวม</div>
          <div style="font-size:24px;font-weight:800;color:var(--primary)">${fmt(result.totalToSplit)}</div>
          ${result.roundingAdjustment ? `<div style="font-size:11px;color:var(--muted)">ปัดเศษ ${result.roundingAdjustment>0?'+':''}${result.roundingAdjustment}</div>` : ''}
        </div>

        ${warnHtml}

        <div class="sec-title">สรุปต่อคน</div>
        <div class="card card-pad">${peopleRows || '<div style="color:var(--muted);padding:8px">ไม่มีผู้เข้าร่วม</div>'}</div>

        <div class="sec-title">แผนการโอนเงิน</div>
        <div class="card card-pad">${settlementRows}</div>

        <div style="display:flex;gap:8px;margin-top:20px">
          <button class="btn btn-secondary flex-1" onclick="App.openSplitBillForm('${esc(billId)}')">✏️ แก้ไข</button>
          <button class="btn btn-secondary flex-1" onclick="App._sbDuplicate('${esc(billId)}')">⧉ ทำซ้ำ</button>
          <button class="btn btn-outline flex-1" onclick="App._sbDelete('${esc(billId)}')">🗑 ลบ</button>
        </div>
      </div>`)
  }

  App._sbDuplicate = function (billId) {
    const bill = SbStore.getBill(billId)
    if (!bill) return
    const copy = { ...JSON.parse(JSON.stringify(bill)), id: genId(), title: bill.title + ' (สำเนา)', createdAt: nowISO(), updatedAt: nowISO() }
    SbStore.upsertBill(copy)
    notify('ทำสำเนาบิลแล้ว', 'success')
    App.openSplitBillDetail(copy.id)
  }

  App._sbDelete = function (billId) {
    const bill = SbStore.getBill(billId)
    if (!bill) return
    App.showConfirm?.({
      title: 'ลบบิล', danger: true, confirmLabel: 'ลบ',
      body: `ลบบิล "${bill.title}"? ไม่สามารถกู้คืนได้`,
      onConfirm() {
        SbStore.deleteBill(billId)
        notify('ลบบิลแล้ว', 'success')
        App.openSplitBillScreen()
      }
    }) || (() => {
      if (!confirm(`ลบบิล "${bill.title}"?`)) return
      SbStore.deleteBill(billId)
      notify('ลบบิลแล้ว', 'success')
      App.openSplitBillScreen()
    })()
  }

  // ══════════════════════════════════════════════════════════════
  //  PEOPLE MANAGEMENT
  // ══════════════════════════════════════════════════════════════
  App.openSplitPeopleScreen = function (showArchived = false) {
    const people = SbStore.loadPeople().filter(p => showArchived ? p.archived : !p.archived)
    const rows = people.map(p => `
      <div class="settings-row" onclick="App.openSplitPersonForm('${esc(p.id)}')">
        <div class="s-icon" style="background:${esc(p.color)}22;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center">${esc(p.emoji)}</div>
        <div class="s-label">${esc(p.name)}${p.note?`<br><small style="color:var(--muted);font-weight:400">${esc(p.note)}</small>`:''}</div>
        <div class="s-arrow">›</div>
      </div>`).join('')

    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openSplitBillScreen()">←</button>
        <h2>สมาชิก</h2>
        <button class="btn btn-primary btn-sm" onclick="App.openSplitPersonForm()" style="width:auto">+ เพิ่ม</button>
      </div>
      <div class="sub-scroll" style="padding:12px 16px 40px">
        <div class="chips" style="padding:0 0 12px">
          <button class="chip ${showArchived?'':'active'}" onclick="App.openSplitPeopleScreen(false)">กำลังใช้งาน</button>
          <button class="chip ${showArchived?'active':''}" onclick="App.openSplitPeopleScreen(true)">เก็บถาวร</button>
        </div>
        ${rows.length
          ? `<div class="card card-pad">${rows}</div>`
          : `<div style="text-align:center;padding:32px 0;color:var(--muted)">
              <div style="font-size:32px">👥</div>
              <div style="margin-top:8px">${showArchived?'ยังไม่มีสมาชิกที่เก็บถาวร':'ยังไม่มีสมาชิก'}</div>
            </div>`}
      </div>`)
  }

  App.openSplitPersonForm = function (personId = '') {
    const existing = personId ? SbStore.getPerson(personId) : null
    const p = normalizePerson(existing || {})

    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openSplitPeopleScreen()">←</button>
        <h2>${existing ? 'แก้ไขสมาชิก' : 'เพิ่มสมาชิก'}</h2>
        <button class="btn btn-primary btn-sm" onclick="App._sbSavePerson('${esc(personId)}')" style="width:auto">บันทึก</button>
      </div>
      <div class="sub-scroll" style="padding:12px 16px 40px">
        <div class="form-group">
          <label class="form-label">ชื่อ</label>
          <input class="form-input" id="sbp-name" value="${esc(p.name)}" placeholder="ชื่อสมาชิก">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="form-group">
            <label class="form-label">Emoji</label>
            <input class="form-input" id="sbp-emoji" value="${esc(p.emoji)}" maxlength="4" style="font-size:22px;text-align:center">
          </div>
          <div class="form-group">
            <label class="form-label">สี</label>
            <input class="form-input" type="color" id="sbp-color" value="${esc(p.color)}" style="height:42px;padding:4px 8px;cursor:pointer">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">หมายเหตุ</label>
          <input class="form-input" id="sbp-note" value="${esc(p.note)}" placeholder="(ไม่บังคับ)">
        </div>
        ${existing ? `
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-secondary flex-1" onclick="App._sbArchivePerson('${esc(personId)}')">
              ${p.archived ? '♻️ คืนสถานะ' : '📦 เก็บถาวร'}
            </button>
            <button class="btn btn-outline flex-1" onclick="App._sbDeletePerson('${esc(personId)}')">🗑 ลบ</button>
          </div>` : ''}
      </div>`)
  }

  App._sbSavePerson = function (personId = '') {
    const name  = document.getElementById('sbp-name')?.value.trim()
    const emoji = document.getElementById('sbp-emoji')?.value.trim() || '👤'
    const color = document.getElementById('sbp-color')?.value || '#2563EB'
    const note  = document.getElementById('sbp-note')?.value.trim() || ''
    if (!name) return notify('กรุณากรอกชื่อสมาชิก', 'error')
    const existing = personId ? SbStore.getPerson(personId) : null
    const person = normalizePerson({ ...(existing||{}), id: personId || undefined, name, emoji, color, note, updatedAt: nowISO() })
    SbStore.upsertPerson(person)
    notify(existing ? 'แก้ไขสมาชิกแล้ว' : 'เพิ่มสมาชิกแล้ว', 'success')
    App.openSplitPeopleScreen()
  }

  App._sbArchivePerson = function (personId) {
    const p = SbStore.getPerson(personId)
    if (!p) return
    p.archived = !p.archived
    p.updatedAt = nowISO()
    SbStore.upsertPerson(p)
    notify(p.archived ? 'เก็บถาวรแล้ว' : 'คืนสถานะแล้ว', 'success')
    App.openSplitPeopleScreen(p.archived)
  }

  App._sbDeletePerson = function (personId) {
    const p = SbStore.getPerson(personId)
    if (!p) return
    App.showConfirm?.({
      title: 'ลบสมาชิก', danger: true, confirmLabel: 'ลบ',
      body: `ลบ "${p.name}"? บิลเก่าที่มีสมาชิกนี้จะยังแสดงชื่อได้`,
      onConfirm() { SbStore.deletePerson(personId); notify('ลบสมาชิกแล้ว', 'success'); App.openSplitPeopleScreen() }
    }) || (() => {
      if (!confirm(`ลบ "${p.name}"?`)) return
      SbStore.deletePerson(personId)
      notify('ลบสมาชิกแล้ว', 'success')
      App.openSplitPeopleScreen()
    })()
  }

  // ══════════════════════════════════════════════════════════════
  //  BILL WIZARD — multi-step form
  // ══════════════════════════════════════════════════════════════

  App.openSplitBillForm = function (billId = '') {
    const existing = billId ? SbStore.getBill(billId) : null
    _draft = normalizeBill(existing ? JSON.parse(JSON.stringify(existing)) : {})
    _draftStep = 1
    App._sbRenderStep()
  }

  App._sbRenderStep = function () {
    switch (_draftStep) {
      case 1: return _sbStep1()
      case 2: return _sbStep2()
      case 3: return _sbStep3()
      case 4: return _sbStep4()
      case 5: return _sbStep5()
      case 6: return _sbStep6()
      case 7: return _sbStep7()
      default: return _sbStep1()
    }
  }

  const _sbStepHeader = (title, showBack = true, backFn = "App._sbPrev()") => `
    <div class="sub-header">
      ${showBack ? `<button class="btn-icon" onclick="${backFn}">←</button>` : ''}
      <h2 style="flex:1">${title}</h2>
    </div>
    <div style="display:flex;gap:4px;padding:6px 16px 0">
      ${[1,2,3,4,5,6,7].map(n=>`<div style="flex:1;height:3px;border-radius:2px;background:${_draftStep>=n?'var(--primary)':'var(--border)'}"></div>`).join('')}
    </div>`

  const _sbNav = (prevFn, nextLabel, nextFn) => `
    <div style="display:flex;gap:8px;padding:12px 0 0">
      ${prevFn ? `<button class="btn btn-secondary" onclick="${prevFn}" style="width:auto;padding:0 20px">←</button>` : ''}
      <button class="btn btn-primary" onclick="${nextFn}" style="flex:1">${nextLabel}</button>
    </div>`

  // ── Step 1: Basic info + total mode ──────────────────────────
  function _sbStep1() {
    const d = _draft
    App.openSubScreen(`
      ${_sbStepHeader('ข้อมูลบิล', true, 'App.openSplitBillScreen()')}
      <div class="sub-scroll" style="padding:12px 16px 40px">
        <div class="sec-title">ข้อมูลพื้นฐาน</div>
        <div class="form-group">
          <label class="form-label">ชื่อบิล</label>
          <input class="form-input" id="sb1-title" value="${esc(d.title)}" placeholder="เช่น ข้าวเย็นกลุ่ม">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="form-group">
            <label class="form-label">วันที่</label>
            <input class="form-input" type="date" id="sb1-date" value="${esc(d.date)}">
          </div>
          <div class="form-group">
            <label class="form-label">หมายเหตุ</label>
            <input class="form-input" id="sb1-note" value="${esc(d.note)}" placeholder="(ไม่บังคับ)">
          </div>
        </div>

        <div class="sec-title">ยอดรวม</div>
        <div class="chips" style="padding:0 0 12px">
          <button class="chip ${d.totalMode==='manual'?'active':''}" onclick="App._sbSetTotalMode('manual')">กรอกเอง</button>
          <button class="chip ${d.totalMode==='breakdown'?'active':''}" onclick="App._sbSetTotalMode('breakdown')">คำนวณจากรายละเอียด</button>
        </div>
        <div id="sb1-manual" style="${d.totalMode!=='manual'?'display:none':''}">
          <div class="form-group">
            <label class="form-label">ยอดรวมบิล (฿)</label>
            <input class="form-input" type="number" inputmode="decimal" id="sb1-total" value="${d.manualTotal||''}" placeholder="0" style="font-size:20px;font-weight:700">
          </div>
        </div>
        <div id="sb1-breakdown-preview" style="${d.totalMode!=='breakdown'?'display:none':''}">
          <div class="form-group">
            <label class="form-label">ยอดก่อนบวกค่าอื่น (฿)</label>
            <input class="form-input" type="number" inputmode="decimal" id="sb1-base" value="${d.breakdown?.baseAmount||''}" placeholder="0">
          </div>
          <div style="font-size:13px;color:var(--muted)">กำหนดรายละเอียดเพิ่มเติมในขั้นตอนถัดไป</div>
        </div>
        ${_sbNav(null, 'ถัดไป: เงินมัดจำ →', "App._sbNext(1)")}
      </div>`)
  }

  App._sbSetTotalMode = function (mode) {
    _draft.totalMode = mode
    document.getElementById('sb1-manual')?.style.setProperty('display', mode==='manual'?'':'none')
    document.getElementById('sb1-breakdown-preview')?.style.setProperty('display', mode==='breakdown'?'':'none')
    document.querySelectorAll('#sub-screen .chips .chip').forEach(btn => {
      btn.classList.toggle('active', btn.textContent.includes(mode==='manual'?'กรอกเอง':'คำนวณ'))
    })
  }

  App._sbNext = function (fromStep) {
    if (fromStep === 1) {
      _draft.title = document.getElementById('sb1-title')?.value.trim() || 'บิลใหม่'
      _draft.date  = document.getElementById('sb1-date')?.value  || todayStr()
      _draft.note  = document.getElementById('sb1-note')?.value.trim() || ''
      if (_draft.totalMode === 'manual') {
        _draft.manualTotal = Number(document.getElementById('sb1-total')?.value) || 0
        if (!(_draft.manualTotal > 0)) return notify('กรุณากรอกยอดรวมมากกว่า 0', 'error')
      } else {
        _draft.breakdown.baseAmount = Number(document.getElementById('sb1-base')?.value) || 0
        if (!(_draft.breakdown.baseAmount > 0)) return notify('กรุณากรอกยอดก่อนบวกค่าอื่นมากกว่า 0', 'error')
      }
      _draftStep = _draft.totalMode === 'breakdown' ? 2 : 3
    }
    App._sbRenderStep()
  }

  App._sbPrev = function () {
    if (_draftStep <= 1) return App.openSplitBillScreen()
    if (_draftStep === 3 && _draft.totalMode === 'manual') { _draftStep = 1 }
    else if (_draftStep > 1) { _draftStep-- }
    App._sbRenderStep()
  }

  // ── Step 2: Breakdown details (only if breakdown mode) ────────
  function _sbStep2() {
    const br = _draft.breakdown
    App.openSubScreen(`
      ${_sbStepHeader('รายละเอียดบิล')}
      <div class="sub-scroll" style="padding:12px 16px 40px">
        <div class="sec-title">ค่าธรรมเนียมและส่วนลด</div>
        <div class="card card-pad" style="display:flex;flex-direction:column;gap:10px">

          <!-- Service charge -->
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <span style="font-weight:600">Service Charge</span>
              <label class="toggle-wrap" style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <span style="font-size:12px;color:var(--muted)">เปิด</span>
                <button class="toggle${br.service.enabled?' on':''}" id="sb2-svc-toggle" onclick="App._sbToggleBreakdown('service')" aria-label="service"></button>
              </label>
            </div>
            <div id="sb2-svc-inputs" style="${br.service.enabled?'':'display:none'}">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <div class="form-group" style="margin:0">
                  <label class="form-label">ประเภท</label>
                  <select class="form-input" id="sb2-svc-type">
                    <option value="percent" ${br.service.type==='percent'?'selected':''}>เปอร์เซ็นต์ (%)</option>
                    <option value="fixed"   ${br.service.type==='fixed'?'selected':''}>จำนวนเงิน (฿)</option>
                  </select>
                </div>
                <div class="form-group" style="margin:0">
                  <label class="form-label" id="sb2-svc-lbl">${br.service.type==='percent'?'% Service':'฿ Service'}</label>
                  <input class="form-input" type="number" inputmode="decimal" id="sb2-svc-val" value="${br.service.value||10}">
                </div>
              </div>
            </div>
          </div>

          <!-- VAT -->
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <span style="font-weight:600">VAT (ภาษีมูลค่าเพิ่ม)</span>
              <button class="toggle${br.vat.enabled?' on':''}" id="sb2-vat-toggle" onclick="App._sbToggleBreakdown('vat')" aria-label="vat"></button>
            </div>
            <div id="sb2-vat-inputs" style="${br.vat.enabled?'':'display:none'}">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <div class="form-group" style="margin:0">
                  <label class="form-label">คิดจาก</label>
                  <select class="form-input" id="sb2-vat-base">
                    <option value="base"         ${br.vat.base==='base'?'selected':''}>ยอดก่อน service</option>
                    <option value="afterService" ${br.vat.base==='afterService'?'selected':''}>ยอดหลัง service</option>
                  </select>
                </div>
                <div class="form-group" style="margin:0">
                  <label class="form-label">VAT (%)</label>
                  <input class="form-input" type="number" inputmode="decimal" id="sb2-vat-val" value="${br.vat.value||7}">
                </div>
              </div>
            </div>
          </div>

          <!-- Tip -->
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <span style="font-weight:600">ทิป (Tip)</span>
              <button class="toggle${br.tip.enabled?' on':''}" id="sb2-tip-toggle" onclick="App._sbToggleBreakdown('tip')" aria-label="tip"></button>
            </div>
            <div id="sb2-tip-inputs" style="${br.tip.enabled?'':'display:none'}">
              <div class="form-group" style="margin:0">
                <label class="form-label">จำนวนทิป (฿)</label>
                <input class="form-input" type="number" inputmode="decimal" id="sb2-tip-val" value="${br.tip.amount||''}">
              </div>
            </div>
          </div>

          <!-- Discount -->
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <span style="font-weight:600">ส่วนลด</span>
              <button class="toggle${br.discount.enabled?' on':''}" id="sb2-disc-toggle" onclick="App._sbToggleBreakdown('discount')" aria-label="discount"></button>
            </div>
            <div id="sb2-disc-inputs" style="${br.discount.enabled?'':'display:none'}">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <div class="form-group" style="margin:0">
                  <label class="form-label">ประเภท</label>
                  <select class="form-input" id="sb2-disc-type">
                    <option value="fixed"   ${br.discount.type==='fixed'?'selected':''}>จำนวนเงิน (฿)</option>
                    <option value="percent" ${br.discount.type==='percent'?'selected':''}>เปอร์เซ็นต์ (%)</option>
                  </select>
                </div>
                <div class="form-group" style="margin:0">
                  <label class="form-label">ส่วนลด</label>
                  <input class="form-input" type="number" inputmode="decimal" id="sb2-disc-val" value="${br.discount.value||''}">
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="card" id="sb2-preview" style="padding:12px;margin-top:10px;text-align:center">
          <div style="font-size:12px;color:var(--muted)">ยอดประมาณ</div>
          <div style="font-size:20px;font-weight:800;color:var(--primary)" id="sb2-total-preview">...</div>
        </div>

        ${_sbNav("App._sbPrev()", 'ถัดไป: เงินมัดจำ →', "App._sbSaveStep2()")}
      </div>`)
    App._sbUpdateBreakdownPreview()
  }

  App._sbToggleBreakdown = function (field) {
    const toggle = document.getElementById(`sb2-${field==='service'?'svc':field==='discount'?'disc':field}-toggle`)
    const inputs = document.getElementById(`sb2-${field==='service'?'svc':field==='discount'?'disc':field}-inputs`)
    if (toggle && inputs) {
      const on = !toggle.classList.contains('on')
      toggle.classList.toggle('on', on)
      inputs.style.display = on ? '' : 'none'
    }
    App._sbUpdateBreakdownPreview()
  }

  App._sbUpdateBreakdownPreview = function () {
    const base = _draft.breakdown.baseAmount
    const svcOn  = document.getElementById('sb2-svc-toggle')?.classList.contains('on')
    const vatOn  = document.getElementById('sb2-vat-toggle')?.classList.contains('on')
    const tipOn  = document.getElementById('sb2-tip-toggle')?.classList.contains('on')
    const discOn = document.getElementById('sb2-disc-toggle')?.classList.contains('on')

    const svcType = document.getElementById('sb2-svc-type')?.value || 'percent'
    const svcVal  = Number(document.getElementById('sb2-svc-val')?.value) || 0
    const vatBase = document.getElementById('sb2-vat-base')?.value || 'base'
    const vatVal  = Number(document.getElementById('sb2-vat-val')?.value) || 0
    const tipVal  = Number(document.getElementById('sb2-tip-val')?.value) || 0
    const discType = document.getElementById('sb2-disc-type')?.value || 'fixed'
    const discVal  = Number(document.getElementById('sb2-disc-val')?.value) || 0

    let svc = svcOn ? (svcType==='percent' ? base*svcVal/100 : svcVal) : 0
    let vb  = vatBase==='afterService' ? base+svc : base
    let vat = vatOn ? vatVal/100*vb : 0
    let tip = tipOn ? tipVal : 0
    let disc = discOn ? (discType==='percent' ? base*discVal/100 : discVal) : 0

    const total = Math.max(0, base+svc+vat+tip-disc)
    const el = document.getElementById('sb2-total-preview')
    if (el) el.textContent = fmt(total)
  }

  App._sbSaveStep2 = function () {
    const br = _draft.breakdown
    br.service.enabled = document.getElementById('sb2-svc-toggle')?.classList.contains('on') || false
    br.service.type    = document.getElementById('sb2-svc-type')?.value || 'percent'
    br.service.value   = Number(document.getElementById('sb2-svc-val')?.value) || 0
    br.vat.enabled     = document.getElementById('sb2-vat-toggle')?.classList.contains('on') || false
    br.vat.base        = document.getElementById('sb2-vat-base')?.value || 'base'
    br.vat.value       = Number(document.getElementById('sb2-vat-val')?.value) || 0
    br.tip.enabled     = document.getElementById('sb2-tip-toggle')?.classList.contains('on') || false
    br.tip.amount      = Number(document.getElementById('sb2-tip-val')?.value) || 0
    br.discount.enabled = document.getElementById('sb2-disc-toggle')?.classList.contains('on') || false
    br.discount.type    = document.getElementById('sb2-disc-type')?.value || 'fixed'
    br.discount.value   = Number(document.getElementById('sb2-disc-val')?.value) || 0
    _draftStep = 3
    App._sbRenderStep()
  }

  // ── Step 3: Deposits ────────────────────────────────────────
  function _sbStep3() {
    const people  = SbStore.loadPeople().filter(p => !p.archived)
    const deposits = _draft.deposits || []

    const depRows = deposits.map((dep, i) => {
      const person = people.find(p => p.id === dep.personId) || { name: '?', emoji: '👤' }
      return `<div class="card card-pad" style="margin-bottom:6px" id="sb-dep-${i}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span>${esc(person.emoji)} ${esc(person.name)}</span>
          <button class="btn-icon" style="margin-left:auto" onclick="App._sbRemoveDeposit(${i})">🗑</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div class="form-group" style="margin:0">
            <label class="form-label">มัดจำทั้งหมด (฿)</label>
            <input class="form-input" type="number" inputmode="decimal" id="dep-paid-${i}" value="${dep.amountPaid||''}">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">ใช้ในบิลนี้ (฿)</label>
            <input class="form-input" type="number" inputmode="decimal" id="dep-used-${i}" value="${dep.amountUsedInBill||''}">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">
          <div class="form-group" style="margin:0">
            <label class="form-label">คืนเงิน (฿)</label>
            <input class="form-input" type="number" inputmode="decimal" id="dep-refund-${i}" value="${dep.amountRefunded||''}">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">ช่วงเวลา</label>
            <select class="form-input" id="dep-timing-${i}">
              <option value="afterFees"  ${dep.timing==='afterFees'?'selected':''}>หลังคิดค่าธรรมเนียม</option>
              <option value="beforeFees" ${dep.timing==='beforeFees'?'selected':''}>ก่อนคิดค่าธรรมเนียม</option>
              <option value="manual"     ${dep.timing==='manual'?'selected':''}>กำหนดเอง</option>
            </select>
          </div>
        </div>
      </div>`
    }).join('')

    const personOptions = people.map(p =>
      `<option value="${esc(p.id)}">${esc(p.emoji)} ${esc(p.name)}</option>`
    ).join('')

    App.openSubScreen(`
      ${_sbStepHeader('เงินมัดจำ')}
      <div class="sub-scroll" style="padding:12px 16px 40px">
        <div style="font-size:13px;color:var(--muted);margin-bottom:10px">
          เงินมัดจำ = เงินที่จ่ายล่วงหน้าเพื่อจองโต๊ะหรือบริการ จะนับเป็นยอดที่จ่ายแล้วของบุคคลนั้น
        </div>
        ${depRows}
        ${people.length ? `
          <div class="card card-pad" style="margin-bottom:8px">
            <div style="font-weight:600;margin-bottom:8px">+ เพิ่มเงินมัดจำ</div>
            <div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:end">
              <div class="form-group" style="margin:0">
                <label class="form-label">สมาชิก</label>
                <select class="form-input" id="sb3-new-person">${personOptions}</select>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="App._sbAddDeposit()" style="width:auto;padding:0 16px;height:42px">+ เพิ่ม</button>
            </div>
          </div>` : `<div style="color:var(--muted);font-size:13px">ยังไม่มีสมาชิก — ไปที่ "จัดการสมาชิก" ก่อน</div>`}
        ${_sbNav("App._sbPrev()", 'ถัดไป: สมาชิก →', "App._sbSaveStep3()")}
      </div>`)
  }

  App._sbAddDeposit = function () {
    App._sbSaveStep3(true)
    const personId = document.getElementById('sb3-new-person')?.value
    if (!personId) return
    _draft.deposits.push({ id: genId(), personId, amountPaid: 0, amountUsedInBill: 0, amountRefunded: 0, timing: 'afterFees', note: '' })
    _sbStep3()
  }

  App._sbRemoveDeposit = function (idx) {
    App._sbSaveStep3(true)
    _draft.deposits.splice(idx, 1)
    _sbStep3()
  }

  App._sbSaveStep3 = function (quiet = false) {
    ;(_draft.deposits || []).forEach((dep, i) => {
      dep.amountPaid       = Number(document.getElementById(`dep-paid-${i}`)?.value) || 0
      dep.amountUsedInBill = Number(document.getElementById(`dep-used-${i}`)?.value) || 0
      dep.amountRefunded   = Number(document.getElementById(`dep-refund-${i}`)?.value) || 0
      dep.timing           = document.getElementById(`dep-timing-${i}`)?.value || 'afterFees'
    })
    if (!quiet) { _draftStep = 4; App._sbRenderStep() }
  }

  // ── Step 4: People + roles ───────────────────────────────────
  function _sbStep4() {
    const people = SbStore.loadPeople().filter(p => !p.archived)
    const parts  = _draft.participants

    const roleOptions = role => ['participant','payerOnly','guestOnly','excluded','custom'].map(r =>
      `<option value="${r}" ${role===r?'selected':''}>${{
        participant:'ผู้เข้าร่วม',payerOnly:'ผู้จ่ายเท่านั้น',guestOnly:'แขกรับเชิญ (ไม่ร่วมจ่าย)',excluded:'ยกเว้น',custom:'กำหนดเอง'
      }[r]}</option>`
    ).join('')

    const rows = people.map(p => {
      const part = parts.find(x => x.personId === p.id)
      const included = part?.included !== false
      return `<div class="detail-row" style="align-items:center">
        <div style="display:flex;align-items:center;gap:8px;flex:1">
          <input type="checkbox" id="sbp-chk-${esc(p.id)}" ${included?'checked':''} onchange="App._sbToggleParticipant('${esc(p.id)}', this.checked)" style="width:18px;height:18px;cursor:pointer;accent-color:var(--primary)">
          <span style="font-size:16px">${esc(p.emoji)}</span>
          <span style="font-weight:600">${esc(p.name)}</span>
        </div>
        <select class="form-input" id="sbp-role-${esc(p.id)}" style="width:auto;font-size:12px;padding:4px 8px" ${included?'':'disabled'}>
          ${roleOptions(part?.role || 'participant')}
        </select>
      </div>`
    }).join('')

    App.openSubScreen(`
      ${_sbStepHeader('เลือกสมาชิก')}
      <div class="sub-scroll" style="padding:12px 16px 40px">
        ${people.length
          ? `<div class="card card-pad">${rows}</div>`
          : `<div style="text-align:center;padding:24px;color:var(--muted)">
              <div>ยังไม่มีสมาชิกในระบบ</div>
              <button class="btn btn-secondary" style="margin-top:10px" onclick="App.openSplitPeopleScreen()">จัดการสมาชิก</button>
            </div>`}
        <div style="margin-top:8px">
          <button class="btn btn-secondary btn-sm" onclick="App.openSplitPeopleScreen()" style="width:auto">+ เพิ่มสมาชิกใหม่</button>
        </div>
        ${_sbNav("App._sbPrev()", 'ถัดไป: วิธีหาร →', "App._sbSaveStep4()")}
      </div>`)
  }

  App._sbToggleParticipant = function (personId, checked) {
    const role = document.getElementById(`sbp-role-${personId}`)
    if (role) role.disabled = !checked
  }

  App._sbSaveStep4 = function () {
    const people = SbStore.loadPeople().filter(p => !p.archived)
    _draft.participants = people.map(p => {
      const chk    = document.getElementById(`sbp-chk-${p.id}`)
      const roleEl = document.getElementById(`sbp-role-${p.id}`)
      const existing = _draft.participants.find(x => x.personId === p.id) || {}
      return {
        ...existing,
        personId: p.id,
        included: chk?.checked ?? false,
        role: roleEl?.value || 'participant',
        shareInput: existing.shareInput || { mode: 'equal' },
        paidInputs: existing.paidInputs || [],
        personalAdjustments: existing.personalAdjustments || {},
        note: existing.note || '',
      }
    })
    const hasIncluded = _draft.participants.some(p => p.included)
    if (!hasIncluded) return notify('กรุณาเลือกอย่างน้อย 1 คน', 'error')
    _draftStep = 5
    App._sbRenderStep()
  }

  // ── Step 5: Split method + inputs ─────────────────────────────
  function _sbStep5() {
    const d = _draft
    const method = d.splitMethod || 'equal'
    const included = d.participants.filter(p => p.included && p.role !== 'payerOnly')
    const people = SbStore.loadPeople()
    const pName  = pid => { const p = people.find(x=>x.id===pid); return p?`${p.emoji} ${p.name}`:pid }

    const methodChips = ['equal','shareUnit','percent','fixed','manual','itemized','hybrid'].map(m =>
      `<button class="chip ${method===m?'active':''}" onclick="App._sbSetMethod('${m}')">${{
        equal:'เท่ากัน',shareUnit:'สัดส่วน',percent:'เปอร์เซ็นต์',fixed:'กำหนดจำนวน',manual:'กรอกเอง',itemized:'แยกรายการ',hybrid:'ผสม'
      }[m]}</button>`
    ).join('')

    const methodDesc = {
      equal:'หารเท่าๆ กัน',shareUnit:'หารตามสัดส่วนหน่วย (เช่น 1:1:0.5)',
      percent:'ระบุ % ต่อคน',fixed:'ระบุจำนวนเงินต่อคน',
      manual:'กรอกยอดต่อคนเอง',itemized:'แยกหารตามรายการอาหาร',hybrid:'ผสม: บางรายการแยก บางส่วนหารเท่า'
    }[method] || ''

    // Per-person input fields
    let inputFields = ''
    if (method === 'shareUnit') {
      inputFields = included.map(p => `
        <div class="detail-row">
          <div style="flex:1">${esc(pName(p.personId))}</div>
          <div style="display:flex;align-items:center;gap:6px">
            <input class="form-input" type="number" inputmode="decimal" id="sb5-unit-${esc(p.personId)}" value="${p.shareInput?.unit||1}" style="width:80px;text-align:center">
            <span style="color:var(--muted);font-size:12px">หน่วย</span>
          </div>
        </div>`).join('')
    } else if (method === 'percent') {
      inputFields = included.map(p => `
        <div class="detail-row">
          <div style="flex:1">${esc(pName(p.personId))}</div>
          <div style="display:flex;align-items:center;gap:6px">
            <input class="form-input" type="number" inputmode="decimal" id="sb5-pct-${esc(p.personId)}" value="${p.shareInput?.percent||''}" style="width:80px;text-align:center">
            <span style="color:var(--muted);font-size:12px">%</span>
          </div>
        </div>`).join('')
    } else if (method === 'fixed' || method === 'manual') {
      const key = method === 'fixed' ? 'fixedAmount' : 'manualAmount'
      inputFields = included.map(p => `
        <div class="detail-row">
          <div style="flex:1">${esc(pName(p.personId))}</div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="color:var(--muted)">฿</span>
            <input class="form-input" type="number" inputmode="decimal" id="sb5-amt-${esc(p.personId)}" value="${p.shareInput?.[key]||''}" style="width:100px">
          </div>
        </div>`).join('')
    } else if (method === 'itemized' || method === 'hybrid') {
      const items = d.items || []
      inputFields = `
        <div style="margin-top:4px">
          ${items.map((item, i) => `
            <div class="card card-pad" style="margin-bottom:6px">
              <div style="display:flex;gap:8px;align-items:center">
                <div style="flex:1;font-weight:600">${esc(item.name||'รายการที่'+(i+1))}</div>
                <div style="font-weight:700;color:var(--primary)">${fmt(item.amount)}</div>
                <button class="btn-icon" onclick="App._sbEditItem(${i})">✏️</button>
                <button class="btn-icon" onclick="App._sbDeleteItem(${i})">🗑</button>
              </div>
              <div style="font-size:12px;color:var(--muted);margin-top:4px">
                ${(item.participants||[]).map(ip => pName(ip.personId)).join(', ') || 'ยังไม่ระบุผู้เข้าร่วม'}
                · ${item.splitMode||'equal'}
              </div>
            </div>`).join('')}
          <button class="btn btn-secondary btn-sm" onclick="App._sbAddItem()" style="width:100%">+ เพิ่มรายการ</button>
        </div>`
    } else {
      inputFields = `<div style="color:var(--muted);font-size:13px;padding:8px 0">หารเท่ากัน ${included.length} คน = ${fmt((SplitBillCalc._calcTotal(d,[]) || 0) / (included.length || 1))} ต่อคน</div>`
    }

    App.openSubScreen(`
      ${_sbStepHeader('วิธีหารบิล')}
      <div class="sub-scroll" style="padding:12px 16px 40px">
        <div class="chips" style="flex-wrap:wrap;gap:4px;padding:0 0 8px">${methodChips}</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:12px">${esc(methodDesc)}</div>
        <div class="card card-pad">${inputFields || '<div style="color:var(--muted)">ไม่มีผู้เข้าร่วม</div>'}</div>
        ${_sbNav("App._sbPrev()", 'ถัดไป: ยอดที่จ่าย →', "App._sbSaveStep5()")}
      </div>`)
  }

  App._sbSetMethod = function (method) {
    App._sbSaveStep5(true) // silent save current inputs
    _draft.splitMethod = method
    _sbStep5()
  }

  App._sbSaveStep5 = function (quiet = false) {
    const method  = _draft.splitMethod
    const included = _draft.participants.filter(p => p.included && p.role !== 'payerOnly')
    included.forEach(p => {
      const si = p.shareInput || {}
      if (method === 'shareUnit') si.unit = Number(document.getElementById(`sb5-unit-${p.personId}`)?.value) || 1
      else if (method === 'percent') si.percent = Number(document.getElementById(`sb5-pct-${p.personId}`)?.value) || 0
      else if (method === 'fixed')  si.fixedAmount  = Number(document.getElementById(`sb5-amt-${p.personId}`)?.value) || 0
      else if (method === 'manual') si.manualAmount  = Number(document.getElementById(`sb5-amt-${p.personId}`)?.value) || 0
      si.mode = method
      p.shareInput = si
    })
    if (!quiet) { _draftStep = 6; App._sbRenderStep() }
  }

  // Item management for itemized/hybrid
  App._sbAddItem = function () {
    App._sbSaveStep5(true)
    if (!_draft.items) _draft.items = []
    _draft.items.push({ id: genId(), name: '', amount: 0, splitMode: 'equal', participants: [], taxable: true, serviceable: true, discountAmount: 0, note: '' })
    App._sbEditItem(_draft.items.length - 1)
  }

  App._sbEditItem = function (idx) {
    const item = (_draft.items || [])[idx]
    if (!item) return
    const included = _draft.participants.filter(p => p.included)
    const people   = SbStore.loadPeople()
    const pName    = pid => { const p = people.find(x=>x.id===pid); return p?`${p.emoji} ${p.name}`:pid }

    const pChecks = included.map(p => {
      const ip = (item.participants||[]).find(x=>x.personId===p.personId)
      return `<div style="display:flex;align-items:center;gap:6px;padding:6px 0">
        <input type="checkbox" id="sbitem-chk-${esc(p.personId)}" ${ip?'checked':''} style="width:16px;height:16px;accent-color:var(--primary)">
        <span>${esc(pName(p.personId))}</span>
      </div>`
    }).join('')

    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App._sbRenderStep()">←</button>
        <h2>${item.name || 'รายการที่'+(idx+1)}</h2>
        <button class="btn btn-primary btn-sm" onclick="App._sbSaveItem(${idx})" style="width:auto">ตกลง</button>
      </div>
      <div class="sub-scroll" style="padding:12px 16px 40px">
        <div class="form-group"><label class="form-label">ชื่อรายการ</label><input class="form-input" id="sbitem-name" value="${esc(item.name)}" placeholder="เช่น ผัดไทย"></div>
        <div class="form-group"><label class="form-label">ราคา (฿)</label><input class="form-input" type="number" inputmode="decimal" id="sbitem-amount" value="${item.amount||''}"></div>
        <div class="form-group">
          <label class="form-label">วิธีแบ่ง</label>
          <select class="form-input" id="sbitem-mode">
            <option value="equal"       ${item.splitMode==='equal'?'selected':''}>เท่ากัน</option>
            <option value="singleOwner" ${item.splitMode==='singleOwner'?'selected':''}>คนเดียวจ่าย</option>
            <option value="shareUnit"   ${item.splitMode==='shareUnit'?'selected':''}>สัดส่วนหน่วย</option>
            <option value="percent"     ${item.splitMode==='percent'?'selected':''}>เปอร์เซ็นต์</option>
            <option value="fixed"       ${item.splitMode==='fixed'?'selected':''}>กำหนดจำนวน</option>
            <option value="exclude"     ${item.splitMode==='exclude'?'selected':''}>ยกเว้น (ไม่นับ)</option>
          </select>
        </div>
        <div class="sec-title">ผู้ร่วมรับผิดชอบ</div>
        <div class="card card-pad">${pChecks || '<div style="color:var(--muted)">ยังไม่มีสมาชิก</div>'}</div>
      </div>`)
  }

  App._sbSaveItem = function (idx) {
    const item = (_draft.items || [])[idx]
    if (!item) return
    item.name      = document.getElementById('sbitem-name')?.value.trim() || ''
    item.amount    = Number(document.getElementById('sbitem-amount')?.value) || 0
    item.splitMode = document.getElementById('sbitem-mode')?.value || 'equal'
    const included = _draft.participants.filter(p => p.included)
    item.participants = included
      .filter(p => document.getElementById(`sbitem-chk-${p.personId}`)?.checked)
      .map(p => ({ personId: p.personId, unit: 1, percent: 0, fixedAmount: 0 }))
    _draftStep = 5
    App._sbRenderStep()
  }

  App._sbDeleteItem = function (idx) {
    App._sbSaveStep5(true)
    _draft.items.splice(idx, 1)
    _draftStep = 5
    App._sbRenderStep()
  }

  // ── Step 6: Paid amounts ──────────────────────────────────────
  function _sbStep6() {
    const d       = _draft
    const people  = SbStore.loadPeople()
    const pName   = pid => { const p = people.find(x=>x.id===pid); return p?`${p.emoji} ${p.name}`:pid }
    const included = d.participants.filter(p => p.included)

    const personPaidHtml = included.map(p => {
      const paid = p.paidInputs || []
      const inputRows = paid.map((inp, i) => `
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
          <select class="form-input" id="sb6-type-${esc(p.personId)}-${i}" style="flex:1;font-size:12px;padding:4px 6px">
            ${['restaurant_payment','cash','transfer','refund','manual'].map(t =>
              `<option value="${t}" ${inp.type===t?'selected':''}>${{
                restaurant_payment:'จ่ายที่ร้าน',cash:'เงินสด',transfer:'โอน',refund:'คืนเงิน',manual:'อื่นๆ'
              }[t]}</option>`
            ).join('')}
          </select>
          <div style="display:flex;align-items:center;gap:2px">
            <span style="color:var(--muted)">฿</span>
            <input class="form-input" type="number" inputmode="decimal" id="sb6-amt-${esc(p.personId)}-${i}" value="${inp.amount||''}" style="width:90px">
          </div>
          <button class="btn-icon" onclick="App._sbRemovePaid('${esc(p.personId)}',${i})">✕</button>
        </div>`).join('')

      return `<div class="card card-pad" style="margin-bottom:8px">
        <div style="font-weight:700;margin-bottom:8px">${esc(pName(p.personId))}</div>
        <div id="sb6-paid-rows-${esc(p.personId)}">${inputRows}</div>
        <button class="btn btn-secondary btn-sm" onclick="App._sbAddPaid('${esc(p.personId)}')" style="width:auto;margin-top:4px">+ เพิ่มรายการจ่าย</button>
      </div>`
    }).join('')

    App.openSubScreen(`
      ${_sbStepHeader('ยอดที่จ่าย')}
      <div class="sub-scroll" style="padding:12px 16px 40px">
        <div style="font-size:13px;color:var(--muted);margin-bottom:10px">
          ระบุว่าแต่ละคนจ่ายอะไรไปบ้างสำหรับบิลนี้ (อาจไม่มีก็ได้ ถ้ายังไม่ได้จ่าย)
        </div>
        ${personPaidHtml}
        ${_sbNav("App._sbPrev()", 'ถัดไป: ตรวจสอบ →', "App._sbSaveStep6()")}
      </div>`)
  }

  App._sbAddPaid = function (personId) {
    App._sbSaveStep6(true)
    const part = _draft.participants.find(p => p.personId === personId)
    if (!part) return
    if (!Array.isArray(part.paidInputs)) part.paidInputs = []
    part.paidInputs.push({ id: genId(), type: 'restaurant_payment', amount: 0, note: '' })
    _sbStep6()
  }

  App._sbRemovePaid = function (personId, idx) {
    App._sbSaveStep6(true)
    const part = _draft.participants.find(p => p.personId === personId)
    if (!part || !Array.isArray(part.paidInputs)) return
    part.paidInputs.splice(idx, 1)
    _sbStep6()
  }

  App._sbSaveStep6 = function (quiet = false) {
    _draft.participants.filter(p => p.included).forEach(p => {
      ;(p.paidInputs || []).forEach((inp, i) => {
        const typeEl = document.getElementById(`sb6-type-${p.personId}-${i}`)
        const amtEl  = document.getElementById(`sb6-amt-${p.personId}-${i}`)
        if (typeEl) inp.type   = typeEl.value
        if (amtEl)  inp.amount = Number(amtEl.value) || 0
      })
    })
    if (!quiet) { _draftStep = 7; App._sbRenderStep() }
  }

  // ── Step 7: Preview + overrides + save ────────────────────────
  function _sbStep7() {
    const d      = _draft
    const people = SbStore.loadPeople()
    const pName  = pid => { const p = people.find(x=>x.id===pid); return p?`${p.emoji} ${p.name}`:pid }
    let result
    try { result = SplitBillCalc.calculateBill(d, people) }
    catch(e) { result = { totalToSplit:0, people:[], settlementPlan:[], warnings:[{code:'ERR',msg:e.message}], roundingAdjustment:0 } }

    const warnHtml = result.warnings.length
      ? `<div style="background:var(--elevated);border-radius:8px;padding:10px 12px;margin-bottom:10px">
          ${result.warnings.map(w=>`<div style="font-size:13px;color:var(--expense)">⚠️ ${esc(w.msg)}</div>`).join('')}
        </div>` : ''

    const peopleRows = result.people.map(p => `
      <div class="detail-row" style="font-size:13px">
        <div style="flex:1">
          <div style="font-weight:600">${esc(pName(p.personId))}</div>
          <div style="color:var(--muted)">ส่วนแบ่ง ${fmt(p.finalShare)}</div>
        </div>
        <div style="text-align:right">
          <div style="color:var(--muted)">จ่าย ${fmt(p.paidAmount)}</div>
          <div style="font-weight:700;color:${p.net>0?'var(--income)':p.net<0?'var(--expense)':'var(--muted)'}">${p.net>0?'ได้คืน':'จ่ายเพิ่ม'} ${fmt(Math.abs(p.net))}${p.isOverridden?' <span class="sb-override-badge">แก้เอง</span>':''}</div>
        </div>
      </div>`).join('')

    const settlRows = result.settlementPlan.length
      ? result.settlementPlan.map(t => `
          <div class="detail-row">
            <div>${esc(pName(t.fromPersonId))} → ${esc(pName(t.toPersonId))}</div>
            <div style="font-weight:700;color:var(--primary)">${fmt(t.amount)}</div>
          </div>`).join('')
      : `<div style="color:var(--muted);font-size:13px;padding:8px 0">ไม่มีรายการโอน (เสมอกัน)</div>`

    // Override section (collapsed by default)
    const ovr = d.overrides || {}
    const shareOverridesHtml = result.people.map(p => `
      <div class="detail-row" style="font-size:13px">
        <div>${esc(pName(p.personId))}</div>
        <div style="display:flex;align-items:center;gap:4px">
          <span style="color:var(--muted)">฿</span>
          <input class="form-input" type="number" inputmode="decimal" id="ovr-share-${esc(p.personId)}"
            value="${ovr.sharesByPerson?.[p.personId] ?? ''}" placeholder="${p.finalShare.toFixed(2)}" style="width:100px">
        </div>
      </div>`).join('')

    App.openSubScreen(`
      ${_sbStepHeader('ตรวจสอบผล')}
      <div class="sub-scroll" style="padding:12px 16px 40px">
        <div class="card" style="padding:14px;margin-bottom:12px;text-align:center">
          <div style="font-size:13px;color:var(--muted)">ยอดรวมบิล</div>
          <div style="font-size:26px;font-weight:800;color:var(--primary)">${fmt(result.totalToSplit)}</div>
        </div>

        ${warnHtml}

        <div class="sec-title">สรุปต่อคน</div>
        <div class="card card-pad">${peopleRows||'<div style="color:var(--muted)">ไม่มีผู้เข้าร่วม</div>'}</div>

        <div class="sec-title">แผนการโอนเงิน</div>
        <div class="card card-pad">${settlRows}</div>

        <!-- Override toggle -->
        <div style="margin-top:12px">
          <button class="btn btn-secondary btn-sm" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'':'none'" style="width:100%">
            ⚙️ แก้ไขส่วนแบ่งด้วยตัวเอง
          </button>
          <div style="display:none;margin-top:10px">
            <div class="sec-title">Override ยอดรวม</div>
            <div class="form-group">
              <label class="form-label">ยอดรวมที่แก้เอง (฿) — เว้นว่างถ้าไม่แก้</label>
              <input class="form-input" type="number" inputmode="decimal" id="ovr-total" value="${ovr.total??''}" placeholder="${result.totalToSplit}">
            </div>
            <div class="sec-title">Override ส่วนแบ่งต่อคน</div>
            <div class="card card-pad">${shareOverridesHtml}</div>
            <button class="btn btn-secondary btn-sm" style="width:100%;margin-top:8px" onclick="App._sbApplyOverrides()">บันทึก Override</button>
            <button class="btn btn-outline btn-sm" style="width:100%;margin-top:6px" onclick="App._sbClearOverrides()">ล้าง Override ทั้งหมด</button>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn btn-secondary" onclick="App._sbPrev()" style="width:auto;padding:0 20px">←</button>
          <button class="btn btn-primary" onclick="App._sbSaveBill()" style="flex:1">💾 บันทึกบิล</button>
        </div>
      </div>`)
  }

  App._sbApplyOverrides = function () {
    if (!_draft.overrides) _draft.overrides = {}
    const totalEl = document.getElementById('ovr-total')
    const totalVal = Number(totalEl?.value)
    _draft.overrides.total = totalEl?.value.trim() ? totalVal : undefined

    const sharesByPerson = {}
    _draft.participants.filter(p=>p.included).forEach(p => {
      const el = document.getElementById(`ovr-share-${p.personId}`)
      if (el?.value.trim()) sharesByPerson[p.personId] = Number(el.value)
    })
    _draft.overrides.sharesByPerson = Object.keys(sharesByPerson).length ? sharesByPerson : undefined
    notify('บันทึก override แล้ว', 'success')
    _sbStep7()
  }

  App._sbClearOverrides = function () {
    _draft.overrides = {}
    notify('ล้าง override แล้ว', 'success')
    _sbStep7()
  }

  App._sbSaveBill = function () {
    if (!_draft) return
    _draft.updatedAt = nowISO()
    if (!_draft.createdAt) _draft.createdAt = nowISO()
    SbStore.upsertBill(_draft)
    notify('บันทึกบิลแล้ว', 'success')
    const id = _draft.id
    _draft = null
    App.openSplitBillDetail(id)
  }

  // ══════════════════════════════════════════════════════════════
  //  CSS INJECTION (Split Bill specific styles)
  // ══════════════════════════════════════════════════════════════
  if (!document.getElementById('sb-styles')) {
    const style = document.createElement('style')
    style.id = 'sb-styles'
    style.textContent = `
      .sb-bill-row { cursor:pointer; transition:opacity .15s; }
      .sb-bill-row:active { opacity:.8; }
      .sb-override-badge {
        display:inline-block; font-size:10px; font-weight:700;
        background:var(--primary); color:#fff;
        padding:1px 5px; border-radius:4px; vertical-align:middle; margin-left:3px;
      }
      .flex-1 { flex:1; }
    `
    document.head.appendChild(style)
  }

  // ══════════════════════════════════════════════════════════════
  //  PATCH renderMore — add หารบิล entry
  // ══════════════════════════════════════════════════════════════
  const _prevRenderMoreSB = App.renderMore?.bind(App)
  App.renderMore = function () {
    _prevRenderMoreSB?.()
    try {
      const content = document.getElementById('more-content')
      if (!content) return
      const inner = content.firstElementChild
      if (!inner) return

      // Don't inject twice
      if (inner.querySelector('.sb-more-section')) return

      const billCount = SbStore.loadBills().length
      const sec = document.createElement('div')
      sec.className = 'sb-more-section'
      sec.innerHTML = `
        <div class="sec-title">คำนวณ</div>
        <div class="card card-pad">
          <div class="settings-row" onclick="App.openSplitBillScreen()">
            <div class="s-icon">🍽️</div>
            <div class="s-label">หารบิล</div>
            ${billCount ? `<div class="s-value">${billCount} บิล</div>` : ''}
            <div class="s-arrow">›</div>
          </div>
        </div>`
      // Insert before first .sec-title
      const firstTitle = inner.querySelector('.sec-title')
      if (firstTitle) inner.insertBefore(sec, firstTitle)
      else inner.appendChild(sec)
    } catch(_) {}
  }

  // ══════════════════════════════════════════════════════════════
  //  EXPORT / IMPORT INTEGRATION
  // ══════════════════════════════════════════════════════════════
  const _prevExportData = App.exportData?.bind(App)
  App.exportData = function () {
    // Patch Storage.buildExportPayload to include split bill data
    const _prevBuild = Storage.buildExportPayload?.bind(Storage)
    if (_prevBuild && Storage.buildExportPayload) {
      Storage.buildExportPayload = function (state) {
        const payload = _prevBuild(state)
        try {
          payload.splitBills  = SbStore.loadBills()
          payload.splitPeople = SbStore.loadPeople()
        } catch(_) {}
        Storage.buildExportPayload = _prevBuild // restore
        return payload
      }
    }
    _prevExportData?.()
  }

  const _prevImportData = App.importData?.bind(App)
  App.importData = function (input) {
    // After import, restore split bill data if present in backup
    const _origImport = App.importData
    App.importData = function (inp) {
      _prevImportData?.(inp)
    }
    // We intercept by wrapping Storage.normalizeBackupPayload
    const _prevNorm = Storage.normalizeBackupPayload?.bind(Storage)
    if (_prevNorm && Storage.normalizeBackupPayload) {
      Storage.normalizeBackupPayload = function (raw) {
        const normalized = _prevNorm(raw)
        if (Array.isArray(raw.splitBills))  { try { SbStore.saveBills(raw.splitBills) } catch(_) {} }
        if (Array.isArray(raw.splitPeople)) { try { SbStore.savePeople(raw.splitPeople) } catch(_) {} }
        Storage.normalizeBackupPayload = _prevNorm // restore
        return normalized
      }
    }
    _prevImportData?.(input)
  }

  // ── Init ──────────────────────────────────────────────────────
  try { if (typeof S !== 'undefined' && S.page === 'more') App.renderMore?.() } catch(_) {}
})()
