;(function () {
  'use strict'

  if (!window.MT_DEMO_MODE || typeof App === 'undefined' || typeof S === 'undefined') return
  if (!window.MT_DEMO_STORAGE_DISABLED) {
    document.body.innerHTML = '<main style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:520px;margin:48px auto;padding:20px;line-height:1.55"><h1>Demo storage ถูกบล็อก</h1><p>Browser นี้ไม่ยอมแยก storage สำหรับ demo จึงหยุดโหลดเพื่อป้องกันข้อมูลจริง</p><p><a href="../rescue.html">เปิดหน้า Rescue</a> · <a href="../index.html">กลับแอปจริง</a></p></main>'
    return
  }

  const esc = App._esc || (s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])))
  const today = () => (typeof getTODAY === 'function' ? getTODAY() : new Date().toISOString().slice(0, 10))
  const month = () => today().slice(0, 7)
  const dateInMonth = (offset, day) => {
    const d = new Date()
    d.setMonth(d.getMonth() + offset)
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`
  }
  const addDays = days => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const id = prefix => `${prefix}_${Math.random().toString(36).slice(2, 9)}`

  function tx(row) {
    return {
      id: id('demo_tx'),
      type: 'expense',
      amount: 0,
      walletId: 'demo_cash',
      categoryId: 'food',
      merchant: '',
      note: '',
      date: today(),
      ...row,
    }
  }

  function seedDemoData(force = false) {
    const marker = 'mt_demo_seeded_v2'
    if (!force && localStorage.getItem(marker) === '1') return

    S.categories = {
      expense: [
        { id: 'food', label: 'อาหาร', icon: '🍔', color: '#EF4444' },
        { id: 'transport', label: 'เดินทาง', icon: '🚗', color: '#F59E0B' },
        { id: 'shopping', label: 'ช้อปปิ้ง', icon: '🛍', color: '#8B5CF6' },
        { id: 'health', label: 'สุขภาพ', icon: '💊', color: '#10B981' },
        { id: 'entertainment', label: 'บันเทิง', icon: '🎬', color: '#3B82F6' },
        { id: 'utility', label: 'ค่าบริการ', icon: '💡', color: '#6366F1' },
        { id: 'travel', label: 'ท่องเที่ยว', icon: '✈️', color: '#0891B2' },
        { id: 'other_expense', label: 'อื่นๆ', icon: '📦', color: '#6B7280' },
      ],
      income: [
        { id: 'salary', label: 'เงินเดือน', icon: '💼', color: '#10B981' },
        { id: 'freelance', label: 'ฟรีแลนซ์', icon: '💻', color: '#3B82F6' },
        { id: 'investment', label: 'ลงทุน', icon: '📈', color: '#F59E0B' },
        { id: 'other_income', label: 'อื่นๆ', icon: '💰', color: '#6B7280' },
      ],
    }

    S.wallets = [
      { id: 'demo_scb', name: 'SCB Main', type: 'bank', icon: '🏦', color: '#6D28D9', balance: 86500 },
      { id: 'demo_cash', name: 'เงินสด', type: 'cash', icon: '💵', color: '#059669', balance: 4200 },
      { id: 'demo_true', name: 'TrueMoney', type: 'ewallet', icon: '📱', color: '#F59E0B', balance: 3100 },
      { id: 'demo_ktc', name: 'KTC Cashback', type: 'credit', icon: '💳', color: '#DC2626', balance: -18750, limit: 80000, cycleDay: 25, dueAfterCycleDays: 10, creditLimitGroupId: 'demo_limit_ktc', rewardAccountId: 'demo_reward_ktc' },
      { id: 'demo_gold', name: 'ทองคำ', type: 'gold', icon: '🥇', color: '#D97706', balance: 36200, symbol: 'XAU' },
      { id: 'demo_btc', name: 'Bitcoin', type: 'crypto', icon: '₿', color: '#F59E0B', balance: 24500, symbol: 'BTC' },
      { id: 'demo_usd', name: 'FCD USD', type: 'fcd', icon: '💱', color: '#0891B2', balance: 18000, symbol: 'USD', currency: 'USD' },
    ]

    S.merchants = [
      { id: 'm_grab', name: 'Grab', emoji: '🚗', color: '#10B981' },
      { id: 'm_shopee', name: 'Shopee', emoji: '🛍', color: '#F97316' },
      { id: 'm_netflix', name: 'Netflix', emoji: '🎬', color: '#DC2626' },
      { id: 'm_lineman', name: 'LINE MAN', emoji: '🍔', color: '#06B6D4' },
      { id: 'm_true', name: 'True Move H', emoji: '📱', color: '#6366F1' },
      { id: 'm_lotus', name: 'Lotus', emoji: '🛒', color: '#059669' },
    ]

    S.transactions = [
      tx({ type: 'income', amount: 65000, walletId: 'demo_scb', categoryId: 'salary', merchant: 'บริษัทตัวอย่าง', note: 'เงินเดือน', date: dateInMonth(0, 25) }),
      tx({ type: 'income', amount: 8500, walletId: 'demo_scb', categoryId: 'freelance', merchant: 'ลูกค้า A', note: 'งานออกแบบ mock campaign', date: dateInMonth(0, 12) }),
      tx({ amount: 185, walletId: 'demo_cash', categoryId: 'food', merchant: 'ข้าวแกงสีลม', date: today() }),
      tx({ amount: 92, walletId: 'demo_true', categoryId: 'transport', merchant: 'BTS', date: today() }),
      tx({ amount: 1240, walletId: 'demo_ktc', categoryId: 'shopping', merchant: 'Shopee', channel: 'online', date: addDays(-1) }),
      tx({ amount: 690, walletId: 'demo_ktc', categoryId: 'entertainment', merchant: 'Netflix', isRecurring: true, date: dateInMonth(0, 3) }),
      tx({ amount: 1880, walletId: 'demo_scb', categoryId: 'utility', merchant: 'MEA', date: dateInMonth(0, 6) }),
      tx({ amount: 430, walletId: 'demo_true', categoryId: 'food', merchant: 'LINE MAN', channel: 'online', date: dateInMonth(0, 8) }),
      tx({ amount: 3200, walletId: 'demo_ktc', categoryId: 'shopping', merchant: 'Lotus', channel: 'offline', date: dateInMonth(0, 11) }),
      tx({ amount: 2100, walletId: 'demo_scb', categoryId: 'health', merchant: 'คลินิกตัวอย่าง', date: dateInMonth(0, 15) }),
      tx({ type: 'transfer', amount: 5000, walletId: 'demo_scb', toWalletId: 'demo_cash', categoryId: '', merchant: '', note: 'ถอนเงินสด', date: dateInMonth(0, 16) }),
      tx({ amount: 4590, walletId: 'demo_ktc', categoryId: 'shopping', merchant: 'Power Mall', isInstallment: true, installmentGroupId: 'demo_install_iphone', installmentNo: 1, installmentMonths: 10, date: dateInMonth(0, 17) }),
      tx({ type: 'income', amount: 65000, walletId: 'demo_scb', categoryId: 'salary', merchant: 'บริษัทตัวอย่าง', note: 'เงินเดือนเดือนก่อน', date: dateInMonth(-1, 25) }),
      tx({ amount: 9400, walletId: 'demo_scb', categoryId: 'travel', merchant: 'Hotel Mock Bangkok', date: dateInMonth(-1, 18) }),
      tx({ amount: 2550, walletId: 'demo_ktc', categoryId: 'shopping', merchant: 'Lazada', channel: 'online', date: dateInMonth(-1, 9) }),
      tx({ amount: 1680, walletId: 'demo_true', categoryId: 'food', merchant: 'Grab Food', channel: 'online', date: dateInMonth(-1, 14) }),
      tx({ amount: 1320, walletId: 'demo_scb', categoryId: 'utility', merchant: 'True Move H', date: dateInMonth(-1, 7) }),
      tx({ amount: 4590, walletId: 'demo_ktc', categoryId: 'shopping', merchant: 'Power Mall', isInstallment: true, installmentGroupId: 'demo_install_iphone', installmentNo: 2, installmentMonths: 10, scheduled: true, date: dateInMonth(1, 17) }),
      tx({ amount: 4590, walletId: 'demo_ktc', categoryId: 'shopping', merchant: 'Power Mall', isInstallment: true, installmentGroupId: 'demo_install_iphone', installmentNo: 3, installmentMonths: 10, scheduled: true, date: dateInMonth(2, 17) }),
    ]

    S.budgets = [
      { categoryId: 'food', monthlyLimit: 6500 },
      { categoryId: 'transport', monthlyLimit: 3000 },
      { categoryId: 'shopping', monthlyLimit: 9000 },
      { categoryId: 'entertainment', monthlyLimit: 1800 },
      { categoryId: 'utility', monthlyLimit: 4500 },
      { categoryId: 'travel', monthlyLimit: 12000 },
    ]
    S.incomeBudgets = [
      { categoryId: 'salary', monthlyLimit: 65000 },
      { categoryId: 'freelance', monthlyLimit: 12000 },
    ]

    S.upcomingBills = [
      { id: 'demo_bill_rent', title: 'ค่าเช่าคอนโด', amount: 16000, amountType: 'fixed', dueDate: addDays(2), categoryId: 'other_expense', walletId: 'demo_scb', merchant: 'Condo Mock', status: 'pending', reminderDaysBefore: [7, 3, 1], note: 'จ่ายผ่านโอนเงิน', source: 'manual', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), paidAt: null, transactionId: null },
      { id: 'demo_bill_power', title: 'ค่าไฟ', amount: 1880, amountType: 'estimated', dueDate: addDays(4), categoryId: 'utility', walletId: 'demo_scb', merchant: 'MEA', status: 'pending', reminderDaysBefore: [3, 1], note: '', source: 'manual', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), paidAt: null, transactionId: null },
      { id: 'demo_bill_phone', title: 'ค่าโทรศัพท์', amount: 699, amountType: 'fixed', dueDate: addDays(-1), categoryId: 'utility', walletId: 'demo_true', merchant: 'True Move H', status: 'pending', reminderDaysBefore: [1], note: 'เลยกำหนดสำหรับโชว์ alert', source: 'manual', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), paidAt: null, transactionId: null },
    ]

    S.recurring = [
      { id: 'demo_rec_salary', name: 'เงินเดือน', type: 'income', amount: 65000, walletId: 'demo_scb', categoryId: 'salary', merchant: 'บริษัทตัวอย่าง', icon: '💼', color: '#10B981', frequency: 'monthly', nextDueDate: dateInMonth(1, 25), paused: false },
      { id: 'demo_rec_netflix', name: 'Netflix', type: 'expense', amount: 690, walletId: 'demo_ktc', categoryId: 'entertainment', merchant: 'Netflix', icon: '🎬', color: '#DC2626', frequency: 'monthly', nextDueDate: dateInMonth(1, 3), paused: false },
      { id: 'demo_rec_internet', name: 'อินเทอร์เน็ตบ้าน', type: 'expense', amount: 899, walletId: 'demo_scb', categoryId: 'utility', merchant: 'AIS Fibre', icon: '🌐', color: '#2563EB', frequency: 'monthly', nextDueDate: addDays(6), paused: false },
    ]

    S.goals = [
      { id: 'demo_goal_emergency', name: 'เงินสำรองฉุกเฉิน', icon: '🛟', mode: 'manual', targetAmount: 180000, currentAmount: 92500, targetDate: dateInMonth(7, 30), monthlyContribution: 12000, status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'demo_goal_trip', name: 'ทริปญี่ปุ่น', icon: '✈️', mode: 'manual', targetAmount: 85000, currentAmount: 38400, targetDate: dateInMonth(5, 15), monthlyContribution: 9000, status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]

    S.privileges = [
      { id: 'demo_priv_shopee', title: 'Shopee ส่วนลด 120 บาท', source: 'shopee', type: 'discount_code', code: 'DEMO120', description: 'ใช้ได้กับร้านที่ร่วมรายการ', expiryDate: addDays(3), quantity: 1, usedQuantity: 0, estimatedValue: 120, actualSavedAmount: 0, usedAt: null, note: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'demo_priv_lineman', title: 'LINE MAN ลดค่าส่ง 50 บาท', source: 'line', type: 'voucher', code: 'LMDEMO50', description: 'ลดค่าส่งช่วงเย็น', expiryDate: addDays(1), quantity: 2, usedQuantity: 0, estimatedValue: 100, actualSavedAmount: 0, usedAt: null, note: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'demo_priv_cafe', title: 'Cafe Mock ซื้อ 1 แถม 1', source: 'brand', type: 'free_item', code: '', description: 'ใช้สิทธิ์ผ่านแอปสมาชิก', expiryDate: addDays(-2), quantity: 1, usedQuantity: 1, estimatedValue: 75, actualSavedAmount: 75, usedAt: addDays(-2), note: 'ใช้แล้ว', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]

    S.creditLimitGroups = [
      { id: 'demo_limit_ktc', name: 'วงเงินร่วม KTC', issuer: 'KTC', limit: 80000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]
    S.rewardAccounts = [
      { id: 'demo_reward_ktc', name: 'KTC Forever Points', issuer: 'KTC', type: 'points', openingBalance: 18450, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]
    S.rewardLedger = [
      { id: 'demo_reward_1', accountId: 'demo_reward_ktc', type: 'earn', points: 420, title: 'คะแนนจาก Shopee', date: dateInMonth(0, 10), note: '' },
      { id: 'demo_reward_2', accountId: 'demo_reward_ktc', type: 'redeem', points: -1200, title: 'แลกเครดิตเงินคืน', date: dateInMonth(-1, 22), note: 'เครดิต 120 บาท' },
    ]
    S.ccBenefitRules = [
      { id: 'demo_rule_base_cashback', cardId: 'demo_ktc', active: true, name: 'เงินคืนพื้นฐาน 1%', type: 'cashback', description: 'เงินคืนทุกยอดใช้จ่าย', cashback: { mode: 'percent', rate: 1 }, allowStacking: false, isBaseRule: true, priority: 10 },
      { id: 'demo_rule_online', cardId: 'demo_ktc', active: true, name: 'ออนไลน์เงินคืน 10%', type: 'cashback', description: 'Shopee, Lazada, LINE MAN สูงสุด 300 บาท/เดือน', suggestedConditions: { channels: ['online'], merchants: ['Shopee', 'Lazada', 'LINE MAN'], minSpend: 500 }, cashback: { mode: 'percent', rate: 10 }, limits: { maxRewardAmountPerCycle: 300 }, allowStacking: false },
      { id: 'demo_rule_points', cardId: 'demo_ktc', active: true, name: 'คะแนน x3 ร้านอาหาร', type: 'points', description: 'ใช้จ่ายหมวดอาหารรับคะแนนพิเศษ', suggestedConditions: { categories: ['food'] }, points: { bahtPerPoint: 25, multiplier: 3, multiplierMode: 'total' }, allowStacking: true },
    ]
    S.ccBenefits = {
      demo_ktc: {
        enabled: true,
        pointsValue: { avgPoints: 799, avgBaht: 100 },
        cashback: { percent: 1, maxPerCycle: 500 },
        points: { bahtPerPoint: 25, multiplier: 1 },
      },
    }
    S.marketPrices = {
      BTC: { thb: 2450000, updatedAt: new Date().toISOString() },
      XAU: { thb: 36200, updatedAt: new Date().toISOString() },
      USD: { thb: 36.2, updatedAt: new Date().toISOString() },
    }
    S.splitPeople = [
      { id: 'demo_person_me', name: 'คุณ', color: '#2563EB' },
      { id: 'demo_person_may', name: 'เมย์', color: '#EC4899' },
      { id: 'demo_person_boss', name: 'บอส', color: '#F59E0B' },
      { id: 'demo_person_ploy', name: 'พลอย', color: '#10B981' },
    ]
    S.splitBills = [
      {
        id: 'demo_split_dinner',
        title: 'Dinner team demo',
        date: addDays(-1),
        currency: 'THB',
        people: S.splitPeople,
        items: [
          { id: 'item_1', name: 'อาหาร', amount: 2840, payerId: 'demo_person_me', participantIds: ['demo_person_me', 'demo_person_may', 'demo_person_boss', 'demo_person_ploy'], splitMode: 'equal' },
          { id: 'item_2', name: 'ของหวาน', amount: 620, payerId: 'demo_person_may', participantIds: ['demo_person_me', 'demo_person_may', 'demo_person_boss'], splitMode: 'equal' },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]
    S.splitBillDraft = null
    S.settings = {
      ...(S.settings || {}),
      darkMode: false,
      accentColor: '#2563EB',
      demoMode: true,
      notifications: {
        budget_alert_enabled: true,
        daily_expense_reminder_enabled: true,
        upcoming_bill_reminder_enabled: true,
      },
    }

    try { Storage.saveAll(S) } catch (_) {}
    try {
      Storage.save(KEYS.splitBills, S.splitBills)
      Storage.save(KEYS.splitPeople, S.splitPeople)
      Storage.save(KEYS.splitBillDraft, null)
      localStorage.setItem(marker, '1')
    } catch (_) {}
  }

  function removeAiSurfaces() {
    document.querySelectorAll('.ai-advisor-card').forEach(el => el.remove())
    const blocked = [
      'AI Financial Coach',
      'ภาพรวมการเงิน',
      'ถามการเงินของคุณ',
      'ลองและเปรียบเทียบแผน',
      'ระบบช่วยคุณ',
      'แผนชีวิตระยะยาว',
      'เข้าใจพฤติกรรม',
      'สรุปของฉัน',
      'วางแผนอนาคต',
    ]
    document.querySelectorAll('.settings-row, .sec-title, .more-tab-pane .card').forEach(el => {
      const text = el.textContent || ''
      if (blocked.some(word => text.includes(word))) el.remove()
    })
    document.querySelectorAll('#more-content .more-tab-pane').forEach(pane => {
      for (let pass = 0; pass < 3; pass += 1) {
        pane.querySelectorAll('.sec-title').forEach(title => {
          const next = title.nextElementSibling
          if (!next || next.classList.contains('sec-title')) title.remove()
        })
      }
    })
  }

  function appendDemoControls() {
    const content = document.getElementById('more-content')
    if (!content || content.querySelector('.demo-controls-card')) return
    const wrap = document.createElement('div')
    wrap.className = 'card card-pad demo-controls-card'
    wrap.style.margin = '16px 0'
    wrap.innerHTML = `
      <div class="sec-title" style="margin-top:0">Demo App</div>
      <div class="settings-row" onclick="App.resetDemoData()">
        <div class="s-icon">↻</div>
        <div class="s-label">รีเซ็ตข้อมูล Demo<div style="font-size:12px;font-weight:400;color:var(--muted);margin-top:2px">โหลดข้อมูล mock กลับมาตั้งต้น</div></div>
        <div class="s-arrow">›</div>
      </div>
      <div class="settings-row" onclick="location.href='../index.html'">
        <div class="s-icon">⌂</div>
        <div class="s-label">กลับแอปจริง</div>
        <div class="s-arrow">›</div>
      </div>`
    content.querySelector('[data-pane="settings"]')?.appendChild(wrap)
  }

  App.resetDemoData = function () {
    try { window.MTDemoStorage?.removeDemoKeys?.() } catch (_) {}
    seedDemoData(true)
    App.showPage('dashboard')
    toast?.('รีเซ็ตข้อมูล Demo แล้ว', 'success')
  }

  seedDemoData()

  const prevRenderReports = App.renderReports?.bind(App)
  App.renderReports = function (...args) {
    const result = prevRenderReports?.(...args)
    removeAiSurfaces()
    return result
  }

  const prevRenderMore = App.renderMore?.bind(App)
  App.renderMore = function (...args) {
    const result = prevRenderMore?.(...args)
    removeAiSurfaces()
    appendDemoControls()
    return result
  }

  try { App.showPage(S.page || 'dashboard') } catch (_) {}
})()
