/* ============================================================
   Money Tracker — app.js
   Vanilla JS, no build tools, works on file:// and GitHub Pages
   ============================================================ */

// ── State ────────────────────────────────────────────────────
let S = {
  page: 'dashboard',
  transactions: [],
  wallets: [],
  categories: { expense: [], income: [] },
  budgets: [],
  settings: { darkMode: false, accentColor: '#2563EB' },
  recurring: [], merchants: [], ccBenefits: {}, incomeBudgets: [], marketPrices: {}, txMode: 'add', editingTxId: null,

  // Add-transaction flow
  tx: {
    step: 'amount',   // 'amount' | 'detail'
    type: 'expense',
    amount: '0',
    walletId: '',
    toWalletId: '',
    categoryId: '',
    merchant: '',
    note: '',
    date: TODAY,
  },

  // Filters
  txMonth: THIS_MONTH,
  txType: 'all',
  txSearch: '',

  // Reports
  rptMonth: THIS_MONTH,
  rptView: 'expense',

  // Misc
  selectedTxId: null,
  editingWalletId: null,
  payingCardId: null,
  deleteConfirm: false,
}

// ── Persist ──────────────────────────────────────────────────
function persist() { Storage.saveAll(S) }
function moneyFmt(n) { return S.settings?.hideMoney ? '฿••••' : Calc.fmt(n || 0) }

// ── Apply theme ───────────────────────────────────────────────
function applyTheme() {
  document.documentElement.classList.toggle('dark', S.settings.darkMode)
  document.documentElement.style.setProperty('--primary', S.settings.accentColor)
  document.getElementById('meta-theme').setAttribute('content', S.settings.darkMode ? '#0F172A' : '#1E293B')
}

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container')
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.textContent = msg
  el.onclick = () => el.remove()
  c.appendChild(el)
  setTimeout(() => el.remove(), 3000)
}

// ── Overlay helpers ───────────────────────────────────────────
const App = {
  openOverlay(id)  { document.getElementById(id).classList.add('open') },
  closeOverlay(id) {
    document.getElementById(id).classList.remove('open')
    if (id === 'overlay-tx-detail') S.deleteConfirm = false
  },
  openSubScreen(html) {
    const ss = document.getElementById('sub-screen')
    ss.innerHTML = html
    ss.classList.add('open')
  },
  closeSubScreen() {
    document.getElementById('sub-screen').classList.remove('open')
    App.render()
  },
  toggleHideMoney() { S.settings.hideMoney = !S.settings.hideMoney; persist(); App.render() },

  // ── Navigation ────────────────────────────────────────────
  showPage(page) {
    S.page = page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    document.getElementById('page-' + page).classList.add('active')
    document.querySelectorAll('.nav-btn[data-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === page)
    })
    document.getElementById('fab')?.classList.toggle('hidden', page !== 'dashboard')
    App.render()
  },

  render() {
    const renders = {
      dashboard:    App.renderDashboard,
      transactions: App.renderTransactions,
      wallets:      App.renderWallets,
      reports:      App.renderReports,
      more:         App.renderMore,
    }
    renders[S.page]?.()
  },

  // ─────────────────────────────────────────────────────────
  // DASHBOARD
  // ─────────────────────────────────────────────────────────
  renderDashboard() {
    const stats   = Calc.getMonthlyStats(S.transactions, THIS_MONTH)
    const nw      = Calc.getNetWorth(S.wallets)
    const budget  = Calc.getBudgetProgress(S.transactions, S.budgets, S.categories, THIS_MONTH)
    const recent  = [...S.transactions].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 5)
    const savW    = stats.income > 0 ? Math.min(stats.savingsRate, 100) : 0

    // gradient color from primary
    const grad = `linear-gradient(135deg, ${S.settings.accentColor}, ${S.settings.accentColor}CC)`

    let html = `
      <!-- Header -->
      <div class="grad-header" style="background:${grad};color:#fff;border-radius:0 0 24px 24px;margin-bottom:16px">
        <div style="font-size:13px;opacity:.75;margin-bottom:12px">${Calc.monthLabel(THIS_MONTH)}</div>
        <div class="grad-stats">
          <div class="grad-stat">
            <div class="grad-s-label">รายรับ</div>
            <div class="grad-s-value">${Calc.fmt(stats.income)}</div>
          </div>
          <div class="grad-stat">
            <div class="grad-s-label">รายจ่าย</div>
            <div class="grad-s-value">${Calc.fmt(stats.expense)}</div>
          </div>
          <div class="grad-stat">
            <div class="grad-s-label">คงเหลือ</div>
            <div class="grad-s-value">${Calc.fmt(stats.net)}</div>
          </div>
        </div>
        <div class="savings-bar"><div class="savings-fill" style="width:${savW}%"></div></div>
        <div class="savings-text">อัตราการออม ${stats.savingsRate.toFixed(1)}%</div>
      </div>

      <!-- Net worth -->
      <div class="card card-pad nw-card" style="margin-bottom:12px">
        <div class="nw-label">ความมั่งคั่งสุทธิ</div>
        <div class="nw-value ${nw.net >= 0 ? 'c-income' : 'c-expense'}">${nw.net >= 0 ? '' : '-'}${Calc.fmt(Math.abs(nw.net))}</div>
        <div class="nw-detail">
          <span class="nw-item">สินทรัพย์ <strong class="c-income">${Calc.fmt(nw.assets)}</strong></span>
          <span class="nw-item">หนี้สิน <strong class="c-expense">${Calc.fmt(nw.debt)}</strong></span>
        </div>
      </div>`

    // Budget overview
    if (budget.length) {
      html += `<div class="card card-pad" style="margin-bottom:12px">
        <div style="font-size:14px;font-weight:700;margin-bottom:12px">งบประมาณเดือนนี้</div>`
      budget.slice(0, 3).forEach(b => {
        const barColor = b.over ? 'var(--expense)' : b.pct > 80 ? 'var(--amber)' : 'var(--income)'
        html += `<div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;margin-bottom:5px;font-size:13px">
            <span>${b.icon} ${b.label}</span>
            <span style="color:${b.over ? 'var(--expense)' : 'var(--muted)'}">${Calc.fmt(b.spent)} / ${Calc.fmt(b.monthlyLimit)}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${b.pct}%;background:${barColor}"></div></div>
        </div>`
      })
      html += `</div>`
    }

    // Recent transactions
    html += `<div class="card" style="margin-bottom:20px">
      <div style="padding:16px 20px 0;font-size:14px;font-weight:700">รายการล่าสุด</div>`
    if (!recent.length) {
      html += App._emptyState('📋', 'ยังไม่มีรายการ', 'แตะ + เพื่อเพิ่มรายการแรก')
    } else {
      html += `<div style="padding:0 20px">`
      recent.forEach(tx => { html += App._txRow(tx) })
      html += `</div>`
    }
    html += `</div>`

    document.getElementById('dashboard-content').innerHTML = html
    App._bindTxRows('dashboard-content')
  },

  // ─────────────────────────────────────────────────────────
  // TRANSACTIONS PAGE
  // ─────────────────────────────────────────────────────────
  renderTransactions() {
    const months = Calc.getMonths(6)

    // Month chips
    document.getElementById('tx-month-chips').innerHTML = months.map(m =>
      `<button class="chip${m === S.txMonth ? ' active' : ''}" onclick="App.setTxMonth('${m}')">${Calc.monthLabel(m)}</button>`
    ).join('')

    // Type chips
    document.getElementById('tx-type-chips').innerHTML =
      [['all','ทั้งหมด'],['expense','จ่าย'],['income','รับ'],['transfer','โอน'],['cc_payment','ชำระบัตร']].map(([v,l]) =>
        `<button class="chip${S.txType === v ? ' active' : ''}" onclick="App.setTxType('${v}')">${l}</button>`
      ).join('')

    // Search
    const searchEl = document.getElementById('tx-search')
    searchEl.value = S.txSearch
    searchEl.oninput = e => { S.txSearch = e.target.value; App.renderTransactionsList() }

    App.renderTransactionsList()
  },

  renderTransactionsList() {
    const q = S.txSearch.toLowerCase()
    const filtered = S.transactions.filter(t => {
      if (!t.date.startsWith(S.txMonth)) return false
      if (S.txType !== 'all' && t.type !== S.txType) return false
      if (q) {
        const cat = App._findCat(t.categoryId)
        return (t.merchant||'').toLowerCase().includes(q) ||
               (t.note||'').toLowerCase().includes(q) ||
               (cat?.label||'').toLowerCase().includes(q)
      }
      return true
    }).sort((a,b) => b.date.localeCompare(a.date))

    const income  = filtered.filter(t => t.type === 'income').reduce((s,t) => s+t.amount, 0)
    const expense = filtered.filter(t => t.type === 'expense').reduce((s,t) => s+t.amount, 0)
    document.getElementById('tx-summary').innerHTML =
      `<span class="c-income">รับ ${Calc.fmt(income)}</span>
       <span class="c-expense">จ่าย ${Calc.fmt(expense)}</span>
       <span class="c-muted">สุทธิ ${Calc.fmt(income - expense)}</span>`

    const groups = Calc.groupByDate(filtered)
    let html = ''
    if (!filtered.length) {
      html = App._emptyState('📋', 'ไม่มีรายการ', S.txSearch ? 'ไม่พบผลการค้นหา' : 'ยังไม่มีรายการในช่วงนี้')
    } else {
      Object.entries(groups).forEach(([dateLabel, txns]) => {
        html += `<div class="date-group-label">${dateLabel}</div>
          <div class="card"><div style="padding:0 16px">`
        txns.forEach(tx => { html += App._txRow(tx) })
        html += `</div></div>`
      })
    }
    const el = document.getElementById('tx-list-content')
    el.innerHTML = html
    App._bindTxRows('tx-list-content')
  },

  setTxMonth(m) { S.txMonth = m; App.renderTransactions() },
  setTxType(t)  { S.txType = t;  App.renderTransactionsList() },

  // ─────────────────────────────────────────────────────────
  // WALLETS PAGE
  // ─────────────────────────────────────────────────────────
  renderWallets() {
    const nw = Calc.getNetWorth(S.wallets)

    document.getElementById('wallets-summary').innerHTML = `
      <div style="flex:1;background:rgba(5,150,105,.12);border-radius:14px;padding:12px">
        <div style="font-size:12px;color:var(--muted)">สินทรัพย์รวม</div>
        <div style="font-size:18px;font-weight:800;color:var(--income)">${Calc.fmt(nw.assets)}</div>
      </div>
      <div style="flex:1;background:rgba(220,38,38,.12);border-radius:14px;padding:12px">
        <div style="font-size:12px;color:var(--muted)">หนี้สินรวม</div>
        <div style="font-size:18px;font-weight:800;color:var(--expense)">${Calc.fmt(nw.debt)}</div>
      </div>`

    let html = ''
    S.wallets.forEach(w => {
      const isCC   = w.type === 'credit'
      const owed   = Math.abs(w.balance)
      const usedPct= isCC && w.limit ? Math.min((owed / w.limit) * 100, 100) : 0
      const due    = isCC && w.dueDay ? Calc.getDueDate(w.dueDay) : null
      const avail  = isCC && w.limit ? w.limit - owed : 0
      const barClr = usedPct > 80 ? 'rgba(252,165,165,.9)' : 'rgba(255,255,255,.8)'

      html += `<div class="wallet-card" style="background:linear-gradient(135deg,${w.color},${w.color}BB)"
        onclick="${isCC ? `App.openCCDetail('${w.id}')` : `App.openWalletForm('${w.id}')`}">
        <div class="wc-header">
          <div>
            <div class="wc-name">${w.icon} ${w.name}</div>
            <div class="wc-type">${App._walletTypeLabel(w.type)}</div>
          </div>
          ${isCC ? `<button class="wc-pay-btn" onclick="event.stopPropagation();App.openCCPay('${w.id}')">ชำระ</button>` : ''}
        </div>
        <div class="wc-balance">${isCC ? '-' : ''}${Calc.fmt(isCC ? owed : w.balance)}</div>
        ${isCC && w.limit ? `
          <div class="wc-limit">
            <div class="wc-prog-bar"><div class="wc-prog-fill" style="width:${usedPct}%;background:${barClr}"></div></div>
            <div class="wc-prog-info">
              <span>ใช้ไป ${usedPct.toFixed(0)}% · คงเหลือ ${Calc.fmt(avail)}</span>
              ${due ? `<span>ครบ ${due.dueStr} (${due.daysLeft}ว.)</span>` : ''}
            </div>
          </div>` : ''}
      </div>`
    })

    html += `<button class="btn btn-secondary" onclick="App.openWalletForm(null)" style="margin-top:4px">
      + เพิ่มกระเป๋าเงิน
    </button>`

    document.getElementById('wallets-content').innerHTML = html
  },

  // ─────────────────────────────────────────────────────────
  // REPORTS PAGE
  // ─────────────────────────────────────────────────────────
  renderReports() {
    const months = Calc.getMonths(6)

    document.getElementById('report-month-chips').innerHTML = months.map(m =>
      `<button class="chip${m === S.rptMonth ? ' active' : ''}" onclick="App.setRptMonth('${m}')">${Calc.monthLabel(m)}</button>`
    ).join('')

    document.getElementById('report-view-chips').innerHTML =
      [['expense','รายจ่าย'],['income','รายรับ'],['budget','งบประมาณ']].map(([v,l]) =>
        `<button class="chip${S.rptView === v ? ' active' : ''}" onclick="App.setRptView('${v}')">${l}</button>`
      ).join('')

    const stats  = Calc.getMonthlyStats(S.transactions, S.rptMonth)
    const nw     = Calc.getNetWorth(S.wallets)
    const budget = Calc.getBudgetProgress(S.transactions, S.budgets, S.categories, S.rptMonth)

    let html = `
      <!-- Summary cards -->
      <div class="report-summary-grid">
        ${[
          ['รายรับ', stats.income, 'var(--income)'],
          ['รายจ่าย', stats.expense, 'var(--expense)'],
          ['สุทธิ', stats.net, stats.net >= 0 ? 'var(--income)' : 'var(--expense)'],
        ].map(([l,v,c]) => `
          <div class="card report-summary-card">
            <div class="report-summary-label">${l}</div>
            <div class="report-summary-value" style="color:${c}">${Calc.fmt(Math.abs(v))}</div>
          </div>`).join('')}
      </div>

      <!-- Net worth -->
      <div class="card card-pad nw-card" style="margin-bottom:16px">
        <div class="nw-label">ความมั่งคั่งสุทธิ</div>
        <div class="nw-value ${nw.net>=0?'c-income':'c-expense'}">${nw.net<0?'-':''}${Calc.fmt(Math.abs(nw.net))}</div>
        <div class="nw-detail">
          <span class="nw-item">สินทรัพย์ <strong class="c-income">${Calc.fmt(nw.assets)}</strong></span>
          <span class="nw-item">หนี้ <strong class="c-expense">${Calc.fmt(nw.debt)}</strong></span>
        </div>
      </div>`

    if (S.rptView === 'budget') {
      html += `<div class="card card-pad">`
      if (!budget.length) {
        html += App._emptyState('💰', 'ยังไม่ได้ตั้งงบประมาณ', 'ไปที่ เพิ่มเติม → งบประมาณ')
      } else {
        budget.forEach(b => {
          const barColor = b.over ? 'var(--expense)' : b.pct > 80 ? 'var(--amber)' : 'var(--income)'
          html += `<div style="margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px">
              <span style="font-weight:600">${b.icon} ${b.label}</span>
              <span style="color:${b.over?'var(--expense)':'var(--muted)'}">${Calc.fmt(b.spent)} / ${Calc.fmt(b.monthlyLimit)}</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${b.pct}%;background:${barColor}"></div></div>
            <div style="font-size:11px;color:${b.over?'var(--expense)':'var(--muted)'};margin-top:4px">
              ${b.over ? `เกิน ${Calc.fmt(b.spent - b.monthlyLimit)}` : `เหลือ ${Calc.fmt(b.monthlyLimit - b.spent)}`}
            </div>
          </div>`
        })
      }
      html += `</div>`
    } else {
      const cats = S.categories[S.rptView] || []
      const data = cats.map(c => ({
        label: c.icon, name: c.label, value: stats.byCategory[c.id] || 0, color: c.color, id: c.id
      })).filter(d => d.value > 0).sort((a,b) => b.value - a.value)
      const total = data.reduce((s,d) => s + d.value, 0)
      const max   = Math.max(...data.map(d => d.value), 1)

      if (!data.length) {
        html += App._emptyState('📊', 'ไม่มีข้อมูล', 'ยังไม่มีรายการในช่วงเวลานี้')
      } else {
        // Bar chart
        html += `<div class="card card-pad" style="margin-bottom:12px">
          <div style="font-size:14px;font-weight:700;margin-bottom:16px">${S.rptView==='income'?'รายรับ':'รายจ่าย'}แยกหมวดหมู่</div>
          <div class="bar-chart">`
        data.slice(0, 8).forEach(d => {
          const h = Math.max(4, (d.value / max) * 100)
          html += `<div class="bar-col">
            <div class="bar-fill" style="height:${h}%;background:${d.color}"></div>
            <div class="bar-lbl">${d.label}</div>
          </div>`
        })
        html += `</div></div>`

        // Category list
        html += `<div class="card"><div style="padding:0 20px">`
        data.forEach(d => {
          const pct = total > 0 ? (d.value / total * 100) : 0
          html += `<div class="detail-row">
            <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
              <div style="width:36px;height:36px;border-radius:10px;background:${d.color}20;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${d.label}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:600">${d.name}</div>
                <div style="height:4px;border-radius:2px;background:var(--border);margin-top:4px;overflow:hidden">
                  <div style="height:100%;width:${pct}%;background:${d.color};border-radius:2px"></div>
                </div>
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0;padding-left:12px">
              <div style="font-size:14px;font-weight:700">${Calc.fmt(d.value)}</div>
              <div style="font-size:11px;color:var(--muted)">${pct.toFixed(1)}%</div>
            </div>
          </div>`
        })
        html += `</div></div>`
      }
    }

    document.getElementById('reports-content').innerHTML = html
  },

  setRptMonth(m) { S.rptMonth = m; App.renderReports() },
  setRptView(v)  { S.rptView = v;  App.renderReports() },

  // ─────────────────────────────────────────────────────────
  // MORE / SETTINGS PAGE
  // ─────────────────────────────────────────────────────────
  renderMore() {
    const ACCENT_COLORS = ['#2563EB','#7C3AED','#DC2626','#059669','#D97706','#0891B2','#BE185D','#374151']
    const budgetCount = S.budgets.filter(b => b.monthlyLimit > 0).length

    document.getElementById('more-content').innerHTML = `
      <div style="padding:0 16px">
        <div style="font-size:20px;font-weight:800;padding:20px 0 4px">เพิ่มเติม</div>

        <div class="sec-title">การแสดงผล</div>
        <div class="card card-pad">
          <!-- Dark mode -->
          <div class="settings-row" onclick="App.toggleDark()" style="cursor:pointer">
            <div class="s-icon">🌙</div>
            <div class="s-label">โหมดมืด</div>
            <button class="toggle${S.settings.darkMode ? ' on' : ''}" id="dark-toggle" onclick="event.stopPropagation();App.toggleDark()"></button>
          </div>
          <!-- Accent color -->
          <div style="padding:14px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:15px;font-weight:600;margin-bottom:12px">🎨 สีธีม</div>
            <div class="color-row">
              ${ACCENT_COLORS.map(c => `
                <div class="color-dot${S.settings.accentColor===c?' selected':''}"
                  style="background:${c}"
                  onclick="App.setAccent('${c}')"></div>`).join('')}
            </div>
          </div>
        </div>

        <div class="sec-title">การเงิน</div>
        <div class="card card-pad">
          <div class="settings-row" onclick="App.openBudgetScreen()">
            <div class="s-icon">💰</div>
            <div class="s-label">งบประมาณ</div>
            <div class="s-value">${budgetCount ? budgetCount + ' หมวด' : 'ยังไม่ตั้ง'}</div>
            <div class="s-arrow">›</div>
          </div>
        </div>

        <div class="sec-title">ข้อมูล</div>
        <div class="card card-pad">
          <div class="settings-row" onclick="App.exportData()">
            <div class="s-icon">📤</div>
            <div class="s-label">ส่งออกข้อมูล (JSON)</div>
            <div class="s-arrow">›</div>
          </div>
          <div class="settings-row" onclick="document.getElementById('import-file').click()">
            <div class="s-icon">📥</div>
            <div class="s-label">นำเข้าข้อมูล (JSON)</div>
            <div class="s-arrow">›</div>
          </div>
          <input type="file" id="import-file" accept=".json" style="display:none" onchange="App.importData(this)">
          <div class="settings-row" onclick="App.resetData()">
            <div class="s-icon">🔄</div>
            <div class="s-label" style="color:var(--expense)">รีเซ็ตข้อมูลทั้งหมด</div>
            <div class="s-arrow" style="color:var(--expense)">›</div>
          </div>
        </div>

        <div style="text-align:center;padding:32px 0 8px">
          <div style="font-size:40px">💰</div>
          <div style="font-size:16px;font-weight:700;margin-top:8px">Money Tracker</div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">v1.0 · Offline-first PWA</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">ข้อมูลเก็บในเครื่องของคุณเท่านั้น</div>
        </div>
      </div>`
  },

  toggleDark() {
    S.settings.darkMode = !S.settings.darkMode
    persist(); applyTheme(); App.renderMore()
  },

  setAccent(color) {
    S.settings.accentColor = color
    persist(); applyTheme(); App.renderMore()
  },

  exportData() {
    Storage.exportJSON(S)
    toast('ส่งออกข้อมูลสำเร็จ', 'success')
  },

  importData(input) {
    const file = input.files[0]
    if (!file) return
    Storage.importJSON(file, data => {
      if (confirm('นำเข้าข้อมูลจะแทนที่ข้อมูลปัจจุบัน ยืนยัน?')) {
        S.transactions = data.transactions || []
        S.wallets      = data.wallets      || []
        S.categories   = data.categories   || S.categories
        S.budgets      = data.budgets      || []
        persist(); App.render()
        toast('นำเข้าข้อมูลสำเร็จ', 'success')
      }
      input.value = ''
    }, err => { toast('นำเข้าล้มเหลว: ' + err, 'error'); input.value = '' })
  },

  resetData() {
    if (!confirm('รีเซ็ตข้อมูลทั้งหมด? ไม่สามารถกู้คืนได้')) return
    Storage.reset()
    const fresh = Storage.init()
    Object.assign(S, fresh)
    persist(); App.render()
    toast('รีเซ็ตข้อมูลแล้ว', 'info')
  },

  // ─────────────────────────────────────────────────────────
  // BUDGET SUB-SCREEN
  // ─────────────────────────────────────────────────────────
  openBudgetScreen() {
    const rows = S.categories.expense.map(cat => {
      const b = S.budgets.find(b => b.categoryId === cat.id)
      const spent = S.transactions
        .filter(t => t.date.startsWith(THIS_MONTH) && t.type === 'expense' && t.categoryId === cat.id)
        .reduce((s,t) => s + t.amount, 0)
      return { cat, limit: b?.monthlyLimit || 0, spent }
    })

    const html = `
      <div class="sub-header">
        <button class="btn-icon" onclick="App.closeSubScreen()">←</button>
        <h2>ตั้งงบประมาณ</h2>
        <button class="btn btn-primary btn-sm" onclick="App.saveBudgets()" style="width:auto;padding:8px 16px">บันทึก</button>
      </div>
      <div class="sub-scroll">
        <p style="font-size:13px;color:var(--muted);margin-bottom:16px">ตั้งงบประมาณรายเดือนแต่ละหมวด (0 = ไม่กำหนด)</p>
        ${rows.map(r => `
          <div style="margin-bottom:16px">
            <label class="form-label">${r.cat.icon} ${r.cat.label} · ใช้ไปแล้ว ${Calc.fmt(r.spent)}</label>
            <input class="form-input" type="number" id="budget-${r.cat.id}" value="${r.limit || ''}" placeholder="0 = ไม่กำหนด">
          </div>`).join('')}
      </div>`
    App.openSubScreen(html)
  },

  saveBudgets() {
    S.categories.expense.forEach(cat => {
      const el  = document.getElementById('budget-' + cat.id)
      const val = parseFloat(el?.value) || 0
      const idx = S.budgets.findIndex(b => b.categoryId === cat.id)
      if (val > 0) {
        if (idx >= 0) S.budgets[idx].monthlyLimit = val
        else S.budgets.push({ categoryId: cat.id, monthlyLimit: val })
      } else {
        if (idx >= 0) S.budgets.splice(idx, 1)
      }
    })
    persist(); App.closeSubScreen()
    toast('บันทึกงบประมาณแล้ว', 'success')
  },

  // ─────────────────────────────────────────────────────────
  // ADD TRANSACTION OVERLAY
  // ─────────────────────────────────────────────────────────
  openAddTx() {
    S.tx = {
      step: 'amount', type: 'expense', amount: '0',
      walletId: S.wallets.find(w => w.type !== 'credit')?.id || S.wallets[0]?.id || '',
      toWalletId: '', categoryId: '', merchant: '', note: '', date: TODAY,
    }
    App._renderAddTxAmount()
    App.openOverlay('overlay-add-tx')
  },

  _renderAddTxAmount() {
    const amtColor = S.tx.type === 'income' ? 'var(--income)' : S.tx.type === 'transfer' ? 'var(--primary)' : 'var(--expense)'
    const display  = parseFloat(S.tx.amount || 0).toLocaleString('en-US', {
      minimumFractionDigits: S.tx.amount.includes('.') ? (S.tx.amount.split('.')[1]?.length || 0) : 0
    })

    document.getElementById('add-tx-content').innerHTML = `
      <div class="sheet-header" style="border-bottom:none;padding-bottom:0">
        <h2>เพิ่มรายการ</h2>
        <button class="btn-icon" onclick="App.closeOverlay('overlay-add-tx')">✕</button>
      </div>

      <!-- Type tabs -->
      <div class="type-tabs">
        ${[['expense','จ่าย'],['income','รับ'],['transfer','โอน']].map(([v,l]) =>
          `<button class="type-tab${S.tx.type===v?' active':''}" onclick="App._setTxType('${v}')">${l}</button>`
        ).join('')}
      </div>

      <!-- Amount display -->
      <div class="amount-display" style="color:${amtColor}">฿${display}</div>

      <!-- Numpad -->
      <div class="numpad">
        ${['7','8','9','4','5','6','1','2','3','.','0','⌫'].map(k =>
          `<button class="numpad-key${k==='⌫'?' del':''}" onclick="App._numpad('${k}')">${k}</button>`
        ).join('')}
      </div>

      <div style="padding:0 20px 20px">
        <button class="btn btn-primary" onclick="App._goToDetail()">ถัดไป →</button>
      </div>`
  },

  _setTxType(type) { S.tx.type = type; S.tx.categoryId = ''; App._renderAddTxAmount() },

  _numpad(key) {
    let v = S.tx.amount
    if (key === '⌫') { v = v.length > 1 ? v.slice(0, -1) : '0' }
    else if (key === '.') { if (!v.includes('.')) v += '.' }
    else {
      if (v === '0') v = key
      else {
        const parts = (v + key).split('.')
        if (parts[0].length <= 10 && (parts[1] === undefined || parts[1].length <= 2)) v += key
      }
    }
    S.tx.amount = v
    App._renderAddTxAmount()
  },

  _goToDetail() {
    if (!parseFloat(S.tx.amount)) { toast('กรุณาระบุจำนวนเงิน', 'error'); return }
    S.tx.step = 'detail'
    App._renderAddTxDetail()
  },

  _renderAddTxDetail() {
    const cats = S.tx.type === 'income' ? S.categories.income : S.categories.expense
    const nonCC = S.wallets.filter(w => w.type !== 'credit')
    const amtColor = S.tx.type === 'income' ? 'var(--income)' : S.tx.type === 'transfer' ? 'var(--primary)' : 'var(--expense)'

    document.getElementById('add-tx-content').innerHTML = `
      <div class="sheet-header">
        <h2>รายละเอียด</h2>
        <button class="btn-icon" onclick="App.closeOverlay('overlay-add-tx')">✕</button>
      </div>
      <div style="text-align:center;font-size:36px;font-weight:800;color:${amtColor};padding:12px 0 16px">
        ฿${parseFloat(S.tx.amount).toLocaleString('en-US')}
      </div>
      <div class="sheet-body" style="padding-top:0">

        ${S.tx.type !== 'transfer' ? `
        <div class="form-group">
          <label class="form-label">หมวดหมู่</label>
          <div class="cat-grid" id="cat-grid">
            ${cats.map(c => `
              <button class="cat-btn${S.tx.categoryId===c.id?' active':''}"
                onclick="App._selectCat('${c.id}')">${c.icon} ${c.label}</button>`).join('')}
          </div>
        </div>` : ''}

        <div class="form-group">
          <label class="form-label">${S.tx.type === 'transfer' ? 'จาก' : 'กระเป๋าเงิน'}</label>
          <select class="form-input" id="tx-wallet" onchange="App._txField('walletId',this.value)">
            ${S.wallets.map(w => `<option value="${w.id}"${S.tx.walletId===w.id?' selected':''}>${w.icon} ${w.name}</option>`).join('')}
          </select>
        </div>

        ${S.tx.type === 'transfer' ? `
        <div class="form-group">
          <label class="form-label">ไปยัง</label>
          <select class="form-input" id="tx-towallet" onchange="App._txField('toWalletId',this.value)">
            <option value="">เลือกปลายทาง</option>
            ${S.wallets.filter(w => w.id !== S.tx.walletId).map(w =>
              `<option value="${w.id}"${S.tx.toWalletId===w.id?' selected':''}>${w.icon} ${w.name}</option>`).join('')}
          </select>
        </div>` : ''}

        <div class="form-group">
          <label class="form-label">ร้านค้า / ที่มา</label>
          <input class="form-input" id="tx-merchant" placeholder="ชื่อร้านค้า..." value="${S.tx.merchant}"
            oninput="App._txField('merchant',this.value)">
        </div>

        <div class="form-group">
          <label class="form-label">หมายเหตุ</label>
          <input class="form-input" id="tx-note" placeholder="หมายเหตุ (ถ้ามี)..." value="${S.tx.note}"
            oninput="App._txField('note',this.value)">
        </div>

        <div class="form-group">
          <label class="form-label">วันที่</label>
          <input class="form-input" type="date" id="tx-date" value="${S.tx.date}"
            onchange="App._txField('date',this.value)">
        </div>

        <div class="flex-row mt-8">
          <button class="btn btn-secondary flex-1" onclick="App._backToAmount()">← แก้ไข</button>
          <button class="btn btn-primary" style="flex:2" onclick="App.saveTx()">บันทึก</button>
        </div>
      </div>`
  },

  _selectCat(id) {
    S.tx.categoryId = id
    document.querySelectorAll('.cat-btn').forEach(b => {
      b.classList.toggle('active', b.textContent.trim().includes(
        S.categories[S.tx.type === 'income' ? 'income' : 'expense'].find(c => c.id === id)?.label || ''
      ))
    })
    // Re-render just the cat grid to show active state
    const cats = S.tx.type === 'income' ? S.categories.income : S.categories.expense
    document.getElementById('cat-grid').innerHTML = cats.map(c =>
      `<button class="cat-btn${S.tx.categoryId===c.id?' active':''}"
        onclick="App._selectCat('${c.id}')">${c.icon} ${c.label}</button>`).join('')
  },

  _txField(field, val) { S.tx[field] = val },
  _backToAmount()      { S.tx.step = 'amount'; App._renderAddTxAmount() },

  saveTx() {
    const amt = parseFloat(S.tx.amount)
    if (!amt || amt <= 0)             { toast('กรุณาระบุจำนวนเงิน', 'error'); return }
    if (!S.tx.walletId)               { toast('กรุณาเลือกกระเป๋าเงิน', 'error'); return }
    if (S.tx.type === 'transfer' && !S.tx.toWalletId) { toast('กรุณาเลือกปลายทาง', 'error'); return }
    if (S.tx.type !== 'income' && S.tx.type !== 'transfer' && !S.tx.categoryId) {
      toast('กรุณาเลือกหมวดหมู่', 'error'); return
    }

    const tx = {
      id:         Calc.genId(),
      type:       S.tx.type,
      amount:     amt,
      walletId:   S.tx.walletId,
      toWalletId: S.tx.toWalletId || undefined,
      categoryId: S.tx.categoryId || undefined,
      merchant:   S.tx.merchant,
      note:       S.tx.note,
      date:       S.tx.date || TODAY,
    }

    S.transactions.unshift(tx)
    App._applyBalance(tx, 1)
    persist()
    App.closeOverlay('overlay-add-tx')
    App.render()
    toast('บันทึกรายการแล้ว', 'success')
  },

  // ─────────────────────────────────────────────────────────
  // TRANSACTION DETAIL
  // ─────────────────────────────────────────────────────────
  openTxDetail(id) {
    S.selectedTxId = id
    S.deleteConfirm = false
    App._renderTxDetail()
    App.openOverlay('overlay-tx-detail')
  },

  _renderTxDetail() {
    const tx = S.transactions.find(t => t.id === S.selectedTxId)
    if (!tx) return
    const cat    = App._findCat(tx.categoryId)
    const wallet = S.wallets.find(w => w.id === tx.walletId)
    const toWal  = S.wallets.find(w => w.id === tx.toWalletId)
    const amtColor = tx.type === 'income' ? 'var(--income)' : tx.type === 'transfer' ? 'var(--primary)' : 'var(--expense)'

    document.getElementById('tx-detail-content').innerHTML = `
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:48px;font-weight:800;color:${amtColor}">
          ${tx.type==='income'?'+':tx.type==='expense'?'-':''}${Calc.fmt(tx.amount)}
        </div>
        <div style="font-size:14px;color:var(--muted);margin-top:6px">${Calc.labelDate(tx.date)}</div>
      </div>
      <div>
        ${cat    ? `<div class="detail-row"><span class="detail-label">หมวดหมู่</span><span class="detail-value">${cat.icon} ${cat.label}</span></div>` : ''}
        ${wallet ? `<div class="detail-row"><span class="detail-label">กระเป๋าเงิน</span><span class="detail-value">${wallet.icon} ${wallet.name}</span></div>` : ''}
        ${toWal  ? `<div class="detail-row"><span class="detail-label">ไปยัง</span><span class="detail-value">${toWal.icon} ${toWal.name}</span></div>` : ''}
        ${tx.merchant ? `<div class="detail-row"><span class="detail-label">ร้านค้า</span><span class="detail-value">${tx.merchant}</span></div>` : ''}
        ${tx.note     ? `<div class="detail-row"><span class="detail-label">หมายเหตุ</span><span class="detail-value">${tx.note}</span></div>` : ''}
        <div class="detail-row"><span class="detail-label">ประเภท</span><span class="detail-value">${App._txTypeLabel(tx.type)}</span></div>
      </div>
      <div style="margin-top:24px">
        ${S.deleteConfirm
          ? `<button class="btn btn-danger" onclick="App.confirmDeleteTx()">ยืนยันการลบ</button>
             <button class="btn btn-secondary mt-8" onclick="App._cancelDelete()">ยกเลิก</button>`
          : `<button class="btn btn-outline" onclick="App.deleteTx()">🗑 ลบรายการ</button>`}
      </div>`
  },

  deleteTx() { S.deleteConfirm = true; App._renderTxDetail() },
  _cancelDelete() { S.deleteConfirm = false; App._renderTxDetail() },

  confirmDeleteTx() {
    const tx = S.transactions.find(t => t.id === S.selectedTxId)
    if (tx) {
      App._applyBalance(tx, -1)
      S.transactions = S.transactions.filter(t => t.id !== S.selectedTxId)
      persist()
    }
    App.closeOverlay('overlay-tx-detail')
    App.render()
    toast('ลบรายการแล้ว', 'success')
  },

  // ─────────────────────────────────────────────────────────
  // WALLET FORM
  // ─────────────────────────────────────────────────────────
  openWalletForm(walletId) {
    S.editingWalletId = walletId
    const w = walletId ? S.wallets.find(x => x.id === walletId) : null
    const COLORS = ['#2563EB','#7C3AED','#DC2626','#059669','#D97706','#0891B2','#BE185D','#374151']
    const TYPES  = [['bank','🏦','ธนาคาร'],['cash','💵','เงินสด'],['ewallet','📱','E-Wallet'],['credit','💳','บัตรเครดิต'],['saving','🏧','ออมทรัพย์']]

    document.getElementById('wallet-form-title').textContent = w ? 'แก้ไขกระเป๋า' : 'เพิ่มกระเป๋าเงิน'
    document.getElementById('wallet-form-content').innerHTML = `
      <div class="form-group">
        <label class="form-label">ชื่อกระเป๋า</label>
        <input class="form-input" id="wf-name" placeholder="เช่น ธ.กสิกร, เงินสด" value="${w?.name||''}">
      </div>
      <div class="form-group">
        <label class="form-label">ประเภท</label>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px" id="wf-type-grid">
          ${TYPES.map(([v,icon,lbl]) => `
            <button class="cat-btn${(w?.type||'bank')===v?' active':''}" onclick="App._selectWalletType('${v}')"
              data-type="${v}">${icon}<br><small>${lbl}</small></button>`).join('')}
        </div>
        <input type="hidden" id="wf-type" value="${w?.type||'bank'}">
      </div>
      <div class="form-group">
        <label class="form-label">สี</label>
        <div class="color-row" id="wf-color-row">
          ${COLORS.map(c => `
            <div class="color-dot${(w?.color||'#2563EB')===c?' selected':''}" style="background:${c}"
              onclick="App._selectWalletColor('${c}')" data-color="${c}"></div>`).join('')}
        </div>
        <input type="hidden" id="wf-color" value="${w?.color||'#2563EB'}">
      </div>
      <div class="form-group">
        <label class="form-label" id="wf-balance-label">${w?.type==='credit'?'ยอดค้างชำระ (฿)':'ยอดเงินเริ่มต้น (฿)'}</label>
        <input class="form-input" type="number" id="wf-balance" placeholder="0" value="${w ? Math.abs(w.balance) : ''}">
      </div>
      <div id="wf-cc-fields" style="${(w?.type||'bank')==='credit'?'':'display:none'}">
        <div class="form-group">
          <label class="form-label">วงเงิน (฿)</label>
          <input class="form-input" type="number" id="wf-limit" placeholder="50000" value="${w?.limit||''}">
        </div>
        <div class="form-group">
          <label class="form-label">วันครบกำหนดชำระ (วันที่)</label>
          <input class="form-input" type="number" id="wf-dueday" min="1" max="31" placeholder="5" value="${w?.dueDay||''}">
        </div>
      </div>
      <div class="flex-row">
        ${w ? `<button class="btn btn-outline flex-1" onclick="App.deleteWallet('${w.id}')">ลบ</button>` : ''}
        <button class="btn btn-primary${w?'':' flex-1'}" onclick="App.saveWallet()" style="${w?'flex:2':''}">
          ${w ? 'บันทึก' : 'เพิ่มกระเป๋า'}
        </button>
      </div>`

    App.openOverlay('overlay-wallet-form')
  },

  _selectWalletType(type) {
    document.getElementById('wf-type').value = type
    document.querySelectorAll('#wf-type-grid .cat-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.type === type)
    })
    document.getElementById('wf-cc-fields').style.display = type === 'credit' ? '' : 'none'
    document.getElementById('wf-balance-label').textContent = type === 'credit' ? 'ยอดค้างชำระ (฿)' : 'ยอดเงินเริ่มต้น (฿)'
  },

  _selectWalletColor(color) {
    document.getElementById('wf-color').value = color
    document.querySelectorAll('#wf-color-row .color-dot').forEach(d => {
      d.classList.toggle('selected', d.dataset.color === color)
    })
  },

  saveWallet() {
    const name    = document.getElementById('wf-name').value.trim()
    const type    = document.getElementById('wf-type').value
    const color   = document.getElementById('wf-color').value
    const balance = parseFloat(document.getElementById('wf-balance').value) || 0
    const limit   = parseFloat(document.getElementById('wf-limit')?.value)  || 50000
    const dueDay  = parseInt(document.getElementById('wf-dueday')?.value)   || 5
    const ICONS   = { bank:'🏦', cash:'💵', ewallet:'📱', credit:'💳', saving:'🏧' }

    if (!name) { toast('กรุณากรอกชื่อกระเป๋า', 'error'); return }

    const data = {
      name, type, color,
      icon:    ICONS[type] || '💳',
      balance: type === 'credit' ? -balance : balance,
      ...(type === 'credit' && { limit, dueDay }),
    }

    if (S.editingWalletId) {
      const idx = S.wallets.findIndex(w => w.id === S.editingWalletId)
      if (idx >= 0) S.wallets[idx] = { ...S.wallets[idx], ...data }
    } else {
      S.wallets.push({ id: Calc.genId(), ...data })
    }
    persist()
    App.closeOverlay('overlay-wallet-form')
    App.render()
    toast(S.editingWalletId ? 'แก้ไขกระเป๋าแล้ว' : 'เพิ่มกระเป๋าแล้ว', 'success')
  },

  deleteWallet(id) {
    if (!confirm('ลบกระเป๋านี้? รายการที่เกี่ยวข้องจะยังคงอยู่')) return
    S.wallets = S.wallets.filter(w => w.id !== id)
    persist()
    App.closeOverlay('overlay-wallet-form')
    App.render()
    toast('ลบกระเป๋าแล้ว', 'success')
  },

  // ─────────────────────────────────────────────────────────
  // CC PAYMENT
  // ─────────────────────────────────────────────────────────
  openCCPay(cardId) {
    S.payingCardId = cardId
    const card    = S.wallets.find(w => w.id === cardId)
    const owed    = Math.abs(card.balance)
    const sources = S.wallets.filter(w => w.id !== cardId && w.type !== 'credit')

    document.getElementById('cc-pay-content').innerHTML = `
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:14px;color:var(--muted)">${card.icon} ${card.name} · ยอดค้างชำระ</div>
        <div style="font-size:40px;font-weight:800;color:var(--expense);margin-top:4px">${Calc.fmt(owed)}</div>
      </div>
      <div class="form-group">
        <label class="form-label">จ่ายจากกระเป๋า</label>
        <select class="form-input" id="cc-pay-wallet">
          <option value="">เลือกกระเป๋า</option>
          ${sources.map(w => `<option value="${w.id}">${w.icon} ${w.name} (${Calc.fmt(w.balance)})</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">จำนวนเงิน (฿)</label>
        <input class="form-input" type="number" id="cc-pay-amount" placeholder="0" value="${owed}">
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        ${[owed, Math.min(owed, 1000), Math.min(owed, 500)].filter((v,i,a) => a.indexOf(v)===i && v > 0).map(v =>
          `<button class="chip" onclick="document.getElementById('cc-pay-amount').value='${v}'">${v===owed?'เต็มจำนวน':Calc.fmt(v)}</button>`
        ).join('')}
      </div>
      <button class="btn btn-primary" onclick="App.saveCCPay()">ชำระเงิน</button>`

    App.openOverlay('overlay-cc-pay')
  },

  saveCCPay() {
    const walletId = document.getElementById('cc-pay-wallet').value
    const amount   = parseFloat(document.getElementById('cc-pay-amount').value) || 0
    const card     = S.wallets.find(w => w.id === S.payingCardId)
    const owed     = Math.abs(card.balance)

    if (!walletId)   { toast('กรุณาเลือกกระเป๋า', 'error'); return }
    if (amount <= 0) { toast('กรุณาระบุจำนวน', 'error'); return }
    if (amount > owed) { toast('ยอดชำระมากกว่ายอดค้าง', 'error'); return }

    // Build the transaction first, then apply balance via _applyBalance so
    // edit/delete paths can safely reverse it with _applyBalance(tx, -1).
    const tx = {
      id: Calc.genId(), type: 'cc_payment',
      amount, walletId, toWalletId: S.payingCardId,
      note: `ชำระ ${card.name}`, date: getTODAY(),
    }
    S.transactions.unshift(tx)
    App._applyBalance(tx, 1)

    persist()
    App.closeOverlay('overlay-cc-pay')
    App.render()
    toast(`ชำระ ${Calc.fmt(amount)} สำเร็จ`, 'success')
  },

  // ─────────────────────────────────────────────────────────
  // CC DETAIL (tapping a CC card)
  // ─────────────────────────────────────────────────────────
  openCCDetail(cardId) {
    const card   = S.wallets.find(w => w.id === cardId)
    const owed   = Math.abs(card.balance)
    const usedPct= card.limit ? Math.min((owed / card.limit) * 100, 100) : 0
    const avail  = card.limit ? card.limit - owed : 0
    const due    = card.dueDay ? Calc.getDueDate(card.dueDay) : null
    const txns   = S.transactions.filter(t => t.walletId === cardId)
      .sort((a,b) => b.date.localeCompare(a.date)).slice(0, 20)

    const html = `
      <div class="sub-header">
        <button class="btn-icon" onclick="App.closeSubScreen()">←</button>
        <h2>${card.icon} ${card.name}</h2>
        <button class="btn btn-primary btn-sm" onclick="App.closeSubScreen();App.openCCPay('${cardId}')" style="width:auto;padding:8px 14px">ชำระ</button>
      </div>
      <div class="sub-scroll">
        <!-- Card visual -->
        <div style="background:linear-gradient(135deg,${card.color},${card.color}BB);border-radius:20px;padding:24px;color:#fff;margin-bottom:16px">
          <div style="font-size:12px;opacity:.75;margin-bottom:20px">${card.icon} ${card.name}</div>
          <div style="font-size:13px;opacity:.7;margin-bottom:6px">ยอดค้างชำระ</div>
          <div style="font-size:38px;font-weight:800;letter-spacing:-1px;margin-bottom:20px">${Calc.fmt(owed)}</div>
          ${card.limit ? `
          <div style="background:rgba(255,255,255,.2);border-radius:4px;height:7px;overflow:hidden;margin-bottom:8px">
            <div style="height:100%;width:${usedPct}%;background:${usedPct>80?'#FCA5A5':'rgba(255,255,255,.85)'};border-radius:4px"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;opacity:.75">
            <span>ใช้ ${usedPct.toFixed(0)}% · คงเหลือ ${Calc.fmt(avail)}</span>
            ${due ? `<span>ครบ ${due.dueStr} (${due.daysLeft}ว.)</span>` : ''}
          </div>` : ''}
        </div>

        <!-- Stats -->
        <div style="display:flex;gap:10px;margin-bottom:16px">
          <div class="card card-pad flex-1" style="padding:14px">
            <div style="font-size:12px;color:var(--muted)">วงเงิน</div>
            <div style="font-size:16px;font-weight:800">${Calc.fmt(card.limit||0)}</div>
          </div>
          <div class="card card-pad flex-1" style="padding:14px">
            <div style="font-size:12px;color:var(--muted)">ครบกำหนด</div>
            <div style="font-size:16px;font-weight:800;color:${due?.daysLeft<=3?'var(--expense)':'var(--text)'}">
              ${due ? `${due.daysLeft} วัน` : '-'}
            </div>
          </div>
        </div>

        <!-- Recent transactions -->
        <div style="font-size:14px;font-weight:700;margin-bottom:8px">รายการล่าสุด</div>
        <div class="card"><div style="padding:0 16px">
          ${txns.length ? txns.map(tx => App._txRow(tx)).join('') : App._emptyState('📋', 'ยังไม่มีรายการ', '')}
        </div></div>
      </div>`

    App.openSubScreen(html)
    // Bind tx rows after render
    setTimeout(() => App._bindTxRows('sub-screen'), 0)
  },

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────
  _applyBalance(tx, mult) {
    const w = S.wallets.find(x => x.id === tx.walletId)
    if (!w) return
    if (tx.type === 'income')     w.balance += tx.amount * mult
    if (tx.type === 'expense')    w.balance -= tx.amount * mult
    if (tx.type === 'transfer' || tx.type === 'cc_payment') {
      w.balance -= tx.amount * mult
      const to = S.wallets.find(x => x.id === tx.toWalletId)
      if (to) to.balance += tx.amount * mult
    }
  },

  _findCat(id) {
    if (!id) return null
    return [...S.categories.expense, ...S.categories.income].find(c => c.id === id)
  },

  _txRow(tx) {
    const cat    = App._findCat(tx.categoryId)
    const wallet = S.wallets.find(w => w.id === tx.walletId)
    const icon   = cat?.icon || (tx.type==='income'?'💰':tx.type==='transfer'?'↔':tx.type==='cc_payment'?'💳':'💸')
    const bgColor= cat?.color ? cat.color + '20' : 'var(--elevated)'
    const amtColor = tx.type==='income' ? 'var(--income)' : tx.type==='transfer' ? 'var(--primary)' : 'var(--expense)'
    const sign   = tx.type==='income' ? '+' : tx.type==='transfer'||tx.type==='cc_payment' ? '↔ ' : '-'
    const title  = tx.merchant || tx.note || cat?.label || 'รายการ'
    const sub    = [cat?.label, wallet?.name].filter(Boolean).join(' · ')

    return `<div class="tx-row" data-txid="${tx.id}">
      <div class="tx-icon" style="background:${bgColor}">${icon}</div>
      <div class="tx-info">
        <div class="tx-title">${title}</div>
        ${sub ? `<div class="tx-sub">${sub}</div>` : ''}
      </div>
      <div class="tx-right">
        <div class="tx-amount" style="color:${amtColor}">${sign}${Calc.fmt(tx.amount)}</div>
        <div class="tx-date">${Calc.shortDate(tx.date)}</div>
      </div>
    </div>`
  },

  _bindTxRows(containerId) {
    document.querySelectorAll(`#${containerId} .tx-row`).forEach(el => {
      el.addEventListener('click', () => App.openTxDetail(el.dataset.txid))
    })
  },

  _emptyState(icon, title, sub) {
    return `<div class="empty">
      <div class="empty-icon">${icon}</div>
      <div class="empty-title">${title}</div>
      ${sub ? `<div class="empty-sub">${sub}</div>` : ''}
    </div>`
  },

  _walletTypeLabel(type) {
    const m = { bank:'ธนาคาร', cash:'เงินสด', ewallet:'E-Wallet', credit:'บัตรเครดิต', saving:'ออมทรัพย์' }
    return m[type] || type
  },

  _txTypeLabel(type) {
    const m = { expense:'รายจ่าย', income:'รายรับ', transfer:'โอน', cc_payment:'ชำระบัตร' }
    return m[type] || type
  },
}


/* ============================================================
   V2 overrides
   ============================================================ */
Object.assign(Calc, {
  getIncomeBudgetProgress(transactions, budgets, categories, month) {
    const txns = transactions.filter(t => t.date.startsWith(month) && t.type === 'income')
    return (budgets || []).map(b => {
      const received = txns.filter(t => t.categoryId === b.categoryId).reduce((s,t) => s + t.amount, 0)
      const cat = categories.income.find(c => c.id === b.categoryId)
      const pct = b.monthlyLimit > 0 ? Math.min((received / b.monthlyLimit) * 100, 100) : 0
      return { ...b, spent: received, pct, over: false, kind: 'income', icon: cat?.icon || '💰', label: cat?.label || b.categoryId, color: cat?.color || '#10B981' }
    }).filter(b => b.monthlyLimit > 0)
  },
  getWalletGroups(wallets) {
    const assets = wallets.filter(w => ['bank','cash','ewallet','saving'].includes(w.type))
    const liabilities = wallets.filter(w => w.type === 'credit')
    const investments = wallets.filter(w => ['gold','crypto','fcd'].includes(w.type))
    return {
      assets, liabilities, investments,
      assetTotal: [...assets, ...investments].reduce((s,w) => s + Math.max(0, w.balance || 0), 0),
      liabilityTotal: liabilities.reduce((s,w) => s + Math.abs(Math.min(0, w.balance || 0)), 0),
    }
  },
  getMerchantUsage(transactions) {
    return transactions.reduce((m,t) => { if (t.merchant) m[t.merchant] = (m[t.merchant] || 0) + 1; return m }, {})
  },
  getStatementPeriod(cycleDay = 25) {
    const now = new Date()
    let end = new Date(now.getFullYear(), now.getMonth(), cycleDay)
    if (now.getDate() <= cycleDay) end = new Date(now.getFullYear(), now.getMonth() - 1, cycleDay)
    const start = new Date(end); start.setMonth(start.getMonth() - 1); start.setDate(start.getDate() + 1)
    const localStr = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    return { start: localStr(start), end: localStr(end) }
  },
  getCardRewards(txns, benefit) {
    if (!benefit?.enabled) return { points: 0, cashback: 0 }
    const p = benefit.points || {}, c = benefit.cashback || {}
    let points = 0, cashback = 0
    txns.forEach(t => {
      let pt = 0
      if (p.bahtPerPoint) pt += Math.floor(t.amount / p.bahtPerPoint)
      if (p.pointPerBahtEvery) pt += Math.floor(t.amount / p.pointPerBahtEvery)
      pt *= (p.multiplier || 1)
      if (p.maxPerTxn) pt = Math.min(pt, p.maxPerTxn)
      points += pt
      if (!c.minSpend || t.amount >= c.minSpend) {
        const base = c.everyBaht ? Math.floor(t.amount / c.everyBaht) * c.everyBaht : t.amount
        let cb = base * ((c.percent || 0) / 100)
        if (c.tierThreshold && t.amount < c.tierThreshold) cb = 0
        if (c.maxPerTxn) cb = Math.min(cb, c.maxPerTxn)
        cashback += cb
      }
    })
    if (p.maxPerCycle) points = Math.min(points, p.maxPerCycle)
    if (c.maxPerCycle) cashback = Math.min(cashback, c.maxPerCycle)
    return { points: Math.floor(points), cashback }
  },
})

Object.assign(App, {
  _ensureV2State() { S.recurring ||= []; S.merchants ||= []; S.ccBenefits ||= {}; S.incomeBudgets ||= []; S.marketPrices ||= {} },

  renderDashboard() {
    App._ensureV2State()
    const stats = Calc.getMonthlyStats(S.transactions, THIS_MONTH)
    const nw = Calc.getNetWorth(S.wallets)
    const expBudgets = Calc.getBudgetProgress(S.transactions, S.budgets, S.categories, THIS_MONTH)
    const incBudgets = Calc.getIncomeBudgetProgress(S.transactions, S.incomeBudgets, S.categories, THIS_MONTH)
    const recent = [...S.transactions].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 5)
    const savW = stats.income > 0 ? Math.min(stats.savingsRate, 100) : 0
    const grad = `linear-gradient(135deg, ${S.settings.accentColor}, ${S.settings.accentColor}CC)`
    let html = `<div class="grad-header" style="background:${grad};color:#fff;border-radius:0 0 24px 24px;margin-bottom:16px">
      <div style="font-size:13px;opacity:.75;margin-bottom:12px">${Calc.monthLabel(THIS_MONTH)}</div>
      <div class="grad-stats"><div class="grad-stat"><div class="grad-s-label">รายรับ</div><div class="grad-s-value">${Calc.fmt(stats.income)}</div></div><div class="grad-stat"><div class="grad-s-label">รายจ่าย</div><div class="grad-s-value">${Calc.fmt(stats.expense)}</div></div><div class="grad-stat"><div class="grad-s-label">คงเหลือ</div><div class="grad-s-value">${Calc.fmt(stats.net)}</div></div></div>
      <div class="savings-bar"><div class="savings-fill" style="width:${savW}%"></div></div><div class="savings-text">อัตราการออม ${stats.savingsRate.toFixed(1)}%</div></div>
      <div class="card card-pad nw-card" style="margin-bottom:12px"><div class="nw-label">ความมั่งคั่งสุทธิ</div><div class="nw-value ${nw.net >= 0 ? 'c-income' : 'c-expense'}">${nw.net >= 0 ? '' : '-'}${Calc.fmt(Math.abs(nw.net))}</div><div class="nw-detail"><span class="nw-item">สินทรัพย์ <strong class="c-income">${Calc.fmt(nw.assets)}</strong></span><span class="nw-item">หนี้สิน <strong class="c-expense">${Calc.fmt(nw.debt)}</strong></span></div></div>`
    const alerts = S.wallets.filter(w => w.type === 'credit' && Math.abs(w.balance) > 0 && w.dueDay).map(w => ({...w, owed: Math.abs(w.balance), ...Calc.getDueDate(w.dueDay)})).filter(w => w.daysLeft >= 0 && w.daysLeft <= 3).sort((a,b) => a.daysLeft - b.daysLeft)
    if (alerts.length) {
      html += `<div class="sec-title">แจ้งเตือนบัตรเครดิต</div>`
      alerts.forEach(a => html += `<div class="alert-card ${a.daysLeft <= 1 ? 'alert-urgent' : 'alert-warn'}"><div style="display:flex;justify-content:space-between;gap:12px"><div><div style="font-size:14px;font-weight:800">${a.icon} ${a.name}</div><div style="font-size:12px;color:var(--muted);margin-top:2px">ครบกำหนด ${a.dueStr} · ${a.daysLeft === 0 ? 'วันนี้' : `อีก ${a.daysLeft} วัน`}</div></div><div style="font-size:15px;font-weight:800;color:var(--expense)">${Calc.fmt(a.owed)}</div></div><button class="btn btn-primary btn-sm mt-12" onclick="App.openCCPay('${a.id}')">ชำระบัตรนี้</button></div>`)
    }
    const insights = []
    const top = Object.entries(stats.byCategory || {}).sort((a,b) => b[1] - a[1])[0]
    if (top) { const cat = App._findCat(top[0]); insights.push({icon:'📊', title:`ใช้จ่ายสูงสุด: ${cat?.label || 'ไม่ระบุหมวด'}`, body:`ใช้ ${Calc.fmt(top[1])} หรือ ${stats.expense ? (top[1]/stats.expense*100).toFixed(0) : 0}% ของรายจ่ายเดือนนี้`, bg:'rgba(37,99,235,.08)'}) }
    const over = expBudgets.find(b => b.over)
    if (over) insights.push({icon:'⚠️', title:`งบ ${over.label} เกินแล้ว`, body:`เกินงบ ${Calc.fmt(over.spent - over.monthlyLimit)} แนะนำชะลอรายจ่ายหมวดนี้`, bg:'rgba(220,38,38,.08)'})
    const gap = incBudgets.find(b => b.spent < b.monthlyLimit)
    if (gap) insights.push({icon:'🎯', title:`รายรับ ${gap.label} ยังต่ำกว่าเป้า`, body:`ยังขาด ${Calc.fmt(gap.monthlyLimit - gap.spent)} จากเป้ารายเดือน`, bg:'rgba(5,150,105,.08)'})
    if (!insights.length) insights.push({icon:'✅', title:'ภาพรวมยังดูดี', body:'ยังไม่พบหมวดที่เกินงบหรือผิดปกติ', bg:'rgba(5,150,105,.08)'})
    html += `<div class="sec-title">Insights & คำแนะนำ</div><div class="card card-pad" style="margin-bottom:12px;padding-bottom:10px">${insights.slice(0,3).map(i => `<div class="insight-row" style="background:${i.bg}"><div class="insight-icon">${i.icon}</div><div><div class="insight-title">${i.title}</div><div class="insight-body">${i.body}</div></div></div>`).join('')}</div>`
    if (expBudgets.length || incBudgets.length) {
      html += `<div class="card card-pad" style="margin-bottom:12px"><div style="font-size:14px;font-weight:700;margin-bottom:12px">งบประมาณเดือนนี้</div>`
      ;[...expBudgets.slice(0,2), ...incBudgets.slice(0,1)].forEach(b => { const barColor = b.over ? 'var(--expense)' : b.pct > 80 ? 'var(--amber)' : 'var(--income)'; html += `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;margin-bottom:5px;font-size:13px"><span>${b.icon} ${b.label}</span><span style="color:${b.over ? 'var(--expense)' : 'var(--muted)'}">${Calc.fmt(b.spent)} / ${Calc.fmt(b.monthlyLimit)}</span></div><div class="progress-bar"><div class="progress-fill" style="width:${b.pct}%;background:${barColor}"></div></div></div>` })
      html += `</div>`
    }
    html += `<div class="card" style="margin-bottom:20px"><div style="padding:16px 20px 0;font-size:14px;font-weight:700">รายการล่าสุด</div>${recent.length ? `<div style="padding:0 20px">${recent.map(tx => App._txRow(tx)).join('')}</div>` : App._emptyState('📋','ยังไม่มีรายการ','แตะ + เพื่อเพิ่มรายการแรก')}</div>`
    document.getElementById('dashboard-content').innerHTML = html
    App._bindTxRows('dashboard-content')
  },

  openAddTx() {
    S.txMode = 'add'; S.editingTxId = null
    S.tx = { step:'amount', type:'expense', amount:'0', walletId:S.wallets.find(w => w.type !== 'credit')?.id || S.wallets[0]?.id || '', toWalletId:'', categoryId:'', merchant:'', note:'', date:TODAY }
    App._renderAddTxAmount(); App.openOverlay('overlay-add-tx')
  },
  openEditTx(id) {
    const tx = S.transactions.find(t => t.id === id); if (!tx) return
    S.txMode = 'edit'; S.editingTxId = id
    S.tx = { step:'detail', type:tx.type, amount:String(tx.amount), walletId:tx.walletId || '', toWalletId:tx.toWalletId || '', categoryId:tx.categoryId || '', merchant:tx.merchant || '', note:tx.note || '', date:tx.date || TODAY }
    App.closeOverlay('overlay-tx-detail'); App._renderAddTxDetail(); App.openOverlay('overlay-add-tx')
  },
  openDuplicateTx(id) {
    const tx = S.transactions.find(t => t.id === id); if (!tx) return
    S.txMode = 'duplicate'; S.editingTxId = null
    S.tx = { step:'amount', type:tx.type, amount:String(tx.amount), walletId:tx.walletId || '', toWalletId:tx.toWalletId || '', categoryId:tx.categoryId || '', merchant:tx.merchant || '', note:tx.note || '', date:TODAY }
    App.closeOverlay('overlay-tx-detail'); App._renderAddTxAmount(); App.openOverlay('overlay-add-tx'); toast('คัดลอกรายการแล้ว แก้จำนวนเงินก่อนบันทึกได้', 'info')
  },
  _renderAddTxAmount() {
    const title = S.txMode === 'edit' ? 'แก้ไขรายการ' : S.txMode === 'duplicate' ? 'Duplicate รายการ' : 'เพิ่มรายการ'
    const amtColor = S.tx.type === 'income' ? 'var(--income)' : S.tx.type === 'transfer' ? 'var(--primary)' : 'var(--expense)'
    const display = parseFloat(S.tx.amount || 0).toLocaleString('en-US', { minimumFractionDigits: S.tx.amount.includes('.') ? (S.tx.amount.split('.')[1]?.length || 0) : 0 })
    document.getElementById('add-tx-content').innerHTML = `<div class="sheet-header" style="border-bottom:none;padding-bottom:0"><h2>${title}</h2><button class="btn-icon" onclick="App.closeOverlay('overlay-add-tx')">✕</button></div><div class="type-tabs">${[['expense','จ่าย'],['income','รับ'],['transfer','โอน']].map(([v,l]) => `<button class="type-tab${S.tx.type===v?' active':''}" onclick="App._setTxType('${v}')">${l}</button>`).join('')}</div><div class="amount-display" style="color:${amtColor}">฿${display}</div><div class="numpad">${['7','8','9','4','5','6','1','2','3','.','0','⌫'].map(k => `<button class="numpad-key${k==='⌫'?' del':''}" onclick="App._numpad('${k}')">${k}</button>`).join('')}</div><div style="padding:0 20px 20px"><button class="btn btn-primary" onclick="App._goToDetail()">ถัดไป →</button></div>`
  },
  saveTx() {
    const amt = parseFloat(S.tx.amount)
    if (!amt || amt <= 0) { toast('กรุณาระบุจำนวนเงิน', 'error'); return }
    if (!S.tx.walletId) { toast('กรุณาเลือกกระเป๋าเงิน', 'error'); return }
    if (S.tx.type === 'transfer' && !S.tx.toWalletId) { toast('กรุณาเลือกปลายทาง', 'error'); return }
    if (S.tx.type === 'transfer' && S.tx.toWalletId === S.tx.walletId) { toast('กระเป๋าต้นทางและปลายทางต้องไม่เหมือนกัน', 'error'); return }
    if (S.tx.type !== 'income' && S.tx.type !== 'transfer' && !S.tx.categoryId) { toast('กรุณาเลือกหมวดหมู่', 'error'); return }
    const wasEdit = S.txMode === 'edit'
    const tx = { id: wasEdit ? S.editingTxId : Calc.genId(), type:S.tx.type, amount:amt, walletId:S.tx.walletId, toWalletId:S.tx.toWalletId || undefined, categoryId:S.tx.categoryId || undefined, merchant:S.tx.merchant, note:S.tx.note, date:S.tx.date || getTODAY() }
    if (wasEdit) { const idx = S.transactions.findIndex(t => t.id === S.editingTxId); if (idx >= 0) { App._applyBalance(S.transactions[idx], -1); S.transactions[idx] = tx; App._applyBalance(tx, 1) } }
    else { S.transactions.unshift(tx); App._applyBalance(tx, 1) }
    App._registerMerchantFromTx(tx); S.txMode = 'add'; S.editingTxId = null
    persist(); App.closeOverlay('overlay-add-tx'); App.render(); toast(wasEdit ? 'แก้ไขรายการแล้ว' : 'บันทึกรายการแล้ว', 'success')
  },
  _renderTxDetail() {
    const tx = S.transactions.find(t => t.id === S.selectedTxId); if (!tx) return
    const cat = App._findCat(tx.categoryId), wallet = S.wallets.find(w => w.id === tx.walletId), toWal = S.wallets.find(w => w.id === tx.toWalletId)
    const amtColor = tx.type === 'income' ? 'var(--income)' : tx.type === 'transfer' ? 'var(--primary)' : 'var(--expense)'
    document.getElementById('tx-detail-content').innerHTML = `<div style="text-align:center;margin-bottom:20px"><div style="font-size:48px;font-weight:800;color:${amtColor}">${tx.type==='income'?'+':tx.type==='expense'?'-':''}${Calc.fmt(tx.amount)}</div><div style="font-size:14px;color:var(--muted);margin-top:6px">${Calc.labelDate(tx.date)}</div></div><div>${cat ? `<div class="detail-row"><span class="detail-label">หมวดหมู่</span><span class="detail-value">${cat.icon} ${cat.label}</span></div>` : ''}${wallet ? `<div class="detail-row"><span class="detail-label">กระเป๋าเงิน</span><span class="detail-value">${wallet.icon} ${wallet.name}</span></div>` : ''}${toWal ? `<div class="detail-row"><span class="detail-label">ไปยัง</span><span class="detail-value">${toWal.icon} ${toWal.name}</span></div>` : ''}${tx.merchant ? `<div class="detail-row"><span class="detail-label">ร้านค้า</span><span class="detail-value">${tx.merchant}</span></div>` : ''}${tx.note ? `<div class="detail-row"><span class="detail-label">หมายเหตุ</span><span class="detail-value">${tx.note}</span></div>` : ''}<div class="detail-row"><span class="detail-label">ประเภท</span><span class="detail-value">${App._txTypeLabel(tx.type)}</span></div></div><div class="tx-action-grid"><button class="btn btn-secondary" onclick="App.openEditTx('${tx.id}')">✏️ แก้ไข</button><button class="btn btn-secondary" onclick="App.openDuplicateTx('${tx.id}')">⧉ Duplicate</button></div><div style="margin-top:10px">${S.deleteConfirm ? `<button class="btn btn-danger" onclick="App.confirmDeleteTx()">ยืนยันการลบ</button><button class="btn btn-secondary mt-8" onclick="App._cancelDelete()">ยกเลิก</button>` : `<button class="btn btn-outline" onclick="App.deleteTx()">🗑 ลบรายการ</button>`}</div>`
  },

  renderWallets() {
    App._ensureV2State()
    const g = Calc.getWalletGroups(S.wallets)
    document.getElementById('wallets-summary').innerHTML = `<div style="flex:1;background:rgba(5,150,105,.12);border-radius:14px;padding:12px"><div style="font-size:12px;color:var(--muted)">สินทรัพย์รวม</div><div style="font-size:18px;font-weight:800;color:var(--income)">${Calc.fmt(g.assetTotal)}</div></div><div style="flex:1;background:rgba(220,38,38,.12);border-radius:14px;padding:12px"><div style="font-size:12px;color:var(--muted)">หนี้สินรวม</div><div style="font-size:18px;font-weight:800;color:var(--expense)">${Calc.fmt(g.liabilityTotal)}</div></div>`
    const section = (title, icon, list, empty) => `<div class="wallet-section-title">${icon} ${title}</div>${list.length ? list.map(w => App._walletCard(w)).join('') : `<div class="card card-pad" style="font-size:13px;color:var(--muted);margin-bottom:12px">${empty}</div>`}`
    document.getElementById('wallets-content').innerHTML = `<div style="display:flex;gap:8px;margin-bottom:10px"><button class="btn btn-secondary btn-sm" onclick="App.refreshMarketPrices()">↻ Refresh ราคา</button><button class="btn btn-secondary btn-sm" onclick="App.openWalletForm(null)">+ เพิ่มกระเป๋า</button></div>${section('สินทรัพย์','🏦',g.assets,'ยังไม่มีสินทรัพย์')}${section('หนี้สิน','💳',g.liabilities,'ยังไม่มีบัตรเครดิต')}${section('การลงทุน','📈',g.investments,'เพิ่มทอง / Crypto / FCD เพื่อดูราคาอ้างอิง')}`
  },
  _walletCard(w) {
    const isCC = w.type === 'credit', isInv = ['gold','crypto','fcd'].includes(w.type), owed = Math.abs(w.balance)
    const usedPct = isCC && w.limit ? Math.min((owed / w.limit) * 100, 100) : 0, due = isCC && w.dueDay ? Calc.getDueDate(w.dueDay) : null, avail = isCC && w.limit ? w.limit - owed : 0
    const price = isInv ? App._marketText(w) : ''
    return `<div class="wallet-card" style="background:linear-gradient(135deg,${w.color},${w.color}BB)" onclick="${isCC ? `App.openCCDetail('${w.id}')` : `App.openWalletForm('${w.id}')`}"><div class="wc-header"><div><div class="wc-name">${w.icon} ${w.name}</div><div class="wc-type">${App._walletTypeLabel(w.type)} ${price ? `· ${price}` : ''}</div></div>${isCC ? `<button class="wc-pay-btn" onclick="event.stopPropagation();App.openCCPay('${w.id}')">ชำระ</button>` : isInv ? `<span class="invest-badge">Market</span>` : ''}</div><div class="wc-balance">${isCC ? '-' : ''}${Calc.fmt(isCC ? owed : w.balance)}</div>${isCC && w.limit ? `<div class="wc-limit"><div class="wc-prog-bar"><div class="wc-prog-fill" style="width:${usedPct}%;background:${usedPct > 80 ? 'rgba(252,165,165,.9)' : 'rgba(255,255,255,.8)'}"></div></div><div class="wc-prog-info"><span>ใช้ไป ${usedPct.toFixed(0)}% · คงเหลือ ${Calc.fmt(avail)}</span>${due ? `<span>ครบ ${due.dueStr} (${due.daysLeft}ว.)</span>` : ''}</div></div>` : ''}</div>`
  },
  async refreshMarketPrices() {
    const next = {}
    try { const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,binancecoin,tether&vs_currencies=thb,usd'); if (r.ok) next.crypto = await r.json() } catch {}
    try { const r = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=THB,EUR,JPY,GBP,CNY'); if (r.ok) next.fx = await r.json() } catch {}
    try { const r = await fetch('https://stooq.com/q/l/?s=xauusd&f=sd2t2ohlcv&h&e=csv'); if (r.ok) next.goldCsv = await r.text() } catch {}
    next.updatedAt = new Date().toISOString(); S.marketPrices = next; persist(); App.renderWallets(); toast('อัปเดตราคาอ้างอิงแล้ว', 'success')
  },
  _marketText(w) {
    const p = S.marketPrices || {}
    if (w.type === 'crypto') { const coin = (w.symbol || w.name || '').toLowerCase(); const map = {btc:'bitcoin', bitcoin:'bitcoin', eth:'ethereum', ethereum:'ethereum', bnb:'binancecoin', usdt:'tether'}; const id = map[coin] || map[coin.replace(/[^a-z]/g,'')]; const thb = id && p.crypto?.[id]?.thb; return thb ? `${coin.toUpperCase()} ${Calc.fmt(thb)}` : 'CoinGecko' }
    if (w.type === 'fcd') { const cur = (w.currency || w.symbol || 'USD').toUpperCase(); const rate = cur === 'USD' ? p.fx?.rates?.THB : (p.fx?.rates?.THB && p.fx?.rates?.[cur] ? p.fx.rates.THB / p.fx.rates[cur] : null); return rate ? `${cur}/THB ${rate.toFixed(2)}` : 'Frankfurter FX' }
    if (w.type === 'gold') { const line = (p.goldCsv || '').split('\n')[1]; const close = line ? parseFloat(line.split(',').at(-2)) : 0; return close ? `XAU/USD ${close.toLocaleString()}` : 'Stooq XAUUSD' }
    return ''
  },
  openWalletForm(walletId) {
    S.editingWalletId = walletId
    const w = walletId ? S.wallets.find(x => x.id === walletId) : null
    const COLORS = ['#2563EB','#7C3AED','#DC2626','#059669','#D97706','#0891B2','#BE185D','#374151']
    const TYPES = [['bank','🏦','ธนาคาร'],['cash','💵','เงินสด'],['ewallet','📱','TrueMoney'],['credit','💳','บัตรเครดิต'],['gold','🥇','ทอง'],['crypto','₿','Crypto'],['fcd','💱','FCD']]
    document.getElementById('wallet-form-title').textContent = w ? 'แก้ไขกระเป๋า' : 'เพิ่มกระเป๋าเงิน'
    document.getElementById('wallet-form-content').innerHTML = `<div class="form-group"><label class="form-label">ชื่อกระเป๋า</label><input class="form-input" id="wf-name" value="${w?.name||''}"></div><div class="form-group"><label class="form-label">ประเภท</label><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px" id="wf-type-grid">${TYPES.map(([v,icon,lbl]) => `<button class="cat-btn${(w?.type||'bank')===v?' active':''}" onclick="App._selectWalletType('${v}')" data-type="${v}">${icon}<br><small>${lbl}</small></button>`).join('')}</div><input type="hidden" id="wf-type" value="${w?.type||'bank'}"></div><div class="form-group"><label class="form-label">สี</label><div class="color-row" id="wf-color-row">${COLORS.map(c => `<div class="color-dot${(w?.color||'#2563EB')===c?' selected':''}" style="background:${c}" onclick="App._selectWalletColor('${c}')" data-color="${c}"></div>`).join('')}</div><input type="hidden" id="wf-color" value="${w?.color||'#2563EB'}"></div><div class="form-group"><label class="form-label" id="wf-balance-label">${w?.type==='credit'?'ยอดค้างชำระ (฿)':'มูลค่าปัจจุบัน (฿)'}</label><input class="form-input" type="number" id="wf-balance" value="${w ? Math.abs(w.balance) : ''}"></div><div id="wf-cc-fields" style="${(w?.type||'bank')==='credit'?'':'display:none'}"><div class="form-group"><label class="form-label">วงเงิน (฿)</label><input class="form-input" type="number" id="wf-limit" value="${w?.limit||''}"></div><div class="form-group"><label class="form-label">วันครบกำหนดชำระ</label><input class="form-input" type="number" id="wf-dueday" min="1" max="31" value="${w?.dueDay||''}"></div><div class="form-group"><label class="form-label">วันตัดรอบบัญชี</label><input class="form-input" type="number" id="wf-cycle-day" min="1" max="31" value="${w?.cycleDay||''}"></div></div><div id="wf-invest-fields" style="${['gold','crypto','fcd'].includes(w?.type||'bank')?'':'display:none'}"><div class="form-group"><label class="form-label">Symbol / สกุลเงิน</label><input class="form-input" id="wf-symbol" placeholder="BTC, ETH, USD, XAU" value="${w?.symbol||w?.currency||''}"></div></div><div class="flex-row">${w ? `<button class="btn btn-outline flex-1" onclick="App.deleteWallet('${w.id}')">ลบ</button>` : ''}<button class="btn btn-primary${w?'':' flex-1'}" onclick="App.saveWallet()" style="${w?'flex:2':''}">${w ? 'บันทึก' : 'เพิ่มกระเป๋า'}</button></div>`
    App.openOverlay('overlay-wallet-form')
  },
  _selectWalletType(type) {
    document.getElementById('wf-type').value = type
    document.querySelectorAll('#wf-type-grid .cat-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type))
    document.getElementById('wf-cc-fields').style.display = type === 'credit' ? '' : 'none'
    document.getElementById('wf-invest-fields').style.display = ['gold','crypto','fcd'].includes(type) ? '' : 'none'
    document.getElementById('wf-balance-label').textContent = type === 'credit' ? 'ยอดค้างชำระ (฿)' : 'มูลค่าปัจจุบัน (฿)'
  },
  saveWallet() {
    const name = document.getElementById('wf-name').value.trim(), type = document.getElementById('wf-type').value, color = document.getElementById('wf-color').value
    const balance = parseFloat(document.getElementById('wf-balance').value) || 0, limit = parseFloat(document.getElementById('wf-limit')?.value) || 50000, dueDay = parseInt(document.getElementById('wf-dueday')?.value) || 5, cycleDay = parseInt(document.getElementById('wf-cycle-day')?.value) || 25
    const symbol = document.getElementById('wf-symbol')?.value.trim().toUpperCase() || ''
    const ICONS = { bank:'🏦', cash:'💵', ewallet:'📱', credit:'💳', gold:'🥇', crypto:'₿', fcd:'💱' }
    if (!name) { toast('กรุณากรอกชื่อกระเป๋า', 'error'); return }
    const data = { name, type, color, icon: ICONS[type] || '💳', balance: type === 'credit' ? -balance : balance, ...(type === 'credit' && { limit, dueDay, cycleDay }), ...(['gold','crypto','fcd'].includes(type) && { symbol, currency: type === 'fcd' ? (symbol || 'USD') : undefined }) }
    if (S.editingWalletId) { const idx = S.wallets.findIndex(w => w.id === S.editingWalletId); if (idx >= 0) S.wallets[idx] = { ...S.wallets[idx], ...data } } else S.wallets.push({ id: Calc.genId(), ...data })
    persist(); App.closeOverlay('overlay-wallet-form'); App.render(); toast(S.editingWalletId ? 'แก้ไขกระเป๋าแล้ว' : 'เพิ่มกระเป๋าแล้ว', 'success')
  },

  renderMore() {
    App._ensureV2State()
    const ACCENT_COLORS = ['#2563EB','#7C3AED','#DC2626','#059669','#D97706','#0891B2','#BE185D','#374151']
    const budgetCount = S.budgets.filter(b => b.monthlyLimit > 0).length + S.incomeBudgets.filter(b => b.monthlyLimit > 0).length
    document.getElementById('more-content').innerHTML = `<div style="padding:0 16px"><div style="font-size:20px;font-weight:800;padding:20px 0 4px">เพิ่มเติม</div><div class="sec-title">การเงิน</div><div class="card card-pad"><div class="settings-row" onclick="App.openBudgetScreen()"><div class="s-icon">💰</div><div class="s-label">งบประมาณรายรับ/รายจ่าย</div><div class="s-value">${budgetCount ? budgetCount + ' หมวด' : 'ยังไม่ตั้ง'}</div><div class="s-arrow">›</div></div><div class="settings-row" onclick="App.openRecurringScreen()"><div class="s-icon">🔁</div><div class="s-label">รายการประจำ</div><div class="s-value">${S.recurring.length} รายการ</div><div class="s-arrow">›</div></div><div class="settings-row" onclick="App.openCategoryScreen('expense')"><div class="s-icon">🏷️</div><div class="s-label">จัดการหมวดหมู่</div><div class="s-value">รายรับ/รายจ่าย</div><div class="s-arrow">›</div></div><div class="settings-row" onclick="App.openMerchantScreen()"><div class="s-icon">🏪</div><div class="s-label">ร้านค้า / Platform</div><div class="s-value">${S.merchants.length} ร้าน</div><div class="s-arrow">›</div></div></div><div class="sec-title">การแสดงผล</div><div class="card card-pad"><div class="settings-row" onclick="App.toggleDark()"><div class="s-icon">🌙</div><div class="s-label">โหมดมืด</div><button class="toggle${S.settings.darkMode ? ' on' : ''}" onclick="event.stopPropagation();App.toggleDark()"></button></div><div style="padding:14px 0;border-bottom:1px solid var(--border)"><div style="font-size:15px;font-weight:600;margin-bottom:12px">🎨 สีธีม</div><div class="color-row">${ACCENT_COLORS.map(c => `<div class="color-dot${S.settings.accentColor===c?' selected':''}" style="background:${c}" onclick="App.setAccent('${c}')"></div>`).join('')}</div></div></div><div class="sec-title">ข้อมูล</div><div class="card card-pad"><div class="settings-row" onclick="App.exportData()"><div class="s-icon">📤</div><div class="s-label">ส่งออกข้อมูล (JSON)</div><div class="s-arrow">›</div></div><div class="settings-row" onclick="document.getElementById('import-file').click()"><div class="s-icon">📥</div><div class="s-label">นำเข้าข้อมูล (JSON)</div><div class="s-arrow">›</div></div><input type="file" id="import-file" accept=".json" style="display:none" onchange="App.importData(this)"><div class="settings-row" onclick="App.resetData()"><div class="s-icon">🔄</div><div class="s-label" style="color:var(--expense)">รีเซ็ตข้อมูลทั้งหมด</div><div class="s-arrow" style="color:var(--expense)">›</div></div></div><div style="text-align:center;padding:32px 0 8px"><div style="font-size:40px">💰</div><div style="font-size:16px;font-weight:700;margin-top:8px">Money Tracker</div><div style="font-size:12px;color:var(--muted);margin-top:4px">v2 · Offline-first PWA</div><div style="font-size:12px;color:var(--muted);margin-top:2px">ข้อมูลหลักเก็บในเครื่องของคุณ</div></div></div>`
  },

  openBudgetScreen() {
    const rows = kind => S.categories[kind].map(cat => { const list = kind === 'income' ? S.incomeBudgets : S.budgets; const b = list.find(x => x.categoryId === cat.id); const spent = S.transactions.filter(t => t.date.startsWith(THIS_MONTH) && t.type === kind && t.categoryId === cat.id).reduce((s,t) => s+t.amount, 0); return { cat, limit:b?.monthlyLimit || 0, spent, kind } })
    const html = `<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>ตั้งงบประมาณ</h2><button class="btn btn-primary btn-sm" onclick="App.saveBudgets()" style="width:auto;padding:8px 16px">บันทึก</button></div><div class="sub-scroll"><p style="font-size:13px;color:var(--muted);margin-bottom:16px">ตั้งงบรายจ่ายและเป้ารายรับรายเดือน (0 = ไม่กำหนด)</p>${['expense','income'].map(kind => `<div class="sec-title">${kind==='expense'?'รายจ่าย':'รายรับ'}</div>${rows(kind).map(r => `<div style="margin-bottom:16px"><label class="form-label">${r.cat.icon} ${r.cat.label} · ${kind==='expense'?'ใช้':'รับ'}แล้ว ${Calc.fmt(r.spent)}</label><input class="form-input" type="number" id="budget-${kind}-${r.cat.id}" value="${r.limit || ''}" placeholder="0 = ไม่กำหนด"></div>`).join('')}`).join('')}</div>`
    App.openSubScreen(html)
  },
  saveBudgets() {
    const saveList = kind => { const key = kind === 'income' ? 'incomeBudgets' : 'budgets'; S[key] ||= []; S.categories[kind].forEach(cat => { const val = parseFloat(document.getElementById(`budget-${kind}-${cat.id}`)?.value) || 0; const idx = S[key].findIndex(b => b.categoryId === cat.id); if (val > 0) { if (idx >= 0) S[key][idx].monthlyLimit = val; else S[key].push({ categoryId:cat.id, monthlyLimit:val }) } else if (idx >= 0) S[key].splice(idx,1) }) }
    saveList('expense'); saveList('income'); persist(); App.closeSubScreen(); toast('บันทึกงบประมาณแล้ว', 'success')
  },

  openRecurringScreen() { App._ensureV2State(); App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>รายการประจำ</h2><button class="btn btn-primary btn-sm" onclick="App.openRecurringForm()" style="width:auto;padding:8px 14px">+ เพิ่ม</button></div><div class="sub-scroll"><div class="card"><div style="padding:0 16px">${S.recurring.length ? S.recurring.map(r => `<div class="recurring-item ${r.paused?'paused':''}"><div class="list-item-icon" style="background:${r.color || '#2563EB'}20">${r.icon || '🔁'}</div><div class="list-item-info"><div class="list-item-name">${r.name}</div><div class="list-item-sub">${Calc.fmt(r.amount)} · อีก ${r.everyDays || 30} วัน · ${r.categoryName || ''}</div></div><div class="recurring-actions"><button class="icon-btn" onclick="App.openRecurringForm('${r.id}')">✏️</button><button class="icon-btn" onclick="App.toggleRecurring('${r.id}')">${r.paused?'▶':'⏸'}</button><button class="icon-btn" onclick="App.deleteRecurring('${r.id}')">🗑</button></div></div>`).join('') : App._emptyState('🔁','ยังไม่มีรายการประจำ','เพิ่มค่าใช้จ่าย/รายรับที่เกิดซ้ำ')}</div></div></div>`) },
  openRecurringForm(id) { const r = id ? S.recurring.find(x => x.id === id) : null; const cats = [...S.categories.expense, ...S.categories.income]; App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.openRecurringScreen()">←</button><h2>${r?'แก้ไข':'เพิ่ม'}รายการประจำ</h2><button class="btn btn-primary btn-sm" onclick="App.saveRecurring('${id || ''}')" style="width:auto;padding:8px 14px">บันทึก</button></div><div class="sub-scroll"><div class="form-group"><label class="form-label">ชื่อรายการ</label><input class="form-input" id="rec-name" value="${r?.name || ''}"></div><div class="form-group"><label class="form-label">จำนวนเงิน</label><input class="form-input" type="number" id="rec-amount" value="${r?.amount || ''}"></div><div class="form-group"><label class="form-label">อีก X วัน</label><input class="form-input" type="number" id="rec-days" value="${r?.everyDays || 30}"></div><div class="form-group"><label class="form-label">หมวด</label><select class="form-input" id="rec-cat">${cats.map(c => `<option value="${c.id}"${r?.categoryId===c.id?' selected':''}>${c.icon} ${c.label}</option>`).join('')}</select></div></div>`) },
  saveRecurring(id) { const cat = App._findCat(document.getElementById('rec-cat').value); const data = { name:document.getElementById('rec-name').value.trim(), amount:parseFloat(document.getElementById('rec-amount').value)||0, everyDays:parseInt(document.getElementById('rec-days').value)||30, categoryId:cat?.id, categoryName:cat?.label, icon:cat?.icon, color:cat?.color, paused:false }; if (!data.name || !data.amount) { toast('กรุณากรอกชื่อและจำนวนเงิน', 'error'); return } if (id) { const idx = S.recurring.findIndex(r => r.id === id); if (idx >= 0) S.recurring[idx] = { ...S.recurring[idx], ...data } } else S.recurring.push({ id:Calc.genId(), ...data }); persist(); App.openRecurringScreen(); toast('บันทึกรายการประจำแล้ว', 'success') },
  toggleRecurring(id) { const r = S.recurring.find(x => x.id === id); if (r) r.paused = !r.paused; persist(); App.openRecurringScreen() },
  deleteRecurring(id) { if (!confirm('ลบรายการประจำนี้?')) return; S.recurring = S.recurring.filter(r => r.id !== id); persist(); App.openRecurringScreen(); toast('ลบแล้ว', 'success') },

  openCategoryScreen(type='expense', q='') { S.catManageType = type; const cats = (S.categories[type] || []).filter(c => !q || c.label.toLowerCase().includes(q.toLowerCase())); App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>จัดการหมวดหมู่</h2><button class="btn btn-primary btn-sm" onclick="App.openCategoryForm()" style="width:auto;padding:8px 14px">+ เพิ่ม</button></div><div class="sub-scroll"><div class="tab-strip"><button class="tab-btn ${type==='expense'?'active':''}" onclick="App.openCategoryScreen('expense')">รายจ่าย</button><button class="tab-btn ${type==='income'?'active':''}" onclick="App.openCategoryScreen('income')">รายรับ</button></div><input class="search-input" id="cat-search" placeholder="ค้นหาหมวดหมู่" value="${q}" oninput="App.openCategoryScreen('${type}', this.value)"><div class="card mt-12"><div style="padding:0 16px">${cats.map(c => `<div class="list-item"><div class="list-item-icon" style="background:${c.color}20">${c.icon}</div><div class="list-item-info"><div class="list-item-name">${c.label}</div><div class="list-item-sub">${c.color}</div></div><div class="recurring-actions"><button class="icon-btn" onclick="App.openCategoryForm('${c.id}')">✏️</button><button class="icon-btn" onclick="App.deleteCategory('${c.id}')">🗑</button></div></div>`).join('') || App._emptyState('🏷️','ไม่พบหมวดหมู่','')}</div></div></div>`) },
  openCategoryForm(id) { const type = S.catManageType || 'expense'; const c = id ? S.categories[type].find(x => x.id === id) : null; App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.openCategoryScreen('${type}')">←</button><h2>${c?'แก้ไข':'เพิ่ม'}หมวดหมู่</h2><button class="btn btn-primary btn-sm" onclick="App.saveCategory('${id || ''}')" style="width:auto;padding:8px 14px">บันทึก</button></div><div class="sub-scroll"><div class="form-group"><label class="form-label">ชื่อหมวดหมู่</label><input class="form-input" id="cat-name" value="${c?.label || ''}"></div><div class="form-group"><label class="form-label">อีโมจิ</label><input class="form-input" id="cat-icon" value="${c?.icon || '📦'}"></div><div class="form-group"><label class="form-label">สี</label><input class="form-input" id="cat-color" type="color" value="${c?.color || '#2563EB'}"></div></div>`) },
  saveCategory(id) { const type = S.catManageType || 'expense'; const label = document.getElementById('cat-name').value.trim(), icon = document.getElementById('cat-icon').value.trim() || '📦', color = document.getElementById('cat-color').value || '#2563EB'; if (!label) { toast('กรุณากรอกชื่อหมวดหมู่','error'); return } if (id) { const idx = S.categories[type].findIndex(c => c.id === id); if (idx >= 0) S.categories[type][idx] = { ...S.categories[type][idx], label, icon, color } } else S.categories[type].push({ id:Calc.genId(), label, icon, color }); persist(); App.openCategoryScreen(type); toast('บันทึกหมวดหมู่แล้ว','success') },
  deleteCategory(id) { const type = S.catManageType || 'expense'; if (!confirm('ลบหมวดหมู่นี้?')) return; S.categories[type] = S.categories[type].filter(c => c.id !== id); persist(); App.openCategoryScreen(type); toast('ลบหมวดหมู่แล้ว','success') },

  openMerchantScreen(q='') { App._ensureV2State(); const usage = Calc.getMerchantUsage(S.transactions); const list = S.merchants.filter(m => !q || m.name.toLowerCase().includes(q.toLowerCase())); App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>ร้านค้า / Platform</h2><button class="btn btn-primary btn-sm" onclick="App.openMerchantForm()" style="width:auto;padding:8px 14px">+ เพิ่ม</button></div><div class="sub-scroll"><input class="search-input" placeholder="ค้นหาร้านค้า" value="${q}" oninput="App.openMerchantScreen(this.value)"><div class="card mt-12"><div style="padding:0 16px">${list.map(m => `<div class="list-item"><div class="list-item-icon" style="background:${m.color}20">${m.emoji || '🏪'}</div><div class="list-item-info"><div class="list-item-name">${m.name}</div><div class="list-item-sub">ใช้จ่าย ${usage[m.name] || 0} ครั้ง</div></div><div class="recurring-actions"><button class="icon-btn" onclick="App.openMerchantForm('${m.id}')">✏️</button><button class="icon-btn" onclick="App.deleteMerchant('${m.id}')">🗑</button></div></div>`).join('') || App._emptyState('🏪','ไม่พบร้านค้า','')}</div></div></div>`) },
  openMerchantForm(id) { const m = id ? S.merchants.find(x => x.id === id) : null; App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.openMerchantScreen()">←</button><h2>${m?'แก้ไข':'เพิ่ม'}ร้านค้า</h2><button class="btn btn-primary btn-sm" onclick="App.saveMerchant('${id || ''}')" style="width:auto;padding:8px 14px">บันทึก</button></div><div class="sub-scroll"><div class="form-group"><label class="form-label">ชื่อร้านค้า</label><input class="form-input" id="mer-name" value="${m?.name || ''}"></div><div class="form-group"><label class="form-label">อีโมจิ</label><input class="form-input" id="mer-emoji" value="${m?.emoji || '🏪'}"></div><div class="form-group"><label class="form-label">สี</label><input class="form-input" id="mer-color" type="color" value="${m?.color || '#2563EB'}"></div></div>`) },
  saveMerchant(id) { const data = { name:document.getElementById('mer-name').value.trim(), emoji:document.getElementById('mer-emoji').value.trim() || '🏪', color:document.getElementById('mer-color').value || '#2563EB' }; if (!data.name) { toast('กรุณากรอกชื่อร้านค้า','error'); return } if (id) { const idx = S.merchants.findIndex(m => m.id === id); if (idx >= 0) S.merchants[idx] = { ...S.merchants[idx], ...data } } else S.merchants.push({ id:Calc.genId(), ...data }); persist(); App.openMerchantScreen(); toast('บันทึกร้านค้าแล้ว','success') },
  deleteMerchant(id) { if (!confirm('ลบร้านค้านี้?')) return; S.merchants = S.merchants.filter(m => m.id !== id); persist(); App.openMerchantScreen(); toast('ลบร้านค้าแล้ว','success') },
  _registerMerchantFromTx(tx) { App._ensureV2State(); if (!tx.merchant) return; if (!S.merchants.some(m => m.name.toLowerCase() === tx.merchant.toLowerCase())) S.merchants.push({ id:Calc.genId(), name:tx.merchant, emoji:'🏪', color:'#64748B' }) },

  openCCDetail(cardId) {
    const card = S.wallets.find(w => w.id === cardId); if (!card) return
    const benefit = S.ccBenefits?.[cardId] || { enabled:false, points:{bahtPerPoint:25,multiplier:1}, cashback:{percent:0,everyBaht:1} }
    const period = Calc.getStatementPeriod(card.cycleDay || 25)
    const txns = S.transactions.filter(t => t.walletId === cardId).sort((a,b) => b.date.localeCompare(a.date)).slice(0, 20)
    const rewards = Calc.getCardRewards(txns.filter(t => t.type === 'expense' && t.date >= period.start && t.date <= period.end), benefit)
    const owed = Math.abs(card.balance), usedPct = card.limit ? Math.min((owed / card.limit) * 100, 100) : 0, due = card.dueDay ? Calc.getDueDate(card.dueDay) : null
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>${card.icon} ${card.name}</h2><button class="btn btn-primary btn-sm" onclick="App.closeSubScreen();App.openCCPay('${cardId}')" style="width:auto;padding:8px 14px">ชำระ</button></div><div class="sub-scroll"><div style="background:linear-gradient(135deg,${card.color},${card.color}BB);border-radius:20px;padding:24px;color:#fff;margin-bottom:16px"><div style="font-size:12px;opacity:.75;margin-bottom:20px">รอบบัญชีตัดวันที่ ${card.cycleDay || 25} · ชำระวันที่ ${card.dueDay || '-'}</div><div style="font-size:13px;opacity:.7;margin-bottom:6px">ยอดค้างชำระ</div><div style="font-size:38px;font-weight:800;letter-spacing:-1px;margin-bottom:20px">${Calc.fmt(owed)}</div>${card.limit ? `<div style="background:rgba(255,255,255,.2);border-radius:4px;height:7px;overflow:hidden;margin-bottom:8px"><div style="height:100%;width:${usedPct}%;background:${usedPct>80?'#FCA5A5':'rgba(255,255,255,.85)'};border-radius:4px"></div></div><div style="font-size:12px;opacity:.75">ใช้ ${usedPct.toFixed(0)}% ${due ? `· ครบ ${due.dueStr} (${due.daysLeft}ว.)` : ''}</div>` : ''}</div><div class="card card-pad" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:14px;font-weight:800">สิทธิประโยชน์รอบนี้</div><div style="font-size:12px;color:var(--muted)">${period.start} ถึง ${period.end}</div></div><button class="btn btn-secondary btn-sm" onclick="App.openCCBenefitScreen('${cardId}')" style="width:auto">ตั้งค่า</button></div><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:12px"><div class="mini-stat"><div>คะแนน</div><strong>${rewards.points.toLocaleString('en-US')}</strong></div><div class="mini-stat"><div>Cashback</div><strong>${Calc.fmt(rewards.cashback)}</strong></div></div><div style="font-size:12px;color:var(--muted);margin-top:10px">${benefit.enabled ? 'คำนวณจาก logic ที่ตั้งไว้' : 'ยังไม่เปิดใช้สิทธิประโยชน์บัตรนี้'}</div></div><div style="font-size:14px;font-weight:700;margin-bottom:8px">รายการล่าสุด</div><div class="card"><div style="padding:0 16px">${txns.length ? txns.map(tx => App._txRow(tx)).join('') : App._emptyState('📋','ยังไม่มีรายการ','')}</div></div></div>`)
    setTimeout(() => App._bindTxRows('sub-screen'), 0)
  },
  openCCBenefitScreen(cardId) { const b = S.ccBenefits?.[cardId] || { enabled:false, points:{}, cashback:{} }, p = b.points || {}, c = b.cashback || {}; const f = (id,l,v) => `<div class="form-group"><label class="form-label">${l}</label><input class="form-input" type="number" step="0.01" id="${id}" value="${v || ''}" placeholder="0"></div>`; App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.openCCDetail('${cardId}')">←</button><h2>สิทธิประโยชน์บัตร</h2><button class="btn btn-primary btn-sm" onclick="App.saveCCBenefit('${cardId}')" style="width:auto;padding:8px 14px">บันทึก</button></div><div class="sub-scroll"><div class="benefits-section card"><div class="benefits-toggle-row"><div style="font-weight:800">เปิดใช้การคำนวณ</div><button class="toggle${b.enabled?' on':''}" id="ccb-enabled" onclick="this.classList.toggle('on')"></button></div></div><div class="sec-title">คะแนนสะสม</div><div class="card card-pad">${f('ccb-bahtPerPoint','คะแนนสะสม X บาท = 1 คะแนน',p.bahtPerPoint)}${f('ccb-pointEvery','ทุก X บาทได้ 1 คะแนน',p.pointPerBahtEvery)}${f('ccb-multi','คะแนนเพิ่ม X เท่า',p.multiplier || 1)}${f('ccb-maxTxnPoint','สูงสุด/รายการ (คะแนน)',p.maxPerTxn)}${f('ccb-maxCyclePoint','สูงสุด/รอบบัญชี (คะแนน)',p.maxPerCycle)}</div><div class="sec-title">Cashback</div><div class="card card-pad">${f('ccb-cbPercent','รับเงินคืน X%',c.percent)}${f('ccb-cbMin','ขั้นต่ำ (฿)',c.minSpend)}${f('ccb-cbTier','ขั้นบันไดเริ่มที่ (฿)',c.tierThreshold)}${f('ccb-cbEvery','คิดทุกๆ X บาท (floor division)',c.everyBaht || 1)}${f('ccb-cbMaxTxn','สูงสุด/รายการ (฿)',c.maxPerTxn)}${f('ccb-cbMaxCycle','สูงสุด/รอบบัญชี (฿)',c.maxPerCycle)}</div></div>`) },
  saveCCBenefit(cardId) { const val = id => parseFloat(document.getElementById(id)?.value) || 0; S.ccBenefits[cardId] = { enabled:document.getElementById('ccb-enabled').classList.contains('on'), points:{ bahtPerPoint:val('ccb-bahtPerPoint'), pointPerBahtEvery:val('ccb-pointEvery'), multiplier:val('ccb-multi') || 1, maxPerTxn:val('ccb-maxTxnPoint'), maxPerCycle:val('ccb-maxCyclePoint') }, cashback:{ percent:val('ccb-cbPercent'), minSpend:val('ccb-cbMin'), tierThreshold:val('ccb-cbTier'), everyBaht:val('ccb-cbEvery') || 1, maxPerTxn:val('ccb-cbMaxTxn'), maxPerCycle:val('ccb-cbMaxCycle') } }; persist(); App.openCCDetail(cardId); toast('บันทึกสิทธิประโยชน์แล้ว','success') },
  _walletTypeLabel(type) { return ({ bank:'บัญชีธนาคาร', cash:'เงินสด', ewallet:'TrueMoney / E-Wallet', credit:'บัตรเครดิต', saving:'ออมทรัพย์', gold:'ทอง', crypto:'Crypto', fcd:'บัญชี FCD' })[type] || type },
})


Object.assign(App, {
  importData(input) {
    const file = input.files[0]
    if (!file) return
    Storage.importJSON(file, data => {
      if (confirm('นำเข้าข้อมูลจะแทนที่ข้อมูลปัจจุบัน ยืนยัน?')) {
        S.transactions = data.transactions || []
        S.wallets = data.wallets || []
        S.categories = data.categories || S.categories
        S.budgets = data.budgets || []
        S.recurring = data.recurring || []
        S.merchants = data.merchants || []
        S.ccBenefits = data.ccBenefits || {}
        S.incomeBudgets = data.incomeBudgets || []
  S.marketPrices = data.marketPrices || {}
  S.settings.hideMoney = !!S.settings.hideMoney
        persist(); App.render()
        toast('นำเข้าข้อมูลสำเร็จ', 'success')
      }
      input.value = ''
    }, err => { toast('นำเข้าล้มเหลว: ' + err, 'error'); input.value = '' })
  },
})

// ── Init ──────────────────────────────────────────────────────
function init() {
  // Load data
  const data = Storage.init()
  S.transactions = data.transactions
  S.wallets      = data.wallets
  S.categories   = data.categories
  S.budgets      = data.budgets
  S.settings     = data.settings
  S.recurring    = data.recurring || []
  S.merchants    = data.merchants || []
  S.ccBenefits   = data.ccBenefits || {}
  S.incomeBudgets = data.incomeBudgets || []
  S.marketPrices  = data.marketPrices  || {}

  applyTheme()

  // Bottom nav
  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => App.showPage(btn.dataset.tab))
  })

  // Initial render
  App.render()

  // PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker_v2.js').catch(() => {})
  }
}

init()

/* V2.1 quick patch */
;(function(){
const COLORS10=['#2563EB','#7C3AED','#DC2626','#059669','#D97706','#0891B2','#BE185D','#16A34A','#EA580C','#475569'];
const EMOJIS30=['🍔','🚗','🛍️','💊','🎬','💡','📚','📦','💼','💻','📈','💰','🏠','☕','🍱','✈️','🧾','🎮','🐶','🎁','💄','🏋️','🚌','🛒','📱','💳','🏦','🥇','₿','💱'];
const oldDash=App.renderDashboard;
App.renderDashboard=function(){ oldDash.call(App); const h=document.querySelector('#dashboard-content .grad-header'); if(h&&!h.querySelector('.privacy-toggle')) h.insertAdjacentHTML('afterbegin',`<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button class="privacy-toggle" onclick="App.toggleHideMoney()">${S.settings.hideMoney?'🙈 แสดงตัวเลข':'👁️ ซ่อนตัวเลข'}</button></div>`); if(S.settings.hideMoney) document.querySelectorAll('#dashboard-content .grad-s-value,#dashboard-content .nw-value,#dashboard-content strong').forEach(e=>{if(e.textContent.includes('฿'))e.textContent='฿••••'}); };
const oldDetail=App._renderAddTxDetail;
App._toggleTxFlag=function(k){S.tx[k]=!S.tx[k];App._renderAddTxDetail()};
App._renderAddTxDetail=function(){ oldDetail.call(App); const body=document.querySelector('#add-tx-content .sheet-body'); if(!body)return; if(S.tx.type==='transfer'){ const merchant=[...body.querySelectorAll('.form-group')].find(x=>x.textContent.includes('ร้านค้า / ที่มา')); if(merchant)merchant.remove(); const labels=[...body.querySelectorAll('.form-label')]; labels.forEach(l=>{if(l.textContent.trim()==='จาก')l.textContent='โอนจาก'; if(l.textContent.trim()==='ไปยัง')l.textContent='โอนไปยัง';}); }
 if(S.tx.type==='expense'&&!body.querySelector('.tx-flag-grid')){ const note=[...body.querySelectorAll('.form-group')].find(x=>x.textContent.includes('หมายเหตุ')); note?.insertAdjacentHTML('beforebegin',`<div class="form-group"><label class="form-label">รูปแบบรายการ</label><div class="tx-flag-grid"><button type="button" class="flag-pill${S.tx.isRecurring?' active':''}" onclick="App._toggleTxFlag('isRecurring')">🔁 ประจำ</button><button type="button" class="flag-pill${S.tx.isInstallment?' active':''}" onclick="App._toggleTxFlag('isInstallment')">🧾 ผ่อน</button></div></div>${S.tx.isInstallment?`<div class="form-group"><label class="form-label">จำนวนงวดทั้งหมด</label><input class="form-input" type="number" value="${S.tx.installmentMonths||''}" oninput="App._txField('installmentMonths',this.value)"></div>`:''}`); }
};
const oldOpen=App.openAddTx;App.openAddTx=function(){oldOpen.call(App);Object.assign(S.tx,{isRecurring:false,isInstallment:false,installmentMonths:''});};
const oldEdit=App.openEditTx;App.openEditTx=function(id){const tx=S.transactions.find(t=>t.id===id);oldEdit.call(App,id);if(tx){Object.assign(S.tx,{isRecurring:!!tx.isRecurring,isInstallment:!!tx.isInstallment,installmentMonths:tx.installmentMonths||''});App._renderAddTxDetail();}};
const oldDup=App.openDuplicateTx;App.openDuplicateTx=function(id){const tx=S.transactions.find(t=>t.id===id);oldDup.call(App,id);if(tx)Object.assign(S.tx,{isRecurring:!!tx.isRecurring,isInstallment:!!tx.isInstallment,installmentMonths:tx.installmentMonths||''});};
const oldSave=App.saveTx;App.saveTx=function(){ const before=S.transactions.length; oldSave.call(App); const tx=S.transactions[0]; if(tx&&S.transactions.length>=before){tx.isRecurring=!!S.tx.isRecurring;tx.isInstallment=!!S.tx.isInstallment;tx.installmentMonths=tx.isInstallment?(parseInt(S.tx.installmentMonths)||0):undefined;tx.installmentNo=tx.isInstallment?1:undefined; if(tx.type==='transfer')tx.merchant=''; persist(); }};
const oldRow=App._txRow;App._txRow=function(tx){ if(tx.type==='transfer'){ const w=S.wallets.find(x=>x.id===tx.walletId),to=S.wallets.find(x=>x.id===tx.toWalletId); tx={...tx,merchant:`${w?.name||'ไม่ระบุ'} → ${to?.name||'ไม่ระบุ'}`,note:tx.note||'โอนเงิน'}; } let html=oldRow.call(App,tx); if(S.settings.hideMoney)html=html.replace(/[-+↔ ]?฿[\d,\.]+/g,'฿••••'); return html; };
Calc.getCardRewards=function(txns,b){const pe=!!(b?.points?.enabled||b?.enabled),ce=!!(b?.cashback?.enabled||b?.enabled),p=b?.points||{},c=b?.cashback||{};let points=0,cashback=0;(txns||[]).forEach(t=>{if(pe){let pt=0;if(p.bahtPerPoint)pt+=Math.floor(t.amount/p.bahtPerPoint);if(p.pointPerBahtEvery)pt+=Math.floor(t.amount/p.pointPerBahtEvery);pt*=p.multiplier||1;if(p.maxPerTxn)pt=Math.min(pt,p.maxPerTxn);points+=pt}if(ce&&(!c.minSpend||t.amount>=c.minSpend)){let base=c.everyBaht?Math.floor(t.amount/c.everyBaht)*c.everyBaht:t.amount,cb=base*((c.percent||0)/100);if(c.tierThreshold&&t.amount<c.tierThreshold)cb=0;if(c.maxPerTxn)cb=Math.min(cb,c.maxPerTxn);cashback+=cb}});if(p.maxPerCycle)points=Math.min(points,p.maxPerCycle);if(c.maxPerCycle)cashback=Math.min(cashback,c.maxPerCycle);return{points:Math.floor(points),cashback:Math.round(cashback*100)/100}};
App._benefit=id=>S.ccBenefits?.[id]||{points:{},cashback:{}};App._rewardForTx=tx=>{const card=S.wallets.find(w=>w.id===tx.walletId&&w.type==='credit');return card&&tx.type==='expense'?Calc.getCardRewards([tx],App._benefit(card.id)):{points:0,cashback:0}};
const oldTxDetail=App._renderTxDetail;App._renderTxDetail=function(){oldTxDetail.call(App);const tx=S.transactions.find(t=>t.id===S.selectedTxId),box=document.getElementById('tx-detail-content');if(!tx||!box)return;const r=App._rewardForTx(tx);let extra='';if(tx.isRecurring)extra+='<div class="detail-row"><span class="detail-label">รายการประจำ</span><span class="detail-value">เปิดใช้</span></div>';if(tx.isInstallment)extra+=`<div class="detail-row"><span class="detail-label">ผ่อนชำระ</span><span class="detail-value">งวด ${tx.installmentNo||1}/${tx.installmentMonths||'?'}</span></div>`;if(r.points||r.cashback)extra+=`<div class="detail-row"><span class="detail-label">สิทธิประโยชน์โดยประมาณ</span><span class="detail-value">${r.points?'+'+r.points.toLocaleString('en-US')+' pt':''}${r.points&&r.cashback?' · ':''}${r.cashback?'+'+Calc.fmt(r.cashback):''}</span></div>`;box.innerHTML=box.innerHTML.replace('<div class="detail-row"><span class="detail-label">ประเภท</span>',extra+'<div class="detail-row"><span class="detail-label">ประเภท</span>')};
App.openCCBenefitScreen=function(id){const b=App._benefit(id),p=b.points||{},c=b.cashback||{},f=(i,l,v)=>`<div class="form-group"><label class="form-label">${l}</label><input class="form-input" type="number" step="0.01" id="${i}" value="${v||''}"></div>`;App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.openCCDetail('${id}')">←</button><h2>สิทธิประโยชน์บัตร</h2><button class="btn btn-primary btn-sm" onclick="App.saveCCBenefit('${id}')" style="width:auto">บันทึก</button></div><div class="sub-scroll"><div class="sec-title">คะแนนสะสม</div><div class="card card-pad"><div class="benefits-toggle-row"><b>เปิดคะแนนสะสม</b><button class="toggle${(p.enabled||b.enabled)?' on':''}" id="ccb-points-enabled" onclick="this.classList.toggle('on')"></button></div>${f('ccb-bahtPerPoint','คะแนนสะสม X บาท = 1 คะแนน',p.bahtPerPoint)}${f('ccb-pointEvery','ทุก X บาทได้ 1 คะแนน',p.pointPerBahtEvery)}${f('ccb-multi','คะแนนเพิ่ม X เท่า',p.multiplier||1)}${f('ccb-maxTxnPoint','สูงสุด/รายการ (คะแนน)',p.maxPerTxn)}${f('ccb-maxCyclePoint','สูงสุด/รอบบัญชี (คะแนน)',p.maxPerCycle)}</div><div class="sec-title">Cashback</div><div class="card card-pad"><div class="benefits-toggle-row"><b>เปิด Cashback</b><button class="toggle${(c.enabled||b.enabled)?' on':''}" id="ccb-cash-enabled" onclick="this.classList.toggle('on')"></button></div>${f('ccb-cbPercent','รับเงินคืน X%',c.percent)}${f('ccb-cbMin','ขั้นต่ำ (฿)',c.minSpend)}${f('ccb-cbTier','ขั้นบันไดเริ่มที่ (฿)',c.tierThreshold)}${f('ccb-cbEvery','คิดทุกๆ X บาท',c.everyBaht||1)}${f('ccb-cbMaxTxn','สูงสุด/รายการ (฿)',c.maxPerTxn)}${f('ccb-cbMaxCycle','สูงสุด/รอบบัญชี (฿)',c.maxPerCycle)}</div></div>`)};
App.saveCCBenefit=function(id){const v=i=>parseFloat(document.getElementById(i)?.value)||0;S.ccBenefits[id]={enabled:false,points:{enabled:document.getElementById('ccb-points-enabled').classList.contains('on'),bahtPerPoint:v('ccb-bahtPerPoint'),pointPerBahtEvery:v('ccb-pointEvery'),multiplier:v('ccb-multi')||1,maxPerTxn:v('ccb-maxTxnPoint'),maxPerCycle:v('ccb-maxCyclePoint')},cashback:{enabled:document.getElementById('ccb-cash-enabled').classList.contains('on'),percent:v('ccb-cbPercent'),minSpend:v('ccb-cbMin'),tierThreshold:v('ccb-cbTier'),everyBaht:v('ccb-cbEvery')||1,maxPerTxn:v('ccb-cbMaxTxn'),maxPerCycle:v('ccb-cbMaxCycle')}};persist();App.openCCDetail(id);toast('บันทึกสิทธิประโยชน์แล้ว','success')};
const oldCC=App.openCCDetail;App.openCCDetail=function(id){oldCC.call(App,id);setTimeout(()=>{const body=document.querySelector('#sub-screen .sub-scroll');if(!body)return;const inst=S.transactions.filter(t=>t.walletId===id&&t.isInstallment);body.insertAdjacentHTML('beforeend',`<div style="font-size:14px;font-weight:700;margin:14px 0 8px">ผ่อนชำระ</div><div class="card"><div style="padding:0 16px">${inst.length?inst.map(t=>{const c=App._findCat(t.categoryId);return`<div class="list-item"><div class="list-item-icon" style="background:${c?.color||'#64748B'}20">🧾</div><div class="list-item-info"><div class="list-item-name">${t.merchant||t.note||c?.label||'ผ่อนชำระ'}</div><div class="list-item-sub">งวด ${t.installmentNo||1}/${t.installmentMonths||'?'} · ${c?.icon||''} ${c?.label||''}</div></div><b>${Calc.fmt(t.amount)}</b></div>`}).join(''):App._emptyState('🧾','ยังไม่มีรายการผ่อน','')}</div></div>`);},0)};
App._investmentUnitPriceTHB=function(w){const p=S.marketPrices||{};if(w.type==='crypto'){const map={BTC:'bitcoin',ETH:'ethereum',BNB:'binancecoin',USDT:'tether'},id=map[(w.symbol||'').toUpperCase()];return Number((id&&p.crypto?.[id]?.thb)||w.manualPrice||0)}if(w.type==='fcd'){const cur=(w.currency||w.symbol||'USD').toUpperCase(),thb=p.fx?.rates?.THB;return Number((cur==='USD'?thb:(thb&&p.fx?.rates?.[cur]?thb/p.fx.rates[cur]:0))||w.manualPrice||0)}if(w.type==='gold'){const line=(p.goldCsv||'').split('\n')[1],usd=line?parseFloat(line.split(',').at(-2)):0,fx=p.fx?.rates?.THB||35;return Number((usd&&fx?usd*fx:0)||w.manualPrice||0)}return 0};App._investmentValueTHB=w=>['gold','crypto','fcd'].includes(w.type)?((Number(w.units||0)*App._investmentUnitPriceTHB(w))||Number(w.balance||0)):Number(w.balance||0);
const oldWalletCard=App._walletCard;App._walletCard=function(w){let html=oldWalletCard.call(App,w);if(['gold','crypto','fcd'].includes(w.type))html=html.replace(/onclick="App.openWalletForm\('([^']+)'\)"/,`onclick="App.openWalletDetail('$1')"`).replace('<span class="invest-badge">Market</span>',`<button class="wc-pay-btn" onclick="event.stopPropagation();App.openWalletForm('${w.id}')">แก้ไข</button>`).replace(/<div class="wc-balance">[^<]+<\/div>/,`<div class="wc-balance">${Calc.fmt(App._investmentValueTHB(w))}</div><div class="wc-prog-info" style="margin-top:10px"><span>จำนวน ${Number(w.units||0).toLocaleString('en-US')} ${w.symbol||''}</span><span>${Calc.fmt(App._investmentUnitPriceTHB(w))}/หน่วย</span></div>`);return html};
App.openWalletDetail=function(id){const w=S.wallets.find(x=>x.id===id),tx=S.transactions.filter(t=>t.walletId===id||t.toWalletId===id).sort((a,b)=>b.date.localeCompare(a.date));if(!w)return;App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>${w.icon} ${w.name}</h2><button class="btn btn-secondary btn-sm" onclick="App.openWalletForm('${w.id}')" style="width:auto">แก้ไข</button></div><div class="sub-scroll"><div class="card card-pad nw-card"><div class="nw-label">ยอด / มูลค่าปัจจุบัน</div><div class="nw-value">${Calc.fmt(App._investmentValueTHB(w))}</div></div><div class="chips" style="padding:12px 0"><button class="chip active">ทั้งหมด</button><button class="chip">เดือนนี้</button><button class="chip">3 เดือน</button></div><div class="card"><div style="padding:0 16px">${tx.length?tx.map(t=>App._txRow(t)).join(''):App._emptyState('📋','ไม่พบรายการ','')}</div></div></div>`);setTimeout(()=>App._bindTxRows('sub-screen'),0)};
const oldWalletForm=App.openWalletForm;App.openWalletForm=function(id){oldWalletForm.call(App,id);const w=id?S.wallets.find(x=>x.id===id):null,inv=document.getElementById('wf-invest-fields');if(inv&&!inv.querySelector('#wf-units'))inv.insertAdjacentHTML('beforeend',`<div class="form-group"><label class="form-label">จำนวน Asset</label><input class="form-input" type="number" step="0.00000001" id="wf-units" value="${w?.units||''}"></div><div class="form-group"><label class="form-label">ราคาต่อหน่วยสำรอง (บาท)</label><input class="form-input" type="number" id="wf-manual-price" value="${w?.manualPrice||''}"></div>`)};
const oldSaveWallet=App.saveWallet;App.saveWallet=function(){const id=S.editingWalletId,type=document.getElementById('wf-type')?.value,units=parseFloat(document.getElementById('wf-units')?.value)||0,manualPrice=parseFloat(document.getElementById('wf-manual-price')?.value)||0;oldSaveWallet.call(App);const w=id?S.wallets.find(x=>x.id===id):S.wallets.at(-1);if(w&&['gold','crypto','fcd'].includes(type)){w.units=units;w.manualPrice=manualPrice;w.balance=units*manualPrice;persist();App.render();}};
const oldReports=App.renderReports;App.renderReports=function(){oldReports.call(App);const stats=Calc.getMonthlyStats(S.transactions,S.rptMonth),prev=Calc.getMonthlyStats(S.transactions,Calc.getMonths(2)[1]),diff=prev.expense?((stats.expense-prev.expense)/prev.expense*100):0,top=Object.entries(stats.byCategory||{}).sort((a,b)=>b[1]-a[1])[0],cat=top&&App._findCat(top[0]);document.getElementById('reports-content')?.insertAdjacentHTML('afterbegin',`<div class="sec-title">Financial Insights</div><div class="card card-pad" style="margin-bottom:12px"><div class="insight-row" style="background:rgba(37,99,235,.08)"><div class="insight-icon">📈</div><div><div class="insight-title">เทียบเดือนก่อน</div><div class="insight-body">รายจ่าย${diff>=0?'เพิ่มขึ้น':'ลดลง'} ${Math.abs(diff).toFixed(0)}%</div></div></div><div class="insight-row" style="background:rgba(5,150,105,.08)"><div class="insight-icon">💡</div><div><div class="insight-title">คำแนะนำ</div><div class="insight-body">${stats.net>=0?'กระแสเงินสดเป็นบวก แนะนำกันเงินส่วนเกินไปออม/ลงทุน':'กระแสเงินสดติดลบ แนะนำลดรายจ่ายไม่จำเป็นและตั้งเพดานรายสัปดาห์'}${top?` · หมวดสูงสุดคือ ${cat?.label||'ไม่ระบุ'}`:''}</div></div></div></div>`)};
App.toggleEmojiPanel=p=>{const e=document.getElementById(p+'-emoji-panel');if(e)e.style.display=e.style.display==='grid'?'none':'grid'};App.pickEmoji=(p,e)=>{document.getElementById(p+'-emoji').value=e;document.getElementById(p+'-emoji-preview').textContent=e;App.toggleEmojiPanel(p)};App.customEmoji=p=>{const v=prompt('ใส่อีโมจิที่ต้องการ');if(v)App.pickEmoji(p,v.trim())};App.pickColor=(p,c)=>document.getElementById(p+'-color').value=c;
const oldCatForm=App.openCategoryForm;App.openCategoryForm=function(kind,id){oldCatForm.call(App,kind,id);setTimeout(()=>{const cat=id?S.categories[kind].find(c=>c.id===id):null,scroll=document.querySelector('#sub-screen .sub-scroll');if(!scroll)return;scroll.innerHTML=scroll.innerHTML.replace(/<input class="form-input" id="cat-icon"[^>]*>/,`<button class="emoji-current" onclick="App.toggleEmojiPanel('cat')"><span id="cat-emoji-preview">${cat?.icon||'📦'}</span><small>แตะเพื่อเปลี่ยน</small></button><input type="hidden" id="cat-emoji" value="${cat?.icon||'📦'}"><div class="emoji-grid" id="cat-emoji-panel">${EMOJIS30.map(e=>`<button onclick="App.pickEmoji('cat','${e}')">${e}</button>`).join('')}<button onclick="App.customEmoji('cat')">＋</button></div>`).replace(/<input class="form-input" id="cat-color" type="color"[^>]*>/,`<div class="color-row">${COLORS10.map(c=>`<div class="color-dot" style="background:${c}" onclick="App.pickColor('cat','${c}')"></div>`).join('')}<input class="color-custom" type="color" onchange="App.pickColor('cat',this.value)"></div><input type="hidden" id="cat-color" value="${cat?.color||COLORS10[0]}">`);},0)};
const oldMerForm=App.openMerchantForm;App.openMerchantForm=function(id){oldMerForm.call(App,id);setTimeout(()=>{const m=id?S.merchants.find(x=>x.id===id):null,scroll=document.querySelector('#sub-screen .sub-scroll');if(!scroll)return;scroll.innerHTML=scroll.innerHTML.replace(/<input class="form-input" id="mer-emoji"[^>]*>/,`<button class="emoji-current" onclick="App.toggleEmojiPanel('mer')"><span id="mer-emoji-preview">${m?.emoji||'🏪'}</span><small>แตะเพื่อเปลี่ยน</small></button><input type="hidden" id="mer-emoji" value="${m?.emoji||'🏪'}"><div class="emoji-grid" id="mer-emoji-panel">${EMOJIS30.map(e=>`<button onclick="App.pickEmoji('mer','${e}')">${e}</button>`).join('')}<button onclick="App.customEmoji('mer')">＋</button></div>`).replace(/<input class="form-input" id="mer-color" type="color"[^>]*>/,`<div class="color-row">${COLORS10.map(c=>`<div class="color-dot" style="background:${c}" onclick="App.pickColor('mer','${c}')"></div>`).join('')}<input class="color-custom" type="color" onchange="App.pickColor('mer',this.value)"></div><input type="hidden" id="mer-color" value="${m?.color||COLORS10[0]}">`);},0)};
App.render();
})();

/* V2.1.1 professional fix: CC reward detail, wallet drilldown, investment valuation */
;(function(){
  const INVEST_TYPES = ['gold','crypto','fcd']
  const isInvest = w => w && INVEST_TYPES.includes(w.type)

  App._walletValueTHB = function(w) {
    if (!w) return 0
    if (w.type === 'credit') return Number(w.balance || 0)
    if (isInvest(w)) return App._investmentValueTHB(w)
    return Number(w.balance || 0)
  }

  Calc.getNetWorth = function(wallets) {
    let assets = 0, debt = 0
    ;(wallets || []).forEach(w => {
      const value = App._walletValueTHB ? App._walletValueTHB(w) : Number(w.balance || 0)
      if (value >= 0) assets += value
      else debt += Math.abs(value)
    })
    return { assets, debt, net: assets - debt }
  }

  Calc.getWalletGroups = function(wallets) {
    const assets = (wallets || []).filter(w => ['bank','cash','ewallet','saving'].includes(w.type))
    const liabilities = (wallets || []).filter(w => w.type === 'credit')
    const investments = (wallets || []).filter(w => INVEST_TYPES.includes(w.type))
    const sum = list => list.reduce((s,w) => s + Math.max(0, App._walletValueTHB(w)), 0)
    const debt = liabilities.reduce((s,w) => s + Math.abs(Number(w.balance || 0)), 0)
    return {
      assets, liabilities, investments,
      assetTotal: sum(assets) + sum(investments),
      liabilityTotal: debt,
      netTotal: sum(assets) + sum(investments) - debt,
    }
  }

  App._walletCard = function(w) {
    const isCC = w.type === 'credit'
    const inv = isInvest(w)
    const rawValue = App._walletValueTHB(w)
    const owed = Math.abs(Number(w.balance || 0))
    const displayValue = isCC ? owed : rawValue
    const usedPct = isCC && w.limit ? Math.min((owed / w.limit) * 100, 100) : 0
    const due = isCC && w.dueDay ? Calc.getDueDate(w.dueDay) : null
    const avail = isCC && w.limit ? w.limit - owed : 0
    const marketText = inv ? App._marketText(w) : ''
    const unitPrice = inv ? App._investmentUnitPriceTHB(w) : 0
    const detailAction = isCC ? `App.openCCDetail('${w.id}')` : `App.openWalletDetail('${w.id}')`
    const editBtn = `<button class="wc-pay-btn" onclick="event.stopPropagation();App.openWalletForm('${w.id}')">แก้ไข</button>`
    const payBtn = isCC ? `<button class="wc-pay-btn" onclick="event.stopPropagation();App.openCCPay('${w.id}')">ชำระ</button>` : ''

    return `<div class="wallet-card" style="background:linear-gradient(135deg,${w.color},${w.color}BB)" onclick="${detailAction}">
      <div class="wc-header">
        <div>
          <div class="wc-name">${w.icon} ${w.name}</div>
          <div class="wc-type">${App._walletTypeLabel(w.type)}${marketText ? ` · ${marketText}` : ''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">${payBtn}${editBtn}</div>
      </div>
      <div class="wc-balance">${isCC ? '-' : ''}${Calc.fmt(displayValue)}</div>
      ${inv ? `<div class="wc-prog-info" style="margin-top:10px"><span>จำนวน ${Number(w.units || 0).toLocaleString('en-US')} ${w.symbol || ''}</span><span>${Calc.fmt(unitPrice)}/หน่วย</span></div>` : ''}
      ${isCC && w.limit ? `<div class="wc-limit"><div class="wc-prog-bar"><div class="wc-prog-fill" style="width:${usedPct}%;background:${usedPct > 80 ? 'rgba(252,165,165,.9)' : 'rgba(255,255,255,.8)'}"></div></div><div class="wc-prog-info"><span>ใช้ไป ${usedPct.toFixed(0)}% · คงเหลือ ${Calc.fmt(avail)}</span>${due ? `<span>ครบ ${due.dueStr} (${due.daysLeft}ว.)</span>` : ''}</div></div>` : ''}
    </div>`
  }

  App._filterWalletTx = function(walletId) {
    const range = S.walletTxRange || 'all'
    const today = new Date()
    let start = '', end = ''
    if (range === 'month') start = THIS_MONTH + '-01'
    if (range === '3m') { const d = new Date(today); d.setMonth(d.getMonth() - 3); start = d.toISOString().slice(0,10) }
    if (range === 'year') start = `${today.getFullYear()}-01-01`
    if (range === 'custom') { start = S.walletTxStart || ''; end = S.walletTxEnd || '' }
    return S.transactions
      .filter(t => t.walletId === walletId || t.toWalletId === walletId)
      .filter(t => (!start || t.date >= start) && (!end || t.date <= end))
      .sort((a,b) => b.date.localeCompare(a.date))
  }

  App.setWalletTxRange = function(range, walletId) {
    S.walletTxRange = range
    App.openWalletDetail(walletId)
  }

  App.setWalletTxCustom = function(walletId) {
    S.walletTxRange = 'custom'
    S.walletTxStart = document.getElementById('wallet-filter-start')?.value || ''
    S.walletTxEnd = document.getElementById('wallet-filter-end')?.value || ''
    App.openWalletDetail(walletId)
  }

  App.openWalletDetail = function(id) {
    const w = S.wallets.find(x => x.id === id)
    if (!w) return
    S.walletDetailId = id
    S.walletTxRange ||= 'all'
    const tx = App._filterWalletTx(id)
    const inv = isInvest(w)
    const unitPrice = inv ? App._investmentUnitPriceTHB(w) : 0
    const chips = [['all','ทั้งหมด'],['month','เดือนนี้'],['3m','3 เดือน'],['year','ปีนี้'],['custom','กำหนดเอง']]
      .map(([k,l]) => `<button class="chip${S.walletTxRange===k?' active':''}" onclick="App.setWalletTxRange('${k}','${id}')">${l}</button>`).join('')
    const custom = S.walletTxRange === 'custom'
      ? `<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin:0 0 12px"><input class="form-input" type="date" id="wallet-filter-start" value="${S.walletTxStart || ''}"><input class="form-input" type="date" id="wallet-filter-end" value="${S.walletTxEnd || ''}"><button class="btn btn-primary btn-sm" onclick="App.setWalletTxCustom('${id}')" style="width:auto">ดู</button></div>`
      : ''
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>${w.icon} ${w.name}</h2><button class="btn btn-secondary btn-sm" onclick="App.openWalletForm('${w.id}')" style="width:auto">แก้ไข</button></div>
      <div class="sub-scroll wallet-detail-screen" data-wallet-id="${id}">
        <div class="card card-pad nw-card">
          <div class="nw-label">${inv ? 'มูลค่าสินทรัพย์ตามราคาปัจจุบัน/สำรอง' : 'ยอดคงเหลือ'}</div>
          <div class="nw-value ${App._walletValueTHB(w) >= 0 ? 'c-income' : 'c-expense'}">${Calc.fmt(Math.abs(App._walletValueTHB(w)))}</div>
          ${inv ? `<div class="nw-detail"><span class="nw-item">จำนวน <strong>${Number(w.units || 0).toLocaleString('en-US')} ${w.symbol || ''}</strong></span><span class="nw-item">ราคา/หน่วย <strong>${Calc.fmt(unitPrice)}</strong></span></div>` : ''}
        </div>
        <div class="chips" style="padding:12px 0">${chips}</div>
        ${custom}
        <div style="font-size:14px;font-weight:700;margin-bottom:8px">รายการในกระเป๋านี้</div>
        <div class="card"><div style="padding:0 16px">${tx.length ? tx.map(t => App._txRow(t)).join('') : App._emptyState('📋','ไม่พบรายการ','ลองเปลี่ยนช่วงเวลา')}</div></div>
      </div>`)
    setTimeout(() => App._bindTxRows('sub-screen'), 0)
  }

  App._txDetailRowsHtml = function(tx) {
    const cat = App._findCat(tx.categoryId)
    const wallet = S.wallets.find(w => w.id === tx.walletId)
    const toWal = S.wallets.find(w => w.id === tx.toWalletId)
    const r = App._rewardForTx(tx)
    const amtColor = tx.type === 'income' ? 'var(--income)' : tx.type === 'transfer' ? 'var(--primary)' : 'var(--expense)'
    const transferLine = tx.type === 'transfer' && wallet && toWal ? `${wallet.icon} ${wallet.name} → ${toWal.icon} ${toWal.name}` : ''
    return `<div style="text-align:center;margin-bottom:20px"><div style="font-size:48px;font-weight:800;color:${amtColor}">${tx.type==='income'?'+':tx.type==='expense'?'-':''}${Calc.fmt(tx.amount)}</div><div style="font-size:14px;color:var(--muted);margin-top:6px">${Calc.labelDate(tx.date)}</div></div>
      <div>
        ${transferLine ? `<div class="detail-row"><span class="detail-label">รายการโอน</span><span class="detail-value">${transferLine}</span></div>` : ''}
        ${cat ? `<div class="detail-row"><span class="detail-label">หมวดหมู่</span><span class="detail-value">${cat.icon} ${cat.label}</span></div>` : ''}
        ${wallet ? `<div class="detail-row"><span class="detail-label">กระเป๋าเงิน</span><span class="detail-value">${wallet.icon} ${wallet.name}</span></div>` : ''}
        ${toWal && tx.type !== 'transfer' ? `<div class="detail-row"><span class="detail-label">ไปยัง</span><span class="detail-value">${toWal.icon} ${toWal.name}</span></div>` : ''}
        ${tx.merchant ? `<div class="detail-row"><span class="detail-label">ร้านค้า</span><span class="detail-value">${tx.merchant}</span></div>` : ''}
        ${tx.note ? `<div class="detail-row"><span class="detail-label">หมายเหตุ</span><span class="detail-value">${tx.note}</span></div>` : ''}
        ${tx.isRecurring ? `<div class="detail-row"><span class="detail-label">รายการประจำ</span><span class="detail-value">เปิดใช้</span></div>` : ''}
        ${tx.isInstallment ? `<div class="detail-row"><span class="detail-label">ผ่อนชำระ</span><span class="detail-value">งวด ${tx.installmentNo || 1}/${tx.installmentMonths || '?'}</span></div>` : ''}
        ${(r.points || r.cashback) ? `<div class="detail-row"><span class="detail-label">สิทธิประโยชน์โดยประมาณ</span><span class="detail-value">${r.points ? '+' + r.points.toLocaleString('en-US') + ' pt' : ''}${r.points && r.cashback ? ' · ' : ''}${r.cashback ? '+' + Calc.fmt(r.cashback) : ''}</span></div>` : ''}
        <div class="detail-row"><span class="detail-label">ประเภท</span><span class="detail-value">${App._txTypeLabel(tx.type)}</span></div>
      </div>`
  }

  App.openTxDetailSub = function(id, backType, backId) {
    const tx = S.transactions.find(t => t.id === id)
    if (!tx) return
    const back = backType === 'cc' ? `App.openCCDetail('${backId}')` : backType === 'wallet' ? `App.openWalletDetail('${backId}')` : 'App.closeSubScreen()'
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="${back}">←</button><h2>รายละเอียดรายการ</h2></div>
      <div class="sub-scroll tx-detail-sub-screen">
        ${App._txDetailRowsHtml(tx)}
        <div class="tx-action-grid"><button class="btn btn-secondary" onclick="App.closeSubScreen();App.openEditTx('${tx.id}')">✏️ แก้ไข</button><button class="btn btn-secondary" onclick="App.closeSubScreen();App.openDuplicateTx('${tx.id}')">⧉ Duplicate</button></div>
      </div>`)
  }

  App._bindTxRows = function(containerId) {
    const root = document.getElementById(containerId)
    if (!root) return
    const walletId = root.querySelector('.wallet-detail-screen')?.dataset.walletId
    const ccId = root.querySelector('.cc-detail-screen')?.dataset.cardId
    root.querySelectorAll('.tx-row').forEach(el => {
      el.onclick = () => {
        if (walletId) return App.openTxDetailSub(el.dataset.txid, 'wallet', walletId)
        if (ccId) return App.openTxDetailSub(el.dataset.txid, 'cc', ccId)
        App.openTxDetail(el.dataset.txid)
      }
    })
  }

  App.openCCDetail = function(cardId) {
    const card = S.wallets.find(w => w.id === cardId)
    if (!card) return
    const benefit = App._benefit(cardId)
    const period = Calc.getStatementPeriod(card.cycleDay || 25)
    const txns = S.transactions.filter(t => t.walletId === cardId).sort((a,b) => b.date.localeCompare(a.date)).slice(0, 20)
    const cycleTxns = txns.filter(t => t.type === 'expense' && t.date >= period.start && t.date <= period.end)
    const rewards = Calc.getCardRewards(cycleTxns, benefit)
    const installments = S.transactions.filter(t => t.walletId === cardId && t.isInstallment).sort((a,b) => b.date.localeCompare(a.date))
    const owed = Math.abs(card.balance || 0)
    const usedPct = card.limit ? Math.min((owed / card.limit) * 100, 100) : 0
    const due = card.dueDay ? Calc.getDueDate(card.dueDay) : null
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>${card.icon} ${card.name}</h2><div style="display:flex;gap:6px"><button class="btn btn-secondary btn-sm" onclick="App.openWalletForm('${cardId}')" style="width:auto">แก้ไข</button><button class="btn btn-primary btn-sm" onclick="App.closeSubScreen();App.openCCPay('${cardId}')" style="width:auto">ชำระ</button></div></div>
      <div class="sub-scroll cc-detail-screen" data-card-id="${cardId}">
        <div style="background:linear-gradient(135deg,${card.color},${card.color}BB);border-radius:20px;padding:24px;color:#fff;margin-bottom:16px">
          <div style="font-size:12px;opacity:.75;margin-bottom:20px">รอบบัญชีตัดวันที่ ${card.cycleDay || 25} · ชำระวันที่ ${card.dueDay || '-'}</div>
          <div style="font-size:13px;opacity:.7;margin-bottom:6px">ยอดค้างชำระ</div>
          <div style="font-size:38px;font-weight:800;letter-spacing:-1px;margin-bottom:20px">${Calc.fmt(owed)}</div>
          ${card.limit ? `<div style="background:rgba(255,255,255,.2);border-radius:4px;height:7px;overflow:hidden;margin-bottom:8px"><div style="height:100%;width:${usedPct}%;background:${usedPct>80?'#FCA5A5':'rgba(255,255,255,.85)'};border-radius:4px"></div></div><div style="font-size:12px;opacity:.75">ใช้ ${usedPct.toFixed(0)}%${due ? ` · ครบ ${due.dueStr} (${due.daysLeft}ว.)` : ''}</div>` : ''}
        </div>
        <div class="card card-pad" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:14px;font-weight:800">สิทธิประโยชน์รอบนี้</div><div style="font-size:12px;color:var(--muted)">${period.start} ถึง ${period.end}</div></div><button class="btn btn-secondary btn-sm" onclick="App.openCCBenefitScreen('${cardId}')" style="width:auto">ตั้งค่า</button></div><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:12px"><div class="mini-stat"><div>คะแนน</div><strong>${rewards.points.toLocaleString('en-US')}</strong></div><div class="mini-stat"><div>Cashback</div><strong>${Calc.fmt(rewards.cashback)}</strong></div></div><div style="font-size:12px;color:var(--muted);margin-top:10px">แตะรายการล่าสุดเพื่อดูสิทธิประโยชน์รายรายการ</div></div>
        <div style="font-size:14px;font-weight:700;margin-bottom:8px">ผ่อนชำระ</div>
        <div class="card" style="margin-bottom:14px"><div style="padding:0 16px">${installments.length ? installments.map(t => { const c = App._findCat(t.categoryId); return `<div class="list-item"><div class="list-item-icon" style="background:${c?.color || '#64748B'}20">🧾</div><div class="list-item-info"><div class="list-item-name">${t.merchant || t.note || c?.label || 'ผ่อนชำระ'}</div><div class="list-item-sub">งวด ${t.installmentNo || 1}/${t.installmentMonths || '?'} · ${c?.icon || ''} ${c?.label || ''}</div></div><b>${Calc.fmt(t.amount)}</b></div>` }).join('') : App._emptyState('🧾','ยังไม่มีรายการผ่อน','')}</div></div>
        <div style="font-size:14px;font-weight:700;margin-bottom:8px">รายการล่าสุดของบัตรนี้</div>
        <div class="card"><div style="padding:0 16px">${txns.length ? txns.map(tx => App._txRow(tx)).join('') : App._emptyState('📋','ยังไม่มีรายการ','')}</div></div>
      </div>`)
    setTimeout(() => App._bindTxRows('sub-screen'), 0)
  }

  const previousOpenWalletForm = App.openWalletForm
  App.openWalletForm = function(id) {
    previousOpenWalletForm.call(App, id)
    const w = id ? S.wallets.find(x => x.id === id) : null
    const inv = document.getElementById('wf-invest-fields')
    if (!inv) return
    if (!inv.querySelector('#wf-units')) {
      inv.insertAdjacentHTML('beforeend', `<div class="form-group"><label class="form-label">จำนวน Asset</label><input class="form-input" type="number" step="0.00000001" id="wf-units" value="${w?.units || ''}" placeholder="เช่น 0.05, 2.5, 1000"></div><div class="form-group"><label class="form-label">ราคาต่อหน่วยสำรอง (บาท)</label><input class="form-input" type="number" step="0.01" id="wf-manual-price" value="${w?.manualPrice || ''}" placeholder="ใช้เมื่อดึงราคาไม่ได้"></div><div style="font-size:12px;color:var(--muted);margin-top:-8px;margin-bottom:12px">ระบบจะใช้ราคาจาก realtime ก่อน ถ้าดึงไม่ได้จะใช้ราคาสำรองนี้</div>`)
    }
  }

  const previousSaveWallet = App.saveWallet
  App.saveWallet = function() {
    const idBefore = S.editingWalletId
    const type = document.getElementById('wf-type')?.value
    const units = parseFloat(document.getElementById('wf-units')?.value) || 0
    const manualPrice = parseFloat(document.getElementById('wf-manual-price')?.value) || 0
    previousSaveWallet.call(App)
    const w = idBefore ? S.wallets.find(x => x.id === idBefore) : S.wallets[S.wallets.length - 1]
    if (w && INVEST_TYPES.includes(type)) {
      w.units = units
      w.manualPrice = manualPrice
      w.balance = units * App._investmentUnitPriceTHB(w)
      persist()
      App.render()
    }
  }

  App.render()
})();

/* ============================================================
   V2.2 Professional UI/UX refresh
   - Final safe overrides only. Keeps existing state/storage/handlers.
   - Fixes edit-save flags, privacy display, wallet drilldown, and mobile UI.
   ============================================================ */
;(function(){
  const INVEST_TYPES = ['gold','crypto','fcd']
  const isInvest = w => w && INVEST_TYPES.includes(w.type)
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))
  const clampPct = n => Math.max(0, Math.min(100, Number(n) || 0))
  const fmt = n => moneyFmt(Number(n) || 0)
  const signedFmt = (n, type) => {
    if (S.settings?.hideMoney) {
      if (type === 'income') return '+฿••••'
      if (type === 'expense') return '-฿••••'
      if (type === 'transfer' || type === 'cc_payment') return '↔ ฿••••'
      return '฿••••'
    }
    if (type === 'income') return '+' + Calc.fmt(n)
    if (type === 'expense') return '-' + Calc.fmt(n)
    if (type === 'transfer' || type === 'cc_payment') return '↔ ' + Calc.fmt(n)
    return Calc.fmt(n)
  }
  const amountClass = type => type === 'income' ? 'c-income' : type === 'transfer' ? 'c-primary' : 'c-expense'
  const cssAmountColor = type => type === 'income' ? 'var(--income)' : type === 'transfer' ? 'var(--primary)' : 'var(--expense)'
  const walletValue = w => App._walletValueTHB ? App._walletValueTHB(w) : Number(w?.balance || 0)
  const walletTypeLabelMap = { bank:'ธนาคาร', cash:'เงินสด', ewallet:'E-Wallet', credit:'บัตรเครดิต', saving:'ออมทรัพย์', gold:'ทองคำ', crypto:'Crypto', fcd:'เงินฝากต่างประเทศ' }

  App._esc = esc
  App._fmtMoney = fmt
  App._fmtSignedMoney = signedFmt
  App._walletTypeLabel = type => walletTypeLabelMap[type] || type
  App._emptyState = function(icon, title, sub) {
    return `<div class="empty"><div class="empty-icon">${esc(icon)}</div><div class="empty-title">${esc(title)}</div>${sub ? `<div class="empty-sub">${esc(sub)}</div>` : ''}</div>`
  }

  App._sectionHeader = function(title, actionLabel, action) {
    return `<div class="section-header"><h3>${esc(title)}</h3>${actionLabel ? `<button type="button" onclick="${action}">${esc(actionLabel)}</button>` : ''}</div>`
  }

  App.renderDashboard = function() {
    App._ensureV2State?.()
    const stats = Calc.getMonthlyStats(S.transactions, THIS_MONTH)
    const nw = Calc.getNetWorth(S.wallets)
    const expBudgets = Calc.getBudgetProgress(S.transactions, S.budgets, S.categories, THIS_MONTH)
    const incBudgets = Calc.getIncomeBudgetProgress ? Calc.getIncomeBudgetProgress(S.transactions, S.incomeBudgets, S.categories, THIS_MONTH) : []
    const recent = [...S.transactions].sort((a,b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5)
    const transfers = S.transactions.filter(t => t.type === 'transfer' && (t.date || '').startsWith(THIS_MONTH)).reduce((s,t) => s + Number(t.amount || 0), 0)
    const savingsPct = stats.income > 0 ? clampPct(stats.savingsRate) : 0
    const grad = `linear-gradient(135deg, ${S.settings.accentColor || '#2563EB'}, color-mix(in srgb, ${S.settings.accentColor || '#2563EB'} 74%, #0F172A))`

    const alerts = S.wallets
      .filter(w => w.type === 'credit' && Math.abs(w.balance || 0) > 0 && w.dueDay)
      .map(w => ({...w, owed: Math.abs(w.balance || 0), ...Calc.getDueDate(w.dueDay)}))
      .filter(w => w.daysLeft >= 0 && w.daysLeft <= 3)
      .sort((a,b) => a.daysLeft - b.daysLeft)

    const topExpense = Object.entries(stats.byCategory || {}).sort((a,b) => b[1] - a[1])[0]
    const overBudget = expBudgets.find(b => b.over)
    const incomeGap = incBudgets.find(b => b.spent < b.monthlyLimit)
    const insights = []
    if (topExpense) {
      const cat = App._findCat(topExpense[0])
      insights.push({ icon:'📊', title:`ใช้จ่ายสูงสุด: ${cat?.label || 'ไม่ระบุหมวด'}`, body:`${fmt(topExpense[1])} หรือ ${stats.expense ? (topExpense[1] / stats.expense * 100).toFixed(0) : 0}% ของรายจ่ายเดือนนี้`, bg:'var(--primary-soft)' })
    }
    if (overBudget) insights.push({ icon:'⚠️', title:`งบ ${overBudget.label} เกินแล้ว`, body:`เกินงบ ${fmt(overBudget.spent - overBudget.monthlyLimit)} แนะนำชะลอรายจ่ายหมวดนี้`, bg:'var(--expense-soft)' })
    if (incomeGap) insights.push({ icon:'🎯', title:`รายรับ ${incomeGap.label} ยังต่ำกว่าเป้า`, body:`ยังขาด ${fmt(incomeGap.monthlyLimit - incomeGap.spent)} จากเป้ารายเดือน`, bg:'var(--income-soft)' })
    if (!insights.length) insights.push({ icon:'✅', title:'ภาพรวมยังดูดี', body:'ยังไม่พบหมวดที่เกินงบหรือรายการที่ผิดปกติ', bg:'var(--income-soft)' })

    let html = `
      <div class="home-hero" style="background:${grad}">
        <div class="home-hero-top">
          <div>
            <div class="home-eyebrow">${esc(Calc.monthLabel(THIS_MONTH))}</div>
            <div class="home-title">${fmt(stats.net)}</div>
            <div class="home-subtitle">คงเหลือเดือนนี้ · อัตราการออม ${stats.savingsRate.toFixed(1)}%</div>
          </div>
          <button class="privacy-toggle" onclick="App.toggleHideMoney()">${S.settings.hideMoney ? '🙈 แสดง' : '👁️ ซ่อน'}</button>
        </div>
        <div class="savings-bar"><div class="savings-fill" style="width:${savingsPct}%"></div></div>
        <div class="summary-grid">
          <div class="summary-tile"><span>รายรับ</span><strong>${fmt(stats.income)}</strong></div>
          <div class="summary-tile"><span>รายจ่าย</span><strong>${fmt(stats.expense)}</strong></div>
          <div class="summary-tile"><span>โอนเงิน</span><strong>${fmt(transfers)}</strong></div>
        </div>
      </div>
      <div class="finance-stat-grid">
        <div class="finance-stat-card"><div class="label">สินทรัพย์รวม</div><div class="value c-income">${fmt(nw.assets)}</div></div>
        <div class="finance-stat-card"><div class="label">หนี้สินรวม</div><div class="value c-expense">${fmt(nw.debt)}</div></div>
      </div>
      <div class="card card-pad nw-card" style="margin-top:12px;margin-bottom:12px">
        <div class="nw-label">ความมั่งคั่งสุทธิ</div>
        <div class="nw-value ${nw.net >= 0 ? 'c-income' : 'c-expense'}">${nw.net < 0 && !S.settings.hideMoney ? '-' : ''}${fmt(Math.abs(nw.net))}</div>
        <div class="nw-detail"><span class="nw-item">สินทรัพย์ <strong class="c-income">${fmt(nw.assets)}</strong></span><span class="nw-item">หนี้สิน <strong class="c-expense">${fmt(nw.debt)}</strong></span></div>
      </div>`

    if (alerts.length) {
      html += App._sectionHeader('แจ้งเตือนบัตรเครดิต')
      alerts.forEach(a => {
        html += `<div class="alert-card ${a.daysLeft <= 1 ? 'alert-urgent' : 'alert-warn'}"><div style="display:flex;justify-content:space-between;gap:12px"><div><div style="font-size:14px;font-weight:800">${esc(a.icon)} ${esc(a.name)}</div><div style="font-size:12px;color:var(--muted);margin-top:2px">ครบกำหนด ${esc(a.dueStr)} · ${a.daysLeft === 0 ? 'วันนี้' : `อีก ${a.daysLeft} วัน`}</div></div><div style="font-size:15px;font-weight:800;color:var(--expense)">${fmt(a.owed)}</div></div><button class="btn btn-primary btn-sm mt-12" onclick="App.openCCPay('${esc(a.id)}')">ชำระบัตรนี้</button></div>`
      })
    }

    html += App._sectionHeader('Insights & คำแนะนำ')
    html += `<div class="card card-pad" style="margin-bottom:12px;padding-bottom:10px">${insights.slice(0,3).map(i => `<div class="insight-row" style="background:${i.bg}"><div class="insight-icon">${esc(i.icon)}</div><div><div class="insight-title">${esc(i.title)}</div><div class="insight-body">${esc(i.body)}</div></div></div>`).join('')}</div>`

    if (expBudgets.length || incBudgets.length) {
      html += App._sectionHeader('งบประมาณเดือนนี้', 'ดูรายงาน', "App.showPage('reports')")
      html += `<div class="card card-pad" style="margin-bottom:12px">`
      ;[...expBudgets.slice(0,2), ...incBudgets.slice(0,1)].forEach(b => {
        const barColor = b.over ? 'var(--expense)' : b.pct > 80 ? 'var(--amber)' : 'var(--income)'
        html += `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;gap:12px"><span style="font-weight:700">${esc(b.icon)} ${esc(b.label)}</span><span style="color:${b.over ? 'var(--expense)' : 'var(--muted)'}">${fmt(b.spent)} / ${fmt(b.monthlyLimit)}</span></div><div class="progress-bar"><div class="progress-fill" style="width:${clampPct(b.pct)}%;background:${barColor}"></div></div></div>`
      })
      html += `</div>`
    }

    html += App._sectionHeader('รายการล่าสุด', 'ดูทั้งหมด', "App.showPage('transactions')")
    html += `<div class="card" style="margin-bottom:22px"><div style="padding:0 16px">${recent.length ? recent.map(tx => App._txRow(tx)).join('') : App._emptyState('📋','ยังไม่มีรายการ','แตะ + เพื่อเพิ่มรายการแรก')}</div></div>`

    document.getElementById('dashboard-content').innerHTML = html
    App._bindTxRows('dashboard-content')
  }

  App._txRow = function(tx) {
    const originalTx = tx
    const cat = App._findCat(tx.categoryId)
    const wallet = S.wallets.find(w => w.id === tx.walletId)
    const toWallet = S.wallets.find(w => w.id === tx.toWalletId)
    const isTransfer = tx.type === 'transfer'
    const icon = cat?.icon || (tx.type === 'income' ? '💰' : isTransfer ? '↔' : tx.type === 'cc_payment' ? '💳' : '💸')
    const bgColor = cat?.color ? cat.color + '20' : (isTransfer ? 'var(--transfer-soft)' : 'var(--surface-soft)')
    const title = isTransfer
      ? `${wallet?.name || 'ไม่ระบุ'} → ${toWallet?.name || 'ไม่ระบุ'}`
      : (tx.merchant || tx.note || cat?.label || 'รายการ')
    const meta = []
    if (cat?.label) meta.push(cat.label)
    if (wallet?.name && !isTransfer) meta.push(wallet.name)
    if (isTransfer && tx.note) meta.push(tx.note)
    if (tx.isRecurring) meta.push('ประจำ')
    if (tx.isInstallment) meta.push(`ผ่อน ${tx.installmentNo || 1}/${tx.installmentMonths || '?'}`)
    const metaHtml = meta.map(x => `<span class="tx-meta-pill">${esc(x)}</span>`).join('')

    return `<div class="tx-row tx-row--${esc(tx.type)}" data-txid="${esc(originalTx.id)}">
      <div class="tx-icon" style="background:${bgColor}">${esc(icon)}</div>
      <div class="tx-info">
        <div class="tx-title">${esc(title)}</div>
        ${metaHtml ? `<div class="tx-sub">${metaHtml}</div>` : ''}
      </div>
      <div class="tx-right">
        <div class="tx-amount" style="color:${cssAmountColor(tx.type)}">${signedFmt(tx.amount, tx.type)}</div>
        <div class="tx-date">${esc(Calc.shortDate(tx.date))}</div>
      </div>
    </div>`
  }

  App._renderAddTxAmount = function() {
    const title = S.txMode === 'edit' ? 'แก้ไขรายการ' : S.txMode === 'duplicate' ? 'ทำซ้ำรายการ' : 'เพิ่มรายการ'
    const amount = parseFloat(S.tx.amount || 0)
    const display = amount.toLocaleString('en-US', { minimumFractionDigits: String(S.tx.amount || '').includes('.') ? ((String(S.tx.amount).split('.')[1] || '').length) : 0 })
    const tabs = [['expense','จ่าย','💸'],['income','รับ','💰'],['transfer','โอน','↔']]
    document.getElementById('add-tx-content').innerHTML = `<div class="sheet-header" style="border-bottom:none;padding-bottom:0"><h2>${title}</h2><button class="btn-icon" onclick="App.closeOverlay('overlay-add-tx')">✕</button></div>
      <div class="type-tabs">${tabs.map(([v,l,i]) => `<button class="type-tab${S.tx.type === v ? ' active' : ''}" onclick="App._setTxType('${v}')"><span aria-hidden="true">${i}</span> ${l}</button>`).join('')}</div>
      <div class="amount-display" style="color:${cssAmountColor(S.tx.type)}">฿${display}</div>
      <div class="numpad">${['7','8','9','4','5','6','1','2','3','.','0','⌫'].map(k => `<button class="numpad-key${k === '⌫' ? ' del' : ''}" onclick="App._numpad('${k}')">${k}</button>`).join('')}</div>
      <div style="padding:0 20px 20px"><button class="btn btn-primary" onclick="App._goToDetail()">ถัดไป →</button></div>`
  }

  App._renderAddTxDetail = function() {
    const cats = S.tx.type === 'income' ? S.categories.income : S.categories.expense
    const amount = parseFloat(S.tx.amount || 0)
    const walletOptions = S.wallets.map(w => `<option value="${esc(w.id)}"${S.tx.walletId === w.id ? ' selected' : ''}>${esc(w.icon)} ${esc(w.name)}</option>`).join('')
    const toWalletOptions = S.wallets.filter(w => w.id !== S.tx.walletId).map(w => `<option value="${esc(w.id)}"${S.tx.toWalletId === w.id ? ' selected' : ''}>${esc(w.icon)} ${esc(w.name)}</option>`).join('')
    const needsCat = S.tx.type !== 'transfer'
    const isExpense = S.tx.type === 'expense'
    const title = S.txMode === 'edit' ? 'แก้ไขรายละเอียด' : 'รายละเอียดรายการ'

    document.getElementById('add-tx-content').innerHTML = `<div class="sheet-header"><h2>${title}</h2><button class="btn-icon" onclick="App.closeOverlay('overlay-add-tx')">✕</button></div>
      <div style="text-align:center;font-size:34px;font-weight:800;color:${cssAmountColor(S.tx.type)};padding:12px 0 16px;letter-spacing:-.05em">${signedFmt(amount, S.tx.type).replace('↔ ', '')}</div>
      <div class="sheet-body" style="padding-top:0">
        ${needsCat ? `<div class="form-group"><label class="form-label">หมวดหมู่</label><div class="cat-grid" id="cat-grid">${cats.map(c => `<button type="button" class="cat-btn${S.tx.categoryId === c.id ? ' active' : ''}" onclick="App._selectCat('${esc(c.id)}')">${esc(c.icon)} ${esc(c.label)}</button>`).join('')}</div></div>` : ''}
        <div class="form-group"><label class="form-label">${S.tx.type === 'transfer' ? 'โอนจาก' : 'กระเป๋าเงิน'}</label><select class="form-input" id="tx-wallet" onchange="App._txField('walletId',this.value);${S.tx.type === 'transfer' ? 'App._renderAddTxDetail()' : ''}">${walletOptions}</select></div>
        ${S.tx.type === 'transfer' ? `<div class="form-group"><label class="form-label">โอนไปยัง</label><select class="form-input" id="tx-towallet" onchange="App._txField('toWalletId',this.value)"><option value="">เลือกปลายทาง</option>${toWalletOptions}</select><div class="form-hint">รายการโอนจะแสดงเป็น “ต้นทาง → ปลายทาง” ในรายการธุรกรรม</div></div>` : `<div class="form-group"><label class="form-label">ร้านค้า / ที่มา</label><input class="form-input" id="tx-merchant" placeholder="เช่น Grab, Shopee, เงินเดือน" value="${esc(S.tx.merchant)}" oninput="App._txField('merchant',this.value)"></div>`}
        ${isExpense ? `<div class="form-group"><label class="form-label">รูปแบบรายการ</label><div class="tx-flag-grid"><button type="button" class="flag-pill${S.tx.isRecurring ? ' active' : ''}" onclick="App._toggleTxFlag('isRecurring')">🔁 ประจำ</button><button type="button" class="flag-pill${S.tx.isInstallment ? ' active' : ''}" onclick="App._toggleTxFlag('isInstallment')">🧾 ผ่อน</button></div></div>${S.tx.isInstallment ? `<div class="form-group"><label class="form-label">จำนวนงวดทั้งหมด</label><input class="form-input" type="number" min="1" inputmode="numeric" value="${esc(S.tx.installmentMonths || '')}" placeholder="เช่น 10" oninput="App._txField('installmentMonths',this.value)"></div>` : ''}` : ''}
        <div class="form-group"><label class="form-label">หมายเหตุ</label><input class="form-input" id="tx-note" placeholder="หมายเหตุ (ถ้ามี)" value="${esc(S.tx.note)}" oninput="App._txField('note',this.value)"></div>
        <div class="form-group"><label class="form-label">วันที่</label><input class="form-input" type="date" id="tx-date" value="${esc(S.tx.date)}" onchange="App._txField('date',this.value)"></div>
        <div class="flex-row mt-8"><button class="btn btn-secondary flex-1" onclick="App._backToAmount()">← แก้ไข</button><button class="btn btn-primary" style="flex:2" onclick="App.saveTx()">${S.txMode === 'edit' ? 'บันทึกการแก้ไข' : 'บันทึก'}</button></div>
      </div>`
  }

  App._toggleTxFlag = function(key) {
    S.tx[key] = !S.tx[key]
    if (key === 'isInstallment' && !S.tx[key]) S.tx.installmentMonths = ''
    App._renderAddTxDetail()
  }

  App.openAddTx = function() {
    S.txMode = 'add'
    S.editingTxId = null
    S.tx = { step:'amount', type:'expense', amount:'0', walletId:S.wallets.find(w => w.type !== 'credit')?.id || S.wallets[0]?.id || '', toWalletId:'', categoryId:'', merchant:'', note:'', date:TODAY, isRecurring:false, isInstallment:false, installmentMonths:'' }
    App._renderAddTxAmount()
    App.openOverlay('overlay-add-tx')
  }

  App.openEditTx = function(id) {
    const tx = S.transactions.find(t => t.id === id)
    if (!tx) return
    S.txMode = 'edit'
    S.editingTxId = id
    S.tx = { step:'detail', type:tx.type, amount:String(tx.amount), walletId:tx.walletId || '', toWalletId:tx.toWalletId || '', categoryId:tx.categoryId || '', merchant:tx.merchant || '', note:tx.note || '', date:tx.date || TODAY, isRecurring:!!tx.isRecurring, isInstallment:!!tx.isInstallment, installmentMonths:tx.installmentMonths || '' }
    App.closeOverlay('overlay-tx-detail')
    App._renderAddTxDetail()
    App.openOverlay('overlay-add-tx')
  }

  App.openDuplicateTx = function(id) {
    const tx = S.transactions.find(t => t.id === id)
    if (!tx) return
    S.txMode = 'duplicate'
    S.editingTxId = null
    S.tx = { step:'amount', type:tx.type, amount:String(tx.amount), walletId:tx.walletId || '', toWalletId:tx.toWalletId || '', categoryId:tx.categoryId || '', merchant:tx.merchant || '', note:tx.note || '', date:TODAY, isRecurring:!!tx.isRecurring, isInstallment:!!tx.isInstallment, installmentMonths:tx.installmentMonths || '' }
    App.closeOverlay('overlay-tx-detail')
    App._renderAddTxAmount()
    App.openOverlay('overlay-add-tx')
    toast('คัดลอกรายการแล้ว แก้จำนวนเงินก่อนบันทึกได้', 'info')
  }

  App.saveTx = function() {
    const amt = parseFloat(S.tx.amount)
    if (!amt || amt <= 0) { toast('กรุณาระบุจำนวนเงิน', 'error'); return }
    if (!S.tx.walletId) { toast('กรุณาเลือกกระเป๋าเงิน', 'error'); return }
    if (S.tx.type === 'transfer' && !S.tx.toWalletId) { toast('กรุณาเลือกปลายทาง', 'error'); return }
    if (S.tx.type === 'transfer' && S.tx.walletId === S.tx.toWalletId) { toast('ต้นทางและปลายทางต้องไม่ซ้ำกัน', 'error'); return }
    if (S.tx.type !== 'transfer' && !S.tx.categoryId) { toast('กรุณาเลือกหมวดหมู่', 'error'); return }

    const wasEdit = S.txMode === 'edit' && S.editingTxId
    const tx = {
      id: wasEdit ? S.editingTxId : Calc.genId(),
      type: S.tx.type,
      amount: amt,
      walletId: S.tx.walletId,
      toWalletId: S.tx.toWalletId || undefined,
      categoryId: S.tx.categoryId || undefined,
      merchant: S.tx.type === 'transfer' ? '' : (S.tx.merchant || ''),
      note: S.tx.note || '',
      date: S.tx.date || TODAY,
      isRecurring: !!S.tx.isRecurring,
      isInstallment: !!S.tx.isInstallment,
      installmentMonths: S.tx.isInstallment ? (parseInt(S.tx.installmentMonths) || undefined) : undefined,
      installmentNo: S.tx.isInstallment ? 1 : undefined,
    }

    if (wasEdit) {
      const idx = S.transactions.findIndex(t => t.id === S.editingTxId)
      if (idx < 0) { toast('ไม่พบรายการที่จะแก้ไข', 'error'); return }
      App._applyBalance(S.transactions[idx], -1)
      S.transactions[idx] = tx
      App._applyBalance(tx, 1)
    } else {
      S.transactions.unshift(tx)
      App._applyBalance(tx, 1)
    }

    if (tx.merchant) App._registerMerchantFromTx?.(tx)
    S.txMode = 'add'
    S.editingTxId = null
    persist()
    App.closeOverlay('overlay-add-tx')
    App.render()
    toast(wasEdit ? 'แก้ไขรายการแล้ว' : 'บันทึกรายการแล้ว', 'success')
  }

  App.renderWallets = function() {
    App._ensureV2State?.()
    const g = Calc.getWalletGroups(S.wallets)
    const summary = document.getElementById('wallets-summary')
    summary.innerHTML = `<div class="wallet-summary-grid" style="width:100%"><div class="wallet-summary-card"><span>สินทรัพย์รวม</span><strong class="c-income">${fmt(g.assetTotal || g.assets || 0)}</strong></div><div class="wallet-summary-card"><span>หนี้สินรวม</span><strong class="c-expense">${fmt(g.liabilityTotal || g.debt || 0)}</strong></div></div>`
    const section = (title, icon, list, empty) => `<div class="wallet-section-title">${icon} ${esc(title)}</div>${list.length ? list.map(w => App._walletCard(w)).join('') : `<div class="card card-pad" style="font-size:13px;color:var(--muted);margin-bottom:12px">${esc(empty)}</div>`}`
    document.getElementById('wallets-content').innerHTML = `<div style="display:flex;gap:8px;margin-bottom:10px"><button class="btn btn-secondary btn-sm" onclick="App.refreshMarketPrices()">↻ Refresh ราคา</button><button class="btn btn-primary btn-sm" onclick="App.openWalletForm(null)">+ เพิ่มกระเป๋า</button></div>${section('สินทรัพย์','🏦',g.assets,'ยังไม่มีสินทรัพย์')}${section('หนี้สิน','💳',g.liabilities,'ยังไม่มีบัตรเครดิต')}${section('การลงทุน','📈',g.investments,'เพิ่มทอง / Crypto / FCD เพื่อดูมูลค่าอ้างอิง')}`
  }

  App._walletCard = function(w) {
    const isCC = w.type === 'credit'
    const inv = isInvest(w)
    const owed = Math.abs(Number(w.balance || 0))
    const value = isCC ? owed : walletValue(w)
    const usedPct = isCC && w.limit ? clampPct((owed / w.limit) * 100) : 0
    const due = isCC && w.dueDay ? Calc.getDueDate(w.dueDay) : null
    const avail = isCC && w.limit ? Math.max(0, w.limit - owed) : 0
    const unitPrice = inv ? (App._investmentUnitPriceTHB?.(w) || 0) : 0
    const bg = `linear-gradient(135deg,${w.color || '#2563EB'},${w.color || '#2563EB'}BB)`
    return `<div class="wallet-card" style="background:${bg}" onclick="${isCC ? `App.openCCDetail('${esc(w.id)}')` : `App.openWalletDetail('${esc(w.id)}')`}">
      <div class="wc-header"><div><div class="wc-name">${esc(w.icon)} ${esc(w.name)}</div><div class="wc-type">${esc(App._walletTypeLabel(w.type))}${inv && App._marketText ? ` · ${esc(App._marketText(w))}` : ''}</div></div></div>
      <div class="wc-balance">${isCC && !S.settings.hideMoney ? '-' : ''}${fmt(value)}</div>
      ${inv ? `<div class="wc-prog-info" style="margin-top:10px"><span>จำนวน ${Number(w.units || 0).toLocaleString('en-US')} ${esc(w.symbol || '')}</span><span>${fmt(unitPrice)}/หน่วย</span></div>` : ''}
      ${isCC && w.limit ? `<div class="wc-limit"><div class="wc-prog-bar"><div class="wc-prog-fill" style="width:${usedPct}%;background:${usedPct > 80 ? 'rgba(252,165,165,.9)' : 'rgba(255,255,255,.8)'}"></div></div><div class="wc-prog-info"><span>ใช้ไป ${usedPct.toFixed(0)}% · คงเหลือ ${fmt(avail)}</span>${due ? `<span>ครบ ${esc(due.dueStr)} (${due.daysLeft}ว.)</span>` : ''}</div></div>` : ''}
      <div class="wc-action-row">
        <button class="wallet-chip-btn" onclick="event.stopPropagation();${isCC ? `App.openCCDetail('${esc(w.id)}')` : `App.openWalletDetail('${esc(w.id)}')`}">ดูรายการ</button>
        ${isCC ? `<button class="wallet-chip-btn" onclick="event.stopPropagation();App.openCCPay('${esc(w.id)}')">ชำระ</button>` : ''}
        <button class="wallet-chip-btn" onclick="event.stopPropagation();App.openWalletForm('${esc(w.id)}')">แก้ไข</button>
      </div>
    </div>`
  }

  App.openWalletDetail = function(id) {
    const w = S.wallets.find(x => x.id === id)
    if (!w) return
    S.walletDetailId = id
    S.walletTxRange ||= 'all'
    const tx = App._filterWalletTx ? App._filterWalletTx(id) : S.transactions.filter(t => t.walletId === id || t.toWalletId === id).sort((a,b) => (b.date || '').localeCompare(a.date || ''))
    const inv = isInvest(w)
    const unitPrice = inv ? App._investmentUnitPriceTHB(w) : 0
    const chips = [['all','ทั้งหมด'],['month','เดือนนี้'],['3m','3 เดือน'],['year','ปีนี้'],['custom','กำหนดเอง']].map(([k,l]) => `<button class="chip${S.walletTxRange === k ? ' active' : ''}" onclick="App.setWalletTxRange('${k}','${esc(id)}')">${l}</button>`).join('')
    const custom = S.walletTxRange === 'custom' ? `<div class="wallet-filter-custom"><input class="form-input" type="date" id="wallet-filter-start" value="${esc(S.walletTxStart || '')}"><input class="form-input" type="date" id="wallet-filter-end" value="${esc(S.walletTxEnd || '')}"><button class="btn btn-primary btn-sm" onclick="App.setWalletTxCustom('${esc(id)}')" style="width:auto">ดู</button></div>` : ''
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>${esc(w.icon)} ${esc(w.name)}</h2><button class="btn btn-secondary btn-sm" onclick="App.openWalletForm('${esc(w.id)}')" style="width:auto">แก้ไข</button></div>
      <div class="sub-scroll wallet-detail-screen" data-wallet-id="${esc(id)}">
        <div class="wallet-detail-hero">
          <div class="nw-label">${inv ? 'มูลค่าตามราคาปัจจุบัน/สำรอง' : 'ยอดคงเหลือ'}</div>
          <div class="big ${walletValue(w) >= 0 ? 'c-income' : 'c-expense'}">${walletValue(w) < 0 && !S.settings.hideMoney ? '-' : ''}${fmt(Math.abs(walletValue(w)))}</div>
          ${inv ? `<div class="nw-detail"><span class="nw-item">จำนวน <strong>${Number(w.units || 0).toLocaleString('en-US')} ${esc(w.symbol || '')}</strong></span><span class="nw-item">ราคา/หน่วย <strong>${fmt(unitPrice)}</strong></span></div>` : ''}
        </div>
        <div class="chips" style="padding:0 0 12px">${chips}</div>
        ${custom}
        ${App._sectionHeader('รายการในกระเป๋านี้')}
        <div class="card"><div style="padding:0 16px">${tx.length ? tx.map(t => App._txRow(t)).join('') : App._emptyState('📋','ไม่พบรายการ','ลองเปลี่ยนช่วงเวลา')}</div></div>
      </div>`)
    setTimeout(() => App._bindTxRows('sub-screen'), 0)
  }

  App._txDetailRowsHtml = function(tx) {
    const cat = App._findCat(tx.categoryId)
    const wallet = S.wallets.find(w => w.id === tx.walletId)
    const toWal = S.wallets.find(w => w.id === tx.toWalletId)
    const r = App._rewardForTx ? App._rewardForTx(tx) : {points:0,cashback:0}
    const transferLine = tx.type === 'transfer' && wallet && toWal ? `${wallet.icon} ${wallet.name} → ${toWal.icon} ${toWal.name}` : ''
    return `<div style="text-align:center;margin-bottom:20px"><div style="font-size:44px;font-weight:800;color:${cssAmountColor(tx.type)};letter-spacing:-.05em">${signedFmt(tx.amount, tx.type)}</div><div style="font-size:14px;color:var(--muted);margin-top:6px">${esc(Calc.labelDate(tx.date))}</div></div>
      <div>
        ${transferLine ? `<div class="detail-row"><span class="detail-label">รายการโอน</span><span class="detail-value">${esc(transferLine)}</span></div>` : ''}
        ${cat ? `<div class="detail-row"><span class="detail-label">หมวดหมู่</span><span class="detail-value">${esc(cat.icon)} ${esc(cat.label)}</span></div>` : ''}
        ${wallet ? `<div class="detail-row"><span class="detail-label">กระเป๋าเงิน</span><span class="detail-value">${esc(wallet.icon)} ${esc(wallet.name)}</span></div>` : ''}
        ${toWal && tx.type !== 'transfer' ? `<div class="detail-row"><span class="detail-label">ไปยัง</span><span class="detail-value">${esc(toWal.icon)} ${esc(toWal.name)}</span></div>` : ''}
        ${tx.type !== 'transfer' && tx.merchant ? `<div class="detail-row"><span class="detail-label">ร้านค้า / ที่มา</span><span class="detail-value">${esc(tx.merchant)}</span></div>` : ''}
        ${tx.note ? `<div class="detail-row"><span class="detail-label">หมายเหตุ</span><span class="detail-value">${esc(tx.note)}</span></div>` : ''}
        ${tx.isRecurring ? `<div class="detail-row"><span class="detail-label">รายการประจำ</span><span class="detail-value">เปิดใช้</span></div>` : ''}
        ${tx.isInstallment ? `<div class="detail-row"><span class="detail-label">ผ่อนชำระ</span><span class="detail-value">งวด ${tx.installmentNo || 1}/${tx.installmentMonths || '?'}</span></div>` : ''}
        ${(r.points || r.cashback) ? `<div class="detail-row"><span class="detail-label">สิทธิประโยชน์โดยประมาณ</span><span class="detail-value">${r.points ? '+' + r.points.toLocaleString('en-US') + ' pt' : ''}${r.points && r.cashback ? ' · ' : ''}${r.cashback ? '+' + fmt(r.cashback) : ''}</span></div>` : ''}
        <div class="detail-row"><span class="detail-label">ประเภท</span><span class="detail-value">${esc(App._txTypeLabel(tx.type))}</span></div>
      </div>`
  }

  App._renderTxDetail = function() {
    const tx = S.transactions.find(t => t.id === S.selectedTxId)
    const box = document.getElementById('tx-detail-content')
    if (!tx || !box) return
    box.innerHTML = `${App._txDetailRowsHtml(tx)}<div class="tx-action-grid"><button class="btn btn-secondary" onclick="App.openEditTx('${esc(tx.id)}')">✏️ แก้ไข</button><button class="btn btn-secondary" onclick="App.openDuplicateTx('${esc(tx.id)}')">⧉ ทำซ้ำ</button></div><div style="margin-top:10px">${S.deleteConfirm ? `<button class="btn btn-danger" onclick="App.confirmDeleteTx()">ยืนยันการลบ</button><button class="btn btn-secondary mt-8" onclick="App._cancelDelete()">ยกเลิก</button>` : `<button class="btn btn-outline" onclick="App.deleteTx()">🗑 ลบรายการ</button>`}</div>`
  }

  App.openCCDetail = function(cardId) {
    const card = S.wallets.find(w => w.id === cardId)
    if (!card) return
    const benefit = App._benefit(cardId)
    const period = Calc.getStatementPeriod(card.cycleDay || 25)
    const txns = S.transactions.filter(t => t.walletId === cardId).sort((a,b) => (b.date || '').localeCompare(a.date || '')).slice(0, 20)
    const cycleTxns = txns.filter(t => t.type === 'expense' && t.date >= period.start && t.date <= period.end)
    const rewards = Calc.getCardRewards(cycleTxns, benefit)
    const installments = S.transactions.filter(t => t.walletId === cardId && t.isInstallment).sort((a,b) => (b.date || '').localeCompare(a.date || ''))
    const owed = Math.abs(card.balance || 0)
    const usedPct = card.limit ? clampPct((owed / card.limit) * 100) : 0
    const due = card.dueDay ? Calc.getDueDate(card.dueDay) : null
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>${esc(card.icon)} ${esc(card.name)}</h2><div style="display:flex;gap:6px"><button class="btn btn-secondary btn-sm" onclick="App.openWalletForm('${esc(cardId)}')" style="width:auto">แก้ไข</button><button class="btn btn-primary btn-sm" onclick="App.closeSubScreen();App.openCCPay('${esc(cardId)}')" style="width:auto">ชำระ</button></div></div>
      <div class="sub-scroll cc-detail-screen" data-card-id="${esc(cardId)}">
        <div class="cc-hero" style="background:linear-gradient(135deg,${card.color || '#DC2626'},${card.color || '#DC2626'}BB);color:#fff;border:0">
          <div style="font-size:12px;opacity:.75;margin-bottom:18px">รอบบัญชีตัดวันที่ ${card.cycleDay || 25} · ชำระวันที่ ${card.dueDay || '-'}</div>
          <div style="font-size:13px;opacity:.72;margin-bottom:6px">ยอดค้างชำระ</div>
          <div class="big">${fmt(owed)}</div>
          ${card.limit ? `<div style="background:rgba(255,255,255,.2);border-radius:999px;height:8px;overflow:hidden;margin:18px 0 8px"><div style="height:100%;width:${usedPct}%;background:${usedPct > 80 ? '#FCA5A5' : 'rgba(255,255,255,.88)'};border-radius:999px"></div></div><div style="font-size:12px;opacity:.78">ใช้ ${usedPct.toFixed(0)}%${due ? ` · ครบ ${esc(due.dueStr)} (${due.daysLeft}ว.)` : ''}</div>` : ''}
        </div>
        <div class="card card-pad" style="margin-bottom:12px"><div class="cc-detail-header"><div><div style="font-size:14px;font-weight:800">สิทธิประโยชน์รอบนี้</div><div style="font-size:12px;color:var(--muted)">${esc(period.start)} ถึง ${esc(period.end)}</div></div><button class="btn btn-secondary btn-sm" onclick="App.openCCBenefitScreen('${esc(cardId)}')" style="width:auto">ตั้งค่า</button></div><div class="reward-grid" style="margin-top:12px"><div class="reward-tile"><span>คะแนน</span><strong>${rewards.points.toLocaleString('en-US')}</strong></div><div class="reward-tile"><span>Cashback</span><strong>${fmt(rewards.cashback)}</strong></div></div><div style="font-size:12px;color:var(--muted);margin-top:10px">แตะรายการล่าสุดเพื่อดูสิทธิประโยชน์โดยประมาณรายรายการ</div></div>
        ${App._sectionHeader('ผ่อนชำระ')}
        <div class="card" style="margin-bottom:14px"><div style="padding:0 16px">${installments.length ? installments.map(t => { const c = App._findCat(t.categoryId); return `<div class="installment-row"><div class="list-item-icon" style="background:${c?.color || '#64748B'}20">🧾</div><div class="list-item-info"><div class="list-item-name">${esc(t.merchant || t.note || c?.label || 'ผ่อนชำระ')}</div><div class="list-item-sub">งวด ${t.installmentNo || 1}/${t.installmentMonths || '?'} · ${esc(c?.icon || '')} ${esc(c?.label || '')}</div></div><b>${fmt(t.amount)}</b></div>` }).join('') : App._emptyState('🧾','ยังไม่มีรายการผ่อน','')}</div></div>
        ${App._sectionHeader('รายการล่าสุดของบัตรนี้')}
        <div class="card"><div style="padding:0 16px">${txns.length ? txns.map(tx => App._txRow(tx)).join('') : App._emptyState('📋','ยังไม่มีรายการ','')}</div></div>
      </div>`)
    setTimeout(() => App._bindTxRows('sub-screen'), 0)
  }

  App.render()
})();

/* ============================================================
   V2.2 UI Style Overrides
   Re-applies mobile-first presentation on top of v2-2 while
   preserving existing app state, storage, calculations and handlers.
   ============================================================ */
;(function uiStyleForV22(){
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))
  const fmt = n => moneyFmt(Number(n) || 0)
  const clampPct = n => Math.max(0, Math.min(100, Number(n) || 0))
  const typeColor = type => type === 'income' ? 'var(--income)' : type === 'transfer' ? 'var(--primary)' : 'var(--expense)'
  const typeLabel = type => type === 'income' ? 'รายรับ' : type === 'transfer' ? 'โอนเงิน' : 'รายจ่าย'
  const typeSign = type => type === 'income' ? '+' : type === 'transfer' ? '' : '-'
  const signedFmt = (n, type) => `${typeSign(type)}${fmt(Math.abs(Number(n) || 0))}`
  const activeColorClass = type => type === 'income' ? 'income' : type === 'expense' ? 'expense' : 'transfer'
  const primaryWallet = () => S.wallets.find(w => w.type !== 'credit')?.id || S.wallets[0]?.id || ''
  const maybeSectionHeader = (title, actionLabel, action) => App._sectionHeader ? App._sectionHeader(title, actionLabel, action) : `<div class="section-header"><h3>${esc(title)}</h3>${actionLabel ? `<button onclick="${esc(action)}">${esc(actionLabel)}</button>` : ''}</div>`

  const originalShowPage = App.showPage.bind(App)
  App.showPage = function(page) {
    originalShowPage(page)
    const fab = document.getElementById('fab')
    if (fab) fab.classList.toggle('hidden', page !== 'dashboard')
    document.body.classList.toggle('is-dashboard', page === 'dashboard')
  }

  App.renderDashboard = function() {
    const stats = Calc.getMonthlyStats(S.transactions, THIS_MONTH)
    const nw = Calc.getNetWorth(S.wallets)
    const expBudgets = Calc.getBudgetProgress(S.transactions, S.budgets, S.categories, THIS_MONTH)
    const incBudgets = Calc.getIncomeBudgetProgress ? Calc.getIncomeBudgetProgress(S.transactions, S.incomeBudgets || [], S.categories, THIS_MONTH) : []
    const recent = [...S.transactions].sort((a,b) => (b.date || '').localeCompare(a.date || '')).slice(0,5)
    const assets = S.wallets.filter(w => w.type !== 'credit')
    const cc = S.wallets.find(w => w.type === 'credit' && Math.abs(Number(w.balance) || 0) > 0)
    const ccUsed = Math.abs(Number(cc?.balance) || 0)
    const ccLimit = Number(cc?.limit) || 0
    const ccPct = ccLimit ? clampPct((ccUsed / ccLimit) * 100) : 0
    const ccDue = cc?.dueDay ? Calc.getDueDate(cc.dueDay) : null
    const transferTotal = S.transactions
      .filter(t => (t.date || '').startsWith(THIS_MONTH) && t.type === 'transfer')
      .reduce((s,t) => s + Number(t.amount || 0), 0)

    let html = `
      <div class="mt-topbar">
        <div>
          <div class="mt-title">Money Tracker</div>
          <div class="mt-subtitle">${esc(Calc.monthLabel(THIS_MONTH))}</div>
        </div>
        <div class="mt-sync-pill"><span class="mt-sync-dot"></span><span>Local</span></div>
      </div>

      <div class="mt-net-card">
        <div class="mt-net-head">
          <div>
            <div class="mt-net-label">เงินสุทธิที่ใช้ได้จริง</div>
            <div class="mt-net-value">${nw.net < 0 && !S.settings.hideMoney ? '-' : ''}${fmt(Math.abs(nw.net))}</div>
          </div>
          <button class="mt-hide-btn" onclick="App.toggleHideMoney()">${S.settings.hideMoney ? '👁 แสดง' : '🙈 ซ่อน'}</button>
        </div>
        <div class="mt-net-split">
          <div class="mt-net-metric"><small>รายรับเดือนนี้</small><strong style="color:#4ADE80">+${fmt(stats.income)}</strong></div>
          <div class="mt-divider"></div>
          <div class="mt-net-metric"><small>รายจ่ายเดือนนี้</small><strong style="color:#F87171">-${fmt(stats.expense)}</strong></div>
        </div>
      </div>`

    if (cc) {
      const dueText = ccDue ? `ครบกำหนด ${esc(ccDue.dueStr)} · อีก ${esc(ccDue.daysLeft)} วัน` : `รอบบัญชีตัดวันที่ ${esc(cc.cycleDay || 25)}`
      html += `
        <div class="mt-alert-card" onclick="App.openCCDetail('${esc(cc.id)}')">
          <div>
            <div class="mt-alert-title">💳 ${esc(cc.name)}</div>
            <div class="mt-alert-sub">${dueText}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:16px;font-weight:900;color:var(--expense);letter-spacing:-.04em">${fmt(ccUsed)}</div>
            ${ccLimit ? `<div style="font-size:10px;color:var(--muted);margin-top:1px">จาก ${fmt(ccLimit)}</div>` : ''}
          </div>
        </div>`
      if (ccLimit) {
        html += `<div class="mt-progress-wrap">
          <div class="mt-progress-label"><span>วงเงินที่ใช้</span><b style="color:${ccPct > 70 ? 'var(--expense)' : 'var(--text)'}">${ccPct.toFixed(0)}%</b></div>
          <div class="mt-progress-track"><div class="mt-progress-fill" style="width:${ccPct}%;background:${ccPct > 70 ? 'var(--expense)' : 'var(--primary)'}"></div></div>
        </div>`
      }
    }

    if (assets.length) {
      html += `<div class="mt-wallet-mini-grid">${assets.slice(0,3).map(w => `<div class="mt-wallet-mini" onclick="App.openWalletDetail('${esc(w.id)}')">
        <div class="icon">${esc(w.icon || '◈')}</div>
        <div class="value">${fmt(App._investmentValueTHB ? App._investmentValueTHB(w) : (w.balance || 0))}</div>
        <div class="name">${esc(w.name)}</div>
      </div>`).join('')}</div>`
    }

    html += `<div class="mt-stat-row">
      <div class="mt-stat-card income"><small>รายรับ</small><strong>+${fmt(stats.income)}</strong></div>
      <div class="mt-stat-card expense"><small>รายจ่าย</small><strong>-${fmt(stats.expense)}</strong></div>
      <div class="mt-stat-card transfer"><small>โอนเงิน</small><strong>${fmt(transferTotal)}</strong></div>
      <div class="mt-stat-card saving"><small>คงเหลือเดือนนี้</small><strong>${stats.net < 0 && !S.settings.hideMoney ? '-' : ''}${fmt(Math.abs(stats.net))}</strong></div>
    </div>`

    const budgetRows = [...expBudgets.slice(0,2), ...incBudgets.slice(0,1)]
    if (budgetRows.length) {
      html += maybeSectionHeader('งบประมาณเดือนนี้', 'ดูรายงาน', "App.showPage('reports')")
      html += `<div class="card card-pad">`
      budgetRows.forEach(b => {
        const barColor = b.over ? 'var(--expense)' : b.pct > 80 ? 'var(--amber)' : 'var(--income)'
        html += `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;gap:12px"><span style="font-weight:800">${esc(b.icon)} ${esc(b.label)}</span><span style="color:${b.over ? 'var(--expense)' : 'var(--muted)'}">${fmt(b.spent)} / ${fmt(b.monthlyLimit)}</span></div><div class="progress-bar"><div class="progress-fill" style="width:${clampPct(b.pct)}%;background:${barColor}"></div></div></div>`
      })
      html += `</div>`
    }

    html += maybeSectionHeader('รายการล่าสุด', 'ดูทั้งหมด', "App.showPage('transactions')")
    html += `<div class="card" style="margin-bottom:22px"><div style="padding:0 16px">${recent.length ? recent.map(t => App._txRow(t)).join('') : App._emptyState('📋','ยังไม่มีรายการ','แตะ + เพื่อเพิ่มรายการแรก')}</div></div>`

    const target = document.getElementById('dashboard-content')
    if (target) target.innerHTML = html
    App._bindTxRows?.('dashboard-content')
  }

  App._txRow = function(tx) {
    const cat = App._findCat?.(tx.categoryId)
    const wallet = S.wallets.find(w => w.id === tx.walletId)
    const toWallet = S.wallets.find(w => w.id === tx.toWalletId)
    const isTransfer = tx.type === 'transfer'
    const icon = cat?.icon || (tx.type === 'income' ? '💰' : isTransfer ? '↔' : tx.type === 'cc_payment' ? '💳' : '💸')
    const title = isTransfer ? `${wallet?.name || 'ไม่ระบุ'} → ${toWallet?.name || 'ไม่ระบุ'}` : (tx.merchant || tx.note || cat?.label || 'รายการ')
    const meta = []
    if (cat?.label) meta.push(cat.label)
    if (wallet?.name && !isTransfer) meta.push(wallet.name)
    if (isTransfer && tx.note) meta.push(tx.note)
    if (tx.isRecurring) meta.push('🔁 ประจำ')
    if (tx.isInstallment) meta.push(`📦 ${tx.installmentNo || 1}/${tx.installmentMonths || '?'}`)
    const bg = cat?.color ? `${cat.color}18` : isTransfer ? 'var(--transfer-soft)' : 'var(--elevated)'
    return `<div class="tx-row tx-row--${esc(tx.type)}" data-txid="${esc(tx.id)}">
      <div class="tx-icon" style="background:${bg}">${esc(icon)}</div>
      <div class="tx-info">
        <div class="tx-title">${esc(title)}</div>
        <div class="tx-sub">${meta.map(x => `<span class="tx-meta-pill">${esc(x)}</span>`).join('')}</div>
      </div>
      <div class="tx-right">
        <div class="tx-amount" style="color:${typeColor(tx.type)}">${signedFmt(tx.amount, tx.type)}</div>
        <div class="tx-date">${esc(Calc.shortDate(tx.date))}</div>
      </div>
    </div>`
  }

  App._renderAddTxAmount = function() {
    const title = S.txMode === 'edit' ? 'แก้ไขรายการ' : S.txMode === 'duplicate' ? 'ทำซ้ำรายการ' : 'เพิ่มรายการ'
    const amount = String(S.tx.amount || '')
    const num = parseFloat(amount || 0)
    const display = Number.isFinite(num) ? num.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0'
    const tabs = [
      ['expense','จ่าย','-'],
      ['income','รับ','+'],
      ['transfer','โอน','↔']
    ]
    const color = typeColor(S.tx.type)
    const canNext = num > 0
    const box = document.getElementById('add-tx-content')
    if (!box) return
    box.innerHTML = `<div style="display:flex;flex-direction:column;height:100%">
      <div class="sheet-header"><h2>${esc(title)}</h2><button class="btn-icon" onclick="App.closeOverlay('overlay-add-tx')">✕</button></div>
      <div class="type-tabs">${tabs.map(([v,l,i]) => `<button class="type-tab type-${v}${S.tx.type === v ? ' active' : ''}" onclick="App._setTxType('${v}')"><span aria-hidden="true">${i}</span> ${l}</button>`).join('')}</div>
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 20px">
        <div style="font-size:11px;font-weight:800;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">${esc(typeLabel(S.tx.type))}</div>
        <div class="amount-display" style="color:${canNext ? color : '#D1D5DB'}">${S.tx.type === 'income' ? '+' : S.tx.type === 'expense' ? '-' : ''}฿${display}</div>
        <div class="quick-amount-row">${[50,100,200,500,1000].map(n => `<button onclick="App._quickAmount(${n})">฿${n}</button>`).join('')}</div>
      </div>
      <div style="padding-bottom:8px">
        <div class="numpad">${['7','8','9','4','5','6','1','2','3','.','0','⌫'].map(k => `<button class="numpad-key${k === '⌫' ? ' del' : ''}" onclick="App._numpad('${k}')">${k}</button>`).join('')}</div>
        <div style="padding:8px 16px 0"><button class="btn btn-primary" style="background:${canNext ? color : '#D1D5DB'};box-shadow:${canNext ? `0 4px 16px ${color}44` : 'none'}" onclick="App._goToDetail()">${canNext ? `ถัดไป  ฿${display} →` : 'ใส่จำนวนเงิน'}</button></div>
      </div>
    </div>`
  }

  App._quickAmount = function(n) {
    S.tx.amount = String(n)
    App._renderAddTxAmount()
  }

  App._renderAddTxDetail = function() {
    const cats = S.tx.type === 'income' ? S.categories.income : S.categories.expense
    const amount = parseFloat(S.tx.amount || 0)
    const display = Number.isFinite(amount) ? amount.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0'
    const walletOptions = S.wallets.map(w => `<option value="${esc(w.id)}"${S.tx.walletId === w.id ? ' selected' : ''}>${esc(w.icon)} ${esc(w.name)}</option>`).join('')
    const toWalletOptions = S.wallets.filter(w => w.id !== S.tx.walletId).map(w => `<option value="${esc(w.id)}"${S.tx.toWalletId === w.id ? ' selected' : ''}>${esc(w.icon)} ${esc(w.name)}</option>`).join('')
    const isExpense = S.tx.type === 'expense'
    const needsCat = S.tx.type !== 'transfer'
    const color = typeColor(S.tx.type)
    const box = document.getElementById('add-tx-content')
    if (!box) return
    box.innerHTML = `<div class="sheet-header"><h2>${S.txMode === 'edit' ? 'แก้ไขรายละเอียด' : 'รายละเอียดรายการ'}</h2><button class="btn-icon" onclick="App.closeOverlay('overlay-add-tx')">✕</button></div>
      <div class="sheet-body">
        <div class="amount-summary-card ${activeColorClass(S.tx.type)}" onclick="App._backToAmount()">
          <div><small>${esc(typeLabel(S.tx.type))} · แตะเพื่อแก้ไข</small><strong>${S.tx.type === 'income' ? '+' : S.tx.type === 'expense' ? '-' : ''}฿${display}</strong></div><div style="font-size:20px">✏️</div>
        </div>
        ${needsCat ? `<div class="form-group"><label class="form-label">หมวดหมู่</label><div class="cat-grid">${cats.map(c => `<button type="button" class="cat-btn${S.tx.categoryId === c.id ? ' active' : ''}" onclick="App._selectCat('${esc(c.id)}')"><span class="cat-icon">${esc(c.icon)}</span><span>${esc(c.label)}</span></button>`).join('')}</div></div>` : ''}
        <div class="form-group"><label class="form-label">${S.tx.type === 'transfer' ? 'จากบัญชี' : 'บัญชีที่ใช้'}</label><select class="form-input" id="tx-wallet" onchange="App._txField('walletId',this.value);${S.tx.type === 'transfer' ? 'App._renderAddTxDetail()' : ''}">${walletOptions}</select></div>
        ${S.tx.type === 'transfer' ? `<div class="form-group"><label class="form-label">ไปบัญชี</label><select class="form-input" id="tx-towallet" onchange="App._txField('toWalletId',this.value)"><option value="">เลือกปลายทาง</option>${toWalletOptions}</select><div class="form-hint">รายการโอนจะแสดงเป็น “ต้นทาง → ปลายทาง”</div></div>` : `<div class="form-group"><label class="form-label">ร้านค้า / แหล่งที่มา</label><input class="form-input" id="tx-merchant" placeholder="เช่น Grab, Netflix, เงินเดือน" value="${esc(S.tx.merchant)}" oninput="App._txField('merchant',this.value)"></div>`}
        <div style="display:flex;gap:10px;margin-bottom:13px"><div style="flex:1"><label class="form-label">วันที่</label><input class="form-input" type="date" id="tx-date" value="${esc(S.tx.date)}" onchange="App._txField('date',this.value)"></div><div style="flex:1"><label class="form-label">หมายเหตุ</label><input class="form-input" id="tx-note" placeholder="เพิ่มเติม..." value="${esc(S.tx.note)}" oninput="App._txField('note',this.value)"></div></div>
        ${isExpense ? `<div class="form-group"><label class="form-label">ตัวเลือก</label><div class="tx-flag-grid"><button type="button" class="flag-pill${S.tx.isRecurring ? ' active' : ''}" onclick="App._toggleTxFlag('isRecurring')">🔁 ประจำ</button><button type="button" class="flag-pill installment${S.tx.isInstallment ? ' active' : ''}" onclick="App._toggleTxFlag('isInstallment')">📦 ผ่อนชำระ</button></div></div>${S.tx.isInstallment ? `<div class="form-group"><label class="form-label">จำนวนงวด</label><div class="installment-month-grid">${[3,6,10,12].map(m => `<button type="button" class="${String(S.tx.installmentMonths || '') === String(m) ? 'active' : ''}" onclick="App._txField('installmentMonths','${m}');App._renderAddTxDetail()">${m}</button>`).join('')}</div><input class="form-input" type="number" min="1" inputmode="numeric" value="${esc(S.tx.installmentMonths || '')}" placeholder="หรือกรอกจำนวนงวดเอง" oninput="App._txField('installmentMonths',this.value)" style="margin-top:8px"></div>` : ''}` : ''}
        <button class="btn btn-primary" style="background:${color};box-shadow:0 4px 16px ${color}44" onclick="App.saveTx()">${S.txMode === 'edit' ? 'บันทึกการแก้ไข' : `บันทึก ${S.tx.type === 'income' ? '+' : S.tx.type === 'expense' ? '-' : ''}฿${display}`}</button>
      </div>`
  }

  App.openAddTx = function() {
    S.txMode = 'add'
    S.editingTxId = null
    S.tx = { step:'amount', type:'expense', amount:'0', walletId:primaryWallet(), toWalletId:'', categoryId:'', merchant:'', note:'', date:TODAY, isRecurring:false, isInstallment:false, installmentMonths:'' }
    App._renderAddTxAmount()
    App.openOverlay('overlay-add-tx')
  }

  App.render()
})();

/* ============================================================
   V2.2.1 Chrome sync fix
   Ensures the dashboard FAB visibility always matches the active page,
   even after render overrides or future patches.
   ============================================================ */
;(function v221ChromeSync(){
  const syncChrome = () => {
    const isDashboard = S.page === 'dashboard'
    const fab = document.getElementById('fab')
    if (fab) fab.classList.toggle('hidden', !isDashboard)
    document.body.classList.toggle('is-dashboard', isDashboard)
  }

  const prevShowPage = App.showPage.bind(App)
  App.showPage = function(page) {
    prevShowPage(page)
    syncChrome()
  }

  const prevRender = App.render.bind(App)
  App.render = function() {
    const result = prevRender()
    syncChrome()
    return result
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncChrome, { once: true })
  } else {
    syncChrome()
  }
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 0)
  raf(syncChrome)
})();

/* ============================================================
   V2.2.2 Final mobile chrome guard
   Keeps viewport height, 5-tab nav, and dashboard-only FAB stable
   without touching transaction/storage/sync logic.
   ============================================================ */
;(function v222FinalMobileChrome(){
  const root = document.documentElement
  const setAppHeight = () => {
    const vv = window.visualViewport
    const h = Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight || 0)
    if (h > 0) root.style.setProperty('--app-height', `${h}px`)
  }

  const syncChrome = () => {
    const isDashboard = S.page === 'dashboard'
    document.body.classList.toggle('is-dashboard', isDashboard)
    const fab = document.getElementById('fab')
    if (fab) {
      fab.classList.toggle('hidden', !isDashboard)
      fab.setAttribute('aria-hidden', isDashboard ? 'false' : 'true')
      fab.tabIndex = isDashboard ? 0 : -1
    }

    const nav = document.getElementById('bottom-nav')
    if (nav) {
      nav.querySelectorAll('.nav-fab-space').forEach(el => el.remove())
      nav.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === S.page)
      })
    }
  }

  const prevShowPage = App.showPage.bind(App)
  App.showPage = function(page) {
    prevShowPage(page)
    setAppHeight()
    syncChrome()
  }

  const prevRender = App.render.bind(App)
  App.render = function() {
    const result = prevRender()
    setAppHeight()
    syncChrome()
    return result
  }

  setAppHeight()
  syncChrome()
  window.addEventListener?.('resize', setAppHeight, { passive: true })
  window.addEventListener?.('orientationchange', () => setTimeout(() => { setAppHeight(); syncChrome() }, 60), { passive: true })
  window.visualViewport?.addEventListener('resize', setAppHeight, { passive: true })
  window.visualViewport?.addEventListener('scroll', setAppHeight, { passive: true })

  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 0)
  raf(() => { setAppHeight(); syncChrome() })
})();

/* ============================================================
   V2.2.3 Readability + Interaction Fixes
   Fixes: number comma format, wallet edit overlay stack, visible wallet
   cards, budget tabs, and category color picker. Presentation only;
   storage/sync/calculation structures are preserved.
   ============================================================ */
;(function v223ReadabilityInteractionFixes(){
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))
  const fmt = n => moneyFmt(Number(n) || 0)
  const numFmt = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
  const clampPct = n => Math.max(0, Math.min(100, Number(n) || 0))
  const investTypes = new Set(['gold','crypto','fcd'])
  const isInvest = w => investTypes.has(w?.type)
  const walletValue = w => {
    if (!w) return 0
    if (App._walletValueTHB) return Number(App._walletValueTHB(w) || 0)
    if (isInvest(w) && App._investmentValueTHB) return Number(App._investmentValueTHB(w) || 0)
    return Number(w.balance || 0)
  }

  // Wallet cards: use CSS variables so final CSS can keep gradient cards visible.
  App._walletCard = function(w) {
    const isCC = w.type === 'credit'
    const inv = isInvest(w)
    const owed = Math.abs(Number(w.balance || 0))
    const value = isCC ? owed : walletValue(w)
    const usedPct = isCC && w.limit ? clampPct((owed / w.limit) * 100) : 0
    const due = isCC && w.dueDay ? Calc.getDueDate(w.dueDay) : null
    const avail = isCC && w.limit ? Math.max(0, Number(w.limit || 0) - owed) : 0
    const unitPrice = inv && App._investmentUnitPriceTHB ? Number(App._investmentUnitPriceTHB(w) || 0) : 0
    const color = w.color || (isCC ? '#DC2626' : '#2563EB')
    const detailAction = isCC ? `App.openCCDetail('${esc(w.id)}')` : `App.openWalletDetail('${esc(w.id)}')`
    const marketText = inv && App._marketText ? App._marketText(w) : ''
    return `<div class="wallet-card wallet-card-colored" style="--wallet-color:${esc(color)};--wallet-color-2:${esc(color)}BB" onclick="${detailAction}">
      <div class="wc-header"><div><div class="wc-name">${esc(w.icon)} ${esc(w.name)}</div><div class="wc-type">${esc(App._walletTypeLabel(w.type))}${marketText ? ` · ${esc(marketText)}` : ''}</div></div></div>
      <div class="wc-balance">${isCC && !S.settings.hideMoney ? '-' : ''}${fmt(value)}</div>
      ${inv ? `<div class="wc-prog-info" style="margin-top:10px"><span>จำนวน ${numFmt(w.units)} ${esc(w.symbol || '')}</span><span>${fmt(unitPrice)}/หน่วย</span></div>` : ''}
      ${isCC && w.limit ? `<div class="wc-limit"><div class="wc-prog-bar"><div class="wc-prog-fill" style="width:${usedPct}%;background:${usedPct > 80 ? 'rgba(252,165,165,.9)' : 'rgba(255,255,255,.88)'}"></div></div><div class="wc-prog-info"><span>ใช้ไป ${usedPct.toFixed(0)}% · คงเหลือ ${fmt(avail)}</span>${due ? `<span>ครบ ${esc(due.dueStr)} (${due.daysLeft}ว.)</span>` : ''}</div></div>` : ''}
      <div class="wc-action-row">
        <button class="wallet-chip-btn" onclick="event.stopPropagation();${detailAction}">ดูรายการ</button>
        ${isCC ? `<button class="wallet-chip-btn" onclick="event.stopPropagation();App.openCCPay('${esc(w.id)}')">ชำระ</button>` : ''}
        <button class="wallet-chip-btn" onclick="event.stopPropagation();App.openWalletForm('${esc(w.id)}')">แก้ไข</button>
      </div>
    </div>`
  }

  // Budget screen: split into two tabs, preserving existing budget arrays.
  App.openBudgetScreen = function(kind = S.budgetTab || 'expense') {
    S.budgetTab = kind === 'income' ? 'income' : 'expense'
    const active = S.budgetTab
    const listKey = active === 'income' ? 'incomeBudgets' : 'budgets'
    S[listKey] ||= []
    const label = active === 'income' ? 'รายรับ' : 'รายจ่าย'
    const verb = active === 'income' ? 'รับแล้ว' : 'ใช้ไปแล้ว'
    const cats = S.categories[active] || []
    const rows = cats.map(cat => {
      const b = S[listKey].find(x => x.categoryId === cat.id)
      const spent = S.transactions
        .filter(t => (t.date || '').startsWith(THIS_MONTH) && t.type === active && t.categoryId === cat.id)
        .reduce((sum, t) => sum + Number(t.amount || 0), 0)
      return { cat, limit: b?.monthlyLimit || 0, spent }
    })
    const rowsHtml = rows.length ? rows.map(r => `<div class="budget-row">
      <div class="budget-row-top"><div class="budget-row-title">${esc(r.cat.icon)} ${esc(r.cat.label)}</div><div class="budget-row-used">${verb} ${fmt(r.spent)}</div></div>
      <input class="form-input" type="number" inputmode="decimal" id="budget-${active}-${esc(r.cat.id)}" value="${r.limit || ''}" placeholder="0 = ไม่กำหนด">
    </div>`).join('') : App._emptyState('💰', `ยังไม่มีหมวด${label}`, 'ไปที่จัดการหมวดหมู่เพื่อเพิ่มหมวด')

    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>ตั้งงบประมาณ</h2><button class="btn btn-primary btn-sm" onclick="App.saveBudgets('${active}')" style="width:auto;padding:8px 16px">บันทึก</button></div>
      <div class="sub-scroll">
        <div class="budget-tabs"><button class="budget-tab ${active === 'expense' ? 'active' : ''}" onclick="App.openBudgetScreen('expense')">รายจ่าย</button><button class="budget-tab ${active === 'income' ? 'active' : ''}" onclick="App.openBudgetScreen('income')">รายรับ</button></div>
        <p style="font-size:13.5px;color:var(--muted);margin-bottom:14px">${active === 'income' ? 'ตั้งเป้ารายรับรายเดือนแต่ละหมวด' : 'ตั้งงบรายจ่ายรายเดือนแต่ละหมวด'} (0 = ไม่กำหนด)</p>
        <div class="card card-pad">${rowsHtml}</div>
      </div>`)
  }

  App.saveBudgets = function(kind = S.budgetTab || 'expense') {
    const active = kind === 'income' ? 'income' : 'expense'
    const key = active === 'income' ? 'incomeBudgets' : 'budgets'
    S[key] ||= []
    ;(S.categories[active] || []).forEach(cat => {
      const val = parseFloat(document.getElementById(`budget-${active}-${cat.id}`)?.value) || 0
      const idx = S[key].findIndex(b => b.categoryId === cat.id)
      if (val > 0) {
        if (idx >= 0) S[key][idx].monthlyLimit = val
        else S[key].push({ categoryId: cat.id, monthlyLimit: val })
      } else if (idx >= 0) {
        S[key].splice(idx, 1)
      }
    })
    persist()
    App.closeSubScreen()
    toast(`บันทึกงบ${active === 'income' ? 'รายรับ' : 'รายจ่าย'}แล้ว`, 'success')
  }

  // Category color: add swatches + a larger native picker for reliable mobile tap.
  App.setCategoryColor = function(color) {
    const input = document.getElementById('cat-color')
    if (input) input.value = color
    document.querySelectorAll('.color-swatch').forEach(btn => btn.classList.toggle('active', btn.dataset.color === color))
  }

  App.openCategoryForm = function(id) {
    const type = S.catManageType || 'expense'
    const c = id ? (S.categories[type] || []).find(x => x.id === id) : null
    const color = c?.color || '#2563EB'
    const palette = ['#2563EB','#16A34A','#DC2626','#F59E0B','#7C3AED','#0891B2','#BE185D','#475569','#0F766E','#EA580C','#4F46E5','#111827']
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.openCategoryScreen('${type}')">←</button><h2>${c ? 'แก้ไข' : 'เพิ่ม'}หมวดหมู่</h2><button class="btn btn-primary btn-sm" onclick="App.saveCategory('${id || ''}')" style="width:auto;padding:8px 14px">บันทึก</button></div>
      <div class="sub-scroll">
        <div class="form-group"><label class="form-label">ชื่อหมวดหมู่</label><input class="form-input" id="cat-name" value="${esc(c?.label || '')}"></div>
        <div class="form-group"><label class="form-label">อีโมจิ</label><input class="form-input" id="cat-icon" value="${esc(c?.icon || '📦')}"></div>
        <div class="form-group"><label class="form-label">สี</label><div class="color-picker-row">${palette.map(p => `<button type="button" class="color-swatch${p === color ? ' active' : ''}" data-color="${p}" style="background:${p}" onclick="App.setCategoryColor('${p}')" aria-label="เลือกสี ${p}"></button>`).join('')}</div><input class="form-input color-input-native" id="cat-color" type="color" value="${esc(color)}" oninput="App.setCategoryColor(this.value)"><div class="form-hint">เลือกจากสีด้านบน หรือแตะช่องสีเพื่อเปิดตัวเลือกสีของเครื่อง</div></div>
      </div>`)
  }

  // Make sure overlay sheets can sit above a currently open sub-screen.
  const prevOpenOverlay = App.openOverlay.bind(App)
  App.openOverlay = function(id) {
    const result = prevOpenOverlay(id)
    const el = document.getElementById(id)
    if (el) el.style.zIndex = ['overlay-wallet-form','overlay-cc-pay','overlay-add-tx','overlay-tx-detail'].includes(id) ? '820' : ''
    return result
  }

  // Re-render current page so patched wallet cards are applied immediately.
  try { App.render() } catch (_) {}
})();

/* ============================================================
   V2.2.5 Practical UX polish + data fixes
   Scope: category/merchant editors, CC benefit tabs, wallet cards,
   Aurora gold THB pricing, transaction list UI, add-tx category picker,
   and rule-based AI-style financial insights. No storage schema rewrite.
   ============================================================ */
;(function v225PracticalUxFixes(){
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))
  const fmt = n => moneyFmt(Number(n) || 0)
  const numFmt = (n, digits = 2) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: digits })
  const pct = n => Math.max(0, Math.min(100, Number(n) || 0))
  const investTypes = new Set(['gold','crypto','fcd'])
  const AURORA_GOLD_URL = 'https://www.aurora.co.th/price/gold_pricelist'
  const EMOJIS = ['🍜','☕','🛒','🛍️','🚗','⛽','🏠','💡','📱','🎬','💊','🏥','🎁','💰','💼','📈','🍱','🥗','✈️','🚆','🐶','🎮','🧾','🏪','💳','🏦','🥇','₿','📦','✨','🔁','🛡️']
  const COLORS = ['#2563EB','#16A34A','#DC2626','#F59E0B','#7C3AED','#0891B2','#BE185D','#475569','#0F766E','#EA580C','#4F46E5','#111827']

  function typeColor(type) {
    if (type === 'income') return 'var(--income)'
    if (type === 'transfer') return 'var(--primary)'
    return 'var(--expense)'
  }

  function signedAmount(tx) {
    if (S.settings?.hideMoney) return '฿••••'
    if (tx.type === 'income') return '+' + fmt(tx.amount)
    if (tx.type === 'expense' || tx.type === 'cc_payment') return '-' + fmt(tx.amount)
    return fmt(tx.amount)
  }

  function txVisual(tx) {
    const cat = App._findCat?.(tx.categoryId)
    const wallet = S.wallets.find(w => w.id === tx.walletId)
    const toWallet = S.wallets.find(w => w.id === tx.toWalletId)
    const isTransfer = tx.type === 'transfer'
    const title = isTransfer ? `${wallet?.name || 'ไม่ระบุ'} → ${toWallet?.name || 'ไม่ระบุ'}` : (tx.merchant || tx.note || cat?.label || 'รายการ')
    const icon = cat?.icon || (tx.type === 'income' ? '💰' : isTransfer ? '🔁' : tx.type === 'cc_payment' ? '💳' : '💸')
    const meta = []
    if (cat?.label) meta.push(cat.label)
    if (wallet?.name && !isTransfer) meta.push(wallet.name)
    if (isTransfer) meta.push('โอนเงิน')
    if (tx.isRecurring) meta.push('🔁 ประจำ')
    if (tx.isInstallment) meta.push(`ผ่อน ${tx.installmentNo || 1}/${tx.installmentMonths || '?'}`)
    return { cat, wallet, toWallet, title, icon, meta }
  }

  function fullMonthLabel(ym) {
    if (!ym) return ''
    const [y, m] = ym.split('-').map(Number)
    const names = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
    return `${names[m - 1]} ${y}`
  }

  function groupDateLabel(dateStr) {
    if (!dateStr) return ''
    const base = Calc.shortDate(dateStr)
    if (dateStr === TODAY) return `วันนี้ ${base}`
    const y = new Date(); y.setDate(y.getDate() - 1)
    if (dateStr === y.toISOString().slice(0, 10)) return `เมื่อวาน ${base}`
    return base
  }

  function filterTransactionsForList() {
    const q = (S.txSearch || '').toLowerCase()
    return S.transactions.filter(t => {
      if (!String(t.date || '').startsWith(S.txMonth)) return false
      if (S.txType !== 'all' && t.type !== S.txType) return false
      if (!q) return true
      const cat = App._findCat?.(t.categoryId)
      const wallet = S.wallets.find(w => w.id === t.walletId)
      const toWallet = S.wallets.find(w => w.id === t.toWalletId)
      return [t.merchant, t.note, cat?.label, wallet?.name, toWallet?.name].some(v => String(v || '').toLowerCase().includes(q))
    }).sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')))
  }

  function renderEditorEmoji(prefix, current, targetId) {
    return `<button type="button" class="emoji-current" onclick="App.toggleEmojiPanel('${prefix}')"><span id="${prefix}-emoji-preview">${esc(current)}</span><small>แตะเพื่อเปลี่ยน</small></button>
      <input type="hidden" id="${targetId}" value="${esc(current)}">
      <div class="emoji-grid" id="${prefix}-emoji-panel" style="display:none">${EMOJIS.map(e => `<button type="button" onclick="App.pickEmoji('${prefix}','${e}')">${e}</button>`).join('')}<button type="button" onclick="App.customEmoji('${prefix}')">＋</button></div>`
  }

  function renderEditorColor(prefix, current, targetId) {
    const normalized = current || '#2563EB'
    return `<div class="color-picker-row compact-colors">${COLORS.map(c => `<button type="button" class="color-swatch${c.toLowerCase() === String(normalized).toLowerCase() ? ' active' : ''}" data-color="${c}" style="background:${c}" onclick="App.pickColor('${prefix}','${c}')" aria-label="เลือกสี ${c}"></button>`).join('')}<label class="color-swatch color-swatch-custom" style="--picked:${esc(normalized)}" aria-label="เลือกสีเอง"><input type="color" id="${prefix}-color-native" value="${esc(normalized)}" oninput="App.pickColor('${prefix}', this.value)"><span>＋</span></label></div>
      <input type="hidden" id="${targetId}" value="${esc(normalized)}"><div class="form-hint">เลือกจากสี preset หรือแตะวงกลมท้ายสุดเพื่อกำหนดสีเอง</div>`
  }

  App.toggleEmojiPanel = function(prefix) {
    const panel = document.getElementById(prefix + '-emoji-panel')
    if (!panel) return
    panel.style.display = panel.style.display === 'grid' ? 'none' : 'grid'
  }
  App.pickEmoji = function(prefix, emoji) {
    const target = document.getElementById(prefix === 'cat' ? 'cat-icon' : `${prefix}-emoji`)
    const preview = document.getElementById(prefix + '-emoji-preview')
    if (target) target.value = emoji
    if (preview) preview.textContent = emoji
    const panel = document.getElementById(prefix + '-emoji-panel')
    if (panel) panel.style.display = 'none'
  }
  App.customEmoji = function(prefix) {
    const v = prompt('ใส่อีโมจิที่ต้องการ')
    if (v && v.trim()) App.pickEmoji(prefix, v.trim().slice(0, 4))
  }
  App.pickColor = function(prefix, color) {
    const hiddenId = prefix === 'cat' ? 'cat-color' : prefix === 'mer' ? 'mer-color' : prefix === 'wf' ? 'wf-color' : `${prefix}-color`
    const hidden = document.getElementById(hiddenId)
    if (hidden) hidden.value = color
    const native = document.getElementById(prefix + '-color-native')
    if (native) native.value = color
    document.querySelectorAll('.color-swatch[data-color]').forEach(btn => btn.classList.toggle('active', String(btn.dataset.color).toLowerCase() === String(color).toLowerCase()))
    document.querySelectorAll('.color-swatch-custom').forEach(el => el.style.setProperty('--picked', color))
  }
  App.setCategoryColor = color => App.pickColor('cat', color)

  App.openCategoryForm = function(id) {
    const type = S.catManageType || 'expense'
    const c = id ? (S.categories[type] || []).find(x => x.id === id) : null
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.openCategoryScreen('${type}')">←</button><h2>${c ? 'แก้ไข' : 'เพิ่ม'}หมวดหมู่</h2><button class="btn btn-primary btn-sm" onclick="App.saveCategory('${esc(id || '')}')" style="width:auto;padding:8px 14px">บันทึก</button></div>
      <div class="sub-scroll">
        <div class="form-group"><label class="form-label">ชื่อหมวดหมู่</label><input class="form-input" id="cat-name" value="${esc(c?.label || '')}" placeholder="เช่น อาหาร, เดินทาง"></div>
        <div class="form-group"><label class="form-label">อีโมจิ</label>${renderEditorEmoji('cat', c?.icon || '📦', 'cat-icon')}</div>
        <div class="form-group"><label class="form-label">สี</label>${renderEditorColor('cat', c?.color || '#2563EB', 'cat-color')}</div>
      </div>`)
  }

  App.openMerchantForm = function(id) {
    App._ensureV2State?.()
    const m = id ? S.merchants.find(x => x.id === id) : null
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.openMerchantScreen()">←</button><h2>${m ? 'แก้ไข' : 'เพิ่ม'}ร้านค้า</h2><button class="btn btn-primary btn-sm" onclick="App.saveMerchant('${esc(id || '')}')" style="width:auto;padding:8px 14px">บันทึก</button></div>
      <div class="sub-scroll">
        <div class="form-group"><label class="form-label">ชื่อร้านค้า</label><input class="form-input" id="mer-name" value="${esc(m?.name || '')}" placeholder="เช่น Grab, Netflix"></div>
        <div class="form-group"><label class="form-label">อีโมจิ</label>${renderEditorEmoji('mer', m?.emoji || '🏪', 'mer-emoji')}</div>
        <div class="form-group"><label class="form-label">สี</label>${renderEditorColor('mer', m?.color || '#2563EB', 'mer-color')}</div>
      </div>`)
  }

  App.openCCBenefitScreen = function(cardId, tab = S.ccBenefitTab || 'points') {
    S.ccBenefitTab = tab === 'cashback' ? 'cashback' : 'points'
    const b = App._benefit?.(cardId) || S.ccBenefits?.[cardId] || { points:{}, cashback:{} }
    const p = b.points || {}, c = b.cashback || {}
    const f = (id, label, value, hint = '') => `<div class="form-group"><label class="form-label">${label}</label><input class="form-input" type="number" step="0.01" id="${id}" value="${value || ''}" placeholder="0">${hint ? `<div class="form-hint">${hint}</div>` : ''}</div>`
    const pointsForm = `<div class="card card-pad benefit-pane"><div class="benefits-toggle-row"><b>เปิดคะแนนสะสม</b><button class="toggle${(p.enabled || b.enabled) ? ' on' : ''}" id="ccb-points-enabled" onclick="this.classList.toggle('on')"></button></div><div class="benefit-form-grid">${f('ccb-bahtPerPoint','X บาท = 1 คะแนน',p.bahtPerPoint)}${f('ccb-pointEvery','ทุก X บาทได้ 1 คะแนน',p.pointPerBahtEvery)}${f('ccb-multi','คะแนนเพิ่ม X เท่า',p.multiplier || 1)}${f('ccb-maxTxnPoint','สูงสุด/รายการ',p.maxPerTxn)}${f('ccb-maxCyclePoint','สูงสุด/รอบบัญชี',p.maxPerCycle)}</div></div>`
    const cashForm = `<div class="card card-pad benefit-pane"><div class="benefits-toggle-row"><b>เปิด Cashback</b><button class="toggle${(c.enabled || b.enabled) ? ' on' : ''}" id="ccb-cash-enabled" onclick="this.classList.toggle('on')"></button></div><div class="benefit-form-grid">${f('ccb-cbPercent','รับเงินคืน X%',c.percent)}${f('ccb-cbMin','ขั้นต่ำ (฿)',c.minSpend)}${f('ccb-cbTier','เริ่มขั้นบันไดที่ (฿)',c.tierThreshold)}${f('ccb-cbEvery','คิดทุก ๆ X บาท',c.everyBaht || 1)}${f('ccb-cbMaxTxn','สูงสุด/รายการ (฿)',c.maxPerTxn)}${f('ccb-cbMaxCycle','สูงสุด/รอบบัญชี (฿)',c.maxPerCycle)}</div></div>`
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.openCCDetail('${esc(cardId)}')">←</button><h2>สิทธิประโยชน์บัตร</h2><button class="btn btn-primary btn-sm" onclick="App.saveCCBenefit('${esc(cardId)}')" style="width:auto">บันทึก</button></div>
      <div class="sub-scroll">
        <div class="benefit-tabs"><button class="benefit-tab ${S.ccBenefitTab === 'points' ? 'active' : ''}" onclick="App.openCCBenefitScreen('${esc(cardId)}','points')">คะแนนสะสม</button><button class="benefit-tab ${S.ccBenefitTab === 'cashback' ? 'active' : ''}" onclick="App.openCCBenefitScreen('${esc(cardId)}','cashback')">Cashback</button></div>
        ${S.ccBenefitTab === 'points' ? pointsForm : cashForm}
      </div>`)
  }

  App.saveCCBenefit = function(cardId) {
    const prev = App._benefit?.(cardId) || S.ccBenefits?.[cardId] || { points:{}, cashback:{} }
    const pp = prev.points || {}, pc = prev.cashback || {}
    const val = (id, fallback = 0) => document.getElementById(id) ? (parseFloat(document.getElementById(id).value) || 0) : (Number(fallback) || 0)
    const on = (id, fallback = false) => document.getElementById(id) ? document.getElementById(id).classList.contains('on') : !!fallback
    S.ccBenefits ||= {}
    S.ccBenefits[cardId] = {
      enabled: false,
      points: {
        enabled: on('ccb-points-enabled', pp.enabled || prev.enabled),
        bahtPerPoint: val('ccb-bahtPerPoint', pp.bahtPerPoint),
        pointPerBahtEvery: val('ccb-pointEvery', pp.pointPerBahtEvery),
        multiplier: val('ccb-multi', pp.multiplier || 1) || 1,
        maxPerTxn: val('ccb-maxTxnPoint', pp.maxPerTxn),
        maxPerCycle: val('ccb-maxCyclePoint', pp.maxPerCycle),
      },
      cashback: {
        enabled: on('ccb-cash-enabled', pc.enabled || prev.enabled),
        percent: val('ccb-cbPercent', pc.percent),
        minSpend: val('ccb-cbMin', pc.minSpend),
        tierThreshold: val('ccb-cbTier', pc.tierThreshold),
        everyBaht: val('ccb-cbEvery', pc.everyBaht || 1) || 1,
        maxPerTxn: val('ccb-cbMaxTxn', pc.maxPerTxn),
        maxPerCycle: val('ccb-cbMaxCycle', pc.maxPerCycle),
      }
    }
    persist(); App.openCCDetail(cardId); toast('บันทึกสิทธิประโยชน์แล้ว', 'success')
  }

  App._parseAuroraGold = function(html) {
    const clean = String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/g, ' ')
      .replace(/\s+/g, ' ')
    const anchor = clean.search(/รับซื้อรูปพรรณออโรร่า|รับซื้อคืน|ทองคำแท่ง/i)
    const tail = anchor >= 0 ? clean.slice(anchor) : clean
    const nums = tail.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g) || []
    const toNumber = s => Number(String(s || '').replace(/,/g, '')) || 0
    const barBuy = toNumber(nums[0])
    const barSell = toNumber(nums[1])
    const jewelryBuy = toNumber(nums[2]) || toNumber(nums.find(n => toNumber(n) > 10000 && toNumber(n) < 200000))
    return jewelryBuy ? { jewelryBuy, barBuy, barSell, source: 'Aurora', url: AURORA_GOLD_URL, fetchedAt: new Date().toISOString() } : null
  }

  App.refreshMarketPrices = async function() {
    const next = { ...(S.marketPrices || {}) }
    let ok = false
    try { const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,binancecoin,tether&vs_currencies=thb,usd', { cache:'no-store' }); if (r.ok) { next.crypto = await r.json(); ok = true } } catch {}
    try { const r = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=THB,EUR,JPY,GBP,CNY', { cache:'no-store' }); if (r.ok) { next.fx = await r.json(); ok = true } } catch {}
    try {
      const proxy = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(AURORA_GOLD_URL)
      const r = await fetch(proxy, { cache:'no-store' })
      if (r.ok) {
        const data = App._parseAuroraGold(await r.text())
        if (data?.jewelryBuy) { next.auroraGold = data; ok = true }
      }
    } catch {}
    next.updatedAt = new Date().toISOString()
    S.marketPrices = next
    persist(); App.renderWallets?.(); App.render?.()
    toast(ok ? 'อัปเดตราคาอ้างอิงแล้ว' : 'อัปเดตไม่ได้ ใช้ราคาสำรองในกระเป๋าแทน', ok ? 'success' : 'warn')
  }

  App._investmentUnitPriceTHB = function(w) {
    const p = S.marketPrices || {}
    if (w.type === 'gold') return Number(p.auroraGold?.jewelryBuy || w.manualPrice || 0)
    if (w.type === 'crypto') {
      const map = { BTC:'bitcoin', ETH:'ethereum', BNB:'binancecoin', USDT:'tether' }
      const id = map[(w.symbol || '').toUpperCase()]
      return Number((id && p.crypto?.[id]?.thb) || w.manualPrice || 0)
    }
    if (w.type === 'fcd') {
      const cur = (w.currency || w.symbol || 'USD').toUpperCase()
      const thb = p.fx?.rates?.THB
      return Number((cur === 'USD' ? thb : (thb && p.fx?.rates?.[cur] ? thb / p.fx.rates[cur] : 0)) || w.manualPrice || 0)
    }
    return 0
  }
  App._investmentValueTHB = w => investTypes.has(w?.type) ? ((Number(w.units || 0) * App._investmentUnitPriceTHB(w)) || Number(w.balance || 0)) : Number(w?.balance || 0)
  App._marketText = function(w) {
    const p = S.marketPrices || {}
    if (w.type === 'gold') return p.auroraGold?.jewelryBuy ? `Aurora รับซื้อรูปพรรณ ${fmt(p.auroraGold.jewelryBuy)}/บาททอง` : 'ใช้ราคาสำรอง/บาททอง'
    if (w.type === 'crypto') { const coin = (w.symbol || w.name || '').toUpperCase(); const map = {BTC:'bitcoin', ETH:'ethereum', BNB:'binancecoin', USDT:'tether'}; const id = map[coin]; const thb = id && p.crypto?.[id]?.thb; return thb ? `${coin} ${fmt(thb)}` : 'CoinGecko' }
    if (w.type === 'fcd') { const cur = (w.currency || w.symbol || 'USD').toUpperCase(); const rate = cur === 'USD' ? p.fx?.rates?.THB : (p.fx?.rates?.THB && p.fx?.rates?.[cur] ? p.fx.rates.THB / p.fx.rates[cur] : null); return rate ? `${cur}/THB ${rate.toFixed(2)}` : 'FX อ้างอิง' }
    return ''
  }

  App._walletCard = function(w) {
    const isCC = w.type === 'credit'
    const inv = investTypes.has(w.type)
    const owed = Math.abs(Number(w.balance || 0))
    const value = isCC ? owed : (inv ? App._investmentValueTHB(w) : Number(w.balance || 0))
    const usedPct = isCC && w.limit ? pct((owed / w.limit) * 100) : 0
    const due = isCC && w.dueDay ? Calc.getDueDate(w.dueDay) : null
    const avail = isCC && w.limit ? Math.max(0, Number(w.limit || 0) - owed) : 0
    const color = w.color || (isCC ? '#DC2626' : '#2563EB')
    const detailAction = isCC ? `App.openCCDetail('${esc(w.id)}')` : `App.openWalletDetail('${esc(w.id)}')`
    const unitLabel = w.type === 'gold' ? 'บาททอง' : (w.symbol || w.currency || '')
    const priceText = inv ? App._marketText(w) : ''
    return `<div class="wallet-card wallet-card-colored${isCC ? ' wallet-card-credit' : ''}${inv ? ' wallet-card-invest' : ''}" style="--wallet-color:${esc(color)};--wallet-color-2:${esc(color)}BB" onclick="${detailAction}">
      <div class="wc-header"><div><div class="wc-name">${esc(w.icon)} ${esc(w.name)}</div><div class="wc-type">${esc(App._walletTypeLabel(w.type))}${priceText ? ` · ${esc(priceText)}` : ''}</div></div></div>
      <div class="wc-balance">${isCC && !S.settings.hideMoney ? '-' : ''}${fmt(value)}</div>
      ${inv ? `<div class="wc-prog-info wc-invest-info"><span>จำนวน ${numFmt(w.units, 4)} ${esc(unitLabel)}</span><span>${fmt(App._investmentUnitPriceTHB(w))}/หน่วย</span></div>` : ''}
      ${isCC && due ? `<div class="cc-due-strip${due.daysLeft <= 3 ? ' urgent' : ''}"><span>ครบกำหนดชำระ</span><strong>${esc(due.dueStr)}</strong><em>${due.daysLeft === 0 ? 'วันนี้' : `อีก ${due.daysLeft} วัน`}</em></div>` : ''}
      ${isCC && w.limit ? `<div class="wc-limit"><div class="wc-prog-bar"><div class="wc-prog-fill" style="width:${usedPct}%;background:${usedPct > 80 ? 'rgba(252,165,165,.9)' : 'rgba(255,255,255,.88)'}"></div></div><div class="wc-prog-info"><span>ใช้ไป ${usedPct.toFixed(0)}% · คงเหลือ ${fmt(avail)}</span></div></div>` : ''}
      <div class="wc-action-row"><button class="wallet-chip-btn" onclick="event.stopPropagation();${detailAction}">ดูรายการ</button>${isCC ? `<button class="wallet-chip-btn" onclick="event.stopPropagation();App.openCCPay('${esc(w.id)}')">ชำระ</button>` : ''}<button class="wallet-chip-btn" onclick="event.stopPropagation();App.openWalletForm('${esc(w.id)}')">แก้ไข</button></div>
    </div>`
  }

  App.renderWallets = function() {
    App._ensureV2State?.()
    const g = Calc.getWalletGroups ? Calc.getWalletGroups(S.wallets) : { assets:S.wallets.filter(w=>w.type!=='credit'), liabilities:S.wallets.filter(w=>w.type==='credit'), investments:[], assetTotal:0, liabilityTotal:0 }
    const summary = document.getElementById('wallets-summary')
    if (summary) summary.innerHTML = `<div class="wallet-summary-grid" style="width:100%"><div class="wallet-summary-card"><span>สินทรัพย์รวม</span><strong class="c-income">${fmt(g.assetTotal || g.assets || 0)}</strong></div><div class="wallet-summary-card"><span>หนี้สินรวม</span><strong class="c-expense">${fmt(g.liabilityTotal || g.debt || 0)}</strong></div></div>`
    const section = (title, icon, list, empty, grid) => `<div class="wallet-section-title">${icon} ${esc(title)}</div>${list.length ? `<div class="${grid ? 'wallet-grid-2' : 'wallet-list-stack'}">${list.map(w => App._walletCard(w)).join('')}</div>` : `<div class="card card-pad" style="font-size:13px;color:var(--muted);margin-bottom:12px">${esc(empty)}</div>`}`
    const updated = S.marketPrices?.auroraGold?.fetchedAt ? new Date(S.marketPrices.auroraGold.fetchedAt).toLocaleString('th-TH', { dateStyle:'short', timeStyle:'short' }) : ''
    const goldNote = `<div class="wallet-market-note">ทองคำใช้ราคา <b>รับซื้อรูปพรรณออโรร่า/บาททอง</b>${updated ? ` · อัปเดต ${esc(updated)}` : ''}</div>`
    document.getElementById('wallets-content').innerHTML = `<div class="wallet-toolbar"><button class="btn btn-secondary btn-sm" onclick="App.refreshMarketPrices()">↻ Refresh ราคา</button><button class="btn btn-primary btn-sm" onclick="App.openWalletForm(null)">+ เพิ่มกระเป๋า</button></div>${goldNote}${section('สินทรัพย์','🏦',g.assets || [],'ยังไม่มีสินทรัพย์',true)}${section('บัตรเครดิต','💳',g.liabilities || [],'ยังไม่มีบัตรเครดิต',false)}${section('การลงทุน','📈',g.investments || [],'เพิ่มทอง / Crypto / FCD เพื่อดูมูลค่าอ้างอิง',true)}`
  }

  const prevOpenWalletForm = App.openWalletForm.bind(App)
  App.openWalletForm = function(id) {
    prevOpenWalletForm(id)
    const w = id ? S.wallets.find(x => x.id === id) : null
    const row = document.getElementById('wf-color-row')
    if (row && !row.querySelector('.color-swatch-custom')) {
      row.classList.add('compact-colors')
      row.querySelectorAll('.color-dot').forEach(dot => dot.classList.add('color-swatch'))
      row.insertAdjacentHTML('beforeend', `<label class="color-swatch color-swatch-custom" style="--picked:${esc(document.getElementById('wf-color')?.value || '#2563EB')}" aria-label="เลือกสีเอง"><input type="color" id="wf-color-native" value="${esc(document.getElementById('wf-color')?.value || '#2563EB')}" oninput="App.pickColor('wf', this.value)"><span>＋</span></label>`)
    }
    const type = document.getElementById('wf-type')?.value
    const symbolInput = document.getElementById('wf-symbol')
    if (symbolInput && type === 'gold') {
      symbolInput.value = w?.symbol || 'บาททอง'
      symbolInput.placeholder = 'บาททอง'
      const label = symbolInput.closest('.form-group')?.querySelector('.form-label')
      if (label) label.textContent = 'หน่วยทองคำ'
    }
    const units = document.getElementById('wf-units')
    if (units) {
      const label = units.closest('.form-group')?.querySelector('.form-label')
      if (label && type === 'gold') label.textContent = 'จำนวนทองคำ (บาททอง)'
    }
    const manual = document.getElementById('wf-manual-price')
    if (manual) {
      const label = manual.closest('.form-group')?.querySelector('.form-label')
      if (label && type === 'gold') label.textContent = 'ราคาสำรองรับซื้อรูปพรรณออโรร่า/บาททอง'
      manual.value = manual.value ? Number(manual.value).toLocaleString('en-US').replace(/,/g,'') : manual.value
    }
  }
  const prevSelectWalletType = App._selectWalletType?.bind(App)
  App._selectWalletType = function(type) {
    prevSelectWalletType?.(type)
    if (type === 'gold') {
      const symbol = document.getElementById('wf-symbol')
      if (symbol && !symbol.value) symbol.value = 'บาททอง'
    }
  }
  const prevSaveWallet = App.saveWallet.bind(App)
  App.saveWallet = function() {
    const type = document.getElementById('wf-type')?.value
    const symbol = document.getElementById('wf-symbol')
    if (type === 'gold' && symbol) symbol.value = 'บาททอง'
    prevSaveWallet()
  }

  App._txRow = function(tx) {
    const v = txVisual(tx)
    const bg = v.cat?.color ? `${v.cat.color}16` : tx.type === 'transfer' ? 'rgba(37,99,235,.10)' : 'var(--elevated)'
    return `<div class="tx-row tx-row-modern tx-row--${esc(tx.type)}" data-txid="${esc(tx.id)}">
      <div class="tx-icon" style="background:${bg}">${esc(v.icon)}</div>
      <div class="tx-info"><div class="tx-title">${esc(v.title)}</div><div class="tx-sub">${v.meta.map(x => `<span class="tx-meta-pill">${esc(x)}</span>`).join('')}</div></div>
      <div class="tx-right"><div class="tx-amount" style="color:${typeColor(tx.type)}">${signedAmount(tx)}</div></div>
    </div>`
  }

  App.renderTransactions = function() {
    const months = Calc.getMonths(6)
    const header = document.querySelector('#page-transactions .page-header')
    if (header) {
      header.innerHTML = `<div class="tx-page-top"><div><h1>รายการทั้งหมด</h1><p>${esc(fullMonthLabel(S.txMonth))}</p></div><div class="mt-sync-pill"><span class="mt-sync-dot"></span><span>Synced</span></div></div>
        <div class="tx-summary-cards"><div class="tx-summary-card income"><span>รายรับ</span><strong id="tx-income-total">${fmt(0)}</strong></div><div class="tx-summary-card expense"><span>รายจ่าย</span><strong id="tx-expense-total">${fmt(0)}</strong></div></div>
        <div class="tx-search-wrap"><input class="form-input" id="tx-search" placeholder="🔍  ค้นหาร้านค้า หมวด หรือจำนวนเงิน" value="${esc(S.txSearch || '')}"></div>
        <div class="chips tx-filter-row" id="tx-type-chips">${[['all','ทั้งหมด'],['expense','รายจ่าย'],['income','รายรับ'],['transfer','โอนเงิน']].map(([v,l]) => `<button class="chip${S.txType === v ? ' active' : ''}" onclick="App.setTxType('${v}')">${l}</button>`).join('')}</div>
        <div class="chips tx-month-row" id="tx-month-chips">${months.map(m => `<button class="chip mini${m === S.txMonth ? ' active' : ''}" onclick="App.setTxMonth('${m}')">${esc(Calc.monthLabel(m))}</button>`).join('')}</div>`
    }
    const search = document.getElementById('tx-search')
    if (search) search.oninput = e => { S.txSearch = e.target.value; App.renderTransactionsList() }
    App.renderTransactionsList()
  }

  App.renderTransactionsList = function() {
    const filtered = filterTransactionsForList()
    const income = filtered.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount || 0), 0)
    const expense = filtered.filter(t => t.type === 'expense' || t.type === 'cc_payment').reduce((s,t) => s + Number(t.amount || 0), 0)
    const incEl = document.getElementById('tx-income-total'), expEl = document.getElementById('tx-expense-total')
    if (incEl) incEl.textContent = '+' + fmt(income)
    if (expEl) expEl.textContent = '-' + fmt(expense)
    const byDate = {}
    filtered.forEach(t => { (byDate[t.date] ||= []).push(t) })
    let html = ''
    const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a))
    if (!dates.length) html = App._emptyState('📋', 'ไม่มีรายการ', S.txSearch ? 'ไม่พบผลการค้นหา' : 'ยังไม่มีรายการในช่วงนี้')
    dates.forEach(date => {
      const rows = byDate[date]
      const dayInc = rows.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount || 0), 0)
      const dayExp = rows.filter(t => t.type === 'expense' || t.type === 'cc_payment').reduce((s,t) => s + Number(t.amount || 0), 0)
      html += `<div class="tx-date-header"><span>${esc(groupDateLabel(date))}</span><div>${dayInc ? `<b class="c-income">+${fmt(dayInc)}</b>` : ''}${dayExp ? `<b class="c-expense">-${fmt(dayExp)}</b>` : ''}</div></div><div class="tx-group-card">${rows.map(t => App._txRow(t)).join('')}</div>`
    })
    const el = document.getElementById('tx-list-content')
    if (el) el.innerHTML = html
    App._bindTxRows?.('tx-list-content')
  }

  const prevSetTxMonth = App.setTxMonth?.bind(App)
  App.setTxMonth = function(m) { S.txMonth = m; S.txSearch = S.txSearch || ''; App.renderTransactions() }
  App.setTxType = function(t) { S.txType = t; App.renderTransactions() }

  function getFrequentCategories(type) {
    const cats = S.categories[type] || []
    const usage = {}
    S.transactions.filter(t => t.type === type && t.categoryId).forEach(t => usage[t.categoryId] = (usage[t.categoryId] || 0) + 1)
    return [...cats].sort((a,b) => (usage[b.id] || 0) - (usage[a.id] || 0))
  }
  App.showAllTxCategories = function() { S.txShowAllCats = true; App._renderAddTxDetail() }
  App.hideAllTxCategories = function() { S.txShowAllCats = false; App._renderAddTxDetail() }
  const prevSetTxType = App._setTxType?.bind(App)
  App._setTxType = function(type) { S.txShowAllCats = false; prevSetTxType ? prevSetTxType(type) : (S.tx.type = type, S.tx.categoryId = '', App._renderAddTxAmount()) }
  App._selectCat = function(id) { S.tx.categoryId = id; document.querySelectorAll('#cat-grid .cat-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.catid === id)) }

  App._renderAddTxDetail = function() {
    const type = S.tx.type
    const typeKey = type === 'income' ? 'income' : 'expense'
    const allCats = getFrequentCategories(typeKey)
    const needsCat = type !== 'transfer'
    const shownCats = S.txShowAllCats ? allCats : allCats.slice(0, 5)
    const hasMore = needsCat && allCats.length > 5 && !S.txShowAllCats
    const amount = parseFloat(S.tx.amount || 0)
    const display = Number.isFinite(amount) ? amount.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0'
    const color = typeColor(type)
    const walletOptions = S.wallets.map(w => `<option value="${esc(w.id)}"${S.tx.walletId === w.id ? ' selected' : ''}>${esc(w.icon)} ${esc(w.name)}</option>`).join('')
    const toWalletOptions = S.wallets.filter(w => w.id !== S.tx.walletId).map(w => `<option value="${esc(w.id)}"${S.tx.toWalletId === w.id ? ' selected' : ''}>${esc(w.icon)} ${esc(w.name)}</option>`).join('')
    const isExpense = type === 'expense'
    const box = document.getElementById('add-tx-content')
    if (!box) return
    box.innerHTML = `<div class="sheet-header"><h2>${S.txMode === 'edit' ? 'แก้ไขรายละเอียด' : 'รายละเอียดรายการ'}</h2><button class="btn-icon" onclick="App.closeOverlay('overlay-add-tx')">✕</button></div>
      <div class="add-detail-shell">
        <div class="add-detail-scroll">
          <div class="amount-summary-card ${type === 'income' ? 'income' : type === 'transfer' ? 'transfer' : 'expense'}" onclick="App._backToAmount()"><div><small>${type === 'income' ? 'รายรับ' : type === 'transfer' ? 'โอนเงิน' : 'รายจ่าย'} · แตะเพื่อแก้ไข</small><strong>${type === 'income' ? '+' : type === 'expense' ? '-' : ''}฿${display}</strong></div><div style="font-size:20px">✏️</div></div>
          ${needsCat ? `<div class="form-group"><label class="form-label">หมวดหมู่ที่ใช้บ่อย</label><div class="cat-grid cat-grid-compact" id="cat-grid">${shownCats.map(c => `<button type="button" data-catid="${esc(c.id)}" class="cat-btn${S.tx.categoryId === c.id ? ' active' : ''}" onclick="App._selectCat('${esc(c.id)}')"><span class="cat-icon">${esc(c.icon)}</span><span>${esc(c.label)}</span></button>`).join('')}${hasMore ? `<button type="button" class="cat-btn cat-more-btn" onclick="App.showAllTxCategories()"><span class="cat-icon">⋯</span><span>เพิ่มเติม</span></button>` : ''}${S.txShowAllCats && allCats.length > 5 ? `<button type="button" class="cat-btn cat-more-btn" onclick="App.hideAllTxCategories()"><span class="cat-icon">⌃</span><span>ย่อ</span></button>` : ''}</div></div>` : ''}
          <div class="form-group"><label class="form-label">${type === 'transfer' ? 'จากบัญชี' : 'บัญชีที่ใช้'}</label><select class="form-input" id="tx-wallet" onchange="App._txField('walletId',this.value);${type === 'transfer' ? 'App._renderAddTxDetail()' : ''}">${walletOptions}</select></div>
          ${type === 'transfer' ? `<div class="form-group"><label class="form-label">ไปบัญชี</label><select class="form-input" id="tx-towallet" onchange="App._txField('toWalletId',this.value)"><option value="">เลือกปลายทาง</option>${toWalletOptions}</select><div class="form-hint">รายการโอนจะแสดงเป็น “ต้นทาง → ปลายทาง”</div></div>` : `<div class="form-group"><label class="form-label">ร้านค้า / แหล่งที่มา</label><input class="form-input" id="tx-merchant" placeholder="เช่น Grab, Netflix, เงินเดือน" value="${esc(S.tx.merchant)}" oninput="App._txField('merchant',this.value)"></div>`}
          <div class="form-split-row"><div><label class="form-label">วันที่</label><input class="form-input" type="date" id="tx-date" value="${esc(S.tx.date)}" onchange="App._txField('date',this.value)"></div><div><label class="form-label">หมายเหตุ</label><input class="form-input" id="tx-note" placeholder="เพิ่มเติม..." value="${esc(S.tx.note)}" oninput="App._txField('note',this.value)"></div></div>
          ${isExpense ? `<div class="form-group"><label class="form-label">ตัวเลือก</label><div class="tx-flag-grid"><button type="button" class="flag-pill${S.tx.isRecurring ? ' active' : ''}" onclick="App._toggleTxFlag('isRecurring')">🔁 ประจำ</button><button type="button" class="flag-pill installment${S.tx.isInstallment ? ' active' : ''}" onclick="App._toggleTxFlag('isInstallment')">📦 ผ่อนชำระ</button></div></div>${S.tx.isInstallment ? `<div class="form-group"><label class="form-label">จำนวนงวด</label><div class="installment-month-grid">${[3,6,10,12].map(m => `<button type="button" class="${String(S.tx.installmentMonths || '') === String(m) ? 'active' : ''}" onclick="App._txField('installmentMonths','${m}');App._renderAddTxDetail()">${m}</button>`).join('')}</div><input class="form-input" type="number" min="1" inputmode="numeric" value="${esc(S.tx.installmentMonths || '')}" placeholder="หรือกรอกจำนวนงวดเอง" oninput="App._txField('installmentMonths',this.value)" style="margin-top:8px"></div>` : ''}` : ''}
        </div>
        <div class="add-detail-actions"><button class="btn btn-secondary" onclick="App._backToAmount()">← แก้จำนวน</button><button class="btn btn-primary" style="background:${color};box-shadow:0 4px 16px ${color}44" onclick="App.saveTx()">${S.txMode === 'edit' ? 'บันทึก' : `บันทึก ${type === 'income' ? '+' : type === 'expense' ? '-' : ''}฿${display}`}</button></div>
      </div>`
  }

  App.getFinancialAdvisorInsights = function(month = S.rptMonth || THIS_MONTH) {
    const stats = Calc.getMonthlyStats(S.transactions, month)
    const prevMonth = Calc.getMonths(2)[1]
    const prev = Calc.getMonthlyStats(S.transactions, prevMonth)
    const budget = Calc.getBudgetProgress(S.transactions, S.budgets || [], S.categories, month)
    const top = Object.entries(stats.byCategory || {}).sort((a,b) => b[1] - a[1])[0]
    const cat = top && App._findCat?.(top[0])
    const insights = []
    const savingsRate = stats.income ? (stats.net / stats.income) * 100 : 0
    insights.push({ icon:'🧠', title:'AI Financial Coach', body: savingsRate >= 20 ? `เดือนนี้อัตราออมประมาณ ${savingsRate.toFixed(0)}% อยู่ในระดับดี ควรแยกเงินส่วนเกินไปออม/ลงทุนทันทีหลังรับรายได้` : savingsRate >= 0 ? `เดือนนี้ยังมีกระแสเงินสดบวก แต่อัตราออมอยู่ที่ ${savingsRate.toFixed(0)}% แนะนำตั้งเป้าออมอัตโนมัติก่อนใช้จ่าย` : `เดือนนี้รายจ่ายสูงกว่ารายรับ แนะนำลดรายจ่ายไม่จำเป็น 1-2 หมวดทันทีและตั้งเพดานรายสัปดาห์` })
    if (prev.expense) {
      const diff = ((stats.expense - prev.expense) / prev.expense) * 100
      insights.push({ icon: diff > 0 ? '📈' : '📉', title:'เทียบเดือนก่อน', body:`รายจ่าย${diff >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.abs(diff).toFixed(0)}% จากเดือนก่อน ${diff > 15 ? 'ควรตรวจรายการที่ผิดปกติหรือรายจ่ายก้อนใหญ่' : 'ถือว่าอยู่ในช่วงควบคุมได้'}` })
    }
    if (cat && top) insights.push({ icon:'🔍', title:'หมวดที่ควรจับตา', body:`หมวด ${cat.label} ใช้สูงสุดที่ ${fmt(top[1])} (${stats.expense ? (top[1]/stats.expense*100).toFixed(0) : 0}% ของรายจ่าย) แนะนำตั้งงบย่อยหรือ review รายการซ้ำ` })
    const over = budget.find(b => b.over)
    if (over) insights.push({ icon:'⚠️', title:'งบประมาณเกิน', body:`${over.label} เกินงบ ${fmt(over.spent - over.monthlyLimit)} แล้ว ควรหยุดใช้หมวดนี้ชั่วคราวจนจบรอบเดือน` })
    return insights.slice(0, 4)
  }

  const prevRenderReports = App.renderReports.bind(App)
  App.renderReports = function() {
    prevRenderReports()
    const box = document.getElementById('reports-content')
    if (!box || box.querySelector('.ai-advisor-card')) return
    const insights = App.getFinancialAdvisorInsights(S.rptMonth)
    box.insertAdjacentHTML('afterbegin', `<div class="sec-title">Financial Insights</div><div class="card card-pad ai-advisor-card"><div class="ai-card-head"><div><strong>AI Financial Coach</strong><span>วิเคราะห์จากพฤติกรรมรายรับ-รายจ่ายในเครื่อง</span></div><button class="btn btn-secondary btn-sm" onclick="App.renderReports()">วิเคราะห์ใหม่</button></div>${insights.map(i => `<div class="insight-row ai-insight"><div class="insight-icon">${i.icon}</div><div><div class="insight-title">${esc(i.title)}</div><div class="insight-body">${esc(i.body)}</div></div></div>`).join('')}</div>`)
  }

  try { if (S.page === 'transactions') App.renderTransactions(); else App.render?.() } catch (_) {}
})();

/* ============================================================
   V2.2.6 Investment, Aurora gold sync, and circular color controls
   Scope: presentation/market-price robustness only. Keeps storage/sync logic intact.
   ============================================================ */
;(function v226InvestmentGoldAndColorFixes(){
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))
  const fmt = n => (typeof moneyFmt === 'function' ? moneyFmt(Number(n) || 0) : Calc.fmt(Number(n) || 0))
  const numFmt = (n, digits = 4) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: digits })
  const investTypes = new Set(['gold','crypto','fcd'])
  const AURORA_GOLD_URL = 'https://www.aurora.co.th/price/gold_pricelist'

  function isInvestType(type) { return investTypes.has(type) }
  function toNumber(s) { return Number(String(s || '').replace(/,/g, '')) || 0 }
  function assetUnitLabel(wOrType) {
    const type = typeof wOrType === 'string' ? wOrType : wOrType?.type
    if (type === 'gold') return 'บาททอง'
    if (type === 'fcd') return (typeof wOrType === 'string' ? 'สกุลเงิน' : (wOrType?.currency || wOrType?.symbol || 'USD'))
    return typeof wOrType === 'string' ? 'หน่วย' : (wOrType?.symbol || 'หน่วย')
  }
  function marketUrlFor(type, w) {
    if (type === 'gold') return AURORA_GOLD_URL
    if (type === 'crypto') return 'https://www.coingecko.com/'
    if (type === 'fcd') return 'https://www.frankfurter.app/'
    return '#'
  }
  function marketSourceLabel(type) {
    if (type === 'gold') return 'Aurora รับซื้อรูปพรรณ'
    if (type === 'crypto') return 'CoinGecko'
    if (type === 'fcd') return 'Frankfurter FX'
    return 'ราคาจริง'
  }

  // Aurora HTML has a current intraday table row:
  // time / round / bar buy / bar sell / Aurora jewelry buy / change.
  App._parseAuroraGold = function(html) {
    const raw = String(html || '')
    const clean = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    let tail = clean
    const tableIdx = clean.search(/ช่วงเวลา\s+ทองแท่ง|รับซื้อรูปพรรณออโรร่า/i)
    if (tableIdx >= 0) tail = clean.slice(tableIdx)

    const priceRe = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?)'
    const intradayRow = tail.match(new RegExp('\\d{1,2}:\\d{2}(?::\\d{2})?\\s*น\\.?\\s+\\d+\\s+' + priceRe + '\\s+' + priceRe + '\\s+' + priceRe))
    if (intradayRow) {
      const barBuy = toNumber(intradayRow[1])
      const barSell = toNumber(intradayRow[2])
      const jewelryBuy = toNumber(intradayRow[3])
      if (jewelryBuy) return { jewelryBuy, barBuy, barSell, source:'Aurora', url:AURORA_GOLD_URL, fetchedAt:new Date().toISOString() }
    }

    // Fallback: after the jewelry-buy header, use the first valid sequence of 3 gold prices.
    const jewelryIdx = clean.search(/รับซื้อรูปพรรณออโรร่า/i)
    const afterJewelry = jewelryIdx >= 0 ? clean.slice(jewelryIdx) : clean
    const nums = afterJewelry.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g) || []
    for (let i = 0; i <= nums.length - 3; i++) {
      const a = toNumber(nums[i]), b = toNumber(nums[i + 1]), c = toNumber(nums[i + 2])
      // Jewelry buy is normally lower than bar buy/sell. This avoids accidentally using bar-buy as jewelry-buy.
      if (a > 10000 && b > 10000 && c > 10000 && c <= Math.max(a, b)) {
        return { jewelryBuy:c, barBuy:a, barSell:b, source:'Aurora', url:AURORA_GOLD_URL, fetchedAt:new Date().toISOString() }
      }
    }
    return null
  }

  App.refreshMarketPrices = async function() {
    const next = { ...(S.marketPrices || {}) }
    let ok = false
    let goldOk = false
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,binancecoin,tether&vs_currencies=thb,usd', { cache:'no-store' })
      if (r.ok) { next.crypto = await r.json(); ok = true }
    } catch (_) {}
    try {
      const r = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=THB,EUR,JPY,GBP,CNY', { cache:'no-store' })
      if (r.ok) { next.fx = await r.json(); ok = true }
    } catch (_) {}

    const auroraEndpoints = [
      'https://api.allorigins.win/raw?url=' + encodeURIComponent(AURORA_GOLD_URL),
      'https://corsproxy.io/?' + encodeURIComponent(AURORA_GOLD_URL),
      'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(AURORA_GOLD_URL)
    ]
    for (const url of auroraEndpoints) {
      try {
        const r = await fetch(url, { cache:'no-store' })
        if (!r.ok) continue
        const data = App._parseAuroraGold(await r.text())
        if (data?.jewelryBuy) { next.auroraGold = data; ok = true; goldOk = true; break }
      } catch (_) {}
    }

    next.updatedAt = new Date().toISOString()
    S.marketPrices = next
    persist()
    App.renderWallets?.()
    App.render?.()
    if (goldOk) toast('อัปเดตราคาทอง Aurora แล้ว', 'success')
    else toast(ok ? 'อัปเดตราคาอ้างอิงแล้ว แต่ราคาทองยังไม่ได้ ใช้ราคาสำรองแทน' : 'อัปเดตราคาไม่ได้ ใช้ราคาสำรองในกระเป๋าแทน', ok ? 'warn' : 'error')
  }

  App._investmentUnitPriceTHB = function(w) {
    const p = S.marketPrices || {}
    if (w?.type === 'gold') return Number(p.auroraGold?.jewelryBuy || w.manualPrice || 0)
    if (w?.type === 'crypto') {
      const map = { BTC:'bitcoin', ETH:'ethereum', BNB:'binancecoin', USDT:'tether' }
      const id = map[(w.symbol || '').toUpperCase()]
      return Number((id && p.crypto?.[id]?.thb) || w.manualPrice || 0)
    }
    if (w?.type === 'fcd') {
      const cur = (w.currency || w.symbol || 'USD').toUpperCase()
      const thb = p.fx?.rates?.THB
      return Number((cur === 'USD' ? thb : (thb && p.fx?.rates?.[cur] ? thb / p.fx.rates[cur] : 0)) || w.manualPrice || 0)
    }
    return 0
  }
  App._investmentValueTHB = w => isInvestType(w?.type) ? ((Number(w.units || 0) * App._investmentUnitPriceTHB(w)) || Number(w.balance || 0)) : Number(w?.balance || 0)
  App._marketText = function(w) {
    const p = S.marketPrices || {}
    if (w?.type === 'gold') return p.auroraGold?.jewelryBuy ? `Aurora รับซื้อรูปพรรณ ${fmt(p.auroraGold.jewelryBuy)}/บาททอง` : 'ยังไม่ sync ราคา Aurora'
    if (w?.type === 'crypto') { const coin = (w.symbol || w.name || '').toUpperCase(); const map = {BTC:'bitcoin', ETH:'ethereum', BNB:'binancecoin', USDT:'tether'}; const id = map[coin]; const thb = id && p.crypto?.[id]?.thb; return thb ? `${coin} ${fmt(thb)}` : 'CoinGecko' }
    if (w?.type === 'fcd') { const cur = (w.currency || w.symbol || 'USD').toUpperCase(); const rate = cur === 'USD' ? p.fx?.rates?.THB : (p.fx?.rates?.THB && p.fx?.rates?.[cur] ? p.fx.rates.THB / p.fx.rates[cur] : null); return rate ? `${cur}/THB ${rate.toFixed(2)}` : 'FX อ้างอิง' }
    return ''
  }

  function syncInvestmentWalletForm(type = document.getElementById('wf-type')?.value) {
    const isInv = isInvestType(type)
    const balanceGroup = document.getElementById('wf-balance')?.closest('.form-group')
    if (balanceGroup) {
      balanceGroup.classList.toggle('invest-balance-hidden', isInv)
      balanceGroup.style.display = isInv ? 'none' : ''
    }

    const investBox = document.getElementById('wf-invest-fields')
    if (!investBox) return
    investBox.style.display = isInv ? '' : 'none'
    if (!isInv) return

    const w = S.editingWalletId ? S.wallets.find(x => x.id === S.editingWalletId) : null
    if (!investBox.querySelector('#wf-units')) {
      investBox.insertAdjacentHTML('beforeend', `<div class="form-group"><label class="form-label">จำนวน Asset ที่มี</label><input class="form-input" type="number" step="0.00000001" id="wf-units" value="${esc(w?.units || '')}" placeholder="เช่น 1.5, 0.05, 1000"></div><div class="form-group"><label class="form-label">ราคาสำรองต่อหน่วย (บาท)</label><input class="form-input" type="number" step="0.01" id="wf-manual-price" value="${esc(w?.manualPrice || '')}" placeholder="ใช้เมื่อดึงราคาจริงไม่ได้"></div>`)
    }

    const units = document.getElementById('wf-units')
    if (units) {
      units.placeholder = type === 'gold' ? 'เช่น 1, 2.5 บาททอง' : 'เช่น 0.05, 2.5, 1000'
      const label = units.closest('.form-group')?.querySelector('.form-label')
      if (label) label.textContent = type === 'gold' ? 'จำนวนทองคำที่มี (บาททอง)' : 'จำนวน Asset ที่มี'
    }
    const manual = document.getElementById('wf-manual-price')
    if (manual) {
      const label = manual.closest('.form-group')?.querySelector('.form-label')
      if (label) label.textContent = type === 'gold' ? 'ราคาสำรองรับซื้อรูปพรรณ/บาททอง' : 'ราคาสำรองต่อหน่วย (บาท)'
    }
    const symbol = document.getElementById('wf-symbol')
    if (symbol && type === 'gold') {
      symbol.value = 'บาททอง'
      symbol.placeholder = 'บาททอง'
      symbol.readOnly = true
      const label = symbol.closest('.form-group')?.querySelector('.form-label')
      if (label) label.textContent = 'หน่วยทองคำ'
    } else if (symbol) {
      symbol.readOnly = false
      const label = symbol.closest('.form-group')?.querySelector('.form-label')
      if (label) label.textContent = type === 'fcd' ? 'สกุลเงิน' : 'Symbol / สกุลเงิน'
    }

    let priceBox = document.getElementById('wf-market-price-link')
    if (!priceBox) {
      investBox.insertAdjacentHTML('beforeend', '<div id="wf-market-price-link" class="market-price-box"></div>')
      priceBox = document.getElementById('wf-market-price-link')
    }
    const tempWallet = { ...(w || {}), type, symbol: symbol?.value || w?.symbol, currency: symbol?.value || w?.currency }
    const unitPrice = App._investmentUnitPriceTHB(tempWallet)
    priceBox.innerHTML = `<div><strong>ราคาจริง</strong><span>${esc(marketSourceLabel(type))}${unitPrice ? ` · ${fmt(unitPrice)}/${esc(assetUnitLabel(type))}` : ' · ยังไม่ sync'}</span></div><a href="${esc(marketUrlFor(type, w))}" target="_blank" rel="noopener noreferrer">เปิดดูราคา ↗</a>`
  }

  const previousOpenWalletForm = App.openWalletForm.bind(App)
  App.openWalletForm = function(id) {
    previousOpenWalletForm(id)
    setTimeout(() => syncInvestmentWalletForm(), 0)
  }
  const previousSelectWalletType = App._selectWalletType?.bind(App)
  App._selectWalletType = function(type) {
    previousSelectWalletType?.(type)
    syncInvestmentWalletForm(type)
  }
  const previousSaveWallet = App.saveWallet.bind(App)
  App.saveWallet = function() {
    const type = document.getElementById('wf-type')?.value
    const symbol = document.getElementById('wf-symbol')
    if (type === 'gold' && symbol) symbol.value = 'บาททอง'
    previousSaveWallet()
  }

  const previousWalletCard = App._walletCard?.bind(App)
  App._walletCard = function(w) {
    if (!isInvestType(w?.type)) return previousWalletCard ? previousWalletCard(w) : ''
    const color = w.color || '#2563EB'
    const unitLabel = assetUnitLabel(w)
    const priceText = App._marketText(w)
    const unitPrice = App._investmentUnitPriceTHB(w)
    const detailAction = `App.openWalletDetail('${esc(w.id)}')`
    return `<div class="wallet-card wallet-card-colored wallet-card-invest wallet-card-invest-asset-only" style="--wallet-color:${esc(color)};--wallet-color-2:${esc(color)}BB" onclick="${detailAction}">
      <div class="wc-header"><div><div class="wc-name">${esc(w.icon)} ${esc(w.name)}</div><div class="wc-type">${esc(App._walletTypeLabel(w.type))}</div></div></div>
      <div class="wc-balance wc-balance-asset">${numFmt(w.units, 4)} <span>${esc(unitLabel)}</span></div>
      <div class="wc-prog-info wc-invest-info"><span>${esc(priceText || 'ยังไม่ sync ราคาจริง')}</span>${unitPrice ? `<span>${fmt(unitPrice)}/หน่วย</span>` : '<span>ใช้ราคาสำรองถ้ามี</span>'}</div>
      <a class="market-price-link" href="${esc(marketUrlFor(w.type, w))}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">ดูราคาจริง ↗</a>
      <div class="wc-action-row"><button class="wallet-chip-btn" onclick="event.stopPropagation();${detailAction}">ดูรายการ</button><button class="wallet-chip-btn" onclick="event.stopPropagation();App.openWalletForm('${esc(w.id)}')">แก้ไข</button></div>
    </div>`
  }

  const previousOpenWalletDetail = App.openWalletDetail?.bind(App)
  App.openWalletDetail = function(id) {
    const w = S.wallets.find(x => x.id === id)
    if (!w || !isInvestType(w.type)) return previousOpenWalletDetail?.(id)
    S.walletDetailId = id
    S.walletTxRange ||= 'all'
    const tx = App._filterWalletTx ? App._filterWalletTx(id) : S.transactions.filter(t => t.walletId === id || t.toWalletId === id).sort((a,b) => (b.date || '').localeCompare(a.date || ''))
    const chips = [['all','ทั้งหมด'],['month','เดือนนี้'],['3m','3 เดือน'],['year','ปีนี้'],['custom','กำหนดเอง']].map(([k,l]) => `<button class="chip${S.walletTxRange === k ? ' active' : ''}" onclick="App.setWalletTxRange('${k}','${esc(id)}')">${l}</button>`).join('')
    const custom = S.walletTxRange === 'custom' ? `<div class="wallet-filter-custom"><input class="form-input" type="date" id="wallet-filter-start" value="${esc(S.walletTxStart || '')}"><input class="form-input" type="date" id="wallet-filter-end" value="${esc(S.walletTxEnd || '')}"><button class="btn btn-primary btn-sm" onclick="App.setWalletTxCustom('${esc(id)}')" style="width:auto">ดู</button></div>` : ''
    const unitPrice = App._investmentUnitPriceTHB(w)
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>${esc(w.icon)} ${esc(w.name)}</h2><button class="btn btn-secondary btn-sm" onclick="App.openWalletForm('${esc(w.id)}')" style="width:auto">แก้ไข</button></div>
      <div class="sub-scroll wallet-detail-screen" data-wallet-id="${esc(id)}">
        <div class="wallet-detail-hero wallet-detail-invest-only">
          <div class="nw-label">จำนวน Asset ที่มี</div>
          <div class="big">${numFmt(w.units, 4)} <span>${esc(assetUnitLabel(w))}</span></div>
          <div class="nw-detail"><span class="nw-item">ราคาจริง <strong>${unitPrice ? fmt(unitPrice) + '/หน่วย' : 'ยังไม่ sync'}</strong></span><a class="market-price-link" href="${esc(marketUrlFor(w.type, w))}" target="_blank" rel="noopener noreferrer">เปิดดูราคา ↗</a></div>
        </div>
        <div class="chips" style="padding:0 0 12px">${chips}</div>
        ${custom}
        ${App._sectionHeader('รายการในกระเป๋านี้')}
        <div class="card"><div style="padding:0 16px">${tx.length ? tx.map(t => App._txRow(t)).join('') : App._emptyState('📋','ไม่พบรายการ','ลองเปลี่ยนช่วงเวลา')}</div></div>
      </div>`)
    setTimeout(() => App._bindTxRows('sub-screen'), 0)
  }

  try { App.render?.() } catch (_) {}
})()

/* ============================================================
   V2.2.7 Reliable Aurora gold sync bridge
   Why: Aurora blocks normal browser cross-origin fetch from GitHub Pages.
   This layer supports a user-owned proxy endpoint (recommended) via JSONP,
   then falls back to public proxies only as best-effort.
   ============================================================ */
;(function v227ReliableAuroraGoldSync(){
  const AURORA_GOLD_URL = 'https://www.aurora.co.th/price/gold_pricelist'
  const toastSafe = (msg, type='info') => { try { toast(msg, type) } catch { console.log(msg) } }
  const toNumber = (s) => Number(String(s || '').replace(/,/g, '').replace(/[^d.-]/g, '')) || 0
  const normaliseGoldData = (payload) => {
    if (!payload) return null
    if (typeof payload === 'string') return App._parseAuroraGold?.(payload) || null
    const jewelryBuy = toNumber(payload.jewelryBuy ?? payload.auroraJewelryBuy ?? payload.buyJewelry ?? payload.price)
    const barBuy = toNumber(payload.barBuy ?? payload.goldBarBuy ?? payload.buy)
    const barSell = toNumber(payload.barSell ?? payload.goldBarSell ?? payload.sell)
    if (!jewelryBuy) return null
    return {
      jewelryBuy,
      barBuy,
      barSell,
      source: payload.source || 'Aurora',
      url: payload.url || AURORA_GOLD_URL,
      fetchedAt: payload.fetchedAt || new Date().toISOString(),
      fetchedVia: payload.fetchedVia || payload.via || 'custom-proxy'
    }
  }

  App._fetchJsonp = function(url, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const cb = '__mtGoldCb_' + Date.now() + '_' + Math.random().toString(36).slice(2)
      const script = document.createElement('script')
      let done = false
      const sep = url.includes('?') ? '&' : '?'
      const cleanup = () => {
        try { delete window[cb] } catch { window[cb] = undefined }
        script.remove()
      }
      const timer = setTimeout(() => {
        if (done) return
        done = true
        cleanup()
        reject(new Error('gold proxy timeout'))
      }, timeoutMs)
      window[cb] = (data) => {
        if (done) return
        done = true
        clearTimeout(timer)
        cleanup()
        resolve(data)
      }
      script.onerror = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        cleanup()
        reject(new Error('gold proxy script error'))
      }
      script.src = url + sep + 'callback=' + encodeURIComponent(cb) + '&_=' + Date.now()
      document.head.appendChild(script)
    })
  }

  App._getGoldProxyUrl = function(){
    return String(window.MT_GOLD_PROXY_URL || localStorage.getItem('MT_GOLD_PROXY_URL') || '').trim()
  }

  App._fetchAuroraGoldViaProxy = async function(){
    const customProxy = App._getGoldProxyUrl()
    if (customProxy) {
      const payload = await App._fetchJsonp(customProxy)
      const data = normaliseGoldData(payload)
      if (data?.jewelryBuy) return data
      throw new Error('custom gold proxy returned no Aurora jewelry-buy price')
    }

    const publicProxyUrls = [
      'https://api.allorigins.win/raw?url=' + encodeURIComponent(AURORA_GOLD_URL),
      'https://corsproxy.io/?' + encodeURIComponent(AURORA_GOLD_URL),
      'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(AURORA_GOLD_URL)
    ]
    for (const url of publicProxyUrls) {
      try {
        const r = await fetch(url, { cache:'no-store' })
        if (!r.ok) continue
        const data = normaliseGoldData(await r.text())
        if (data?.jewelryBuy) return { ...data, fetchedVia:'public-proxy' }
      } catch (_) {}
    }
    return null
  }

  App.refreshMarketPrices = async function(){
    const next = { ...(S.marketPrices || {}) }
    let anyOk = false
    let goldOk = false

    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,binancecoin,tether&vs_currencies=thb,usd', { cache:'no-store' })
      if (r.ok) { next.crypto = await r.json(); anyOk = true }
    } catch (_) {}
    try {
      const r = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=THB,EUR,JPY,GBP,CNY', { cache:'no-store' })
      if (r.ok) { next.fx = await r.json(); anyOk = true }
    } catch (_) {}

    try {
      const gold = await App._fetchAuroraGoldViaProxy()
      if (gold?.jewelryBuy) {
        next.auroraGold = gold
        anyOk = true
        goldOk = true
      }
    } catch (err) {
      console.warn('Aurora gold sync failed:', err)
    }

    next.updatedAt = new Date().toISOString()
    S.marketPrices = next
    persist()
    App.renderWallets?.()
    App.render?.()

    if (goldOk) {
      toastSafe('Sync ราคาทอง Aurora สำเร็จ', 'success')
    } else if (!App._getGoldProxyUrl()) {
      toastSafe('ยังไม่ได้ตั้งค่า Gold Proxy จึง sync Aurora ไม่เสถียร', 'warn')
    } else {
      toastSafe(anyOk ? 'ราคาอื่นอัปเดตแล้ว แต่ Aurora ยังไม่ตอบกลับ' : 'Sync ราคาไม่ได้ ลองเช็ก Gold Proxy', anyOk ? 'warn' : 'error')
    }
  }

  App.setGoldProxyUrl = function(url){
    const value = String(url || '').trim()
    if (value) localStorage.setItem('MT_GOLD_PROXY_URL', value)
    else localStorage.removeItem('MT_GOLD_PROXY_URL')
    window.MT_GOLD_PROXY_URL = value
    toastSafe(value ? 'บันทึก Gold Proxy URL แล้ว' : 'ลบ Gold Proxy URL แล้ว', value ? 'success' : 'info')
  }
})();

/* ============================================================
   V2.2.8 Thai Gold / Gold Traders source switch
   Why: Aurora URL cannot be fetched reliably from Apps Script.
   Uses Gold Traders Association-compatible data via a JSON API/proxy.
   Keeps legacy auroraGold key populated for backward compatibility.
   ============================================================ */
;(function v228ThaiGoldSourceSwitch(){
  const GTA_URL = 'https://classic.goldtraders.or.th/'
  const THAI_GOLD_API_URL = 'https://api.chnwt.dev/thai-gold-api/latest'
  const toastSafe = (msg, type='info') => { try { toast(msg, type) } catch { console.log(msg) } }
  const toNumber = (s) => Number(String(s || '').replace(/,/g, '').replace(/[^\d.\-]/g, '')) || 0
  const fmtMoney = (n) => (typeof moneyFmt === 'function' ? moneyFmt(Number(n) || 0) : Calc.fmt(Number(n) || 0))
  const dateNow = () => new Date().toISOString()

  function normaliseThaiGoldPayload(payload) {
    if (!payload) return null
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload) } catch { return null }
    }

    const root = payload.response || payload.data || payload
    const price = root.price || root.prices || {}
    const gold = price.gold || root.gold || {}
    const goldBar = price.gold_bar || price.goldBar || root.gold_bar || root.goldBar || {}

    // Thai Gold API shape:
    // response.price.gold.buy = ornament/jewelry buy reference
    // response.price.gold_bar.buy/sell = gold bar buy/sell
    const jewelryBuy = toNumber(
      payload.jewelryBuy ?? payload.goldBuy ?? payload.ornamentBuy ?? payload.price ??
      root.jewelryBuy ?? root.goldBuy ?? root.ornamentBuy ??
      gold.buy ?? gold.bid ?? gold.taxBase
    )
    const jewelrySell = toNumber(payload.jewelrySell ?? root.jewelrySell ?? gold.sell ?? gold.ask)
    const barBuy = toNumber(payload.barBuy ?? root.barBuy ?? goldBar.buy ?? goldBar.bid)
    const barSell = toNumber(payload.barSell ?? root.barSell ?? goldBar.sell ?? goldBar.ask)

    if (!jewelryBuy && !barBuy && !barSell) return null

    return {
      jewelryBuy: jewelryBuy || barBuy || 0,
      jewelrySell: jewelrySell || 0,
      barBuy: barBuy || 0,
      barSell: barSell || 0,
      source: payload.source || root.source || 'Gold Traders Association',
      url: payload.url || root.url || GTA_URL,
      fetchedAt: payload.fetchedAt || root.fetchedAt || dateNow(),
      latestDate: payload.latestDate || root.latestDate || root.update_date || payload.update_date || '',
      latestTime: payload.latestTime || root.latestTime || root.update_time || payload.update_time || '',
      fetchedVia: payload.fetchedVia || payload.via || 'direct-json'
    }
  }

  App._normaliseThaiGoldPayload = normaliseThaiGoldPayload

  App._fetchThaiGoldViaSource = async function(){
    const customProxy = String(window.MT_GOLD_PROXY_URL || localStorage.getItem('MT_GOLD_PROXY_URL') || '').trim()
    if (customProxy) {
      const payload = await App._fetchJsonp(customProxy)
      const data = normaliseThaiGoldPayload(payload)
      if (data?.jewelryBuy) return { ...data, fetchedVia:'custom-proxy' }
      throw new Error('custom gold proxy returned no Thai gold price')
    }

    // Best case: the JSON API allows browser CORS.
    try {
      const r = await fetch(THAI_GOLD_API_URL, { cache:'no-store' })
      if (r.ok) {
        const data = normaliseThaiGoldPayload(await r.json())
        if (data?.jewelryBuy) return { ...data, fetchedVia:'direct-api' }
      }
    } catch (_) {}

    // Browser-only fallback for GitHub Pages. Not guaranteed, but harmless.
    const proxyUrls = [
      'https://api.allorigins.win/raw?url=' + encodeURIComponent(THAI_GOLD_API_URL),
      'https://corsproxy.io/?' + encodeURIComponent(THAI_GOLD_API_URL),
      'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(THAI_GOLD_API_URL)
    ]
    for (const url of proxyUrls) {
      try {
        const r = await fetch(url, { cache:'no-store' })
        if (!r.ok) continue
        const data = normaliseThaiGoldPayload(await r.text())
        if (data?.jewelryBuy) return { ...data, fetchedVia:'public-proxy' }
      } catch (_) {}
    }
    return null
  }

  // Backward compatibility: older code still calls this method name.
  App._fetchAuroraGoldViaProxy = App._fetchThaiGoldViaSource

  App.refreshMarketPrices = async function(){
    const next = { ...(S.marketPrices || {}) }
    let anyOk = false
    let goldOk = false

    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,binancecoin,tether&vs_currencies=thb,usd', { cache:'no-store' })
      if (r.ok) { next.crypto = await r.json(); anyOk = true }
    } catch (_) {}

    try {
      const r = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=THB,EUR,JPY,GBP,CNY', { cache:'no-store' })
      if (r.ok) { next.fx = await r.json(); anyOk = true }
    } catch (_) {}

    try {
      const gold = await App._fetchThaiGoldViaSource()
      if (gold?.jewelryBuy) {
        next.thaiGold = gold
        // Keep legacy key so all previous investment renderers still work.
        next.auroraGold = gold
        anyOk = true
        goldOk = true
      }
    } catch (err) {
      console.warn('Thai gold sync failed:', err)
    }

    next.updatedAt = dateNow()
    S.marketPrices = next
    persist()
    App.renderWallets?.()
    App.render?.()

    if (goldOk) toastSafe('Sync ราคาทองสมาคมค้าทองคำสำเร็จ', 'success')
    else if (anyOk) toastSafe('ราคาอื่นอัปเดตแล้ว แต่ราคาทองยังไม่สำเร็จ', 'warn')
    else toastSafe('Sync ราคาไม่ได้ ลองตั้งค่า Gold Proxy หรือเช็กอินเทอร์เน็ต', 'error')
  }

  App._investmentUnitPriceTHB = function(w) {
    if (!w) return 0
    const p = S.marketPrices || {}
    if (w.type === 'gold') return Number(p.thaiGold?.jewelryBuy || p.auroraGold?.jewelryBuy || w.manualPrice || 0)
    if (w.type === 'crypto') {
      const key = (w.symbol || '').toUpperCase()
      const map = { BTC:'bitcoin', ETH:'ethereum', BNB:'binancecoin', USDT:'tether' }
      return Number(p.crypto?.[map[key]]?.thb || w.manualPrice || 0)
    }
    if (w.type === 'fcd') {
      const cc = (w.currency || w.symbol || 'USD').toUpperCase()
      if (cc === 'THB') return 1
      return Number(p.fx?.rates?.[cc] ? (1 / p.fx.rates[cc]) * p.fx.rates.THB : w.manualPrice || 0)
    }
    return Number(w.manualPrice || 0)
  }

  App._marketText = function(w) {
    const p = S.marketPrices || {}
    if (w?.type === 'gold') {
      const g = p.thaiGold || p.auroraGold
      return g?.jewelryBuy ? `สมาคมค้าทองคำ ทองรูปพรรณรับซื้อ ${fmtMoney(g.jewelryBuy)}/บาททอง` : 'ยังไม่ sync ราคาทองสมาคมค้าทองคำ'
    }
    if (w?.type === 'crypto') return 'CoinGecko'
    if (w?.type === 'fcd') return 'Frankfurter FX'
    return ''
  }

  function isInvestType(type) { return ['gold','crypto','fcd'].includes(type) }
  function assetUnitLabel(w) {
    if (w?.type === 'gold') return 'บาททอง'
    if (w?.type === 'fcd') return w.currency || w.symbol || 'USD'
    return w?.symbol || 'หน่วย'
  }
  function marketUrlFor(w) {
    if (w?.type === 'gold') return GTA_URL
    if (w?.type === 'crypto') return 'https://www.coingecko.com/'
    if (w?.type === 'fcd') return 'https://www.frankfurter.app/'
    return '#'
  }

  const previousWalletCard = App._walletCard?.bind(App)
  App._walletCard = function(w) {
    if (!isInvestType(w?.type)) return previousWalletCard ? previousWalletCard(w) : ''
    const color = w.color || '#2563EB'
    const unitPrice = App._investmentUnitPriceTHB(w)
    const priceText = App._marketText(w)
    const detailAction = `App.openWalletDetail('${esc(w.id)}')`
    return `<div class="wallet-card wallet-card-colored wallet-card-invest wallet-card-invest-asset-only" style="--wallet-color:${esc(color)};--wallet-color-2:${esc(color)}BB" onclick="${detailAction}">
      <div class="wc-header"><div><div class="wc-name">${esc(w.icon)} ${esc(w.name)}</div><div class="wc-type">${esc(App._walletTypeLabel(w.type))}</div></div></div>
      <div class="wc-balance wc-balance-asset">${numFmt(w.units, 4)} <span>${esc(assetUnitLabel(w))}</span></div>
      <div class="wc-prog-info wc-invest-info"><span>${esc(priceText || 'ยังไม่ sync ราคาจริง')}</span>${unitPrice ? `<span>${fmtMoney(unitPrice)}/หน่วย</span>` : '<span>ใช้ราคาสำรองถ้ามี</span>'}</div>
      <a class="market-price-link" href="${esc(marketUrlFor(w))}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">ดูราคาจริง ↗</a>
      <div class="wc-action-row"><button class="wallet-chip-btn" onclick="event.stopPropagation();${detailAction}">ดูรายการ</button><button class="wallet-chip-btn" onclick="event.stopPropagation();App.openWalletForm('${esc(w.id)}')">แก้ไข</button></div>
    </div>`
  }

  const previousOpenWalletDetail = App.openWalletDetail?.bind(App)
  App.openWalletDetail = function(id) {
    const w = S.wallets.find(x => x.id === id)
    if (!w || !isInvestType(w.type)) return previousOpenWalletDetail?.(id)
    S.walletDetailId = id
    S.walletTxRange ||= 'all'
    const tx = App._filterWalletTx ? App._filterWalletTx(id) : S.transactions.filter(t => t.walletId === id || t.toWalletId === id).sort((a,b) => (b.date || '').localeCompare(a.date || ''))
    const chips = [['all','ทั้งหมด'],['month','เดือนนี้'],['3m','3 เดือน'],['year','ปีนี้'],['custom','กำหนดเอง']].map(([k,l]) => `<button class="chip${S.walletTxRange === k ? ' active' : ''}" onclick="App.setWalletTxRange('${k}','${esc(id)}')">${l}</button>`).join('')
    const custom = S.walletTxRange === 'custom' ? `<div class="wallet-filter-custom"><input class="form-input" type="date" id="wallet-filter-start" value="${esc(S.walletTxStart || '')}"><input class="form-input" type="date" id="wallet-filter-end" value="${esc(S.walletTxEnd || '')}"><button class="btn btn-primary btn-sm" onclick="App.setWalletTxCustom('${esc(id)}')" style="width:auto">ดู</button></div>` : ''
    const unitPrice = App._investmentUnitPriceTHB(w)
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>${esc(w.icon)} ${esc(w.name)}</h2><button class="btn btn-secondary btn-sm" onclick="App.openWalletForm('${esc(w.id)}')" style="width:auto">แก้ไข</button></div>
      <div class="sub-scroll wallet-detail-screen" data-wallet-id="${esc(id)}">
        <div class="wallet-detail-hero wallet-detail-invest-only">
          <div class="nw-label">จำนวน Asset ที่มี</div>
          <div class="big">${numFmt(w.units, 4)} <span>${esc(assetUnitLabel(w))}</span></div>
          <div class="nw-detail"><span class="nw-item">ราคาจริง <strong>${unitPrice ? fmtMoney(unitPrice) + '/หน่วย' : 'ยังไม่ sync'}</strong></span><a class="market-price-link" href="${esc(marketUrlFor(w))}" target="_blank" rel="noopener noreferrer">เปิดดูราคา ↗</a></div>
          ${w.type === 'gold' ? `<div class="wallet-market-note compact">อ้างอิง: สมาคมค้าทองคำ / ทองรูปพรรณรับซื้อ</div>` : ''}
        </div>
        <div class="chips" style="padding:0 0 12px">${chips}</div>
        ${custom}
        ${App._sectionHeader('รายการในกระเป๋านี้')}
        <div class="card"><div style="padding:0 16px">${tx.length ? tx.map(t => App._txRow(t)).join('') : App._emptyState('📋','ไม่พบรายการ','ลองเปลี่ยนช่วงเวลา')}</div></div>
      </div>`)
    setTimeout(() => App._bindTxRows('sub-screen'), 0)
  }

  App.setGoldProxyUrl = function(url){
    const value = String(url || '').trim()
    if (value) localStorage.setItem('MT_GOLD_PROXY_URL', value)
    else localStorage.removeItem('MT_GOLD_PROXY_URL')
    window.MT_GOLD_PROXY_URL = value
    toastSafe(value ? 'บันทึก Gold Proxy URL แล้ว' : 'ลบ Gold Proxy URL แล้ว', value ? 'success' : 'info')
  }

  try { App.render?.() } catch (_) {}
})();

/* ============================================================
   V2.2.9 Wallet rollback + Gold Traders API hardening
   ============================================================ */
;(function v229WalletRollbackGoldApi(){
  const MONEY = n => (typeof fmtMoney === 'function' ? fmtMoney(n) : Calc.fmt(Number(n)||0));
  const NUM = (n, digits = 4) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  const ESC = v => (typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
  const INVEST_TYPES = new Set(['gold','crypto','fcd']);
  const GOLD_API_URL = 'https://api.chnwt.dev/thai-gold-api/latest';
  const GOLDTRADERS_URL = 'https://www.goldtraders.or.th/';
  const isInvest = w => INVEST_TYPES.has(w?.type);
  const walletTypeLabel = type => ({ bank:'ธนาคาร', cash:'เงินสด', ewallet:'E-Wallet', saving:'ออมทรัพย์', credit:'บัตรเครดิต', gold:'ทองคำ', crypto:'Crypto', fcd:'เงินฝากต่างประเทศ' })[type] || type || 'กระเป๋า';
  const unitLabel = w => w?.type === 'gold' ? 'บาททอง' : w?.type === 'fcd' ? (w.currency || w.symbol || 'USD') : (w?.symbol || 'หน่วย');
  const marketUrl = w => w?.type === 'gold' ? GOLDTRADERS_URL : w?.type === 'crypto' ? 'https://www.coingecko.com/' : w?.type === 'fcd' ? 'https://www.frankfurter.app/' : '#';
  const goldData = () => S.marketPrices?.thaiGold || S.marketPrices?.auroraGold || null;
  App._walletTypeLabel = App._walletTypeLabel || walletTypeLabel;

  App._investmentUnitPriceTHB = function(w){
    if (!w) return 0;
    const p = S.marketPrices || {};
    if (w.type === 'gold') return Number(p.thaiGold?.jewelryBuy || p.auroraGold?.jewelryBuy || w.manualPrice || 0);
    if (w.type === 'crypto') { const map = { BTC:'bitcoin', ETH:'ethereum', BNB:'binancecoin', USDT:'tether' }; return Number(p.crypto?.[map[String(w.symbol||'').toUpperCase()]]?.thb || w.manualPrice || 0); }
    if (w.type === 'fcd') { const cur = String(w.currency || w.symbol || 'USD').toUpperCase(); const thb = p.fx?.rates?.THB; return Number(cur === 'THB' ? 1 : (thb && p.fx?.rates?.[cur] ? thb / p.fx.rates[cur] : w.manualPrice || 0)); }
    return Number(w.manualPrice || 0);
  };
  App._investmentValueTHB = w => isInvest(w) ? Number(w.units || 0) * App._investmentUnitPriceTHB(w) : Number(w?.balance || 0);
  App._marketText = function(w){
    if (w?.type === 'gold') { const g = goldData(); return g?.jewelryBuy ? `สมาคมค้าทองคำ · ทองรูปพรรณรับซื้อ ${MONEY(g.jewelryBuy)}/บาททอง` : 'ยังไม่ Sync ราคาทองสมาคมค้าทองคำ'; }
    if (w?.type === 'crypto') return 'CoinGecko';
    if (w?.type === 'fcd') return 'Frankfurter FX';
    return '';
  };
  function netWorthGroups(){
    const wallets = S.wallets || [];
    const assets = wallets.filter(w => ['bank','cash','ewallet','saving'].includes(w.type));
    const liabilities = wallets.filter(w => w.type === 'credit');
    const investments = wallets.filter(w => isInvest(w));
    const sumAssets = assets.reduce((s,w)=>s+Math.max(0, Number(w.balance||0)),0);
    const sumInvest = investments.reduce((s,w)=>s+Math.max(0, App._investmentValueTHB(w) || Number(w.balance||0)),0);
    const debt = liabilities.reduce((s,w)=>s+Math.abs(Number(w.balance||0)),0);
    return { assets, liabilities, investments, assetTotal: sumAssets + sumInvest, liabilityTotal: debt, netTotal: sumAssets + sumInvest - debt };
  }
  Calc.getWalletGroups = () => netWorthGroups();

  App._walletCard = function(w){
    const isCC = w.type === 'credit'; const invest = isInvest(w); const color = w.color || (isCC ? '#DC2626' : invest ? '#D97706' : '#2563EB');
    const detailAction = isCC ? `App.openCCDetail('${ESC(w.id)}')` : `App.openWalletDetail('${ESC(w.id)}')`;
    const name = `${w.icon || ''} ${w.name || ''}`.trim();
    if (invest) {
      const price = App._investmentUnitPriceTHB(w); const marketText = App._marketText(w);
      return `<div class="wallet-card wallet-card-colored wallet-card-invest wallet-card-invest-asset-only" style="--wallet-color:${ESC(color)};--wallet-color-2:${ESC(color)}BB" onclick="${detailAction}"><div class="wc-header"><div><div class="wc-name">${ESC(name)}</div><div class="wc-type">${ESC(walletTypeLabel(w.type))}</div></div></div><div class="wc-balance wc-balance-asset">${NUM(w.units,4)} <span>${ESC(unitLabel(w))}</span></div><div class="wc-prog-info wc-invest-info"><span>${ESC(marketText)}</span><span>${price ? MONEY(price) + '/หน่วย' : 'กรอกราคาสำรองได้'}</span></div><a class="market-price-link" href="${ESC(marketUrl(w))}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">ดูราคาจริง ↗</a><div class="wc-action-row"><button class="wallet-chip-btn" onclick="event.stopPropagation();${detailAction}">ดูรายการ</button><button class="wallet-chip-btn" onclick="event.stopPropagation();App.openWalletForm('${ESC(w.id)}')">แก้ไข</button></div></div>`;
    }
    if (isCC) {
      const owed = Math.abs(Number(w.balance || 0)); const limit = Number(w.limit || 0); const due = w.dueDay ? Calc.getDueDate(w.dueDay) : null; const pct = limit ? Math.min(100, Math.max(0, owed / limit * 100)) : 0; const avail = limit ? Math.max(0, limit - owed) : 0;
      return `<div class="wallet-card wallet-card-colored wallet-card-credit" style="--wallet-color:${ESC(color)};--wallet-color-2:${ESC(color)}BB" onclick="${detailAction}"><div class="wc-header"><div><div class="wc-name">${ESC(name)}</div><div class="wc-type">บัตรเครดิต${limit ? ` · วงเงิน ${MONEY(limit)}` : ''}</div></div></div><div class="wc-balance">-${MONEY(owed)}</div>${due ? `<div class="cc-due-strip${due.daysLeft <= 3 ? ' urgent' : ''}"><span>ครบกำหนดชำระ</span><strong>${ESC(due.dueStr)}</strong><em>${due.daysLeft === 0 ? 'วันนี้' : `อีก ${due.daysLeft} วัน`}</em></div>` : ''}${limit ? `<div class="wc-limit"><div class="wc-prog-bar"><div class="wc-prog-fill" style="width:${pct}%;background:${pct > 80 ? 'rgba(252,165,165,.95)' : 'rgba(255,255,255,.9)'}"></div></div><div class="wc-prog-info"><span>ใช้ไป ${pct.toFixed(0)}%</span><span>คงเหลือ ${MONEY(avail)}</span></div></div>` : ''}<div class="wc-action-row"><button class="wallet-chip-btn" onclick="event.stopPropagation();App.openCCDetail('${ESC(w.id)}')">ดูรายการ</button><button class="wallet-chip-btn" onclick="event.stopPropagation();App.openCCPay('${ESC(w.id)}')">ชำระ</button><button class="wallet-chip-btn" onclick="event.stopPropagation();App.openWalletForm('${ESC(w.id)}')">แก้ไข</button></div></div>`;
    }
    return `<div class="wallet-card wallet-card-colored" style="--wallet-color:${ESC(color)};--wallet-color-2:${ESC(color)}BB" onclick="${detailAction}"><div class="wc-header"><div><div class="wc-name">${ESC(name)}</div><div class="wc-type">${ESC(walletTypeLabel(w.type))}</div></div></div><div class="wc-balance">${MONEY(Number(w.balance || 0))}</div><div class="wc-action-row"><button class="wallet-chip-btn" onclick="event.stopPropagation();${detailAction}">ดูรายการ</button><button class="wallet-chip-btn" onclick="event.stopPropagation();App.openWalletForm('${ESC(w.id)}')">แก้ไข</button></div></div>`;
  };

  App.renderWallets = function(){
    const g = netWorthGroups(); const summary = document.getElementById('wallets-summary'); const content = document.getElementById('wallets-content');
    if (summary) summary.innerHTML = `<div class="wallet-summary-grid wallet-summary-grid-fixed"><div class="wallet-summary-card"><span>สินทรัพย์รวม</span><strong class="c-income">${MONEY(g.assetTotal)}</strong></div><div class="wallet-summary-card"><span>หนี้สินรวม</span><strong class="c-expense">${MONEY(g.liabilityTotal)}</strong></div></div>`;
    if (!content) return; content.style.display = 'block'; content.style.visibility = 'visible';
    const gold = goldData(); const updated = gold?.fetchedAt ? new Date(gold.fetchedAt).toLocaleString('th-TH', { dateStyle:'short', timeStyle:'short' }) : '';
    const goldNote = `<div class="wallet-market-note"><b>ราคาทอง:</b> อ้างอิงสมาคมค้าทองคำ · ทองรูปพรรณรับซื้อ${gold?.jewelryBuy ? ` ${MONEY(gold.jewelryBuy)}/บาททอง` : ' ยังไม่ Sync'}${updated ? ` · อัปเดต ${ESC(updated)}` : ''}</div>`;
    const empty = txt => `<div class="card card-pad wallet-empty-card">${ESC(txt)}</div>`;
    const section = (title, icon, list, emptyText, grid) => `<section class="wallet-section-block"><div class="wallet-section-title">${icon} ${ESC(title)}</div>${list.length ? `<div class="${grid ? 'wallet-grid-2' : 'wallet-list-stack'}">${list.map(App._walletCard).join('')}</div>` : empty(emptyText)}</section>`;
    content.innerHTML = `<div class="wallet-toolbar"><button class="btn btn-secondary btn-sm" onclick="App.refreshMarketPrices()">↻ Refresh ราคา</button><button class="btn btn-primary btn-sm" onclick="App.openWalletForm(null)">+ เพิ่มกระเป๋า</button></div>${goldNote}${section('สินทรัพย์','🏦',g.assets,'ยังไม่มีสินทรัพย์',true)}${section('บัตรเครดิต','💳',g.liabilities,'ยังไม่มีบัตรเครดิต',false)}${section('การลงทุน','📈',g.investments,'เพิ่มทอง / Crypto / FCD เพื่อดูราคาอ้างอิง',true)}`;
  };

  const previousOpenWalletDetail = App.openWalletDetail?.bind(App);
  App.openWalletDetail = function(id){
    const w = S.wallets.find(x => x.id === id); if (!w || !isInvest(w)) return previousOpenWalletDetail?.(id);
    const tx = (S.transactions || []).filter(t => t.walletId === id || t.toWalletId === id).sort((a,b)=>(b.date||'').localeCompare(a.date||'')); const price = App._investmentUnitPriceTHB(w);
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>${ESC(w.icon)} ${ESC(w.name)}</h2><button class="btn btn-secondary btn-sm" onclick="App.openWalletForm('${ESC(w.id)}')" style="width:auto">แก้ไข</button></div><div class="sub-scroll wallet-detail-screen"><div class="wallet-detail-hero wallet-detail-invest-only"><div class="nw-label">จำนวน Asset ที่มี</div><div class="big">${NUM(w.units,4)} <span>${ESC(unitLabel(w))}</span></div><div class="nw-detail"><span class="nw-item">ราคาจริง <strong>${price ? MONEY(price) + '/หน่วย' : 'ยังไม่ Sync'}</strong></span><a class="market-price-link" href="${ESC(marketUrl(w))}" target="_blank" rel="noopener noreferrer">เปิดดูราคา ↗</a></div>${w.type === 'gold' ? `<div class="wallet-market-note compact">อ้างอิง: สมาคมค้าทองคำ / ทองรูปพรรณรับซื้อ</div>` : ''}</div>${App._sectionHeader ? App._sectionHeader('รายการในกระเป๋านี้') : '<div class="section-title">รายการในกระเป๋านี้</div>'}<div class="card"><div style="padding:0 16px">${tx.length ? tx.map(t => App._txRow(t)).join('') : (App._emptyState ? App._emptyState('📋','ไม่พบรายการ','') : '<div class="empty-state">ไม่พบรายการ</div>')}</div></div></div>`);
    setTimeout(() => App._bindTxRows?.('sub-screen'), 0);
  };

  function normaliseGoldPayload(raw){
    let json = raw; if (typeof raw === 'string') { const trimmed = raw.trim(); try { json = JSON.parse(trimmed); } catch { const m = trimmed.match(/^[^(]+\((.*)\);?$/s); if (m) json = JSON.parse(m[1]); else return null; } }
    const root = json?.response || json?.data || json || {}; const price = root.price || root.prices || {}; const gold = price.gold || root.gold || {}; const goldBar = price.gold_bar || price.goldBar || root.gold_bar || root.goldBar || {}; const n = v => Number(String(v ?? '').replace(/,/g,'').replace(/[^\d.\-]/g,'')) || 0;
    const jewelryBuy = n(root.jewelryBuy || root.jewelry_buy || gold.buy || gold.bid || root.gold_buy); const jewelrySell = n(root.jewelrySell || root.jewelry_sell || gold.sell || gold.ask || root.gold_sell); const barBuy = n(root.barBuy || root.bar_buy || goldBar.buy || goldBar.bid); const barSell = n(root.barSell || root.bar_sell || goldBar.sell || goldBar.ask); if (!jewelryBuy && !barBuy) return null;
    return { ok:true, source: root.source || json.source || 'Thai Gold API / Gold Traders Association', url: root.url || json.url || GOLD_API_URL, fetchedAt: root.fetchedAt || json.fetchedAt || new Date().toISOString(), latestDate: root.update_date || root.latestDate || json.latestDate || '', latestTime: root.update_time || root.latestTime || json.latestTime || '', jewelryBuy: jewelryBuy || barBuy, jewelrySell, barBuy, barSell };
  }
  App._normaliseThaiGoldPayload = normaliseGoldPayload;
  App._fetchThaiGoldViaSource = async function(){
    const customProxy = String(window.MT_GOLD_PROXY_URL || localStorage.getItem('MT_GOLD_PROXY_URL') || '').trim();
    if (customProxy) { const payload = await App._fetchJsonp(customProxy); const data = normaliseGoldPayload(payload); if (data?.jewelryBuy) return { ...data, fetchedVia:'apps-script-proxy' }; }
    try { const r = await fetch(GOLD_API_URL, { cache:'no-store' }); if (r.ok) { const data = normaliseGoldPayload(await r.json()); if (data?.jewelryBuy) return { ...data, fetchedVia:'direct-api' }; } } catch (_) {}
    for (const url of ['https://api.allorigins.win/raw?url=' + encodeURIComponent(GOLD_API_URL), 'https://corsproxy.io/?' + encodeURIComponent(GOLD_API_URL)]) { try { const r = await fetch(url, { cache:'no-store' }); if (r.ok) { const data = normaliseGoldPayload(await r.text()); if (data?.jewelryBuy) return { ...data, fetchedVia:'public-proxy' }; } } catch (_) {} }
    return null;
  };
  App._fetchAuroraGoldViaProxy = App._fetchThaiGoldViaSource;
  App.refreshMarketPrices = async function(){
    const next = { ...(S.marketPrices || {}) }; let anyOk = false, goldOk = false;
    try { const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,binancecoin,tether&vs_currencies=thb,usd', { cache:'no-store' }); if (r.ok) { next.crypto = await r.json(); anyOk = true; } } catch (_) {}
    try { const r = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=THB,EUR,JPY,GBP,CNY', { cache:'no-store' }); if (r.ok) { next.fx = await r.json(); anyOk = true; } } catch (_) {}
    try { const gold = await App._fetchThaiGoldViaSource(); if (gold?.jewelryBuy) { next.thaiGold = gold; next.auroraGold = gold; anyOk = true; goldOk = true; } } catch (err) { console.warn('Gold sync failed:', err); }
    next.updatedAt = new Date().toISOString(); S.marketPrices = next; persist(); App.renderWallets?.(); App.render?.();
    if (goldOk) toast('Sync ราคาทองสมาคมค้าทองคำสำเร็จ', 'success'); else if (anyOk) toast('ราคาอื่นอัปเดตแล้ว แต่ราคาทองยังไม่สำเร็จ', 'warn'); else toast('Sync ราคาไม่ได้ กรุณาเช็ก Gold Proxy/อินเทอร์เน็ต', 'error');
  };
  try { if (S.page === 'wallets') App.renderWallets(); } catch (err) { console.warn('wallet rollback render failed', err); }
})();

/* ============================================================
   V2.2-safety-ux: Targeted bug fixes & UX improvements
   All changes are additive patches — nothing removed, no data
   model changes.
   ============================================================ */
;(function v22SafetyUX() {

  // ── P0: CC Payment — check source wallet has enough balance ──
  // Original saveCCPay deducts from source without any balance check,
  // silently sending it deeply negative.
  const _origSaveCCPay = App.saveCCPay.bind(App)
  App.saveCCPay = function() {
    const walletId = document.getElementById('cc-pay-wallet')?.value
    const amount   = parseFloat(document.getElementById('cc-pay-amount')?.value) || 0
    if (walletId && amount > 0) {
      const src = S.wallets.find(w => w.id === walletId)
      if (src && src.balance < amount) {
        toast(`ยอดใน "${src.name}" ไม่เพียงพอ (มี ${Calc.fmt(src.balance)})`, 'error')
        return
      }
    }
    _origSaveCCPay()
  }

  // ── P1: Search debounce — 250ms to prevent re-render on every keystroke ──
  // The V2.2 renderTransactions sets oninput without debounce.
  // We re-attach with debounce each time the transactions page renders.
  let _txSearchTimer = null
  const _origRenderTx = App.renderTransactions.bind(App)
  App.renderTransactions = function() {
    _origRenderTx()
    const el = document.getElementById('tx-search')
    if (!el) return
    el.oninput = function(e) {
      clearTimeout(_txSearchTimer)
      const val = e.target.value
      _txSearchTimer = setTimeout(() => {
        S.txSearch = val
        App.renderTransactionsList?.()
      }, 250)
    }
  }

  // ── P1: FAB visible on Transactions tab ──
  // V2.2.2 final guard hides FAB on all non-dashboard pages.
  // We wrap showPage (outer-most) so our change runs after syncChrome.
  const _origShowPage = App.showPage.bind(App)
  App.showPage = function(page) {
    _origShowPage(page)
    _syncFab(page)
  }

  const _origRender = App.render.bind(App)
  App.render = function() {
    const result = _origRender()
    _syncFab(S.page)
    return result
  }

  function _syncFab(page) {
    const fab = document.getElementById('fab')
    if (!fab) return
    const visible = page === 'dashboard' || page === 'transactions'
    // Toggle body class so the CSS rule body:not(.is-transactions) #fab
    // in V2.2.1 layer also allows the FAB through on the transactions page
    document.body.classList.toggle('is-transactions', page === 'transactions')
    fab.classList.toggle('hidden', !visible)
    fab.setAttribute('aria-hidden', String(!visible))
    fab.tabIndex = visible ? 0 : -1
  }

  // ── P1: Merchant autocomplete (datalist) in add-tx form ──
  // After each _renderAddTxDetail call, inject a <datalist> pointing at
  // the user's saved merchants so the browser shows suggestions.
  const _origDetailRender = App._renderAddTxDetail.bind(App)
  App._renderAddTxDetail = function() {
    _origDetailRender()
    _injectMerchantDatalist()
  }

  function _injectMerchantDatalist() {
    const input = document.getElementById('tx-merchant')
    if (!input || !S.merchants?.length) return
    const listId = 'tx-merchant-suggestions'
    let dl = document.getElementById(listId)
    if (!dl) {
      dl = document.createElement('datalist')
      dl.id = listId
      document.body.appendChild(dl)
    }
    dl.innerHTML = S.merchants
      .map(m => `<option value="${String(m.name).replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">`)
      .join('')
    input.setAttribute('list', listId)
  }

  // ── P2: getDueDate — local timezone instead of UTC ──
  // Original uses toISOString() which is UTC; in UTC+7 an 11 PM local
  // calculation shifts the due date to the next day.
  Calc.getDueDate = function(dueDay) {
    const now = new Date()
    let m = now.getMonth(), y = now.getFullYear()
    if (now.getDate() > dueDay) {
      m++
      if (m > 11) { m = 0; y++ }
    }
    const msLeft = new Date(y, m, dueDay) - now
    const daysLeft = Math.max(0, Math.ceil(msLeft / 86400000))
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
    return { daysLeft, dueStr: `${dueDay} ${months[m]}` }
  }

  // Apply FAB state immediately on script load
  try { _syncFab(S.page) } catch (_) {}

})();

/* ============================================================
   V2.3 Features
   1. Recurring auto-post alert on Dashboard
   2. Replace confirm() dialogs with inline confirmation
   3. Export CSV
   4. Daily budget ฿/day chip on budget bars
   5. Dashboard month switcher
   6. Wire up Thai gold proxy URL setting in More page
   ============================================================ */
;(function v23Features() {

  // ── Shared helpers ──────────────────────────────────────────
  const ESC = v => String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))
  const FMT = n => moneyFmt(Number(n) || 0)

  function mlabel(ym) {
    if (!ym) return ''
    const [y, m] = ym.split('-').map(Number)
    const names = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
    return `${names[m-1]} ${y}`
  }

  function secHdr(title, actionLabel, action) {
    return App._sectionHeader
      ? App._sectionHeader(title, actionLabel, action)
      : `<div class="section-header"><h3>${ESC(title)}</h3>${actionLabel ? `<button type="button" onclick="${action}">${ESC(actionLabel)}</button>` : ''}</div>`
  }

  function createStarterWallet() {
    return {
      id: Calc.genId ? Calc.genId() : `w_${Date.now()}`,
      name: 'กระเป๋าหลัก',
      type: 'cash',
      icon: '💵',
      color: '#059669',
      balance: 0,
    }
  }

  function ensureMinimumWallet() {
    if (!Array.isArray(S.wallets)) S.wallets = []
    if (S.wallets.length === 0) S.wallets.push(createStarterWallet())
    return S.wallets
  }

  function cleanResetState() {
    return {
      transactions: [],
      wallets: [createStarterWallet()],
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      budgets: [],
      settings: { ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), hideMoney: false },
      recurring: [],
      merchants: [],
      ccBenefits: {},
      incomeBudgets: [],
      marketPrices: {},
    }
  }

  const _prevEnsureV2State = App._ensureV2State?.bind(App)
  App._ensureV2State = function() {
    _prevEnsureV2State?.()
    ensureMinimumWallet()
  }

  // ── 1. Inline confirm dialog — replaces all 6 browser confirm() calls ──
  App.showConfirm = function({ title = 'ยืนยัน', body = '', confirmLabel = 'ยืนยัน', danger = false, onConfirm, onCancel } = {}) {
    document.getElementById('v23-confirm-overlay')?.remove()
    const el = document.createElement('div')
    el.id = 'v23-confirm-overlay'
    el.className = 'v23-confirm-overlay'
    el.innerHTML = `
      <div class="v23-confirm-sheet" role="alertdialog" aria-modal="true">
        <div class="v23-confirm-title">${ESC(title)}</div>
        ${body ? `<div class="v23-confirm-body">${ESC(body)}</div>` : ''}
        <div class="v23-confirm-actions">
          <button class="btn btn-secondary v23-cancel-btn">ยกเลิก</button>
          <button class="btn ${danger ? 'v23-btn-danger' : 'btn-primary'} v23-ok-btn">${ESC(confirmLabel)}</button>
        </div>
      </div>`
    document.body.appendChild(el)
    el.querySelector('.v23-cancel-btn').onclick = () => { el.remove(); onCancel?.() }
    el.querySelector('.v23-ok-btn').onclick    = () => { el.remove(); onConfirm?.() }
    el.addEventListener('click', e => { if (e.target === el) { el.remove(); onCancel?.() } })
  }

  App.importData = function(input) {
    const file = input?.files?.[0]
    if (!file) return
    Storage.importJSON(file, data => {
      App.showConfirm({
        title: 'นำเข้าข้อมูล',
        body: 'จะแทนที่ข้อมูลปัจจุบันทั้งหมด ยืนยัน?',
        confirmLabel: 'นำเข้า', danger: true,
        onConfirm() {
          S.transactions  = data.transactions || []
          S.wallets       = data.wallets      || []
          S.categories    = data.categories   || S.categories
          S.budgets       = data.budgets      || []
          S.recurring     = data.recurring    || []
          S.merchants     = data.merchants    || []
          S.ccBenefits    = data.ccBenefits   || {}
          S.incomeBudgets = data.incomeBudgets || []
          S.marketPrices  = data.marketPrices || {}
          ensureMinimumWallet()
          persist(); App.render()
          toast('นำเข้าข้อมูลสำเร็จ', 'success')
        },
        onCancel() { if (input) input.value = '' }
      })
    }, err => { toast('นำเข้าล้มเหลว: ' + err, 'error'); if (input) input.value = '' })
  }

  App.resetData = function() {
    App.showConfirm({
      title: 'รีเซ็ตข้อมูลทั้งหมด',
      body: 'ไม่สามารถกู้คืนได้ ยืนยันการรีเซ็ต?',
      confirmLabel: 'รีเซ็ต', danger: true,
      onConfirm() {
        Storage.reset()
        Object.assign(S, cleanResetState())
        persist(); applyTheme(); App.render()
        toast('รีเซ็ตข้อมูลแล้ว', 'info')
      }
    })
  }

  App.deleteWallet = function(id) {
    if ((S.wallets || []).length <= 1) {
      toast('ต้องมีกระเป๋าอย่างน้อย 1 อัน', 'warn')
      return
    }
    App.showConfirm({
      title: 'ลบกระเป๋าเงิน',
      body: 'รายการที่เกี่ยวข้องจะยังคงอยู่',
      confirmLabel: 'ลบ', danger: true,
      onConfirm() {
        if ((S.wallets || []).length <= 1) {
          toast('ต้องมีกระเป๋าอย่างน้อย 1 อัน', 'warn')
          return
        }
        S.wallets = S.wallets.filter(w => w.id !== id)
        ensureMinimumWallet()
        persist(); App.closeOverlay('overlay-wallet-form'); App.render()
        toast('ลบกระเป๋าแล้ว', 'success')
      }
    })
  }

  App.deleteRecurring = function(id) {
    App.showConfirm({
      title: 'ลบรายการประจำ',
      confirmLabel: 'ลบ', danger: true,
      onConfirm() {
        S.recurring = S.recurring.filter(r => r.id !== id)
        persist(); App.openRecurringScreen(); toast('ลบแล้ว', 'success')
      }
    })
  }

  App.deleteCategory = function(id) {
    App.showConfirm({
      title: 'ลบหมวดหมู่',
      confirmLabel: 'ลบ', danger: true,
      onConfirm() {
        const type = S.catManageType || 'expense'
        S.categories[type] = S.categories[type].filter(c => c.id !== id)
        persist(); App.openCategoryScreen(type); toast('ลบหมวดหมู่แล้ว', 'success')
      }
    })
  }

  App.deleteMerchant = function(id) {
    App.showConfirm({
      title: 'ลบร้านค้า',
      confirmLabel: 'ลบ', danger: true,
      onConfirm() {
        S.merchants = S.merchants.filter(m => m.id !== id)
        persist(); App.openMerchantScreen(); toast('ลบร้านค้าแล้ว', 'success')
      }
    })
  }

  // ── 2. Export CSV ────────────────────────────────────────────
  App.exportCSV = function() {
    const typeLabel = { expense: 'รายจ่าย', income: 'รายรับ', transfer: 'โอนเงิน', cc_payment: 'ชำระบัตร' }
    const headers = ['วันที่','ประเภท','หมวดหมู่','ร้านค้า/แหล่งที่มา','จำนวนเงิน','กระเป๋าเงิน','หมายเหตุ']
    const rows = [...S.transactions]
      .sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')))
      .map(t => {
        const cat = App._findCat?.(t.categoryId)
        const wallet = S.wallets.find(w => w.id === t.walletId)
        const toWallet = S.wallets.find(w => w.id === t.toWalletId)
        const sign = (t.type === 'expense' || t.type === 'cc_payment') ? -1 : 1
        const walletName = t.type === 'transfer'
          ? `${wallet?.name || ''} → ${toWallet?.name || ''}`
          : (wallet?.name || '')
        return [
          t.date || '',
          typeLabel[t.type] || t.type,
          cat?.label || '',
          t.merchant || '',
          (sign * Number(t.amount || 0)).toFixed(2),
          walletName,
          t.note || ''
        ].map(v => `"${String(v).replace(/"/g, '""')}"`)
      })
    const csv = '﻿' + [headers.map(h => `"${h}"`).join(','), ...rows.map(r => r.join(','))].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `money-tracker-${getTODAY()}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast('ส่งออก CSV สำเร็จ', 'success')
  }

  // ── 3. Recurring due-alert helpers ──────────────────────────
  function getOverdueRecurring() {
    const today = getTODAY()
    return (S.recurring || []).filter(r => {
      if (r.paused) return false
      if (!r.lastPostedAt) return true
      const daysSince = Math.floor((new Date(today) - new Date(r.lastPostedAt)) / 86400000)
      return daysSince >= (r.everyDays || 30)
    })
  }

  App.postRecurringNow = function(id) {
    const r = S.recurring.find(x => x.id === id)
    if (!r) return
    const expCatIds = new Set((S.categories.expense || []).map(c => c.id))
    const txType = r.categoryId && !expCatIds.has(r.categoryId) ? 'income' : 'expense'
    const wallet = S.wallets.find(w => w.type !== 'credit') || S.wallets[0]
    if (wallet) {
      S.transactions.push({
        id: Calc.genId(),
        type: txType,
        amount: Number(r.amount) || 0,
        walletId: wallet.id,
        categoryId: r.categoryId || '',
        merchant: r.name,
        note: '🔁 รายการประจำ',
        date: getTODAY(),
        isRecurring: true
      })
      const delta = Number(r.amount) || 0
      wallet.balance = (Number(wallet.balance) || 0) + (txType === 'expense' ? -delta : delta)
    }
    r.lastPostedAt = getTODAY()
    persist()
    App.renderDashboard()
    toast(`บันทึก "${r.name}" แล้ว`, 'success')
  }

  App.skipRecurringNow = function(id) {
    const r = S.recurring.find(x => x.id === id)
    if (!r) return
    r.lastPostedAt = getTODAY()
    persist()
    App.renderDashboard()
    toast(`ข้าม "${r.name}" แล้ว`, 'info')
  }

  // ── 4. Dashboard: month switcher + recurring alerts + daily budget ──
  S.dashMonth = S.dashMonth || getTHISMONTH()

  App.setDashMonth = function(m) {
    S.dashMonth = m
    App.renderDashboard()
  }

  App.renderDashboard = function() {
    App._ensureV2State?.()
    const dm = S.dashMonth || getTHISMONTH()
    const thisMonth = getTHISMONTH()
    const isCurrentMonth = dm === thisMonth

    const stats = Calc.getMonthlyStats(S.transactions, dm)
    const nw = Calc.getNetWorth(S.wallets)
    const expBudgets = Calc.getBudgetProgress(S.transactions, S.budgets, S.categories, dm)
    const incBudgets = Calc.getIncomeBudgetProgress
      ? Calc.getIncomeBudgetProgress(S.transactions, S.incomeBudgets || [], S.categories, dm)
      : []
    const recent = [...S.transactions]
      .filter(t => (t.date || '').startsWith(dm))
      .sort((a,b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 5)
    const assets = S.wallets.filter(w => w.type !== 'credit')
    const cc = S.wallets.find(w => w.type === 'credit' && Math.abs(Number(w.balance) || 0) > 0)
    const ccUsed = Math.abs(Number(cc?.balance) || 0)
    const ccLimit = Number(cc?.limit) || 0
    const ccPct = ccLimit ? Math.min(100, Math.max(0, (ccUsed / ccLimit) * 100)) : 0
    const ccDue = cc?.dueDay ? Calc.getDueDate(cc.dueDay) : null
    const transferTotal = S.transactions
      .filter(t => (t.date || '').startsWith(dm) && t.type === 'transfer')
      .reduce((s,t) => s + Number(t.amount || 0), 0)

    // Daily budget calculation
    const nowDate = new Date()
    const [dmY, dmM] = dm.split('-').map(Number)
    const totalDays = new Date(dmY, dmM, 0).getDate()
    const remainDays = isCurrentMonth ? Math.max(1, totalDays - nowDate.getDate() + 1) : 1

    function dailyChip(b) {
      if (!b.monthlyLimit) return ''
      const remaining = b.monthlyLimit - b.spent
      const daily = remaining > 0 ? Math.round(remaining / remainDays) : 0
      return `<span class="daily-budget-chip${remaining < 0 ? ' over' : ''}">฿${daily.toLocaleString('en-US')}/วัน</span>`
    }

    // Month nav (last 4 months, newest first)
    const months = Calc.getMonths ? Calc.getMonths(4) : [thisMonth]

    let html = `
      <div class="mt-topbar">
        <div>
          <div class="mt-title">Money Tracker</div>
          <div class="mt-subtitle">${ESC(Calc.monthLabel(dm))}</div>
        </div>
        <div class="mt-sync-pill"><span class="mt-sync-dot"></span><span>Local</span></div>
      </div>
      <div class="dash-month-nav">${months.map(m =>
        `<button class="chip${m === dm ? ' active' : ''}" onclick="App.setDashMonth('${ESC(m)}')">${ESC(mlabel(m))}</button>`
      ).join('')}</div>`

    // Recurring due alerts (current month only)
    if (isCurrentMonth) {
      const due = getOverdueRecurring()
      if (due.length) {
        html += `<div class="sec-title" style="margin-top:4px;margin-bottom:6px">🔁 รายการประจำที่ถึงกำหนด</div>`
        due.forEach(r => {
          html += `<div class="mt-recurring-alert">
            <div class="mt-recurring-alert-info">
              <span class="mt-recurring-alert-icon">${ESC(r.icon || '🔁')}</span>
              <div>
                <div class="mt-recurring-alert-name">${ESC(r.name)}</div>
                <div class="mt-recurring-alert-amount">${FMT(r.amount)}</div>
              </div>
            </div>
            <div class="mt-recurring-alert-btns">
              <button class="btn btn-primary btn-sm" onclick="App.postRecurringNow('${ESC(r.id)}')">บันทึก</button>
              <button class="btn btn-secondary btn-sm" onclick="App.skipRecurringNow('${ESC(r.id)}')">ข้าม</button>
            </div>
          </div>`
        })
      }
    }

    html += `
      <div class="mt-net-card">
        <div class="mt-net-head">
          <div>
            <div class="mt-net-label">เงินสุทธิที่ใช้ได้จริง</div>
            <div class="mt-net-value">${nw.net < 0 && !S.settings.hideMoney ? '-' : ''}${FMT(Math.abs(nw.net))}</div>
          </div>
          <button class="mt-hide-btn" onclick="App.toggleHideMoney()">${S.settings.hideMoney ? '👁 แสดง' : '🙈 ซ่อน'}</button>
        </div>
        <div class="mt-net-split">
          <div class="mt-net-metric"><small>รายรับเดือนนี้</small><strong style="color:#4ADE80">+${FMT(stats.income)}</strong></div>
          <div class="mt-divider"></div>
          <div class="mt-net-metric"><small>รายจ่ายเดือนนี้</small><strong style="color:#F87171">-${FMT(stats.expense)}</strong></div>
        </div>
      </div>`

    if (cc) {
      const dueText = ccDue
        ? `ครบกำหนด ${ESC(ccDue.dueStr)} · อีก ${ccDue.daysLeft} วัน`
        : `รอบบัญชีตัดวันที่ ${ESC(cc.cycleDay || 25)}`
      html += `
        <div class="mt-alert-card" onclick="App.openCCDetail('${ESC(cc.id)}')">
          <div>
            <div class="mt-alert-title">💳 ${ESC(cc.name)}</div>
            <div class="mt-alert-sub">${dueText}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:16px;font-weight:900;color:var(--expense);letter-spacing:-.04em">${FMT(ccUsed)}</div>
            ${ccLimit ? `<div style="font-size:10px;color:var(--muted);margin-top:1px">จาก ${FMT(ccLimit)}</div>` : ''}
          </div>
        </div>`
      if (ccLimit) {
        html += `<div class="mt-progress-wrap">
          <div class="mt-progress-label"><span>วงเงินที่ใช้</span><b style="color:${ccPct > 70 ? 'var(--expense)' : 'var(--text)'}">${ccPct.toFixed(0)}%</b></div>
          <div class="mt-progress-track"><div class="mt-progress-fill" style="width:${ccPct}%;background:${ccPct > 70 ? 'var(--expense)' : 'var(--primary)'}"></div></div>
        </div>`
      }
    }

    if (assets.length) {
      html += `<div class="mt-wallet-mini-grid">${assets.slice(0,3).map(w => `
        <div class="mt-wallet-mini" onclick="App.openWalletDetail('${ESC(w.id)}')">
          <div class="icon">${ESC(w.icon || '◈')}</div>
          <div class="value">${FMT(App._investmentValueTHB ? App._investmentValueTHB(w) : (w.balance || 0))}</div>
          <div class="name">${ESC(w.name)}</div>
        </div>`).join('')}</div>`
    }

    html += `<div class="mt-stat-row">
      <div class="mt-stat-card income"><small>รายรับ</small><strong>+${FMT(stats.income)}</strong></div>
      <div class="mt-stat-card expense"><small>รายจ่าย</small><strong>-${FMT(stats.expense)}</strong></div>
      <div class="mt-stat-card transfer"><small>โอนเงิน</small><strong>${FMT(transferTotal)}</strong></div>
      <div class="mt-stat-card saving"><small>คงเหลือเดือนนี้</small><strong>${stats.net < 0 && !S.settings.hideMoney ? '-' : ''}${FMT(Math.abs(stats.net))}</strong></div>
    </div>`

    const budgetRows = [...expBudgets.slice(0,2), ...incBudgets.slice(0,1)]
    if (budgetRows.length) {
      html += secHdr('งบประมาณเดือนนี้', 'ดูรายงาน', "App.showPage('reports')")
      html += `<div class="card card-pad">`
      budgetRows.forEach(b => {
        const barColor = b.over ? 'var(--expense)' : b.pct > 80 ? 'var(--amber)' : 'var(--income)'
        html += `<div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:13px;gap:8px">
            <span style="font-weight:800">${ESC(b.icon)} ${ESC(b.label)}</span>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              ${dailyChip(b)}
              <span style="color:${b.over ? 'var(--expense)' : 'var(--muted)'}">${FMT(b.spent)} / ${FMT(b.monthlyLimit)}</span>
            </div>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100,Math.max(0,b.pct))}%;background:${barColor}"></div></div>
        </div>`
      })
      html += `</div>`
    }

    html += secHdr('รายการล่าสุด', 'ดูทั้งหมด', "App.showPage('transactions')")
    html += `<div class="card" style="margin-bottom:22px"><div style="padding:0 16px">${
      recent.length
        ? recent.map(t => App._txRow(t)).join('')
        : (App._emptyState ? App._emptyState('📋','ยังไม่มีรายการ','แตะ + เพื่อเพิ่มรายการแรก') : '<div class="empty-state">ยังไม่มีรายการ</div>')
    }</div></div>`

    const target = document.getElementById('dashboard-content')
    if (target) target.innerHTML = html
    App._bindTxRows?.('dashboard-content')
  }

  // ── 5. More page: CSV export row + Thai gold proxy setting ──
  const _prevRenderMore = App.renderMore.bind(App)
  App.renderMore = function() {
    _prevRenderMore()
    const content = document.getElementById('more-content')
    if (!content) return

    // Insert CSV export row before the resetData row
    if (!content.querySelector('[data-v23-csv]')) {
      const resetRow = content.querySelector('[onclick*="resetData"]')?.closest('.settings-row')
      if (resetRow) {
        resetRow.insertAdjacentHTML('beforebegin', `
          <div class="settings-row" onclick="App.exportCSV()" data-v23-csv="1">
            <div class="s-icon">📊</div>
            <div class="s-label">ส่งออก CSV</div>
            <div class="s-arrow">›</div>
          </div>`)
      }
    }

    // Insert Gold proxy setting section before the footer
    if (!content.querySelector('[data-v23-gold-proxy]')) {
      const currentProxy = String(window.MT_GOLD_PROXY_URL || localStorage.getItem('MT_GOLD_PROXY_URL') || '')
      const footer = content.querySelector('[style*="text-align:center"]')
      if (footer) {
        footer.insertAdjacentHTML('beforebegin', `
          <div class="sec-title">Thai Gold API (Proxy)</div>
          <div class="card card-pad" data-v23-gold-proxy="1" style="margin-bottom:16px">
            <div style="font-size:13px;color:var(--muted);margin-bottom:10px">
              ใส่ URL Google Apps Script Proxy เพื่อ sync ราคาทองสมาคมค้าทองคำ
            </div>
            <input class="form-input" id="gold-proxy-input"
              placeholder="https://script.google.com/macros/s/.../exec"
              value="${ESC(currentProxy)}"
              style="margin-bottom:10px">
            <button class="btn btn-primary" onclick="App.saveGoldProxyUrl()">บันทึก Proxy URL</button>
            ${currentProxy ? `<div style="font-size:11px;color:var(--income);margin-top:8px">✓ ตั้งค่าแล้ว: ${ESC(currentProxy.length > 60 ? currentProxy.slice(0,60) + '…' : currentProxy)}</div>` : ''}
          </div>`)
      }
    }
  }

  App.saveGoldProxyUrl = function() {
    const url = (document.getElementById('gold-proxy-input')?.value || '').trim()
    localStorage.setItem('MT_GOLD_PROXY_URL', url)
    window.MT_GOLD_PROXY_URL = url
    toast(url ? 'บันทึก Gold Proxy URL แล้ว' : 'ล้าง Gold Proxy URL แล้ว', 'success')
    App.renderMore()
  }

  // Apply to current page immediately
  try { if (S.page === 'dashboard') App.renderDashboard() } catch (_) {}
  try { if (S.page === 'more') App.renderMore() } catch (_) {}

})();

/* ============================================================
   V2.4 Wallet + Reports polish
   Wallet: edit button top-right, remove ดูรายการ/market-link/
   market-note, show real THB value for invest wallets.
   Reports: single AI insights section + analyzing toast.
   ============================================================ */
;(function v24WalletReportsPolish() {
  const ESC = v => String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))
  const MONEY = n => moneyFmt(Number(n) || 0)
  const NUM = (n, d = 4) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: d })
  const isInvest = w => w && new Set(['gold','crypto','fcd']).has(w.type)

  function unitLabel(w) {
    if (w.type === 'gold') return 'บาทท.'
    if (w.type === 'crypto') return w.symbol || 'coins'
    return w.symbol || 'หน่วย'
  }

  // ── Override _walletCard ──────────────────────────────────────
  App._walletCard = function(w) {
    const isCC = w.type === 'credit'
    const invest = isInvest(w)
    const color = w.color || (isCC ? '#DC2626' : invest ? '#D97706' : '#2563EB')
    const name = `${w.icon || ''} ${w.name || ''}`.trim()
    const typeLabel = App._walletTypeLabel ? App._walletTypeLabel(w.type) : w.type
    const editBtn = `<button class="wc-edit-btn" onclick="event.stopPropagation();App.openWalletForm('${ESC(w.id)}')" aria-label="แก้ไข">✏️</button>`

    if (invest) {
      const price = App._investmentUnitPriceTHB ? App._investmentUnitPriceTHB(w) : 0
      const thbValue = App._investmentValueTHB ? App._investmentValueTHB(w) : (price * Number(w.units || 0))
      const units = Number(w.units || 0)
      return `<div class="wallet-card wallet-card-colored wallet-card-invest" style="--wallet-color:${ESC(color)};--wallet-color-2:${ESC(color)}BB">
        <div class="wc-header">
          <div><div class="wc-name">${ESC(name)}</div><div class="wc-type">${ESC(typeLabel)}</div></div>
          ${editBtn}
        </div>
        <div class="wc-balance">${MONEY(thbValue)}</div>
        <div class="wc-prog-info wc-invest-units" style="margin-top:6px">
          <span>${NUM(units, 4)} ${ESC(unitLabel(w))}</span>
          <span>${price ? MONEY(price) + '/หน่วย' : 'ยังไม่ Sync'}</span>
        </div>
      </div>`
    }

    if (isCC) {
      const owed = Math.abs(Number(w.balance || 0))
      const limit = Number(w.limit || 0)
      const due = w.dueDay ? Calc.getDueDate(w.dueDay) : null
      const pct = limit ? Math.min(100, Math.max(0, owed / limit * 100)) : 0
      const avail = limit ? Math.max(0, limit - owed) : 0
      const payBtn = `<button class="wallet-chip-btn wc-card-pay-btn" onclick="event.stopPropagation();App.openCCPay('${ESC(w.id)}')">ชำระ</button>`
      return `<div class="wallet-card wallet-card-colored wallet-card-credit" style="--wallet-color:${ESC(color)};--wallet-color-2:${ESC(color)}BB" onclick="App.openCCDetail('${ESC(w.id)}')">
        <div class="wc-header">
          <div><div class="wc-name">${ESC(name)}</div><div class="wc-type">บัตรเครดิต${limit ? ` · วงเงิน ${MONEY(limit)}` : ''}</div></div>
          <div class="wc-card-actions">${payBtn}${editBtn}</div>
        </div>
        <div class="wc-balance">-${MONEY(owed)}</div>
        ${due ? `<div class="cc-due-strip${due.daysLeft <= 3 ? ' urgent' : ''}"><span>ครบกำหนดชำระ</span><strong>${ESC(due.dueStr)}</strong><em>${due.daysLeft === 0 ? 'วันนี้' : `อีก ${due.daysLeft} วัน`}</em></div>` : ''}
        ${limit ? `<div class="wc-limit"><div class="wc-prog-bar"><div class="wc-prog-fill" style="width:${pct}%;background:${pct > 80 ? 'rgba(252,165,165,.95)' : 'rgba(255,255,255,.9)'}"></div></div><div class="wc-prog-info"><span>ใช้ไป ${pct.toFixed(0)}%</span><span>คงเหลือ ${MONEY(avail)}</span></div></div>` : ''}
      </div>`
    }

    // Regular asset wallet — card click opens transaction history
    return `<div class="wallet-card wallet-card-colored" style="--wallet-color:${ESC(color)};--wallet-color-2:${ESC(color)}BB" onclick="App.openWalletDetail('${ESC(w.id)}')">
      <div class="wc-header">
        <div><div class="wc-name">${ESC(name)}</div><div class="wc-type">${ESC(typeLabel)}</div></div>
        ${editBtn}
      </div>
      <div class="wc-balance">${MONEY(Number(w.balance || 0))}</div>
    </div>`
  }

  // ── Strip wallet-market-note after render ────────────────────
  const _prevRenderWallets = App.renderWallets.bind(App)
  App.renderWallets = function() {
    _prevRenderWallets()
    document.querySelectorAll('#wallets-content .wallet-market-note').forEach(el => el.remove())
  }

  // ── Reports: single AI insights + "analyzing" toast ──────────
  const _prevRenderReports = App.renderReports.bind(App)
  App.renderReports = function() {
    toast('🧠 AI กำลังวิเคราะห์...', 'info')
    _prevRenderReports()
    const box = document.getElementById('reports-content')
    if (!box) return

    // Remove all insight sections injected by earlier wrappers
    box.querySelectorAll('.sec-title').forEach(el => {
      if (/Financial Insights/i.test(el.textContent)) {
        el.nextElementSibling?.remove()
        el.remove()
      }
    })
    box.querySelectorAll('.ai-advisor-card').forEach(el => el.remove())

    // Insert one fresh AI insights card at top
    if (!App.getFinancialAdvisorInsights) return
    const insights = App.getFinancialAdvisorInsights(S.rptMonth)
    if (!insights?.length) return
    box.insertAdjacentHTML('afterbegin', `
      <div class="sec-title">Financial Insights</div>
      <div class="card card-pad ai-advisor-card" style="margin-bottom:12px">
        <div class="ai-card-head">
          <div><strong>AI Financial Coach</strong><span>วิเคราะห์จากพฤติกรรมรายรับ-รายจ่ายในเครื่อง</span></div>
          <button class="btn btn-secondary btn-sm" onclick="App.renderReports()">วิเคราะห์ใหม่</button>
        </div>
        ${insights.map(i => `<div class="insight-row ai-insight">
          <div class="insight-icon">${i.icon}</div>
          <div><div class="insight-title">${ESC(i.title)}</div><div class="insight-body">${ESC(i.body)}</div></div>
        </div>`).join('')}
      </div>`)
  }

  // Apply immediately
  try { if (S.page === 'wallets') App.renderWallets() } catch (_) {}
  try { if (S.page === 'reports') App.renderReports() } catch (_) {}

})();

/* ============================================================
   V2.4.1 Credit card pay button placement guard
   Ensures legacy wallet-card renderers cannot leave “ชำระ” in
   the bottom action row. The visible target is header actions:
   [ชำระ] [แก้ไข].
   ============================================================ */
;(function v241CreditPayPlacementGuard() {
  function isPayButton(btn) {
    return btn && (btn.textContent || '').trim() === 'ชำระ'
  }
  function isEditButton(btn) {
    return btn && (btn.textContent || '').trim() === 'แก้ไข'
  }
  function ensureCreditPayPlacement() {
    document.querySelectorAll('#wallets-content .wallet-card-credit').forEach(card => {
      const header = card.querySelector('.wc-header')
      if (!header) return
      let actions = header.querySelector('.wc-card-actions')
      if (!actions) {
        actions = document.createElement('div')
        actions.className = 'wc-card-actions'
        header.appendChild(actions)
      }

      const bottomRow = card.querySelector('.wc-action-row')
      const bottomButtons = bottomRow ? Array.from(bottomRow.querySelectorAll('button')) : []
      const bottomPay = bottomButtons.find(isPayButton)
      const bottomEdit = bottomButtons.find(isEditButton)
      const headerPay = Array.from(actions.querySelectorAll('button')).find(isPayButton)
      const headerEdit = actions.querySelector('.wc-edit-btn') || Array.from(actions.querySelectorAll('button')).find(isEditButton)

      if (bottomPay && !headerPay) {
        bottomPay.classList.add('wc-card-pay-btn')
        actions.insertBefore(bottomPay, actions.firstChild)
      } else if (bottomPay) {
        bottomPay.remove()
      }

      if (bottomEdit && !headerEdit) {
        bottomEdit.classList.add('wc-edit-btn')
        actions.appendChild(bottomEdit)
      } else if (bottomEdit) {
        bottomEdit.remove()
      }

      if (bottomRow && !bottomRow.querySelector('button')) bottomRow.remove()
    })
  }

  const _renderWallets = App.renderWallets?.bind(App)
  if (_renderWallets) {
    App.renderWallets = function() {
      _renderWallets()
      ensureCreditPayPlacement()
    }
  }

  try { if (S.page === 'wallets') ensureCreditPayPlacement() } catch (_) {}
})();

/* ============================================================
   V2.4.2 FCD FX sync polish
   - Fetch FX quotes based on actual FCD wallet currencies.
   - Keep the existing gold/crypto sync behavior.
   - Revalue investment wallets that have units after fresh prices arrive.
   ============================================================ */
;(function v242FcdFxSyncPolish() {
  const COMMON_FCD_QUOTES = ['THB', 'EUR', 'JPY', 'GBP', 'CNY', 'SGD', 'HKD', 'AUD', 'NZD', 'CAD', 'CHF'];
  const cleanCurrency = value => String(value || '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  const money = n => (typeof moneyFmt === 'function' ? moneyFmt(Number(n) || 0) : `฿${(Number(n) || 0).toLocaleString('en-US')}`);
  const notify = (msg, type) => (typeof toast === 'function' ? toast(msg, type) : console.log(msg));

  function getFcdCurrencies() {
    const set = new Set(['USD', ...COMMON_FCD_QUOTES]);
    (S.wallets || [])
      .filter(w => w?.type === 'fcd')
      .forEach(w => {
        const cur = cleanCurrency(w.currency || w.symbol || 'USD');
        if (cur) set.add(cur);
      });
    return [...set].filter(Boolean);
  }

  function normaliseBulkFxPayload(data, requested) {
    const rates = data?.rates || {};
    const thbPerUsd = Number(rates.THB || 0);
    if (!thbPerUsd) return null;

    const fcdRatesTHB = { THB: 1, USD: thbPerUsd };
    requested.forEach(cur => {
      if (cur === 'THB') fcdRatesTHB.THB = 1;
      else if (cur === 'USD') fcdRatesTHB.USD = thbPerUsd;
      else if (Number(rates[cur]) > 0) fcdRatesTHB[cur] = thbPerUsd / Number(rates[cur]);
    });

    return {
      ...data,
      base: data?.base || 'USD',
      rates: { ...rates, THB: thbPerUsd },
      requestedQuotes: requested,
      fcdRatesTHB,
      fetchedAt: new Date().toISOString(),
      source: 'Frankfurter'
    };
  }

  async function fetchBulkFx(currencies) {
    const quotes = [...new Set(['THB', ...currencies.filter(cur => cur !== 'USD' && cur !== 'THB')])];
    const query = quotes.join(',');
    const urls = [
      `https://api.frankfurter.dev/v2/rates?base=USD&quotes=${query}`,
      `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${query}`
    ];

    for (const url of urls) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) continue;
        const normalised = normaliseBulkFxPayload(await r.json(), currencies);
        if (normalised) return normalised;
      } catch (_) {}
    }
    return null;
  }

  async function fetchPairFx(currencies) {
    const fcdRatesTHB = { THB: 1 };
    const requested = [...new Set(currencies.filter(cur => cur && cur !== 'THB'))];

    for (const cur of requested) {
      try {
        const r = await fetch(`https://api.frankfurter.dev/v2/rate/${encodeURIComponent(cur)}/THB`, { cache: 'no-store' });
        if (!r.ok) continue;
        const data = await r.json();
        const rate = Number(data?.rate || data?.rates?.THB || 0);
        if (rate > 0) fcdRatesTHB[cur] = rate;
      } catch (_) {}
    }

    if (!fcdRatesTHB.USD) return null;
    return {
      base: 'USD',
      rates: { THB: fcdRatesTHB.USD },
      requestedQuotes: currencies,
      fcdRatesTHB,
      fetchedAt: new Date().toISOString(),
      source: 'Frankfurter'
    };
  }

  async function fetchFcdFx() {
    const currencies = getFcdCurrencies();
    return (await fetchBulkFx(currencies)) || (await fetchPairFx(currencies));
  }

  function fcdRateTHB(cur) {
    const cc = cleanCurrency(cur || 'USD');
    const p = S.marketPrices || {};
    if (cc === 'THB') return 1;
    if (Number(p.fcdRatesTHB?.[cc]) > 0) return Number(p.fcdRatesTHB[cc]);
    if (Number(p.fx?.fcdRatesTHB?.[cc]) > 0) return Number(p.fx.fcdRatesTHB[cc]);

    const rates = p.fx?.rates || {};
    const thbPerUsd = Number(rates.THB || 0);
    if (cc === 'USD') return thbPerUsd || 0;
    if (thbPerUsd && Number(rates[cc]) > 0) return thbPerUsd / Number(rates[cc]);
    return 0;
  }

  function revalueInvestmentWallets() {
    (S.wallets || []).forEach(w => {
      if (!['gold', 'crypto', 'fcd'].includes(w?.type)) return;
      const units = Number(w.units || 0);
      if (!units || !App._investmentUnitPriceTHB) return;
      const unitPrice = Number(App._investmentUnitPriceTHB(w) || 0);
      if (unitPrice > 0) w.balance = units * unitPrice;
    });
  }

  const previousUnitPrice = App._investmentUnitPriceTHB?.bind(App);
  App._investmentUnitPriceTHB = function(w) {
    if (w?.type === 'fcd') {
      const cur = cleanCurrency(w.currency || w.symbol || 'USD');
      return fcdRateTHB(cur) || Number(w.manualPrice || 0);
    }
    return previousUnitPrice ? previousUnitPrice(w) : Number(w?.manualPrice || 0);
  };

  const previousMarketText = App._marketText?.bind(App);
  App._marketText = function(w) {
    if (w?.type === 'fcd') {
      const cur = cleanCurrency(w.currency || w.symbol || 'USD');
      const rate = fcdRateTHB(cur);
      return rate ? `Frankfurter FX · ${cur}/THB ${rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : `ยังไม่ Sync อัตราแลกเปลี่ยน ${cur}/THB`;
    }
    return previousMarketText ? previousMarketText(w) : '';
  };

  App.refreshMarketPrices = async function() {
    const next = { ...(S.marketPrices || {}) };
    let cryptoOk = false;
    let fxOk = false;
    let goldOk = false;

    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,binancecoin,tether&vs_currencies=thb,usd', { cache: 'no-store' });
      if (r.ok) { next.crypto = await r.json(); cryptoOk = true; }
    } catch (_) {}

    try {
      const fx = await fetchFcdFx();
      if (fx?.fcdRatesTHB?.USD) {
        next.fx = fx;
        next.fcdRatesTHB = fx.fcdRatesTHB;
        fxOk = true;
      }
    } catch (_) {}

    try {
      if (typeof App._fetchThaiGoldViaSource === 'function') {
        const gold = await App._fetchThaiGoldViaSource();
        if (gold?.jewelryBuy) {
          next.thaiGold = gold;
          next.auroraGold = gold;
          goldOk = true;
        }
      }
    } catch (err) {
      console.warn('Gold sync failed:', err);
    }

    next.updatedAt = new Date().toISOString();
    S.marketPrices = next;
    revalueInvestmentWallets();
    persist();
    App.renderWallets?.();
    App.render?.();

    const okParts = [];
    if (fxOk) okParts.push('FCD FX');
    if (cryptoOk) okParts.push('Crypto');
    if (goldOk) okParts.push('ทอง');

    if (okParts.length) notify(`Sync ราคาอ้างอิงสำเร็จ: ${okParts.join(', ')}`, goldOk || fxOk ? 'success' : 'info');
    else notify('Sync ราคาไม่ได้ กรุณาเช็กอินเทอร์เน็ตหรือ Gold Proxy', 'error');
  };

  try { if (S.page === 'wallets') App.renderWallets?.(); } catch (_) {}
})();

/* ============================================================
   V3.0 All-phases: postRecurring fix · datalist · all-months
   search · amount filter · installment auto-gen · cashback
   auto-credit · settings restore on import · wallet spend summary
   ============================================================ */
;(function v30AllPhases() {
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))
  const fmt = n => (typeof moneyFmt === 'function' ? moneyFmt(Number(n) || 0) : Calc.fmt(Number(n) || 0))

  // Add n months to a YYYY-MM-DD string, clamped to last day of target month
  function addMonths(dateStr, n) {
    const [y, m, d] = (dateStr || getTODAY()).split('-').map(Number)
    const target = new Date(y, m - 1 + n, 1)
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
    return `${target.getFullYear()}-${String(target.getMonth()+1).padStart(2,'0')}-${String(Math.min(d, lastDay)).padStart(2,'0')}`
  }

  // Local date-group label for transaction list (replaces inaccessible closure)
  function txDateLabel(dateStr) {
    if (!dateStr) return ''
    const today = getTODAY()
    const d = new Date(); d.setDate(d.getDate() - 1)
    const yest = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const base = Calc.shortDate(dateStr)
    if (dateStr === today) return `วันนี้ ${base}`
    if (dateStr === yest)  return `เมื่อวาน ${base}`
    return base
  }

  // ── 1. Fix postRecurringNow double-mutation ───────────────────
  App.postRecurringNow = function(id) {
    const r = S.recurring.find(x => x.id === id)
    if (!r) return
    const expCatIds = new Set((S.categories.expense || []).map(c => c.id))
    const txType = r.categoryId && !expCatIds.has(r.categoryId) ? 'income' : 'expense'
    const wallet = S.wallets.find(w => w.type !== 'credit') || S.wallets[0]
    if (wallet) {
      const tx = {
        id: Calc.genId(), type: txType, amount: Number(r.amount) || 0,
        walletId: wallet.id, categoryId: r.categoryId || '',
        merchant: r.name, note: '🔁 รายการประจำ', date: getTODAY(), isRecurring: true
      }
      S.transactions.push(tx)
      App._applyBalance(tx, 1)
    }
    r.lastPostedAt = getTODAY()
    persist()
    App.renderDashboard()
    toast(`บันทึก "${r.name}" แล้ว`, 'success')
  }

  // ── 2. Merchant datalist autocomplete ────────────────────────
  const _prevRenderAddTxDetail = App._renderAddTxDetail?.bind(App)
  App._renderAddTxDetail = function() {
    _prevRenderAddTxDetail?.()
    let dl = document.getElementById('mt-merchant-list')
    if (!dl) {
      dl = document.createElement('datalist')
      dl.id = 'mt-merchant-list'
      document.body.appendChild(dl)
    }
    dl.innerHTML = (S.merchants || []).map(m => `<option value="${esc(m.name)}">`).join('')
    const inp = document.getElementById('tx-merchant')
    if (inp) inp.setAttribute('list', 'mt-merchant-list')
  }

  // ── 3. "ทุกเดือน" chip + amount range filter ─────────────────
  const _prevRenderTx = App.renderTransactions?.bind(App)
  App.renderTransactions = function() {
    _prevRenderTx?.()
    // Inject "ทุกเดือน" chip (guard against double-inject on fast re-renders)
    const monthChips = document.getElementById('tx-month-chips')
    if (monthChips && !monthChips.querySelector('[data-all-months]')) {
      const btn = document.createElement('button')
      btn.className = 'chip mini' + (S.txMonth === 'all' ? ' active' : '')
      btn.dataset.allMonths = '1'
      btn.textContent = 'ทุกเดือน'
      btn.onclick = () => App.setTxMonth('all')
      monthChips.insertBefore(btn, monthChips.firstChild)
    }
    // Amount range row (re-insert each time since header is rebuilt)
    const header = document.querySelector('#page-transactions .page-header')
    if (header && !document.getElementById('tx-amount-filter')) {
      header.insertAdjacentHTML('beforeend', `<div id="tx-amount-filter" style="display:flex;gap:8px;padding:4px 0 2px">
        <input class="form-input" type="number" id="tx-amt-min" placeholder="฿ ต่ำสุด" inputmode="numeric" value="${esc(S.txAmtMin || '')}" oninput="S.txAmtMin=this.value;App.renderTransactionsList()" style="flex:1;padding:8px 10px;font-size:13px">
        <input class="form-input" type="number" id="tx-amt-max" placeholder="฿ สูงสุด" inputmode="numeric" value="${esc(S.txAmtMax || '')}" oninput="S.txAmtMax=this.value;App.renderTransactionsList()" style="flex:1;padding:8px 10px;font-size:13px">
      </div>`)
    }
  }

  // Override renderTransactionsList to support all-months + amount range
  const _prevRenderTxList = App.renderTransactionsList?.bind(App)
  App.renderTransactionsList = function() {
    const amtMin = S.txAmtMin ? parseFloat(S.txAmtMin) : null
    const amtMax = S.txAmtMax ? parseFloat(S.txAmtMax) : null
    // Fast path: no extra filters active, delegate to original
    if (S.txMonth !== 'all' && amtMin === null && amtMax === null) {
      _prevRenderTxList?.()
      return
    }
    const q = (S.txSearch || '').toLowerCase()
    const filtered = S.transactions.filter(t => {
      if (S.txMonth !== 'all' && !String(t.date || '').startsWith(S.txMonth)) return false
      if (S.txType !== 'all' && t.type !== S.txType) return false
      if (amtMin !== null && Number(t.amount || 0) < amtMin) return false
      if (amtMax !== null && Number(t.amount || 0) > amtMax) return false
      if (!q) return true
      const cat = App._findCat?.(t.categoryId)
      const wallet = S.wallets.find(w => w.id === t.walletId)
      const toWallet = S.wallets.find(w => w.id === t.toWalletId)
      return [t.merchant, t.note, cat?.label, wallet?.name, toWallet?.name]
        .some(v => String(v || '').toLowerCase().includes(q))
    }).sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')))

    const income  = filtered.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount || 0), 0)
    const expense = filtered.filter(t => t.type === 'expense' || t.type === 'cc_payment').reduce((s,t) => s + Number(t.amount || 0), 0)
    const incEl = document.getElementById('tx-income-total')
    const expEl = document.getElementById('tx-expense-total')
    if (incEl) incEl.textContent = '+' + fmt(income)
    if (expEl) expEl.textContent = '-' + fmt(expense)

    const byDate = {}
    filtered.forEach(t => { (byDate[t.date] ||= []).push(t) })
    const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a))
    let html = ''
    if (!dates.length) {
      html = App._emptyState?.('📋', 'ไม่มีรายการ', q ? 'ไม่พบผลการค้นหา' : 'ยังไม่มีรายการในช่วงนี้')
        || '<div style="padding:32px;text-align:center;color:var(--muted)">ไม่มีรายการ</div>'
    }
    dates.forEach(date => {
      const rows = byDate[date]
      const dayInc = rows.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount || 0), 0)
      const dayExp = rows.filter(t => t.type === 'expense' || t.type === 'cc_payment').reduce((s,t) => s + Number(t.amount || 0), 0)
      html += `<div class="tx-date-header"><span>${esc(txDateLabel(date))}</span><div>${dayInc ? `<b class="c-income">+${fmt(dayInc)}</b>` : ''}${dayExp ? `<b class="c-expense">-${fmt(dayExp)}</b>` : ''}</div></div><div class="tx-group-card">${rows.map(t => App._txRow(t)).join('')}</div>`
    })
    const el = document.getElementById('tx-list-content')
    if (el) el.innerHTML = html
    App._bindTxRows?.('tx-list-content')
  }

  // ── 4. Installment auto-generation ───────────────────────────
  const _prevSaveTx = App.saveTx?.bind(App)
  App.saveTx = function() {
    const n = parseInt(S.tx.installmentMonths || 0)
    if (S.txMode !== 'edit' && S.tx.isInstallment && n >= 2) {
      const amt = parseFloat(S.tx.amount)
      if (!amt || amt <= 0)    { toast('กรุณาระบุจำนวนเงิน', 'error'); return }
      if (!S.tx.walletId)      { toast('กรุณาเลือกกระเป๋าเงิน', 'error'); return }
      if (!S.tx.categoryId)    { toast('กรุณาเลือกหมวดหมู่', 'error'); return }
      const perMonth = Math.round((amt / n) * 100) / 100
      const baseDate = S.tx.date || getTODAY()
      for (let i = 0; i < n; i++) {
        const tx = {
          id: Calc.genId(), type: S.tx.type, amount: perMonth,
          walletId: S.tx.walletId, categoryId: S.tx.categoryId,
          merchant: S.tx.merchant, note: S.tx.note,
          date: addMonths(baseDate, i),
          isInstallment: true, installmentNo: i + 1, installmentMonths: n
        }
        S.transactions.unshift(tx)
        App._applyBalance(tx, 1)
      }
      App._registerMerchantFromTx?.({ ...S.tx })
      S.txMode = 'add'; S.editingTxId = null
      persist(); App.closeOverlay('overlay-add-tx'); App.render()
      toast(`สร้าง ${n} งวด ฿${perMonth.toLocaleString('en-US')} ต่อเดือน`, 'success')
      return
    }

    // For cashback: capture pre-call state
    const wasNew      = S.txMode !== 'edit'
    const preType     = S.tx.type
    const preWalletId = S.tx.walletId
    const preAmt      = parseFloat(S.tx.amount || 0)
    const preTxCount  = S.transactions.length

    _prevSaveTx?.()

    // Auto-post cashback when a new CC expense was actually saved
    if (wasNew && preType === 'expense' && preAmt > 0 && S.transactions.length > preTxCount) {
      const card = S.wallets.find(w => w.id === preWalletId && w.type === 'credit')
      if (card) {
        const benefit = App._benefit?.(card.id) || {}
        const cb = benefit.cashback || {}
        const cbEnabled = !!(cb.enabled || benefit.enabled)
        if (cbEnabled && (cb.percent || 0) > 0) {
          const base = cb.everyBaht ? Math.floor(preAmt / cb.everyBaht) * cb.everyBaht : preAmt
          let cashback = base * ((cb.percent || 0) / 100)
          if (cb.tierThreshold && preAmt < cb.tierThreshold) cashback = 0
          if (cb.maxPerTxn) cashback = Math.min(cashback, cb.maxPerTxn)
          cashback = Math.round(cashback * 100) / 100
          if (cashback > 0) {
            const cbTx = {
              id: Calc.genId(), type: 'income', amount: cashback,
              walletId: card.id, note: `Cashback ${card.name}`, date: getTODAY()
            }
            S.transactions.unshift(cbTx)
            App._applyBalance(cbTx, 1)
            persist(); App.render?.()
            toast(`Cashback +${fmt(cashback)} บันทึกแล้ว`, 'success')
          }
        }
      }
    }
  }

  // ── 5. Restore S.settings on import ──────────────────────────
  App.importData = function(input) {
    const file = input?.files?.[0]
    if (!file) return
    Storage.importJSON(file, data => {
      App.showConfirm({
        title: 'นำเข้าข้อมูล',
        body: 'จะแทนที่ข้อมูลปัจจุบันทั้งหมด ยืนยัน?',
        confirmLabel: 'นำเข้า', danger: true,
        onConfirm() {
          S.transactions  = data.transactions  || []
          S.wallets       = data.wallets       || []
          S.categories    = data.categories    || S.categories
          S.budgets       = data.budgets       || []
          S.recurring     = data.recurring     || []
          S.merchants     = data.merchants     || []
          S.ccBenefits    = data.ccBenefits    || {}
          S.incomeBudgets = data.incomeBudgets || []
          S.marketPrices  = data.marketPrices  || {}
          if (data.settings) S.settings = { ...S.settings, ...data.settings }
          App._ensureV2State?.()
          persist(); App.render()
          toast('นำเข้าข้อมูลสำเร็จ', 'success')
        },
        onCancel() { if (input) input.value = '' }
      })
    }, err => { toast('นำเข้าล้มเหลว: ' + err, 'error'); if (input) input.value = '' })
  }

  // ── 6. Wallet monthly spend summary ──────────────────────────
  const _prevOpenWalletDetail = App.openWalletDetail?.bind(App)
  App.openWalletDetail = function(id) {
    _prevOpenWalletDetail?.(id)
    setTimeout(() => {
      const hero = document.querySelector('#sub-screen .wallet-detail-hero')
      if (!hero || hero.dataset.summaryInjected) return
      hero.dataset.summaryInjected = '1'

      const w = S.wallets.find(x => x.id === id)
      if (!w || ['gold', 'crypto', 'fcd'].includes(w.type)) return

      const txList = App._filterWalletTx ? App._filterWalletTx(id)
        : S.transactions.filter(t => t.walletId === id || t.toWalletId === id)
      const inflow  = txList.filter(t =>
        (t.type === 'income' && t.walletId === id) ||
        (t.type === 'transfer' && t.toWalletId === id)
      ).reduce((s,t) => s + Number(t.amount || 0), 0)
      const outflow = txList.filter(t =>
        (t.type === 'expense' && t.walletId === id) ||
        (t.type === 'transfer' && t.walletId === id) ||
        (t.type === 'cc_payment' && t.walletId === id)
      ).reduce((s,t) => s + Number(t.amount || 0), 0)
      const net = inflow - outflow

      hero.insertAdjacentHTML('afterend', `
        <div class="wallet-spend-summary">
          <div class="wss-item"><span>รายรับ</span><strong class="c-income">+${fmt(inflow)}</strong></div>
          <div class="wss-item"><span>รายจ่าย</span><strong class="c-expense">-${fmt(outflow)}</strong></div>
          <div class="wss-item"><span>สุทธิ</span><strong class="${net >= 0 ? 'c-income' : 'c-expense'}">${net < 0 ? '-' : '+'}${fmt(Math.abs(net))}</strong></div>
        </div>`)
    }, 0)
  }

  try { if (S.page === 'transactions') App.renderTransactions() } catch (_) {}
})();

/* ============================================================
   V3.1 Financial Safety
   1. Balance reconciliation + repair tool
   2. Export includes settings; better filename
   3. Import: validate transactions + auto-backup
   4. CC payment filter chip
   5. Transfer-to-CC block
   6. Insufficient balance + credit limit validation
   7. saveCCPay source-balance check
   8. Recurring: assigned wallet & type
   9. Delete protection for referenced data
  10. Enhanced search (type, date, amount)
  11. CC reward calculation uses all cycle transactions
  ============================================================ */
;(function v31FinancialSafety() {
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))
  const fmt = n => (typeof moneyFmt === 'function' ? moneyFmt(Number(n) || 0) : Calc.fmt(Number(n) || 0))
  const TX_TYPE_LABELS = { income:'รายรับ', expense:'รายจ่าย', transfer:'โอนเงิน', cc_payment:'ชำระบัตร' }

  // ── 1. Balance reconciliation ─────────────────────────────────

  App._computeWalletFlows = function() {
    const flows = {}
    S.transactions.forEach(tx => {
      const amt = Number(tx.amount) || 0
      if (!tx.walletId) return
      if (tx.type === 'income')
        flows[tx.walletId] = (flows[tx.walletId] || 0) + amt
      else if (tx.type === 'expense')
        flows[tx.walletId] = (flows[tx.walletId] || 0) - amt
      else if (tx.type === 'transfer' || tx.type === 'cc_payment') {
        flows[tx.walletId]   = (flows[tx.walletId]   || 0) - amt
        if (tx.toWalletId)
          flows[tx.toWalletId] = (flows[tx.toWalletId] || 0) + amt
      }
    })
    return flows
  }

  App._snapshotOpeningBalances = function() {
    const flows = App._computeWalletFlows()
    S.wallets.forEach(w => {
      if (w.openingBalance === undefined)
        w.openingBalance = Math.round(((Number(w.balance) || 0) - (flows[w.id] || 0)) * 100) / 100
    })
    persist()
  }

  App._rebuildWalletBalances = function() {
    const flows = App._computeWalletFlows()
    let fixed = 0
    S.wallets.forEach(w => {
      if (w.openingBalance === undefined) return
      const expected = Math.round(((Number(w.openingBalance) || 0) + (flows[w.id] || 0)) * 100) / 100
      if (Math.abs(expected - Number(w.balance)) > 0.01) { w.balance = expected; fixed++ }
    })
    persist(); App.render()
    toast(fixed > 0 ? `แก้ไข ${fixed} กระเป๋าแล้ว` : 'ยอดทุกกระเป๋าถูกต้องแล้ว', fixed > 0 ? 'success' : 'info')
  }

  App._repairOneWallet = function(id) {
    const flows = App._computeWalletFlows()
    const w = S.wallets.find(x => x.id === id)
    if (!w || w.openingBalance === undefined) return
    w.balance = Math.round(((Number(w.openingBalance) || 0) + (flows[id] || 0)) * 100) / 100
    persist()
    App.openBalanceRepairScreen()
    toast('แก้ไขยอดแล้ว', 'success')
  }

  App._resetOpeningBalances = function() {
    App.showConfirm({
      title: 'รีเซ็ต Baseline', danger: true,
      body: 'ล้าง Baseline ที่บันทึกไว้และตั้งใหม่จากยอดปัจจุบัน ยืนยัน?',
      confirmLabel: 'รีเซ็ต',
      onConfirm() {
        S.wallets.forEach(w => delete w.openingBalance)
        App._snapshotOpeningBalances()
        App.openBalanceRepairScreen()
        toast('รีเซ็ต Baseline แล้ว', 'success')
      }
    })
  }

  App.openBalanceRepairScreen = function() {
    const flows = App._computeWalletFlows()
    const hasBaseline = S.wallets.some(w => w.openingBalance !== undefined)
    if (!hasBaseline) {
      App.showConfirm({
        title: 'ตั้งค่า Baseline',
        body: 'ระบบจะบันทึกยอดปัจจุบันเป็น Baseline เพื่อตรวจจับการเบี่ยงเบนในอนาคต ยืนยัน?',
        confirmLabel: 'ตั้งค่า',
        onConfirm() { App._snapshotOpeningBalances(); toast('บันทึก Baseline แล้ว', 'success') }
      })
      return
    }
    const rows = S.wallets.map(w => {
      const netFlow = flows[w.id] || 0
      const ob = w.openingBalance !== undefined ? Number(w.openingBalance) : null
      const expected = ob !== null ? Math.round((ob + netFlow) * 100) / 100 : null
      const current = Number(w.balance) || 0
      const gap = expected !== null ? Math.abs(expected - current) : 0
      return { w, netFlow, ob, expected, current, gap }
    })
    const anyGap = rows.some(r => r.gap > 0.01)
    const rowsHtml = rows.map(r => `
      <div class="card card-pad" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1">
            <div style="font-weight:700;margin-bottom:4px">${esc(r.w.icon || '')} ${esc(r.w.name)}</div>
            <div style="font-size:12px;color:var(--muted)">ยอดปัจจุบัน: <b>${fmt(r.current)}</b></div>
            ${r.expected !== null ? `<div style="font-size:12px;color:var(--muted)">คำนวณจาก tx: <b>${fmt(r.expected)}</b></div>` : ''}
            <div style="font-size:12px;font-weight:600;margin-top:4px;color:${r.gap > 0.01 ? 'var(--expense)' : 'var(--income)'}">
              ${r.gap > 0.01 ? `⚠️ ต่างกัน ${fmt(r.gap)}` : '✓ ถูกต้อง'}
            </div>
          </div>
          ${r.gap > 0.01 ? `<button class="btn btn-secondary btn-sm" onclick="App._repairOneWallet('${esc(r.w.id)}')" style="width:auto;margin-left:10px">แก้ไข</button>` : ''}
        </div>
      </div>`).join('')
    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.closeSubScreen()">←</button>
        <h2>ตรวจสอบยอดคงเหลือ</h2>
        ${anyGap ? `<button class="btn btn-primary btn-sm" onclick="App._rebuildWalletBalances();App.closeSubScreen()" style="width:auto">แก้ทั้งหมด</button>` : ''}
      </div>
      <div class="sub-scroll">
        <div class="card card-pad" style="margin-bottom:14px;font-size:12px;color:var(--muted)">
          เปรียบเทียบยอดที่เก็บกับยอดที่คำนวณจากรายการทั้งหมด + ยอดเปิดบัญชี
        </div>
        ${rowsHtml}
        <button class="btn btn-secondary" style="margin-top:4px;width:100%" onclick="App._resetOpeningBalances()">รีเซ็ต Baseline ใหม่</button>
      </div>`)
  }

  // ── 2. Export with settings + local-date filename ────────────

  App.exportData = function() {
    const localDate = getTODAY()
    const data = {
      exportedAt: new Date().toISOString(),
      appVersion: '3.1',
      transactions:  S.transactions,
      wallets:       S.wallets,
      categories:    S.categories,
      budgets:       S.budgets,
      recurring:     S.recurring,
      merchants:     S.merchants,
      ccBenefits:    S.ccBenefits,
      incomeBudgets: S.incomeBudgets,
      marketPrices:  S.marketPrices  || {},
      settings:      S.settings,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `money-tracker-backup-${localDate}.json`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast('ส่งออกข้อมูลสำเร็จ', 'success')
  }

  // ── 3. Import: validate + auto-backup ───────────────────────

  App.importData = function(input) {
    const file = input?.files?.[0]
    if (!file) return
    Storage.importJSON(file, data => {
      // Validate structure
      if (!Array.isArray(data.transactions) || !Array.isArray(data.wallets)) {
        toast('ไฟล์ไม่ถูกต้อง: ขาด transactions หรือ wallets', 'error')
        if (input) input.value = ''; return
      }
      // Validate and filter transactions
      const validTypes = new Set(['income', 'expense', 'transfer', 'cc_payment'])
      const walletIds  = new Set(data.wallets.map(w => w.id))
      const before = data.transactions.length
      data.transactions = data.transactions.filter(t => {
        if (!validTypes.has(t.type))                        return false
        if (!(Number(t.amount) > 0))                        return false
        if (!t.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(t.date))) return false
        if (t.walletId && !walletIds.has(t.walletId))       return false
        return true
      })
      const skipped = before - data.transactions.length

      App.showConfirm({
        title: 'นำเข้าข้อมูล', danger: true,
        body: `จะแทนที่ข้อมูลปัจจุบันทั้งหมด${skipped ? ` (กรองรายการไม่ถูกต้อง ${skipped} รายการออก)` : ''} ยืนยัน?`,
        confirmLabel: 'นำเข้า',
        onConfirm() {
          // Auto-backup current state
          try {
            localStorage.setItem('mt_pre_import_backup', JSON.stringify({
              backedUpAt: new Date().toISOString(),
              transactions: S.transactions, wallets: S.wallets,
              categories: S.categories, budgets: S.budgets,
              recurring: S.recurring, merchants: S.merchants,
              ccBenefits: S.ccBenefits, incomeBudgets: S.incomeBudgets,
              marketPrices: S.marketPrices || {}, settings: S.settings,
            }))
          } catch (_) {}
          // Apply
          S.transactions  = data.transactions  || []
          S.wallets       = data.wallets       || []
          S.categories    = data.categories    || S.categories
          S.budgets       = data.budgets       || []
          S.recurring     = data.recurring     || []
          S.merchants     = data.merchants     || []
          S.ccBenefits    = data.ccBenefits    || {}
          S.incomeBudgets = data.incomeBudgets || []
          S.marketPrices  = data.marketPrices  || {}
          if (data.settings) S.settings = { ...S.settings, ...data.settings }
          App._ensureV2State?.()
          persist(); App.render()
          toast(`นำเข้าสำเร็จ${skipped ? ` (ข้าม ${skipped} รายการ)` : ''}`, 'success')
        },
        onCancel() { if (input) input.value = '' }
      })
    }, err => { toast('นำเข้าล้มเหลว: ' + err, 'error'); if (input) input.value = '' })
  }

  // ── 4. CC payment filter chip ────────────────────────────────

  const _prevRenderTx31 = App.renderTransactions?.bind(App)
  App.renderTransactions = function() {
    _prevRenderTx31?.()
    const typeChips = document.getElementById('tx-type-chips')
    if (typeChips && !typeChips.querySelector('[data-cc-pay-chip]')) {
      const btn = document.createElement('button')
      btn.className = 'chip' + (S.txType === 'cc_payment' ? ' active' : '')
      btn.dataset.ccPayChip = '1'
      btn.textContent = 'ชำระบัตร'
      btn.onclick = () => App.setTxType('cc_payment')
      typeChips.appendChild(btn)
    }
  }

  // ── 5-6. Central validation wrapper for saveTx ───────────────

  App._validateTx = function(tx, isEdit) {
    const amt = Number(tx.amount) || 0
    if (!amt || amt <= 0)  return 'กรุณาระบุจำนวนเงิน'
    if (!tx.walletId)      return 'กรุณาเลือกกระเป๋าเงิน'

    if (tx.type === 'transfer') {
      if (!tx.toWalletId)               return 'กรุณาเลือกปลายทาง'
      if (tx.toWalletId === tx.walletId) return 'กระเป๋าต้นทางและปลายทางต้องไม่เหมือนกัน'
      const fromW = S.wallets.find(w => w.id === tx.walletId)
      const toW   = S.wallets.find(w => w.id === tx.toWalletId)
      if (fromW?.type === 'credit' || toW?.type === 'credit')
        return 'โอนเงินจาก/ไปบัตรเครดิตต้องใช้เมนูชำระบัตร'
      if (!isEdit && fromW && fromW.type !== 'credit' && Number(fromW.balance) < amt)
        return 'ยอดเงินในกระเป๋าไม่เพียงพอ'
    }

    if (tx.type === 'expense') {
      if (!tx.categoryId) return 'กรุณาเลือกหมวดหมู่'
      const w = S.wallets.find(x => x.id === tx.walletId)
      if (!isEdit && w && w.type !== 'credit' && Number(w.balance) < amt)
        return 'ยอดเงินในกระเป๋าไม่เพียงพอ'
      if (!isEdit && w?.type === 'credit' && (w.limit || 0) > 0) {
        const avail = w.limit - Math.abs(Number(w.balance) || 0)
        if (amt > avail) return `วงเงินคงเหลือ ${fmt(Math.max(0, avail))} ไม่พอ`
      }
    }

    return null
  }

  const _prevSaveTx31 = App.saveTx?.bind(App)
  App.saveTx = function() {
    const isEdit = S.txMode === 'edit'
    const err = App._validateTx(S.tx, isEdit)
    if (err) { toast(err, 'error'); return }
    _prevSaveTx31?.()
  }

  // ── 7. saveCCPay: source wallet balance check ────────────────

  const _prevSaveCCPay31 = App.saveCCPay?.bind(App)
  App.saveCCPay = function() {
    const walletId = document.getElementById('cc-pay-wallet')?.value
    const amount   = parseFloat(document.getElementById('cc-pay-amount')?.value) || 0
    if (walletId && amount > 0) {
      const src = S.wallets.find(w => w.id === walletId)
      if (src && src.type !== 'credit' && Number(src.balance) < amount) {
        toast('ยอดเงินในกระเป๋าต้นทางไม่เพียงพอ', 'error'); return
      }
    }
    _prevSaveCCPay31?.()
  }

  // ── 8. Recurring: wallet + type per recurring item ───────────

  App.openRecurringForm = function(id) {
    const r = id ? S.recurring.find(x => x.id === id) : null
    const cats = [...(S.categories.expense || []), ...(S.categories.income || [])]
    const walletOpts = (S.wallets || []).filter(w => w.type !== 'credit')
      .map(w => `<option value="${esc(w.id)}"${r?.walletId === w.id ? ' selected' : ''}>${esc(w.icon || '')} ${esc(w.name)}</option>`).join('')
    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openRecurringScreen()">←</button>
        <h2>${r ? 'แก้ไข' : 'เพิ่ม'}รายการประจำ</h2>
        <button class="btn btn-primary btn-sm" onclick="App.saveRecurring('${esc(id || '')}')" style="width:auto;padding:8px 14px">บันทึก</button>
      </div>
      <div class="sub-scroll">
        <div class="form-group"><label class="form-label">ชื่อรายการ</label><input class="form-input" id="rec-name" value="${esc(r?.name || '')}"></div>
        <div class="form-group"><label class="form-label">จำนวนเงิน (฿)</label><input class="form-input" type="number" id="rec-amount" value="${esc(r?.amount || '')}"></div>
        <div class="form-group"><label class="form-label">ทุกกี่วัน</label><input class="form-input" type="number" id="rec-days" value="${esc(r?.everyDays || 30)}"></div>
        <div class="form-group"><label class="form-label">หมวดหมู่</label><select class="form-input" id="rec-cat">${cats.map(c => `<option value="${esc(c.id)}"${r?.categoryId === c.id ? ' selected' : ''}>${esc(c.icon || '')} ${esc(c.label)}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">กระเป๋าเงิน</label><select class="form-input" id="rec-wallet"><option value="">-- กระเป๋าเริ่มต้น --</option>${walletOpts}</select></div>
      </div>`)
  }

  App.saveRecurring = function(id) {
    const name      = document.getElementById('rec-name')?.value?.trim() || ''
    const amount    = parseFloat(document.getElementById('rec-amount')?.value) || 0
    const everyDays = parseInt(document.getElementById('rec-days')?.value) || 30
    const catId     = document.getElementById('rec-cat')?.value || ''
    const walletId  = document.getElementById('rec-wallet')?.value || undefined
    const cat       = App._findCat?.(catId)
    if (!name || !amount) { toast('กรุณากรอกชื่อและจำนวนเงิน', 'error'); return }
    const data = {
      name, amount, everyDays, paused: false,
      categoryId: cat?.id, categoryName: cat?.label, icon: cat?.icon, color: cat?.color,
      walletId,
    }
    if (id) {
      const idx = S.recurring.findIndex(r => r.id === id)
      if (idx >= 0) S.recurring[idx] = { ...S.recurring[idx], ...data }
    } else {
      S.recurring.push({ id: Calc.genId(), ...data })
    }
    persist(); App.openRecurringScreen(); toast('บันทึกรายการประจำแล้ว', 'success')
  }

  App.postRecurringNow = function(id) {
    const r = S.recurring.find(x => x.id === id)
    if (!r) return
    const expCatIds = new Set((S.categories.expense || []).map(c => c.id))
    const txType = r.type || (r.categoryId && !expCatIds.has(r.categoryId) ? 'income' : 'expense')
    const wallet = (r.walletId && S.wallets.find(w => w.id === r.walletId && w.type !== 'credit'))
      || S.wallets.find(w => w.type !== 'credit')
      || S.wallets[0]
    if (!wallet) { toast('ไม่พบกระเป๋าเงิน', 'error'); return }
    const tx = {
      id: Calc.genId(), type: txType, amount: Number(r.amount) || 0,
      walletId: wallet.id, categoryId: r.categoryId || '',
      merchant: r.name, note: '🔁 รายการประจำ', date: getTODAY(), isRecurring: true
    }
    S.transactions.push(tx)
    App._applyBalance(tx, 1)
    r.lastPostedAt = getTODAY()
    persist(); App.renderDashboard()
    toast(`บันทึก "${r.name}" แล้ว`, 'success')
  }

  // ── 9. Delete protection for referenced data ─────────────────

  App.deleteWallet = function(id) {
    if ((S.wallets || []).length <= 1) { toast('ต้องมีกระเป๋าอย่างน้อย 1 อัน', 'warn'); return }
    const txCount  = (S.transactions || []).filter(t => t.walletId === id || t.toWalletId === id).length
    const recCount = (S.recurring    || []).filter(r => r.walletId === id).length
    const extraMsg = txCount || recCount
      ? ` มีรายการ ${txCount} รายการ${recCount ? ` และประจำ ${recCount} รายการ` : ''} อ้างอิงกระเป๋านี้`
      : ''
    App.showConfirm({
      title: 'ลบกระเป๋าเงิน', danger: true,
      body: `ยืนยันลบกระเป๋านี้?${extraMsg} รายการที่อ้างอิงจะยังอยู่`,
      confirmLabel: 'ลบ',
      onConfirm() {
        if ((S.wallets || []).length <= 1) { toast('ต้องมีกระเป๋าอย่างน้อย 1 อัน', 'warn'); return }
        S.wallets = S.wallets.filter(w => w.id !== id)
        App._ensureV2State?.()
        persist(); App.closeOverlay('overlay-wallet-form'); App.render()
        toast('ลบกระเป๋าแล้ว', 'success')
      }
    })
  }

  App.deleteCategory = function(id) {
    const type = S.catManageType || 'expense'
    const txCount  = (S.transactions || []).filter(t => t.categoryId === id).length
    const recCount = (S.recurring    || []).filter(r => r.categoryId === id).length
    const extraMsg = txCount || recCount
      ? ` หมวดนี้ใช้ใน ${txCount} รายการ${recCount ? ` และประจำ ${recCount} รายการ` : ''}`
      : ''
    App.showConfirm({
      title: 'ลบหมวดหมู่', danger: true,
      body: `ยืนยันลบหมวดหมู่นี้?${extraMsg}`,
      confirmLabel: 'ลบ',
      onConfirm() {
        S.categories[type] = (S.categories[type] || []).filter(c => c.id !== id)
        persist(); App.openCategoryScreen(type); toast('ลบหมวดหมู่แล้ว', 'success')
      }
    })
  }

  App.deleteMerchant = function(id) {
    const m = (S.merchants || []).find(x => x.id === id)
    const txCount = m ? (S.transactions || []).filter(t => t.merchant === m.name).length : 0
    const extraMsg = txCount ? ` ร้านนี้ใช้ใน ${txCount} รายการ` : ''
    App.showConfirm({
      title: 'ลบร้านค้า', danger: true,
      body: `ยืนยันลบร้านค้านี้?${extraMsg}`,
      confirmLabel: 'ลบ',
      onConfirm() {
        S.merchants = S.merchants.filter(x => x.id !== id)
        persist(); App.openMerchantScreen(); toast('ลบร้านค้าแล้ว', 'success')
      }
    })
  }

  // ── 10. Enhanced renderTransactionsList ──────────────────────
  // Full replacement: all-months, amount range, extended search

  App.renderTransactionsList = function() {
    const amtMin = S.txAmtMin ? parseFloat(S.txAmtMin) : null
    const amtMax = S.txAmtMax ? parseFloat(S.txAmtMax) : null
    const q = (S.txSearch || '').toLowerCase()

    const filtered = S.transactions.filter(t => {
      if (S.txMonth !== 'all' && !String(t.date || '').startsWith(S.txMonth)) return false
      if (S.txType !== 'all' && t.type !== S.txType) return false
      if (amtMin !== null && Number(t.amount || 0) < amtMin) return false
      if (amtMax !== null && Number(t.amount || 0) > amtMax) return false
      if (!q) return true
      const cat      = App._findCat?.(t.categoryId)
      const wallet   = S.wallets.find(w => w.id === t.walletId)
      const toWallet = S.wallets.find(w => w.id === t.toWalletId)
      return [
        t.merchant, t.note, cat?.label, wallet?.name, toWallet?.name,
        TX_TYPE_LABELS[t.type] || t.type,
        t.date || '',
        String(t.amount || '')
      ].some(v => String(v || '').toLowerCase().includes(q))
    }).sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')))

    const income  = filtered.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount || 0), 0)
    const expense = filtered.filter(t => t.type === 'expense' || t.type === 'cc_payment').reduce((s,t) => s + Number(t.amount || 0), 0)
    const incEl = document.getElementById('tx-income-total')
    const expEl = document.getElementById('tx-expense-total')
    if (incEl) incEl.textContent = '+' + fmt(income)
    if (expEl) expEl.textContent = '-' + fmt(expense)

    const today = getTODAY()
    const d = new Date(); d.setDate(d.getDate() - 1)
    const yest = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const dateLabel = dateStr => {
      if (!dateStr) return ''
      const base = Calc.shortDate(dateStr)
      if (dateStr === today) return `วันนี้ ${base}`
      if (dateStr === yest)  return `เมื่อวาน ${base}`
      return base
    }

    const byDate = {}
    filtered.forEach(t => { (byDate[t.date] ||= []).push(t) })
    const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a))
    let html = ''
    if (!dates.length) {
      html = App._emptyState?.('📋', 'ไม่มีรายการ', q ? 'ไม่พบผลการค้นหา' : 'ยังไม่มีรายการในช่วงนี้')
           || '<div style="padding:32px;text-align:center;color:var(--muted)">ไม่มีรายการ</div>'
    }
    dates.forEach(date => {
      const rows   = byDate[date]
      const dayInc = rows.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount || 0), 0)
      const dayExp = rows.filter(t => t.type === 'expense' || t.type === 'cc_payment').reduce((s,t) => s + Number(t.amount || 0), 0)
      html += `<div class="tx-date-header"><span>${esc(dateLabel(date))}</span><div>${dayInc ? `<b class="c-income">+${fmt(dayInc)}</b>` : ''}${dayExp ? `<b class="c-expense">-${fmt(dayExp)}</b>` : ''}</div></div><div class="tx-group-card">${rows.map(t => App._txRow(t)).join('')}</div>`
    })
    const el = document.getElementById('tx-list-content')
    if (el) el.innerHTML = html
    App._bindTxRows?.('tx-list-content')
  }

  // ── 11. CC reward: use ALL cycle transactions, not just 20 ───

  const _prevOpenCCDetail31 = App.openCCDetail?.bind(App)
  App.openCCDetail = function(cardId) {
    _prevOpenCCDetail31?.(cardId)
    setTimeout(() => {
      const card = S.wallets.find(w => w.id === cardId)
      if (!card) return
      const benefit = App._benefit?.(cardId) || {}
      const period = Calc.getStatementPeriod(card.cycleDay || 25)
      const allCycleTxns = S.transactions.filter(t =>
        t.walletId === cardId && t.type === 'expense' &&
        t.date >= period.start && t.date <= period.end
      )
      const rewards = Calc.getCardRewards(allCycleTxns, benefit)
      // Patch reward tiles rendered by the inner openCCDetail
      const tiles = document.querySelectorAll('#sub-screen .reward-tile strong, #sub-screen .mini-stat strong')
      if (tiles.length >= 2) {
        tiles[0].textContent = rewards.points.toLocaleString('en-US')
        tiles[1].textContent = fmt(rewards.cashback)
      }
    }, 0)
  }

  // ── Inject Balance Repair tool into More page ────────────────

  const _prevRenderMore31 = App.renderMore?.bind(App)
  App.renderMore = function() {
    _prevRenderMore31?.()
    const content = document.getElementById('more-content')
    if (!content || content.querySelector('[data-v31-repair]')) return
    const resetRow = content.querySelector('[onclick*="resetData"]')?.closest('.settings-row')
    if (resetRow) {
      resetRow.insertAdjacentHTML('beforebegin', `
        <div class="settings-row" onclick="App.openBalanceRepairScreen()" data-v31-repair="1">
          <div class="s-icon">🔧</div>
          <div class="s-label">ตรวจสอบยอดคงเหลือ</div>
          <div class="s-arrow">›</div>
        </div>`)
    }
  }

  try { if (S.page === 'more')         App.renderMore()         } catch (_) {}
  try { if (S.page === 'transactions') App.renderTransactions()  } catch (_) {}
})();

// ── v32: Custom merchant picker (replaces unreliable <datalist>) ─────────────
;(function() {
  'use strict'

  // ── helpers ─────────────────────────────────────────────────
  function esc32(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }

  function getDropdown() { return document.getElementById('mt-merchant-dropdown') }

  // Build/rebuild the dropdown list filtered by query q
  App._showMerchantDropdown = function(q) {
    const inp = document.getElementById('tx-merchant')
    if (!inp) return
    const merchants = S.merchants || []
    const norm = (q || '').trim().toLowerCase()
    const matches = norm
      ? merchants.filter(m => m.name.toLowerCase().includes(norm))
      : merchants.slice()

    let dd = getDropdown()
    if (!dd) {
      // Create wrapper + dropdown; wrap the input
      const wrap = document.createElement('div')
      wrap.className = 'mt-merchant-wrap'
      inp.parentNode.insertBefore(wrap, inp)
      wrap.appendChild(inp)

      dd = document.createElement('div')
      dd.id = 'mt-merchant-dropdown'
      dd.className = 'hidden'
      wrap.appendChild(dd)
    }

    if (!matches.length) {
      dd.classList.add('hidden')
      return
    }

    dd.innerHTML = matches.map(m => `
      <div class="mt-merchant-item" ontouchstart="" onmousedown="event.preventDefault();App._pickMerchant(${JSON.stringify(m.name)})">
        <span class="mmi-emoji">${esc32(m.emoji || '🏪')}</span>
        <span class="mmi-name">${esc32(m.name)}</span>
      </div>`).join('')
    dd.classList.remove('hidden')
  }

  App._hideMerchantDropdown = function() {
    const dd = getDropdown()
    if (dd) dd.classList.add('hidden')
  }

  App._pickMerchant = function(name) {
    App._txField('merchant', name)
    const inp = document.getElementById('tx-merchant')
    if (inp) inp.value = name
    App._hideMerchantDropdown()
  }

  // ── Override _renderAddTxDetail to wire up the custom dropdown ──
  const _prevDetail32 = App._renderAddTxDetail?.bind(App)
  App._renderAddTxDetail = function() {
    _prevDetail32?.()

    // Remove any lingering datalist references injected by earlier IIFEs
    ;['mt-merchant-list', 'tx-merchant-suggestions'].forEach(id => {
      const el = document.getElementById(id)
      if (el) el.remove()
    })

    const inp = document.getElementById('tx-merchant')
    if (!inp) return

    // Remove old datalist binding
    inp.removeAttribute('list')

    // Detach from previous wrapper if re-rendering (dropdown already exists)
    const existingDd = getDropdown()
    if (existingDd) existingDd.remove()
    if (inp.parentNode?.classList?.contains('mt-merchant-wrap')) {
      const wrap = inp.parentNode
      wrap.parentNode.insertBefore(inp, wrap)
      wrap.remove()
    }

    // Set up event handlers
    inp.setAttribute('autocomplete', 'off')
    inp.addEventListener('focus', function() {
      App._showMerchantDropdown(this.value)
    })
    inp.addEventListener('input', function() {
      App._txField('merchant', this.value)
      App._showMerchantDropdown(this.value)
    })
    inp.addEventListener('blur', function() {
      // Delay so onmousedown/ontouchstart on items fires first
      setTimeout(App._hideMerchantDropdown, 180)
    })

    // Show dropdown immediately if already focused (re-render case)
    if (document.activeElement === inp) {
      App._showMerchantDropdown(inp.value)
    }
  }

  // Re-apply to current render if add-tx sheet is open
  try {
    if (document.getElementById('tx-merchant')) App._renderAddTxDetail()
  } catch (_) {}
})();

/* ============================================================
   V4.0 Roadmap Phases 1-5 implementation
   - Phase 1: ledger recalculation, backup/restore, validation, local-sync status
   - Phase 2: credit statement center + reward ledger, no auto-cashback posting
   - Phase 3: installment groups + recurring due schedule
   - Phase 4: spending vs cash-flow reports + net-worth snapshots
   - Phase 5: investment buy/sell/adjust + portfolio status
   ============================================================ */
;(function v40RoadmapPhases(){
  const VERSION = '4.0-roadmap-phases'
  const INVEST_TYPES = new Set(['gold','crypto','fcd'])
  const CASH_TYPES = new Set(['bank','cash','ewallet','saving','credit'])
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))
  const money = n => (typeof moneyFmt === 'function' ? moneyFmt(Number(n) || 0) : Calc.fmt(Number(n) || 0))
  const number = (n, digits = 4) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: digits })
  const today = () => (typeof getTODAY === 'function' ? getTODAY() : new Date().toISOString().slice(0,10))
  const monthOf = d => String(d || today()).slice(0,7)
  const localNow = () => new Date().toISOString()

  function addMonths(dateStr, months) {
    const [y, m, d] = String(dateStr || today()).split('-').map(Number)
    const target = new Date(y, (m || 1) - 1 + months, 1)
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
    return `${target.getFullYear()}-${String(target.getMonth()+1).padStart(2,'0')}-${String(Math.min(d || 1, last)).padStart(2,'0')}`
  }

  function addDays(dateStr, days) {
    const [y,m,d] = String(dateStr || today()).split('-').map(Number)
    const dt = new Date(y, (m || 1) - 1, d || 1)
    dt.setDate(dt.getDate() + Number(days || 0))
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
  }

  function clampDay(year, monthIndex, day) {
    const last = new Date(year, monthIndex + 1, 0).getDate()
    return Math.max(1, Math.min(Number(day) || 1, last))
  }

  function catById(id) { return App._findCat?.(id) || null }
  function walletById(id) { return (S.wallets || []).find(w => w.id === id) || null }
  function isInvestWallet(w) { return INVEST_TYPES.has(w?.type) }
  function isCashWallet(w) { return CASH_TYPES.has(w?.type) && !isInvestWallet(w) }

  // ── Extra persisted state not covered by older Storage keys ────────────────
  function loadJSON(key, fallback) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback } catch { return fallback } }
  function saveJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch (_) {} }

  function ensureV4State() {
    S.settings ||= {}
    S.settings.storageMeta ||= {}
    S.settings.storageMeta.storageMode ||= 'local-only'
    S.settings.storageMeta.appVersion = VERSION
    S.rewardLedger ||= loadJSON('mt_reward_ledger', [])
    S.netWorthSnapshots ||= loadJSON('mt_net_worth_snapshots', [])
    S.investmentSnapshots ||= loadJSON('mt_investment_snapshots', [])
    S.transactions ||= []
    S.wallets ||= []
    S.recurring ||= []
    S.ccBenefits ||= {}
    S.marketPrices ||= {}
  }

  ensureV4State()

  const basePersist = typeof persist === 'function' ? persist : null
  persist = function v40Persist() {
    ensureV4State()
    try { App.recalculateWalletBalances?.({ save:false, recordSnapshot:false }) } catch (_) {}
    S.settings.storageMeta.lastSavedAt = localNow()
    S.settings.storageMeta.storageMode = 'local-only'
    if (basePersist) basePersist()
    else Storage.saveAll(S)
    saveJSON('mt_reward_ledger', S.rewardLedger || [])
    saveJSON('mt_net_worth_snapshots', S.netWorthSnapshots || [])
    saveJSON('mt_investment_snapshots', S.investmentSnapshots || [])
  }

  // ── Phase 1: Ledger balance source of truth ────────────────────────────────
  App._ledgerFlows = function() {
    const cash = {}, units = {}
    ;(S.transactions || []).forEach(tx => {
      const amt = Number(tx.amount || 0)
      const addCash = (id, value) => { if (id) cash[id] = (cash[id] || 0) + value }
      const addUnits = (id, value) => { if (id) units[id] = (units[id] || 0) + value }
      if (!amt && !Number(tx.unitsDelta || tx.units || 0)) return

      if (tx.type === 'income') addCash(tx.walletId, amt)
      else if (tx.type === 'expense') addCash(tx.walletId, -amt)
      else if (tx.type === 'transfer' || tx.type === 'cc_payment') { addCash(tx.walletId, -amt); addCash(tx.toWalletId, amt) }
      else if (tx.type === 'investment_buy') { addCash(tx.cashWalletId || tx.sourceWalletId, -amt); addUnits(tx.walletId, Number(tx.units || 0)) }
      else if (tx.type === 'investment_sell') { addCash(tx.cashWalletId || tx.sourceWalletId, amt); addUnits(tx.walletId, -Math.abs(Number(tx.units || 0))) }
      else if (tx.type === 'investment_adjust') addUnits(tx.walletId, Number(tx.unitsDelta || tx.units || 0))
    })
    return { cash, units }
  }

  App.ensureLedgerBaselines = function(force = false) {
    const flows = App._ledgerFlows()
    ;(S.wallets || []).forEach(w => {
      if (isInvestWallet(w)) {
        if (force || w.openingUnits === undefined) {
          w.openingUnits = Math.round((Number(w.units || 0) - (flows.units[w.id] || 0)) * 1e8) / 1e8
        }
      } else if (force || w.openingBalance === undefined) {
        w.openingBalance = Math.round((Number(w.balance || 0) - (flows.cash[w.id] || 0)) * 100) / 100
      }
    })
  }

  App._investmentUnitPriceV4 = function(w) {
    if (!w) return 0
    if (typeof App._investmentUnitPriceTHB === 'function') return Number(App._investmentUnitPriceTHB(w) || 0)
    return Number(w.manualPrice || 0)
  }

  App.recalculateWalletBalances = function({ save = false, recordSnapshot = false } = {}) {
    ensureV4State()
    App.ensureLedgerBaselines(false)
    const flows = App._ledgerFlows()
    ;(S.wallets || []).forEach(w => {
      if (isInvestWallet(w)) {
        const units = Math.round(((Number(w.openingUnits || 0) + (flows.units[w.id] || 0)) || 0) * 1e8) / 1e8
        w.units = units
        const price = App._investmentUnitPriceV4(w)
        w.balance = Math.round((units * price) * 100) / 100
      } else {
        w.balance = Math.round(((Number(w.openingBalance || 0) + (flows.cash[w.id] || 0)) || 0) * 100) / 100
      }
    })
    if (recordSnapshot) App.recordNetWorthSnapshot?.()
    if (save) persist()
  }

  App.recordNetWorthSnapshot = function() {
    ensureV4State()
    const nw = Calc.getNetWorth(S.wallets || [])
    const date = today()
    const row = { date, assets: Math.round((nw.assets || 0) * 100) / 100, debt: Math.round((nw.debt || 0) * 100) / 100, net: Math.round((nw.net || 0) * 100) / 100 }
    const list = (S.netWorthSnapshots || []).filter(x => x.date !== date)
    list.push(row)
    S.netWorthSnapshots = list.sort((a,b) => String(a.date).localeCompare(String(b.date))).slice(-370)
  }

  App.ensureLedgerBaselines(false)
  App.recalculateWalletBalances({ save:false, recordSnapshot:true })

  const baseRender = App.render?.bind(App)
  App.render = function v40Render() {
    try { App.recalculateWalletBalances({ save:false, recordSnapshot:false }) } catch (_) {}
    return baseRender?.()
  }

  // ── Phase 1: validation / import/export / backup status ───────────────────
  App.validateTransactionDraft = function(tx, { isEdit = false } = {}) {
    const amt = Number(tx.amount || 0)
    if (!tx.type) return 'ไม่พบประเภทรายการ'
    if (!amt || amt <= 0) return 'กรุณาระบุจำนวนเงินมากกว่า 0'
    if (!tx.walletId) return 'กรุณาเลือกกระเป๋าเงิน'
    const w = walletById(tx.walletId)
    if (!w) return 'ไม่พบกระเป๋าเงินที่เลือก'

    if (tx.type === 'transfer') {
      if (!tx.toWalletId) return 'กรุณาเลือกกระเป๋าปลายทาง'
      if (tx.toWalletId === tx.walletId) return 'กระเป๋าต้นทางและปลายทางต้องไม่เหมือนกัน'
      const to = walletById(tx.toWalletId)
      if (!to) return 'ไม่พบกระเป๋าปลายทาง'
      if (w.type === 'credit' || to.type === 'credit') return 'บัตรเครดิตต้องใช้เมนูชำระบัตร ไม่ใช่โอนเงิน'
      if (!isEdit && Number(w.balance || 0) < amt) return 'ยอดเงินในกระเป๋าต้นทางไม่เพียงพอ'
    } else if (tx.type === 'expense') {
      if (!tx.categoryId) return 'กรุณาเลือกหมวดหมู่รายจ่าย'
      if (!isEdit && w.type !== 'credit' && Number(w.balance || 0) < amt) return 'ยอดเงินในกระเป๋าไม่เพียงพอ'
      if (!isEdit && w.type === 'credit' && Number(w.limit || 0) > 0) {
        const available = Number(w.limit || 0) - Math.abs(Number(w.balance || 0))
        if (amt > available) return `วงเงินบัตรคงเหลือ ${money(Math.max(0, available))} ไม่พอ`
      }
    } else if (tx.type === 'income') {
      if (!tx.categoryId) return 'กรุณาเลือกหมวดหมู่รายรับ'
    }
    return null
  }

  App._rewardEstimateForTx = function(tx) {
    const card = walletById(tx.walletId)
    if (!card || card.type !== 'credit' || tx.type !== 'expense') return null
    const benefit = App._benefit?.(card.id) || S.ccBenefits?.[card.id] || {}
    const reward = Calc.getCardRewards ? Calc.getCardRewards([tx], benefit) : { points:0, cashback:0 }
    if (!reward.points && !reward.cashback) return null
    return { points: Number(reward.points || 0), cashback: Math.round(Number(reward.cashback || 0) * 100) / 100, status:'estimated', calculatedAt: localNow() }
  }

  function cleanTxFromDraft(id) {
    const tx = {
      id,
      type: S.tx.type,
      amount: Number(S.tx.amount || 0),
      walletId: S.tx.walletId,
      toWalletId: S.tx.toWalletId || undefined,
      categoryId: S.tx.categoryId || undefined,
      merchant: S.tx.type === 'transfer' ? '' : (S.tx.merchant || ''),
      note: S.tx.note || '',
      date: S.tx.date || today(),
      isRecurring: !!S.tx.isRecurring,
      isInstallment: !!S.tx.isInstallment,
    }
    const reward = App._rewardEstimateForTx(tx)
    if (reward) tx.rewardEstimate = reward
    return tx
  }

  App.saveTx = function v40SaveTx() {
    const isEdit = S.txMode === 'edit' && !!S.editingTxId
    const draft = { ...S.tx, amount:Number(S.tx.amount || 0) }
    const err = App.validateTransactionDraft(draft, { isEdit })
    if (err) { toast(err, 'error'); return }

    const months = parseInt(S.tx.installmentMonths || 0)
    if (!isEdit && S.tx.type === 'expense' && S.tx.isInstallment && months >= 2) {
      const total = Number(S.tx.amount || 0)
      const base = Math.floor((total / months) * 100) / 100
      let allocated = 0
      const groupId = Calc.genId()
      const baseDate = S.tx.date || today()
      const txs = []
      for (let i = 0; i < months; i++) {
        const amount = i === months - 1 ? Math.round((total - allocated) * 100) / 100 : base
        allocated += amount
        const tx = cleanTxFromDraft(Calc.genId())
        Object.assign(tx, {
          amount,
          date: addMonths(baseDate, i),
          installmentGroupId: groupId,
          installmentNo: i + 1,
          installmentMonths: months,
          installmentTotalAmount: total,
          scheduled: addMonths(baseDate, i) > today(),
        })
        const reward = App._rewardEstimateForTx(tx)
        if (reward) tx.rewardEstimate = reward
        txs.push(tx)
      }
      S.transactions.unshift(...txs)
      App._registerMerchantFromTx?.(txs[0])
      App.recalculateWalletBalances({ save:false, recordSnapshot:true })
      persist(); App.closeOverlay('overlay-add-tx'); App.render()
      toast(`สร้างรายการผ่อน ${months} งวดแล้ว`, 'success')
      S.txMode = 'add'; S.editingTxId = null
      return
    }

    const tx = cleanTxFromDraft(isEdit ? S.editingTxId : Calc.genId())
    if (isEdit) {
      const idx = S.transactions.findIndex(t => t.id === S.editingTxId)
      if (idx >= 0) S.transactions[idx] = { ...S.transactions[idx], ...tx }
    } else {
      S.transactions.unshift(tx)
    }
    App._registerMerchantFromTx?.(tx)
    App.recalculateWalletBalances({ save:false, recordSnapshot:true })
    persist(); App.closeOverlay('overlay-add-tx'); App.render()
    toast(isEdit ? 'แก้ไขรายการแล้ว' : 'บันทึกรายการแล้ว', 'success')
    S.txMode = 'add'; S.editingTxId = null
  }

  App.confirmDeleteTx = function v40ConfirmDeleteTx() {
    const tx = S.transactions.find(t => t.id === S.selectedTxId)
    if (!tx) return
    if (tx.installmentGroupId) {
      App.showConfirm({
        title:'ลบรายการผ่อน', danger:true,
        body:'ต้องการลบเฉพาะงวดนี้ หรือทั้งชุดผ่อน? หากต้องการลบทั้งชุดให้ใช้ปุ่ม “ลบทั้งชุด” ในหน้า Installments',
        confirmLabel:'ลบงวดนี้',
        onConfirm(){
          S.transactions = S.transactions.filter(t => t.id !== tx.id)
          S.deleteConfirm = false
          App.recalculateWalletBalances({ save:false, recordSnapshot:true })
          persist(); App.closeOverlay('overlay-tx-detail'); App.render(); toast('ลบงวดนี้แล้ว', 'success')
        }
      })
      return
    }
    S.transactions = S.transactions.filter(t => t.id !== tx.id)
    S.deleteConfirm = false
    App.recalculateWalletBalances({ save:false, recordSnapshot:true })
    persist(); App.closeOverlay('overlay-tx-detail'); App.render(); toast('ลบรายการแล้ว', 'success')
  }

  App.exportData = function v40ExportData() {
    ensureV4State()
    S.settings.storageMeta.lastExportedAt = localNow()
    const data = {
      exportedAt: S.settings.storageMeta.lastExportedAt,
      appVersion: VERSION,
      storageMode: 'local-only',
      transactions:S.transactions, wallets:S.wallets, categories:S.categories,
      budgets:S.budgets, recurring:S.recurring, merchants:S.merchants,
      ccBenefits:S.ccBenefits, incomeBudgets:S.incomeBudgets,
      marketPrices:S.marketPrices || {}, settings:S.settings,
      rewardLedger:S.rewardLedger || [], netWorthSnapshots:S.netWorthSnapshots || [], investmentSnapshots:S.investmentSnapshots || []
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `money-tracker-v4-backup-${today()}.json`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    persist(); App.renderMore?.(); toast('ส่งออกข้อมูลสำเร็จ', 'success')
  }

  App._validateImportPayload = function(data) {
    const errors = [], warnings = []
    if (!data || typeof data !== 'object') errors.push('ไฟล์ไม่ใช่ JSON object')
    if (!Array.isArray(data?.transactions)) errors.push('ไม่พบ transactions')
    if (!Array.isArray(data?.wallets)) errors.push('ไม่พบ wallets')
    if (errors.length) return { ok:false, errors, warnings, data:null }
    const walletIds = new Set(data.wallets.map(w => w.id).filter(Boolean))
    const validTypes = new Set(['income','expense','transfer','cc_payment','investment_buy','investment_sell','investment_adjust'])
    const transactions = data.transactions.filter(t => {
      if (!validTypes.has(t.type)) { warnings.push(`ข้ามรายการ type ผิด: ${t.type}`); return false }
      if (!(Number(t.amount) > 0) && !['investment_adjust'].includes(t.type)) { warnings.push('ข้ามรายการจำนวนเงินไม่ถูกต้อง'); return false }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.date || ''))) { warnings.push('ข้ามรายการวันที่ไม่ถูกต้อง'); return false }
      if (t.walletId && !walletIds.has(t.walletId)) { warnings.push('ข้ามรายการที่อ้างอิง wallet ไม่พบ'); return false }
      if (t.toWalletId && !walletIds.has(t.toWalletId)) { warnings.push('ข้ามรายการที่อ้างอิงปลายทางไม่พบ'); return false }
      return true
    })
    return { ok:true, errors, warnings, data:{ ...data, transactions } }
  }

  App.importData = function v40ImportData(input) {
    const file = input?.files?.[0]
    if (!file) return
    Storage.importJSON(file, raw => {
      const checked = App._validateImportPayload(raw)
      if (!checked.ok) { toast('นำเข้าไม่ได้: ' + checked.errors.join(', '), 'error'); if (input) input.value=''; return }
      const data = checked.data
      const summary = [
        `Wallets: ${data.wallets.length}`,
        `Transactions: ${data.transactions.length}`,
        `Recurring: ${(data.recurring || []).length}`,
        `Skipped/Warnings: ${checked.warnings.length}`
      ].join(' · ')
      App.showConfirm({
        title:'ตรวจสอบก่อนนำเข้า', danger:true,
        body:`ไฟล์นี้จะแทนที่ข้อมูลปัจจุบันทั้งหมด\n${summary}\nระบบจะเก็บ backup ก่อนนำเข้าไว้ให้กู้คืนได้`,
        confirmLabel:'นำเข้า',
        onConfirm(){
          try { localStorage.setItem('mt_pre_import_backup', JSON.stringify({ backedUpAt:localNow(), transactions:S.transactions, wallets:S.wallets, categories:S.categories, budgets:S.budgets, recurring:S.recurring, merchants:S.merchants, ccBenefits:S.ccBenefits, incomeBudgets:S.incomeBudgets, marketPrices:S.marketPrices || {}, settings:S.settings, rewardLedger:S.rewardLedger || [], netWorthSnapshots:S.netWorthSnapshots || [], investmentSnapshots:S.investmentSnapshots || [] })) } catch (_) {}
          S.transactions = data.transactions || []
          S.wallets = data.wallets || []
          S.categories = data.categories || S.categories
          S.budgets = data.budgets || []
          S.recurring = data.recurring || []
          S.merchants = data.merchants || []
          S.ccBenefits = data.ccBenefits || {}
          S.incomeBudgets = data.incomeBudgets || []
          S.marketPrices = data.marketPrices || {}
          S.settings = { ...(S.settings || {}), ...(data.settings || {}) }
          S.rewardLedger = data.rewardLedger || []
          S.netWorthSnapshots = data.netWorthSnapshots || []
          S.investmentSnapshots = data.investmentSnapshots || []
          ensureV4State(); App.ensureLedgerBaselines(true); App.recalculateWalletBalances({ save:false, recordSnapshot:true })
          persist(); applyTheme?.(); App.render(); toast(`นำเข้าสำเร็จ${checked.warnings.length ? ` · ข้าม/เตือน ${checked.warnings.length} จุด` : ''}`, 'success')
          if (input) input.value = ''
        },
        onCancel(){ if (input) input.value = '' }
      })
    }, err => { toast('นำเข้าล้มเหลว: ' + err, 'error'); if (input) input.value='' })
  }

  App.restorePreImportBackup = function() {
    const backup = loadJSON('mt_pre_import_backup', null)
    if (!backup) { toast('ยังไม่มี backup ก่อนนำเข้า', 'warn'); return }
    App.showConfirm({
      title:'กู้คืน Backup ก่อนนำเข้า', danger:true,
      body:`จะย้อนข้อมูลกลับไปก่อน import ล่าสุด (${backup.backedUpAt ? new Date(backup.backedUpAt).toLocaleString('th-TH') : 'ไม่ทราบเวลา'})`,
      confirmLabel:'กู้คืน',
      onConfirm(){
        Object.assign(S, {
          transactions:backup.transactions || [], wallets:backup.wallets || [], categories:backup.categories || S.categories,
          budgets:backup.budgets || [], recurring:backup.recurring || [], merchants:backup.merchants || [], ccBenefits:backup.ccBenefits || {},
          incomeBudgets:backup.incomeBudgets || [], marketPrices:backup.marketPrices || {}, settings:{ ...(S.settings || {}), ...(backup.settings || {}) },
          rewardLedger:backup.rewardLedger || [], netWorthSnapshots:backup.netWorthSnapshots || [], investmentSnapshots:backup.investmentSnapshots || []
        })
        ensureV4State(); App.recalculateWalletBalances({ save:false, recordSnapshot:true })
        persist(); applyTheme?.(); App.closeSubScreen?.(); App.render(); toast('กู้คืน backup แล้ว', 'success')
      }
    })
  }

  // ── Phase 2: Credit card statements + reward ledger ───────────────────────
  App.getCardStatement = function(cardId, refDate = today()) {
    const card = walletById(cardId)
    if (!card) return null
    const cycleDay = Number(card.cycleDay || 25)
    const dueDay = Number(card.dueDay || cycleDay)
    const [ry, rm, rd] = String(refDate).split('-').map(Number)
    let end = new Date(ry, rm - 1, clampDay(ry, rm - 1, cycleDay))
    if ((rd || 1) <= cycleDay) end = new Date(ry, rm - 2, clampDay(ry, rm - 2, cycleDay))
    const start = new Date(end); start.setMonth(start.getMonth() - 1); start.setDate(start.getDate() + 1)
    const endStr = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`
    const startStr = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`
    let due = new Date(end.getFullYear(), end.getMonth() + 1, clampDay(end.getFullYear(), end.getMonth() + 1, dueDay))
    const dueStr = `${due.getFullYear()}-${String(due.getMonth()+1).padStart(2,'0')}-${String(due.getDate()).padStart(2,'0')}`
    const id = `${cardId}:${startStr}:${endStr}`
    const purchases = (S.transactions || []).filter(t => t.type === 'expense' && t.walletId === cardId && t.date >= startStr && t.date <= endStr)
    const payments = (S.transactions || []).filter(t => t.type === 'cc_payment' && t.toWalletId === cardId && (t.statementId === id || (t.date > endStr && t.date <= dueStr)))
    const purchaseTotal = purchases.reduce((s,t) => s + Number(t.amount || 0), 0)
    const paidTotal = payments.reduce((s,t) => s + Number(t.amount || 0), 0)
    const balanceDue = Math.max(0, Math.round((purchaseTotal - paidTotal) * 100) / 100)
    const reward = Calc.getCardRewards ? Calc.getCardRewards(purchases, App._benefit?.(cardId) || {}) : { points:0, cashback:0 }
    return { id, cardId, start:startStr, end:endStr, dueDate:dueStr, purchases, payments, purchaseTotal, paidTotal, balanceDue, paid: balanceDue <= 0 && purchaseTotal > 0, reward }
  }

  App.saveCCPay = function v40SaveCCPay() {
    const sourceId = document.getElementById('cc-pay-wallet')?.value
    const amount = Number(document.getElementById('cc-pay-amount')?.value || 0)
    const card = walletById(S.payingCardId)
    const source = walletById(sourceId)
    if (!card || card.type !== 'credit') { toast('ไม่พบบัตรเครดิต', 'error'); return }
    if (!sourceId || !source) { toast('กรุณาเลือกกระเป๋าต้นทาง', 'error'); return }
    if (!amount || amount <= 0) { toast('กรุณาระบุยอดชำระ', 'error'); return }
    if (source.type !== 'credit' && Number(source.balance || 0) < amount) { toast('ยอดเงินในกระเป๋าต้นทางไม่เพียงพอ', 'error'); return }
    const owed = Math.abs(Number(card.balance || 0))
    if (owed > 0 && amount > owed + 0.01) { toast(`ยอดค้างชำระมี ${money(owed)} ไม่ควรชำระเกิน`, 'error'); return }
    const st = App.getCardStatement(card.id)
    const tx = { id:Calc.genId(), type:'cc_payment', amount, walletId:sourceId, toWalletId:card.id, date:today(), note:`ชำระ ${card.name}`, statementId:st?.id }
    S.transactions.unshift(tx)
    App.recalculateWalletBalances({ save:false, recordSnapshot:true })
    persist(); App.closeOverlay('overlay-cc-pay'); App.render(); toast(`ชำระ ${money(amount)} สำเร็จ`, 'success')
  }

  App.markCashbackReceived = function(cardId) {
    const st = App.getCardStatement(cardId)
    if (!st || !st.reward?.cashback) { toast('ไม่มี cashback ให้บันทึก', 'warn'); return }
    if ((S.rewardLedger || []).some(r => r.type === 'cashback_received' && r.statementId === st.id)) { toast('Statement นี้บันทึก cashback แล้ว', 'info'); return }
    const card = walletById(cardId)
    const tx = { id:Calc.genId(), type:'income', amount:st.reward.cashback, walletId:cardId, categoryId:undefined, merchant:'Cashback', note:`รับ Cashback ${card?.name || ''}`, date:today(), isRewardReceived:true, statementId:st.id }
    S.transactions.unshift(tx)
    S.rewardLedger.push({ id:Calc.genId(), type:'cashback_received', cardId, statementId:st.id, amount:st.reward.cashback, date:today() })
    App.recalculateWalletBalances({ save:false, recordSnapshot:true })
    persist(); App.openRewardLedgerScreen(cardId); toast('บันทึก cashback ที่ได้รับแล้ว', 'success')
  }

  App.openRewardLedgerScreen = function(cardId = '') {
    const cards = (S.wallets || []).filter(w => w.type === 'credit')
    const selected = cardId || cards[0]?.id
    const st = selected ? App.getCardStatement(selected) : null
    const rows = st?.purchases || []
    const received = (S.rewardLedger || []).filter(r => !selected || r.cardId === selected)
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>Reward Ledger</h2>${st?.reward?.cashback ? `<button class="btn btn-primary btn-sm" onclick="App.markCashbackReceived('${esc(selected)}')" style="width:auto">รับ Cashback</button>` : ''}</div>
      <div class="sub-scroll">
        <div class="form-group"><label class="form-label">เลือกบัตร</label><select class="form-input" onchange="App.openRewardLedgerScreen(this.value)">${cards.map(c => `<option value="${esc(c.id)}"${c.id===selected?' selected':''}>${esc(c.icon || '')} ${esc(c.name)}</option>`).join('')}</select></div>
        ${st ? `<div class="phase-card"><b>รอบ ${esc(st.start)} → ${esc(st.end)}</b><div class="phase-metric-grid"><div><span>คะแนนคาดการณ์</span><strong>${number(st.reward.points,0)}</strong></div><div><span>Cashback คาดการณ์</span><strong>${money(st.reward.cashback)}</strong></div></div><p>ระบบจะไม่ลง cashback เป็นรายรับอัตโนมัติ จนกว่าจะกด “รับ Cashback”</p></div>` : App._emptyState('💳','ยังไม่มีบัตรเครดิต','')}
        <div class="sec-title">รายการที่คำนวณสิทธิ์</div>
        <div class="card"><div style="padding:0 16px">${rows.length ? rows.map(t => App._txRow(t)).join('') : App._emptyState('🎁','ยังไม่มีรายการในรอบนี้','')}</div></div>
        <div class="sec-title">รับสิทธิ์แล้ว</div>
        <div class="card card-pad">${received.length ? received.map(r => `<div class="detail-row"><span>${esc(r.type)}</span><b>${money(r.amount || 0)}</b></div>`).join('') : '<div style="font-size:13px;color:var(--muted)">ยังไม่มีรายการรับจริง</div>'}</div>
      </div>`)
    setTimeout(() => App._bindTxRows?.('sub-screen'), 0)
  }

  const previousOpenCCDetail = App.openCCDetail?.bind(App)
  App.openCCDetail = function v40OpenCCDetail(cardId) {
    previousOpenCCDetail?.(cardId)
    setTimeout(() => {
      const root = document.querySelector('#sub-screen .cc-detail-screen') || document.querySelector('#sub-screen .sub-scroll')
      if (!root || root.querySelector('[data-v40-statement]')) return
      const st = App.getCardStatement(cardId)
      if (!st) return
      root.insertAdjacentHTML('afterbegin', `<div class="phase-card" data-v40-statement="1"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><b>Statement Center</b><p>รอบ ${esc(st.start)} → ${esc(st.end)} · Due ${esc(st.dueDate)}</p></div><span class="status-pill ${st.paid ? 'ok' : 'warn'}">${st.paid ? 'Paid' : 'Unpaid'}</span></div><div class="phase-metric-grid"><div><span>ยอดรูดในรอบ</span><strong>${money(st.purchaseTotal)}</strong></div><div><span>ชำระแล้ว</span><strong>${money(st.paidTotal)}</strong></div><div><span>คงเหลือตาม statement</span><strong>${money(st.balanceDue)}</strong></div></div><button class="btn btn-secondary btn-sm" onclick="App.openRewardLedgerScreen('${esc(cardId)}')" style="width:auto;margin-top:10px">ดู Reward Ledger</button></div>`)
    }, 0)
  }

  // ── Phase 3: Installment center + recurring due schedule ──────────────────
  App.getInstallmentGroups = function() {
    const map = {}
    ;(S.transactions || []).filter(t => t.installmentGroupId).forEach(t => {
      const g = map[t.installmentGroupId] ||= { id:t.installmentGroupId, rows:[], total:Number(t.installmentTotalAmount || 0), merchant:t.merchant || t.note || 'ผ่อนชำระ', walletId:t.walletId, categoryId:t.categoryId }
      g.rows.push(t); g.total = Math.max(g.total || 0, Number(t.installmentTotalAmount || 0))
    })
    return Object.values(map).map(g => {
      g.rows.sort((a,b) => Number(a.installmentNo || 0) - Number(b.installmentNo || 0))
      g.paid = g.rows.filter(t => String(t.date) <= today()).reduce((s,t) => s + Number(t.amount || 0), 0)
      g.remaining = g.rows.filter(t => String(t.date) > today()).reduce((s,t) => s + Number(t.amount || 0), 0)
      g.next = g.rows.find(t => String(t.date) > today()) || null
      return g
    }).sort((a,b) => String(a.next?.date || '9999').localeCompare(String(b.next?.date || '9999')))
  }

  App.deleteInstallmentGroup = function(groupId) {
    const g = App.getInstallmentGroups().find(x => x.id === groupId)
    if (!g) return
    App.showConfirm({ title:'ลบชุดผ่อน', danger:true, body:`ลบรายการผ่อน “${g.merchant}” ทั้ง ${g.rows.length} งวด?`, confirmLabel:'ลบทั้งชุด', onConfirm(){ S.transactions = S.transactions.filter(t => t.installmentGroupId !== groupId); App.recalculateWalletBalances({ save:false, recordSnapshot:true }); persist(); App.openInstallmentCenter(); toast('ลบชุดผ่อนแล้ว', 'success') } })
  }

  App.openInstallmentCenter = function() {
    const groups = App.getInstallmentGroups()
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>Installments</h2></div><div class="sub-scroll">${groups.length ? groups.map(g => { const cat = catById(g.categoryId); const w = walletById(g.walletId); return `<div class="phase-card"><div style="display:flex;justify-content:space-between;gap:10px"><div><b>${esc(g.merchant)}</b><p>${esc(w?.name || '')} · ${esc(cat?.label || '')}</p></div><button class="btn btn-secondary btn-sm" onclick="App.deleteInstallmentGroup('${esc(g.id)}')" style="width:auto">ลบทั้งชุด</button></div><div class="phase-metric-grid"><div><span>ทั้งหมด</span><strong>${money(g.total || g.paid + g.remaining)}</strong></div><div><span>จ่ายแล้ว/ถึงวันนี้</span><strong>${money(g.paid)}</strong></div><div><span>คงเหลืออนาคต</span><strong>${money(g.remaining)}</strong></div></div><p>งวดถัดไป: ${g.next ? `${esc(g.next.date)} · งวด ${g.next.installmentNo}/${g.next.installmentMonths}` : 'ครบแล้ว'}</p></div>` }).join('') : App._emptyState('🧾','ยังไม่มีรายการผ่อน','เพิ่มรายการจ่ายแล้วเลือก “ผ่อนชำระ”')}</div>`)
  }

  App._nextDueForRecurring = function(r, fromDate = today()) {
    if (r.nextDueDate) return r.nextDueDate
    const start = r.startDate || r.lastPostedAt || fromDate
    return String(start) < fromDate ? addDays(fromDate, 0) : start
  }

  App.openRecurringForm = function(id) {
    const r = id ? (S.recurring || []).find(x => x.id === id) : null
    const cats = [...(S.categories.expense || []), ...(S.categories.income || [])]
    const walletOpts = (S.wallets || []).filter(w => w.type !== 'credit' && !isInvestWallet(w)).map(w => `<option value="${esc(w.id)}"${r?.walletId===w.id?' selected':''}>${esc(w.icon || '')} ${esc(w.name)}</option>`).join('')
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.openRecurringScreen()">←</button><h2>${r?'แก้ไข':'เพิ่ม'}รายการประจำ</h2><button class="btn btn-primary btn-sm" onclick="App.saveRecurring('${esc(id || '')}')" style="width:auto">บันทึก</button></div><div class="sub-scroll"><div class="form-group"><label class="form-label">ชื่อรายการ</label><input class="form-input" id="rec-name" value="${esc(r?.name || '')}"></div><div class="form-group"><label class="form-label">ประเภท</label><select class="form-input" id="rec-type"><option value="expense"${(r?.type||'expense')==='expense'?' selected':''}>รายจ่าย</option><option value="income"${r?.type==='income'?' selected':''}>รายรับ</option></select></div><div class="form-group"><label class="form-label">จำนวนเงิน</label><input class="form-input" type="number" id="rec-amount" value="${esc(r?.amount || '')}"></div><div class="form-group"><label class="form-label">ทุกกี่วัน</label><input class="form-input" type="number" id="rec-days" value="${esc(r?.everyDays || 30)}"></div><div class="form-group"><label class="form-label">เริ่ม/ครบกำหนดถัดไป</label><input class="form-input" type="date" id="rec-next" value="${esc(r?.nextDueDate || r?.startDate || today())}"></div><div class="form-group"><label class="form-label">หมวดหมู่</label><select class="form-input" id="rec-cat">${cats.map(c => `<option value="${esc(c.id)}"${r?.categoryId===c.id?' selected':''}>${esc(c.icon || '')} ${esc(c.label)}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">กระเป๋าเงิน</label><select class="form-input" id="rec-wallet">${walletOpts}</select></div></div>`)
  }

  App.saveRecurring = function(id) {
    const name = document.getElementById('rec-name')?.value?.trim() || ''
    const type = document.getElementById('rec-type')?.value || 'expense'
    const amount = Number(document.getElementById('rec-amount')?.value || 0)
    const everyDays = parseInt(document.getElementById('rec-days')?.value || 30)
    const categoryId = document.getElementById('rec-cat')?.value || ''
    const walletId = document.getElementById('rec-wallet')?.value || ''
    const nextDueDate = document.getElementById('rec-next')?.value || today()
    const cat = catById(categoryId)
    if (!name || amount <= 0 || !walletId || !categoryId) { toast('กรุณากรอกข้อมูลรายการประจำให้ครบ', 'error'); return }
    const data = { name, type, amount, everyDays, categoryId, categoryName:cat?.label, icon:cat?.icon, color:cat?.color, walletId, nextDueDate, paused:false }
    if (id) { const idx = S.recurring.findIndex(r => r.id === id); if (idx >= 0) S.recurring[idx] = { ...S.recurring[idx], ...data } }
    else S.recurring.push({ id:Calc.genId(), ...data })
    persist(); App.openRecurringScreen(); toast('บันทึกรายการประจำแล้ว', 'success')
  }

  App.postRecurringNow = function(id) {
    const r = (S.recurring || []).find(x => x.id === id)
    if (!r) return
    const dueDate = r.nextDueDate || today()
    if ((S.transactions || []).some(t => t.sourceRecurringId === id && t.recurringDueDate === dueDate)) { toast('รายการนี้ถูกบันทึกสำหรับรอบนี้แล้ว', 'warn'); return }
    const tx = { id:Calc.genId(), type:r.type || 'expense', amount:Number(r.amount || 0), walletId:r.walletId, categoryId:r.categoryId, merchant:r.name, note:'🔁 รายการประจำ', date:dueDate <= today() ? today() : dueDate, isRecurring:true, sourceRecurringId:id, recurringDueDate:dueDate }
    const err = App.validateTransactionDraft(tx)
    if (err) { toast(err, 'error'); return }
    S.transactions.unshift(tx)
    r.lastPostedAt = today()
    r.nextDueDate = addDays(dueDate, Number(r.everyDays || 30))
    App.recalculateWalletBalances({ save:false, recordSnapshot:true })
    persist(); App.openRecurringScreen(); toast(`บันทึก “${r.name}” แล้ว`, 'success')
  }

  App.snoozeRecurring = function(id, days = 7) { const r = S.recurring.find(x => x.id === id); if (!r) return; r.nextDueDate = addDays(r.nextDueDate || today(), days); persist(); App.openRecurringScreen(); toast(`เลื่อน ${days} วันแล้ว`, 'info') }
  App.skipRecurring = function(id) { const r = S.recurring.find(x => x.id === id); if (!r) return; r.nextDueDate = addDays(r.nextDueDate || today(), Number(r.everyDays || 30)); persist(); App.openRecurringScreen(); toast('ข้ามรอบนี้แล้ว', 'info') }

  App.openRecurringScreen = function() {
    const rows = (S.recurring || []).slice().sort((a,b) => String(a.nextDueDate || '').localeCompare(String(b.nextDueDate || '')))
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>รายการประจำ</h2><button class="btn btn-primary btn-sm" onclick="App.openRecurringForm()" style="width:auto">+ เพิ่ม</button></div><div class="sub-scroll">${rows.length ? rows.map(r => { const due = r.nextDueDate || today(); const dueNow = due <= today(); return `<div class="recurring-item ${r.paused?'paused':''}"><div class="list-item-icon" style="background:${esc(r.color || '#2563EB')}20">${esc(r.icon || '🔁')}</div><div class="list-item-info"><div class="list-item-name">${esc(r.name)}</div><div class="list-item-sub">${money(r.amount)} · ${r.type === 'income' ? 'รายรับ' : 'รายจ่าย'} · Due ${esc(due)}${dueNow ? ' · ถึงกำหนด' : ''}</div></div><div class="recurring-actions"><button class="icon-btn" onclick="App.postRecurringNow('${esc(r.id)}')">✓</button><button class="icon-btn" onclick="App.snoozeRecurring('${esc(r.id)}',7)">+7</button><button class="icon-btn" onclick="App.skipRecurring('${esc(r.id)}')">ข้าม</button><button class="icon-btn" onclick="App.openRecurringForm('${esc(r.id)}')">✏️</button><button class="icon-btn" onclick="App.deleteRecurring('${esc(r.id)}')">🗑</button></div></div>` }).join('') : App._emptyState('🔁','ยังไม่มีรายการประจำ','')}</div>`)
  }

  // ── Phase 4: Reports split ────────────────────────────────────────────────
  function statsFor(month, mode = 'spending') {
    const txs = (S.transactions || []).filter(t => String(t.date || '').startsWith(month))
    let income = 0, expense = 0, transferOut = 0, ccPay = 0
    const byCategory = {}
    txs.forEach(t => {
      if (t.type === 'income') income += Number(t.amount || 0)
      if (t.type === 'expense') { expense += Number(t.amount || 0); byCategory[t.categoryId] = (byCategory[t.categoryId] || 0) + Number(t.amount || 0) }
      if (t.type === 'transfer') transferOut += Number(t.amount || 0)
      if (t.type === 'cc_payment') ccPay += Number(t.amount || 0)
    })
    const cashOut = expense + (mode === 'cashflow' ? ccPay : 0)
    return { income, expense, transferOut, ccPay, cashOut, net: income - cashOut, byCategory }
  }

  App.renderReports = function v40Reports() {
    if (!['spending','cashflow','budget','networth'].includes(S.rptView)) S.rptView = 'spending'
    const months = Calc.getMonths(6)
    document.getElementById('report-month-chips').innerHTML = months.map(m => `<button class="chip${m===S.rptMonth?' active':''}" onclick="App.setRptMonth('${m}')">${Calc.monthLabel(m)}</button>`).join('')
    document.getElementById('report-view-chips').innerHTML = [['spending','Spending'],['cashflow','Cash-flow'],['budget','Budget'],['networth','Net worth']].map(([v,l]) => `<button class="chip${S.rptView===v?' active':''}" onclick="App.setRptView('${v}')">${l}</button>`).join('')
    const spending = statsFor(S.rptMonth, 'spending')
    const cashflow = statsFor(S.rptMonth, 'cashflow')
    const nw = Calc.getNetWorth(S.wallets || [])
    let html = `<div class="phase-card"><b>Report Logic</b><p>Spending = รายจ่ายจริง ไม่รวมโอน/ชำระบัตร · Cash-flow = เงินสดเข้าออก รวมชำระบัตร</p><div class="phase-metric-grid"><div><span>Spending net</span><strong>${money(spending.income - spending.expense)}</strong></div><div><span>Cash-flow net</span><strong>${money(cashflow.net)}</strong></div><div><span>Net worth</span><strong>${money(nw.net)}</strong></div></div></div>`
    if (S.rptView === 'cashflow') {
      html += `<div class="report-summary-grid"><div class="card report-summary-card"><div class="report-summary-label">รายรับ</div><div class="report-summary-value c-income">${money(cashflow.income)}</div></div><div class="card report-summary-card"><div class="report-summary-label">รายจ่าย</div><div class="report-summary-value c-expense">${money(cashflow.expense)}</div></div><div class="card report-summary-card"><div class="report-summary-label">ชำระบัตร</div><div class="report-summary-value c-expense">${money(cashflow.ccPay)}</div></div></div>`
    } else if (S.rptView === 'budget') {
      const budget = Calc.getBudgetProgress(S.transactions, S.budgets, S.categories, S.rptMonth)
      html += `<div class="card card-pad">${budget.length ? budget.map(b => `<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;font-size:13px"><b>${esc(b.icon)} ${esc(b.label)}</b><span>${money(b.spent)} / ${money(b.monthlyLimit)}</span></div><div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100,b.pct)}%;background:${b.over?'var(--expense)':'var(--income)'}"></div></div></div>`).join('') : App._emptyState('💰','ยังไม่ได้ตั้งงบประมาณ','')}</div>`
    } else if (S.rptView === 'networth') {
      const snaps = (S.netWorthSnapshots || []).slice(-12)
      html += `<div class="card card-pad"><div style="font-weight:800;margin-bottom:12px">Net worth snapshots</div>${snaps.length ? snaps.map(s => `<div class="detail-row"><span>${esc(s.date)}</span><b class="${s.net>=0?'c-income':'c-expense'}">${money(s.net)}</b></div>`).join('') : '<div style="font-size:13px;color:var(--muted)">ยังไม่มี snapshot</div>'}</div>`
    } else {
      const data = Object.entries(spending.byCategory || {}).map(([id,value]) => ({ cat:catById(id), value })).sort((a,b) => b.value - a.value)
      html += `<div class="report-summary-grid"><div class="card report-summary-card"><div class="report-summary-label">รายรับ</div><div class="report-summary-value c-income">${money(spending.income)}</div></div><div class="card report-summary-card"><div class="report-summary-label">รายจ่ายจริง</div><div class="report-summary-value c-expense">${money(spending.expense)}</div></div><div class="card report-summary-card"><div class="report-summary-label">สุทธิ</div><div class="report-summary-value ${spending.net>=0?'c-income':'c-expense'}">${money(spending.net)}</div></div></div><div class="card"><div style="padding:0 20px">${data.length ? data.map(d => `<div class="detail-row"><span>${esc(d.cat?.icon || '📦')} ${esc(d.cat?.label || 'ไม่ระบุ')}</span><b>${money(d.value)}</b></div>`).join('') : App._emptyState('📊','ไม่มีข้อมูล','')}</div></div>`
    }
    document.getElementById('reports-content').innerHTML = html
  }

  // ── Phase 5: investment transactions ──────────────────────────────────────
  App.openInvestmentTxForm = function(walletId, mode = 'buy') {
    const w = walletById(walletId)
    if (!w || !isInvestWallet(w)) { toast('เลือกกระเป๋าการลงทุนก่อน', 'error'); return }
    const cashWallets = (S.wallets || []).filter(x => x.id !== walletId && x.type !== 'credit' && !isInvestWallet(x))
    const price = App._investmentUnitPriceV4(w) || Number(w.manualPrice || 0)
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.openWalletDetail('${esc(walletId)}')">←</button><h2>${mode==='buy'?'ซื้อ':mode==='sell'?'ขาย':'ปรับจำนวน'} ${esc(w.name)}</h2><button class="btn btn-primary btn-sm" onclick="App.saveInvestmentTx('${esc(walletId)}','${esc(mode)}')" style="width:auto">บันทึก</button></div><div class="sub-scroll"><div class="form-group"><label class="form-label">จำนวนหน่วย</label><input class="form-input" type="number" step="0.00000001" id="inv-units" placeholder="เช่น 0.1" oninput="App.previewInvestmentAmount()"></div><div class="form-group"><label class="form-label">ราคาต่อหน่วย</label><input class="form-input" type="number" step="0.01" id="inv-price" value="${esc(price || '')}" oninput="App.previewInvestmentAmount()"></div>${mode!=='adjust' ? `<div class="form-group"><label class="form-label">กระเป๋าเงินสด</label><select class="form-input" id="inv-cash-wallet">${cashWallets.map(c => `<option value="${esc(c.id)}">${esc(c.icon || '')} ${esc(c.name)} · ${money(c.balance)}</option>`).join('')}</select></div>` : ''}<div class="phase-card"><span>ยอดรวมโดยประมาณ</span><strong id="inv-preview">${money(0)}</strong></div><div class="form-group"><label class="form-label">หมายเหตุ</label><input class="form-input" id="inv-note" placeholder="เช่น DCA, ขายบางส่วน"></div></div>`)
  }
  App.previewInvestmentAmount = function() { const units = Number(document.getElementById('inv-units')?.value || 0); const price = Number(document.getElementById('inv-price')?.value || 0); const el = document.getElementById('inv-preview'); if (el) el.textContent = money(units * price) }
  App.saveInvestmentTx = function(walletId, mode) {
    const w = walletById(walletId)
    const units = Number(document.getElementById('inv-units')?.value || 0)
    const price = Number(document.getElementById('inv-price')?.value || 0)
    const amount = Math.round(units * price * 100) / 100
    const cashWalletId = document.getElementById('inv-cash-wallet')?.value || ''
    const note = document.getElementById('inv-note')?.value || ''
    if (!w || !units || units <= 0) { toast('กรุณาระบุจำนวนหน่วย', 'error'); return }
    if (mode !== 'adjust' && (!price || price <= 0 || !cashWalletId)) { toast('กรุณาระบุราคาและกระเป๋าเงินสด', 'error'); return }
    if (mode === 'buy') { const cash = walletById(cashWalletId); if (cash && Number(cash.balance || 0) < amount) { toast('ยอดเงินสดไม่เพียงพอ', 'error'); return } }
    if (mode === 'sell' && Number(w.units || 0) < units) { toast('จำนวน asset ไม่พอสำหรับขาย', 'error'); return }
    const tx = { id:Calc.genId(), type:mode==='buy'?'investment_buy':mode==='sell'?'investment_sell':'investment_adjust', walletId, cashWalletId:cashWalletId || undefined, amount: mode==='adjust' ? 0 : amount, units: mode==='adjust' ? undefined : units, unitsDelta: mode==='adjust' ? units : undefined, unitPrice:price, date:today(), note, merchant:w.name }
    S.transactions.unshift(tx)
    App.recalculateWalletBalances({ save:false, recordSnapshot:true })
    S.investmentSnapshots.push({ date:today(), walletId, units:S.wallets.find(x=>x.id===walletId)?.units || 0, value:S.wallets.find(x=>x.id===walletId)?.balance || 0, price })
    S.investmentSnapshots = S.investmentSnapshots.slice(-500)
    persist(); App.openWalletDetail(walletId); toast('บันทึกรายการลงทุนแล้ว', 'success')
  }

  const prevOpenWalletDetailV4 = App.openWalletDetail?.bind(App)
  App.openWalletDetail = function v40WalletDetail(id) {
    prevOpenWalletDetailV4?.(id)
    setTimeout(() => {
      const w = walletById(id)
      if (!w || !isInvestWallet(w)) return
      const root = document.querySelector('#sub-screen .sub-scroll')
      if (!root || root.querySelector('[data-v40-invest-actions]')) return
      root.insertAdjacentHTML('afterbegin', `<div class="phase-card" data-v40-invest-actions="1"><b>Investment Actions</b><p>${esc(App._marketText?.(w) || 'ใช้ราคาสำรองถ้าไม่มีราคาตลาด')}</p><div class="phase-action-row"><button class="btn btn-primary btn-sm" onclick="App.openInvestmentTxForm('${esc(id)}','buy')">ซื้อ</button><button class="btn btn-secondary btn-sm" onclick="App.openInvestmentTxForm('${esc(id)}','sell')">ขาย</button><button class="btn btn-secondary btn-sm" onclick="App.openInvestmentTxForm('${esc(id)}','adjust')">ปรับจำนวน</button></div></div>`)
    }, 0)
  }

  // ── Navigation surfaces in More + transaction filters ─────────────────────
  const prevRenderMoreV4 = App.renderMore?.bind(App)
  App.renderMore = function v40More() {
    prevRenderMoreV4?.()
    const content = document.getElementById('more-content')
    if (!content || content.querySelector('[data-v40-more]')) return
    const meta = S.settings?.storageMeta || {}
    const lastSaved = meta.lastSavedAt ? new Date(meta.lastSavedAt).toLocaleString('th-TH') : 'ยังไม่บันทึก'
    const lastExport = meta.lastExportedAt ? new Date(meta.lastExportedAt).toLocaleString('th-TH') : 'ยังไม่เคย export'
    const dataCard = [...content.querySelectorAll('.sec-title')].find(x => x.textContent.includes('ข้อมูล'))?.nextElementSibling
    const html = `<div data-v40-more="1"><div class="settings-row" onclick="App.restorePreImportBackup()"><div class="s-icon">🧯</div><div class="s-label">กู้คืน Backup ก่อน Import</div><div class="s-arrow">›</div></div><div class="settings-row" onclick="App.openRewardLedgerScreen()"><div class="s-icon">🎁</div><div class="s-label">Reward Ledger</div><div class="s-arrow">›</div></div><div class="settings-row" onclick="App.openInstallmentCenter()"><div class="s-icon">🧾</div><div class="s-label">Installment Center</div><div class="s-arrow">›</div></div></div>`
    if (dataCard) dataCard.insertAdjacentHTML('afterbegin', html)
    content.insertAdjacentHTML('afterbegin', `<div class="phase-card"><b>Storage status: Local only</b><p>ข้อมูลหลักอยู่ในเครื่องนี้ ไม่ใช่ cloud sync · Saved: ${esc(lastSaved)} · Export: ${esc(lastExport)}</p></div>`)
  }

  const prevRenderTxV4 = App.renderTransactions?.bind(App)
  App.renderTransactions = function v40Transactions() {
    prevRenderTxV4?.()
    const header = document.querySelector('#page-transactions .page-header')
    if (!header || document.getElementById('tx-advanced-filters')) return
    const walletOpts = `<option value="">ทุกกระเป๋า</option>` + (S.wallets || []).map(w => `<option value="${esc(w.id)}"${S.txWalletFilter===w.id?' selected':''}>${esc(w.icon || '')} ${esc(w.name)}</option>`).join('')
    const catOpts = `<option value="">ทุกหมวด</option>` + [...(S.categories.expense || []), ...(S.categories.income || [])].map(c => `<option value="${esc(c.id)}"${S.txCategoryFilter===c.id?' selected':''}>${esc(c.icon || '')} ${esc(c.label)}</option>`).join('')
    header.insertAdjacentHTML('beforeend', `<div id="tx-advanced-filters" class="phase-filter-row"><select class="form-input" onchange="S.txWalletFilter=this.value;App.renderTransactionsList()">${walletOpts}</select><select class="form-input" onchange="S.txCategoryFilter=this.value;App.renderTransactionsList()">${catOpts}</select><button class="btn btn-secondary btn-sm" onclick="S.txWalletFilter='';S.txCategoryFilter='';S.txAmtMin='';S.txAmtMax='';S.txSearch='';App.renderTransactions()" style="width:auto">Reset</button></div>`)
  }

  const prevRenderTxListV4 = App.renderTransactionsList?.bind(App)
  App.renderTransactionsList = function v40TxList() {
    prevRenderTxListV4?.()
    if (!S.txWalletFilter && !S.txCategoryFilter) return
    const q = (S.txSearch || '').toLowerCase()
    const amtMin = S.txAmtMin ? Number(S.txAmtMin) : null
    const amtMax = S.txAmtMax ? Number(S.txAmtMax) : null
    const filtered = (S.transactions || []).filter(t => {
      if (S.txMonth !== 'all' && !String(t.date || '').startsWith(S.txMonth)) return false
      if (S.txType !== 'all' && t.type !== S.txType) return false
      if (S.txWalletFilter && t.walletId !== S.txWalletFilter && t.toWalletId !== S.txWalletFilter && t.cashWalletId !== S.txWalletFilter) return false
      if (S.txCategoryFilter && t.categoryId !== S.txCategoryFilter) return false
      if (amtMin !== null && Number(t.amount || 0) < amtMin) return false
      if (amtMax !== null && Number(t.amount || 0) > amtMax) return false
      if (!q) return true
      const c = catById(t.categoryId), w = walletById(t.walletId), to = walletById(t.toWalletId)
      return [t.merchant,t.note,c?.label,w?.name,to?.name,t.date,String(t.amount||'')].some(v => String(v||'').toLowerCase().includes(q))
    }).sort((a,b) => String(b.date||'').localeCompare(String(a.date||'')))
    const byDate = {}; filtered.forEach(t => { (byDate[t.date] ||= []).push(t) })
    const dates = Object.keys(byDate).sort((a,b)=>b.localeCompare(a))
    const html = dates.length ? dates.map(date => `<div class="tx-date-header"><span>${esc(Calc.labelDate(date))}</span></div><div class="tx-group-card">${byDate[date].map(t => App._txRow(t)).join('')}</div>`).join('') : App._emptyState('📋','ไม่พบรายการ','ลองล้าง filter')
    const el = document.getElementById('tx-list-content'); if (el) el.innerHTML = html
    App._bindTxRows?.('tx-list-content')
  }

  // Make transaction rows readable for new types.
  const prevTxTypeLabelV4 = App._txTypeLabel?.bind(App)
  App._txTypeLabel = function(type) { return ({ investment_buy:'ซื้อสินทรัพย์', investment_sell:'ขายสินทรัพย์', investment_adjust:'ปรับจำนวนสินทรัพย์' })[type] || prevTxTypeLabelV4?.(type) || type }
  const prevTxRowV4 = App._txRow?.bind(App)
  App._txRow = function(tx) {
    if (!String(tx.type || '').startsWith('investment_')) return prevTxRowV4 ? prevTxRowV4(tx) : ''
    const w = walletById(tx.walletId), cash = walletById(tx.cashWalletId)
    const title = tx.type === 'investment_buy' ? `ซื้อ ${w?.name || 'Asset'}` : tx.type === 'investment_sell' ? `ขาย ${w?.name || 'Asset'}` : `ปรับจำนวน ${w?.name || 'Asset'}`
    return `<div class="tx-row tx-row--investment" data-txid="${esc(tx.id)}"><div class="tx-icon">📈</div><div class="tx-info"><div class="tx-title">${esc(title)}</div><div class="tx-sub"><span class="tx-meta-pill">${number(tx.units || tx.unitsDelta,4)} หน่วย</span>${cash ? `<span class="tx-meta-pill">${esc(cash.name)}</span>` : ''}</div></div><div class="tx-right"><div class="tx-amount">${money(tx.amount || 0)}</div><div class="tx-date">${esc(Calc.shortDate(tx.date))}</div></div></div>`
  }

  // Delete/archive protection: block hard delete referenced masters.
  App.deleteWallet = function(id) {
    const refs = (S.transactions || []).filter(t => t.walletId === id || t.toWalletId === id || t.cashWalletId === id).length + (S.recurring || []).filter(r => r.walletId === id).length
    if (refs > 0) { const w = walletById(id); if (w) { w.archived = true; persist(); App.closeOverlay('overlay-wallet-form'); App.render(); toast('มีรายการอ้างอิง จึง Archive กระเป๋าแทนการลบ', 'warn') } return }
    S.wallets = (S.wallets || []).filter(w => w.id !== id); persist(); App.closeOverlay('overlay-wallet-form'); App.render(); toast('ลบกระเป๋าแล้ว', 'success')
  }
  App.deleteCategory = function(id) {
    const type = S.catManageType || 'expense'
    const refs = (S.transactions || []).filter(t => t.categoryId === id).length + (S.recurring || []).filter(r => r.categoryId === id).length
    const cat = (S.categories[type] || []).find(c => c.id === id)
    if (refs > 0 && cat) { cat.archived = true; persist(); App.openCategoryScreen(type); toast('มีรายการอ้างอิง จึง Archive หมวดหมู่แทนการลบ', 'warn'); return }
    S.categories[type] = (S.categories[type] || []).filter(c => c.id !== id); persist(); App.openCategoryScreen(type); toast('ลบหมวดหมู่แล้ว', 'success')
  }

  // Backup reminder: local-only users should export regularly.
  App.maybeShowBackupReminder = function() {
    const last = S.settings?.storageMeta?.lastExportedAt
    const days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity
    if (days >= 14 && !sessionStorage.getItem('mt_backup_reminded')) { sessionStorage.setItem('mt_backup_reminded','1'); toast('ข้อมูลอยู่ในเครื่องนี้ แนะนำ Export backup เป็นระยะ', 'warn') }
  }

  try { persist() } catch (_) {}
  try { App.render() } catch (_) {}
  try { App.maybeShowBackupReminder() } catch (_) {}
})();

/* ============================================================
   V4.1 UX corrections on top of roadmap phases
   - Compact transaction filters
   - CC detail order + compact statement
   - Thai reward ledger + confirm/rollback cashback
   - Reports rollback to prior report layout
   - More page re-grouping
   - Robust merchant dropdown
   - Compact installment center
   - Recurring cadence prompt fields in add transaction
   ============================================================ */
;(function v41UxCorrections(){
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))
  const money = n => (typeof moneyFmt === 'function' ? moneyFmt(Number(n) || 0) : Calc.fmt(Number(n) || 0))
  const today = () => (typeof getTODAY === 'function' ? getTODAY() : new Date().toISOString().slice(0,10))
  const number = (n, digits = 4) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: digits })
  const walletById = id => (S.wallets || []).find(w => w.id === id) || null
  const catById = id => App._findCat?.(id) || null
  const isInvestWallet = w => ['gold','crypto','fcd'].includes(w?.type)

  function addDays(dateStr, days) {
    const [y,m,d] = String(dateStr || today()).split('-').map(Number)
    const dt = new Date(y, (m || 1) - 1, d || 1)
    dt.setDate(dt.getDate() + Number(days || 0))
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
  }

  function addMonths(dateStr, months) {
    const [y,m,d] = String(dateStr || today()).split('-').map(Number)
    const dt = new Date(y, (m || 1) - 1 + Number(months || 0), 1)
    const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate()
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(Math.min(d || 1, last)).padStart(2,'0')}`
  }

  function statementReceived(st) {
    return !!(st && (S.rewardLedger || []).some(r => r.type === 'cashback_received' && r.statementId === st.id))
  }

  function cleanupRewardReceivedForTx(tx) {
    if (!tx || !tx.isRewardReceived) return
    S.rewardLedger = (S.rewardLedger || []).filter(r => {
      if (tx.rewardLedgerId && r.id === tx.rewardLedgerId) return false
      if (tx.statementId && r.statementId === tx.statementId && r.type === 'cashback_received') return false
      return true
    })
  }

  // ── 1. Compact transaction search/filter header ───────────────────────────
  function currentTxFiltered() {
    const q = String(S.txSearch || '').toLowerCase()
    const amtMin = S.txAmtMin ? Number(S.txAmtMin) : null
    const amtMax = S.txAmtMax ? Number(S.txAmtMax) : null
    return (S.transactions || []).filter(t => {
      if (S.txMonth !== 'all' && !String(t.date || '').startsWith(S.txMonth)) return false
      if (S.txType !== 'all' && t.type !== S.txType) return false
      if (S.txWalletFilter && t.walletId !== S.txWalletFilter && t.toWalletId !== S.txWalletFilter && t.cashWalletId !== S.txWalletFilter) return false
      if (S.txCategoryFilter && t.categoryId !== S.txCategoryFilter) return false
      if (amtMin !== null && Number(t.amount || 0) < amtMin) return false
      if (amtMax !== null && Number(t.amount || 0) > amtMax) return false
      if (!q) return true
      const c = catById(t.categoryId), w = walletById(t.walletId), to = walletById(t.toWalletId)
      return [t.merchant,t.note,c?.label,w?.name,to?.name,t.date,String(t.amount||''), App._txTypeLabel?.(t.type)].some(v => String(v||'').toLowerCase().includes(q))
    }).sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')))
  }

  App.toggleTxFilterPanel = function() { S.txFilterOpen = !S.txFilterOpen; App.renderTransactions() }
  App.clearTxFilters = function() {
    S.txType = 'all'; S.txWalletFilter = ''; S.txCategoryFilter = ''; S.txAmtMin = ''; S.txAmtMax = ''; S.txSearch = ''; S.txFilterOpen = false
    App.renderTransactions()
  }

  App.renderTransactions = function v41RenderTransactions() {
    const months = Calc.getMonths(6)
    const header = document.querySelector('#page-transactions .page-header')
    if (!header) return
    const walletOpts = `<option value="">ทุกกระเป๋า</option>` + (S.wallets || []).map(w => `<option value="${esc(w.id)}"${S.txWalletFilter===w.id?' selected':''}>${esc(w.icon || '')} ${esc(w.name)}</option>`).join('')
    const catOpts = `<option value="">ทุกหมวด</option>` + [...(S.categories.expense || []), ...(S.categories.income || [])].map(c => `<option value="${esc(c.id)}"${S.txCategoryFilter===c.id?' selected':''}>${esc(c.icon || '')} ${esc(c.label)}</option>`).join('')
    const typeChips = [['all','ทั้งหมด'],['expense','จ่าย'],['income','รับ'],['transfer','โอน'],['cc_payment','ชำระบัตร']].map(([v,l]) => `<button class="chip mini${S.txType===v?' active':''}" onclick="App.setTxType('${v}')">${l}</button>`).join('')
    const monthChips = [[ 'all','ทุกเดือน' ], ...months.map(m => [m, Calc.monthLabel(m)])].map(([m,l]) => `<button class="chip mini${S.txMonth===m?' active':''}" onclick="App.setTxMonth('${m}')">${esc(l)}</button>`).join('')
    const activeCount = [S.txType && S.txType !== 'all', S.txWalletFilter, S.txCategoryFilter, S.txAmtMin, S.txAmtMax].filter(Boolean).length
    header.innerHTML = `<div class="tx-compact-top"><div><h1>รายการ</h1><p id="tx-compact-summary">กำลังคำนวณ...</p></div><button class="btn btn-secondary btn-sm tx-filter-toggle" onclick="App.toggleTxFilterPanel()">ตัวกรอง${activeCount ? ` (${activeCount})` : ''}</button></div>
      <div class="tx-compact-search"><input class="form-input" id="tx-search" placeholder="🔍 ค้นหารายการ ร้านค้า หมวด จำนวนเงิน" value="${esc(S.txSearch || '')}"></div>
      <div class="chips tx-month-row tx-month-row-compact" id="tx-month-chips">${monthChips}</div>
      <div id="tx-filter-panel" class="tx-filter-panel${S.txFilterOpen ? ' open' : ''}">
        <div class="chips tx-filter-row" id="tx-type-chips">${typeChips}</div>
        <div class="tx-filter-grid"><select class="form-input" onchange="S.txWalletFilter=this.value;App.renderTransactionsList()">${walletOpts}</select><select class="form-input" onchange="S.txCategoryFilter=this.value;App.renderTransactionsList()">${catOpts}</select></div>
        <div class="tx-filter-grid"><input class="form-input" type="number" inputmode="numeric" placeholder="฿ ต่ำสุด" value="${esc(S.txAmtMin || '')}" oninput="S.txAmtMin=this.value;App.renderTransactionsList()"><input class="form-input" type="number" inputmode="numeric" placeholder="฿ สูงสุด" value="${esc(S.txAmtMax || '')}" oninput="S.txAmtMax=this.value;App.renderTransactionsList()"></div>
        <button class="btn btn-secondary btn-sm" onclick="App.clearTxFilters()">ล้างตัวกรอง</button>
      </div>`
    const search = document.getElementById('tx-search')
    if (search) search.oninput = e => { S.txSearch = e.target.value; App.renderTransactionsList() }
    App.renderTransactionsList()
  }

  App.renderTransactionsList = function v41RenderTransactionsList() {
    const filtered = currentTxFiltered()
    const income = filtered.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount || 0), 0)
    const expense = filtered.filter(t => t.type === 'expense' || t.type === 'cc_payment').reduce((s,t) => s + Number(t.amount || 0), 0)
    const summary = document.getElementById('tx-compact-summary')
    if (summary) summary.innerHTML = `<span class="c-income">รับ ${money(income)}</span> · <span class="c-expense">จ่าย ${money(expense)}</span> · <span class="c-muted">${filtered.length} รายการ</span>`
    const byDate = {}; filtered.forEach(t => { (byDate[t.date] ||= []).push(t) })
    const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a))
    let html = dates.length ? '' : App._emptyState('📋','ไม่มีรายการ', S.txSearch ? 'ไม่พบผลการค้นหา' : 'ยังไม่มีรายการในช่วงนี้')
    dates.forEach(date => {
      const rows = byDate[date]
      const dayInc = rows.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount || 0), 0)
      const dayExp = rows.filter(t => t.type === 'expense' || t.type === 'cc_payment').reduce((s,t) => s + Number(t.amount || 0), 0)
      const label = Calc.labelDate ? Calc.labelDate(date) : date
      html += `<div class="tx-date-header"><span>${esc(label)}</span><div>${dayInc ? `<b class="c-income">+${money(dayInc)}</b>` : ''}${dayExp ? `<b class="c-expense">-${money(dayExp)}</b>` : ''}</div></div><div class="tx-group-card">${rows.map(t => App._txRow(t)).join('')}</div>`
    })
    const el = document.getElementById('tx-list-content')
    if (el) el.innerHTML = html
    App._bindTxRows?.('tx-list-content')
  }
  App.setTxMonth = function(m) { S.txMonth = m; App.renderTransactions() }
  App.setTxType = function(t) { S.txType = t; App.renderTransactionsList(); App.renderTransactions() }

  // ── 2/3. Credit-card detail order + compact statement + Thai reward ledger ──
  App.markCashbackReceived = function v41MarkCashbackReceived(cardId) {
    const st = App.getCardStatement?.(cardId)
    if (!st || !st.reward?.cashback) { toast('ไม่มี Cashback ให้บันทึก', 'warn'); return }
    if (statementReceived(st)) { toast('รอบบัญชีนี้บันทึก Cashback แล้ว', 'info'); return }
    const card = walletById(cardId)
    App.showConfirm({
      title:'ยืนยันรับ Cashback',
      body:`บันทึก Cashback ที่ได้รับจริง ${money(st.reward.cashback)} สำหรับบัตร ${card?.name || ''}?`,
      confirmLabel:'ยืนยันรับ',
      onConfirm(){
        const ledgerId = Calc.genId()
        const tx = { id:Calc.genId(), type:'income', amount:st.reward.cashback, walletId:cardId, categoryId:undefined, merchant:'Cashback', note:`รับ Cashback ${card?.name || ''}`, date:today(), isRewardReceived:true, statementId:st.id, rewardLedgerId:ledgerId }
        S.transactions.unshift(tx)
        S.rewardLedger ||= []
        S.rewardLedger.push({ id:ledgerId, type:'cashback_received', cardId, statementId:st.id, amount:st.reward.cashback, date:today(), txId:tx.id })
        App.recalculateWalletBalances?.({ save:false, recordSnapshot:true })
        persist(); App.openRewardLedgerScreen(cardId); toast('บันทึก Cashback ที่ได้รับแล้ว', 'success')
      }
    })
  }

  App.openRewardLedgerScreen = function v41RewardLedger(cardId = '') {
    const cards = (S.wallets || []).filter(w => w.type === 'credit')
    const selected = cardId || cards[0]?.id || ''
    const st = selected ? App.getCardStatement?.(selected) : null
    const receivedAlready = statementReceived(st)
    const rows = st?.purchases || []
    const received = (S.rewardLedger || []).filter(r => !selected || r.cardId === selected)
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>สมุดสิทธิประโยชน์</h2>${st?.reward?.cashback && !receivedAlready ? `<button class="btn btn-primary btn-sm" onclick="App.markCashbackReceived('${esc(selected)}')" style="width:auto">รับ Cashback</button>` : ''}</div>
      <div class="sub-scroll">
        <div class="form-group"><label class="form-label">เลือกบัตร</label><select class="form-input" onchange="App.openRewardLedgerScreen(this.value)">${cards.map(c => `<option value="${esc(c.id)}"${c.id===selected?' selected':''}>${esc(c.icon || '')} ${esc(c.name)}</option>`).join('')}</select></div>
        ${st ? `<div class="reward-summary-compact"><div><b>รอบ ${esc(st.start)} → ${esc(st.end)}</b><span>${receivedAlready ? 'รับ Cashback แล้ว' : 'ยังไม่รับ Cashback'}</span></div><div><strong>${number(st.reward.points,0)}</strong><span>คะแนน</span></div><div><strong>${money(st.reward.cashback)}</strong><span>Cashback</span></div></div>` : App._emptyState('💳','ยังไม่มีบัตรเครดิต','')}
        <div class="sec-title">รายการที่นำไปคำนวณ</div>
        <div class="card"><div style="padding:0 16px">${rows.length ? rows.map(t => App._txRow(t)).join('') : App._emptyState('🎁','ยังไม่มีรายการในรอบนี้','')}</div></div>
        <div class="sec-title">รับสิทธิ์แล้ว</div>
        <div class="card card-pad">${received.length ? received.map(r => `<div class="detail-row"><span>${r.type === 'cashback_received' ? 'รับ Cashback' : esc(r.type)} · ${esc(r.date || '')}</span><b>${money(r.amount || 0)}</b></div>`).join('') : '<div style="font-size:13px;color:var(--muted)">ยังไม่มีรายการรับจริง</div>'}</div>
      </div>`)
    setTimeout(() => App._bindTxRows?.('sub-screen'), 0)
  }

  App.openCCDetail = function v41OpenCCDetail(cardId) {
    const card = walletById(cardId)
    if (!card) return
    const benefit = App._benefit?.(cardId) || {}
    const period = Calc.getStatementPeriod(card.cycleDay || 25)
    const txns = (S.transactions || []).filter(t => t.walletId === cardId).sort((a,b) => String(b.date||'').localeCompare(String(a.date||''))).slice(0, 20)
    const allCycleTxns = (S.transactions || []).filter(t => t.walletId === cardId && t.type === 'expense' && t.date >= period.start && t.date <= period.end)
    const rewards = Calc.getCardRewards(allCycleTxns, benefit)
    const st = App.getCardStatement?.(cardId)
    const owed = Math.abs(Number(card.balance || 0))
    const usedPct = card.limit ? Math.min((owed / Number(card.limit || 1)) * 100, 100) : 0
    const due = card.dueDay ? Calc.getDueDate(card.dueDay) : null
    const installments = (App.getInstallmentGroups?.() || []).filter(g => g.walletId === cardId).slice(0, 3)
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>${esc(card.icon || '')} ${esc(card.name)}</h2><div style="display:flex;gap:6px"><button class="btn btn-secondary btn-sm" onclick="App.openWalletForm('${esc(cardId)}')" style="width:auto">แก้ไข</button><button class="btn btn-primary btn-sm" onclick="App.closeSubScreen();App.openCCPay('${esc(cardId)}')" style="width:auto">ชำระ</button></div></div>
      <div class="sub-scroll cc-detail-screen" data-card-id="${esc(cardId)}">
        <div class="cc-hero" style="background:linear-gradient(135deg,${esc(card.color || '#DC2626')},${esc(card.color || '#DC2626')}BB);color:#fff;border:0">
          <div style="font-size:12px;opacity:.75;margin-bottom:14px">รอบบัญชีตัดวันที่ ${card.cycleDay || 25} · ชำระวันที่ ${card.dueDay || '-'}</div>
          <div style="font-size:13px;opacity:.72;margin-bottom:4px">ยอดค้างชำระ</div><div class="big">${money(owed)}</div>
          ${card.limit ? `<div style="background:rgba(255,255,255,.2);border-radius:999px;height:8px;overflow:hidden;margin:14px 0 8px"><div style="height:100%;width:${usedPct}%;background:${usedPct > 80 ? '#FCA5A5' : 'rgba(255,255,255,.88)'};border-radius:999px"></div></div><div style="font-size:12px;opacity:.78">ใช้ ${usedPct.toFixed(0)}%${due ? ` · ครบ ${esc(due.dueStr)} (${due.daysLeft}ว.)` : ''}</div>` : ''}
        </div>
        ${st ? `<div class="statement-compact"><div class="statement-main"><div><b>Statement Center</b><span>รอบ ${esc(st.start)} → ${esc(st.end)} · Due ${esc(st.dueDate)}</span></div><em class="status-pill ${st.paid ? 'ok':'warn'}">${st.paid ? 'Paid':'Unpaid'}</em></div><div class="statement-metrics"><div><span>รูด</span><strong>${money(st.purchaseTotal)}</strong></div><div><span>ชำระ</span><strong>${money(st.paidTotal)}</strong></div><div><span>คงเหลือ</span><strong>${money(st.balanceDue)}</strong></div></div><button class="btn btn-secondary btn-sm" onclick="App.openRewardLedgerScreen('${esc(cardId)}')">สมุดสิทธิประโยชน์</button></div>` : ''}
        <div class="card card-pad" style="margin-bottom:12px"><div class="cc-detail-header"><div><div style="font-size:14px;font-weight:800">สิทธิประโยชน์รอบนี้</div><div style="font-size:12px;color:var(--muted)">${esc(period.start)} ถึง ${esc(period.end)}</div></div><button class="btn btn-secondary btn-sm" onclick="App.openCCBenefitScreen('${esc(cardId)}')" style="width:auto">ตั้งค่า</button></div><div class="reward-grid" style="margin-top:10px"><div class="reward-tile"><span>คะแนน</span><strong>${number(rewards.points,0)}</strong></div><div class="reward-tile"><span>Cashback</span><strong>${money(rewards.cashback)}</strong></div></div></div>
        ${App._sectionHeader ? App._sectionHeader('ผ่อนชำระ', 'ดูทั้งหมด', `App.openInstallmentCenter('${esc(cardId)}')`) : '<div class="sec-title">ผ่อนชำระ</div>'}
        <div class="card" style="margin-bottom:14px"><div style="padding:0 12px">${installments.length ? installments.map(g => `<div class="installment-mini-row"><div><b>${esc(g.merchant)}</b><span>${g.next ? `งวด ${g.next.installmentNo}/${g.next.installmentMonths} · ${esc(g.next.date)}` : 'ครบแล้ว'}</span></div><strong>${money(g.remaining || 0)}</strong></div>`).join('') : App._emptyState('🧾','ยังไม่มีรายการผ่อน','')}</div></div>
        ${App._sectionHeader ? App._sectionHeader('รายการล่าสุดของบัตรนี้') : '<div class="sec-title">รายการล่าสุดของบัตรนี้</div>'}
        <div class="card"><div style="padding:0 16px">${txns.length ? txns.map(tx => App._txRow(tx)).join('') : App._emptyState('📋','ยังไม่มีรายการ','')}</div></div>
      </div>`)
    setTimeout(() => App._bindTxRows?.('sub-screen'), 0)
  }

  // Add delete action into transaction details opened from a credit-card detail screen.
  App.deleteTxFromSub = function(id, backType = '', backId = '') {
    const tx = (S.transactions || []).find(t => t.id === id)
    if (!tx) return
    App.showConfirm({ title:'ลบรายการ', danger:true, body:`ยืนยันลบรายการ ${money(tx.amount)}?`, confirmLabel:'ลบ', onConfirm(){ cleanupRewardReceivedForTx(tx); S.transactions = (S.transactions || []).filter(t => t.id !== id); App.recalculateWalletBalances?.({ save:false, recordSnapshot:true }); persist(); if (backType === 'cc' && backId) App.openCCDetail(backId); else if (backType === 'wallet' && backId) App.openWalletDetail(backId); else App.closeSubScreen(); toast('ลบรายการแล้ว', 'success') } })
  }
  App.openTxDetailSub = function v41OpenTxDetailSub(id, backType, backId) {
    const tx = (S.transactions || []).find(t => t.id === id)
    if (!tx) return
    const back = backType === 'cc' ? `App.openCCDetail('${esc(backId)}')` : backType === 'wallet' ? `App.openWalletDetail('${esc(backId)}')` : 'App.closeSubScreen()'
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="${back}">←</button><h2>รายละเอียดรายการ</h2></div><div class="sub-scroll tx-detail-sub-screen">${App._txDetailRowsHtml(tx)}<div class="tx-action-grid"><button class="btn btn-secondary" onclick="App.closeSubScreen();App.openEditTx('${esc(tx.id)}')">✏️ แก้ไข</button><button class="btn btn-secondary" onclick="App.closeSubScreen();App.openDuplicateTx('${esc(tx.id)}')">⧉ ทำซ้ำ</button></div><button class="btn btn-outline mt-8" onclick="App.deleteTxFromSub('${esc(tx.id)}','${esc(backType || '')}','${esc(backId || '')}')">🗑 ลบรายการ</button>${tx.isRewardReceived ? '<div class="form-hint" style="margin-top:8px">เมื่อลบ Cashback ระบบจะ rollback ให้กลับไปรับ Cashback รอบนี้ได้อีกครั้ง</div>' : ''}</div>`)
  }

  const prevConfirmDeleteTx41 = App.confirmDeleteTx?.bind(App)
  App.confirmDeleteTx = function v41ConfirmDeleteTx() {
    const tx = (S.transactions || []).find(t => t.id === S.selectedTxId)
    if (tx?.isRewardReceived) cleanupRewardReceivedForTx(tx)
    prevConfirmDeleteTx41 ? prevConfirmDeleteTx41() : undefined
  }

  // ── 4. Reports rollback: restore previous report structure ─────────────────
  App.renderReports = function v41ReportsRollback() {
    if (!['expense','income','budget'].includes(S.rptView)) S.rptView = 'expense'
    const months = Calc.getMonths(6)
    const monthEl = document.getElementById('report-month-chips')
    const viewEl = document.getElementById('report-view-chips')
    if (monthEl) monthEl.innerHTML = months.map(m => `<button class="chip${m === S.rptMonth ? ' active' : ''}" onclick="App.setRptMonth('${m}')">${esc(Calc.monthLabel(m))}</button>`).join('')
    if (viewEl) viewEl.innerHTML = [['expense','รายจ่าย'],['income','รายรับ'],['budget','งบประมาณ']].map(([v,l]) => `<button class="chip${S.rptView === v ? ' active' : ''}" onclick="App.setRptView('${v}')">${l}</button>`).join('')
    const stats  = Calc.getMonthlyStats(S.transactions, S.rptMonth)
    const nw     = Calc.getNetWorth(S.wallets)
    const budget = Calc.getBudgetProgress(S.transactions, S.budgets, S.categories, S.rptMonth)
    let html = `<div class="report-summary-grid">${[['รายรับ', stats.income, 'var(--income)'], ['รายจ่าย', stats.expense, 'var(--expense)'], ['สุทธิ', stats.net, stats.net >= 0 ? 'var(--income)' : 'var(--expense)']].map(([l,v,c]) => `<div class="card report-summary-card"><div class="report-summary-label">${l}</div><div class="report-summary-value" style="color:${c}">${money(Math.abs(v))}</div></div>`).join('')}</div><div class="card card-pad nw-card" style="margin-bottom:16px"><div class="nw-label">ความมั่งคั่งสุทธิ</div><div class="nw-value ${nw.net>=0?'c-income':'c-expense'}">${nw.net<0?'-':''}${money(Math.abs(nw.net))}</div><div class="nw-detail"><span class="nw-item">สินทรัพย์ <strong class="c-income">${money(nw.assets)}</strong></span><span class="nw-item">หนี้ <strong class="c-expense">${money(nw.debt)}</strong></span></div></div>`
    if (S.rptView === 'budget') {
      html += `<div class="card card-pad">`
      if (!budget.length) html += App._emptyState('💰', 'ยังไม่ได้ตั้งงบประมาณ', 'ไปที่ เพิ่มเติม → งบประมาณ')
      else budget.forEach(b => { const barColor = b.over ? 'var(--expense)' : b.pct > 80 ? 'var(--amber)' : 'var(--income)'; html += `<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px"><span style="font-weight:600">${esc(b.icon)} ${esc(b.label)}</span><span style="color:${b.over?'var(--expense)':'var(--muted)'}">${money(b.spent)} / ${money(b.monthlyLimit)}</span></div><div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100,b.pct)}%;background:${barColor}"></div></div><div style="font-size:11px;color:${b.over?'var(--expense)':'var(--muted)'};margin-top:4px">${b.over ? `เกิน ${money(b.spent - b.monthlyLimit)}` : `เหลือ ${money(b.monthlyLimit - b.spent)}`}</div></div>` })
      html += `</div>`
    } else {
      const cats = S.categories[S.rptView] || []
      const data = cats.map(c => ({ label:c.icon, name:c.label, value:stats.byCategory[c.id] || 0, color:c.color, id:c.id })).filter(d => d.value > 0).sort((a,b) => b.value - a.value)
      const total = data.reduce((s,d) => s + d.value, 0); const max = Math.max(...data.map(d => d.value), 1)
      if (!data.length) html += App._emptyState('📊','ไม่มีข้อมูล','ยังไม่มีรายการในช่วงเวลานี้')
      else {
        html += `<div class="card card-pad" style="margin-bottom:12px"><div style="font-size:14px;font-weight:700;margin-bottom:16px">${S.rptView==='income'?'รายรับ':'รายจ่าย'}แยกหมวดหมู่</div><div class="bar-chart">`
        data.slice(0, 8).forEach(d => { const h = Math.max(4, (d.value / max) * 100); html += `<div class="bar-col"><div class="bar-fill" style="height:${h}%;background:${esc(d.color)}"></div><div class="bar-lbl">${esc(d.label)}</div></div>` })
        html += `</div></div><div class="card"><div style="padding:0 20px">`
        data.forEach(d => { const pct = total > 0 ? (d.value / total * 100) : 0; html += `<div class="detail-row"><div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0"><div style="width:36px;height:36px;border-radius:10px;background:${esc(d.color)}20;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${esc(d.label)}</div><div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600">${esc(d.name)}</div><div style="height:4px;border-radius:2px;background:var(--border);margin-top:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${esc(d.color)};border-radius:2px"></div></div></div></div><div style="text-align:right;flex-shrink:0;padding-left:12px"><div style="font-size:14px;font-weight:700">${money(d.value)}</div><div style="font-size:11px;color:var(--muted)">${pct.toFixed(1)}%</div></div></div>` })
        html += `</div></div>`
      }
    }
    const content = document.getElementById('reports-content')
    if (content) content.innerHTML = html
  }
  App.setRptView = function(v) { S.rptView = v; App.renderReports() }
  App.setRptMonth = function(m) { S.rptMonth = m; App.renderReports() }

  // ── 5. More page re-grouping ───────────────────────────────────────────────
  const prevRenderMore41 = App.renderMore?.bind(App)
  App.renderMore = function v41More() {
    prevRenderMore41?.()
    const content = document.getElementById('more-content')
    if (!content) return
    content.querySelector('[data-v40-more]')?.remove()
    content.querySelector('[data-v41-more-primary]')?.remove()
    ;[...content.querySelectorAll('.phase-card')].forEach(card => { if (card.textContent.includes('Storage status')) card.remove() })
    const meta = S.settings?.storageMeta || {}
    const lastSaved = meta.lastSavedAt ? new Date(meta.lastSavedAt).toLocaleString('th-TH') : 'ยังไม่บันทึก'
    const lastExport = meta.lastExportedAt ? new Date(meta.lastExportedAt).toLocaleString('th-TH') : 'ยังไม่เคย Export'
    const title = content.querySelector('div[style*="font-size:20px"]')
    const quick = `<div data-v41-more-primary><div class="sec-title">เครื่องมือหลัก</div><div class="card card-pad"><div class="settings-row" onclick="App.openRewardLedgerScreen()"><div class="s-icon">🎁</div><div class="s-label">สมุดสิทธิประโยชน์</div><div class="s-arrow">›</div></div><div class="settings-row" onclick="App.openInstallmentCenter()"><div class="s-icon">🧾</div><div class="s-label">ศูนย์ผ่อนชำระ</div><div class="s-arrow">›</div></div><div class="settings-row" onclick="App.openRecurringScreen()"><div class="s-icon">🔁</div><div class="s-label">รายการประจำ</div><div class="s-value">${(S.recurring || []).length} รายการ</div><div class="s-arrow">›</div></div></div><div class="sec-title">สถานะข้อมูล</div><div class="card card-pad"><div class="settings-row" onclick="App.restorePreImportBackup()"><div class="s-icon">🧯</div><div class="s-label">กู้คืน Backup ก่อน Import</div><div class="s-arrow">›</div></div><div class="settings-row"><div class="s-icon">💾</div><div class="s-label">Local only</div><div class="s-value">Saved: ${esc(lastSaved)} · Export: ${esc(lastExport)}</div></div></div></div>`
    if (title) title.insertAdjacentHTML('afterend', quick)
    // Remove old duplicate recurring row from lower finance section to keep menu short.
    const duplicateRecurring = [...content.querySelectorAll('.settings-row')].filter(r => r.textContent.includes('รายการประจำ')).slice(1)
    duplicateRecurring.forEach(r => r.remove())
  }

  // ── 6. Robust merchant dropdown: pick existing or type a new merchant ──────
  function ensureMerchantWrap(inp) {
    if (!inp) return null
    if (!inp.parentNode?.classList?.contains('mt-merchant-wrap')) {
      const wrap = document.createElement('div')
      wrap.className = 'mt-merchant-wrap'
      inp.parentNode.insertBefore(wrap, inp)
      wrap.appendChild(inp)
    }
    let dd = document.getElementById('mt-merchant-dropdown')
    if (!dd) {
      dd = document.createElement('div')
      dd.id = 'mt-merchant-dropdown'
      dd.className = 'hidden'
      inp.parentNode.appendChild(dd)
      dd.addEventListener('pointerdown', ev => {
        const item = ev.target.closest('[data-merchant-name]')
        if (!item) return
        ev.preventDefault()
        App._pickMerchant(item.dataset.merchantName || '')
      })
    }
    return dd
  }
  App._showMerchantDropdown = function(q = '') {
    const inp = document.getElementById('tx-merchant')
    const dd = ensureMerchantWrap(inp)
    if (!inp || !dd) return
    const norm = String(q || '').trim().toLowerCase()
    const matches = (S.merchants || []).filter(m => !norm || String(m.name || '').toLowerCase().includes(norm)).slice(0, 8)
    const exact = (S.merchants || []).some(m => String(m.name || '').toLowerCase() === norm)
    const createRow = norm && !exact ? `<div class="mt-merchant-item create" data-merchant-name="${esc(q)}"><span class="mmi-emoji">＋</span><span class="mmi-name">ใช้ “${esc(q)}” เป็นร้านใหม่</span></div>` : ''
    dd.innerHTML = matches.map(m => `<div class="mt-merchant-item" data-merchant-name="${esc(m.name)}"><span class="mmi-emoji">${esc(m.emoji || '🏪')}</span><span class="mmi-name">${esc(m.name)}</span></div>`).join('') + createRow
    dd.classList.toggle('hidden', !matches.length && !createRow)
  }
  App._pickMerchant = function(name) {
    S.tx.merchant = name || ''
    const inp = document.getElementById('tx-merchant')
    if (inp) inp.value = S.tx.merchant
    document.getElementById('mt-merchant-dropdown')?.classList.add('hidden')
  }
  const prevRenderDetail41 = App._renderAddTxDetail?.bind(App)
  App._renderAddTxDetail = function v41RenderAddTxDetail() {
    prevRenderDetail41?.()
    const inp = document.getElementById('tx-merchant')
    if (inp) {
      inp.removeAttribute('list')
      inp.setAttribute('autocomplete','off')
      inp.onfocus = () => App._showMerchantDropdown(inp.value)
      inp.oninput = () => { App._txField('merchant', inp.value); App._showMerchantDropdown(inp.value) }
      inp.onblur = () => setTimeout(() => document.getElementById('mt-merchant-dropdown')?.classList.add('hidden'), 160)
    }
    // Recurring fields inside transaction flow when user taps “ประจำ”.
    if (S.tx?.isRecurring && !document.getElementById('tx-recurring-options')) {
      const flagGroup = document.querySelector('.tx-flag-grid')?.closest('.form-group')
      if (flagGroup) {
        S.tx.recurringEveryDays ||= '30'
        S.tx.recurringNextDueDate ||= addDays(S.tx.date || today(), Number(S.tx.recurringEveryDays || 30))
        flagGroup.insertAdjacentHTML('afterend', `<div class="recurring-inline-options" id="tx-recurring-options"><div class="form-hint" style="margin-bottom:8px">แนะนำ: ถ้าเลือก “ประจำ” ควรกำหนดรอบและวันครบกำหนดถัดไป เพื่อให้ระบบสร้างรายการเตือนในเมนูรายการประจำได้ถูกต้อง</div><div class="tx-filter-grid"><div><label class="form-label">เกิดซ้ำทุกกี่วัน</label><input class="form-input" type="number" min="1" inputmode="numeric" value="${esc(S.tx.recurringEveryDays)}" oninput="App._txField('recurringEveryDays',this.value)"></div><div><label class="form-label">ครบกำหนดถัดไป</label><input class="form-input" type="date" value="${esc(S.tx.recurringNextDueDate)}" onchange="App._txField('recurringNextDueDate',this.value)"></div></div></div>`)
      }
    }
  }
  const prevToggleTxFlag41 = App._toggleTxFlag?.bind(App)
  App._toggleTxFlag = function v41ToggleFlag(key) {
    const wasOn = !!S.tx?.[key]
    prevToggleTxFlag41?.(key)
    if (key === 'isRecurring' && !wasOn && S.tx?.isRecurring) {
      S.tx.recurringEveryDays ||= '30'
      S.tx.recurringNextDueDate ||= addDays(S.tx.date || today(), 30)
      App._renderAddTxDetail()
    }
  }
  const prevSaveTx41 = App.saveTx?.bind(App)
  App.saveTx = function v41SaveTx() {
    const snapshot = { ...S.tx }
    const wasAdd = S.txMode !== 'edit'
    const before = (S.transactions || []).length
    prevSaveTx41?.()
    const saved = (S.transactions || [])[0]
    if (wasAdd && snapshot.isRecurring && saved && (S.transactions || []).length > before) {
      S.recurring ||= []
      const everyDays = Math.max(1, parseInt(snapshot.recurringEveryDays || 30))
      const nextDueDate = snapshot.recurringNextDueDate || addDays(saved.date || today(), everyDays)
      const name = snapshot.merchant || snapshot.note || 'รายการประจำ'
      const exists = S.recurring.some(r => r.name === name && r.walletId === snapshot.walletId && r.categoryId === snapshot.categoryId && Number(r.amount) === Number(snapshot.amount))
      if (!exists) {
        const c = catById(snapshot.categoryId)
        S.recurring.push({ id:Calc.genId(), name, type:snapshot.type || 'expense', amount:Number(snapshot.amount || 0), everyDays, nextDueDate, categoryId:snapshot.categoryId, categoryName:c?.label, icon:c?.icon, color:c?.color, walletId:snapshot.walletId, paused:false })
        persist()
      }
    }
  }

  // ── 7. Compact installment center ─────────────────────────────────────────
  App.openInstallmentCenter = function v41InstallmentCenter(cardId = '') {
    const groups = (App.getInstallmentGroups?.() || []).filter(g => !cardId || g.walletId === cardId)
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="${cardId ? `App.openCCDetail('${esc(cardId)}')` : 'App.closeSubScreen()'}">←</button><h2>ศูนย์ผ่อนชำระ</h2></div><div class="sub-scroll installment-compact-screen">${groups.length ? `<div class="compact-card-list">${groups.map(g => { const w = walletById(g.walletId); const next = g.next; return `<div class="installment-compact-row"><div class="icr-main"><b>${esc(g.merchant)}</b><span>${esc(w?.name || '')}${next ? ` · งวด ${next.installmentNo}/${next.installmentMonths} · ${esc(next.date)}` : ' · ครบแล้ว'}</span></div><div class="icr-amount"><strong>${money(g.remaining || 0)}</strong><span>เหลือ</span></div><button class="icon-btn" onclick="App.deleteInstallmentGroup('${esc(g.id)}')">🗑</button></div>` }).join('')}</div>` : App._emptyState('🧾','ยังไม่มีรายการผ่อน','เพิ่มรายการจ่ายแล้วเลือก “ผ่อนชำระ”')}</div>`)
  }

  try { if (S.page === 'transactions') App.renderTransactions() } catch (_) {}
  try { if (S.page === 'reports') App.renderReports() } catch (_) {}
  try { if (S.page === 'more') App.renderMore() } catch (_) {}
})();

/* ============================================================
   V4.2 UX fixes + installment group editing
   - transaction summary cards restored
   - iOS keyboard/select chrome guard
   - Thai statement labels/date formatting
   - reports AI advisor restored
   - installment group edit flow
   ============================================================ */
;(function v42UxAndInstallmentEdit(){
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))
  const money = n => (typeof moneyFmt === 'function' ? moneyFmt(Number(n) || 0) : Calc.fmt(Number(n) || 0))
  const today = () => (typeof getTODAY === 'function' ? getTODAY() : new Date().toISOString().slice(0,10))
  const number = (n, digits = 4) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: digits })
  const walletById = id => (S.wallets || []).find(w => w.id === id) || null
  const catById = id => App._findCat?.(id) || null
  const isInvestWallet = w => ['gold','crypto','fcd'].includes(w?.type)
  const TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

  function addMonths(dateStr, months) {
    const [y,m,d] = String(dateStr || today()).split('-').map(Number)
    const dt = new Date(y, (m || 1) - 1 + Number(months || 0), 1)
    const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate()
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(Math.min(d || 1, last)).padStart(2,'0')}`
  }

  function thaiDateShort(dateStr) {
    const [y,m,d] = String(dateStr || '').split('-').map(Number)
    if (!y || !m || !d) return esc(dateStr || '-')
    const yy = String((y + 543) % 100).padStart(2,'0')
    return `${d} ${TH_MONTHS[(m || 1) - 1] || ''} ${yy}`
  }

  function currentTxFilteredV42() {
    const q = String(S.txSearch || '').toLowerCase()
    const amtMin = S.txAmtMin ? Number(S.txAmtMin) : null
    const amtMax = S.txAmtMax ? Number(S.txAmtMax) : null
    return (S.transactions || []).filter(t => {
      if (S.txMonth !== 'all' && !String(t.date || '').startsWith(S.txMonth)) return false
      if (S.txType !== 'all' && t.type !== S.txType) return false
      if (S.txWalletFilter && t.walletId !== S.txWalletFilter && t.toWalletId !== S.txWalletFilter && t.cashWalletId !== S.txWalletFilter) return false
      if (S.txCategoryFilter && t.categoryId !== S.txCategoryFilter) return false
      if (amtMin !== null && Number(t.amount || 0) < amtMin) return false
      if (amtMax !== null && Number(t.amount || 0) > amtMax) return false
      if (!q) return true
      const c = catById(t.categoryId), w = walletById(t.walletId), to = walletById(t.toWalletId)
      return [t.merchant,t.note,c?.label,w?.name,to?.name,t.date,String(t.amount||''), App._txTypeLabel?.(t.type)].some(v => String(v||'').toLowerCase().includes(q))
    }).sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')))
  }

  // 1) Restore compact 2-column income/expense summary cards in Transactions.
  App.renderTransactions = function v42RenderTransactions() {
    const months = Calc.getMonths(6)
    const header = document.querySelector('#page-transactions .page-header')
    if (!header) return
    const walletOpts = `<option value="">ทุกกระเป๋า</option>` + (S.wallets || []).map(w => `<option value="${esc(w.id)}"${S.txWalletFilter===w.id?' selected':''}>${esc(w.icon || '')} ${esc(w.name)}</option>`).join('')
    const catOpts = `<option value="">ทุกหมวด</option>` + [...(S.categories.expense || []), ...(S.categories.income || [])].map(c => `<option value="${esc(c.id)}"${S.txCategoryFilter===c.id?' selected':''}>${esc(c.icon || '')} ${esc(c.label)}</option>`).join('')
    const typeChips = [['all','ทั้งหมด'],['expense','จ่าย'],['income','รับ'],['transfer','โอน'],['cc_payment','ชำระบัตร']].map(([v,l]) => `<button class="chip mini${S.txType===v?' active':''}" onclick="App.setTxType('${v}')">${l}</button>`).join('')
    const monthChips = [[ 'all','ทุกเดือน' ], ...months.map(m => [m, Calc.monthLabel(m)])].map(([m,l]) => `<button class="chip mini${S.txMonth===m?' active':''}" onclick="App.setTxMonth('${m}')">${esc(l)}</button>`).join('')
    const activeCount = [S.txType && S.txType !== 'all', S.txWalletFilter, S.txCategoryFilter, S.txAmtMin, S.txAmtMax].filter(Boolean).length
    header.innerHTML = `<div class="tx-compact-top"><div><h1>รายการ</h1><p id="tx-compact-summary">กำลังคำนวณ...</p></div><button class="btn btn-secondary btn-sm tx-filter-toggle" onclick="App.toggleTxFilterPanel()">ตัวกรอง${activeCount ? ` (${activeCount})` : ''}</button></div>
      <div class="tx-summary-cards tx-summary-cards-compact"><div class="tx-summary-card income"><span>รายรับ</span><strong id="tx-income-total">${money(0)}</strong></div><div class="tx-summary-card expense"><span>รายจ่าย</span><strong id="tx-expense-total">${money(0)}</strong></div></div>
      <div class="tx-compact-search"><input class="form-input" id="tx-search" placeholder="🔍 ค้นหารายการ ร้านค้า หมวด จำนวนเงิน" value="${esc(S.txSearch || '')}"></div>
      <div class="chips tx-month-row tx-month-row-compact" id="tx-month-chips">${monthChips}</div>
      <div id="tx-filter-panel" class="tx-filter-panel${S.txFilterOpen ? ' open' : ''}">
        <div class="chips tx-filter-row" id="tx-type-chips">${typeChips}</div>
        <div class="tx-filter-grid"><select class="form-input" onchange="S.txWalletFilter=this.value;App.renderTransactionsList()">${walletOpts}</select><select class="form-input" onchange="S.txCategoryFilter=this.value;App.renderTransactionsList()">${catOpts}</select></div>
        <div class="tx-filter-grid"><input class="form-input" type="number" inputmode="numeric" placeholder="฿ ต่ำสุด" value="${esc(S.txAmtMin || '')}" oninput="S.txAmtMin=this.value;App.renderTransactionsList()"><input class="form-input" type="number" inputmode="numeric" placeholder="฿ สูงสุด" value="${esc(S.txAmtMax || '')}" oninput="S.txAmtMax=this.value;App.renderTransactionsList()"></div>
        <button class="btn btn-secondary btn-sm" onclick="App.clearTxFilters()">ล้างตัวกรอง</button>
      </div>`
    const search = document.getElementById('tx-search')
    if (search) search.oninput = e => { S.txSearch = e.target.value; App.renderTransactionsList() }
    App.renderTransactionsList()
  }

  App.renderTransactionsList = function v42RenderTransactionsList() {
    const filtered = currentTxFilteredV42()
    const income = filtered.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount || 0), 0)
    const expense = filtered.filter(t => t.type === 'expense' || t.type === 'cc_payment').reduce((s,t) => s + Number(t.amount || 0), 0)
    const summary = document.getElementById('tx-compact-summary')
    if (summary) summary.textContent = `${filtered.length} รายการ`
    const incEl = document.getElementById('tx-income-total'), expEl = document.getElementById('tx-expense-total')
    if (incEl) incEl.textContent = '+' + money(income)
    if (expEl) expEl.textContent = '-' + money(expense)
    const byDate = {}; filtered.forEach(t => { (byDate[t.date] ||= []).push(t) })
    const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a))
    let html = dates.length ? '' : App._emptyState('📋','ไม่มีรายการ', S.txSearch ? 'ไม่พบผลการค้นหา' : 'ยังไม่มีรายการในช่วงนี้')
    dates.forEach(date => {
      const rows = byDate[date]
      const dayInc = rows.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount || 0), 0)
      const dayExp = rows.filter(t => t.type === 'expense' || t.type === 'cc_payment').reduce((s,t) => s + Number(t.amount || 0), 0)
      const label = Calc.labelDate ? Calc.labelDate(date) : date
      html += `<div class="tx-date-header"><span>${esc(label)}</span><div>${dayInc ? `<b class="c-income">+${money(dayInc)}</b>` : ''}${dayExp ? `<b class="c-expense">-${money(dayExp)}</b>` : ''}</div></div><div class="tx-group-card">${rows.map(t => App._txRow(t)).join('')}</div>`
    })
    const el = document.getElementById('tx-list-content')
    if (el) el.innerHTML = html
    App._bindTxRows?.('tx-list-content')
  }
  App.setTxMonth = function(m) { S.txMonth = m; App.renderTransactions() }
  App.setTxType = function(t) { S.txType = t; App.renderTransactions() }

  // 2/4) iOS keyboard/select guard: hide nav/FAB while form controls are active.
  function isFormControl(el) { return !!el && (el.matches?.('input, textarea, select, [contenteditable="true"]')) }
  function syncKeyboardClass(force) {
    const active = isFormControl(document.activeElement)
    const vv = window.visualViewport
    const keyboardByViewport = vv ? (window.innerHeight - vv.height > 120) : false
    document.body.classList.toggle('keyboard-open', force ?? (active || keyboardByViewport))
  }
  document.addEventListener('focusin', ev => { if (isFormControl(ev.target)) syncKeyboardClass(true) }, true)
  document.addEventListener('focusout', () => setTimeout(() => syncKeyboardClass(false), 180), true)
  window.visualViewport?.addEventListener('resize', () => syncKeyboardClass(), { passive:true })
  window.visualViewport?.addEventListener('scroll', () => syncKeyboardClass(), { passive:true })

  // 5) Thai statement format and labels.
  function statusText(st) { return st?.paid ? 'ชำระแล้ว' : 'ค้างชำระ' }
  function statementHtml(cardId, st) {
    if (!st) return ''
    return `<div class="statement-compact statement-compact-th"><div class="statement-main"><div><b>สรุปรอบบัตรเครดิต</b><span>รอบ ${thaiDateShort(st.start)} – ${thaiDateShort(st.end)}</span><span>วันกำหนดชำระ ${thaiDateShort(st.dueDate)}</span></div><em class="status-pill ${st.paid ? 'ok':'warn'}">${statusText(st)}</em></div><div class="statement-metrics"><div><span>ยอดใช้ในรอบ</span><strong>${money(st.purchaseTotal)}</strong></div><div><span>ชำระแล้ว</span><strong>${money(st.paidTotal)}</strong></div><div><span>ค้างชำระ</span><strong>${money(st.balanceDue)}</strong></div></div><button class="btn btn-secondary btn-sm" onclick="App.openRewardLedgerScreen('${esc(cardId)}')">สมุดสิทธิประโยชน์</button></div>`
  }

  App.openCCDetail = function v42OpenCCDetail(cardId) {
    const card = walletById(cardId)
    if (!card) return
    const benefit = App._benefit?.(cardId) || {}
    const period = Calc.getStatementPeriod(card.cycleDay || 25)
    const txns = (S.transactions || []).filter(t => t.walletId === cardId).sort((a,b) => String(b.date||'').localeCompare(String(a.date||''))).slice(0, 20)
    const allCycleTxns = (S.transactions || []).filter(t => t.walletId === cardId && t.type === 'expense' && t.date >= period.start && t.date <= period.end)
    const rewards = Calc.getCardRewards(allCycleTxns, benefit)
    const st = App.getCardStatement?.(cardId)
    const owed = Math.abs(Number(card.balance || 0))
    const usedPct = card.limit ? Math.min((owed / Number(card.limit || 1)) * 100, 100) : 0
    const due = card.dueDay ? Calc.getDueDate(card.dueDay) : null
    const installments = (App.getInstallmentGroups?.() || []).filter(g => g.walletId === cardId).slice(0, 3)
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>${esc(card.icon || '')} ${esc(card.name)}</h2><div style="display:flex;gap:6px"><button class="btn btn-secondary btn-sm" onclick="App.openWalletForm('${esc(cardId)}')" style="width:auto">แก้ไข</button><button class="btn btn-primary btn-sm" onclick="App.closeSubScreen();App.openCCPay('${esc(cardId)}')" style="width:auto">ชำระ</button></div></div>
      <div class="sub-scroll cc-detail-screen" data-card-id="${esc(cardId)}">
        <div class="cc-hero" style="background:linear-gradient(135deg,${esc(card.color || '#DC2626')},${esc(card.color || '#DC2626')}BB);color:#fff;border:0">
          <div style="font-size:12px;opacity:.75;margin-bottom:14px">รอบบัญชีตัดวันที่ ${card.cycleDay || 25} · ชำระวันที่ ${card.dueDay || '-'}</div>
          <div style="font-size:13px;opacity:.72;margin-bottom:4px">ยอดค้างชำระ</div><div class="big">${money(owed)}</div>
          ${card.limit ? `<div style="background:rgba(255,255,255,.2);border-radius:999px;height:8px;overflow:hidden;margin:14px 0 8px"><div style="height:100%;width:${usedPct}%;background:${usedPct > 80 ? '#FCA5A5' : 'rgba(255,255,255,.88)'};border-radius:999px"></div></div><div style="font-size:12px;opacity:.78">ใช้ ${usedPct.toFixed(0)}%${due ? ` · ครบ ${esc(due.dueStr)} (${due.daysLeft}ว.)` : ''}</div>` : ''}
        </div>
        ${statementHtml(cardId, st)}
        <div class="card card-pad" style="margin-bottom:12px"><div class="cc-detail-header"><div><div style="font-size:14px;font-weight:800">สิทธิประโยชน์รอบนี้</div><div style="font-size:12px;color:var(--muted)">${thaiDateShort(period.start)} ถึง ${thaiDateShort(period.end)}</div></div><button class="btn btn-secondary btn-sm" onclick="App.openCCBenefitScreen('${esc(cardId)}')" style="width:auto">ตั้งค่า</button></div><div class="reward-grid" style="margin-top:10px"><div class="reward-tile"><span>คะแนน</span><strong>${number(rewards.points,0)}</strong></div><div class="reward-tile"><span>เงินคืน</span><strong>${money(rewards.cashback)}</strong></div></div></div>
        ${App._sectionHeader ? App._sectionHeader('ผ่อนชำระ', 'ดูทั้งหมด', `App.openInstallmentCenter('${esc(cardId)}')`) : '<div class="sec-title">ผ่อนชำระ</div>'}
        <div class="card" style="margin-bottom:14px"><div style="padding:0 12px">${installments.length ? installments.map(g => `<div class="installment-mini-row"><div><b>${esc(g.merchant)}</b><span>${g.next ? `งวด ${g.next.installmentNo}/${g.next.installmentMonths} · ${thaiDateShort(g.next.date)}` : 'ครบแล้ว'}</span></div><strong>${money(g.remaining || 0)}</strong></div>`).join('') : App._emptyState('🧾','ยังไม่มีรายการผ่อน','')}</div></div>
        ${App._sectionHeader ? App._sectionHeader('รายการล่าสุดของบัตรนี้') : '<div class="sec-title">รายการล่าสุดของบัตรนี้</div>'}
        <div class="card"><div style="padding:0 16px">${txns.length ? txns.map(tx => App._txRow(tx)).join('') : App._emptyState('📋','ยังไม่มีรายการ','')}</div></div>
      </div>`)
    setTimeout(() => App._bindTxRows?.('sub-screen'), 0)
  }

  const prevRewardScreenV42 = App.openRewardLedgerScreen?.bind(App)
  App.openRewardLedgerScreen = function v42RewardLedger(cardId = '') {
    const cards = (S.wallets || []).filter(w => w.type === 'credit')
    const selected = cardId || cards[0]?.id || ''
    const st = selected ? App.getCardStatement?.(selected) : null
    const receivedAlready = !!(st && (S.rewardLedger || []).some(r => r.type === 'cashback_received' && r.statementId === st.id))
    const rows = st?.purchases || []
    const received = (S.rewardLedger || []).filter(r => !selected || r.cardId === selected)
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>สมุดสิทธิประโยชน์</h2>${st?.reward?.cashback && !receivedAlready ? `<button class="btn btn-primary btn-sm" onclick="App.markCashbackReceived('${esc(selected)}')" style="width:auto">รับเงินคืน</button>` : ''}</div>
      <div class="sub-scroll">
        <div class="form-group"><label class="form-label">เลือกบัตร</label><select class="form-input" onchange="App.openRewardLedgerScreen(this.value)">${cards.map(c => `<option value="${esc(c.id)}"${c.id===selected?' selected':''}>${esc(c.icon || '')} ${esc(c.name)}</option>`).join('')}</select></div>
        ${st ? `<div class="reward-summary-compact"><div><b>รอบ ${thaiDateShort(st.start)} – ${thaiDateShort(st.end)}</b><span>${receivedAlready ? 'รับเงินคืนแล้ว' : 'ยังไม่รับเงินคืน'}</span><span>วันกำหนดชำระ ${thaiDateShort(st.dueDate)}</span></div><div><strong>${number(st.reward.points,0)}</strong><span>คะแนน</span></div><div><strong>${money(st.reward.cashback)}</strong><span>เงินคืน</span></div></div>` : App._emptyState('💳','ยังไม่มีบัตรเครดิต','')}
        <div class="sec-title">รายการที่นำไปคำนวณ</div>
        <div class="card"><div style="padding:0 16px">${rows.length ? rows.map(t => App._txRow(t)).join('') : App._emptyState('🎁','ยังไม่มีรายการในรอบนี้','')}</div></div>
        <div class="sec-title">รับสิทธิ์แล้ว</div>
        <div class="card card-pad">${received.length ? received.map(r => `<div class="detail-row"><span>${r.type === 'cashback_received' ? 'รับเงินคืน' : esc(r.type)} · ${thaiDateShort(r.date || '')}</span><b>${money(r.amount || 0)}</b></div>`).join('') : '<div style="font-size:13px;color:var(--muted)">ยังไม่มีรายการรับจริง</div>'}</div>
      </div>`)
    setTimeout(() => App._bindTxRows?.('sub-screen'), 0)
  }

  App.openRecurringScreen = function v42RecurringScreen() {
    const rows = (S.recurring || []).slice().sort((a,b) => String(a.nextDueDate || '').localeCompare(String(b.nextDueDate || '')))
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>รายการประจำ</h2><button class="btn btn-primary btn-sm" onclick="App.openRecurringForm()" style="width:auto">+ เพิ่ม</button></div><div class="sub-scroll">${rows.length ? rows.map(r => { const due = r.nextDueDate || today(); const dueNow = due <= today(); return `<div class="recurring-item ${r.paused?'paused':''}"><div class="list-item-icon" style="background:${esc(r.color || '#2563EB')}20">${esc(r.icon || '🔁')}</div><div class="list-item-info"><div class="list-item-name">${esc(r.name)}</div><div class="list-item-sub">${money(r.amount)} · ${r.type === 'income' ? 'รายรับ' : 'รายจ่าย'} · ครบกำหนด ${thaiDateShort(due)}${dueNow ? ' · ถึงกำหนดแล้ว' : ''}</div></div><div class="recurring-actions"><button class="icon-btn" onclick="App.postRecurringNow('${esc(r.id)}')">✓</button><button class="icon-btn" onclick="App.snoozeRecurring('${esc(r.id)}',7)">+7</button><button class="icon-btn" onclick="App.skipRecurring('${esc(r.id)}')">ข้าม</button><button class="icon-btn" onclick="App.openRecurringForm('${esc(r.id)}')">✏️</button><button class="icon-btn" onclick="App.deleteRecurring('${esc(r.id)}')">🗑</button></div></div>` }).join('') : App._emptyState('🔁','ยังไม่มีรายการประจำ','')}</div>`)
  }

  // 6) Restore AI financial advisor card on the rolled-back Reports screen.
  const prevReportsV42 = App.renderReports?.bind(App)
  App.renderReports = function v42ReportsWithAdvisor() {
    prevReportsV42?.()
    const box = document.getElementById('reports-content')
    if (!box || box.querySelector('.ai-advisor-card')) return
    const insights = App.getFinancialAdvisorInsights ? App.getFinancialAdvisorInsights(S.rptMonth) : []
    if (!insights.length) return
    box.insertAdjacentHTML('afterbegin', `<div class="sec-title">คำแนะนำทางการเงิน</div><div class="card card-pad ai-advisor-card"><div class="ai-card-head"><div><strong>AI Financial Coach</strong><span>วิเคราะห์จากรายรับ รายจ่าย และงบประมาณในเครื่อง</span></div><button class="btn btn-secondary btn-sm" onclick="App.renderReports()">วิเคราะห์ใหม่</button></div>${insights.map(i => `<div class="insight-row ai-insight"><div class="insight-icon">${esc(i.icon)}</div><div><div class="insight-title">${esc(i.title)}</div><div class="insight-body">${esc(i.body)}</div></div></div>`).join('')}</div>`)
  }

  // 8) Installment group edit flow.
  function installmentGroups() { return App.getInstallmentGroups?.() || [] }
  function groupById(groupId) { return installmentGroups().find(g => g.id === groupId) || null }
  function splitRows(g) {
    const rows = [...(g?.rows || [])].sort((a,b) => Number(a.installmentNo || 0) - Number(b.installmentNo || 0))
    return { rows, past: rows.filter(t => String(t.date || '') <= today()), future: rows.filter(t => String(t.date || '') > today()) }
  }
  function distributeAmounts(total, count) {
    const n = Math.max(0, Number(count || 0))
    if (!n) return []
    const base = Math.floor((Number(total || 0) / n) * 100) / 100
    const list = []
    let allocated = 0
    for (let i = 0; i < n; i++) {
      const amt = i === n - 1 ? Math.round((Number(total || 0) - allocated) * 100) / 100 : base
      allocated += amt
      list.push(amt)
    }
    return list
  }

  App.openEditInstallmentGroup = function(groupId, cardId = '') {
    const g = groupById(groupId)
    if (!g) { toast('ไม่พบชุดผ่อนนี้', 'error'); return }
    const { rows, past } = splitRows(g)
    const first = rows[0] || {}
    const total = Number(g.total || rows.reduce((s,t)=>s+Number(t.amount||0),0))
    const paidKept = past.reduce((s,t)=>s+Number(t.amount||0),0)
    const walletOpts = (S.wallets || []).filter(w => !isInvestWallet(w)).map(w => `<option value="${esc(w.id)}"${first.walletId===w.id?' selected':''}>${esc(w.icon || '')} ${esc(w.name)}</option>`).join('')
    const catOpts = (S.categories.expense || []).map(c => `<option value="${esc(c.id)}"${first.categoryId===c.id?' selected':''}>${esc(c.icon || '')} ${esc(c.label)}</option>`).join('')
    const back = cardId ? `App.openInstallmentCenter('${esc(cardId)}')` : 'App.openInstallmentCenter()'
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="${back}">←</button><h2>แก้ไขชุดผ่อน</h2><button class="btn btn-primary btn-sm" onclick="App.saveInstallmentGroupEdit('${esc(groupId)}','${esc(cardId)}')" style="width:auto">บันทึก</button></div>
      <div class="sub-scroll">
        <div class="installment-edit-note"><b>${esc(g.merchant || 'ผ่อนชำระ')}</b><span>บันทึกแล้ว ${past.length} งวด · ยอดที่ถือว่าเกิดขึ้นแล้ว ${money(paidKept)}</span></div>
        <div class="form-group"><label class="form-label">ขอบเขตการแก้ไข</label><select class="form-input" id="ieg-scope"><option value="future">แก้งวดอนาคตเท่านั้น (แนะนำ)</option><option value="all">แก้ทั้งชุด รวมงวดที่ผ่านมา</option></select><div class="form-hint">ถ้าแก้ทั้งชุด ยอดย้อนหลังในรายงานและกระเป๋าจะถูกคำนวณใหม่ด้วย</div></div>
        <div class="form-group"><label class="form-label">ชื่อร้านค้า / รายการ</label><input class="form-input" id="ieg-merchant" value="${esc(first.merchant || g.merchant || '')}"></div>
        <div class="form-split-row"><div><label class="form-label">ยอดรวมทั้งชุด</label><input class="form-input" type="number" min="0" step="0.01" id="ieg-total" value="${esc(total)}"></div><div><label class="form-label">จำนวนงวดทั้งหมด</label><input class="form-input" type="number" min="1" step="1" id="ieg-months" value="${esc(rows.length || first.installmentMonths || 1)}"></div></div>
        <div class="form-split-row"><div><label class="form-label">วันที่งวดแรก</label><input class="form-input" type="date" id="ieg-start" value="${esc(rows[0]?.date || today())}"></div><div><label class="form-label">กระเป๋า / บัตร</label><select class="form-input" id="ieg-wallet">${walletOpts}</select></div></div>
        <div class="form-group"><label class="form-label">หมวดหมู่</label><select class="form-input" id="ieg-category">${catOpts}</select></div>
        <div class="form-group"><label class="form-label">หมายเหตุ</label><input class="form-input" id="ieg-note" value="${esc(first.note || '')}"></div>
      </div>`)
  }

  App.saveInstallmentGroupEdit = function(groupId, cardId = '') {
    const scope = document.getElementById('ieg-scope')?.value || 'future'
    const total = Number(document.getElementById('ieg-total')?.value || 0)
    const months = parseInt(document.getElementById('ieg-months')?.value || 0)
    const startDate = document.getElementById('ieg-start')?.value || today()
    const walletId = document.getElementById('ieg-wallet')?.value || ''
    const categoryId = document.getElementById('ieg-category')?.value || ''
    const merchant = document.getElementById('ieg-merchant')?.value?.trim() || 'ผ่อนชำระ'
    const note = document.getElementById('ieg-note')?.value || ''
    const g = groupById(groupId)
    if (!g) { toast('ไม่พบชุดผ่อนนี้', 'error'); return }
    if (!(total > 0) || !(months >= 1) || !walletId || !categoryId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) { toast('กรุณากรอกข้อมูลชุดผ่อนให้ครบ', 'error'); return }

    const apply = () => {
      const { rows, past } = splitRows(groupById(groupId))
      const paidKept = past.reduce((s,t)=>s+Number(t.amount||0),0)
      let keep = []
      let count = months
      let amountPool = total
      let startOffset = 0
      if (scope === 'future') {
        if (months < past.length) { toast(`จำนวนงวดต้องไม่น้อยกว่างวดที่เกิดขึ้นแล้ว (${past.length} งวด)`, 'error'); return }
        if (total < paidKept - 0.01) { toast(`ยอดรวมใหม่ต้องไม่น้อยกว่ายอดที่เกิดขึ้นแล้ว ${money(paidKept)}`, 'error'); return }
        keep = past.map(t => ({ ...t, merchant, note, installmentMonths:months, installmentTotalAmount:total }))
        count = months - past.length
        amountPool = Math.round((total - paidKept) * 100) / 100
        startOffset = past.length
      }
      const amounts = distributeAmounts(amountPool, count)
      const generated = amounts.map((amount, idx) => {
        let date = addMonths(startDate, startOffset + idx)
        if (scope === 'future') {
          let guard = 0
          while (date <= today() && guard < 36) { date = addMonths(date, 1); guard++ }
        }
        const no = startOffset + idx + 1
        return { id:Calc.genId(), type:'expense', amount, walletId, categoryId, merchant, note, date, isInstallment:true, installmentGroupId:groupId, installmentNo:no, installmentMonths:months, installmentTotalAmount:total, scheduled:date > today() }
      })
      S.transactions = (S.transactions || []).filter(t => t.installmentGroupId !== groupId).concat(keep, generated)
      S.transactions.sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')))
      App.recalculateWalletBalances?.({ save:false, recordSnapshot:true })
      persist(); App.openInstallmentCenter(cardId); toast('แก้ไขชุดผ่อนแล้ว', 'success')
    }

    if (scope === 'all') {
      App.showConfirm({ title:'ยืนยันแก้ทั้งชุดผ่อน', danger:true, body:'การแก้ทั้งชุดจะคำนวณยอดย้อนหลังใหม่ รวมถึงงวดที่ผ่านไปแล้ว ต้องการดำเนินการต่อหรือไม่?', confirmLabel:'แก้ทั้งชุด', onConfirm:apply })
    } else apply()
  }

  App.openInstallmentCenter = function v42InstallmentCenter(cardId = '') {
    const groups = installmentGroups().filter(g => !cardId || g.walletId === cardId)
    const back = cardId ? `App.openCCDetail('${esc(cardId)}')` : 'App.closeSubScreen()'
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="${back}">←</button><h2>ศูนย์ผ่อนชำระ</h2></div><div class="sub-scroll installment-compact-screen">${groups.length ? `<div class="compact-card-list">${groups.map(g => { const w = walletById(g.walletId); const next = g.next; return `<div class="installment-compact-row installment-compact-row-edit"><div class="icr-main"><b>${esc(g.merchant)}</b><span>${esc(w?.name || '')}${next ? ` · งวด ${next.installmentNo}/${next.installmentMonths} · ${thaiDateShort(next.date)}` : ' · ครบแล้ว'}</span></div><div class="icr-amount"><strong>${money(g.remaining || 0)}</strong><span>เหลือ</span></div><button class="icon-btn" onclick="App.openEditInstallmentGroup('${esc(g.id)}','${esc(cardId)}')">✏️</button><button class="icon-btn" onclick="App.deleteInstallmentGroup('${esc(g.id)}')">🗑</button></div>` }).join('')}</div>` : App._emptyState('🧾','ยังไม่มีรายการผ่อน','เพิ่มรายการจ่ายแล้วเลือก “ผ่อนชำระ”')}</div>`)
  }

  try { if (S.page === 'transactions') App.renderTransactions() } catch (_) {}
  try { if (S.page === 'reports') App.renderReports() } catch (_) {}
})();

/* ============================================================
   V4.3 More page Option A grouping
   - Tool-first / Daily Use First
   - Full render override to avoid duplicated rows from old patches
   ============================================================ */
;(function v43MoreOptionA() {
  'use strict'
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))
  const ACCENTS = ['#2563EB','#7C3AED','#DC2626','#059669','#D97706','#0891B2','#BE185D','#374151']

  function settingRow({ icon, label, value = '', onclick = '', danger = false, toggle = '' }) {
    const attr = onclick ? ` onclick="${onclick}"` : ''
    const labelStyle = danger ? ' style="color:var(--expense)"' : ''
    const arrowStyle = danger ? ' style="color:var(--expense)"' : ''
    return `<div class="settings-row"${attr}><div class="s-icon">${icon}</div><div class="s-label"${labelStyle}>${label}</div>${value ? `<div class="s-value">${value}</div>` : ''}${toggle || `<div class="s-arrow"${arrowStyle}>›</div>`}</div>`
  }

  App.renderMore = function v43MoreOptionARender() {
    const content = document.getElementById('more-content')
    if (!content) return

    const budgetCount = (S.budgets || []).length + (S.incomeBudgets || []).length
    const meta = S.settings?.storageMeta || {}
    const lastSaved = meta.lastSavedAt ? new Date(meta.lastSavedAt).toLocaleString('th-TH') : 'ยังไม่บันทึก'
    const lastExport = meta.lastExportedAt ? new Date(meta.lastExportedAt).toLocaleString('th-TH') : 'ยังไม่เคย Export'
    const currentProxy = String(window.MT_GOLD_PROXY_URL || localStorage.getItem('MT_GOLD_PROXY_URL') || '')

    content.innerHTML = `
      <div style="padding:0 16px">
        <div style="font-size:20px;font-weight:800;padding:20px 0 4px">เพิ่มเติม</div>

        <div class="sec-title">เครื่องมือหลัก</div>
        <div class="card card-pad">
          ${settingRow({ icon:'🔁', label:'รายการประจำ', value:`${(S.recurring || []).length} รายการ`, onclick:'App.openRecurringScreen()' })}
          ${settingRow({ icon:'🧾', label:'ศูนย์ผ่อนชำระ', onclick:'App.openInstallmentCenter()' })}
          ${settingRow({ icon:'🎁', label:'สมุดสิทธิประโยชน์', onclick:'App.openRewardLedgerScreen()' })}
          ${settingRow({ icon:'💰', label:'งบประมาณรายรับ/รายจ่าย', value: budgetCount ? `${budgetCount} หมวด` : 'ยังไม่ตั้ง', onclick:'App.openBudgetScreen()' })}
        </div>

        <div class="sec-title">จัดการข้อมูล</div>
        <div class="card card-pad">
          ${settingRow({ icon:'🏷️', label:'จัดการหมวดหมู่', value:'รายรับ/รายจ่าย', onclick:"App.openCategoryScreen('expense')" })}
          ${settingRow({ icon:'🏪', label:'ร้านค้า / Platform', value:`${(S.merchants || []).length} ร้าน`, onclick:'App.openMerchantScreen()' })}
          ${settingRow({ icon:'🔧', label:'ตรวจสอบยอดคงเหลือ', onclick:'App.openBalanceRepairScreen()' })}
        </div>

        <div class="sec-title">สำรองข้อมูล</div>
        <div class="card card-pad">
          ${settingRow({ icon:'📤', label:'ส่งออกข้อมูล (JSON)', onclick:'App.exportData()' })}
          ${settingRow({ icon:'📊', label:'ส่งออก CSV', onclick:'App.exportCSV()' })}
          ${settingRow({ icon:'📥', label:'นำเข้าข้อมูล (JSON)', onclick:"document.getElementById('import-file').click()" })}
          <input type="file" id="import-file" accept=".json" style="display:none" onchange="App.importData(this)">
          ${settingRow({ icon:'🧯', label:'กู้คืน Backup ก่อน Import', onclick:'App.restorePreImportBackup()' })}
          <div class="settings-row">
            <div class="s-icon">💾</div>
            <div class="s-label">สถานะข้อมูล</div>
            <div class="s-value">Local only · Saved: ${esc(lastSaved)} · Export: ${esc(lastExport)}</div>
          </div>
        </div>

        <div class="sec-title">การแสดงผล</div>
        <div class="card card-pad">
          ${settingRow({ icon:'🌙', label:'โหมดมืด', onclick:'App.toggleDark()', toggle:`<button class="toggle${S.settings.darkMode ? ' on' : ''}" onclick="event.stopPropagation();App.toggleDark()"></button>` })}
          <div style="padding:14px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:15px;font-weight:600;margin-bottom:12px">🎨 สีธีม</div>
            <div class="color-row">
              ${ACCENTS.map(c => `<div class="color-dot${S.settings.accentColor===c?' selected':''}" style="background:${c}" onclick="App.setAccent('${c}')"></div>`).join('')}
            </div>
          </div>
        </div>

        <div class="sec-title">ระบบ</div>
        <div class="card card-pad">
          <div style="padding:14px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:15px;font-weight:700;margin-bottom:8px">Thai Gold API Proxy</div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:10px">ใส่ URL Google Apps Script Proxy เพื่อ sync ราคาทองสมาคมค้าทองคำ</div>
            <input class="form-input" id="gold-proxy-input" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(currentProxy)}" style="margin-bottom:10px">
            <button class="btn btn-primary" onclick="App.saveGoldProxyUrl()">บันทึก Proxy URL</button>
            ${currentProxy ? `<div style="font-size:11px;color:var(--income);margin-top:8px">✓ ตั้งค่าแล้ว: ${esc(currentProxy.length > 60 ? currentProxy.slice(0,60) + '…' : currentProxy)}</div>` : ''}
          </div>
          ${settingRow({ icon:'🔄', label:'รีเซ็ตข้อมูลทั้งหมด', danger:true, onclick:'App.resetData()' })}
        </div>

        <div style="text-align:center;padding:32px 0 8px">
          <div style="font-size:40px">💰</div>
          <div style="font-size:16px;font-weight:700;margin-top:8px">Money Tracker</div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">v4.3 · Offline-first PWA</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">ข้อมูลหลักเก็บในเครื่องนี้ ไม่ใช่ Cloud Sync</div>
        </div>
      </div>`
  }

  try { if (S.page === 'more') App.renderMore() } catch (_) {}
})();
