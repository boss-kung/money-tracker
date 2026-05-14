/* ============================================================
   Money Tracker Notifications
   Firebase Cloud Messaging + Supabase Edge Functions
   ============================================================ */
;(function(){
  'use strict'

  const INSTALL_KEY = 'mt_notification_install_id'
  const FCM_TOKEN_KEY = 'mt_notification_fcm_token'
  const LAST_SYNC_KEY = 'mt_notification_last_snapshot_sync'
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[ch]))

  function notify(message, type = 'info') {
    try { toast(message, type) } catch (_) { console.log(message) }
  }

  function defaultPrefs() {
    return {
      enabled: false,
      daily_expense_enabled: false,
      daily_expense_time: '20:30',
      upcoming_bill_enabled: false,
      credit_card_due_enabled: false,
      budget_alert_enabled: false,
      recurring_enabled: false,
      backup_reminder_enabled: false,
      monthly_summary_enabled: false,
      hide_amounts_in_notification: Boolean(S.settings?.hideMoney),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok',
      customRules: [],
      seededDefaultRuleV1: false,
    }
  }

  function defaultDailyExpenseRule() {
    return normalizeCustomRule({
      id: 'default_daily_expense_2030',
      enabled: true,
      title: 'อย่าลืมจดรายจ่ายวันนี้',
      body: 'ใช้เวลาแป๊บเดียว แล้วรายงานเดือนนี้จะแม่นขึ้น',
      route: 'addTx',
      actionLabel: 'เพิ่มรายการ',
      triggerType: 'daily_time',
      triggerConfig: { time: '20:30' },
    })
  }

  function ensureSettings() {
    S.settings ||= {}
    S.settings.notifications ||= {}
    S.settings.notifications = { ...defaultPrefs(), ...S.settings.notifications }
    if (!Array.isArray(S.settings.notifications.customRules)) S.settings.notifications.customRules = []
    if (!S.settings.notifications.seededDefaultRuleV1) {
      if (!S.settings.notifications.customRules.length) {
        S.settings.notifications.customRules = [defaultDailyExpenseRule()]
      }
      S.settings.notifications.seededDefaultRuleV1 = true
      try { persist() } catch (_) {}
    }
    return S.settings.notifications
  }

  function getInstallId() {
    try {
      let id = localStorage.getItem(INSTALL_KEY)
      if (!id) {
        id = `mt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
        localStorage.setItem(INSTALL_KEY, id)
      }
      return id
    } catch (_) {
      return `mt_session_${Date.now().toString(36)}`
    }
  }

  function getConfig() {
    const supabaseUrl = String(window.MT_SUPABASE_URL || '').replace(/\/+$/, '')
    return {
      supabaseUrl,
      supabaseAnonKey: String(window.MT_SUPABASE_ANON_KEY || ''),
      functionsUrl: supabaseUrl ? `${supabaseUrl}/functions/v1` : '',
      firebaseConfig: window.MT_FIREBASE_CONFIG || null,
      vapidKey: String(window.MT_FCM_VAPID_KEY || ''),
    }
  }

  function isConfigured() {
    const cfg = getConfig()
    return Boolean(
      cfg.functionsUrl &&
      cfg.supabaseAnonKey &&
      cfg.vapidKey &&
      cfg.firebaseConfig?.apiKey &&
      cfg.firebaseConfig?.projectId &&
      cfg.firebaseConfig?.messagingSenderId &&
      cfg.firebaseConfig?.appId
    )
  }

  async function callFunction(name, payload) {
    const cfg = getConfig()
    if (!cfg.functionsUrl || !cfg.supabaseAnonKey) throw new Error('Supabase notification config is missing')
    const response = await fetch(`${cfg.functionsUrl}/${name}`, {
      method: 'POST',
      headers: {
        apikey: cfg.supabaseAnonKey,
        Authorization: `Bearer ${cfg.supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.error) throw new Error(data.error || `Function ${name} failed`)
    return data
  }

  function platform() {
    const ua = navigator.userAgent || ''
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
    if (/Android/i.test(ua)) return 'android'
    if (/Mac/i.test(navigator.platform || '')) return 'mac'
    if (/Win/i.test(navigator.platform || '')) return 'windows'
    return 'unknown'
  }

  function browserName() {
    const ua = navigator.userAgent || ''
    if (/Edg\//.test(ua)) return 'edge'
    if (/Firefox\//.test(ua)) return 'firefox'
    if (/Chrome\//.test(ua)) return 'chrome'
    if (/Safari\//.test(ua)) return 'safari'
    return 'unknown'
  }

  async function loadFirebaseMessaging() {
    const [{ initializeApp }, { getMessaging, getToken, isSupported }] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js'),
    ])
    const supported = await isSupported().catch(() => false)
    if (!supported) throw new Error('อุปกรณ์หรือเบราว์เซอร์นี้ยังไม่รองรับ FCM Web')
    const app = initializeApp(getConfig().firebaseConfig)
    return { messaging: getMessaging(app), getToken }
  }

  function todayStr() {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function daysBetween(dateStr, ref = todayStr()) {
    const [y, m, d] = String(dateStr || '').split('-').map(Number)
    const [ry, rm, rd] = String(ref || todayStr()).split('-').map(Number)
    if (!y || !m || !d || !ry || !rm || !rd) return 0
    return Math.round((new Date(y, m - 1, d) - new Date(ry, rm - 1, rd)) / 86400000)
  }

  function buildSnapshot() {
    const today = todayStr()
    const txs = Array.isArray(S.transactions) ? S.transactions : []
    const todayTxCount = txs.filter(t => String(t.date || '') === today && ['expense','income','transfer','cc_payment'].includes(String(t.type || ''))).length
    const lastTxDate = txs.map(t => String(t.date || '')).filter(Boolean).sort().pop() || null

    const upcomingBills = (S.upcomingBills || [])
      .filter(b => b?.status === 'pending')
      .map(b => ({
        id: b.id,
        title: b.title,
        dueDate: b.dueDate,
        amount: S.settings?.notifications?.hide_amounts_in_notification ? null : Number(b.amount || 0),
        daysLeft: daysBetween(b.dueDate, today),
        reminderDaysBefore: Array.isArray(b.reminderDaysBefore) ? b.reminderDaysBefore : [],
      }))
      .filter(b => b.daysLeft <= 7)
      .slice(0, 25)

    const creditDue = (S.wallets || [])
      .filter(w => w?.type === 'credit')
      .map(card => {
        const due = App.getCreditCardDueInfo?.(card)
        const amount = Math.abs(Number(card.balance || 0))
        return due?.dateStr ? {
          id: card.id,
          title: card.name,
          dueDate: due.dateStr,
          daysLeft: Number(due.daysLeft ?? daysBetween(due.dateStr, today)),
          amount: S.settings?.notifications?.hide_amounts_in_notification ? null : amount,
        } : null
      })
      .filter(Boolean)
      .filter(row => row.daysLeft <= 7 && row.amount !== 0)
      .slice(0, 25)

    const month = today.slice(0, 7)
    let budgetAlerts = []
    try {
      if (typeof Calc !== 'undefined' && Array.isArray(S.budgets) && S.budgets.length) {
        const progress = Calc.getBudgetProgress(txs, S.budgets, S.categories || { expense: [], income: [] }, month)
        budgetAlerts = (progress || []).map(b => ({
          categoryId: b.categoryId,
          label: b.label || b.categoryId,
          pct: Math.round(b.pct || 0),
          over: Boolean(b.over),
        })).slice(0, 25)
      }
    } catch (_) {}

    const recurringDue = (S.recurring || [])
      .filter(r => !r.paused && r.nextDueDate && r.nextDueDate <= today)
      .map(r => ({ id: r.id, name: r.name }))
      .slice(0, 25)

    const privilegesExpiring = (S.privileges || [])
      .filter(p => p.status === 'active' && p.expiryDate)
      .map(p => ({
        id: p.id,
        title: p.title,
        expiryDate: p.expiryDate,
        daysLeft: daysBetween(p.expiryDate, today),
        type: p.type || '',
        platform: p.platform || '',
      }))
      .filter(p => p.daysLeft >= 0 && p.daysLeft <= 30)
      .slice(0, 25)

    return {
      installId: getInstallId(),
      snapshotDate: today,
      todayTxCount,
      lastTxDate,
      upcomingBills,
      creditDue,
      budgetAlerts,
      recurringDue,
      privilegesExpiring,
      lastExportedAt: S.settings?.storageMeta?.lastExportedAt || null,
      appVersion: window.MT_APP_VERSION || '',
    }
  }

  async function syncSnapshot({ force = false } = {}) {
    if (!isConfigured()) return false
    const now = Date.now()
    const last = Number(localStorage.getItem(LAST_SYNC_KEY) || 0)
    if (!force && now - last < 10 * 60 * 1000) return true
    await callFunction('sync-notification-snapshot', buildSnapshot())
    try { localStorage.setItem(LAST_SYNC_KEY, String(now)) } catch (_) {}
    return true
  }

  async function savePreferences() {
    const prefs = ensureSettings()
    persist()
    if (!isConfigured()) return false
    await callFunction('update-notification-preferences', {
      installId: getInstallId(),
      preferences: {
        ...prefs,
        daily_expense_enabled: false,
        upcoming_bill_enabled: false,
        credit_card_due_enabled: false,
        recurring_enabled: false,
        backup_reminder_enabled: false,
        monthly_summary_enabled: false,
      },
    })
    return true
  }

  function normalizeCustomRule(raw = {}) {
    const triggerType = [
      'daily_time',
      'weekly_time',
      'one_time',
      'no_transaction_today',
      'upcoming_bill_due',
      'credit_card_due',
      'backup_stale',
      'monthly_time',
      'weekday_only_time',
      'no_tx_streak',
      'budget_over',
      'recurring_due_today',
      'privilege_expiry',
    ].includes(raw.triggerType) ? raw.triggerType : 'daily_time'
    return {
      id: String(raw.id || `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`),
      enabled: raw.enabled !== false,
      title: String(raw.title || '').trim(),
      body: String(raw.body || '').trim(),
      route: String(raw.route || 'dashboard'),
      actionLabel: String(raw.actionLabel || 'เปิดดู').trim(),
      triggerType,
      triggerConfig: {
        time: String(raw.triggerConfig?.time || raw.time || '09:00'),
        date: String(raw.triggerConfig?.date || raw.date || todayStr()),
        weekdays: Array.isArray(raw.triggerConfig?.weekdays) ? raw.triggerConfig.weekdays : ['mon','tue','wed','thu','fri'],
        daysBefore: Number(raw.triggerConfig?.daysBefore ?? raw.daysBefore ?? 1),
        staleDays: Number(raw.triggerConfig?.staleDays ?? raw.staleDays ?? 30),
        dayOfMonth: Number(raw.triggerConfig?.dayOfMonth ?? 1),
        streakDays: Number(raw.triggerConfig?.streakDays ?? 3),
        threshold: Number(raw.triggerConfig?.threshold ?? 90),
      },
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || new Date().toISOString(),
    }
  }

  function getCustomRules() {
    const prefs = ensureSettings()
    prefs.customRules = (prefs.customRules || []).map(normalizeCustomRule)
    return prefs.customRules
  }

  function storedFcmToken() {
    try { return localStorage.getItem(FCM_TOKEN_KEY) || '' } catch (_) { return '' }
  }

  async function syncCustomRules() {
    if (!isConfigured()) return false
    await callFunction('sync-notification-rules', {
      installId: getInstallId(),
      rules: getCustomRules(),
      appVersion: window.MT_APP_VERSION || '',
    })
    return true
  }

  function routeLabel(route) {
    return {
      dashboard: 'หน้าหลัก',
      addTx: 'เพิ่มรายการ',
      transactions: 'รายการ',
      wallets: 'กระเป๋า',
      reports: 'รายงาน',
      more: 'เพิ่มเติม',
      upcomingBills: 'รายการรอจ่าย',
      creditCards: 'บัตรเครดิต',
      goals: 'เป้าหมาย',
      recurring: 'รายการประจำ',
      budgets: 'งบประมาณ',
      privileges: 'สิทธิพิเศษ',
    }[route] || 'หน้าหลัก'
  }

  function triggerLabel(rule) {
    const cfg = rule.triggerConfig || {}
    const days = { mon:'จ', tue:'อ', wed:'พ', thu:'พฤ', fri:'ศ', sat:'ส', sun:'อา' }
    if (rule.triggerType === 'daily_time') return `ทุกวัน ${cfg.time || '09:00'}`
    if (rule.triggerType === 'weekly_time') return `ทุกสัปดาห์ ${((cfg.weekdays || []).map(d => days[d] || d).join(', ') || 'ไม่ระบุ')} ${cfg.time || '09:00'}`
    if (rule.triggerType === 'one_time') return `${cfg.date || todayStr()} ${cfg.time || '09:00'}`
    if (rule.triggerType === 'no_transaction_today') return `ถ้าวันนี้ยังไม่มีรายการ เวลา ${cfg.time || '20:30'}`
    if (rule.triggerType === 'upcoming_bill_due') return `บิลครบใน ${Number(cfg.daysBefore ?? 1)} วัน`
    if (rule.triggerType === 'credit_card_due') return `บัตรครบใน ${Number(cfg.daysBefore ?? 1)} วัน`
    if (rule.triggerType === 'backup_stale') return `ไม่ได้ backup ${Number(cfg.staleDays ?? 30)} วัน`
    if (rule.triggerType === 'monthly_time') return `ทุกเดือน วันที่ ${Number(cfg.dayOfMonth ?? 1)} เวลา ${cfg.time || '09:00'}`
    if (rule.triggerType === 'weekday_only_time') return `จ-ศ เวลา ${cfg.time || '09:00'}`
    if (rule.triggerType === 'no_tx_streak') return `ไม่มีรายการ ${Number(cfg.streakDays ?? 3)} วันติด เวลา ${cfg.time || '09:00'}`
    if (rule.triggerType === 'budget_over') return `งบถึง ${Number(cfg.threshold ?? 90)}% เวลา ${cfg.time || '09:00'}`
    if (rule.triggerType === 'recurring_due_today') return `รายการประจำถึงกำหนด เวลา ${cfg.time || '09:00'}`
    if (rule.triggerType === 'privilege_expiry') return `สิทธิพิเศษหมดใน ${Number(cfg.daysBefore ?? 3)} วัน`
    return 'กฎแจ้งเตือน'
  }

  async function enableNotifications() {
    if (location.protocol === 'file:') {
      notify('การแจ้งเตือนต้องเปิดผ่าน http/https หรือ PWA ที่ติดตั้งแล้ว', 'warn')
      return false
    }
    if (!isConfigured()) {
      notify('ยังไม่ได้ตั้งค่า Firebase/Supabase สำหรับ Notification', 'warn')
      return false
    }
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      notify('เบราว์เซอร์นี้ยังไม่รองรับการแจ้งเตือนของ PWA', 'warn')
      return false
    }

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission()
    if (permission !== 'granted') {
      notify('ยังไม่ได้อนุญาตการแจ้งเตือน', 'warn')
      return false
    }

    const registration = await navigator.serviceWorker.ready
    const { messaging, getToken } = await loadFirebaseMessaging()
    const fcmToken = await getToken(messaging, {
      vapidKey: getConfig().vapidKey,
      serviceWorkerRegistration: registration,
    })
    if (!fcmToken) throw new Error('สร้าง FCM token ไม่สำเร็จ')
    try { localStorage.setItem(FCM_TOKEN_KEY, fcmToken) } catch (_) {}

    const prefs = ensureSettings()
    prefs.permission = 'granted'
    prefs.enabled = true
    prefs.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok'
    persist()

    await callFunction('register-notification-device', {
      installId: getInstallId(),
      fcmToken,
      platform: platform(),
      browser: browserName(),
      timezone: prefs.timezone,
      permission,
      enabled: true,
      hideAmounts: Boolean(prefs.hide_amounts_in_notification),
      appVersion: window.MT_APP_VERSION || '',
      userAgent: navigator.userAgent || '',
    })
    await savePreferences()
    await syncCustomRules().catch(() => {})
    await syncSnapshot({ force: true })
    notify('เปิดการแจ้งเตือนแล้ว', 'success')
    App.renderMore?.()
    return true
  }

  async function disableNotifications() {
    const prefs = ensureSettings()
    prefs.enabled = false
    persist()
    if (isConfigured() && storedFcmToken()) {
      await callFunction('register-notification-device', {
        installId: getInstallId(),
        fcmToken: storedFcmToken(),
        platform: platform(),
        browser: browserName(),
        timezone: prefs.timezone,
        permission: Notification.permission || 'default',
        enabled: false,
        hideAmounts: Boolean(prefs.hide_amounts_in_notification),
        appVersion: window.MT_APP_VERSION || '',
        userAgent: navigator.userAgent || '',
      })
    }
    await savePreferences().catch(() => {})
    notify('ปิดการแจ้งเตือนแล้ว', 'success')
    App.renderMore?.()
    return true
  }

  function statusLabel() {
    const prefs = ensureSettings()
    if (!('Notification' in window)) return 'ไม่รองรับ'
    if (!isConfigured()) return 'รอตั้งค่า'
    if (!prefs.enabled) return 'ปิดอยู่'
    if (Notification.permission === 'granted') return 'เปิดแล้ว'
    if (Notification.permission === 'denied') return 'ถูกบล็อก'
    return 'ยังไม่เปิด'
  }

  function renderNotificationSettings() {
    const prefs = ensureSettings()
    const customCount = getCustomRules().length

    return `
      <div class="sec-title">การแจ้งเตือน</div>
      <div class="card card-pad">
        <div class="settings-row" onclick="App.toggleNotificationsMaster()">
          <div class="s-icon">🔔</div>
          <div class="s-label">เปิดการแจ้งเตือน<br><div class="s-value" style="font-weight:400;text-align:left !important">${esc(statusLabel())}</div></div>
          <button class="toggle${prefs.enabled ? ' on' : ''}" onclick="event.stopPropagation();App.toggleNotificationsMaster()" aria-label="เปิดการแจ้งเตือน" aria-pressed="${prefs.enabled ? 'true' : 'false'}"></button>
        </div>
        <div class="settings-row" onclick="App.openCustomNotificationRulesScreen()">
          <div class="s-icon">⚙️</div>
          <div class="s-label">กฎการแจ้งเตือน<br><div class="s-value" style="font-weight:400;text-align:left !important">เพิ่มและแก้ไขกฎการแจ้งเตือนของคุณ</div></div>
          <div class="s-value">${customCount} กฎ</div>
        </div>
      </div>`
  }

  const previousRenderMore = App.renderMore?.bind(App)
  App.renderMore = function() {
    previousRenderMore?.()
    const content = document.getElementById('more-content')
    if (!content || document.getElementById('mt-notification-settings')) return
    const footer = content.querySelector('div[style*="text-align:center"]')
    const wrapper = document.createElement('div')
    wrapper.id = 'mt-notification-settings'
    wrapper.innerHTML = renderNotificationSettings()
    if (footer) footer.insertAdjacentElement('beforebegin', wrapper)
    else content.appendChild(wrapper)
  }

  App.enableNotifications = function() {
    enableNotifications().catch(err => notify(err.message || 'เปิดการแจ้งเตือนไม่สำเร็จ', 'error'))
  }
  App.disableNotifications = function() {
    disableNotifications().catch(err => notify(err.message || 'ปิดการแจ้งเตือนไม่สำเร็จ', 'error'))
  }
  App.toggleNotificationsMaster = function() {
    const prefs = ensureSettings()
    ;(prefs.enabled ? disableNotifications() : enableNotifications())
      .catch(err => notify(err.message || 'บันทึกการตั้งค่าไม่สำเร็จ', 'error'))
  }

  App.openCustomNotificationRulesScreen = function(animate = true) {
    S.notificationRuleDraft = null
    const rules = getCustomRules()
    const rows = rules.map(rule => `
      <div class="list-item" onclick="App.openNotificationRuleForm('${esc(rule.id)}')">
        <div class="list-item-icon" style="background:${rule.enabled ? 'rgba(37,99,235,.12)' : 'rgba(148,163,184,.18)'}">${rule.enabled ? '🔔' : '🔕'}</div>
        <div class="list-item-info">
          <div class="list-item-name">${esc(rule.title || 'ยังไม่ตั้งชื่อ')}</div>
          <div class="list-item-sub">${esc(triggerLabel(rule))} · ไปที่ ${esc(routeLabel(rule.route))}</div>
        </div>
        <div class="recurring-actions">
          <button class="icon-btn" onclick="event.stopPropagation();App.toggleNotificationRule('${esc(rule.id)}')">${rule.enabled ? 'ปิด' : 'เปิด'}</button>
          <button class="icon-btn" onclick="event.stopPropagation();App.testCustomNotificationRule('${esc(rule.id)}')" style="width:auto">ทดสอบ</button>
        </div>
      </div>`).join('')
    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.closeSubScreen()">←</button>
        <h2>กฎการแจ้งเตือน</h2>
        <button class="btn btn-primary btn-sm" onclick="App.openNotificationRuleForm()" style="width:auto">+ เพิ่ม</button>
      </div>
      <div class="sub-scroll">
        <div class="card card-pad" style="margin-bottom:12px;display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="App.syncAllNotificationData()" style="width:auto">Sync ข้อมูลแจ้งเตือน</button>
          <button class="btn btn-secondary btn-sm" onclick="App.testLocalNotification()" style="width:auto">ทดสอบในเครื่อง</button>
        </div>
        <div class="card"><div style="padding:0 16px">${rows || App._emptyState?.('🔔','ยังไม่มีกฎแจ้งเตือน','สร้างกฎเพื่อกำหนดข้อความ เงื่อนไข และปลายทางเอง') || ''}</div></div>
      </div>`, { animate })
  }

  App.openNotificationRuleForm = function(ruleId = '', nextTriggerType = '', animate = true) {
    const rules = getCustomRules()
    const existing = rules.find(rule => rule.id === ruleId)
    const draft = ruleId && S.notificationRuleDraft?.id === ruleId ? S.notificationRuleDraft : null
    const rule = normalizeCustomRule(draft || existing || {
      triggerType: nextTriggerType || 'daily_time',
      title: '',
      body: '',
      route: 'dashboard',
      actionLabel: 'เปิดดู',
      triggerConfig: { time: '09:00', date: todayStr(), weekdays: ['mon','tue','wed','thu','fri'], daysBefore: 1, staleDays: 30 },
    })
    if (nextTriggerType) rule.triggerType = nextTriggerType
    S.notificationRuleDraft = rule
    const cfg = rule.triggerConfig || {}
    const selected = (value, current) => String(value) === String(current) ? ' selected' : ''
    const checked = day => (cfg.weekdays || []).includes(day) ? ' checked' : ''

    const TIME_TRIGGERS = ['daily_time','weekly_time','one_time','no_transaction_today','monthly_time','weekday_only_time','no_tx_streak','budget_over','recurring_due_today']
    const showTime      = TIME_TRIGGERS.includes(rule.triggerType)
    const showDate      = rule.triggerType === 'one_time'
    const showWeekdays  = rule.triggerType === 'weekly_time'
    const showDaysBefore   = ['upcoming_bill_due','credit_card_due','privilege_expiry'].includes(rule.triggerType)
    const showStaleDays    = rule.triggerType === 'backup_stale'
    const showDayOfMonth   = rule.triggerType === 'monthly_time'
    const showStreakDays    = rule.triggerType === 'no_tx_streak'
    const showBudgetThreshold = rule.triggerType === 'budget_over'

    const triggerHints = {
      daily_time:           'ส่งทุกวันตามเวลา ไม่มีเงื่อนไขเพิ่มเติม',
      weekly_time:          'ส่งตามวันที่เลือกในสัปดาห์',
      one_time:             'ส่งครั้งเดียวตามวัน/เวลาที่กำหนด',
      no_transaction_today: 'ส่งเมื่อถึงเวลาและวันนั้นยังไม่มีรายการเลย',
      monthly_time:         'ส่งทุกเดือน วันที่ X เหมาะกับเตือนรีวิวรายจ่ายสิ้นเดือน',
      weekday_only_time:    'ส่งเฉพาะ จ-ศ ไม่รบกวนวันหยุดสุดสัปดาห์',
      no_tx_streak:         'ส่งเมื่อไม่มีรายการในแอปติดต่อกันเกินจำนวนวันที่กำหนด',
      budget_over:          'ส่งเมื่อยอดใช้จ่ายรวมของเดือนนี้ถึง % ที่ตั้งไว้ (ส่งได้ 1 ครั้ง/เดือน/threshold)',
      recurring_due_today:  'ส่งเมื่อวันนั้นมีรายการประจำถึงกำหนดอย่างน้อย 1 รายการ',
      upcoming_bill_due:    'ส่งเมื่อมีบิล/รายการรอจ่ายเหลือเวลาตามจำนวนวันที่กำหนด',
      credit_card_due:      'ส่งเมื่อบัตรเครดิตเหลือเวลาชำระตามจำนวนวันที่กำหนด',
      backup_stale:         'ส่งเมื่อไม่ได้ export/backup ข้อมูลนานเกินกำหนด',
      privilege_expiry:     'ส่งเมื่อสิทธิพิเศษ/voucher ที่ active เหลืออายุตามจำนวนวันที่กำหนด',
    }

    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openCustomNotificationRulesScreen()">←</button>
        <h2>${existing ? 'แก้ไขกฎ' : 'เพิ่มกฎแจ้งเตือน'}</h2>
        <button class="btn btn-primary btn-sm" onclick="App.saveNotificationRule('${esc(rule.id)}')" style="width:auto">บันทึก</button>
      </div>
      <div class="sub-scroll">
        <div class="card card-pad">
          <div class="form-group">
            <label class="form-label">Trigger</label>
            <select class="form-input" id="nr-trigger" onchange="App.changeNotificationRuleTrigger('${esc(rule.id)}', this.value)">
              <optgroup label="⏰ ตามเวลา">
                <option value="daily_time"${selected('daily_time', rule.triggerType)}>ทุกวัน</option>
                <option value="weekday_only_time"${selected('weekday_only_time', rule.triggerType)}>จันทร์–ศุกร์ เท่านั้น</option>
                <option value="weekly_time"${selected('weekly_time', rule.triggerType)}>ทุกสัปดาห์ (เลือกวัน)</option>
                <option value="monthly_time"${selected('monthly_time', rule.triggerType)}>ทุกเดือน (วันที่ X)</option>
                <option value="one_time"${selected('one_time', rule.triggerType)}>ครั้งเดียว</option>
              </optgroup>
              <optgroup label="📊 ตามเงื่อนไข">
                <option value="no_transaction_today"${selected('no_transaction_today', rule.triggerType)}>วันนี้ยังไม่มีรายการ</option>
                <option value="no_tx_streak"${selected('no_tx_streak', rule.triggerType)}>ไม่มีรายการติดต่อกัน X วัน</option>
                <option value="budget_over"${selected('budget_over', rule.triggerType)}>งบหมวดหมู่ถึง X%</option>
                <option value="recurring_due_today"${selected('recurring_due_today', rule.triggerType)}>รายการประจำถึงกำหนดวันนี้</option>
                <option value="upcoming_bill_due"${selected('upcoming_bill_due', rule.triggerType)}>บิลใกล้ครบกำหนด</option>
                <option value="credit_card_due"${selected('credit_card_due', rule.triggerType)}>บัตรเครดิตใกล้ครบกำหนด</option>
                <option value="privilege_expiry"${selected('privilege_expiry', rule.triggerType)}>สิทธิพิเศษใกล้หมดอายุ</option>
                <option value="backup_stale"${selected('backup_stale', rule.triggerType)}>ไม่ได้ backup นานเกินกำหนด</option>
              </optgroup>
            </select>
            <p class="form-hint" style="margin-top:4px">${esc(triggerHints[rule.triggerType] || '')}</p>
          </div>
          ${showDate      ? `<div class="form-group"><label class="form-label">วันที่</label><input class="form-input" type="date" id="nr-date" value="${esc(cfg.date || todayStr())}"></div>` : ''}
          ${showDayOfMonth ? `<div class="form-group"><label class="form-label">วันที่ของเดือน (1–28)</label><input class="form-input" type="number" min="1" max="28" id="nr-day-of-month" value="${esc(cfg.dayOfMonth ?? 1)}"><p class="form-hint">วันที่ 29–31 อาจไม่มีในบางเดือน แนะนำใช้ 1–28</p></div>` : ''}
          ${showTime      ? `<div class="form-group"><label class="form-label">เวลา</label><input class="form-input" type="time" id="nr-time" value="${esc(cfg.time || '09:00')}" style="width:100%;max-width:100%;min-width:0;box-sizing:border-box;-webkit-appearance:none;appearance:none"></div>` : ''}
          ${showWeekdays  ? `<div class="form-group"><label class="form-label">วันในสัปดาห์</label><div class="chips">${[
            ['mon','จ'],['tue','อ'],['wed','พ'],['thu','พฤ'],['fri','ศ'],['sat','ส'],['sun','อา'],
          ].map(([value, label]) => `<label class="chip" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" name="nr-weekday" value="${value}"${checked(value)}> ${label}</label>`).join('')}</div></div>` : ''}
          ${showDaysBefore ? `<div class="form-group"><label class="form-label">เตือนก่อนครบกำหนดกี่วัน</label><input class="form-input" type="number" min="0" max="30" id="nr-days-before" value="${esc(cfg.daysBefore ?? 1)}"><p class="form-hint">0 = วันเดียวกับครบกำหนด, 1 = วันก่อน</p></div>` : ''}
          ${showStaleDays  ? `<div class="form-group"><label class="form-label">ไม่ได้ backup กี่วันแล้วให้เตือน</label><input class="form-input" type="number" min="1" max="365" id="nr-stale-days" value="${esc(cfg.staleDays ?? 30)}"></div>` : ''}
          ${showStreakDays  ? `<div class="form-group"><label class="form-label">ไม่มีรายการติดกันกี่วัน</label><input class="form-input" type="number" min="1" max="90" id="nr-streak-days" value="${esc(cfg.streakDays ?? 3)}"><p class="form-hint">แนะนำ 3–7 วัน นับจากรายการล่าสุดในแอป</p></div>` : ''}
          ${showBudgetThreshold ? `<div class="form-group"><label class="form-label">เมื่องบถึง (%)</label><select class="form-input" id="nr-threshold">
            <option value="50"${cfg.threshold == 50 ? ' selected' : ''}>50% ขึ้นไป</option>
            <option value="75"${cfg.threshold == 75 ? ' selected' : ''}>75% ขึ้นไป</option>
            <option value="90"${!cfg.threshold || cfg.threshold == 90 ? ' selected' : ''}>90% ขึ้นไป</option>
            <option value="100"${cfg.threshold == 100 ? ' selected' : ''}>100% (เกินงบ)</option>
          </select><p class="form-hint">ส่งได้ 1 ครั้ง/เดือน/ระดับ เมื่อยอดรวมทุกหมวดถึง threshold</p></div>` : ''}
          <div class="form-group"><label class="form-label">Title</label><input class="form-input" id="nr-title" value="${esc(rule.title)}" placeholder="เช่น อย่าลืมจดค่าอาหาร"></div>
          <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" id="nr-body" rows="2" placeholder="ข้อความรองใน notification">${esc(rule.body)}</textarea></div>
          <div class="form-group">
            <label class="form-label">เปิดหน้า</label>
            <select class="form-input" id="nr-route">
              <optgroup label="บันทึก">
                <option value="addTx"${selected('addTx', rule.route)}>เพิ่มรายการ</option>
                <option value="transactions"${selected('transactions', rule.route)}>รายการทั้งหมด</option>
              </optgroup>
              <optgroup label="การเงิน">
                <option value="wallets"${selected('wallets', rule.route)}>กระเป๋าเงิน</option>
                <option value="creditCards"${selected('creditCards', rule.route)}>บัตรเครดิต</option>
                <option value="budgets"${selected('budgets', rule.route)}>งบประมาณ</option>
                <option value="goals"${selected('goals', rule.route)}>เป้าหมาย</option>
              </optgroup>
              <optgroup label="รายการ">
                <option value="upcomingBills"${selected('upcomingBills', rule.route)}>รายการรอจ่าย</option>
                <option value="recurring"${selected('recurring', rule.route)}>รายการประจำ</option>
                <option value="privileges"${selected('privileges', rule.route)}>สิทธิพิเศษ</option>
              </optgroup>
              <optgroup label="อื่นๆ">
                <option value="reports"${selected('reports', rule.route)}>รายงาน</option>
                <option value="dashboard"${selected('dashboard', rule.route)}>หน้าหลัก</option>
                <option value="more"${selected('more', rule.route)}>เมนูเพิ่มเติม</option>
              </optgroup>
            </select>
          </div>
          <div class="form-group"><label class="form-label">ป้ายปุ่ม Action</label><input class="form-input" id="nr-action-label" value="${esc(rule.actionLabel || 'เปิดดู')}" placeholder="เช่น เปิดดู, เพิ่มรายการ"></div>
          <button class="btn btn-secondary" onclick="App.testNotificationRuleFromForm('${esc(rule.id)}')">ทดสอบกฎนี้ในเครื่อง</button>
          ${existing ? `<button class="btn btn-outline mt-8" onclick="App.deleteNotificationRule('${esc(rule.id)}')">ลบกฎนี้</button>` : ''}
        </div>
      </div>`, { animate })
  }

  App.changeNotificationRuleTrigger = function(ruleId, triggerType) {
    const current = normalizeCustomRule({
      ...(S.notificationRuleDraft || {}),
      id: ruleId,
      title: document.getElementById('nr-title')?.value || S.notificationRuleDraft?.title || '',
      body: document.getElementById('nr-body')?.value || S.notificationRuleDraft?.body || '',
      route: document.getElementById('nr-route')?.value || S.notificationRuleDraft?.route || 'dashboard',
      actionLabel: document.getElementById('nr-action-label')?.value || S.notificationRuleDraft?.actionLabel || 'เปิดดู',
      triggerType,
      triggerConfig: {
        ...(S.notificationRuleDraft?.triggerConfig || {}),
        time: document.getElementById('nr-time')?.value || S.notificationRuleDraft?.triggerConfig?.time || '09:00',
        date: document.getElementById('nr-date')?.value || S.notificationRuleDraft?.triggerConfig?.date || todayStr(),
        weekdays: [...document.querySelectorAll('input[name="nr-weekday"]:checked')].map(input => input.value),
        daysBefore: Number(document.getElementById('nr-days-before')?.value || S.notificationRuleDraft?.triggerConfig?.daysBefore || 1),
        staleDays: Number(document.getElementById('nr-stale-days')?.value || S.notificationRuleDraft?.triggerConfig?.staleDays || 30),
        dayOfMonth: Number(document.getElementById('nr-day-of-month')?.value || S.notificationRuleDraft?.triggerConfig?.dayOfMonth || 1),
        streakDays: Number(document.getElementById('nr-streak-days')?.value || S.notificationRuleDraft?.triggerConfig?.streakDays || 3),
        threshold: Number(document.getElementById('nr-threshold')?.value || S.notificationRuleDraft?.triggerConfig?.threshold || 90),
      },
    })
    S.notificationRuleDraft = current
    App.openNotificationRuleForm(ruleId, triggerType, false)
  }

  App.saveNotificationRule = function(ruleId) {
    const prefs = ensureSettings()
    const rules = getCustomRules()
    const existing = rules.find(rule => rule.id === ruleId)
    const triggerType = document.getElementById('nr-trigger')?.value || 'daily_time'
    const weekdays = [...document.querySelectorAll('input[name="nr-weekday"]:checked')].map(input => input.value)
    const rule = normalizeCustomRule({
      ...(existing || {}),
      id: ruleId,
      enabled: existing?.enabled !== false,
      title: document.getElementById('nr-title')?.value || '',
      body: document.getElementById('nr-body')?.value || '',
      route: document.getElementById('nr-route')?.value || 'dashboard',
      actionLabel: document.getElementById('nr-action-label')?.value || 'เปิดดู',
      triggerType,
      triggerConfig: {
        time: document.getElementById('nr-time')?.value || existing?.triggerConfig?.time || '09:00',
        date: document.getElementById('nr-date')?.value || existing?.triggerConfig?.date || todayStr(),
        weekdays: weekdays.length ? weekdays : existing?.triggerConfig?.weekdays || ['mon','tue','wed','thu','fri'],
        daysBefore: Number(document.getElementById('nr-days-before')?.value || existing?.triggerConfig?.daysBefore || 1),
        staleDays: Number(document.getElementById('nr-stale-days')?.value || existing?.triggerConfig?.staleDays || 30),
        dayOfMonth: Number(document.getElementById('nr-day-of-month')?.value || existing?.triggerConfig?.dayOfMonth || 1),
        streakDays: Number(document.getElementById('nr-streak-days')?.value || existing?.triggerConfig?.streakDays || 3),
        threshold: Number(document.getElementById('nr-threshold')?.value || existing?.triggerConfig?.threshold || 90),
      },
      createdAt: existing?.createdAt,
      updatedAt: new Date().toISOString(),
    })
    if (!rule.title) return notify('กรุณากรอก Title ของแจ้งเตือน', 'error')
    const idx = rules.findIndex(item => item.id === rule.id)
    if (idx >= 0) rules[idx] = rule
    else rules.unshift(rule)
    prefs.customRules = rules
    persist()
    S.notificationRuleDraft = null
    syncCustomRules().catch(() => {})
    notify('บันทึกกฎแจ้งเตือนแล้ว', 'success')
    App.openCustomNotificationRulesScreen()
  }

  App.toggleNotificationRule = function(ruleId) {
    const rules = getCustomRules()
    const rule = rules.find(item => item.id === ruleId)
    if (!rule) return
    rule.enabled = !rule.enabled
    rule.updatedAt = new Date().toISOString()
    persist()
    syncCustomRules().catch(() => {})
    App.openCustomNotificationRulesScreen(false)
  }

  App.deleteNotificationRule = function(ruleId) {
    const rule = getCustomRules().find(item => item.id === ruleId)
    App.showConfirm?.({
      title: 'ลบกฎแจ้งเตือน',
      body: rule?.title ? `ลบ “${rule.title}”?` : 'ลบกฎนี้?',
      confirmLabel: 'ลบ',
      danger: true,
      onConfirm() {
        const prefs = ensureSettings()
        prefs.customRules = getCustomRules().filter(item => item.id !== ruleId)
        persist()
        syncCustomRules().catch(() => {})
        notify('ลบกฎแจ้งเตือนแล้ว', 'success')
        App.openCustomNotificationRulesScreen()
      },
    })
  }

  App.syncAllNotificationData = function() {
    Promise.all([
      syncSnapshot({ force: true }),
      syncCustomRules(),
    ])
      .then(() => notify('Sync ข้อมูลแจ้งเตือนแล้ว', 'success'))
      .catch(err => notify(err.message || 'Sync ไม่สำเร็จ', 'error'))
  }

  App.syncCustomNotificationRules = function(showToast = false) {
    syncCustomRules()
      .then(ok => { if (showToast) notify(ok ? 'Sync กฎแจ้งเตือนแล้ว' : 'ยังไม่ได้ตั้งค่า Firebase/Supabase', ok ? 'success' : 'warn') })
      .catch(err => notify(err.message || 'Sync กฎไม่สำเร็จ', 'error'))
  }

  App.testCustomNotificationRule = async function(ruleId) {
    const rule = getCustomRules().find(item => item.id === ruleId)
    if (!rule) return notify('ไม่พบกฎแจ้งเตือน', 'error')
    await App._showCustomNotificationRule(rule)
  }

  App.testNotificationRuleFromForm = async function(ruleId) {
    const temp = normalizeCustomRule({
      id: ruleId,
      title: document.getElementById('nr-title')?.value || 'ทดสอบแจ้งเตือน',
      body: document.getElementById('nr-body')?.value || 'ข้อความทดสอบจากกฎแจ้งเตือน',
      route: document.getElementById('nr-route')?.value || 'dashboard',
      actionLabel: document.getElementById('nr-action-label')?.value || 'เปิดดู',
    })
    await App._showCustomNotificationRule(temp)
  }

  App._showCustomNotificationRule = async function(rule) {
    if (!('Notification' in window)) return notify('เบราว์เซอร์นี้ไม่รองรับ Notification', 'warn')
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (permission !== 'granted') return notify('ยังไม่ได้อนุญาตการแจ้งเตือน', 'warn')
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(rule.title || 'Money Tracker', {
      body: rule.body || '',
      tag: `mt-custom-test-${rule.id}`,
      data: { type: 'custom_rule', ruleId: rule.id, route: rule.route || 'dashboard' },
      actions: [{ action: rule.route || 'open', title: rule.actionLabel || 'เปิดแอป' }],
    })
  }

  App.syncNotificationSnapshot = function(force = false) {
    syncSnapshot({ force: Boolean(force) })
      .then(ok => notify(ok ? 'Sync ข้อมูลแจ้งเตือนแล้ว' : 'ยังไม่ได้ตั้งค่า Notification', ok ? 'success' : 'warn'))
      .catch(err => notify(err.message || 'Sync ไม่สำเร็จ', 'error'))
  }

  App.testLocalNotification = async function() {
    if (!('Notification' in window)) return notify('เบราว์เซอร์นี้ไม่รองรับ Notification', 'warn')
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (permission !== 'granted') return notify('ยังไม่ได้อนุญาตการแจ้งเตือน', 'warn')
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification('อย่าลืมจดรายจ่ายวันนี้', {
      body: 'นี่คือ noti ทดสอบจาก Money Tracker',
      tag: 'mt-test-notification',
      data: { route: 'addTx' },
      actions: [{ action: 'addTx', title: 'เพิ่มรายจ่าย' }],
    })
  }

  function handleNotificationRoute() {
    const [, query = ''] = String(location.hash || '').replace(/^#/, '').split('?')
    const params = new URLSearchParams(query)
    const open = params.get('open') || new URLSearchParams(location.search).get('open')
    if (open === 'addTx') setTimeout(() => App.openAddTx?.(), 350)
    if (open === 'upcomingBills') setTimeout(() => App.openUpcomingBillsScreen?.(), 350)
    if (open === 'goals') setTimeout(() => App.openGoalsScreen?.(), 350)
    if (open === 'recurring') setTimeout(() => App.openRecurringScreen?.(), 350)
    if (open === 'budgets') setTimeout(() => App.openBudgetScreen?.(), 350)
    if (open === 'privileges') setTimeout(() => App.openPrivilegesScreen?.(), 350)
    if (open === 'creditCards') {
      setTimeout(() => {
        const sections = document.querySelectorAll('#wallets-content .wallet-section-block')
        const creditSection = [...sections].find(s =>
          s.querySelector('.wallet-section-title span')?.textContent?.includes('บัตรเครดิต')
        )
        creditSection?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 500)
    }
  }

  window.addEventListener('hashchange', handleNotificationRoute, { passive: true })
  setTimeout(() => {
    ensureSettings()
    handleNotificationRoute()
    if (S.page === 'more') App.renderMore?.()
    syncSnapshot().catch(() => {})
    syncCustomRules().catch(() => {})
  }, 500)
})()
