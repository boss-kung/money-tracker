/* ============================================================
   V6.2 Hard mobile zoom lock
   Must run before the app boots: injects/updates viewport meta and
   blocks iOS Safari pinch/double-tap zoom at capture phase.
   ============================================================ */
;(function hardMobileZoomLock(){
  const ua = navigator.userAgent || ''
  const isCoarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
  const isSmallScreen = !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches)
  const isMobileUA = /Android|iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const shouldLockZoom = isMobileUA || isCoarsePointer || isSmallScreen
  const viewportContent = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'

  function applyViewportLock(){
    let viewport = document.querySelector('meta[name="viewport"]')
    if (!viewport) {
      viewport = document.createElement('meta')
      viewport.name = 'viewport'
      const head = document.head || document.getElementsByTagName('head')[0] || document.documentElement
      head.insertBefore(viewport, head.firstChild || null)
    }
    viewport.setAttribute('content', viewportContent)
  }

  applyViewportLock()
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyViewportLock, { once: true })
  } else {
    applyViewportLock()
  }
  window.addEventListener('pageshow', applyViewportLock, { passive: true })

  if (!shouldLockZoom) return

  function cancelZoomEvent(event){
    if (event.cancelable !== false) event.preventDefault()
    event.stopPropagation?.()
    event.stopImmediatePropagation?.()
    return false
  }

  function cancelMultiTouch(event){
    if (event.touches && event.touches.length > 1) return cancelZoomEvent(event)
  }

  const captureNonPassive = { passive: false, capture: true }
  const targets = [window, document, document.documentElement]

  targets.forEach(target => {
    if (!target || !target.addEventListener) return
    ;['gesturestart', 'gesturechange', 'gestureend'].forEach(type => {
      target.addEventListener(type, cancelZoomEvent, captureNonPassive)
    })
    target.addEventListener('touchstart', cancelMultiTouch, captureNonPassive)
    target.addEventListener('touchmove', cancelMultiTouch, captureNonPassive)
  })

  let lastTouchEndAt = 0
  document.addEventListener('touchend', function(event){
    const now = Date.now()
    if (now - lastTouchEndAt <= 320) cancelZoomEvent(event)
    lastTouchEndAt = now
  }, captureNonPassive)

  document.addEventListener('dblclick', cancelZoomEvent, captureNonPassive)

  window.addEventListener('wheel', function(event){
    if (event.ctrlKey || event.metaKey) cancelZoomEvent(event)
  }, captureNonPassive)
})()

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
function moneyFmt(n) { return S.settings?.hideMoney ? '฿*****' : Calc.fmt(n || 0) }

// ── Apply theme ───────────────────────────────────────────────
function applyTheme() {
  document.documentElement.classList.toggle('dark', Boolean(S.settings?.darkMode))
  document.documentElement.style.setProperty('--primary', S.settings?.accentColor || '#2563EB')
  document.getElementById('meta-theme')?.setAttribute('content', S.settings?.darkMode ? '#0F172A' : '#1E293B')
}

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container')
  if (!c) { console[type === 'error' ? 'error' : 'log'](msg); return }
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.textContent = msg
  el.onclick = () => el.remove()
  c.appendChild(el)
  setTimeout(() => el.remove(), 3000)
}

// ── Overlay helpers ───────────────────────────────────────────
const App = {
  openOverlay(id)  { document.getElementById(id)?.classList.add('open') },
  closeOverlay(id) {
    document.getElementById(id)?.classList.remove('open')
    if (id === 'overlay-tx-detail') S.deleteConfirm = false
  },
  openSubScreen(html) {
    const ss = document.getElementById('sub-screen')
    if (!ss) return
    ss.innerHTML = html
    ss.classList.add('open')
  },
  closeSubScreen() {
    document.getElementById('sub-screen')?.classList.remove('open')
    App.render()
  },
  toggleHideMoney() { S.settings.hideMoney = !S.settings.hideMoney; persist(); App.render() },

  // ── Navigation ────────────────────────────────────────────
  showPage(page) {
    S.page = page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    document.getElementById('page-' + page)?.classList.add('active')
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
  // renderDashboard is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


  // ─────────────────────────────────────────────────────────
  // TRANSACTIONS PAGE
  // ─────────────────────────────────────────────────────────
/* consolidated: removed legacy renderTransactions from line 120 */
/* consolidated: removed legacy renderTransactionsList from line 142 */
/* consolidated: removed legacy setTxMonth from line 180 *//* consolidated: removed legacy setTxType from line 181 */
  // ─────────────────────────────────────────────────────────
  // WALLETS PAGE
  // ─────────────────────────────────────────────────────────
  // renderWallets is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


  // ─────────────────────────────────────────────────────────
  // REPORTS PAGE
  // ─────────────────────────────────────────────────────────
/* consolidated: removed legacy renderReports from line 193 */
/* consolidated: removed legacy setRptMonth from line 304 *//* consolidated: removed legacy setRptView from line 305 */
  // ─────────────────────────────────────────────────────────
  // MORE / SETTINGS PAGE
  // ─────────────────────────────────────────────────────────
  // renderMore is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


  toggleDark() {
    S.settings.darkMode = !S.settings.darkMode
    persist(); applyTheme(); App.renderMore()
  },

  setAccent(color) {
    S.settings.accentColor = color
    persist(); applyTheme(); App.renderMore()
  },

/* consolidated: removed legacy exportData from line 324 */
  // importData is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


/* consolidated: removed legacy resetData from line 333 */
  // ─────────────────────────────────────────────────────────
  // BUDGET SUB-SCREEN
  // ─────────────────────────────────────────────────────────
  // openBudgetScreen is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


  // saveBudgets is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


  // ─────────────────────────────────────────────────────────
  // ADD TRANSACTION OVERLAY
  // ─────────────────────────────────────────────────────────
  // openAddTx is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


  // _renderAddTxAmount is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


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

/* consolidated: removed legacy _renderAddTxDetail from line 387 */
/* consolidated: removed legacy _selectCat from line 454 */
  _txField(field, val) { S.tx[field] = val },
  _backToAmount()      { S.tx.step = 'amount'; App._renderAddTxAmount() },

  // saveTx is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


  // ─────────────────────────────────────────────────────────
  // TRANSACTION DETAIL
  // ─────────────────────────────────────────────────────────
  openTxDetail(id) {
    S.selectedTxId = id
    S.deleteConfirm = false
    App._renderTxDetail()
    App.openOverlay('overlay-tx-detail')
  },

  // _renderTxDetail is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


  deleteTx() { S.deleteConfirm = true; App._renderTxDetail() },
  _cancelDelete() { S.deleteConfirm = false; App._renderTxDetail() },

/* consolidated: removed legacy confirmDeleteTx from line 492 */
  // ─────────────────────────────────────────────────────────
  // WALLET FORM
  // ─────────────────────────────────────────────────────────
  // openWalletForm is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


  // _selectWalletType is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


  _selectWalletColor(color) {
    document.getElementById('wf-color').value = color
    document.querySelectorAll('#wf-color-row .color-dot').forEach(d => {
      d.classList.toggle('selected', d.dataset.color === color)
    })
  },

  // saveWallet is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


/* consolidated: removed legacy deleteWallet from line 526 */
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

/* consolidated: removed legacy saveCCPay from line 570 */
  // ─────────────────────────────────────────────────────────
  // CC DETAIL (tapping a CC card)
  // ─────────────────────────────────────────────────────────
  // openCCDetail is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


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

/* consolidated: removed legacy _txRow from line 623 */
/* consolidated: removed legacy _bindTxRows from line 646 */
/* consolidated: removed legacy _emptyState from line 652 */
  // _walletTypeLabel is intentionally defined by the V2+ override block below.
  // Keeping one active implementation avoids stale prototype logic overriding latest behavior.


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

/* consolidated: removed legacy renderDashboard from line 733 */
/* consolidated: removed legacy openAddTx from line 771 *//* consolidated: removed legacy openEditTx from line 776 *//* consolidated: removed legacy openDuplicateTx from line 782 *//* consolidated: removed legacy _renderAddTxAmount from line 788 *//* consolidated: removed legacy saveTx from line 794 *//* consolidated: removed legacy _renderTxDetail from line 808 */
/* consolidated: removed legacy renderWallets from line 815 *//* consolidated: removed legacy _walletCard from line 822 *//* consolidated: removed legacy refreshMarketPrices from line 828 *//* consolidated: removed legacy _marketText from line 835 */  openWalletForm(walletId) {
    S.editingWalletId = walletId
    const w = walletId ? S.wallets.find(x => x.id === walletId) : null
    const COLORS = ['#2563EB','#7C3AED','#DC2626','#059669','#D97706','#0891B2','#BE185D','#374151']
    const TYPES = [['bank','🏦','ธนาคาร'],['cash','💵','เงินสด'],['ewallet','📱','TrueMoney'],['credit','💳','บัตรเครดิต'],['gold','🥇','ทอง'],['crypto','₿','Crypto'],['fcd','💱','FCD']]
    document.getElementById('wallet-form-title').textContent = w ? 'แก้ไขกระเป๋า' : 'เพิ่มกระเป๋าเงิน'
    document.getElementById('wallet-form-content').innerHTML = `<div class="form-group"><label class="form-label">ชื่อกระเป๋า</label><input class="form-input" id="wf-name" value="${w?.name||''}"></div><div class="form-group"><label class="form-label">ประเภท</label><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px" id="wf-type-grid">${TYPES.map(([v,icon,lbl]) => `<button class="cat-btn${(w?.type||'bank')===v?' active':''}" onclick="App._selectWalletType('${v}')" data-type="${v}">${icon}<br><small>${lbl}</small></button>`).join('')}</div><input type="hidden" id="wf-type" value="${w?.type||'bank'}"></div><div class="form-group"><label class="form-label">สี</label><div class="color-row" id="wf-color-row">${COLORS.map(c => `<div class="color-dot${(w?.color||'#2563EB')===c?' selected':''}" style="background:${c}" onclick="App._selectWalletColor('${c}')" data-color="${c}"></div>`).join('')}</div><input type="hidden" id="wf-color" value="${w?.color||'#2563EB'}"></div><div class="form-group"><label class="form-label" id="wf-balance-label">${w?.type==='credit'?'ยอดค้างชำระ (฿)':'มูลค่าปัจจุบัน (฿)'}</label><input class="form-input" type="number" id="wf-balance" value="${w ? Math.abs(w.balance) : ''}"></div><div id="wf-cc-fields" style="${(w?.type||'bank')==='credit'?'':'display:none'}"><div class="form-group"><label class="form-label">วงเงิน (฿)</label><input class="form-input" type="number" id="wf-limit" value="${w?.limit||''}"></div><div class="form-group"><label class="form-label">วันครบกำหนดชำระ</label><input class="form-input" type="number" id="wf-dueday" min="1" max="31" value="${w?.dueDay||''}"></div><div class="form-group"><label class="form-label">วันตัดรอบบัญชี</label><input class="form-input" type="number" id="wf-cycle-day" min="1" max="31" value="${w?.cycleDay||''}"></div></div><div id="wf-invest-fields" style="${['gold','crypto','fcd'].includes(w?.type||'bank')?'':'display:none'}"><div class="form-group"><label class="form-label">Symbol / สกุลเงิน</label><input class="form-input" id="wf-symbol" placeholder="BTC, ETH, USD, บาททอง" value="${w?.symbol||w?.currency||''}"></div><div class="form-group"><label class="form-label">จำนวน Asset</label><input class="form-input" type="number" step="0.00000001" id="wf-units" value="${w?.units||''}" placeholder="เช่น 0.05, 2.5, 1000"></div><div class="form-group"><label class="form-label">ราคาต่อหน่วยสำรอง (บาท)</label><input class="form-input" type="number" step="0.01" id="wf-manual-price" value="${w?.manualPrice||''}" ></div></div><div class="flex-row">${w ? `<button class="btn btn-outline flex-1" onclick="App.deleteWallet('${w.id}')">ลบ</button>` : ''}<button class="btn btn-primary${w?'':' flex-1'}" onclick="App.saveWallet()" style="${w?'flex:2':''}">${w ? 'บันทึก' : 'เพิ่มกระเป๋า'}</button></div>`
    App.openOverlay('overlay-wallet-form')
  },
  _selectWalletType(type) {
    document.getElementById('wf-type').value = type
    document.querySelectorAll('#wf-type-grid .cat-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type))
    document.getElementById('wf-cc-fields').style.display = type === 'credit' ? '' : 'none'
    document.getElementById('wf-invest-fields').style.display = ['gold','crypto','fcd'].includes(type) ? '' : 'none'
    document.getElementById('wf-balance-label').textContent = type === 'credit' ? 'ยอดค้างชำระ (฿)' : ['gold','crypto','fcd'].includes(type) ? 'มูลค่าปัจจุบัน / ราคาสำรอง (฿)' : 'มูลค่าปัจจุบัน (฿)'
    const symbol = document.getElementById('wf-symbol')
    if (symbol && type === 'gold' && !symbol.value) symbol.value = 'บาททอง'
    if (symbol && type === 'fcd' && !symbol.value) symbol.value = 'USD'
  },
  saveWallet() {
    const name = document.getElementById('wf-name').value.trim()
    const type = document.getElementById('wf-type').value
    const color = document.getElementById('wf-color').value
    const rawBalance = parseFloat(document.getElementById('wf-balance').value) || 0
    const limit = parseFloat(document.getElementById('wf-limit')?.value) || 50000
    const dueDay = parseInt(document.getElementById('wf-dueday')?.value) || 5
    const cycleDay = parseInt(document.getElementById('wf-cycle-day')?.value) || 25
    const isInvest = ['gold','crypto','fcd'].includes(type)
    const symbol = document.getElementById('wf-symbol')?.value.trim().toUpperCase() || (type === 'gold' ? 'บาททอง' : type === 'fcd' ? 'USD' : '')
    const units = isInvest ? (parseFloat(document.getElementById('wf-units')?.value) || 0) : undefined
    const manualPrice = isInvest ? (parseFloat(document.getElementById('wf-manual-price')?.value) || 0) : undefined
    const ICONS = { bank:'🏦', cash:'💵', ewallet:'📱', credit:'💳', saving:'🏦', gold:'🥇', crypto:'₿', fcd:'💱' }
    if (!name) { toast('กรุณากรอกชื่อกระเป๋า', 'error'); return }

    let balance = type === 'credit' ? -Math.abs(rawBalance) : rawBalance
    const data = {
      name, type, color, icon: ICONS[type] || '💳', balance,
      ...(type === 'credit' && { limit, dueDay, cycleDay }),
      ...(isInvest && { symbol, currency: type === 'fcd' ? (symbol || 'USD') : undefined, units, manualPrice })
    }

    // Ledger-based recalculation uses openingBalance/openingUnits as the source of truth.
    // When editing a wallet directly, update the baseline too; otherwise recalculateWalletBalances()
    // will overwrite the newly typed balance/asset units with the previous baseline.
    const walletIdForFlow = S.editingWalletId || null
    const flows = (typeof App._ledgerFlows === 'function') ? App._ledgerFlows() : { cash:{}, units:{} }
    const round2 = n => Math.round((Number(n) || 0) * 100) / 100
    const round8 = n => Math.round((Number(n) || 0) * 1e8) / 1e8

    if (isInvest) {
      const flowUnits = walletIdForFlow ? Number(flows.units?.[walletIdForFlow] || 0) : 0
      data.openingUnits = round8(units - flowUnits)
      const price = App._investmentUnitPriceTHB?.(data) || manualPrice || 0
      if (price && units) data.balance = round2(units * price)
    } else {
      const flowCash = walletIdForFlow ? Number(flows.cash?.[walletIdForFlow] || 0) : 0
      data.openingBalance = round2(balance - flowCash)
    }

    if (S.editingWalletId) {
      const idx = S.wallets.findIndex(w => w.id === S.editingWalletId)
      if (idx >= 0) S.wallets[idx] = { ...S.wallets[idx], ...data }
    } else {
      S.wallets.push({ id: Calc.genId(), ...data })
    }
    App.recalculateWalletBalances?.({ save:false, recordSnapshot:false })
    persist(); App.closeOverlay('overlay-wallet-form'); App.render(); toast(S.editingWalletId ? 'แก้ไขกระเป๋าแล้ว' : 'เพิ่มกระเป๋าแล้ว', 'success')
  },

/* consolidated: removed legacy renderMore from line 869 */
/* consolidated: removed legacy openBudgetScreen from line 876 *//* consolidated: removed legacy saveBudgets from line 881 */
/* consolidated: removed legacy openRecurringScreen from line 886 *//* consolidated: removed legacy openRecurringForm from line 887 *//* consolidated: removed legacy saveRecurring from line 888 */  toggleRecurring(id) { const r = S.recurring.find(x => x.id === id); if (r) r.paused = !r.paused; persist(); App.openRecurringScreen() },
/* consolidated: removed legacy deleteRecurring from line 890 */
  openCategoryScreen(type='expense', q='') { S.catManageType = type; const cats = (S.categories[type] || []).filter(c => !q || c.label.toLowerCase().includes(q.toLowerCase())); App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>จัดการหมวดหมู่</h2><button class="btn btn-primary btn-sm" onclick="App.openCategoryForm()" style="width:auto;padding:8px 14px">+ เพิ่ม</button></div><div class="sub-scroll"><div class="tab-strip"><button class="tab-btn ${type==='expense'?'active':''}" onclick="App.openCategoryScreen('expense')">รายจ่าย</button><button class="tab-btn ${type==='income'?'active':''}" onclick="App.openCategoryScreen('income')">รายรับ</button></div><input class="search-input" id="cat-search" placeholder="ค้นหาหมวดหมู่" value="${q}" oninput="App.openCategoryScreen('${type}', this.value)"><div class="card mt-12"><div style="padding:0 16px">${cats.map(c => `<div class="list-item"><div class="list-item-icon" style="background:${c.color}20">${c.icon}</div><div class="list-item-info"><div class="list-item-name">${c.label}</div><div class="list-item-sub">${c.color}</div></div><div class="recurring-actions"><button class="icon-btn" onclick="App.openCategoryForm('${c.id}')">✏️</button><button class="icon-btn" onclick="App.deleteCategory('${c.id}')">🗑</button></div></div>`).join('') || App._emptyState('🏷️','ไม่พบหมวดหมู่','')}</div></div></div>`) },
/* consolidated: removed legacy openCategoryForm from line 893 */  saveCategory(id) { const type = S.catManageType || 'expense'; const label = document.getElementById('cat-name').value.trim(), icon = document.getElementById('cat-icon').value.trim() || '📦', color = document.getElementById('cat-color').value || '#2563EB'; if (!label) { toast('กรุณากรอกชื่อหมวดหมู่','error'); return } if (id) { const idx = S.categories[type].findIndex(c => c.id === id); if (idx >= 0) S.categories[type][idx] = { ...S.categories[type][idx], label, icon, color } } else S.categories[type].push({ id:Calc.genId(), label, icon, color }); persist(); App.openCategoryScreen(type); toast('บันทึกหมวดหมู่แล้ว','success') },
/* consolidated: removed legacy deleteCategory from line 895 */
  openMerchantScreen(q='') { App._ensureV2State(); const usage = Calc.getMerchantUsage(S.transactions); const list = S.merchants.filter(m => !q || m.name.toLowerCase().includes(q.toLowerCase())); App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>ร้านค้า / Platform</h2><button class="btn btn-primary btn-sm" onclick="App.openMerchantForm()" style="width:auto;padding:8px 14px">+ เพิ่ม</button></div><div class="sub-scroll"><input class="search-input" placeholder="ค้นหาร้านค้า" value="${q}" oninput="App.openMerchantScreen(this.value)"><div class="card mt-12"><div style="padding:0 16px">${list.map(m => `<div class="list-item"><div class="list-item-icon" style="background:${m.color}20">${m.emoji || '🏪'}</div><div class="list-item-info"><div class="list-item-name">${m.name}</div><div class="list-item-sub">ใช้จ่าย ${usage[m.name] || 0} ครั้ง</div></div><div class="recurring-actions"><button class="icon-btn" onclick="App.openMerchantForm('${m.id}')">✏️</button><button class="icon-btn" onclick="App.deleteMerchant('${m.id}')">🗑</button></div></div>`).join('') || App._emptyState('🏪','ไม่พบร้านค้า','')}</div></div></div>`) },
/* consolidated: removed legacy openMerchantForm from line 898 */  saveMerchant(id) { const data = { name:document.getElementById('mer-name').value.trim(), emoji:document.getElementById('mer-emoji').value.trim() || '🏪', color:document.getElementById('mer-color').value || '#2563EB' }; if (!data.name) { toast('กรุณากรอกชื่อร้านค้า','error'); return } if (id) { const idx = S.merchants.findIndex(m => m.id === id); if (idx >= 0) S.merchants[idx] = { ...S.merchants[idx], ...data } } else S.merchants.push({ id:Calc.genId(), ...data }); persist(); App.openMerchantScreen(); toast('บันทึกร้านค้าแล้ว','success') },
/* consolidated: removed legacy deleteMerchant from line 900 */  _registerMerchantFromTx(tx) { App._ensureV2State(); if (!tx.merchant) return; if (!S.merchants.some(m => m.name.toLowerCase() === tx.merchant.toLowerCase())) S.merchants.push({ id:Calc.genId(), name:tx.merchant, emoji:'🏪', color:'#64748B' }) },

/* consolidated: removed legacy openCCDetail from line 903 *//* consolidated: removed legacy openCCBenefitScreen from line 913 *//* consolidated: removed legacy saveCCBenefit from line 914 *//* consolidated: removed legacy _walletTypeLabel from line 915 */})


Object.assign(App, {
/* consolidated: removed legacy importData from line 920 */})

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
    if (btn.dataset.bound === '1') return
    btn.dataset.bound = '1'
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
/* consolidated: removed legacy renderDashboard from line 983 */
const oldDetail=App._renderAddTxDetail;
/* consolidated: removed legacy _toggleTxFlag from line 985 */
/* consolidated: removed legacy _renderAddTxDetail from line 986 */
const oldOpen=App.openAddTx;/* consolidated: removed legacy openAddTx from line 989 */
const oldEdit=App.openEditTx;/* consolidated: removed legacy openEditTx from line 990 */
const oldDup=App.openDuplicateTx;/* consolidated: removed legacy openDuplicateTx from line 991 */
const oldSave=App.saveTx;/* consolidated: removed legacy saveTx from line 992 */
const oldRow=App._txRow;/* consolidated: removed legacy _txRow from line 993 */
Calc.getCardRewards=function(txns,b){const pe=!!(b?.points?.enabled||b?.enabled),ce=!!(b?.cashback?.enabled||b?.enabled),p=b?.points||{},c=b?.cashback||{};let points=0,cashback=0;(txns||[]).forEach(t=>{if(pe&&t.rewardIncludePoints!==false){let pt=0;if(p.bahtPerPoint)pt+=Math.floor(t.amount/p.bahtPerPoint);pt*=p.multiplier||1;if(p.maxPerTxn)pt=Math.min(pt,p.maxPerTxn);points+=pt}if(ce&&t.rewardIncludeCashback!==false&&(!c.minSpend||t.amount>=c.minSpend)){let base=c.everyBaht?Math.floor(t.amount/c.everyBaht)*c.everyBaht:t.amount,cb=base*((c.percent||0)/100);if(c.tierThreshold&&t.amount<c.tierThreshold)cb=0;if(c.maxPerTxn)cb=Math.min(cb,c.maxPerTxn);cashback+=cb}});if(p.maxPerCycle)points=Math.min(points,p.maxPerCycle);if(c.maxPerCycle)cashback=Math.min(cashback,c.maxPerCycle);return{points:Math.floor(points),cashback:Math.round(cashback*100)/100}};
App._benefit=id=>S.ccBenefits?.[id]||{points:{},cashback:{}};App._rewardForTx=tx=>{const card=S.wallets.find(w=>w.id===tx.walletId&&w.type==='credit');return card&&tx.type==='expense'?Calc.getCardRewards([tx],App._benefit(card.id)):{points:0,cashback:0}};
const oldTxDetail=App._renderTxDetail;/* consolidated: removed legacy _renderTxDetail from line 996 */
/* consolidated: removed legacy openCCBenefitScreen from line 997 */
App.saveCCBenefit=function(id){const v=i=>parseFloat(document.getElementById(i)?.value)||0;S.ccBenefits[id]={enabled:false,points:{enabled:document.getElementById('ccb-points-enabled').classList.contains('on'),bahtPerPoint:v('ccb-bahtPerPoint'),pointPerBahtEvery:v('ccb-pointEvery'),multiplier:v('ccb-multi')||1,maxPerTxn:v('ccb-maxTxnPoint'),maxPerCycle:v('ccb-maxCyclePoint')},cashback:{enabled:document.getElementById('ccb-cash-enabled').classList.contains('on'),percent:v('ccb-cbPercent'),minSpend:v('ccb-cbMin'),tierThreshold:v('ccb-cbTier'),everyBaht:v('ccb-cbEvery')||1,maxPerTxn:v('ccb-cbMaxTxn'),maxPerCycle:v('ccb-cbMaxCycle')}};persist();App.openCCDetail(id);toast('บันทึกสิทธิประโยชน์แล้ว','success')};
const oldCC=App.openCCDetail;/* consolidated: removed legacy openCCDetail from line 999 */
/* consolidated: removed legacy _investmentUnitPriceTHB from line 1000 *//* consolidated: removed legacy _investmentValueTHB from line 1000 */

// Early investment helpers are required before later market-price patches load.
// The final v45 block below will enhance these helpers, but startup must not crash.
App._investmentUnitPriceTHB = App._investmentUnitPriceTHB || function earlyInvestmentUnitPriceTHB(w) {
  if (!w) return 0
  const p = S.marketPrices || {}
  if (w.type === 'gold') return Number(p.thaiGold?.jewelryBuy || p.auroraGold?.jewelryBuy || w.manualPrice || 0)
  if (w.type === 'crypto') {
    const sym = String(w.symbol || '').trim().toUpperCase()
    const id = (typeof App._cryptoId === 'function' && App._cryptoId(w)) || sym.toLowerCase()
    return Number((id && p.crypto?.[id]?.thb) || w.manualPrice || 0)
  }
  if (w.type === 'fcd') {
    const cur = String(w.currency || w.symbol || 'USD').toUpperCase()
    const thb = p.fx?.rates?.THB
    return Number((cur === 'THB' ? 1 : cur === 'USD' ? thb : (thb && p.fx?.rates?.[cur] ? thb / p.fx.rates[cur] : 0)) || w.manualPrice || 0)
  }
  return Number(w.manualPrice || 0)
}
App._investmentValueTHB = App._investmentValueTHB || function earlyInvestmentValueTHB(w) {
  return ['gold','crypto','fcd'].includes(w?.type)
    ? ((Number(w.units || 0) * App._investmentUnitPriceTHB(w)) || Number(w.balance || 0))
    : Number(w?.balance || 0)
}

const oldWalletCard=App._walletCard;/* consolidated: removed legacy _walletCard from line 1001 */
/* consolidated: removed legacy openWalletDetail from line 1002 */
const oldWalletForm=App.openWalletForm;/* consolidated: removed legacy openWalletForm from line 1003 */
const oldSaveWallet=App.saveWallet;/* consolidated: removed legacy saveWallet from line 1004 */
const oldReports=App.renderReports;/* consolidated: removed legacy renderReports from line 1005 */
/* consolidated: removed legacy toggleEmojiPanel from line 1006 */App.pickEmoji=(p,e)=>{document.getElementById(p+'-emoji').value=e;document.getElementById(p+'-emoji-preview').textContent=e;App.toggleEmojiPanel(p)};/* consolidated: removed legacy customEmoji from line 1006 *//* consolidated: removed legacy pickColor from line 1006 */
const oldCatForm=App.openCategoryForm;/* consolidated: removed legacy openCategoryForm from line 1007 */
const oldMerForm=App.openMerchantForm;/* consolidated: removed legacy openMerchantForm from line 1008 */
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

  /* consolidated: removed legacy _walletCard from line 1048 */

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

  /* consolidated: removed legacy openWalletDetail from line 1103 */

  /* consolidated: removed legacy _txDetailRowsHtml from line 1131 */

  /* consolidated: removed legacy openTxDetailSub from line 1153 */

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

  /* consolidated: removed legacy openCCDetail from line 1178 */

  const previousOpenWalletForm = App.openWalletForm
  /* consolidated: removed legacy openWalletForm from line 1208 */

  const previousSaveWallet = App.saveWallet
  /* consolidated: removed legacy saveWallet from line 1219 */

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
      if (type === 'income') return '+฿*****'
      if (type === 'expense') return '-฿*****'
      if (type === 'transfer' || type === 'cc_payment') return '↔ ฿*****'
      return '฿*****'
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
  /* consolidated: removed legacy _walletTypeLabel from line 1269 */
  App._emptyState = function(icon, title, sub) {
    return `<div class="empty"><div class="empty-icon">${esc(icon)}</div><div class="empty-title">${esc(title)}</div>${sub ? `<div class="empty-sub">${esc(sub)}</div>` : ''}</div>`
  }

  App._sectionHeader = function(title, actionLabel, action) {
    return `<div class="section-header"><h3>${esc(title)}</h3>${actionLabel ? `<button type="button" onclick="${action}">${esc(actionLabel)}</button>` : ''}</div>`
  }

  /* consolidated: removed legacy renderDashboard from line 1278 */

  /* consolidated: removed legacy _txRow from line 1361 */

  /* consolidated: removed legacy _renderAddTxAmount from line 1393 */

  /* consolidated: removed legacy _renderAddTxDetail from line 1405 */

  App._toggleTxFlag = function(key) {
    S.tx[key] = !S.tx[key]
    if (key === 'isInstallment' && !S.tx[key]) S.tx.installmentMonths = ''
    App._renderAddTxDetail()
  }

  /* consolidated: removed legacy openAddTx from line 1433 */

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

  /* consolidated: removed legacy saveTx from line 1464 */

  /* consolidated: removed legacy renderWallets from line 1509 */

  /* consolidated: removed legacy _walletCard from line 1518 */

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

  /* consolidated: removed legacy openCCDetail from line 1589 */

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

  const originalShowPage = App.showPage?.bind(App) || function(){}
  /* consolidated: removed legacy showPage from line 1639 */

  /* consolidated: removed legacy renderDashboard from line 1646 */

  /* consolidated: removed legacy _txRow from line 1741 */

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

  /* consolidated: removed legacy _renderAddTxDetail from line 1802 */

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

  const prevShowPage = App.showPage?.bind(App) || function(){}
  /* consolidated: removed legacy showPage from line 1852 */

  const prevRender = App.render?.bind(App) || function(){}
  /* consolidated: removed legacy render from line 1858 */

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
  // Keep the app height stable when the iOS keyboard opens.
  // visualViewport.height shrinks above the keyboard; using it for --app-height
  // makes bottom/sticky controls jump into the middle of the screen.
  let stableAppHeight = Math.round(window.innerHeight || document.documentElement.clientHeight || 0)
  const isFormControl = el => !!el && el.matches?.('input, textarea, select, [contenteditable="true"]')
  const isKeyboardLikelyOpen = () => {
    const vv = window.visualViewport
    const layoutH = Math.round(window.innerHeight || document.documentElement.clientHeight || stableAppHeight || 0)
    const viewportH = Math.round(vv?.height || layoutH)
    return isFormControl(document.activeElement) || (layoutH - viewportH > 120) || document.body?.classList.contains('keyboard-open')
  }
  const setAppHeight = () => {
    const layoutH = Math.round(window.innerHeight || document.documentElement.clientHeight || stableAppHeight || 0)
    if (!isKeyboardLikelyOpen() && layoutH > 0) stableAppHeight = layoutH
    const h = isKeyboardLikelyOpen() ? stableAppHeight : layoutH
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

  const prevShowPage = App.showPage?.bind(App) || function(){}
  /* consolidated: removed legacy showPage from line 1906 */

  const prevRender = App.render?.bind(App) || function(){}
  /* consolidated: removed legacy render from line 1913 */

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
  /* consolidated: removed legacy _walletCard from line 1952 */

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
  /* consolidated: removed legacy setCategoryColor from line 2021 */

  /* consolidated: removed legacy openCategoryForm from line 2027 */

  // Make sure overlay sheets can sit above a currently open sub-screen.
  const prevOpenOverlay = App.openOverlay?.bind(App) || function(){}
  /* consolidated: removed legacy openOverlay from line 2042 */

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
    if (S.settings?.hideMoney) return '฿*****'
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
  /* consolidated: removed legacy pickEmoji from line 2144 */
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

  /* consolidated: removed legacy openCCBenefitScreen from line 2189 */

  /* consolidated: removed legacy saveCCBenefit from line 2203 */

  /* consolidated: removed legacy _parseAuroraGold from line 2232 */

  /* consolidated: removed legacy refreshMarketPrices from line 2249 */

  /* consolidated: removed legacy _investmentUnitPriceTHB from line 2268 */
  /* consolidated: removed legacy _investmentValueTHB from line 2283 */
  /* consolidated: removed legacy _marketText from line 2284 */

  /* consolidated: removed legacy _walletCard from line 2292 */

  /* consolidated: removed legacy renderWallets from line 2313 */

  const prevOpenWalletForm = App.openWalletForm?.bind(App) || function(){}
  /* consolidated: removed legacy openWalletForm from line 2325 */
  const prevSelectWalletType = App._selectWalletType?.bind(App)
  /* consolidated: removed legacy _selectWalletType from line 2355 */
  const prevSaveWallet = App.saveWallet?.bind(App) || function(){}
  /* consolidated: removed legacy saveWallet from line 2363 */

  App._txRow = function(tx) {
    const v = txVisual(tx)
    const bg = v.cat?.color ? `${v.cat.color}16` : tx.type === 'transfer' ? 'rgba(37,99,235,.10)' : 'var(--elevated)'
    return `<div class="tx-row tx-row-modern tx-row--${esc(tx.type)}" data-txid="${esc(tx.id)}">
      <div class="tx-icon" style="background:${bg}">${esc(v.icon)}</div>
      <div class="tx-info"><div class="tx-title">${esc(v.title)}</div><div class="tx-sub">${v.meta.map(x => `<span class="tx-meta-pill">${esc(x)}</span>`).join('')}</div></div>
      <div class="tx-right"><div class="tx-amount" style="color:${typeColor(tx.type)}">${signedAmount(tx)}</div></div>
    </div>`
  }

  /* consolidated: removed legacy renderTransactions from line 2380 */

  /* consolidated: removed legacy renderTransactionsList from line 2395 */

  const prevSetTxMonth = App.setTxMonth?.bind(App)
  /* consolidated: removed legacy setTxMonth from line 2419 */
  /* consolidated: removed legacy setTxType from line 2420 */

  function getFrequentCategories(type) {
    const cats = S.categories[type] || []
    const usage = {}
    S.transactions.filter(t => t.type === type && t.categoryId).forEach(t => usage[t.categoryId] = (usage[t.categoryId] || 0) + 1)
    return [...cats].sort((a,b) => (usage[b.id] || 0) - (usage[a.id] || 0))
  }
  App.showAllTxCategories = function() { S.txShowAllCats = true; App._renderAddTxDetail() }
  App.hideAllTxCategories = function() { S.txShowAllCats = false; App._renderAddTxDetail() }
  const prevSetTxType = App._setTxType?.bind(App)
  /* consolidated: removed legacy _setTxType from line 2431 */
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

  const prevRenderReports = App.renderReports?.bind(App) || function(){}
  /* consolidated: removed legacy renderReports from line 2484 */

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

  /* consolidated: removed legacy refreshMarketPrices from line 2566 */

  /* consolidated: removed legacy _investmentUnitPriceTHB from line 2602 */
  /* consolidated: removed legacy _investmentValueTHB from line 2617 */
  /* consolidated: removed legacy _marketText from line 2618 */

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

  const previousOpenWalletForm = App.openWalletForm?.bind(App) || function(){}
  /* consolidated: removed legacy openWalletForm from line 2679 */
  const previousSelectWalletType = App._selectWalletType?.bind(App)
  /* consolidated: removed legacy _selectWalletType from line 2684 */
  const previousSaveWallet = App.saveWallet?.bind(App) || function(){}
  /* consolidated: removed legacy saveWallet from line 2689 */

  const previousWalletCard = App._walletCard?.bind(App)
  /* consolidated: removed legacy _walletCard from line 2697 */

  const previousOpenWalletDetail = App.openWalletDetail?.bind(App)
  /* consolidated: removed legacy openWalletDetail from line 2714 */

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

  /* consolidated: removed legacy _fetchAuroraGoldViaProxy from line 2808 */

  /* consolidated: removed legacy refreshMarketPrices from line 2833 */

  /* consolidated: removed legacy setGoldProxyUrl from line 2873 */
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

  /* consolidated: removed legacy _normaliseThaiGoldPayload from line 2935 */

  /* consolidated: removed legacy _fetchThaiGoldViaSource from line 2937 */

  // Backward compatibility: older code still calls this method name.
  /* consolidated: removed legacy _fetchAuroraGoldViaProxy from line 2973 */

  /* consolidated: removed legacy refreshMarketPrices from line 2975 */

  /* consolidated: removed legacy _investmentUnitPriceTHB from line 3014 */

  /* consolidated: removed legacy _marketText from line 3031 */

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
  /* consolidated: removed legacy _walletCard from line 3056 */

  const previousOpenWalletDetail = App.openWalletDetail?.bind(App)
  /* consolidated: removed legacy openWalletDetail from line 3072 */

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

  /* consolidated: removed legacy _investmentUnitPriceTHB from line 3125 */
  /* consolidated: removed legacy _investmentValueTHB from line 3133 */
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

  /* consolidated: removed legacy _walletCard from line 3152 */

  /* consolidated: removed legacy renderWallets from line 3167 */

  const previousOpenWalletDetail = App.openWalletDetail?.bind(App);
  /* consolidated: removed legacy openWalletDetail from line 3179 */

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
  /* consolidated: removed legacy refreshMarketPrices from line 3201 */
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
  const _origSaveCCPay = App.saveCCPay?.bind(App) || function(){}
  /* consolidated: removed legacy saveCCPay from line 3223 */

  // ── P1: Search debounce — 250ms to prevent re-render on every keystroke ──
  // The V2.2 renderTransactions sets oninput without debounce.
  // We re-attach with debounce each time the transactions page renders.
  let _txSearchTimer = null
  const _origRenderTx = App.renderTransactions?.bind(App) || function(){}
  /* consolidated: removed legacy renderTransactions from line 3241 */

  // ── P1: FAB visible on Transactions tab ──
  // V2.2.2 final guard hides FAB on all non-dashboard pages.
  // We wrap showPage (outer-most) so our change runs after syncChrome.
  const _origShowPage = App.showPage?.bind(App) || function(){}
  /* consolidated: removed legacy showPage from line 3259 */

  const _origRender = App.render?.bind(App) || function(){}
  /* consolidated: removed legacy render from line 3265 */

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
  const _origDetailRender = App._renderAddTxDetail?.bind(App) || function(){}
  /* consolidated: removed legacy _renderAddTxDetail from line 3287 */

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
  /* consolidated: removed legacy _ensureV2State from line 3390 */

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

  /* consolidated: removed legacy importData from line 3416 */

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

  /* consolidated: removed legacy deleteWallet from line 3457 */

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

  /* consolidated: removed legacy deleteCategory from line 3490 */

  /* consolidated: removed legacy deleteMerchant from line 3502 */

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

  /* consolidated: removed legacy postRecurringNow from line 3561 */

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
    const ccCards = S.wallets
      .filter(w => w.type === 'credit' && Math.abs(Number(w.balance) || 0) > 0 && w.dueDay)
      .map(w => {
        const used = Math.abs(Number(w.balance) || 0)
        const limit = Number(w.limit) || 0
        const pct = limit ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0
        const due = Calc.getDueDate(w.dueDay)
        return { ...w, used, limit, pct, due }
      })
      .sort((a, b) => a.due.daysLeft - b.due.daysLeft)
    const minDaysLeft = ccCards.length ? ccCards[0].due.daysLeft : null
    const nearDueCards = ccCards.filter(c => c.due.daysLeft === minDaysLeft)
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
          <button class="mt-hide-btn" onclick="App.toggleHideMoney()">${S.settings.hideMoney ? '👁 แสดงตัวเลข' : '🙈 ซ่อนตัวเลข'}</button>
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
        </div>
        <div class="mt-net-split">
          <div class="mt-net-metric"><small>รายรับเดือนนี้</small><strong style="color:#4ADE80">+${FMT(stats.income)}</strong></div>
          <div class="mt-divider"></div>
          <div class="mt-net-metric"><small>รายจ่ายเดือนนี้</small><strong style="color:#F87171">-${FMT(stats.expense)}</strong></div>
        </div>
      </div>`

    if (nearDueCards.length) {
      const firstDue = nearDueCards[0].due
      html += `
        <div class="mt-alert-card">
          <div class="mt-alert-title">ครบกำหนดชำระ ${ESC(firstDue.dueStr)} <em>อีก ${firstDue.daysLeft} วัน</em></div>
          ${nearDueCards.map(c => `
            <div class="mt-alert-row" onclick="App.openCCDetail('${ESC(c.id)}')">
              <div class="mt-alert-row-info">
                <span class="mt-alert-row-name">${ESC(c.icon||'💳')} ${ESC(c.name)}</span>
              </div>
              <div class="mt-alert-row-amt">${FMT(c.used)}</div>
            </div>`).join('')}
        </div>`
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
  const _prevRenderMore = App.renderMore?.bind(App) || function(){}
  /* consolidated: removed legacy renderMore from line 3771 */

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
    if (w.type === 'gold') return 'บาททอง'
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
          <span>${S.settings?.hideMoney ? '฿*****' : `${NUM(units, 4)} ${ESC(unitLabel(w))}`}</span>
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
        ${due ? `<div class="cc-due-strip${due.daysLeft <= 3 ? ' urgent' : ''}"><span>ครบกำหนดชำระ</span><em>${due.daysLeft === 0 ? 'วันนี้' : `อีก ${due.daysLeft} วัน`}</em><strong>${ESC(due.dueStr)}</strong></div>` : ''}
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
  const _prevRenderWallets = App.renderWallets?.bind(App) || function(){}
  /* consolidated: removed legacy renderWallets from line 3899 */

  // ── Reports: single AI insights + "analyzing" toast ──────────
  const _prevRenderReports = App.renderReports?.bind(App) || function(){}
  /* consolidated: removed legacy renderReports from line 3906 */

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
    /* consolidated: removed legacy renderWallets from line 3996 */
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
  /* consolidated: removed legacy _investmentUnitPriceTHB from line 4125 */

  const previousMarketText = App._marketText?.bind(App);
  /* consolidated: removed legacy _marketText from line 4134 */

  /* consolidated: removed legacy refreshMarketPrices from line 4143 */

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

  // ── 2. Merchant datalist autocomplete ────────────────────────
  const _prevRenderAddTxDetail = App._renderAddTxDetail?.bind(App)
  /* consolidated: removed legacy _renderAddTxDetail from line 4226 */

  // ── 6. Wallet monthly spend summary ──────────────────────────
  const _prevOpenWalletDetail = App.openWalletDetail?.bind(App)
  /* consolidated: removed legacy openWalletDetail from line 4241 */

  try { if (S.page === 'transactions') App.renderTransactions() } catch (_) {}
})();

/* ============================================================
   V3.1 Financial Safety
   1. Balance reconciliation + repair tool (openBalanceRepairScreen)
   2. deleteMerchant with showConfirm (replaces base confirm())
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
            ${r.expected !== null ? `<div style="font-size:12px;color:var(--muted)">คำนวณจาก transactions: <b>${fmt(r.expected)}</b></div>` : ''}
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

  // ── Override _renderAddTxDetail to clean up datalist/dropdown leftovers ──
  const _prevDetail32 = App._renderAddTxDetail?.bind(App)
  /* consolidated: removed legacy _renderAddTxDetail from line 4433 */

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
  /* consolidated: removed legacy render from line 4612 */

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
    const dueMonthOffset = dueDay > cycleDay ? 0 : 1
const dueBase = new Date(end.getFullYear(), end.getMonth() + dueMonthOffset, 1)
let due = new Date(
  dueBase.getFullYear(),
  dueBase.getMonth(),
  clampDay(dueBase.getFullYear(), dueBase.getMonth(), dueDay)
)

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
  /* consolidated: removed legacy openWalletDetail from line 5007 */

  // Make transaction rows readable for new types.
  const prevTxTypeLabelV4 = App._txTypeLabel?.bind(App)
  /* consolidated: removed legacy _txTypeLabel from line 5020 */
  const prevTxRowV4 = App._txRow?.bind(App)
  /* consolidated: removed legacy _txRow from line 5022 */

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
  App.toggleTxFilterPanel = function() { S.txFilterOpen = !S.txFilterOpen; App.renderTransactions() }
  App.clearTxFilters = function() {
    S.txType = 'all'; S.txWalletFilter = ''; S.txCategoryFilter = ''; S.txAmtMin = ''; S.txAmtMax = ''; S.txSearch = ''; S.txFilterOpen = false
    App.renderTransactions()
  }

  // ── 2/3. Credit-card detail order + compact statement + Thai reward ledger ──
  /* consolidated: removed legacy markCashbackReceived from line 5110 */

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
  /* consolidated: removed legacy confirmDeleteTx from line 5145 */

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
    let html = ''
    const advisorInsights = (typeof App.getFinancialAdvisorInsights === 'function') ? App.getFinancialAdvisorInsights(S.rptMonth) : []
    if (advisorInsights.length) {
      html += `<div class="sec-title">คำแนะนำทางการเงินโดย AI</div><div class="card card-pad ai-advisor-card" style="margin-bottom:12px"><div class="ai-card-head"><div><strong>AI Financial Coach</strong><span>วิเคราะห์จากรายรับ รายจ่าย และงบประมาณในเครื่อง</span></div><button class="btn btn-secondary btn-sm" onclick="App.renderReports()" style="width:auto">วิเคราะห์ใหม่</button></div>${advisorInsights.map(i => `<div class="insight-row ai-insight"><div class="insight-icon">${esc(i.icon)}</div><div><div class="insight-title">${esc(i.title)}</div><div class="insight-body">${esc(i.body)}</div></div></div>`).join('')}</div>`
    }
    html += `<div class="report-summary-grid">${[['รายรับ', stats.income, 'var(--income)'], ['รายจ่าย', stats.expense, 'var(--expense)'], ['สุทธิ', stats.net, stats.net >= 0 ? 'var(--income)' : 'var(--expense)']].map(([l,v,c]) => `<div class="card report-summary-card"><div class="report-summary-label">${l}</div><div class="report-summary-value" style="color:${c}">${money(Math.abs(v))}</div></div>`).join('')}</div><div class="card card-pad nw-card" style="margin-bottom:16px"><div class="nw-label">ความมั่งคั่งสุทธิ</div><div class="nw-value ${nw.net>=0?'c-income':'c-expense'}">${nw.net<0?'-':''}${money(Math.abs(nw.net))}</div><div class="nw-detail"><span class="nw-item">สินทรัพย์ <strong class="c-income">${money(nw.assets)}</strong></span><span class="nw-item">หนี้ <strong class="c-expense">${money(nw.debt)}</strong></span></div></div>`
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
        const title = S.rptView === 'income' ? 'รายรับตามหมวด' : 'รายจ่ายตามหมวด'
        html += `<div class="card card-pad report-category-card">`
        html += `<div class="report-category-title">${title}</div>`
        html += `<div class="report-category-list">`
        data.forEach(d => {
          const pct = total > 0 ? (d.value / total * 100) : 0
          const pctLabel = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)
          html += `<div class="report-cat-row">
            <div class="report-cat-top">
              <div class="report-cat-name"><span class="report-cat-icon">${esc(d.label)}</span><span>${esc(d.name)}</span></div>
              <div class="report-cat-value"><strong>${money(d.value)}</strong><span style="font-weight: 400;">${pctLabel}%</span></div>
            </div>
            <div class="report-cat-bar"><div class="report-cat-fill" style="width:${Math.min(100, Math.max(0, pct))}%;background:${esc(d.color)}"></div></div>
          </div>`
        })
        html += `</div></div>`
      }
    }
    const content = document.getElementById('reports-content')
    if (content) content.innerHTML = html
  }
  App.setRptView = function(v) { S.rptView = v; App.renderReports() }
  App.setRptMonth = function(m) { S.rptMonth = m; App.renderReports() }

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
  /* consolidated: removed legacy _renderAddTxDetail from line 5229 */
  const prevToggleTxFlag41 = App._toggleTxFlag?.bind(App)
  /* consolidated: removed legacy _toggleTxFlag from line 5250 */
  const prevSaveTx41 = App.saveTx?.bind(App)
  /* consolidated: removed legacy saveTx from line 5260 */

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


  // Keep --app-height stable after keyboard class changes. This prevents
  // form action bars/sheets from being laid out against the shrunken visual viewport.
  const reassertStableAppHeight = () => {
    const h = Math.round(window.innerHeight || document.documentElement.clientHeight || 0)
    if (h > 0) document.documentElement.style.setProperty('--app-height', `${h}px`)
  }
  document.addEventListener('focusin', ev => {
    if (isFormControl(ev.target)) requestAnimationFrame(reassertStableAppHeight)
  }, true)
  window.visualViewport?.addEventListener('resize', () => {
    if (document.body.classList.contains('keyboard-open')) requestAnimationFrame(reassertStableAppHeight)
  }, { passive:true })

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
          ${card.limit ? `<div style="background:rgba(255,255,255,.2);border-radius:999px;height:8px;overflow:hidden;margin:14px 0 8px"><div style="height:100%;width:${usedPct}%;background:${usedPct > 80 ? '#FCA5A5' : 'rgba(255,255,255,.88)'};border-radius:999px"></div></div><div style="font-size:12px;opacity:.78">ใช้ ${usedPct.toFixed(0)}%${due ? ` · ครบ ${esc(due.dueStr)} (${due.daysLeft} วัน)` : ''}</div>` : ''}
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
  /* consolidated: removed legacy openRewardLedgerScreen from line 5436 */

  App.openRecurringScreen = function v42RecurringScreen() {
    const rows = (S.recurring || []).slice().sort((a,b) => String(a.nextDueDate || '').localeCompare(String(b.nextDueDate || '')))
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>รายการประจำ</h2><button class="btn btn-primary btn-sm" onclick="App.openRecurringForm()" style="width:auto">+ เพิ่ม</button></div><div class="sub-scroll">${rows.length ? rows.map(r => { const due = r.nextDueDate || today(); const dueNow = due <= today(); return `<div class="recurring-item ${r.paused?'paused':''}"><div class="list-item-icon" style="background:${esc(r.color || '#2563EB')}20">${esc(r.icon || '🔁')}</div><div class="list-item-info"><div class="list-item-name">${esc(r.name)}</div><div class="list-item-sub">${money(r.amount)} · ${r.type === 'income' ? 'รายรับ' : 'รายจ่าย'} · ครบกำหนด ${thaiDateShort(due)}${dueNow ? ' · ถึงกำหนดแล้ว' : ''}</div></div><div class="recurring-actions"><button class="icon-btn" onclick="App.postRecurringNow('${esc(r.id)}')">✓</button><button class="icon-btn" onclick="App.snoozeRecurring('${esc(r.id)}',7)">+7</button><button class="icon-btn" onclick="App.skipRecurring('${esc(r.id)}')">ข้าม</button><button class="icon-btn" onclick="App.openRecurringForm('${esc(r.id)}')">✏️</button><button class="icon-btn" onclick="App.deleteRecurring('${esc(r.id)}')">🗑</button></div></div>` }).join('') : App._emptyState('🔁','ยังไม่มีรายการประจำ','')}</div>`)
  }

  // 6) Restore AI financial advisor card on the rolled-back Reports screen.
  const prevReportsV42 = App.renderReports?.bind(App)
  /* consolidated: removed legacy renderReports from line 5462 */

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
            <div class="s-label">สถานะข้อมูล<br>
            <div class="s-value" style="font-weight: 400;">บันทึกเมื่อ: ${esc(lastSaved)}<br>Export ข้อมูล: ${esc(lastExport)}</div></div>
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
          <div style="font-size:12px;color:var(--muted);margin-top:4px">v4.3</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">ข้อมูลหลักเก็บในเครื่องนี้</div>
        </div>
      </div>`
  }

  try { if (S.page === 'more') App.renderMore() } catch (_) {}
})();

/* ============================================================
   V45 Fixes — 5 bugs/UI improvements:
   1. CC benefit screen: editable cycleDay / dueDay
   2. Crypto: expanded symbol map + dynamic refresh + unit save
   3. Cashback confirmation: editable amounts dialog
   4. CC wallet card: restructured due-date row
   5. Wallet page: refresh btn in section header, + in page header
   ============================================================ */
;(function v45Fixes() {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits:2, maximumFractionDigits:2 })
  const today = () => new Date().toISOString().slice(0, 10)
  const walletById = id => (S.wallets || []).find(w => w.id === id)
  const persist = () => { try { Storage.saveAll(S) } catch (_) {} }
  const isInvestType = t => ['gold','crypto','fcd'].includes(t)

  // ═══════════════════════════════════════════════════════════════════
  // FIX 1: openCCBenefitScreen — add editable cycleDay / dueDay section
  // ═══════════════════════════════════════════════════════════════════
  App.openCCBenefitScreen = function v45OpenCCBenefitScreen(cardId, tab = S.ccBenefitTab || 'points') {
    S.ccBenefitTab = tab === 'cashback' ? 'cashback' : 'points'
    const b = S.ccBenefits?.[cardId] || { points:{}, cashback:{} }
    const p = b.points || {}, c = b.cashback || {}
    const w = walletById(cardId) || {}
    const f = (id, label, value, hint='') => `<div class="form-group"><label class="form-label">${label}</label><input class="form-input" type="number" step="1" min="1" max="31" id="${id}" value="${value || ''}" placeholder="1–31">${hint ? `<div class="form-hint">${hint}</div>` : ''}</div>`
    const fDec = (id, label, value, hint='') => `<div class="form-group"><label class="form-label">${label}</label><input class="form-input" type="number" step="0.01" id="${id}" value="${value || ''}" placeholder="0">${hint ? `<div class="form-hint">${hint}</div>` : ''}</div>`
    const statementCard = `<div class="card card-pad" style="margin-bottom:12px">
      <div style="font-size:14px;font-weight:700;margin-bottom:12px">&#x1F4C5; รอบบัญชีบัตร</div>
      <div class="benefit-form-grid">
        ${f('ccb-cycleDay','วันตัดรอบ (1&#x2013;31)', w.cycleDay, 'วันในทุกเดือนที่ระบบตัดรอบบัญชี')}
        ${f('ccb-dueDay','วันครบกำหนดชำระ (1&#x2013;31)', w.dueDay, 'วันในทุกเดือนที่ต้องชำระยอด')}
      </div>
    </div>`
    const pointsForm = `<div class="card card-pad benefit-pane"><div class="benefits-toggle-row"><b>เปิดคะแนนสะสม</b><button class="toggle${p.enabled ? ' on' : ''}" id="ccb-points-enabled" onclick="this.classList.toggle('on')"></button></div><div class="benefit-form-grid">${fDec('ccb-bahtPerPoint','ใช้จ่ายทุก X บาท = 1 คะแนน',p.bahtPerPoint)}${fDec('ccb-multi','คะแนนเพิ่ม X เท่า',p.multiplier||1)}${fDec('ccb-maxTxnPoint','สูงสุด/รายการ',p.maxPerTxn)}${fDec('ccb-maxCyclePoint','สูงสุด/รอบบัญชี',p.maxPerCycle)}</div></div>`
    const cashForm = `<div class="card card-pad benefit-pane"><div class="benefits-toggle-row"><b>เปิด Cashback</b><button class="toggle${c.enabled ? ' on' : ''}" id="ccb-cash-enabled" onclick="this.classList.toggle('on')"></button></div><div class="benefit-form-grid">${fDec('ccb-cbPercent','รับเงินคืน X%',c.percent)}${fDec('ccb-cbMin','ขั้นต่ำ (฿)',c.minSpend)}${fDec('ccb-cbTier','เริ่มขั้นบันไดที่ (฿)',c.tierThreshold)}${fDec('ccb-cbEvery','คิดทุก ๆ X บาท',c.everyBaht||1)}${fDec('ccb-cbMaxTxn','สูงสุด/รายการ (฿)',c.maxPerTxn)}${fDec('ccb-cbMaxCycle','สูงสุด/รอบบัญชี (฿)',c.maxPerCycle)}</div></div>`
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.openCCDetail('${esc(cardId)}')">&#x2190;</button><h2>สิทธิประโยชน์บัตร</h2><button class="btn btn-primary btn-sm" onclick="App.saveCCBenefit('${esc(cardId)}')" style="width:auto">บันทึก</button></div>
      <div class="sub-scroll">
        ${statementCard}
        <div class="benefit-tabs"><button class="benefit-tab ${S.ccBenefitTab==='points'?'active':''}" onclick="App.openCCBenefitScreen('${esc(cardId)}','points')">คะแนนสะสม</button><button class="benefit-tab ${S.ccBenefitTab==='cashback'?'active':''}" onclick="App.openCCBenefitScreen('${esc(cardId)}','cashback')">Cashback</button></div>
        ${S.ccBenefitTab === 'points' ? pointsForm : cashForm}
      </div>`)
  }

  /* consolidated: removed legacy saveCCBenefit from line 5711 */

  // ═══════════════════════════════════════════════════════════════════
  // FIX 2: Crypto — expanded symbol map, dynamic refresh, unit save
  // ═══════════════════════════════════════════════════════════════════
  const CRYPTO_MAP = {
    BTC:'bitcoin', ETH:'ethereum', BNB:'binancecoin', USDT:'tether',
    SOL:'solana', ADA:'cardano', XRP:'ripple', DOGE:'dogecoin',
    DOT:'polkadot', AVAX:'avalanche-2', MATIC:'matic-network',
    LINK:'chainlink', UNI:'uniswap', LTC:'litecoin', ATOM:'cosmos',
    XLM:'stellar', BCH:'bitcoin-cash', ETC:'ethereum-classic',
    FIL:'filecoin', TRX:'tron', NEAR:'near', APT:'aptos',
    OP:'optimism', ARB:'arbitrum', SUI:'sui', PEPE:'pepe',
    SHIB:'shiba-inu', USDC:'usd-coin', TON:'the-open-network',
    HBAR:'hedera-hashgraph', ALGO:'algorand', VET:'vechain',
    MANA:'decentraland', SAND:'the-sandbox', AXS:'axie-infinity',
    CRO:'crypto-com-chain', FTM:'fantom', AAVE:'aave', MKR:'maker',
    INJ:'injective-protocol', IMX:'immutable-x', STX:'blockstack',
    THETA:'theta-token', FLOW:'flow', CHZ:'chiliz', ENJ:'enjincoin',
    GALA:'gala', GMT:'stepn', COMP:'compound-governance-token',
  }

  App._cryptoId = function(w) {
    if (!w) return null
    if (w.coinGeckoId) return w.coinGeckoId
    const sym = String(w.symbol || '').trim().toUpperCase()
    return sym ? (CRYPTO_MAP[sym] || sym.toLowerCase()) : null
  }

  App._investmentUnitPriceTHB = function v45InvestmentPrice(w) {
    if (!w) return 0
    const p = S.marketPrices || {}
    if (w.type === 'gold') return Number(p.thaiGold?.jewelryBuy || p.auroraGold?.jewelryBuy || w.manualPrice || 0)
    if (w.type === 'crypto') {
      const id = App._cryptoId(w)
      return Number((id && p.crypto?.[id]?.thb) || w.manualPrice || 0)
    }
    if (w.type === 'fcd') {
      const cur = String(w.currency || w.symbol || 'USD').toUpperCase()
      const thb = p.fx?.rates?.THB
      return Number((cur === 'THB' ? 1 : cur === 'USD' ? thb : (thb && p.fx?.rates?.[cur] ? thb / p.fx.rates[cur] : 0)) || w.manualPrice || 0)
    }
    return Number(w.manualPrice || 0)
  }

  App._investmentValueTHB = function(w) {
    return isInvestType(w?.type)
      ? ((Number(w.units || 0) * App._investmentUnitPriceTHB(w)) || Number(w.balance || 0))
      : Number(w?.balance || 0)
  }

  const prev_marketText45 = App._marketText?.bind(App)
  /* consolidated: removed legacy _marketText from line 5799 */

  App.refreshMarketPrices = async function v45RefreshMarket() {
    const next = { ...(S.marketPrices || {}) }
    let anyOk = false, goldOk = false
    App.showToast?.('กำลัง Sync ราคา…', 'info')
    const base = new Set(['bitcoin','ethereum','binancecoin','tether'])
    ;(S.wallets || []).filter(w => w.type === 'crypto').forEach(w => {
      const id = App._cryptoId(w); if (id) base.add(id)
    })
    try {
      const ids = [...base].join(',')
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=thb,usd`, { cache:'no-store' })
      if (r.ok) { next.crypto = await r.json(); anyOk = true }
    } catch (_) {}
    try {
      const r = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=THB,EUR,JPY,GBP,CNY', { cache:'no-store' })
      if (r.ok) { next.fx = await r.json(); anyOk = true }
    } catch (_) {}
    try {
      const gold = await App._fetchThaiGoldViaSource?.()
      if (gold?.jewelryBuy) { next.thaiGold = gold; next.auroraGold = gold; anyOk = true; goldOk = true }
    } catch (_) {}
    next.updatedAt = new Date().toISOString()
    S.marketPrices = next
    persist(); App.renderWallets?.(); App.render?.()
    if (goldOk) App.showToast?.('Sync ราคาทองและ Crypto สำเร็จ', 'success')
    else if (anyOk) App.showToast?.('อัปเดต Crypto/FX แล้ว (ราคาทองยังไม่ได้)', 'warn')
    else App.showToast?.('Sync ราคาไม่ได้ ใช้ราคาสำรองแทน', 'error')
  }

  const prevSaveWalletV45 = App.saveWallet?.bind(App) || function(){}
  /* consolidated: removed legacy saveWallet from line 5839 */

  // ═══════════════════════════════════════════════════════════════════
  // FIX 3: markCashbackReceived — editable confirmation dialog
  // ═══════════════════════════════════════════════════════════════════
  App.markCashbackReceived = function v45MarkCashbackReceived(cardId) {
    const st = App.getCardStatement?.(cardId)
    if (!st) { App.showToast?.('ยังไม่มีข้อมูลรอบบัญชี', 'warn'); return }
    const alreadyReceived = (S.rewardLedger || []).some(r =>
      r.type === 'cashback_received' && r.statementId === st.id)
    if (alreadyReceived) { App.showToast?.('รอบบัญชีนี้บันทึก Cashback แล้ว', 'info'); return }
    const cashback = Number(st.reward?.cashback || 0)
    const points   = Number(st.reward?.points   || 0)
    if (!cashback && !points) { App.showToast?.('ไม่มีสิทธิประโยชน์ในรอบนี้', 'warn'); return }
    const dlgId = 'v45-cashback-dlg'
    document.getElementById(dlgId)?.remove()
    document.getElementById('app').insertAdjacentHTML('beforeend', `
      <div id="${dlgId}" class="overlay open" role="dialog" aria-modal="true">
        <div class="overlay-backdrop" onclick="document.getElementById('${dlgId}').remove()"></div>
        <div class="sheet">
          <div class="sheet-handle"></div>
          <div class="sheet-header">
            <h2>ยืนยันรับสิทธิประโยชน์</h2>
            <button class="btn-icon" onclick="document.getElementById('${dlgId}').remove()">✕</button>
          </div>
          <div class="sheet-body">
            <p style="font-size:13px;color:var(--muted);margin-bottom:16px">แก้ไขให้ตรงกับที่ได้รับจริง แล้วกดยืนยัน</p>
            <div class="form-group">
              <label class="form-label">ฟรี! เงินคืนที่ได้รับจริง (฿)</label>
              <input class="form-input" type="number" step="0.01" min="0" id="v45-cb-amount" value="${cashback || ''}">
              <div class="form-hint">ระบบคำนวณ: ${fmt(cashback)} บาท</div>
            </div>
            <div class="form-group">
              <label class="form-label">⭐ คะแนนที่ได้รับจริง</label>
              <input class="form-input" type="number" step="1" min="0" id="v45-cb-points" value="${points || ''}">
              <div class="form-hint">ระบบคำนวณ: ${Number(points).toLocaleString('th-TH',{maximumFractionDigits:0})} คะแนน</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px">
              <button class="btn btn-secondary" onclick="document.getElementById('${dlgId}').remove()">ยกเลิก</button>
              <button class="btn btn-primary" onclick="App._v45ConfirmCashback('${esc(cardId)}','${esc(st.id)}')">✓ ยืนยันรับ</button>
            </div>
          </div>
        </div>
      </div>`)
    setTimeout(() => document.getElementById('v45-cb-amount')?.focus(), 80)
  }

  App._v45ConfirmCashback = function(cardId, statementId) {
    const cashbackAmount = parseFloat(document.getElementById('v45-cb-amount')?.value) || 0
    const pointsAmount   = parseInt(document.getElementById('v45-cb-points')?.value)   || 0
    document.getElementById('v45-cashback-dlg')?.remove()
    const card     = walletById(cardId)
    const ledgerId = Calc.genId()
    if (cashbackAmount > 0) {
      const tx = {
        id:Calc.genId(), type:'income', amount:cashbackAmount, walletId:cardId,
        categoryId:undefined, merchant:'Cashback',
        note:`รับ Cashback ${card?.name || ''}`,
        date:today(), isRewardReceived:true, statementId, rewardLedgerId:ledgerId,
      }
      S.transactions.unshift(tx)
    }
    S.rewardLedger ||= []
    S.rewardLedger.push({
      id:ledgerId, type:'cashback_received', cardId, statementId,
      amount:cashbackAmount, points:pointsAmount, date:today(),
    })
    if (pointsAmount > 0) {
      S.rewardLedger.push({
        id:Calc.genId(), type:'points_received', cardId, statementId,
        amount:0, points:pointsAmount, date:today(),
      })
    }
    App.recalculateWalletBalances?.({ save:false, recordSnapshot:true })
    persist(); App.openRewardLedgerScreen(cardId)
    App.showToast?.(`บันทึกแล้ว: เงินคืน ${fmt(cashbackAmount)} · คะแนน ${pointsAmount.toLocaleString('th-TH')}`, 'success')
  }

  // Reward ledger screen: show points in history rows
  App.openRewardLedgerScreen = function v45RewardLedger(cardId = '') {
    const cards = (S.wallets || []).filter(w => w.type === 'credit')
    const selected = cardId || cards[0]?.id || ''
    const st = selected ? App.getCardStatement?.(selected) : null
    const receivedAlready = !!(st && (S.rewardLedger || []).some(r =>
      r.type === 'cashback_received' && r.statementId === st.id))
    const rows    = st?.purchases || []
    const received = (S.rewardLedger || []).filter(r => !selected || r.cardId === selected)
    const thaiDate = d => { try { return new Date(d).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'}) } catch { return String(d||'') } }
    const rType   = r => r.type === 'cashback_received' ? '💰 รับเงินคืน' : r.type === 'points_received' ? '⭐ รับคะแนน' : esc(r.type)
    const rDetail = r => r.type === 'points_received'
      ? `${Number(r.points||0).toLocaleString('th-TH')} คะแนน`
      : r.amount > 0
        ? `฿${fmt(r.amount)}${r.points ? ` + ${Number(r.points).toLocaleString('th-TH')} คะแนน` : ''}`
        : '–'
    App.openSubScreen(`<div class="sub-header"><button class="btn-icon" onclick="App.closeSubScreen()">←</button><h2>สมุดสิทธิประโยชน์</h2>${st?.reward?.cashback && !receivedAlready ? `<button class="btn btn-primary btn-sm" onclick="App.markCashbackReceived('${esc(selected)}')" style="width:auto">รับสิทธิ์</button>` : ''}</div>
      <div class="sub-scroll">
        <div class="form-group"><label class="form-label">เลือกบัตร</label><select class="form-input" onchange="App.openRewardLedgerScreen(this.value)">${cards.map(c => `<option value="${esc(c.id)}"${c.id===selected?' selected':''}>${esc(c.icon||'')} ${esc(c.name)}</option>`).join('')}</select></div>
        ${st ? `<div class="reward-summary-compact"><div><b>รอบ ${thaiDate(st.start)} – ${thaiDate(st.end)}</b><span>${receivedAlready?'รับสิทธิ์แล้ว':'ยังไม่ได้รับ'}</span><span>กำหนดชำระ ${thaiDate(st.dueDate)}</span></div><div><strong>${Number(st.reward.points||0).toLocaleString('th-TH',{maximumFractionDigits:0})}</strong><span>คะแนน</span></div><div><strong>${fmt(st.reward.cashback||0)}</strong><span>เงินคืน (฿)</span></div></div>` : App._emptyState('💳','ยังไม่มีบัตรเครดิต','')}
        <div class="sec-title">รายการที่นำไปคำนวณ</div>
        <div class="card"><div style="padding:0 16px">${rows.length ? rows.map(t => App._txRow(t)).join('') : App._emptyState('🎁','ยังไม่มีรายการในรอบนี้','')}</div></div>
        <div class="sec-title">ประวัติรับสิทธิ์</div>
        <div class="card card-pad">${received.length ? received.map(r => `<div class="detail-row"><div><span style="font-size:13px;font-weight:600">${rType(r)}</span><div style="font-size:11px;color:var(--muted)">${thaiDate(r.date||'')}</div></div><b>${rDetail(r)}</b></div>`).join('') : '<div style="font-size:13px;color:var(--muted)">ยังไม่มีประวัติ</div>'}</div>
      </div>`)
    setTimeout(() => App._bindTxRows?.('sub-screen'), 0)
  }

  // ═══════════════════════════════════════════════════════════════════
  // FIX 4: CC wallet card — "ครบกำหนดชำระ" left + date below, chip right
  // ═══════════════════════════════════════════════════════════════════
  const prevWalletCardV45 = App._walletCard?.bind(App)
  /* consolidated: removed legacy _walletCard from line 5965 */
  // ═══════════════════════════════════════════════════════════════════
  // FIX 5: Wallet page — refresh in "การลงทุน" header, + in page header
  // ═══════════════════════════════════════════════════════════════════
  App.renderWallets = function v45RenderWallets() {
    const wallets = S.wallets || []
    const assets  = wallets.filter(w => ['bank','cash','ewallet','saving'].includes(w.type))
    const credits = wallets.filter(w => w.type === 'credit')
    const invests = wallets.filter(w => isInvestType(w.type))
    const sumBase = assets.reduce((s,w)  => s + Math.max(0, Number(w.balance||0)), 0)
    const sumInv  = invests.reduce((s,w) => s + Math.max(0, App._investmentValueTHB(w)||Number(w.balance||0)), 0)
    const debt    = credits.reduce((s,w) => s + Math.abs(Number(w.balance||0)), 0)

    const summaryEl = document.getElementById('wallets-summary')
    if (summaryEl) summaryEl.innerHTML = `<div class="wallet-summary-grid wallet-summary-grid-fixed">
      <div class="wallet-summary-card"><span>สินทรัพย์รวม</span>
      <strong class="c-income">${S.settings?.hideMoney ? '฿*****' : fmt(sumBase + sumInv)}</strong></div>
      <div class="wallet-summary-card"><span>หนี้สินรวม</span><strong class="c-expense">${S.settings?.hideMoney ? '฿*****' : fmt(debt)}</strong></div>
    </div>`

    // Inject "+ เพิ่มกระเป๋า" alongside h1 (once only)
    const pageHeader = document.querySelector('#page-wallets .page-header')
if (pageHeader && !pageHeader.querySelector('.wallets-header-add-btn')) {
  const h1 = pageHeader.querySelector('h1')
  if (h1) {
    const row = document.createElement('div')
    row.className = 'wallets-h1-row'
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center'
    h1.replaceWith(row)
    row.appendChild(h1)

    // 1. สร้างกลุ่มสำหรับปุ่ม (Actions Container) เพื่อให้ปุ่มอยู่ด้วยกันทางขวา
    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;gap:8px;align-items:center' // ใช้ gap เพื่อเว้นระยะห่างระหว่างปุ่ม

    // 2. สร้างปุ่ม Refresh
    const refreshBtn = document.createElement('button')
    refreshBtn.className = 'btn btn-secondary btn-sm wallet-section-refresh-btn'
    refreshBtn.innerHTML = '↻ Refresh'
    refreshBtn.onclick = (e) => {
      e.stopPropagation()
      App.refreshMarketPrices()
    }

    // 3. สร้างปุ่ม Add
    const addBtn = document.createElement('button')
    addBtn.className = 'btn btn-primary btn-sm wallets-header-add-btn'
    addBtn.style.cssText = 'width:auto;padding:8px 14px;flex-shrink:0'
    addBtn.textContent = '+ เพิ่มกระเป๋า'
    addBtn.onclick = () => App.openWalletForm(null)

    // 4. เรียงลำดับ: ใส่ Refresh ก่อน แล้วตามด้วย Add เข้าไปในกลุ่ม actions
    actions.appendChild(refreshBtn)
    actions.appendChild(addBtn)

    // 5. นำกลุ่มปุ่มทั้งหมดไปใส่ใน row ต่อจาก h1
    row.appendChild(actions)
  }
}

    const content = document.getElementById('wallets-content')
    if (!content) return
    content.style.display = 'block'; content.style.visibility = 'visible'

    const gold    = (S.marketPrices||{}).thaiGold || (S.marketPrices||{}).auroraGold
    const updated = gold?.fetchedAt ? new Date(gold.fetchedAt).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'}) : ''
    const goldNote = `<div class="wallet-market-note"><b>ราคาทอง:</b><br>ทองรูปพรรณรับซื้อ${gold?.jewelryBuy?` ${fmt(gold.jewelryBuy)}/บาททอง`:' ยังไม่ Sync'}${updated?` · อัปเดต ${esc(updated)}`:''}</div>`

    const empty = txt => `<div class="card card-pad wallet-empty-card">${esc(txt)}</div>`
    const section = (title, icon, list, emptyTxt, grid, extra='') =>
      `<section class="wallet-section-block">
        <div class="wallet-section-title wallet-section-title-row"><span>${icon} ${esc(title)}</span>${extra}</div>
        ${list.length ? `<div class="${grid?'wallet-grid-2':'wallet-list-stack'}">${list.map(App._walletCard).join('')}</div>` : empty(emptyTxt)}
      </section>`

    content.innerHTML = goldNote
      + section('สินทรัพย์', '🏦', assets,  'ยังไม่มีสินทรัพย์', true)
      + section('บัตรเครดิต', '💳', credits, 'ยังไม่มีบัตรเครดิต', false)
      + section('การลงทุน', '📈', invests, 'เพิ่มทอง / Crypto / FCD เพื่อดูราคาอ้างอิง', true)
  }

  try { if (S.page === 'wallets') App.renderWallets() } catch (_) {}
})();

/* ============================================================
   V5.0 Credit-limit groups · Centralized rewards · Record-rewards flow
   ============================================================ */
;(function v50CreditLimitAndRewards(){
  'use strict'

  // ── Shared micro-helpers ────────────────────────────────────
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))
  const money = n => (typeof moneyFmt === 'function' ? moneyFmt(Number(n) || 0) : Calc.fmt(Number(n) || 0))
  const today = () => (typeof getTODAY === 'function' ? getTODAY() : new Date().toISOString().slice(0,10))
  const walletById = id => (S.wallets || []).find(w => w.id === id) || null
  const genId = () => (typeof Calc !== 'undefined' && Calc.genId) ? Calc.genId() : (Date.now().toString(36) + Math.random().toString(36).slice(2))
  const nowISO = () => new Date().toISOString()
  const notify = (msg, type = 'info') => { try { toast(msg, type) } catch { console.log(msg) } }
  const loadV5JSON = (key, def) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : def } catch { return def } }
  const saveV5JSON = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)) } catch (_) {} }

  // Alias showToast → toast (used in V45 with ?.)
  App.showToast = App.showToast || notify

  const TH_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
  function thaiDate(dateStr) {
    const [y,m,d] = String(dateStr || '').split('-').map(Number)
    if (!y||!m||!d) return esc(dateStr || '-')
    return `${d} ${TH_MONTHS_SHORT[m-1]} ${String((y+543)%100).padStart(2,'0')}`
  }
  function thaiDateLong(dateStr) {
    const [y,m,d] = String(dateStr || '').split('-').map(Number)
    if (!y||!m||!d) return esc(dateStr || '-')
    const fullNames = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
    return `${d} ${fullNames[m-1]} ${y+543}`
  }

  const KNOWN_ISSUERS = ['KTC','SCB','KBank','BBL','Krungsri','UOB','TTB','Citi','CIMB','GHB','KBTG','Amex']

  // ── State migration ────────────────────────────────────────
  function migrateToV5() {
    if (!S.creditLimitGroups) S.creditLimitGroups = loadV5JSON('mt_credit_limit_groups', [])
    if (!S.rewardAccounts)    S.rewardAccounts    = loadV5JSON('mt_reward_accounts',     [])
    S.rewardLedger ||= []
    ;(S.wallets || []).filter(w => w.type === 'credit').forEach(w => {
      if (!('issuer' in w))             w.issuer            = ''
      if (!('creditLimitMode' in w))    w.creditLimitMode   = 'individual'
      if (!('creditLimitGroupId' in w)) w.creditLimitGroupId = null
      if (!('rewardAccountId' in w))    w.rewardAccountId   = null
    })
  }
  migrateToV5()

  // ── Extend persist ─────────────────────────────────────────
  const _basePersistV5 = (typeof persist === 'function') ? persist : (() => Storage.saveAll(S))
  persist = function v50Persist() {
    migrateToV5()
    _basePersistV5()
    saveV5JSON('mt_credit_limit_groups', S.creditLimitGroups || [])
    saveV5JSON('mt_reward_accounts',     S.rewardAccounts    || [])
    saveV5JSON('mt_reward_ledger',       S.rewardLedger      || [])
  }

  // ── ═══════════════════════════════════════════════════════
  // CREDIT LIMIT HELPERS
  // ══════════════════════════════════════════════════════════

  App.getCreditLimitGroup = function(groupId) {
    return (S.creditLimitGroups || []).find(g => g.id === groupId) || null
  }

  App.getCreditCardsInLimitGroup = function(groupId) {
    return (S.wallets || []).filter(w => w.type === 'credit' && w.creditLimitGroupId === groupId)
  }

  // Total credit usage for one card (balance already includes all future installment txns)
  App.getCreditUsageForCard = function(cardId) {
    const card = walletById(cardId)
    if (!card || card.type !== 'credit') return 0
    return Math.abs(Number(card.balance || 0))
  }

  // Usage for an entire shared group = sum across linked cards
  App.getCreditUsageForLimitGroup = function(groupId) {
    return App.getCreditCardsInLimitGroup(groupId)
      .reduce((s, c) => s + App.getCreditUsageForCard(c.id), 0)
  }

  // Effective credit limit for a card (shared group limit or individual)
  App.getCreditLimitForCard = function(card) {
    if (!card || card.type !== 'credit') return 0
    if (card.creditLimitMode === 'shared' && card.creditLimitGroupId) {
      const g = App.getCreditLimitGroup(card.creditLimitGroupId)
      return g ? Number(g.limit || 0) : Number(card.limit || 0)
    }
    return Number(card.limit || 0)
  }

  // Available credit for a card (respects shared group)
  App.getAvailableCreditForCard = function(card) {
    if (!card || card.type !== 'credit') return Infinity
    const limit = App.getCreditLimitForCard(card)
    if (!limit) return Infinity
    if (card.creditLimitMode === 'shared' && card.creditLimitGroupId) {
      const used = App.getCreditUsageForLimitGroup(card.creditLimitGroupId)
      return Math.max(0, limit - used)
    }
    const used = App.getCreditUsageForCard(card.id)
    return Math.max(0, limit - used)
  }

  // ── ═══════════════════════════════════════════════════════
  // REWARD ACCOUNT HELPERS
  // ══════════════════════════════════════════════════════════

  App.getRewardAccountForCard = function(cardId) {
    const card = walletById(cardId)
    if (!card || !card.rewardAccountId) return null
    return (S.rewardAccounts || []).find(a => a.id === card.rewardAccountId) || null
  }

  App.getRewardAccountBalance = function(accountId) {
    const acct = (S.rewardAccounts || []).find(a => a.id === accountId)
    if (!acct) return 0
    const opening = Number(acct.openingBalance || 0)
    const net = (S.rewardLedger || [])
      .filter(r => r.accountId === accountId)
      .reduce((s, r) => {
        const pts = Number(r.points || 0)
        if (r.type === 'points_earned' || r.type === 'points_adjustment') return s + pts
        if (r.type === 'points_redeemed') return s - pts
        return s
      }, 0)
    return Math.max(0, opening + net)
  }

  App.getLinkedCardsForAccount = function(accountId) {
    return (S.wallets || []).filter(w => w.type === 'credit' && w.rewardAccountId === accountId)
  }

  // Check if this statement already has a recorded reward entry
  function statementRewardRecorded(statementId) {
    return (S.rewardLedger || []).some(r =>
      r.statementId === statementId &&
      (r.type === 'cashback_received' || r.type === 'points_earned' || r.type === 'cashback_statement_credit' || r.type === 'history_only')
    )
  }

  // ── ═══════════════════════════════════════════════════════
  // UPDATED validateTransactionDraft (shared credit limit aware)
  // ══════════════════════════════════════════════════════════

  const _prevValidate = App.validateTransactionDraft?.bind(App)
  App.validateTransactionDraft = function v50ValidateTx(tx, opts = {}) {
    const { isEdit = false } = opts
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
      if (!isEdit && w.type === 'credit') {
        const limit = App.getCreditLimitForCard(w)
        if (limit > 0) {
          const available = App.getAvailableCreditForCard(w)
          if (amt > available) {
            const modeLabel = (w.creditLimitMode === 'shared' && w.creditLimitGroupId)
              ? '(วงเงินร่วม)' : ''
            return `วงเงินบัตรคงเหลือ ${money(Math.max(0, available))} ${modeLabel} ไม่พอสำหรับ ${money(amt)}`
          }
        }
      }
    } else if (tx.type === 'income') {
      if (!tx.categoryId) return 'กรุณาเลือกหมวดหมู่รายรับ'
    }
    return null
  }

  // ── ═══════════════════════════════════════════════════════
  // UPDATED openWalletForm — adds CC fields
  // ══════════════════════════════════════════════════════════

  App.openWalletForm = function v50OpenWalletForm(walletId) {
    S.editingWalletId = walletId
    const w = walletId ? (S.wallets || []).find(x => x.id === walletId) : null
    const COLORS = ['#2563EB','#7C3AED','#DC2626','#059669','#D97706','#0891B2','#BE185D','#374151']
    const TYPES  = [['bank','🏦','ธนาคาร'],['cash','💵','เงินสด'],['ewallet','📱','E-Wallet'],['credit','💳','บัตรเครดิต'],['gold','🥇','ทอง'],['crypto','₿','Crypto'],['fcd','💱','FCD']]
    const type   = w?.type || 'bank'
    const isCC   = type === 'credit'
    const isInv  = ['gold','crypto','fcd'].includes(type)

    const creditLimitMode = w?.creditLimitMode || 'individual'
    const issuer          = w?.issuer || ''
    const rewardAcctId    = w?.rewardAccountId || ''
    const selectedGroupId = w?.creditLimitGroupId || ''

    const groups   = S.creditLimitGroups || []
    const accounts = S.rewardAccounts    || []

    // Group options
    const groupOpts = groups.map(g => {
      const used  = App.getCreditUsageForLimitGroup(g.id)
      const avail = Math.max(0, g.limit - used)
      return `<option value="${esc(g.id)}"${selectedGroupId===g.id?' selected':''}>${esc(g.name)} (คงเหลือ ${money(avail)})</option>`
    }).join('') + `<option value="new">+ สร้างกลุ่มวงเงินใหม่</option>`

    // Reward account options
    const acctOpts = `<option value="">ไม่มีบัญชีคะแนน</option>` +
      accounts.map(a => {
        const bal = App.getRewardAccountBalance(a.id)
        return `<option value="${esc(a.id)}"${rewardAcctId===a.id?' selected':''}>${esc(a.name)} (${bal.toLocaleString('en-US')} คะแนน)</option>`
      }).join('') +
      `<option value="new">+ สร้างบัญชีคะแนนใหม่</option>`

    // Same-issuer suggestion
    let issuerSuggestion = ''
    if (issuer) {
      const sameIssuerCards = (S.wallets||[]).filter(x => x.id !== walletId && x.type === 'credit' && x.issuer && x.issuer.toLowerCase() === issuer.toLowerCase())
      if (sameIssuerCards.length > 0 && creditLimitMode !== 'shared') {
        const names = sameIssuerCards.map(c => esc(c.name)).join(', ')
        issuerSuggestion = `<div class="form-hint v5-issuer-hint">💡 พบบัตรจากผู้ออกบัตรเดียวกัน: ${names} — ลองเลือก "ใช้วงเงินร่วม"</div>`
      }
    }

    const ccExtraHtml = `
      <div id="wf-cc-extra">
        <div class="form-group">
          <label class="form-label">ผู้ออกบัตร / ธนาคาร</label>
          <input class="form-input" id="wf-issuer" list="wf-issuer-list" value="${esc(issuer)}" placeholder="เช่น KTC, SCB, KBank" oninput="App._onWfIssuerChange()">
          <datalist id="wf-issuer-list">${KNOWN_ISSUERS.map(i=>`<option value="${i}">`).join('')}</datalist>
          <div id="wf-issuer-hint">${issuerSuggestion}</div>
        </div>
        <div class="form-group">
          <label class="form-label">ประเภทวงเงิน</label>
          <div class="v5-limit-mode-tabs">
            <button type="button" class="v5-lm-tab${creditLimitMode==='individual'?' active':''}" onclick="App._selectCreditLimitMode('individual')">วงเงินแยกเฉพาะบัตรนี้</button>
            <button type="button" class="v5-lm-tab${creditLimitMode==='shared'?' active':''}" onclick="App._selectCreditLimitMode('shared')">ใช้วงเงินร่วม</button>
          </div>
          <input type="hidden" id="wf-credit-limit-mode" value="${creditLimitMode}">
        </div>
        <div id="wf-shared-group-section" style="${creditLimitMode==='shared'?'':'display:none'}">
          <div class="form-group">
            <label class="form-label">กลุ่มวงเงินร่วม</label>
            <select class="form-input" id="wf-shared-group-select" onchange="App._onCreditLimitGroupChange()">
              <option value="">— เลือกกลุ่ม —</option>
              ${groupOpts}
            </select>
          </div>
          <div id="wf-new-group-fields" style="${selectedGroupId==='new'?'':'display:none'}">
            <div class="form-group">
              <label class="form-label">ชื่อกลุ่มวงเงินร่วม</label>
              <input class="form-input" id="wf-new-group-name" placeholder="เช่น KTC วงเงินรวม">
            </div>
            <div class="form-group">
              <label class="form-label">วงเงินรวมของกลุ่ม (฿)</label>
              <input class="form-input" type="number" min="0" id="wf-new-group-limit" placeholder="100000">
            </div>
          </div>
        </div>
        <div id="wf-limit-individual" style="${creditLimitMode==='shared'?'display:none':''}">
          <div class="form-group"><label class="form-label">วงเงิน (฿)</label><input class="form-input" type="number" id="wf-limit" value="${w?.limit||''}"></div>
        </div>
        <div class="form-group"><label class="form-label">วันครบกำหนดชำระ</label><input class="form-input" type="number" id="wf-dueday" min="1" max="31" value="${w?.dueDay||''}"></div>
        <div class="form-group"><label class="form-label">วันตัดรอบบัญชี</label><input class="form-input" type="number" id="wf-cycle-day" min="1" max="31" value="${w?.cycleDay||''}"></div>
        <div class="form-group">
          <label class="form-label">บัญชีคะแนนสะสม</label>
          <select class="form-input" id="wf-reward-account-select" onchange="App._onRewardAccountChange()">
            ${acctOpts}
          </select>
        </div>
        <div id="wf-new-account-fields" style="display:none">
          <div class="form-group"><label class="form-label">ชื่อบัญชีคะแนน</label><input class="form-input" id="wf-new-account-name" placeholder="เช่น KTC Forever Points"></div>
          <div class="form-group"><label class="form-label">คะแนนเริ่มต้น / ยอดปัจจุบัน</label><input class="form-input" type="number" min="0" id="wf-new-account-opening" value="0" placeholder="0"></div>
        </div>
      </div>`

    const investHtml = `
      <div id="wf-invest-fields" style="${isInv?'':'display:none'}">
        <div class="form-group"><label class="form-label">Symbol / สกุลเงิน</label><input class="form-input" id="wf-symbol" placeholder="BTC, ETH, USD, บาททอง" value="${w?.symbol||w?.currency||''}"></div>
        <div class="form-group"><label class="form-label">จำนวน Asset</label><input class="form-input" type="number" step="0.00000001" id="wf-units" value="${w?.units||''}" placeholder="เช่น 0.05, 2.5, 1000"></div>
        <div class="form-group"><label class="form-label">ราคาต่อหน่วยสำรอง (บาท)</label><input class="form-input" type="number" step="0.01" id="wf-manual-price" value="${w?.manualPrice||''}"></div>
        <div id="wf-market-price-link" class="market-price-box"></div>
      </div>`

    document.getElementById('wallet-form-title').textContent = w ? 'แก้ไขกระเป๋า' : 'เพิ่มกระเป๋าเงิน'
    document.getElementById('wallet-form-content').innerHTML = `
      <div class="form-group"><label class="form-label">ชื่อกระเป๋า</label><input class="form-input" id="wf-name" value="${esc(w?.name||'')}"></div>
      <div class="form-group">
        <label class="form-label">ประเภท</label>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px" id="wf-type-grid">
          ${TYPES.map(([v,icon,lbl]) => `<button class="cat-btn${type===v?' active':''}" onclick="App._selectWalletType('${v}')" data-type="${v}">${icon}<br><small>${lbl}</small></button>`).join('')}
        </div>
        <input type="hidden" id="wf-type" value="${type}">
      </div>
      <div class="form-group">
        <label class="form-label">สี</label>
        <div class="color-row" id="wf-color-row">
          ${COLORS.map(c => `<div class="color-dot${(w?.color||'#2563EB')===c?' selected':''}" style="background:${c}" onclick="App._selectWalletColor('${c}')" data-color="${c}"></div>`).join('')}
        </div>
        <input type="hidden" id="wf-color" value="${w?.color||'#2563EB'}">
      </div>
      <div class="form-group" id="wf-balance-group" style="${isCC?'display:none':''}">
        <label class="form-label" id="wf-balance-label">${isInv?'มูลค่าปัจจุบัน / ราคาสำรอง (฿)':'มูลค่าปัจจุบัน (฿)'}</label>
        <input class="form-input" type="number" id="wf-balance" value="${w && !isCC ? Math.abs(w.balance) : ''}">
      </div>
      ${isCC ? `<div class="form-group" id="wf-cc-balance-group">
        <label class="form-label">ยอดค้างชำระ (฿)</label>
        <input class="form-input" type="number" id="wf-balance" value="${w ? Math.abs(w.balance||0) : ''}">
      </div>` : ''}
      <div id="wf-cc-fields" style="${isCC?'':'display:none'}">${ccExtraHtml}</div>
      ${investHtml}
      <div class="flex-row" style="margin-top:12px">
        ${w ? `<button class="btn btn-outline flex-1" onclick="App.deleteWallet('${esc(w.id)}')">ลบ</button>` : ''}
        <button class="btn btn-primary${w?'':' flex-1'}" onclick="App.saveWallet()" style="${w?'flex:2':''}">${w ? 'บันทึก' : 'เพิ่มกระเป๋า'}</button>
      </div>`
    App.openOverlay('overlay-wallet-form')
    if (isInv) try { syncInvestmentWalletForm?.(type) } catch (_) {}
  }

  // ── Credit limit mode toggle ────────────────────────────────
  App._selectCreditLimitMode = function(mode) {
    const hidden = document.getElementById('wf-credit-limit-mode')
    if (hidden) hidden.value = mode
    document.querySelectorAll('.v5-lm-tab').forEach(btn => btn.classList.toggle('active', btn.textContent.includes(mode === 'individual' ? 'แยก' : 'ร่วม')))
    const sharedSec = document.getElementById('wf-shared-group-section')
    const indivSec  = document.getElementById('wf-limit-individual')
    if (sharedSec) sharedSec.style.display = mode === 'shared' ? '' : 'none'
    if (indivSec)  indivSec.style.display  = mode === 'shared' ? 'none' : ''
  }

  App._onCreditLimitGroupChange = function() {
    const sel = document.getElementById('wf-shared-group-select')?.value
    const newFields = document.getElementById('wf-new-group-fields')
    if (newFields) newFields.style.display = sel === 'new' ? '' : 'none'
    // Auto-fill new group limit from card's own limit
    if (sel === 'new') {
      const limitInput = document.getElementById('wf-new-group-limit')
      const cardLimit  = document.getElementById('wf-limit')
      if (limitInput && cardLimit && !limitInput.value) limitInput.value = cardLimit.value
    }
  }

  App._onRewardAccountChange = function() {
    const sel = document.getElementById('wf-reward-account-select')?.value
    const newFields = document.getElementById('wf-new-account-fields')
    if (newFields) newFields.style.display = sel === 'new' ? '' : 'none'
  }

  App._onWfIssuerChange = function() {
    const issuer = (document.getElementById('wf-issuer')?.value || '').trim().toLowerCase()
    const hint   = document.getElementById('wf-issuer-hint')
    if (!hint || !issuer) { if (hint) hint.innerHTML = ''; return }
    const editingId = S.editingWalletId
    const sameIssuer = (S.wallets||[]).filter(x => x.id !== editingId && x.type === 'credit' && x.issuer && x.issuer.toLowerCase() === issuer)
    if (sameIssuer.length) {
      const names = sameIssuer.map(c => esc(c.name)).join(', ')
      const mode = document.getElementById('wf-credit-limit-mode')?.value
      hint.innerHTML = mode !== 'shared' ? `<div class="form-hint v5-issuer-hint">💡 พบบัตร ${esc(sameIssuer.length)} ใบจากผู้ออกบัตรนี้: ${names}</div>` : ''
    } else {
      hint.innerHTML = ''
    }
  }

  // ── Updated _selectWalletType ───────────────────────────────
  App._selectWalletType = function v50SelectWalletType(type) {
    document.getElementById('wf-type').value = type
    document.querySelectorAll('#wf-type-grid .cat-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type))
    const isCC  = type === 'credit'
    const isInv = ['gold','crypto','fcd'].includes(type)
    const ccFields = document.getElementById('wf-cc-fields')
    if (ccFields) ccFields.style.display = isCC ? '' : 'none'
    const investFields = document.getElementById('wf-invest-fields')
    if (investFields) investFields.style.display = isInv ? '' : 'none'
    const balGroup   = document.getElementById('wf-balance-group')
    const ccBalGroup = document.getElementById('wf-cc-balance-group')
    if (balGroup)   balGroup.style.display   = isCC ? 'none' : ''
    if (ccBalGroup) ccBalGroup.style.display = isCC ? ''     : 'none'
    const balLabel = document.getElementById('wf-balance-label')
    if (balLabel) balLabel.textContent = isInv ? 'มูลค่าปัจจุบัน / ราคาสำรอง (฿)' : 'มูลค่าปัจจุบัน (฿)'
    const sym = document.getElementById('wf-symbol')
    if (sym && type === 'gold' && !sym.value) { sym.value = 'บาททอง'; sym.readOnly = true }
    else if (sym) sym.readOnly = false
    try { syncInvestmentWalletForm?.(type) } catch (_) {}
  }

  // ── Updated saveWallet ──────────────────────────────────────
  App.saveWallet = function v50SaveWallet() {
    const name  = document.getElementById('wf-name')?.value.trim()
    const type  = document.getElementById('wf-type')?.value || 'bank'
    const color = document.getElementById('wf-color')?.value || '#2563EB'
    const rawBalance = parseFloat(document.getElementById('wf-balance')?.value) || 0
    const isCC  = type === 'credit'
    const isInv = ['gold','crypto','fcd'].includes(type)
    const ICONS = { bank:'🏦', cash:'💵', ewallet:'📱', credit:'💳', saving:'🏦', gold:'🥇', crypto:'₿', fcd:'💱' }

    if (!name) { notify('กรุณากรอกชื่อกระเป๋า', 'error'); return }

    let balance = isCC ? -Math.abs(rawBalance) : rawBalance

    const data = { name, type, color, icon: ICONS[type] || '💳', balance }

    if (isCC) {
      const issuer         = document.getElementById('wf-issuer')?.value.trim() || ''
      const creditLimitMode = document.getElementById('wf-credit-limit-mode')?.value || 'individual'
      const dueDay   = parseInt(document.getElementById('wf-dueday')?.value) || 5
      const cycleDay = parseInt(document.getElementById('wf-cycle-day')?.value) || 25
      let   limit    = parseFloat(document.getElementById('wf-limit')?.value) || 50000

      let creditLimitGroupId = null

      if (creditLimitMode === 'shared') {
        const groupSel = document.getElementById('wf-shared-group-select')?.value
        if (groupSel === 'new') {
          const gName  = document.getElementById('wf-new-group-name')?.value.trim()
          const gLimit = parseFloat(document.getElementById('wf-new-group-limit')?.value) || limit
          if (!gName) { notify('กรุณาระบุชื่อกลุ่มวงเงินร่วม', 'error'); return }
          const newGroup = { id:genId(), name:gName, issuer, limit:gLimit, createdAt:nowISO(), updatedAt:nowISO() }
          S.creditLimitGroups.push(newGroup)
          creditLimitGroupId = newGroup.id
          limit = gLimit
        } else if (groupSel) {
          creditLimitGroupId = groupSel
          const g = App.getCreditLimitGroup(groupSel)
          if (g) limit = g.limit
        }
      }

      // Reward account
      let rewardAccountId = document.getElementById('wf-reward-account-select')?.value || ''
      if (rewardAccountId === 'new') {
        const aName    = document.getElementById('wf-new-account-name')?.value.trim()
        const aOpening = parseInt(document.getElementById('wf-new-account-opening')?.value) || 0
        if (!aName) { notify('กรุณาระบุชื่อบัญชีคะแนน', 'error'); return }
        const newAcct = { id:genId(), name:aName, issuer, type:'points', openingBalance:aOpening, createdAt:nowISO(), updatedAt:nowISO() }
        S.rewardAccounts.push(newAcct)
        rewardAccountId = newAcct.id
      } else if (rewardAccountId === '') {
        rewardAccountId = null
      }

      Object.assign(data, { limit, dueDay, cycleDay, issuer, creditLimitMode, creditLimitGroupId, rewardAccountId })
    }

    if (isInv) {
      const symbol     = document.getElementById('wf-symbol')?.value.trim().toUpperCase() || (type==='gold'?'บาททอง':type==='fcd'?'USD':'')
      const units      = parseFloat(document.getElementById('wf-units')?.value) || 0
      const manualPrice = parseFloat(document.getElementById('wf-manual-price')?.value) || 0
      Object.assign(data, { symbol, currency:type==='fcd'?(symbol||'USD'):undefined, units, manualPrice })
    }

    // Ledger-based opening balance
    const wId   = S.editingWalletId || null
    const flows = typeof App._ledgerFlows === 'function' ? App._ledgerFlows() : { cash:{}, units:{} }
    const r2 = n => Math.round((Number(n)||0)*100)/100
    const r8 = n => Math.round((Number(n)||0)*1e8)/1e8
    if (isInv) {
      const flowU = wId ? Number(flows.units?.[wId]||0) : 0
      data.openingUnits = r8((data.units||0) - flowU)
      const price = App._investmentUnitPriceTHB?.(data) || data.manualPrice || 0
      if (price && data.units) data.balance = r2(data.units * price)
    } else {
      const flowC = wId ? Number(flows.cash?.[wId]||0) : 0
      data.openingBalance = r2(balance - flowC)
    }

    if (S.editingWalletId) {
      const idx = (S.wallets||[]).findIndex(w => w.id === S.editingWalletId)
      if (idx >= 0) S.wallets[idx] = { ...S.wallets[idx], ...data }
    } else {
      S.wallets.push({ id:genId(), ...data })
    }

    App.recalculateWalletBalances?.({ save:false, recordSnapshot:false })
    persist(); App.closeOverlay('overlay-wallet-form'); App.render()
    notify(S.editingWalletId ? 'แก้ไขกระเป๋าแล้ว' : 'เพิ่มกระเป๋าแล้ว', 'success')
  }

  // ── Updated saveCCBenefit — saves cycleDay/dueDay too ────────
  App.saveCCBenefit = function v50SaveCCBenefit(id) {
    const v = i => parseFloat(document.getElementById(i)?.value) || 0
    const w = walletById(id)
    if (!w) return
    const cycleDay = parseInt(document.getElementById('ccb-cycleDay')?.value) || w.cycleDay || 25
    const dueDay   = parseInt(document.getElementById('ccb-dueDay')?.value)   || w.dueDay   || 5
    const idx = (S.wallets||[]).findIndex(x => x.id === id)
    if (idx >= 0) { S.wallets[idx].cycleDay = cycleDay; S.wallets[idx].dueDay = dueDay }
    S.ccBenefits[id] = {
      enabled: false,
      points: {
        enabled: document.getElementById('ccb-points-enabled')?.classList.contains('on'),
        bahtPerPoint:     v('ccb-bahtPerPoint'),
        multiplier:       v('ccb-multi') || 1,
        maxPerTxn:        v('ccb-maxTxnPoint'),
        maxPerCycle:      v('ccb-maxCyclePoint'),
      },
      cashback: {
        enabled: document.getElementById('ccb-cash-enabled')?.classList.contains('on'),
        percent:       v('ccb-cbPercent'),
        minSpend:      v('ccb-cbMin'),
        tierThreshold: v('ccb-cbTier'),
        everyBaht:     v('ccb-cbEvery') || 1,
        maxPerTxn:     v('ccb-cbMaxTxn'),
        maxPerCycle:   v('ccb-cbMaxCycle'),
      },
    }
    persist(); App.openCCDetail(id); notify('บันทึกสิทธิประโยชน์แล้ว', 'success')
  }

  // ── Updated _walletCard — CC shows shared limit context ─────
  const _prevWalletCardV5 = App._walletCard?.bind(App)
  App._walletCard = function v50WalletCard(w) {
    if (w.type !== 'credit') return _prevWalletCardV5 ? _prevWalletCardV5(w) : ''
    const color   = w.color || '#DC2626'
    const name    = `${w.icon||''} ${w.name||''}`.trim()
    const owed    = Math.abs(Number(w.balance||0))
    const limit   = App.getCreditLimitForCard(w)
    const avail   = limit ? App.getAvailableCreditForCard(w) : 0
    const due     = w.dueDay ? Calc.getDueDate(w.dueDay) : null
    const pct     = limit ? Math.min(100, Math.max(0, owed / limit * 100)) : 0
    const editBtn = `<button class="wc-edit-btn" onclick="event.stopPropagation();App.openWalletForm('${esc(w.id)}')" aria-label="แก้ไข">✏️</button>`
    const payBtn  = `<button class="wallet-chip-btn wc-card-pay-btn" onclick="event.stopPropagation();App.openCCPay('${esc(w.id)}')">ชำระ</button>`

    let sharedBadge = ''
    if (w.creditLimitMode === 'shared' && w.creditLimitGroupId) {
      const g       = App.getCreditLimitGroup(w.creditLimitGroupId)
      const gUsed   = App.getCreditUsageForLimitGroup(w.creditLimitGroupId)
      const gAvail  = Math.max(0, (g?.limit||0) - gUsed)
      sharedBadge   = g ? `<div class="v5-shared-badge">วงเงินร่วม ${esc(g.name)} · คงเหลือ ${money(gAvail)}</div>` : ''
    }

    return `<div class="wallet-card wallet-card-colored wallet-card-credit" style="--wallet-color:${esc(color)};--wallet-color-2:${esc(color)}BB" onclick="App.openCCDetail('${esc(w.id)}')">
      <div class="wc-header">
        <div><div class="wc-name">${esc(name)}</div><div class="wc-type">บัตรเครดิต${w.issuer ? ` · ${esc(w.issuer)}` : ''}${limit ? ` · วงเงิน ${money(limit)}` : ''}</div></div>
        <div class="wc-card-actions">${payBtn}${editBtn}</div>
      </div>
      <div class="wc-balance">-${money(owed)}</div>
      ${sharedBadge}
      ${due ? `<div class="cc-due-strip${due.daysLeft<=3?' urgent':''}"><span>ครบกำหนดชำระ</span><em>${due.daysLeft===0?'วันนี้':`อีก ${due.daysLeft} วัน`}</em><strong>${esc(due.dueStr)}</strong></div>` : ''}
      ${limit ? `<div class="wc-limit">
        <div class="wc-prog-bar"><div class="wc-prog-fill" style="width:${pct}%;background:${pct>80?'rgba(252,165,165,.95)':'rgba(255,255,255,.9)'}"></div></div>
        <div class="wc-prog-info"><span>ใช้ ${pct.toFixed(0)}%</span><span>คงเหลือ ${money(avail)}</span></div>
      </div>` : ''}
    </div>`
  }

  // ── Updated openCCDetail — adds credit limit summary ────────
  App.openCCDetail = function v50OpenCCDetail(cardId) {
    const card = walletById(cardId)
    if (!card) return
    const benefit = App._benefit?.(cardId) || {}
    const period  = Calc.getStatementPeriod(card.cycleDay || 25)
    const txns    = (S.transactions||[]).filter(t => t.walletId===cardId).sort((a,b) => String(b.date||'').localeCompare(String(a.date||''))).slice(0,20)
    const cycleTxns = (S.transactions||[]).filter(t => t.walletId===cardId && t.type==='expense' && t.date>=period.start && t.date<=period.end)
    const rewards   = Calc.getCardRewards(cycleTxns, benefit)
    const st        = App.getCardStatement?.(cardId)
    const owed      = Math.abs(Number(card.balance||0))
    const limit     = App.getCreditLimitForCard(card)
    const avail     = App.getAvailableCreditForCard(card)
    const usedPct   = limit ? Math.min((owed/limit)*100, 100) : 0
    const due       = card.dueDay ? Calc.getDueDate(card.dueDay) : null
    const installments = (App.getInstallmentGroups?.() || []).filter(g => g.walletId===cardId).slice(0,3)
    const rewardAcct   = App.getRewardAccountForCard(cardId)

    // Credit limit summary block
    let limitSummaryHtml = ''
    if (limit > 0) {
      const isShared = card.creditLimitMode === 'shared' && card.creditLimitGroupId
      const g = isShared ? App.getCreditLimitGroup(card.creditLimitGroupId) : null
      const groupUsed = isShared ? App.getCreditUsageForLimitGroup(card.creditLimitGroupId) : owed
      limitSummaryHtml = `<div class="card card-pad v5-limit-summary" style="margin-bottom:12px">
        <div class="v5-ls-header">
          <div>
            <div style="font-size:14px;font-weight:800">สรุปวงเงิน</div>
            ${isShared && g ? `<div class="v5-shared-badge-detail">วงเงินร่วม: ${esc(g.name)}</div>` : ''}
          </div>
          <span class="v5-ls-type-badge${isShared?' shared':''}"> ${isShared ? 'วงเงินร่วม' : 'วงเงินเฉพาะบัตร'}</span>
        </div>
        <div class="v5-limit-metrics">
          <div class="v5-lm"><span>${isShared?'วงเงินรวม':'วงเงินบัตร'}</span><strong>${money(limit)}</strong></div>
          <div class="v5-lm"><span>${isShared?'กลุ่มใช้ไป':'ใช้ไป'}</span><strong style="color:var(--expense)">${money(groupUsed)}</strong></div>
          <div class="v5-lm"><span>คงเหลือ</span><strong style="color:var(--income)">${money(avail)}</strong></div>
        </div>
        ${isShared ? `<div style="font-size:12px;color:var(--muted);margin-top:6px">บัตรนี้ใช้ไป ${money(owed)}</div>` : ''}
      </div>`
    }

    // Statement block
    function statusText(s) { return s?.paid ? 'ชำระแล้ว' : 'ค้างชำระ' }
    const stHtml = st ? `<div class="statement-compact statement-compact-th">
      <div class="statement-main">
        <div>
          <b>สรุปรอบบัตรเครดิต</b>
          <span>รอบ ${thaiDate(st.start)} – ${thaiDate(st.end)}</span>
          <span>วันกำหนดชำระ ${thaiDate(st.dueDate)}</span>
        </div>
        <em class="status-pill ${st.paid?'ok':'warn'}">${statusText(st)}</em>
      </div>
      <div class="statement-metrics">
        <div><span>ยอดใช้ในรอบ</span><strong>${money(st.purchaseTotal)}</strong></div>
        <div><span>ชำระแล้ว</span><strong>${money(st.paidTotal)}</strong></div>
        <div><span>ค้างชำระ</span><strong>${money(st.balanceDue)}</strong></div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="App.openRewardLedgerScreen('${esc(cardId)}')">สมุดสิทธิประโยชน์</button>
    </div>` : ''

    // Reward account info
    const rewardAcctHtml = rewardAcct ? `<div class="v5-reward-acct-info"><span>⭐ ${esc(rewardAcct.name)}</span><strong>${App.getRewardAccountBalance(rewardAcct.id).toLocaleString('en-US')} คะแนน</strong></div>` : ''

    // Reward grid + record button
    const hasRewards = rewards.points > 0 || rewards.cashback > 0
    const alreadyRecorded = st && statementRewardRecorded(st.id)
    const recordBtn = hasRewards ? `<button class="btn btn-primary btn-sm v5-record-btn" onclick="App.recordActualRewards('${esc(cardId)}')" style="width:100%;margin-top:8px">${alreadyRecorded ? '✓ บันทึกแล้ว · บันทึกซ้ำ?' : 'บันทึกยอดที่ได้รับจริง'}</button>` : ''

    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.closeSubScreen()">←</button>
        <h2>${esc(card.icon||'')} ${esc(card.name)}</h2>
        <div style="display:flex;gap:6px">
          <button class="btn btn-secondary btn-sm" onclick="App.openWalletForm('${esc(cardId)}')" style="width:auto">แก้ไข</button>
          <button class="btn btn-primary btn-sm" onclick="App.closeSubScreen();App.openCCPay('${esc(cardId)}')" style="width:auto">ชำระ</button>
        </div>
      </div>
      <div class="sub-scroll cc-detail-screen" data-card-id="${esc(cardId)}">
        <div class="cc-hero" style="background:linear-gradient(135deg,${esc(card.color||'#DC2626')},${esc(card.color||'#DC2626')}BB);color:#fff;border:0">
          <div style="font-size:12px;opacity:.75;margin-bottom:14px">รอบบัญชีตัดวันที่ ${card.cycleDay||25} · ชำระวันที่ ${card.dueDay||'-'}</div>
          <div style="font-size:13px;opacity:.72;margin-bottom:4px">ยอดค้างชำระ</div>
          <div class="big">${money(owed)}</div>
          ${limit ? `<div style="background:rgba(255,255,255,.2);border-radius:999px;height:8px;overflow:hidden;margin:14px 0 8px"><div style="height:100%;width:${usedPct}%;background:${usedPct>80?'#FCA5A5':'rgba(255,255,255,.88)'};border-radius:999px"></div></div><div style="font-size:12px;opacity:.78">ใช้ ${usedPct.toFixed(0)}%${due?` · ครบ ${esc(due.dueStr)} (${due.daysLeft} วัน)`:''}</div>` : ''}
        </div>
        ${limitSummaryHtml}
        ${stHtml}
        <div class="card card-pad" style="margin-bottom:12px">
          <div class="cc-detail-header">
            <div>
              <div style="font-size:14px;font-weight:800">สิทธิประโยชน์รอบนี้</div>
              <div style="font-size:12px;color:var(--muted)">${thaiDate(period.start)} ถึง ${thaiDate(period.end)}</div>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="App.openCCBenefitScreen('${esc(cardId)}')" style="width:auto">ตั้งค่า</button>
          </div>
          <div class="reward-grid" style="margin-top:10px">
            <div class="reward-tile"><span>คะแนน</span><strong>${rewards.points.toLocaleString('en-US')}</strong></div>
            <div class="reward-tile"><span>เงินคืน</span><strong>${money(rewards.cashback)}</strong></div>
          </div>
          ${rewardAcctHtml}
          ${recordBtn}
        </div>
        ${App._sectionHeader ? App._sectionHeader('ผ่อนชำระ', 'ดูทั้งหมด', `App.openInstallmentCenter('${esc(cardId)}')`) : ''}
        <div class="card" style="margin-bottom:14px">
          <div style="padding:0 12px">
            ${installments.length ? installments.map(g => `<div class="installment-mini-row"><div><b>${esc(g.merchant)}</b><span>${g.next?`งวด ${g.next.installmentNo}/${g.next.installmentMonths} · ${thaiDate(g.next.date)}`:'ครบแล้ว'}</span></div><strong>${money(g.remaining||0)}</strong></div>`).join('') : App._emptyState?.('🧾','ยังไม่มีรายการผ่อน','') || ''}
          </div>
        </div>
        ${App._sectionHeader ? App._sectionHeader('รายการล่าสุดของบัตรนี้') : ''}
        <div class="card"><div style="padding:0 16px">${txns.length ? txns.map(t => App._txRow(t)).join('') : App._emptyState?.('📋','ยังไม่มีรายการ','') || ''}</div></div>
      </div>`)
    setTimeout(() => App._bindTxRows?.('sub-screen'), 0)
  }

  // ── ═══════════════════════════════════════════════════════
  // RECORD ACTUAL REWARDS FLOW  (replaces markCashbackReceived)
  // ══════════════════════════════════════════════════════════

  App.recordActualRewards = function(cardId) {
    const card = walletById(cardId)
    const st   = App.getCardStatement?.(cardId)
    if (!card || !st) { notify('ยังไม่มีข้อมูลรอบบัญชี', 'warn'); return }

    const calcPoints   = Number(st.reward?.points   || 0)
    const calcCashback = Number(st.reward?.cashback  || 0)
    if (!calcPoints && !calcCashback) { notify('ไม่มีสิทธิประโยชน์ในรอบนี้', 'warn'); return }

    const alreadyRecorded = statementRewardRecorded(st.id)
    const rewardAcct      = App.getRewardAccountForCard(cardId)
    const otherWallets    = (S.wallets||[]).filter(w => w.id !== cardId && w.type !== 'credit')

    // Wallet dropdown for "income" destination
    const walletOpts = otherWallets.map(w =>
      `<option value="${esc(w.id)}">${esc(w.icon||'')} ${esc(w.name)} (${money(w.balance||0)})</option>`
    ).join('')

    const dlgId = 'v50-record-rewards-dlg'
    document.getElementById(dlgId)?.remove()
    document.getElementById('app')?.insertAdjacentHTML('beforeend', `
      <div id="${dlgId}" class="overlay open" role="dialog" aria-modal="true">
        <div class="overlay-backdrop" onclick="document.getElementById('${dlgId}').remove()"></div>
        <div class="sheet" style="max-height:92dvh">
          <div class="sheet-handle"></div>
          <div class="sheet-header">
            <h2>บันทึกยอดที่ได้รับจริง</h2>
            <button class="btn-icon" onclick="document.getElementById('${dlgId}').remove()">✕</button>
          </div>
          <div class="sheet-body" style="overflow-y:auto">
            ${alreadyRecorded ? '<div class="v5-already-recorded-banner">⚠️ รอบนี้บันทึกแล้ว — บันทึกอีกครั้งจะสร้างรายการเพิ่ม</div>' : ''}
            <div class="v5-rr-section">
              <div class="v5-rr-label">บัตร / รอบบัญชี</div>
              <div class="v5-rr-row"><span>${esc(card.icon||'💳')} ${esc(card.name)}</span><span style="color:var(--muted);font-size:13px">${thaiDate(st.start)} – ${thaiDate(st.end)}</span></div>
            </div>
            <div class="v5-rr-section">
              <div class="v5-rr-label">ระบบคำนวณ</div>
              ${calcPoints ? `<div class="v5-rr-row"><span>⭐ คะแนน</span><strong>${calcPoints.toLocaleString('en-US')} pt</strong></div>` : ''}
              ${calcCashback ? `<div class="v5-rr-row"><span>💰 เงินคืน</span><strong>${money(calcCashback)}</strong></div>` : ''}
            </div>
            <div class="v5-rr-section">
              <div class="v5-rr-label">ยอดที่ได้รับจริง</div>
              ${calcPoints ? `<div class="form-group"><label class="form-label">⭐ คะแนนที่ได้รับจริง</label><input class="form-input" type="number" min="0" step="1" id="v50-actual-points" value="${calcPoints}"><div class="form-hint">คำนวณโดยระบบ: ${calcPoints.toLocaleString('en-US')} คะแนน</div></div>` : ''}
              ${calcCashback ? `<div class="form-group"><label class="form-label">💰 เงินคืนที่ได้รับจริง (฿)</label><input class="form-input" type="number" min="0" step="0.01" id="v50-actual-cashback" value="${calcCashback.toFixed(2)}"><div class="form-hint">คำนวณโดยระบบ: ${money(calcCashback)}</div></div>` : ''}
            </div>
            ${calcCashback ? `<div class="v5-rr-section">
              <div class="v5-rr-label">เงินคืนบันทึกเป็น</div>
              <div class="v5-destination-options">
                <label class="v5-dest-option">
                  <input type="radio" name="v50-dest" value="income" checked>
                  <div class="v5-dest-content"><strong>รับเป็นรายรับ</strong><span>สร้างรายรับเข้ากระเป๋าที่เลือก</span></div>
                </label>
                <label class="v5-dest-option">
                  <input type="radio" name="v50-dest" value="statement_credit">
                  <div class="v5-dest-content"><strong>เครดิตคืนลดหนี้บัตร</strong><span>ลดยอดค้างชำระของบัตร ไม่นับเป็นรายรับ</span></div>
                </label>
                <label class="v5-dest-option">
                  <input type="radio" name="v50-dest" value="history_only">
                  <div class="v5-dest-content"><strong>บันทึกเฉพาะประวัติ</strong><span>ไม่กระทบยอดเงินใด</span></div>
                </label>
              </div>
              <div id="v50-income-wallet-row" style="margin-top:10px">
                <div class="form-group">
                  <label class="form-label">กระเป๋าที่รับเงินคืน</label>
                  <select class="form-input" id="v50-income-wallet">${walletOpts}</select>
                </div>
              </div>
            </div>` : ''}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px;padding-bottom:8px">
              <button class="btn btn-secondary" onclick="document.getElementById('${dlgId}').remove()">ยกเลิก</button>
              <button class="btn btn-primary" onclick="App._confirmRecordRewards('${esc(cardId)}','${esc(st.id)}')">✓ บันทึก</button>
            </div>
          </div>
        </div>
      </div>`)

    // Wire up destination radio → show/hide wallet selector
    setTimeout(() => {
      document.querySelectorAll('input[name="v50-dest"]').forEach(radio => {
        radio.addEventListener('change', () => {
          const incRow = document.getElementById('v50-income-wallet-row')
          if (incRow) incRow.style.display = radio.value === 'income' ? '' : 'none'
        })
      })
    }, 80)
  }

  App._confirmRecordRewards = function(cardId, statementId) {
    const actualPoints   = parseInt(document.getElementById('v50-actual-points')?.value)   || 0
    const actualCashback = parseFloat(document.getElementById('v50-actual-cashback')?.value) || 0
    const destination    = document.querySelector('input[name="v50-dest"]:checked')?.value || 'history_only'
    const incomeWalletId = document.getElementById('v50-income-wallet')?.value || ''

    document.getElementById('v50-record-rewards-dlg')?.remove()

    const card       = walletById(cardId)
    const rewardAcct = App.getRewardAccountForCard(cardId)
    const now        = nowISO()
    const ledgerId   = genId()

    // ── Points → reward account ledger
    if (actualPoints > 0) {
      if (rewardAcct) {
        S.rewardLedger.push({ id:genId(), type:'points_earned', accountId:rewardAcct.id, cardId, statementId, points:actualPoints, amount:0, date:today(), note:'รับคะแนนจากรอบบัญชี', createdAt:now })
      } else {
        S.rewardLedger.push({ id:genId(), type:'points_received', cardId, statementId, points:actualPoints, amount:0, date:today(), note:'รับคะแนน (ยังไม่ได้เชื่อมบัญชีคะแนน)', createdAt:now })
      }
    }

    // ── Cashback handling
    if (actualCashback > 0) {
      if (destination === 'income') {
        const wallet = walletById(incomeWalletId)
        if (wallet) {
          const tx = { id:genId(), type:'income', amount:actualCashback, walletId:incomeWalletId, categoryId:'other_income', merchant:'Cashback', note:`รับ Cashback ${card?.name||''}`, date:today(), isRewardReceived:true, statementId, rewardLedgerId:ledgerId }
          S.transactions.unshift(tx)
          S.rewardLedger.push({ id:ledgerId, type:'cashback_received', cardId, statementId, amount:actualCashback, points:0, date:today(), note:'รับเป็นรายรับ', createdAt:now })
          App.recalculateWalletBalances?.({ save:false, recordSnapshot:true })
        } else {
          notify('กรุณาเลือกกระเป๋าที่รับเงินคืน', 'error'); return
        }
      } else if (destination === 'statement_credit') {
        // Reduce card balance (credit back)
        const idx = (S.wallets||[]).findIndex(x => x.id === cardId)
        if (idx >= 0) {
          S.wallets[idx].balance = Math.min(0, Number(S.wallets[idx].balance||0) + actualCashback)
          S.wallets[idx].openingBalance = (S.wallets[idx].openingBalance || 0) + actualCashback
        }
        S.rewardLedger.push({ id:ledgerId, type:'cashback_statement_credit', cardId, statementId, amount:actualCashback, points:0, date:today(), note:'เครดิตคืนลดหนี้บัตร', createdAt:now })
      } else {
        // history_only
        S.rewardLedger.push({ id:ledgerId, type:'cashback_received', cardId, statementId, amount:actualCashback, points:0, date:today(), note:'บันทึกเฉพาะประวัติ', createdAt:now })
      }
    } else if (actualCashback === 0 && actualPoints === 0) {
      notify('ไม่มียอดที่บันทึก', 'warn'); return
    }

    persist()
    notify(`บันทึกแล้ว${actualPoints ? ` · ${actualPoints.toLocaleString('en-US')} คะแนน` : ''}${actualCashback ? ` · ${money(actualCashback)}` : ''}`, 'success')
    App.openRewardLedgerScreen(cardId)
  }

  // Keep markCashbackReceived as alias for backward compat
  App.markCashbackReceived = App.recordActualRewards

  // ── ═══════════════════════════════════════════════════════
  // CENTRALIZED REWARDS BOOK
  // ══════════════════════════════════════════════════════════

  App.openRewardLedgerScreen = function v50RewardBook(cardId = '') {
    migrateToV5()
    const cards    = (S.wallets||[]).filter(w => w.type === 'credit')
    const accounts = S.rewardAccounts || []

    // Account summary section
    const acctSummaryHtml = accounts.length ? accounts.map(acct => {
      const balance  = App.getRewardAccountBalance(acct.id)
      const linked   = App.getLinkedCardsForAccount(acct.id)
      return `<div class="v5-acct-row">
        <div>
          <div class="v5-acct-name">${esc(acct.name)}</div>
          <div class="v5-acct-meta">${esc(acct.issuer||'')}${linked.length ? ` · ${linked.length} บัตร` : ''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div class="v5-acct-pts">${balance.toLocaleString('en-US')}</div>
          <div style="font-size:11px;color:var(--muted)">คะแนน</div>
        </div>
        <button class="icon-btn" onclick="App.openAdjustPointsForm('${esc(acct.id)}')" title="ปรับคะแนน">✏️</button>
      </div>`
    }).join('') : `<div style="font-size:13px;color:var(--muted);padding:12px 0">ยังไม่มีบัญชีคะแนน <button class="btn btn-secondary btn-sm" onclick="App.openRewardAccountForm()" style="width:auto;margin-left:8px">+ เพิ่มบัญชี</button></div>`

    // Pending/receivable rewards per card
    const pendingHtml = cards.map(c => {
      const st  = App.getCardStatement?.(c.id)
      if (!st) return ''
      const hasReward = st.reward?.points > 0 || st.reward?.cashback > 0
      if (!hasReward) return ''
      const recorded = statementRewardRecorded(st.id)
      return `<div class="v5-pending-row">
        <div>
          <div style="font-size:13px;font-weight:700">${esc(c.icon||'💳')} ${esc(c.name)}</div>
          <div style="font-size:12px;color:var(--muted)">รอบ ${thaiDate(st.start)} – ${thaiDate(st.end)}</div>
        </div>
        <div style="text-align:right">
          ${st.reward.points ? `<div style="font-size:12px">⭐ ${st.reward.points.toLocaleString('en-US')} pt</div>` : ''}
          ${st.reward.cashback ? `<div style="font-size:12px">💰 ${money(st.reward.cashback)}</div>` : ''}
        </div>
        <button class="btn ${recorded?'btn-secondary':'btn-primary'} btn-sm" onclick="App.recordActualRewards('${esc(c.id)}')" style="width:auto;flex-shrink:0;font-size:12px">${recorded?'✓ บันทึกแล้ว':'บันทึกยอดที่ได้รับจริง'}</button>
      </div>`
    }).filter(Boolean).join('')

    // History ledger
    const selected  = cardId || cards[0]?.id || ''
    const histRows  = (S.rewardLedger||[])
      .filter(r => !selected || r.cardId === selected || (r.accountId && App.getLinkedCardsForAccount(r.accountId).some(c => c.id === selected)))
      .slice().reverse()
    function rTypeLabel(r) {
      if (r.type === 'cashback_received')       return '💰 รับเงินคืน'
      if (r.type === 'cashback_statement_credit') return '💳 เครดิตคืนลดหนี้'
      if (r.type === 'points_earned')            return '⭐ รับคะแนน'
      if (r.type === 'points_received')          return '⭐ รับคะแนน'
      if (r.type === 'points_adjustment')        return '🔧 ปรับคะแนน'
      if (r.type === 'points_redeemed')          return '🎁 ใช้คะแนน'
      if (r.type === 'history_only')             return '📋 ประวัติ'
      return esc(r.type)
    }
    function rDetail(r) {
      const pts = Number(r.points||0)
      const amt = Number(r.amount||0)
      const parts = []
      if (amt > 0) parts.push(money(amt))
      if (pts !== 0) parts.push(`${pts >= 0 ? '+' : ''}${pts.toLocaleString('en-US')} pt`)
      return parts.join(' · ') || '–'
    }
    const histHtml = histRows.length ? histRows.map(r => {
      const c = r.cardId ? walletById(r.cardId) : null
      return `<div class="detail-row" style="flex-wrap:wrap">
        <div>
          <div style="font-size:13px;font-weight:700">${rTypeLabel(r)}</div>
          <div style="font-size:11px;color:var(--muted)">${thaiDate(r.date||'')}${c ? ` · ${esc(c.name)}` : ''}</div>
          ${r.note ? `<div style="font-size:11px;color:var(--muted)">${esc(r.note)}</div>` : ''}
        </div>
        <strong style="color:${Number(r.points||0)<0||r.type==='points_redeemed'?'var(--expense)':'var(--income)'}">${rDetail(r)}</strong>
      </div>`
    }).join('') : '<div style="font-size:13px;color:var(--muted)">ยังไม่มีประวัติ</div>'

    const filterOpts = `<option value="">ทุกบัตร</option>` + cards.map(c => `<option value="${esc(c.id)}"${c.id===selected?' selected':''}>${esc(c.icon||'')} ${esc(c.name)}</option>`).join('')

    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.closeSubScreen()">←</button>
        <h2>สมุดสิทธิประโยชน์</h2>
        <button class="btn btn-secondary btn-sm" onclick="App.openRewardAccountForm()" style="width:auto">+ บัญชีคะแนน</button>
      </div>
      <div class="sub-scroll">
        <div class="sec-title">บัญชีคะแนนสะสม</div>
        <div class="card card-pad" style="margin-bottom:12px">${acctSummaryHtml}</div>

        <div class="sec-title">สิทธิประโยชน์รอรับ</div>
        <div class="card card-pad" style="margin-bottom:12px">
          ${pendingHtml || '<div style="font-size:13px;color:var(--muted)">ไม่มีสิทธิประโยชน์รอรับในขณะนี้</div>'}
        </div>

        <div class="sec-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>ประวัติรับสิทธิ์</span>
          <select style="font-size:12px;padding:4px 8px;border-radius:8px;border:1px solid var(--border);background:var(--elevated);color:var(--text)" onchange="App.openRewardLedgerScreen(this.value)">${filterOpts}</select>
        </div>
        <div class="card card-pad">${histHtml}</div>
      </div>`)
    setTimeout(() => App._bindTxRows?.('sub-screen'), 0)
  }

  // ── ═══════════════════════════════════════════════════════
  // REWARD ACCOUNT MANAGEMENT
  // ══════════════════════════════════════════════════════════

  App.openRewardAccountForm = function(accountId) {
    const a = accountId ? (S.rewardAccounts||[]).find(x => x.id === accountId) : null
    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openRewardLedgerScreen()">←</button>
        <h2>${a ? 'แก้ไข' : 'เพิ่ม'}บัญชีคะแนน</h2>
        <button class="btn btn-primary btn-sm" onclick="App.saveRewardAccount('${esc(accountId||'')}')" style="width:auto">บันทึก</button>
      </div>
      <div class="sub-scroll">
        <div class="form-group"><label class="form-label">ชื่อบัญชีคะแนน</label><input class="form-input" id="ra-name" value="${esc(a?.name||'')}" placeholder="เช่น KTC Forever Points"></div>
        <div class="form-group">
          <label class="form-label">ผู้ออกบัตร / ธนาคาร</label>
          <input class="form-input" id="ra-issuer" list="ra-issuer-list" value="${esc(a?.issuer||'')}" placeholder="เช่น KTC">
          <datalist id="ra-issuer-list">${KNOWN_ISSUERS.map(i=>`<option value="${i}">`).join('')}</datalist>
        </div>
        <div class="form-group"><label class="form-label">คะแนนเริ่มต้น / ยอดคงเหลือปัจจุบัน</label><input class="form-input" type="number" min="0" id="ra-opening" value="${a?.openingBalance||0}"><div class="form-hint">ใส่ยอดคะแนนที่มีอยู่แล้ว ก่อนเริ่มใช้งานระบบนี้</div></div>
        ${a ? `<button class="btn btn-outline" style="margin-top:8px" onclick="App.deleteRewardAccount('${esc(a.id)}')">ลบบัญชีคะแนนนี้</button>` : ''}
      </div>`)
  }

  App.saveRewardAccount = function(id) {
    const name    = document.getElementById('ra-name')?.value.trim()
    const issuer  = document.getElementById('ra-issuer')?.value.trim() || ''
    const opening = parseInt(document.getElementById('ra-opening')?.value) || 0
    if (!name) { notify('กรุณากรอกชื่อบัญชีคะแนน', 'error'); return }
    if (id) {
      const idx = (S.rewardAccounts||[]).findIndex(a => a.id === id)
      if (idx >= 0) { S.rewardAccounts[idx] = { ...S.rewardAccounts[idx], name, issuer, openingBalance:opening, updatedAt:nowISO() } }
    } else {
      S.rewardAccounts.push({ id:genId(), name, issuer, type:'points', openingBalance:opening, createdAt:nowISO(), updatedAt:nowISO() })
    }
    persist(); App.openRewardLedgerScreen(); notify('บันทึกบัญชีคะแนนแล้ว', 'success')
  }

  App.deleteRewardAccount = function(id) {
    App.showConfirm?.({ title:'ลบบัญชีคะแนน', danger:true, confirmLabel:'ลบ',
      body:'ลบบัญชีคะแนนนี้? บัตรที่เชื่อมอยู่จะไม่มีบัญชีคะแนน',
      onConfirm() {
        S.rewardAccounts = (S.rewardAccounts||[]).filter(a => a.id !== id)
        ;(S.wallets||[]).filter(w => w.rewardAccountId === id).forEach(w => { w.rewardAccountId = null })
        persist(); App.openRewardLedgerScreen(); notify('ลบบัญชีคะแนนแล้ว', 'success')
      }
    })
  }

  App.openAdjustPointsForm = function(accountId) {
    const a = (S.rewardAccounts||[]).find(x => x.id === accountId)
    if (!a) return
    const bal = App.getRewardAccountBalance(accountId)
    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openRewardLedgerScreen()">←</button>
        <h2>ปรับคะแนน</h2>
        <button class="btn btn-primary btn-sm" onclick="App.saveAdjustPoints('${esc(accountId)}')" style="width:auto">บันทึก</button>
      </div>
      <div class="sub-scroll">
        <div class="card card-pad" style="margin-bottom:12px;text-align:center">
          <div style="font-size:13px;color:var(--muted)">คะแนนปัจจุบัน</div>
          <div style="font-size:28px;font-weight:800">${bal.toLocaleString('en-US')}</div>
          <div style="font-size:12px;color:var(--muted)">${esc(a.name)}</div>
        </div>
        <div class="form-group"><label class="form-label">จำนวนคะแนนที่ปรับ (+ เพิ่ม / - ลด)</label><input class="form-input" type="number" id="adj-points" placeholder="เช่น 500 หรือ -200"><div class="form-hint">ใส่ค่าบวกเพื่อเพิ่มคะแนน ใส่ค่าลบเพื่อลดคะแนน</div></div>
        <div class="form-group"><label class="form-label">หมายเหตุ</label><input class="form-input" id="adj-note" placeholder="เช่น คะแนนจากโปรโมชั่น, แก้ไขยอดผิด"></div>
      </div>`)
  }

  App.saveAdjustPoints = function(accountId) {
    const a   = (S.rewardAccounts||[]).find(x => x.id === accountId)
    if (!a) return
    const pts  = parseInt(document.getElementById('adj-points')?.value) || 0
    const note = document.getElementById('adj-note')?.value.trim() || 'ปรับคะแนน'
    if (!pts) { notify('กรุณาระบุจำนวนคะแนน', 'error'); return }
    const bal = App.getRewardAccountBalance(accountId)
    if (bal + pts < 0) { notify(`คะแนนหลังปรับจะติดลบ (${(bal+pts).toLocaleString('en-US')}) กรุณาตรวจสอบ`, 'error'); return }
    S.rewardLedger.push({ id:genId(), type:'points_adjustment', accountId, cardId:'', statementId:'', points:pts, amount:0, date:today(), note, createdAt:nowISO() })
    persist(); App.openRewardLedgerScreen(); notify(`ปรับคะแนน ${pts>0?'+':''}${pts.toLocaleString('en-US')} แล้ว`, 'success')
  }

  // ── ═══════════════════════════════════════════════════════
  // CREDIT LIMIT GROUP MANAGEMENT
  // ══════════════════════════════════════════════════════════

  App.openCreditLimitGroupScreen = function() {
    const groups = S.creditLimitGroups || []
    const rows = groups.map(g => {
      const cards = App.getCreditCardsInLimitGroup(g.id)
      const used  = App.getCreditUsageForLimitGroup(g.id)
      const avail = Math.max(0, g.limit - used)
      const pct   = g.limit ? Math.min(100, used/g.limit*100) : 0
      return `<div class="card card-pad" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1">
            <div style="font-weight:700;font-size:15px;margin-bottom:2px">${esc(g.name)}</div>
            ${g.issuer ? `<div style="font-size:12px;color:var(--muted)">${esc(g.issuer)}</div>` : ''}
            <div style="font-size:12px;color:var(--muted);margin-top:4px">บัตรในกลุ่ม: ${cards.map(c => esc(c.name)).join(', ') || 'ยังไม่มีบัตร'}</div>
          </div>
          <button class="icon-btn" onclick="App.openCreditLimitGroupForm('${esc(g.id)}')">✏️</button>
        </div>
        <div class="v5-limit-metrics" style="margin-top:10px">
          <div class="v5-lm"><span>วงเงินรวม</span><strong>${money(g.limit)}</strong></div>
          <div class="v5-lm"><span>ใช้ไป</span><strong style="color:var(--expense)">${money(used)}</strong></div>
          <div class="v5-lm"><span>คงเหลือ</span><strong style="color:var(--income)">${money(avail)}</strong></div>
        </div>
        <div style="background:var(--elevated);border-radius:999px;height:6px;overflow:hidden;margin-top:8px">
          <div style="height:100%;width:${pct}%;background:${pct>80?'var(--expense)':'var(--primary)'};border-radius:999px"></div>
        </div>
      </div>`
    }).join('')

    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.closeSubScreen()">←</button>
        <h2>กลุ่มวงเงินร่วม</h2>
        <button class="btn btn-primary btn-sm" onclick="App.openCreditLimitGroupForm()" style="width:auto">+ เพิ่ม</button>
      </div>
      <div class="sub-scroll">
        ${rows || App._emptyState?.('💳','ยังไม่มีกลุ่มวงเงินร่วม','สร้างกลุ่มเพื่อใช้วงเงินร่วมระหว่างบัตรหลายใบ') || ''}
      </div>`)
  }

  App.openCreditLimitGroupForm = function(groupId) {
    const g = groupId ? (S.creditLimitGroups||[]).find(x => x.id === groupId) : null
    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openCreditLimitGroupScreen()">←</button>
        <h2>${g ? 'แก้ไข' : 'เพิ่ม'}กลุ่มวงเงินร่วม</h2>
        <button class="btn btn-primary btn-sm" onclick="App.saveCreditLimitGroup('${esc(groupId||'')}')" style="width:auto">บันทึก</button>
      </div>
      <div class="sub-scroll">
        <div class="form-group"><label class="form-label">ชื่อกลุ่ม</label><input class="form-input" id="clg-name" value="${esc(g?.name||'')}" placeholder="เช่น KTC วงเงินรวม"></div>
        <div class="form-group">
          <label class="form-label">ผู้ออกบัตร / ธนาคาร</label>
          <input class="form-input" id="clg-issuer" list="clg-issuer-list" value="${esc(g?.issuer||'')}" placeholder="เช่น KTC">
          <datalist id="clg-issuer-list">${KNOWN_ISSUERS.map(i=>`<option value="${i}">`).join('')}</datalist>
        </div>
        <div class="form-group"><label class="form-label">วงเงินรวมของกลุ่ม (฿)</label><input class="form-input" type="number" min="0" id="clg-limit" value="${g?.limit||''}"></div>
        ${g ? `<button class="btn btn-outline" style="margin-top:8px" onclick="App.deleteCreditLimitGroup('${esc(g.id)}')">ลบกลุ่มนี้</button>` : ''}
      </div>`)
  }

  App.saveCreditLimitGroup = function(id) {
    const name   = document.getElementById('clg-name')?.value.trim()
    const issuer = document.getElementById('clg-issuer')?.value.trim() || ''
    const limit  = parseFloat(document.getElementById('clg-limit')?.value) || 0
    if (!name)    { notify('กรุณาระบุชื่อกลุ่ม', 'error'); return }
    if (limit<=0) { notify('กรุณาระบุวงเงินรวมมากกว่า 0', 'error'); return }
    if (id) {
      const idx = (S.creditLimitGroups||[]).findIndex(g => g.id === id)
      if (idx >= 0) { S.creditLimitGroups[idx] = { ...S.creditLimitGroups[idx], name, issuer, limit, updatedAt:nowISO() } }
    } else {
      S.creditLimitGroups.push({ id:genId(), name, issuer, limit, createdAt:nowISO(), updatedAt:nowISO() })
    }
    persist(); App.openCreditLimitGroupScreen(); notify('บันทึกกลุ่มวงเงินแล้ว', 'success')
  }

  App.deleteCreditLimitGroup = function(id) {
    const linkedCards = App.getCreditCardsInLimitGroup(id)
    App.showConfirm?.({ title:'ลบกลุ่มวงเงินร่วม', danger:true, confirmLabel:'ลบ',
      body:`ลบกลุ่มนี้? บัตร ${linkedCards.length} ใบที่เชื่อมอยู่จะกลับเป็นวงเงินเฉพาะบัตร`,
      onConfirm() {
        S.creditLimitGroups = (S.creditLimitGroups||[]).filter(g => g.id !== id)
        linkedCards.forEach(c => { c.creditLimitMode = 'individual'; c.creditLimitGroupId = null })
        persist(); App.openCreditLimitGroupScreen(); notify('ลบกลุ่มวงเงินแล้ว', 'success')
      }
    })
  }

  // ── ═══════════════════════════════════════════════════════
  // UPDATED exportData / importData
  // ══════════════════════════════════════════════════════════

  const _prevExportV5 = App.exportData?.bind(App)
  App.exportData = function v50ExportData() {
    migrateToV5()
    const now = nowISO()
    const data = {
      exportedAt:now, appVersion:'5.0', storageMode:'local-only',
      transactions:S.transactions, wallets:S.wallets, categories:S.categories,
      budgets:S.budgets, recurring:S.recurring, merchants:S.merchants,
      ccBenefits:S.ccBenefits, incomeBudgets:S.incomeBudgets,
      marketPrices:S.marketPrices||{}, settings:S.settings,
      rewardLedger:S.rewardLedger||[], netWorthSnapshots:S.netWorthSnapshots||[],
      investmentSnapshots:S.investmentSnapshots||[],
      creditLimitGroups:S.creditLimitGroups||[], rewardAccounts:S.rewardAccounts||[],
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `money-tracker-v5-backup-${today()}.json`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    if (S.settings?.storageMeta) S.settings.storageMeta.lastExportedAt = now
    persist(); App.renderMore?.(); notify('ส่งออกข้อมูลสำเร็จ', 'success')
  }

  const _prevImportV5 = App.importData?.bind(App)
  App.importData = function v50ImportData(input) {
    const file = input?.files?.[0]
    if (!file) return
    Storage.importJSON(file, raw => {
      const checked = App._validateImportPayload?.(raw) || { ok:Array.isArray(raw?.transactions)&&Array.isArray(raw?.wallets), errors:[], warnings:[], data:raw }
      if (!checked.ok) { notify('นำเข้าไม่ได้: ' + (checked.errors||[]).join(', '), 'error'); if (input) input.value=''; return }
      const data = checked.data || raw
      App.showConfirm?.({
        title:'ตรวจสอบก่อนนำเข้า', danger:true, confirmLabel:'นำเข้า',
        body:`Wallets: ${data.wallets.length} · Transactions: ${data.transactions.length} · จะแทนที่ข้อมูลปัจจุบันทั้งหมด`,
        onConfirm() {
          try { localStorage.setItem('mt_pre_import_backup', JSON.stringify({ backedUpAt:nowISO(), ...S })) } catch (_) {}
          S.transactions=data.transactions||[]; S.wallets=data.wallets||[]
          S.categories=data.categories||S.categories; S.budgets=data.budgets||[]
          S.recurring=data.recurring||[]; S.merchants=data.merchants||[]
          S.ccBenefits=data.ccBenefits||{}; S.incomeBudgets=data.incomeBudgets||[]
          S.marketPrices=data.marketPrices||{}; S.settings={...(S.settings||{}),...(data.settings||{})}
          S.rewardLedger=data.rewardLedger||[]; S.netWorthSnapshots=data.netWorthSnapshots||[]
          S.investmentSnapshots=data.investmentSnapshots||[]
          S.creditLimitGroups=data.creditLimitGroups||[]; S.rewardAccounts=data.rewardAccounts||[]
          migrateToV5()
          App.ensureLedgerBaselines?.(true); App.recalculateWalletBalances?.({ save:false, recordSnapshot:true })
          persist(); applyTheme?.(); App.render?.()
          notify('นำเข้าสำเร็จ', 'success'); if (input) input.value=''
        },
        onCancel() { if (input) input.value='' }
      })
    }, err => { notify('นำเข้าล้มเหลว: '+err, 'error'); if (input) input.value='' })
  }

  // ── ═══════════════════════════════════════════════════════
  // UPDATED More page — adds credit-group + reward-account links
  // ══════════════════════════════════════════════════════════

  const _prevRenderMoreV5 = App.renderMore?.bind(App)
  App.renderMore = function v50RenderMore() {
    const content = document.getElementById('more-content')
    if (!content) return
    const budgetCount  = (S.budgets||[]).length + (S.incomeBudgets||[]).length
    const meta         = S.settings?.storageMeta || {}
    const lastSaved    = meta.lastSavedAt    ? new Date(meta.lastSavedAt).toLocaleString('th-TH')    : 'ยังไม่บันทึก'
    const lastExport   = meta.lastExportedAt ? new Date(meta.lastExportedAt).toLocaleString('th-TH') : 'ยังไม่เคย Export'
    const currentProxy = String(window.MT_GOLD_PROXY_URL || localStorage.getItem('MT_GOLD_PROXY_URL') || '')
    const ACCENTS = ['#2563EB','#7C3AED','#DC2626','#059669','#D97706','#0891B2','#BE185D','#374151']
    function row({ icon, label, value='', onclick='', danger=false }) {
      return `<div class="settings-row"${onclick?` onclick="${onclick}"`:''}>
        <div class="s-icon">${icon}</div>
        <div class="s-label"${danger?' style="color:var(--expense)"':''}">${label}</div>
        ${value ? `<div class="s-value">${value}</div>` : ''}
        <div class="s-arrow"${danger?' style="color:var(--expense)"':''}>›</div>
      </div>`
    }
    content.innerHTML = `
      <div style="padding:0 16px">
        <div style="font-size:20px;font-weight:800;padding:20px 0 4px">เพิ่มเติม</div>
        <div class="sec-title">เครื่องมือหลัก</div>
        <div class="card card-pad">
          ${row({ icon:'🔁', label:'รายการประจำ', value:`${(S.recurring||[]).length} รายการ`, onclick:'App.openRecurringScreen()' })}
          ${row({ icon:'🧾', label:'ศูนย์ผ่อนชำระ', onclick:'App.openInstallmentCenter()' })}
          ${row({ icon:'🎁', label:'สมุดสิทธิประโยชน์', onclick:'App.openRewardLedgerScreen()' })}
          ${row({ icon:'💳', label:'กลุ่มวงเงินร่วม', value:`${(S.creditLimitGroups||[]).length} กลุ่ม`, onclick:'App.openCreditLimitGroupScreen()' })}
          ${row({ icon:'💰', label:'งบประมาณรายรับ/รายจ่าย', value:budgetCount?`${budgetCount} หมวด`:'ยังไม่ตั้ง', onclick:'App.openBudgetScreen()' })}
        </div>
        <div class="sec-title">จัดการข้อมูล</div>
        <div class="card card-pad">
          ${row({ icon:'🏷️', label:'จัดการหมวดหมู่', value:'รายรับ/รายจ่าย', onclick:"App.openCategoryScreen('expense')" })}
          ${row({ icon:'🏪', label:'ร้านค้า / Platform', value:`${(S.merchants||[]).length} ร้าน`, onclick:'App.openMerchantScreen()' })}
          ${row({ icon:'🔧', label:'ตรวจสอบยอดคงเหลือ', onclick:'App.openBalanceRepairScreen()' })}
        </div>
        <div class="sec-title">สำรองข้อมูล</div>
        <div class="card card-pad">
          ${row({ icon:'📤', label:'ส่งออกข้อมูล (JSON)', onclick:'App.exportData()' })}
          ${row({ icon:'📊', label:'ส่งออก CSV', onclick:'App.exportCSV()' })}
          ${row({ icon:'📥', label:'นำเข้าข้อมูล (JSON)', onclick:"document.getElementById('import-file-v5').click()" })}
          <input type="file" id="import-file-v5" accept=".json" style="display:none" onchange="App.importData(this)">
          ${row({ icon:'🧯', label:'กู้คืน Backup ก่อน Import', onclick:'App.restorePreImportBackup?.()' })}
          <div class="settings-row"><div class="s-icon">💾</div><div class="s-label">สถานะข้อมูล<br><div class="s-value" style="font-weight:400">บันทึกเมื่อ: ${esc(lastSaved)}<br>Export ข้อมูล: ${esc(lastExport)}</div></div></div>
        </div>
        <div class="sec-title">การแสดงผล</div>
        <div class="card card-pad">
          ${row({ icon:'🌙', label:'โหมดมืด', onclick:'App.toggleDark()' })}
          <div style="padding:14px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:15px;font-weight:600;margin-bottom:12px">🎨 สีธีม</div>
            <div class="color-row">${ACCENTS.map(c => `<div class="color-dot${S.settings.accentColor===c?' selected':''}" style="background:${c}" onclick="App.setAccent('${c}')"></div>`).join('')}</div>
          </div>
        </div>
        <div class="sec-title">ระบบ</div>
        <div class="card card-pad">
          <div style="padding:14px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:15px;font-weight:700;margin-bottom:8px">Thai Gold API Proxy</div>
            <input class="form-input" id="gold-proxy-input" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(currentProxy)}" style="margin-bottom:10px">
            <button class="btn btn-primary" onclick="App.saveGoldProxyUrl()">บันทึก Proxy URL</button>
            ${currentProxy ? `<div style="font-size:11px;color:var(--income);margin-top:8px">✓ ตั้งค่าแล้ว</div>` : ''}
          </div>
          ${row({ icon:'🔄', label:'รีเซ็ตข้อมูลทั้งหมด', danger:true, onclick:'App.resetData()' })}
        </div>
        <div style="text-align:center;padding:32px 0 8px">
          <div style="font-size:40px">💰</div>
          <div style="font-size:16px;font-weight:700;margin-top:8px">Money Tracker</div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">v5.0</div>
        </div>
      </div>`
  }

  // ── Apply ──────────────────────────────────────────────────
  try { persist() } catch (_) {}
  try { App.render?.() } catch (_) {}
})();

/* ============================================================
   V6.0 — Targeted fixes:
   1. Data migration: pointPerBahtEvery → bahtPerPoint
   2. Recurring monthly fields (recurringDayOfMonth, durationMonths)
   3. Per-transaction CC reward eligibility toggles in add-tx form
   4. Merchant combo wired to _renderAddTxDetail
   5. cleanTxFromDraft includes reward eligibility flags
   6. openAddTx initialises reward eligibility flags
   7. syncKeyboardClass scrolls focused input into view
   ============================================================ */
;(function v60Fixes(){
  // ── Shared helpers ────────────────────────────────────────────────────────
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))
  const today = () => typeof TODAY !== 'undefined' ? TODAY : new Date().toISOString().slice(0,10)
  function walletById(id) { return (S.wallets || []).find(w => w.id === id) || null }
  function addMonths(dateStr, n) {
    const [y, m, d] = String(dateStr || today()).split('-').map(Number)
    const t = new Date(y, (m || 1) - 1 + n, 1)
    const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()
    return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(Math.min(d || 1, last)).padStart(2,'0')}`
  }
  function clampDay(year, monthIndex, day) {
    return Math.max(1, Math.min(Number(day) || 1, new Date(year, monthIndex + 1, 0).getDate()))
  }
  function addDays(dateStr, days) {
    const [y,m,d] = String(dateStr || today()).split('-').map(Number)
    const dt = new Date(y, (m||1)-1, d||1)
    dt.setDate(dt.getDate() + Number(days || 0))
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
  }
  function notify(msg, type) { App.showToast?.(msg, type) || console.log(msg) }

  // ── 1. Data migration: pointPerBahtEvery → bahtPerPoint ──────────────────
  ;(function migratePointPerBaht() {
    const benefits = S.ccBenefits || {}
    let changed = false
    Object.keys(benefits).forEach(id => {
      const p = benefits[id]?.points || {}
      if (p.pointPerBahtEvery > 0 && !p.bahtPerPoint) {
        p.bahtPerPoint = p.pointPerBahtEvery
        changed = true
      }
      delete p.pointPerBahtEvery
    })
    if (changed) { try { persist() } catch(_){} }
  })()

  // ── 2. Recurring monthly fields ───────────────────────────────────────────
  const _prevOpenRecurringForm = App.openRecurringForm?.bind(App)
  App.openRecurringForm = function v6OpenRecurringForm(id) {
    const r = id ? (S.recurring || []).find(x => x.id === id) : null
    const cats = [...(S.categories?.expense || []), ...(S.categories?.income || [])]
    function isInvestWallet(w) { return ['gold','crypto','fcd'].includes(w.type) }
    const walletOpts = (S.wallets || []).filter(w => w.type !== 'credit' && !isInvestWallet(w))
      .map(w => `<option value="${esc(w.id)}"${r?.walletId===w.id?' selected':''}>${esc(w.icon||'')} ${esc(w.name)}</option>`).join('')
    const isMonthly = r?.recurrenceType === 'monthly'
    const typeOpts = ['expense','income'].map(t =>
      `<option value="${t}"${(r?.type||'expense')===t?' selected':''}>${t==='expense'?'รายจ่าย':'รายรับ'}</option>`
    ).join('')
    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openRecurringScreen()">←</button>
        <h2>${r?'แก้ไข':'เพิ่ม'}รายการประจำ</h2>
        <button class="btn btn-primary btn-sm" onclick="App.saveRecurring('${esc(id||'')}')" style="width:auto">บันทึก</button>
      </div>
      <div class="sub-scroll">
        <div class="form-group"><label class="form-label">ชื่อรายการ</label><input class="form-input" id="rec-name" value="${esc(r?.name||'')}"></div>
        <div class="form-group"><label class="form-label">ประเภท</label><select class="form-input" id="rec-type">${typeOpts}</select></div>
        <div class="form-group"><label class="form-label">จำนวนเงิน</label><input class="form-input" type="number" inputmode="decimal" id="rec-amount" value="${esc(r?.amount||'')}"></div>
        <div class="form-group">
          <label class="form-label">ความถี่</label>
          <select class="form-input" id="rec-rectype" onchange="(function(){var m=this.value==='monthly';document.getElementById('rec-monthly-fields').style.display=m?'':'none';document.getElementById('rec-days-field').style.display=m?'none':''}).call(this)">
            <option value="days"${!isMonthly?' selected':''}>ทุกกี่วัน</option>
            <option value="monthly"${isMonthly?' selected':''}>รายเดือน (วันที่กำหนด)</option>
          </select>
        </div>
        <div id="rec-days-field" style="display:${isMonthly?'none':''}">
          <div class="form-group"><label class="form-label">ทุกกี่วัน</label><input class="form-input" type="number" inputmode="numeric" id="rec-days" value="${esc(r?.everyDays||30)}"></div>
        </div>
        <div id="rec-monthly-fields" style="display:${isMonthly?'':'none'}">
          <div class="form-group"><label class="form-label">วันที่ของเดือน (1–31)</label><input class="form-input" type="number" inputmode="numeric" id="rec-day-of-month" min="1" max="31" value="${esc(r?.recurringDayOfMonth||1)}"><div class="form-hint">ระบบจะปรับให้อัตโนมัติหากเดือนนั้นไม่มีวันดังกล่าว</div></div>
          <div class="form-group"><label class="form-label">จำนวนเดือน (ว่างไว้ = ไม่สิ้นสุด)</label><input class="form-input" type="number" inputmode="numeric" id="rec-duration-months" min="1" value="${esc(r?.durationMonths||'')}" placeholder="ไม่จำกัด"></div>
        </div>
        <div class="form-group"><label class="form-label">เริ่ม / ครบกำหนดถัดไป</label><input class="form-input" type="date" id="rec-next" value="${esc(r?.nextDueDate||r?.startDate||today())}"></div>
        <div class="form-group"><label class="form-label">หมวดหมู่</label><select class="form-input" id="rec-cat">${cats.map(c=>`<option value="${esc(c.id)}"${r?.categoryId===c.id?' selected':''}>${esc(c.icon||'')} ${esc(c.label)}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">กระเป๋าเงิน</label><select class="form-input" id="rec-wallet">${walletOpts}</select></div>
      </div>`)
  }

  App.saveRecurring = function v6SaveRecurring(id) {
    const g = i => document.getElementById(i)
    const name = g('rec-name')?.value?.trim() || ''
    const type = g('rec-type')?.value || 'expense'
    const amount = Number(g('rec-amount')?.value || 0)
    const recType = g('rec-rectype')?.value || 'days'
    const everyDays = parseInt(g('rec-days')?.value || 30)
    const dayOfMonth = Math.max(1, Math.min(31, parseInt(g('rec-day-of-month')?.value || 1) || 1))
    const durationMonths = parseInt(g('rec-duration-months')?.value || 0) || null
    const categoryId = g('rec-cat')?.value || ''
    const walletId = g('rec-wallet')?.value || ''
    const nextDueDateRaw = g('rec-next')?.value || today()
    const catObj = App._findCat?.(categoryId)
    if (!name || amount <= 0 || !walletId || !categoryId) { notify('กรุณากรอกข้อมูลรายการประจำให้ครบ', 'error'); return }

    let nextDueDate = nextDueDateRaw
    if (recType === 'monthly') {
      // Clamp the user-set date to use the correct day of month
      const [y, m] = nextDueDateRaw.split('-').map(Number)
      const clamped = clampDay(y, m - 1, dayOfMonth)
      nextDueDate = `${y}-${String(m).padStart(2,'0')}-${String(clamped).padStart(2,'0')}`
    }

    const data = {
      name, type, amount, everyDays, categoryId,
      categoryName: catObj?.label, icon: catObj?.icon, color: catObj?.color,
      walletId, nextDueDate, paused: false,
      recurrenceType: recType === 'monthly' ? 'monthly' : undefined,
      recurringDayOfMonth: recType === 'monthly' ? dayOfMonth : undefined,
      durationMonths: recType === 'monthly' && durationMonths ? durationMonths : undefined,
    }
    if (!S.recurring) S.recurring = []
    if (id) {
      const idx = S.recurring.findIndex(r => r.id === id)
      if (idx >= 0) S.recurring[idx] = { ...S.recurring[idx], ...data }
    } else {
      S.recurring.push({ id: Calc.genId(), ...data })
    }
    persist(); App.openRecurringScreen(); notify('บันทึกรายการประจำแล้ว', 'success')
  }

  App.postRecurringNow = function v6PostRecurringNow(id) {
    const r = (S.recurring || []).find(x => x.id === id)
    if (!r) return
    const dueDate = r.nextDueDate || today()
    if ((S.transactions || []).some(t => t.sourceRecurringId === id && t.recurringDueDate === dueDate)) {
      notify('รายการนี้ถูกบันทึกสำหรับรอบนี้แล้ว', 'warn'); return
    }
    const tx = { id: Calc.genId(), type: r.type || 'expense', amount: Number(r.amount || 0), walletId: r.walletId, categoryId: r.categoryId, merchant: r.name, note: '🔁 รายการประจำ', date: dueDate <= today() ? today() : dueDate, isRecurring: true, sourceRecurringId: id, recurringDueDate: dueDate }
    const err = App.validateTransactionDraft?.(tx)
    if (err) { notify(err, 'error'); return }
    S.transactions.unshift(tx)
    r.lastPostedAt = today()

    if (r.recurrenceType === 'monthly' && r.recurringDayOfMonth) {
      const next = addMonths(dueDate, 1)
      const [ny, nm] = next.split('-').map(Number)
      const nd = clampDay(ny, nm - 1, r.recurringDayOfMonth)
      r.nextDueDate = `${ny}-${String(nm).padStart(2,'0')}-${String(nd).padStart(2,'0')}`
      if (r.durationMonths) {
        r._postedCount = (r._postedCount || 0) + 1
        if (r._postedCount >= r.durationMonths) r.paused = true
      }
    } else {
      r.nextDueDate = addDays(dueDate, Number(r.everyDays || 30))
    }

    App.recalculateWalletBalances?.({ save: false, recordSnapshot: true })
    persist(); App.openRecurringScreen?.(); notify(`บันทึก "${r.name}" แล้ว`, 'success')
  }

  // Also patch getOverdueRecurring to handle monthly type correctly
  const _prevGetOverdue = typeof getOverdueRecurring !== 'undefined' ? null : null
  // Override via App namespace — the dashboard renderDashboard calls the local getOverdueRecurring
  // We patch it by redefining the function used by renderDashboard:
  App._getOverdueRecurring = function v6GetOverdueRecurring() {
    const t = today()
    return (S.recurring || []).filter(r => {
      if (r.paused) return false
      if (r.recurrenceType === 'monthly') {
        return (r.nextDueDate || t) <= t
      }
      if (!r.nextDueDate) return !r.lastPostedAt
      return r.nextDueDate <= t
    })
  }

  // ── 3. openAddTx: initialise reward eligibility flags ─────────────────────
  const _prevOpenAddTx = App.openAddTx?.bind(App)
  App.openAddTx = function v6OpenAddTx() {
    _prevOpenAddTx?.()
    S.tx.rewardIncludePoints = true
    S.tx.rewardIncludeCashback = true
  }

  // ── 4. cleanTxFromDraft: include reward eligibility flags ─────────────────
  // We patch saveTx to read the flags from S.tx before building the tx object.
  const _prevSaveTx = App.saveTx?.bind(App)
  App.saveTx = function v6SaveTx() {
    // Inject flags into S.tx so any cleanTxFromDraft call picks them up
    if (S.tx.type === 'expense') {
      const w = walletById(S.tx.walletId)
      if (w?.type === 'credit') {
        // flags are already set on S.tx by _toggleRewardFlag or by openAddTx init
        // cleanTxFromDraft currently doesn't copy them — we extend S.tx then call prev
        S.tx._rewardIncludePoints = S.tx.rewardIncludePoints !== false
        S.tx._rewardIncludeCashback = S.tx.rewardIncludeCashback !== false
      }
    }
    _prevSaveTx?.()
  }

  // Patch cleanTxFromDraft indirectly — we need access to the inner function.
  // Since cleanTxFromDraft is a closure, we intercept at the recalculate step instead:
  // The actual fix: override _rewardEstimateForTx to pass the draft with correct flags.
  const _prevRewardEstimate = App._rewardEstimateForTx?.bind(App)
  App._rewardEstimateForTx = function v6RewardEstimate(tx) {
    // If called for the current draft, merge eligibility flags from S.tx
    if (tx && tx.walletId === S.tx?.walletId && !tx.id) {
      tx = {
        ...tx,
        rewardIncludePoints: S.tx?.rewardIncludePoints !== false,
        rewardIncludeCashback: S.tx?.rewardIncludeCashback !== false,
      }
    }
    return _prevRewardEstimate?.(tx) || null
  }

  // ── 5. _toggleRewardFlag ──────────────────────────────────────────────────
  App._toggleRewardFlag = function(key) {
    S.tx[key] = S.tx[key] === false ? true : false
    App._renderAddTxDetail?.()
  }

  // ── 6. _renderAddTxDetail: wire merchant combo + CC reward section ─────────
  const _prevRenderAddTxDetail = App._renderAddTxDetail?.bind(App)
  App._renderAddTxDetail = function v6RenderAddTxDetail() {
    _prevRenderAddTxDetail?.()

    // (a) Wire merchant combo
    const inp = document.getElementById('tx-merchant')
    if (inp && !inp.dataset.v6combo) {
      inp.dataset.v6combo = '1'
      // Remove existing oninput if any and replace
      inp.oninput = null
      inp.addEventListener('focus', () => App._showMerchantDropdown?.(inp.value), { passive: true })
      inp.addEventListener('input', () => {
        App._txField?.('merchant', inp.value)
        App._showMerchantDropdown?.(inp.value)
      })
      inp.addEventListener('blur', () => {
        setTimeout(() => document.getElementById('mt-merchant-dropdown')?.classList.add('hidden'), 180)
      }, { passive: true })
    }

    // (b) CC reward section for CC expense
    const type = S.tx.type
    const walletId = S.tx.walletId
    if (type !== 'expense' || !walletId) return
    const card = walletById(walletId)
    if (!card || card.type !== 'credit') return
    const benefit = App._benefit?.(card.id) || S.ccBenefits?.[card.id] || {}
    const p = benefit.points || {}
    const c = benefit.cashback || {}
    const anyBenefit = benefit.enabled || p.enabled || c.enabled || p.bahtPerPoint > 0 || c.percent > 0
    if (!anyBenefit) return

    // Estimate rewards with current flags
    const amount = Number(S.tx.amount || 0)
    if (!amount) return
    const draftTx = {
      type: 'expense', amount,
      walletId,
      rewardIncludePoints: S.tx.rewardIncludePoints !== false,
      rewardIncludeCashback: S.tx.rewardIncludeCashback !== false,
    }
    const reward = Calc.getCardRewards?.([draftTx], benefit) || { points: 0, cashback: 0 }
    const inclPts = S.tx.rewardIncludePoints !== false
    const inclCb = S.tx.rewardIncludeCashback !== false

    let rows = ''
    if (p.enabled || p.bahtPerPoint > 0) {
      rows += `<div class="tx-reward-toggle-row">
        <span>${reward.points > 0 && inclPts ? `+${reward.points} คะแนน` : 'คะแนนสะสม'}</span>
        <button type="button" class="toggle${inclPts?' on':''}" onclick="App._toggleRewardFlag('rewardIncludePoints')"></button>
      </div>`
    }
    if (c.enabled || c.percent > 0) {
      rows += `<div class="tx-reward-toggle-row">
        <span>${reward.cashback > 0 && inclCb ? `+฿${reward.cashback.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} cashback` : 'Cashback'}</span>
        <button type="button" class="toggle${inclCb?' on':''}" onclick="App._toggleRewardFlag('rewardIncludeCashback')"></button>
      </div>`
    }

    const section = document.createElement('div')
    section.className = 'tx-cc-reward-section'
    section.innerHTML = `<div class="form-label" style="margin-bottom:6px">สิทธิประโยชน์บัตร ${esc(card.icon||'💳')} ${esc(card.name)}</div>${rows}`

    // Insert before add-detail-actions
    const shell = document.querySelector('.add-detail-scroll')
    if (shell && !shell.querySelector('.tx-cc-reward-section')) {
      shell.appendChild(section)
    }
  }

  // ── 7. syncKeyboardClass: scroll focused input into view ──────────────────
  // Patch the existing visualViewport handler to also scroll input into view
  window.visualViewport?.addEventListener('resize', () => {
    const el = document.activeElement
    if (!el || !el.matches?.('input, textarea, select')) return
    requestAnimationFrame(() => {
      el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    })
  }, { passive: true })

  // ── Apply ─────────────────────────────────────────────────────────────────
  try { App.render?.() } catch(_) {}
})();
