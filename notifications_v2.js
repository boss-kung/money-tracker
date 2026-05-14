/* ============================================================
   Money Tracker Notifications
   Firebase Cloud Messaging + Supabase Edge Functions
   ============================================================ */
;(function(){
  'use strict'

  const INSTALL_KEY = 'mt_notification_install_id'
  const LAST_SYNC_KEY = 'mt_notification_last_snapshot_sync'
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[ch]))

  function notify(message, type = 'info') {
    try { toast(message, type) } catch (_) { console.log(message) }
  }

  function defaultPrefs() {
    return {
      daily_expense_enabled: true,
      daily_expense_time: '20:30',
      upcoming_bill_enabled: true,
      credit_card_due_enabled: true,
      budget_alert_enabled: false,
      recurring_enabled: true,
      backup_reminder_enabled: true,
      monthly_summary_enabled: false,
      hide_amounts_in_notification: Boolean(S.settings?.hideMoney),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok',
      customRules: [],
    }
  }

  function ensureSettings() {
    S.settings ||= {}
    S.settings.notifications ||= {}
    S.settings.notifications = { ...defaultPrefs(), ...S.settings.notifications }
    if (!Array.isArray(S.settings.notifications.customRules)) S.settings.notifications.customRules = []
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

    return {
      installId: getInstallId(),
      snapshotDate: today,
      todayTxCount,
      lastTxDate,
      upcomingBills,
      creditDue,
      budgetAlerts: [],
      recurringDue: [],
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
    ensureSettings()
    persist()
    if (!isConfigured()) return false
    await callFunction('update-notification-preferences', {
      installId: getInstallId(),
      preferences: S.settings.notifications,
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

  function statusLabel() {
    if (!('Notification' in window)) return 'ไม่รองรับ'
    if (!isConfigured()) return 'รอตั้งค่า'
    if (Notification.permission === 'granted') return 'เปิดแล้ว'
    if (Notification.permission === 'denied') return 'ถูกบล็อก'
    return 'ยังไม่เปิด'
  }

  function togglePreference(key) {
    ensureSettings()
    S.settings.notifications[key] = !S.settings.notifications[key]
    savePreferences()
      .then(() => {
        notify('บันทึกการตั้งค่าแจ้งเตือนแล้ว', 'success')
        App.renderMore?.()
      })
      .catch(err => notify(err.message || 'บันทึกการตั้งค่าไม่สำเร็จ', 'error'))
  }

  function renderNotificationSettings() {
    const prefs = ensureSettings()
    const customCount = getCustomRules().length
    const toggle = (key, label, sub = '') => `
      <div class="settings-row" onclick="App.toggleNotificationPreference('${key}')">
        <div class="s-icon">🔔</div>
        <div class="s-label">${esc(label)}${sub ? `<br><div class="s-value" style="font-weight:400;text-align:left !important">${esc(sub)}</div>` : ''}</div>
        <button class="toggle${prefs[key] ? ' on' : ''}" onclick="event.stopPropagation();App.toggleNotificationPreference('${key}')" aria-label="${esc(label)}" aria-pressed="${prefs[key] ? 'true' : 'false'}"></button>
      </div>`

    return `
      <div class="sec-title">การแจ้งเตือน</div>
      <div class="card card-pad">
        <div class="settings-row" onclick="App.enableNotifications()">
          <div class="s-icon">🔔</div>
          <div class="s-label">เปิดการแจ้งเตือน</div>
          <div class="s-value">${esc(statusLabel())}</div>
        </div>
        ${toggle('daily_expense_enabled', 'เตือนจดรายจ่ายทุกวัน', 'เวลา 20:30')}
        ${toggle('upcoming_bill_enabled', 'บิลและรายการรอจ่าย', 'เตือนรายการที่ใกล้ครบกำหนด')}
        ${toggle('credit_card_due_enabled', 'กำหนดชำระบัตรเครดิต', 'เตือนก่อนครบกำหนด')}
        ${toggle('recurring_enabled', 'รายการประจำ', 'เตือนรายการที่ถึงกำหนด')}
        ${toggle('backup_reminder_enabled', 'เตือนสำรองข้อมูล', 'เหมาะกับแอปที่เก็บข้อมูลในเครื่อง')}
        ${toggle('hide_amounts_in_notification', 'ซ่อนจำนวนเงินในแจ้งเตือน', 'ใช้ร่วมกับโหมดซ่อนเงิน')}
        <div class="settings-row" onclick="App.openCustomNotificationRulesScreen()">
          <div class="s-icon">⚙️</div>
          <div class="s-label">กฎแจ้งเตือนเอง<br><div class="s-value" style="font-weight:400;text-align:left !important">ตั้งข้อความ เวลา เงื่อนไข และปลายทางเอง</div></div>
          <div class="s-value">${customCount} กฎ</div>
        </div>
        <div style="display:flex;gap:8px;padding:12px 0 0">
          <button class="btn btn-secondary btn-sm" onclick="App.syncNotificationSnapshot(true)" style="width:auto">Sync ตอนนี้</button>
          <button class="btn btn-secondary btn-sm" onclick="App.testLocalNotification()" style="width:auto">ทดสอบในเครื่อง</button>
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

  App.toggleNotificationPreference = togglePreference

  App.openCustomNotificationRulesScreen = function() {
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
          <button class="icon-btn" onclick="event.stopPropagation();App.testCustomNotificationRule('${esc(rule.id)}')">ทดสอบ</button>
        </div>
      </div>`).join('')
    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.closeSubScreen()">←</button>
        <h2>กฎแจ้งเตือนเอง</h2>
        <button class="btn btn-primary btn-sm" onclick="App.openNotificationRuleForm()" style="width:auto">+ เพิ่ม</button>
      </div>
      <div class="sub-scroll">
        <div class="card card-pad" style="margin-bottom:12px">
          <button class="btn btn-secondary btn-sm" onclick="App.syncCustomNotificationRules(true)" style="width:auto">Sync กฎขึ้น Supabase</button>
        </div>
        <div class="card"><div style="padding:0 16px">${rows || App._emptyState?.('🔔','ยังไม่มีกฎแจ้งเตือน','สร้างกฎเพื่อกำหนดข้อความ เงื่อนไข และปลายทางเอง') || ''}</div></div>
      </div>`)
  }

  App.openNotificationRuleForm = function(ruleId = '', nextTriggerType = '') {
    const rules = getCustomRules()
    const existing = rules.find(rule => rule.id === ruleId)
    const draft = S.notificationRuleDraft?.id === (ruleId || S.notificationRuleDraft?.id) ? S.notificationRuleDraft : null
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
    const showTime = ['daily_time','weekly_time','one_time','no_transaction_today'].includes(rule.triggerType)
    const showDate = rule.triggerType === 'one_time'
    const showWeekdays = rule.triggerType === 'weekly_time'
    const showDaysBefore = ['upcoming_bill_due','credit_card_due'].includes(rule.triggerType)
    const showStaleDays = rule.triggerType === 'backup_stale'

    App.openSubScreen(`
      <div class="sub-header">
        <button class="btn-icon" onclick="App.openCustomNotificationRulesScreen()">←</button>
        <h2>${existing ? 'แก้ไขกฎ' : 'เพิ่มกฎแจ้งเตือน'}</h2>
        <button class="btn btn-primary btn-sm" onclick="App.saveNotificationRule('${esc(rule.id)}')" style="width:auto">บันทึก</button>
      </div>
      <div class="sub-scroll">
        <div class="card card-pad">
          <div class="form-group"><label class="form-label">Title</label><input class="form-input" id="nr-title" value="${esc(rule.title)}" placeholder="เช่น อย่าลืมจดค่าอาหาร"></div>
          <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" id="nr-body" rows="3" placeholder="ข้อความรองใน notification">${esc(rule.body)}</textarea></div>
          <div class="form-group"><label class="form-label">Trigger</label><select class="form-input" id="nr-trigger" onchange="App.changeNotificationRuleTrigger('${esc(rule.id)}', this.value)">
            <option value="daily_time"${selected('daily_time', rule.triggerType)}>ทุกวันตามเวลา</option>
            <option value="weekly_time"${selected('weekly_time', rule.triggerType)}>ทุกสัปดาห์ตามวัน/เวลา</option>
            <option value="one_time"${selected('one_time', rule.triggerType)}>ครั้งเดียวตามวัน/เวลา</option>
            <option value="no_transaction_today"${selected('no_transaction_today', rule.triggerType)}>ถ้าวันนี้ยังไม่มีรายการ</option>
            <option value="upcoming_bill_due"${selected('upcoming_bill_due', rule.triggerType)}>บิล / รายการรอจ่ายใกล้ครบ</option>
            <option value="credit_card_due"${selected('credit_card_due', rule.triggerType)}>บัตรเครดิตใกล้ครบกำหนด</option>
            <option value="backup_stale"${selected('backup_stale', rule.triggerType)}>ไม่ได้สำรองข้อมูลหลายวัน</option>
          </select></div>
          ${showDate ? `<div class="form-group"><label class="form-label">วันที่</label><input class="form-input" type="date" id="nr-date" value="${esc(cfg.date || todayStr())}"></div>` : ''}
          ${showTime ? `<div class="form-group"><label class="form-label">เวลา</label><input class="form-input" type="time" id="nr-time" value="${esc(cfg.time || '09:00')}"></div>` : ''}
          ${showWeekdays ? `<div class="form-group"><label class="form-label">วันในสัปดาห์</label><div class="chips">${[
            ['mon','จ'],['tue','อ'],['wed','พ'],['thu','พฤ'],['fri','ศ'],['sat','ส'],['sun','อา'],
          ].map(([value, label]) => `<label class="chip" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" name="nr-weekday" value="${value}"${checked(value)}> ${label}</label>`).join('')}</div></div>` : ''}
          ${showDaysBefore ? `<div class="form-group"><label class="form-label">เตือนก่อนครบกำหนดกี่วัน</label><input class="form-input" type="number" min="0" max="30" id="nr-days-before" value="${esc(cfg.daysBefore ?? 1)}"></div>` : ''}
          ${showStaleDays ? `<div class="form-group"><label class="form-label">ไม่ได้ backup กี่วันแล้วให้เตือน</label><input class="form-input" type="number" min="1" max="365" id="nr-stale-days" value="${esc(cfg.staleDays ?? 30)}"></div>` : ''}
          <div class="form-group"><label class="form-label">Action route</label><select class="form-input" id="nr-route">
            ${[
              ['dashboard','หน้าหลัก'],['addTx','เพิ่มรายการ'],['transactions','รายการ'],['wallets','กระเป๋า'],['reports','รายงาน'],['more','เพิ่มเติม'],['upcomingBills','รายการรอจ่าย'],['creditCards','บัตรเครดิต'],['goals','เป้าหมาย'],
            ].map(([value, label]) => `<option value="${value}"${selected(value, rule.route)}>${label}</option>`).join('')}
          </select></div>
          <div class="form-group"><label class="form-label">ป้ายปุ่ม Action</label><input class="form-input" id="nr-action-label" value="${esc(rule.actionLabel || 'เปิดดู')}" placeholder="เช่น เปิดดู, เพิ่มรายการ"></div>
          <button class="btn btn-secondary" onclick="App.testNotificationRuleFromForm('${esc(rule.id)}')">ทดสอบกฎนี้ในเครื่อง</button>
          ${existing ? `<button class="btn btn-outline mt-8" onclick="App.deleteNotificationRule('${esc(rule.id)}')">ลบกฎนี้</button>` : ''}
        </div>
      </div>`)
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
      },
    })
    S.notificationRuleDraft = current
    App.openNotificationRuleForm(ruleId, triggerType)
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
    App.openCustomNotificationRulesScreen()
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
