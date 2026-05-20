/* ============================================================
   Money Tracker App Lock
   Local-first PIN gate for PWA privacy.
   ============================================================ */
;(function () {
  'use strict'

  const CONFIG_KEY = 'mt_app_lock'
  const SESSION_KEY = 'mt_app_lock_session'
  const ITERATIONS = 210000
  const MIN_PIN_LENGTH = 6
  const MAX_PIN_LENGTH = 12
  const encoder = new TextEncoder()

  let appStarted = false
  let bootCallback = null
  let unlocked = false
  let enteredPin = ''
  let mode = 'idle'

  function now() { return Date.now() }
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))
  }
  function notify(msg, type = 'info') {
    try {
      if (typeof toast === 'function') toast(msg, type)
      else console[type === 'error' ? 'error' : 'log'](msg)
    } catch (_) {}
  }
  function hasWebCrypto() {
    return !!(window.crypto?.subtle && window.crypto?.getRandomValues)
  }
  function bytesToBase64(bytes) {
    let binary = ''
    new Uint8Array(bytes).forEach(b => { binary += String.fromCharCode(b) })
    return btoa(binary)
  }
  function base64ToBytes(value) {
    const binary = atob(String(value || ''))
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  function randomSalt() {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return bytesToBase64(bytes)
  }
  async function deriveHash(pin, salt, iterations = ITERATIONS) {
    if (!hasWebCrypto()) throw new Error('อุปกรณ์นี้ไม่รองรับ Web Crypto สำหรับ App Lock')
    const key = await crypto.subtle.importKey('raw', encoder.encode(String(pin)), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: base64ToBytes(salt),
      iterations: Number(iterations) || ITERATIONS,
      hash: 'SHA-256',
    }, key, 256)
    return bytesToBase64(bits)
  }
  function safeEqual(a, b) {
    const left = String(a || '')
    const right = String(b || '')
    if (left.length !== right.length) return false
    let diff = 0
    for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i)
    return diff === 0
  }
  function readConfig() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null')
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch (_) {
      return null
    }
  }
  function writeConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      version: 1,
      enabled: false,
      lockOnBackground: true,
      lockTimeoutMs: 0,
      failureCount: 0,
      lockedUntil: 0,
      ...config,
      updatedAt: new Date().toISOString(),
    }))
  }
  function getStatus() {
    const config = readConfig()
    return {
      supported: hasWebCrypto(),
      enabled: !!config?.enabled,
      lockOnBackground: config?.lockOnBackground !== false,
      lockTimeoutMs: Number(config?.lockTimeoutMs || 0),
      locked: !!config?.enabled && !unlocked,
    }
  }
  function ensureOverlay() {
    let overlay = document.getElementById('mt-app-lock')
    if (overlay) return overlay
    overlay = document.createElement('div')
    overlay.id = 'mt-app-lock'
    overlay.setAttribute('aria-live', 'polite')
    overlay.innerHTML = '<div class="mt-lock-panel"></div>'
    document.body.appendChild(overlay)
    return overlay
  }
  function setOverlay(open, privacyOnly = false) {
    const overlay = ensureOverlay()
    overlay.classList.toggle('open', !!open)
    overlay.classList.toggle('privacy-only', !!privacyOnly)
    document.documentElement.classList.toggle('mt-app-lock-open', !!open)
    document.body.classList.toggle('mt-app-lock-open', !!open)
  }
  function keypadHtml() {
    return `<div class="mt-lock-dots" aria-hidden="true">${Array.from({ length: MIN_PIN_LENGTH }).map((_, i) => `<span class="${enteredPin.length > i ? 'filled' : ''}"></span>`).join('')}</div>
      <div class="mt-lock-keypad">
        ${[1,2,3,4,5,6,7,8,9].map(n => `<button type="button" onclick="MTAppLock.press('${n}')">${n}</button>`).join('')}
        <button type="button" class="ghost" onclick="MTAppLock.cancel()">ยกเลิก</button>
        <button type="button" onclick="MTAppLock.press('0')">0</button>
        <button type="button" class="ghost" onclick="MTAppLock.backspace()">ลบ</button>
      </div>`
  }
  function renderUnlock(message = '') {
    mode = 'unlock'
    enteredPin = ''
    const config = readConfig()
    const lockedUntil = Number(config?.lockedUntil || 0)
    const waitSec = Math.ceil(Math.max(0, lockedUntil - now()) / 1000)
    const panel = ensureOverlay().querySelector('.mt-lock-panel')
    panel.innerHTML = `<div class="mt-lock-brand">Money Tracker</div>
      <h1>ปลดล็อกแอป</h1>
      <p>${waitSec > 0 ? `ลองใหม่ได้อีก ${waitSec} วินาที` : 'ใส่รหัสเพื่อดูข้อมูลการเงินของคุณ'}</p>
      ${message ? `<div class="mt-lock-error">${esc(message)}</div>` : ''}
      ${keypadHtml()}`
    setOverlay(true, false)
  }
  function renderSetup() {
    mode = 'setup'
    const panel = ensureOverlay().querySelector('.mt-lock-panel')
    panel.innerHTML = `<div class="mt-lock-brand">Money Tracker</div>
      <h1>ตั้งค่า App Lock</h1>
      <p>ตั้งรหัสตัวเลข ${MIN_PIN_LENGTH}-${MAX_PIN_LENGTH} หลักเพื่อป้องกันข้อมูลเมื่อเปิด PWA หรือกลับเข้ามาในแอป</p>
      <div class="mt-lock-form">
        <label>รหัสใหม่</label>
        <input class="form-input" id="mt-lock-pin-a" inputmode="numeric" autocomplete="new-password" type="password" maxlength="${MAX_PIN_LENGTH}">
        <label>ยืนยันรหัส</label>
        <input class="form-input" id="mt-lock-pin-b" inputmode="numeric" autocomplete="new-password" type="password" maxlength="${MAX_PIN_LENGTH}">
      </div>
      <div class="mt-lock-actions">
        <button class="btn btn-secondary" type="button" onclick="MTAppLock.closeSettings()">ยกเลิก</button>
        <button class="btn btn-primary" type="button" onclick="MTAppLock.saveSetup()">เปิดใช้</button>
      </div>`
    setOverlay(true, false)
    setTimeout(() => document.getElementById('mt-lock-pin-a')?.focus(), 80)
  }
  function renderSettings() {
    const config = readConfig()
    const enabled = !!config?.enabled
    const panel = ensureOverlay().querySelector('.mt-lock-panel')
    panel.innerHTML = `<div class="mt-lock-brand">ความปลอดภัย</div>
      <h1>App Lock</h1>
      <p>${enabled ? 'เปิดใช้งานแล้ว กลับเข้า PWA จะต้องปลดล็อกก่อนเห็นข้อมูล' : 'ยังไม่ได้เปิด App Lock'}</p>
      <div class="mt-lock-setting-row">
        <div><strong>ล็อกเมื่อออกจากแอป</strong><span>เหมาะกับ PWA และ app switcher</span></div>
        <button class="toggle${config?.lockOnBackground !== false ? ' on' : ''}" type="button" onclick="MTAppLock.toggleBackgroundLock()"></button>
      </div>
      <div class="mt-lock-actions stacked">
        ${enabled ? `<button class="btn btn-primary" type="button" onclick="MTAppLock.lockNow()">ล็อกตอนนี้</button>
          <button class="btn btn-secondary" type="button" onclick="MTAppLock.changePin()">เปลี่ยนรหัส</button>
          <button class="btn btn-secondary danger" type="button" onclick="MTAppLock.disable()">ปิด App Lock</button>`
        : `<button class="btn btn-primary" type="button" onclick="MTAppLock.showSetup()">ตั้งรหัสและเปิดใช้</button>`}
        <button class="btn btn-secondary" type="button" onclick="MTAppLock.closeSettings()">ปิด</button>
      </div>`
    setOverlay(true, false)
  }
  function refreshKeypad() {
    if (mode !== 'unlock') return
    const dots = document.querySelector('#mt-app-lock .mt-lock-dots')
    if (!dots) return
    dots.innerHTML = Array.from({ length: MIN_PIN_LENGTH })
      .map((_, i) => `<span class="${enteredPin.length > i ? 'filled' : ''}"></span>`)
      .join('')
  }
  async function verifyEnteredPin() {
    const config = readConfig()
    if (!config?.enabled) return true
    const lockedUntil = Number(config.lockedUntil || 0)
    if (lockedUntil > now()) {
      renderUnlock(`ใส่ผิดหลายครั้ง กรุณารอ ${Math.ceil((lockedUntil - now()) / 1000)} วินาที`)
      return false
    }
    try {
      const hash = await deriveHash(enteredPin, config.salt, config.iterations)
      if (safeEqual(hash, config.hash)) {
        unlocked = true
        enteredPin = ''
        writeConfig({ ...config, failureCount: 0, lockedUntil: 0, lastUnlockedAt: new Date().toISOString() })
        try { sessionStorage.setItem(SESSION_KEY, String(now())) } catch (_) {}
        setOverlay(false)
        if (!appStarted && typeof bootCallback === 'function') {
          appStarted = true
          bootCallback()
        }
        return true
      }
    } catch (err) {
      renderUnlock(err?.message || 'ตรวจสอบรหัสไม่สำเร็จ')
      return false
    }
    const failures = Number(config.failureCount || 0) + 1
    const delay = failures >= 5 ? Math.min(300000, 30000 * (failures - 4)) : 0
    writeConfig({ ...config, failureCount: failures, lockedUntil: delay ? now() + delay : 0 })
    renderUnlock(delay ? `ใส่ผิด ${failures} ครั้ง กรุณารอสักครู่` : 'รหัสไม่ถูกต้อง')
    return false
  }
  function lockForPrivacy() {
    const config = readConfig()
    if (!config?.enabled || config.lockOnBackground === false) return
    unlocked = false
    enteredPin = ''
    try { sessionStorage.removeItem(SESSION_KEY) } catch (_) {}
    const panel = ensureOverlay().querySelector('.mt-lock-panel')
    panel.innerHTML = `<div class="mt-lock-brand">Money Tracker</div><h1>ข้อมูลถูกปิดไว้</h1><p>กลับเข้าแอปแล้วปลดล็อกเพื่อใช้งานต่อ</p>`
    setOverlay(true, true)
  }
  function setupLifecyclePrivacy() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') lockForPrivacy()
      else if (readConfig()?.enabled && !unlocked) renderUnlock()
    }, { passive: true })
    window.addEventListener('pagehide', lockForPrivacy, { passive: true })
    window.addEventListener('blur', () => {
      if (window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true) {
        setTimeout(() => {
          if (document.visibilityState !== 'visible') lockForPrivacy()
        }, 50)
      }
    }, { passive: true })
    window.addEventListener('pageshow', () => {
      if (readConfig()?.enabled && !unlocked) renderUnlock()
    }, { passive: true })
  }

  window.MTAppLock = {
    start(callback) {
      bootCallback = callback
      setupLifecyclePrivacy()
      if (!readConfig()?.enabled) {
        unlocked = true
        appStarted = true
        callback()
        return
      }
      renderUnlock()
      if (!appStarted && typeof callback === 'function') {
        appStarted = true
        callback()
      }
    },
    status: getStatus,
    openSettings: renderSettings,
    closeSettings() {
      if (readConfig()?.enabled && !unlocked) return renderUnlock()
      setOverlay(false)
      try { if (typeof App !== 'undefined') App.renderMore?.() } catch (_) {}
    },
    showSetup: renderSetup,
    async saveSetup() {
      const pinA = String(document.getElementById('mt-lock-pin-a')?.value || '').replace(/\D/g, '')
      const pinB = String(document.getElementById('mt-lock-pin-b')?.value || '').replace(/\D/g, '')
      if (pinA.length < MIN_PIN_LENGTH || pinA.length > MAX_PIN_LENGTH) return notify(`รหัสต้องมี ${MIN_PIN_LENGTH}-${MAX_PIN_LENGTH} หลัก`, 'warn')
      if (pinA !== pinB) return notify('รหัสทั้งสองช่องไม่ตรงกัน', 'warn')
      try {
        const salt = randomSalt()
        const hash = await deriveHash(pinA, salt, ITERATIONS)
        writeConfig({
          enabled: true,
          salt,
          hash,
          iterations: ITERATIONS,
          lockOnBackground: true,
          lockTimeoutMs: 0,
          failureCount: 0,
          lockedUntil: 0,
          createdAt: new Date().toISOString(),
        })
        unlocked = true
        notify('เปิด App Lock แล้ว', 'success')
        renderSettings()
        try { if (typeof App !== 'undefined') App.renderMore?.() } catch (_) {}
      } catch (err) {
        notify(err?.message || 'เปิด App Lock ไม่สำเร็จ', 'error')
      }
    },
    press(value) {
      if (!readConfig()?.enabled) return
      if (enteredPin.length >= MAX_PIN_LENGTH) return
      enteredPin += String(value)
      refreshKeypad()
      if (enteredPin.length >= MIN_PIN_LENGTH) verifyEnteredPin()
    },
    backspace() {
      enteredPin = enteredPin.slice(0, -1)
      refreshKeypad()
    },
    cancel() {
      if (mode === 'unlock' && readConfig()?.enabled) return
      setOverlay(false)
    },
    lockNow() {
      lockForPrivacy()
      renderUnlock()
    },
    changePin() {
      renderSetup()
    },
    disable() {
      const config = readConfig()
      if (!config?.enabled) return renderSettings()
      if (!confirm('ปิด App Lock ใช่ไหม? ข้อมูลจะไม่ถูกล็อกตอนเข้าแอป')) return
      writeConfig({ ...config, enabled: false, failureCount: 0, lockedUntil: 0 })
      unlocked = true
      notify('ปิด App Lock แล้ว', 'success')
      renderSettings()
      try { if (typeof App !== 'undefined') App.renderMore?.() } catch (_) {}
    },
    toggleBackgroundLock() {
      const config = readConfig() || {}
      writeConfig({ ...config, lockOnBackground: config.lockOnBackground === false })
      renderSettings()
      try { if (typeof App !== 'undefined') App.renderMore?.() } catch (_) {}
    },
  }
})()
