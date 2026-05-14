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
    }
  }

  function ensureSettings() {
    S.settings ||= {}
    S.settings.notifications ||= {}
    S.settings.notifications = { ...defaultPrefs(), ...S.settings.notifications }
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
  }

  window.addEventListener('hashchange', handleNotificationRoute, { passive: true })
  setTimeout(() => {
    ensureSettings()
    handleNotificationRoute()
    if (S.page === 'more') App.renderMore?.()
    syncSnapshot().catch(() => {})
  }, 500)
})()
