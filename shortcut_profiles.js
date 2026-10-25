/* Guided local-only wizard for user-defined notification profiles. */
;(function (root, factory) {
  const api = factory(root)
  if (root) root.MTShortcutProfiles = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const core = root.MTShortcutProfileCore || (typeof require === 'function' ? require('./shortcut_profile_core.js') : null)
  const STEP_LABELS = Object.freeze(['วางตัวอย่าง', 'ตรวจสอบข้อมูล', 'ทดลองและเปิดใช้'])
  const STEP_ORDER = Object.freeze(['samples', 'confirm', 'test'])
  const MAX_SAMPLE_LENGTH = 32768
  let state = createDraft('create')
  let detail = null
  let conflict = null
  let conflictStatus = 'idle'
  let completion = null

  function escape(value) {
    return root.MTSafeRender?.escapeHtml
      ? root.MTSafeRender.escapeHtml(value)
      : String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
  }

  function parseAnchors(value) {
    if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean).slice(0, 8)
    return String(value || '').split(/[\n,]+/u).map(item => item.trim()).filter(Boolean).slice(0, 8)
  }

  function directionLabel(direction) { return direction === 'credit' ? 'เงินเข้า/คืนเงิน' : direction === 'debit' ? 'เงินออก' : '' }
  function stepHeading(step) { return `ขั้น ${STEP_ORDER.indexOf(step) + 1} จาก 3` }
  function guideHref() {
    const pathname = String(root.location?.pathname || '')
    return pathname.includes('/demo/') ? '../outputs/money-tracker-shortcut-simple-setup-th.md' : 'outputs/money-tracker-shortcut-simple-setup-th.md'
  }

  function createDraft(mode = 'create', profile = null, handoff = {}) {
    const sampleText = String(handoff.sampleText || '')
    const existingRule = profile?.compiled_rule?.variants?.[0] || null
    return {
      mode,
      profileId: String(profile?.id || ''),
      profile: profile || null,
      expectedVersion: Number.isInteger(Number(profile?.profile_version)) ? Number(profile.profile_version) : null,
      step: 'samples',
      name: mode === 'create' ? '' : String(profile?.name || ''),
      nameTouched: mode !== 'create' && Boolean(profile?.name),
      appLabel: String(profile?.app_label || ''),
      direction: null,
      samples: [sampleText, ''],
      amountSelections: [null, null],
      amountCandidates: [[], []],
      mustContain: parseAnchors(existingRule?.mustContain),
      mustNotContain: parseAnchors(existingRule?.mustNotContain),
      advancedOpen: false,
      testResults: [],
      errors: {},
      saveStatus: 'idle',
      dirty: Boolean(sampleText),
      handoffCaptureId: String(handoff.captureId || ''),
    }
  }

  function clear() {
    state = createDraft('create')
    detail = null
    conflict = null
    conflictStatus = 'idle'
    completion = null
  }

  function getDefaultProfileName(draft) {
    const app = String(draft?.appLabel || '').trim()
    const direction = directionLabel(draft?.direction)
    if (draft?.nameTouched && String(draft.name || '').trim()) return String(draft.name).trim()
    if (app && direction) return `${app} — ${direction}`
    if (app) return app
    return 'โปรไฟล์แจ้งเตือนธนาคาร'
  }

  function profileViewModel(profile = {}) {
    const fields = ['id', 'name', 'app_label', 'enabled', 'short_code', 'profile_version', 'disabled_at', 'format_version', 'created_at', 'updated_at']
    return fields.reduce((result, key) => {
      if (Object.prototype.hasOwnProperty.call(profile, key)) result[key] = profile[key]
      return result
    }, {})
  }

  function sampleErrors(draft) {
    const errors = {}
    if (!String(draft.appLabel || '').trim()) errors.appLabel = 'ระบุชื่อแอป'
    const samples = Array.isArray(draft.samples) ? draft.samples : []
    if (samples.length !== 2) errors.samples = 'ต้องมีตัวอย่างแจ้งเตือน 2 รายการ'
    samples.slice(0, 2).forEach((sample, index) => {
      const value = String(sample || '')
      if (!value.trim()) errors[`sample_${index}`] = 'วางตัวอย่างแจ้งเตือนก่อนดำเนินการต่อ'
      else if (value.length > MAX_SAMPLE_LENGTH) errors[`sample_${index}`] = 'ตัวอย่างยาวเกิน 32,768 ตัวอักษร'
    })
    if (samples.length === 2 && samples.every(sample => String(sample || '').trim()) && String(samples[0]).trim() === String(samples[1]).trim()) errors.samples = 'ตัวอย่างแจ้งเตือนต้องไม่เหมือนกัน'
    return errors
  }

  function validateStep(draft, step = draft?.step) {
    const errors = step === 'samples' ? sampleErrors(draft) : {}
    let amountCandidates = Array.isArray(draft?.amountCandidates) ? draft.amountCandidates : [[], []]
    if (step !== 'samples') {
      const validation = core.validateProfileDraft({
        appLabel: draft.appLabel,
        samples: draft.samples,
        direction: draft.direction,
        amountSelections: draft.amountSelections,
        mustContain: draft.mustContain,
        mustNotContain: draft.mustNotContain,
      })
      Object.assign(errors, validation.errors)
      amountCandidates = validation.amountCandidates
    }
    if (step === 'test') {
      if (!Array.isArray(draft.testResults) || draft.testResults.length !== 2 || draft.testResults.some(result => result?.status !== 'complete')) errors.test = 'ทดสอบตัวอย่างทั้งสองรายการให้ผ่านก่อนเปิดใช้งาน'
    }
    return { valid: Object.keys(errors).length === 0, errors, amountCandidates }
  }

  function notify(message, type = 'info') { try { root.toast?.(message, type) } catch (_) {} }

  function syncAnchorDefaults() {
    if (state.mustContain.length) return
    const app = core.normalizeProfileText(state.appLabel)
    if (app && state.samples.every(sample => core.normalizeProfileText(sample).includes(app))) state.mustContain = [state.appLabel.trim()]
  }

  function prepareConfirm() {
    syncAnchorDefaults()
    state.amountCandidates = state.samples.map(sample => core.detectProfileAmountCandidates(sample))
    state.amountSelections = state.amountCandidates.map((candidates, index) => {
      const current = candidates.find(candidate => candidate.id === state.amountSelections[index] && !candidate.overlapsDateOrTime)
      if (current) return current.id
      const confirmed = candidates.filter(candidate => candidate.currencyConfirmed && !candidate.overlapsDateOrTime)
      return confirmed.length === 1 ? confirmed[0].id : null
    })
  }

  function compileDraft() {
    const validation = validateStep(state, 'confirm')
    if (!validation.valid) throw new Error(Object.values(validation.errors)[0] || 'ตรวจสอบข้อมูลก่อนดำเนินการต่อ')
    const samples = state.samples.map(sample => String(sample || '').trim())
    return core.compileProfileVariantRule({
      id: 'purchase',
      direction: state.direction,
      samples,
      selections: state.amountSelections.map(id => ({ amount: id })),
      mustContain: state.mustContain,
      mustNotContain: state.mustNotContain,
    })
  }

  function runLocalTests() {
    try {
      const rule = compileDraft()
      state.testResults = state.samples.map((sample, index) => {
        const result = core.matchProfileRule(rule, sample, new Date().toISOString())
        const candidate = core.detectProfileAmountCandidates(sample).find(item => item.id === state.amountSelections[index])
        return core.profileAmountMatches(result, candidate) ? result : { status: 'needs_review', reason: 'selected_amount_mismatch' }
      })
    } catch (error) {
      state.testResults = [{ status: 'needs_review', reason: error.message }, { status: 'needs_review', reason: error.message }]
    }
  }

  function resultReason(result) {
    return ({
      selected_amount_mismatch: 'ระบบจับยอดไม่ตรงกับยอดที่เลือก กลับไปเลือกยอดใหม่',
      no_variant_match: 'ระบบยังจับคู่รูปแบบไม่ได้ ตรวจคำที่ต้องมีและตัวอย่างอีกครั้ง',
      ambiguous_variant: 'พบหลายรูปแบบที่เป็นไปได้ ลองใช้คำที่ต้องมีให้เฉพาะเจาะจงขึ้น',
      notification_content_unavailable: 'ไม่มีข้อความแจ้งเตือนให้ตรวจสอบ',
    })[result?.reason] || 'ระบบยังจับคู่รูปแบบไม่ได้ ลองกลับไปตรวจสอบข้อมูล'
  }

  function errorLabel(key, errors = state.errors) {
    return errors?.[key] ? `<p class="shortcut-profile-error" id="profile-error-${escape(key)}" role="alert">${escape(errors[key])}</p>` : ''
  }

  function renderStepper(step) {
    const current = STEP_ORDER.indexOf(step)
    return `<div class="shortcut-profile-stepper" role="list" aria-label="ขั้นตอนการเพิ่มโปรไฟล์">${STEP_LABELS.map((label, index) => `<div class="shortcut-profile-step${index === current ? ' is-current' : index < current ? ' is-done' : ''}" role="listitem"><span>${index < current ? '✓' : index + 1}</span><small>${escape(label)}</small></div>${index < STEP_LABELS.length - 1 ? '<i aria-hidden="true"></i>' : ''}`).join('')}</div>`
  }

  function renderSamples() {
    const nameValue = state.nameTouched ? state.name : getDefaultProfileName(state)
    return `<div class="shortcut-profile-copy"><h3>วางตัวอย่างแจ้งเตือน</h3><p>ใช้ข้อความแจ้งเตือน 2 รายการจากแอปเดียวกัน ระบบจะเรียนรู้รูปแบบบนเครื่องนี้</p></div>
      <div class="shortcut-profile-privacy" role="note"><span aria-hidden="true">🔒</span><span>ตัวอย่างอยู่ในหน้านี้ชั่วคราว ไม่ถูกบันทึกหรือส่งขึ้นเซิร์ฟเวอร์</span></div>
      <div class="shortcut-profile-field"><label class="form-label" for="profile-app-label">ชื่อแอป <span aria-hidden="true">*</span></label><input id="profile-app-label" class="form-input" data-profile-field="app_label" maxlength="64" autocomplete="off" value="${escape(state.appLabel)}" placeholder="เช่น UCHOOSE" aria-describedby="profile-error-appLabel" aria-invalid="${state.errors.appLabel ? 'true' : 'false'}">${errorLabel('appLabel')}</div>
      <div class="shortcut-profile-field"><label class="form-label" for="profile-name">ชื่อโปรไฟล์ <span class="shortcut-profile-optional">(แก้ได้)</span></label><input id="profile-name" class="form-input" data-profile-field="name" maxlength="64" autocomplete="off" value="${escape(nameValue)}" placeholder="ชื่อที่จะแสดงในรายการ"></div>
      <div class="shortcut-profile-sample-grid">
        ${[0, 1].map(index => `<div class="shortcut-profile-sample-card"><div class="shortcut-profile-sample-heading"><label class="form-label" for="profile-sample-${index}">ตัวอย่างที่ ${index + 1} <span aria-hidden="true">*</span></label><span class="shortcut-profile-counter" data-profile-counter="${index}">${String(state.samples[index] || '').length.toLocaleString('th-TH')}/${MAX_SAMPLE_LENGTH.toLocaleString('th-TH')}</span></div><textarea id="profile-sample-${index}" class="form-input shortcut-profile-sample" data-profile-sample="${index}" maxlength="${MAX_SAMPLE_LENGTH}" rows="6" spellcheck="false" placeholder="แตะค้างเพื่อวางข้อความแจ้งเตือน" aria-invalid="${state.errors[`sample_${index}`] ? 'true' : 'false'}">${escape(state.samples[index])}</textarea>${errorLabel(`sample_${index}`)}</div>`).join('')}
      </div>
      ${errorLabel('samples')}`
  }

  function renderCandidateCards(index) {
    const candidates = state.amountCandidates[index] || []
    const usable = candidates.filter(candidate => !candidate.overlapsDateOrTime)
    if (!usable.length) return `<div class="shortcut-profile-empty-result">ไม่พบตัวเลขที่เลือกได้ในตัวอย่างนี้ กลับไปวางข้อความใหม่</div>${errorLabel(`amount_${index}`)}`
    return `<div class="shortcut-profile-candidate-list" role="radiogroup" aria-label="เลือกยอดเงินจากตัวอย่างที่ ${index + 1}">${usable.map(candidate => `<label class="shortcut-profile-candidate${state.amountSelections[index] === candidate.id ? ' is-selected' : ''}"><input type="radio" name="profile-amount-${index}" data-profile-amount="${index}" value="${escape(candidate.id)}"${state.amountSelections[index] === candidate.id ? ' checked' : ''}><span class="shortcut-profile-candidate-value">${escape(candidate.value)}</span><small>${candidate.currencyConfirmed ? 'พบหน่วย THB' : 'เลือกเอง'}</small></label>`).join('')}</div>${errorLabel(`amount_${index}`)}`
  }

  function renderConfirm() {
    return `<div class="shortcut-profile-copy"><h3>ตรวจสอบข้อมูลที่พบ</h3><p>ตรวจให้แน่ใจว่ายอดเงินและทิศทางถูกต้อง ก่อนทดลองใช้งานจริง</p></div>
      <fieldset class="shortcut-profile-fieldset"><legend class="form-label">รายการนี้เป็นแบบไหน <span aria-hidden="true">*</span></legend><div class="shortcut-profile-segmented" role="radiogroup" aria-label="ทิศทางรายการ"><label class="shortcut-profile-segment${state.direction === 'debit' ? ' is-selected' : ''}"><input type="radio" name="profile-direction" data-profile-direction="debit"${state.direction === 'debit' ? ' checked' : ''}>เงินออก</label><label class="shortcut-profile-segment${state.direction === 'credit' ? ' is-selected' : ''}"><input type="radio" name="profile-direction" data-profile-direction="credit"${state.direction === 'credit' ? ' checked' : ''}>เงินเข้า/คืนเงิน</label></div>${errorLabel('direction')}</fieldset>
      <div class="shortcut-profile-section-title">เลือกยอดเงินจากตัวอย่าง</div>
      ${[0, 1].map(index => `<section class="shortcut-profile-review-card"><div class="shortcut-profile-review-heading"><strong>ตัวอย่างที่ ${index + 1}</strong><span>${(state.amountCandidates[index] || []).filter(item => item.currencyConfirmed).length === 1 ? 'พบอัตโนมัติ' : 'ต้องเลือก'}</span></div>${renderCandidateCards(index)}</section>`).join('')}
      <div class="shortcut-profile-field"><label class="form-label" for="profile-must-contain">คำที่ต้องมี <span aria-hidden="true">*</span></label><input id="profile-must-contain" class="form-input" data-profile-field="must_contain" maxlength="256" value="${escape(state.mustContain.join(', '))}" placeholder="เช่น UCHOOSE" aria-describedby="profile-error-mustContain" aria-invalid="${state.errors.mustContain ? 'true' : 'false'}"><p class="form-hint">ใช้คำที่มีอยู่ในตัวอย่างทั้งสองรายการ คั่นด้วย comma หรือขึ้นบรรทัดใหม่</p>${errorLabel('mustContain')}</div>
      <details class="shortcut-profile-advanced"${state.advancedOpen ? ' open' : ''}><summary>ตั้งค่าขั้นสูง</summary><div class="shortcut-profile-field"><label class="form-label" for="profile-must-not-contain">คำที่ไม่ควรพบ <span class="shortcut-profile-optional">(ไม่บังคับ)</span></label><input id="profile-must-not-contain" class="form-input" data-profile-field="must_not_contain" maxlength="256" value="${escape(state.mustNotContain.join(', '))}" placeholder="เช่น OTP, รหัสผ่าน"><p class="form-hint">ถ้าพบคำเหล่านี้ ระบบจะไม่นำรายการเข้ามา</p></div></details>`
  }

  function resultLabel(result) {
    if (result?.status === 'complete') return '<span class="shortcut-profile-result-status is-pass">ผ่าน</span>'
    if (result?.status === 'ignored') return '<span class="shortcut-profile-result-status is-warn">จะไม่รับรายการ</span>'
    return '<span class="shortcut-profile-result-status is-fail">ต้องตรวจสอบ</span>'
  }

  function renderTest() {
    return `<div class="shortcut-profile-copy"><h3>ทดลองก่อนเปิดใช้</h3><p>ผลนี้คำนวณในเครื่องจากตัวอย่างที่คุณวางไว้ ยังไม่มีการส่งข้อมูลไปที่ระบบ</p></div><div class="shortcut-profile-result-list" role="status" aria-live="polite">${[0, 1].map(index => { const result = state.testResults[index] || {}; return `<article class="shortcut-profile-result"><div><strong>ตัวอย่างที่ ${index + 1}</strong><small>${result.status === 'complete' ? `${directionLabel(result.value?.direction)} · ${escape(result.value?.amount || '')} บาท` : escape(resultReason(result))}</small></div>${resultLabel(result)}</article>` }).join('')}</div>${errorLabel('test')}`
  }

  function renderWizard() {
    const validation = validateStep(state, state.step)
    const canContinue = validation.valid
    const isSaving = state.saveStatus === 'saving'
    const actionHint = Object.values(state.errors || {})[0] || ''
    const body = state.step === 'samples' ? renderSamples() : state.step === 'confirm' ? renderConfirm() : renderTest()
    const primaryLabel = state.step === 'samples' ? 'ถัดไป' : state.step === 'confirm' ? 'ทดลองตัวอย่าง' : 'เปิดใช้งานโปรไฟล์'
    const primaryAction = state.step === 'test' ? 'save' : 'next'
    const busyAttr = isSaving ? ' disabled aria-disabled="true"' : ''
    return `<section class="shortcut-profile-shell shortcut-profile-editor" data-profile-mode="${escape(state.mode)}" aria-busy="${isSaving}"><div class="sub-header shortcut-profile-header"><button type="button" class="btn-icon" data-profile-action="back" aria-label="ย้อนกลับ"${busyAttr}>←</button><div><h2 tabindex="-1" data-profile-heading>${state.mode === 'relearn' ? 'เรียนรู้รูปแบบใหม่' : 'เพิ่มแอปธนาคาร'}</h2><p>${stepHeading(state.step)}</p></div><div></div></div>${renderStepper(state.step)}<div class="sub-scroll shortcut-profile-scroll">${body}</div><p class="shortcut-profile-action-hint" id="profile-action-hint" role="status"${actionHint ? '' : ' hidden'}>${escape(actionHint)}</p><div class="shortcut-profile-footer"><button type="button" class="btn btn-secondary" data-profile-action="cancel"${busyAttr}>ยกเลิก</button><button type="button" class="btn btn-primary" data-profile-action="${primaryAction}"${canContinue && !isSaving ? '' : ' disabled'} aria-describedby="profile-action-hint">${isSaving ? 'กำลังบันทึก…' : primaryLabel}</button></div></section>`
  }

  function renderList(result = {}, error = '') {
    const profiles = Array.isArray(result.profiles) ? result.profiles.map(profileViewModel) : []
    const body = result.loading
      ? '<div class="shortcut-profile-skeleton-list"><div></div><div></div></div>'
      : error
        ? `<div class="shortcut-profile-state is-error" role="alert"><strong>โหลดโปรไฟล์ไม่สำเร็จ</strong><p>${escape(errorMessage(error))}</p><button type="button" class="btn btn-secondary" data-profile-action="retry">ลองอีกครั้ง</button></div>`
        : profiles.length
          ? `<div class="shortcut-profile-list">${profiles.map(profile => `<button type="button" class="shortcut-profile-row" data-profile-open="${escape(profile.id)}"><span class="shortcut-profile-row-icon" aria-hidden="true">🏦</span><span class="shortcut-profile-row-main"><strong>${escape(profile.name)}</strong><small>${escape(profile.app_label || profile.short_code || '')}</small></span><span class="shortcut-profile-row-status${profile.enabled ? ' is-enabled' : ''}">${profile.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span><span aria-hidden="true">›</span></button>`).join('')}</div>`
          : '<div class="shortcut-profile-empty"><div aria-hidden="true">🏦</div><strong>ยังไม่มีแอปธนาคาร</strong><p>เพิ่มตัวอย่างแจ้งเตือน 2 รายการ แล้วให้ Money Tracker เรียนรู้รูปแบบ</p></div>'
    return `<section class="shortcut-profile-shell shortcut-profile-screen"><div class="sub-header shortcut-profile-header"><button type="button" class="btn-icon" data-profile-action="close" aria-label="ย้อนกลับ">←</button><h2>รูปแบบแจ้งเตือนธนาคาร</h2><div></div></div><div class="sub-scroll shortcut-profile-scroll"><div class="shortcut-profile-intro"><h3>เพิ่มการตรวจจับแอปธนาคาร</h3><p>คัดลอกตัวอย่างแจ้งเตือน 2 รายการจากแอปเดียวกัน ตัวอย่างจะอยู่ในเครื่องนี้เท่านั้น</p></div>${body}</div>${!result.loading && !error ? '<div class="shortcut-profile-footer"><button type="button" class="btn btn-primary" data-profile-action="new">เพิ่มแอปธนาคาร</button></div>' : ''}</section>`
  }

  function renderRuleSummary(profile) {
    const rule = profile?.compiled_rule?.variants?.[0] || null
    const anchors = parseAnchors(rule?.mustContain)
    const fields = ['amount', 'date', 'time', 'merchant', 'accountLast4', 'cardLast4', 'transactionReference'].filter(key => rule?.[key]).length
    return `<section class="shortcut-profile-rule-summary" aria-label="สรุปรูปแบบการตรวจจับ"><h4>สรุปรูปแบบการตรวจจับ</h4><div><span>ทิศทาง</span><strong>${escape(directionLabel(rule?.direction) || 'ยังไม่ระบุ')}</strong></div><div><span>คำที่ต้องมี</span><strong>${escape(anchors.join(', ') || '—')}</strong></div><div><span>ข้อมูลที่ดึง</span><strong>${fields ? `${fields} ฟิลด์` : 'กฎพร้อมใช้งาน'}</strong></div></section>`
  }

  function renderDetails(profile) {
    const enabled = detail?.enabled ?? profile.enabled
    const detailError = detail?.error ? `<p class="shortcut-profile-error" role="alert">${escape(detail.error)}</p>` : ''
    return `<section class="shortcut-profile-shell shortcut-profile-details"><div class="sub-header shortcut-profile-header"><button type="button" class="btn-icon" data-profile-action="back-list" aria-label="ย้อนกลับ">←</button><h2>รายละเอียดโปรไฟล์</h2><div></div></div><div class="sub-scroll shortcut-profile-scroll"><div class="shortcut-profile-detail-hero"><span aria-hidden="true">🏦</span><div><h3>${escape(profile.name)}</h3><p>${escape(profile.app_label || profile.short_code || '')}</p></div></div>${renderRuleSummary(profile)}<div class="shortcut-profile-field"><label class="form-label" for="profile-detail-name">ชื่อโปรไฟล์</label><input id="profile-detail-name" class="form-input" data-detail-field="name" maxlength="64" value="${escape(detail?.name ?? profile.name)}"></div><div class="shortcut-profile-field"><label class="form-label" for="profile-detail-app">ชื่อแอป</label><input id="profile-detail-app" class="form-input" data-detail-field="app_label" maxlength="64" value="${escape((detail?.appLabel ?? profile.app_label) ?? '')}"></div><label class="shortcut-profile-toggle"><input type="checkbox" data-detail-field="enabled"${enabled ? ' checked' : ''}><span>เปิดใช้งานโปรไฟล์นี้</span></label><div class="shortcut-profile-marker"><span>รหัสสำหรับ Automation</span><code>MT-PROFILE:${escape(profile.short_code || '')}</code><button type="button" class="btn btn-secondary" data-profile-action="copy-marker">คัดลอก</button></div>${detailError}</div><div class="shortcut-profile-footer"><button type="button" class="btn btn-secondary" data-profile-action="relearn">เรียนรู้รูปแบบใหม่</button><button type="button" class="btn btn-primary" data-profile-action="save-detail">บันทึก</button></div></section>`
  }

  function renderCompletion(profile) {
    const direction = profile.direction || profile.compiled_rule?.variants?.[0]?.direction
    return `<section class="shortcut-profile-shell shortcut-profile-complete"><div class="sub-header shortcut-profile-header"><div></div><h2>โปรไฟล์พร้อมใช้งาน</h2><div></div></div><div class="sub-scroll shortcut-profile-scroll"><div class="shortcut-profile-success-icon" aria-hidden="true">✓</div><div class="shortcut-profile-copy is-centered"><h3>${escape(profile.name || 'โปรไฟล์ใหม่')}</h3><p>${escape(profile.app_label || '')} · ${escape(directionLabel(direction) || 'รูปแบบที่ยืนยันแล้ว')} · ${profile.enabled === false ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</p></div><div class="shortcut-profile-marker"><span>ใส่รหัสนี้ใน Text action ของ Automation</span><code>MT-PROFILE:${escape(profile.short_code || '')}</code><button type="button" class="btn btn-secondary" data-profile-action="copy-marker">คัดลอก</button></div><div class="shortcut-profile-instructions"><strong>ตั้ง Automation บน iPhone</strong><ol><li>เปิด Shortcuts → Automation → Notification</li><li>เพิ่ม Text action เป็น <code>MT-PROFILE:${escape(profile.short_code || '')}</code></li><li>ต่อด้วย Title, Subtitle และ Message/Body แล้ว Run Shortcut</li></ol><a class="btn btn-secondary shortcut-profile-guide" href="${escape(guideHref())}" target="_blank" rel="noopener">เปิดคู่มือการตั้ง Automation</a></div></div><div class="shortcut-profile-footer"><button type="button" class="btn btn-primary" data-profile-action="done">เสร็จแล้ว</button></div></section>`
  }

  function renderConflict() {
    const latest = conflict?.latest || {}
    const isSaving = conflictStatus === 'saving'
    const pendingName = conflict?.mode === 'metadata' ? detail?.name : getDefaultProfileName(state)
    const pendingApp = conflict?.mode === 'metadata' ? detail?.appLabel : state.appLabel
    const pendingDirection = conflict?.mode === 'metadata' ? '' : directionLabel(state.direction)
    const currentVersion = conflict?.mode === 'metadata' ? detail?.profile?.profile_version : state.expectedVersion
    const pendingEnabled = conflict?.mode === 'metadata' ? detail?.enabled !== false : true
    const busyAttr = isSaving ? ' disabled aria-disabled="true"' : ''
    return `<section class="shortcut-profile-shell shortcut-profile-conflict" aria-busy="${isSaving}"><div class="sub-header shortcut-profile-header"><button type="button" class="btn-icon" data-profile-action="conflict-back" aria-label="ย้อนกลับ"${busyAttr}>←</button><h2>ข้อมูลถูกแก้ไขแล้ว</h2><div></div></div><div class="sub-scroll shortcut-profile-scroll"><div class="shortcut-profile-state is-warning" role="alert"><strong>โปรไฟล์นี้มีเวอร์ชันใหม่กว่า</strong><p>เพื่อป้องกันการเขียนทับข้อมูลของคุณ โปรดตรวจสอบข้อมูลล่าสุดก่อนยืนยัน</p></div><div class="shortcut-profile-conflict-card"><span>เวอร์ชันล่าสุด · v${escape(latest.profile_version ?? '—')}</span><strong>${escape(latest.name || '')}</strong><small>${escape(latest.app_label || '')} · ${latest.enabled === false ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</small><hr><span>การเปลี่ยนแปลงที่รอยืนยัน · จาก v${escape(currentVersion ?? '—')}</span><strong>${escape(pendingName || 'ยังไม่ระบุชื่อ')}</strong><small>${escape(pendingApp || '')}${pendingDirection ? ` · ${escape(pendingDirection)}` : ''} · ${pendingEnabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</small></div></div><div class="shortcut-profile-footer"><button type="button" class="btn btn-secondary" data-profile-action="conflict-discard"${busyAttr}>ใช้ข้อมูลล่าสุด</button><button type="button" class="btn btn-primary" data-profile-action="conflict-reapply"${busyAttr}>${isSaving ? 'กำลังบันทึก…' : 'ยืนยันการแทนที่'}</button></div></section>`
  }

  function errorMessage(error) {
    const code = String(error?.code || error?.message || error || '')
    return ({ profile_conflict: 'มีคนแก้ไขโปรไฟล์นี้ก่อนหน้า กรุณาตรวจสอบเวอร์ชันล่าสุด', profile_unavailable: 'โปรไฟล์ไม่พร้อมใช้งานในขณะนี้', UNAUTHORIZED: 'กรุณาเข้าสู่ระบบใหม่', invalid_profile: 'ข้อมูลโปรไฟล์ไม่ถูกต้อง' })[code] || 'ลองใหม่อีกครั้ง'
  }

  function mount(html, bind) {
    root.App?.openSubScreen?.(html, { animate: false })
    try { bind?.() } catch (_) {}
  }

  function focusHeading() { try { root.document?.querySelector?.('[data-profile-heading]')?.focus() } catch (_) {} }

  function syncWizard(screen) {
    if (!screen) return
    const name = screen.querySelector('[data-profile-field="name"]')?.value
    if (name !== undefined) {
      const defaultName = getDefaultProfileName(state)
      if (state.nameTouched || String(name).trim() !== defaultName) { state.name = name; state.nameTouched = true }
    }
    const appLabel = screen.querySelector('[data-profile-field="app_label"]')?.value
    if (appLabel !== undefined) state.appLabel = appLabel
    screen.querySelectorAll('[data-profile-sample]').forEach(input => { state.samples[Number(input.dataset.profileSample)] = input.value })
    const mustContain = screen.querySelector('[data-profile-field="must_contain"]')?.value
    if (mustContain !== undefined) state.mustContain = parseAnchors(mustContain)
    const mustNotContain = screen.querySelector('[data-profile-field="must_not_contain"]')?.value
    if (mustNotContain !== undefined) state.mustNotContain = parseAnchors(mustNotContain)
    screen.querySelectorAll('[data-profile-amount]:checked').forEach(input => { state.amountSelections[Number(input.dataset.profileAmount)] = input.value })
  }

  function refreshWizardAction(screen) {
    const action = screen?.querySelector?.('[data-profile-action="next"], [data-profile-action="save"]')
    if (!action) return
    const validation = validateStep(state, state.step)
    state.errors = validation.errors
    action.disabled = !validation.valid
    action.setAttribute('aria-disabled', String(!validation.valid))
    const message = Object.values(validation.errors || {})[0] || ''
    const hint = screen.querySelector('[data-profile-action-hint], #profile-action-hint')
    if (hint) { hint.textContent = message; hint.hidden = !message }
    action.setAttribute('aria-describedby', message ? 'profile-action-hint' : '')
    const fieldSelectors = {
      appLabel: '[data-profile-field="app_label"]',
      mustContain: '[data-profile-field="must_contain"]',
      mustNotContain: '[data-profile-field="must_not_contain"]',
      sample_0: '[data-profile-sample="0"]',
      sample_1: '[data-profile-sample="1"]',
    }
    Object.entries(fieldSelectors).forEach(([key, selector]) => screen.querySelector(selector)?.setAttribute('aria-invalid', String(Boolean(validation.errors?.[key]))))
  }

  function bindWizard() {
    const screen = root.document?.querySelector?.('.shortcut-profile-editor')
    if (!screen) return
    screen.querySelectorAll('[data-profile-sample]').forEach(input => input.addEventListener('input', event => {
      const index = Number(input.dataset.profileSample)
      state.samples[index] = event.target.value
      state.amountSelections[index] = null
      state.amountCandidates[index] = core.detectProfileAmountCandidates(event.target.value)
      state.testResults = []
      state.dirty = true
      const counter = screen.querySelector(`[data-profile-counter="${index}"]`)
      if (counter) counter.textContent = `${event.target.value.length.toLocaleString('th-TH')}/${MAX_SAMPLE_LENGTH.toLocaleString('th-TH')}`
      refreshWizardAction(screen)
    }))
    screen.querySelector('[data-profile-field="app_label"]')?.addEventListener('input', event => {
      state.appLabel = event.target.value
      state.dirty = true
      if (!state.nameTouched) {
        const name = screen.querySelector('[data-profile-field="name"]')
        if (name) name.value = getDefaultProfileName(state)
      }
      refreshWizardAction(screen)
    })
    screen.querySelector('[data-profile-field="name"]')?.addEventListener('input', event => { state.name = event.target.value; state.nameTouched = true; state.dirty = true; refreshWizardAction(screen) })
    screen.querySelector('[data-profile-field="must_contain"]')?.addEventListener('input', event => { state.mustContain = parseAnchors(event.target.value); state.dirty = true; refreshWizardAction(screen) })
    screen.querySelector('[data-profile-field="must_not_contain"]')?.addEventListener('input', event => { state.mustNotContain = parseAnchors(event.target.value); state.dirty = true; refreshWizardAction(screen) })
    screen.querySelectorAll('[data-profile-direction]').forEach(input => input.addEventListener('change', event => {
      state.direction = event.target.dataset.profileDirection
      state.dirty = true
      screen.querySelectorAll('[data-profile-direction]').forEach(option => option.closest('label')?.classList.toggle('is-selected', option.checked))
      if (!state.nameTouched) { const name = screen.querySelector('[data-profile-field="name"]'); if (name) name.value = getDefaultProfileName(state) }
      refreshWizardAction(screen)
    }))
    screen.querySelectorAll('[data-profile-amount]').forEach(input => input.addEventListener('change', event => { state.amountSelections[Number(input.dataset.profileAmount)] = event.target.value; state.dirty = true; screen.querySelectorAll(`[data-profile-amount="${input.dataset.profileAmount}"]`).forEach(option => option.closest('label')?.classList.toggle('is-selected', option.checked)); refreshWizardAction(screen) }))
    if (state.saveStatus !== 'saving') {
      screen.querySelector('[data-profile-action="back"]')?.addEventListener('click', () => handleWizardBack())
      screen.querySelector('[data-profile-action="cancel"]')?.addEventListener('click', () => handleWizardCancel())
    }
    screen.querySelector('[data-profile-action="next"]')?.addEventListener('click', () => goNext())
    screen.querySelector('[data-profile-action="save"]')?.addEventListener('click', () => saveWizard())
  }

  function mountWizard() { mount(renderWizard(), bindWizard); focusHeading() }

  function goNext() {
    const screen = root.document?.querySelector?.('.shortcut-profile-editor')
    syncWizard(screen)
    const result = validateStep(state, state.step)
    state.errors = result.errors
    if (!result.valid) { mountWizard(); focusFirstError(); return }
    if (state.step === 'samples') { prepareConfirm(); state.step = 'confirm' }
    else if (state.step === 'confirm') { runLocalTests(); state.step = 'test' }
    state.errors = {}
    mountWizard()
  }

  function focusFirstError() { try { root.document?.querySelector?.('.shortcut-profile-error')?.previousElementSibling?.focus?.() } catch (_) {} }

  function discardWizard() {
    const discard = () => {
      const wasRelearn = state.mode === 'relearn'
      const profileId = state.profileId
      const originProfile = detail?.profile || state.profile
      state = createDraft('create')
      conflict = null
      if (wasRelearn && profileId) return originProfile?.id ? showDetails(originProfile) : openDetails(profileId)
      openList()
    }
    if (!state.dirty) return discard()
    if (root.App?.showConfirm) root.App.showConfirm({ title: 'ละทิ้งข้อมูลที่กรอก?', body: 'ตัวอย่างแจ้งเตือนจะไม่ถูกเก็บไว้', danger: true, confirmLabel: 'ละทิ้ง', onConfirm: discard })
    else discard()
  }

  function returnToPreviousStep() {
    const screen = root.document?.querySelector?.('.shortcut-profile-editor')
    syncWizard(screen)
    if (state.step === 'test') {
      state.step = 'confirm'
      state.testResults = []
      state.errors = {}
      mountWizard()
      return
    }
    if (state.step === 'confirm') {
      state.step = 'samples'
      state.errors = {}
      mountWizard()
      return
    }
    discardWizard()
  }

  function handleWizardBack() { returnToPreviousStep() }
  function handleWizardCancel() { discardWizard() }

  async function saveWizard() {
    if (state.saveStatus === 'saving') return
    const screen = root.document?.querySelector?.('.shortcut-profile-editor')
    syncWizard(screen)
    const validation = validateStep(state, 'test')
    state.errors = validation.errors
    if (!validation.valid) { mountWizard(); focusFirstError(); return }
    state.saveStatus = 'saving'
    mountWizard()
    try {
      const rule = compileDraft()
      const payload = { name: getDefaultProfileName(state), app_label: String(state.appLabel || '').trim(), enabled: true, compiled_rule: rule }
      const result = state.profileId ? await root.MTShortcutCapture.updateProfile(state.profileId, { ...payload, expected_version: state.expectedVersion }) : await root.MTShortcutCapture.createProfile(payload)
      completion = { ...(result.profile || result), direction: state.direction, mustContain: [...state.mustContain], mustNotContain: [...state.mustNotContain] }
      state = createDraft('create')
      mount(renderCompletion(completion), bindCompletion)
    } catch (error) {
      state.saveStatus = 'idle'
      if (String(error?.code || error?.message || '').includes('profile_conflict')) return openConflict('relearn')
      state.errors = { test: errorMessage(error) }
      mountWizard()
    }
  }

  function copyMarker() {
    const code = detail?.profile?.short_code || completion?.short_code || ''
    if (!code) return
    root.navigator?.clipboard?.writeText?.(`MT-PROFILE:${code}`).then(() => notify('คัดลอกแล้ว', 'success')).catch(() => notify('คัดลอกไม่สำเร็จ ให้แตะค้างที่รหัส', 'warn'))
  }

  function bindCompletion() {
    root.document?.querySelector('[data-profile-action="copy-marker"]')?.addEventListener('click', copyMarker)
    root.document?.querySelector('[data-profile-action="done"]')?.addEventListener('click', () => openList())
  }

  function showDetails(profile) {
    completion = null
    detail = { profile, name: profile.name || '', appLabel: profile.app_label || '', enabled: profile.enabled !== false }
    mount(renderDetails(profile), bindDetails)
  }

  function bindDetails() {
    const screen = root.document?.querySelector?.('.shortcut-profile-details')
    if (!screen) return
    screen.querySelector('[data-detail-field="name"]')?.addEventListener('input', event => { detail.name = event.target.value; detail.dirty = true })
    screen.querySelector('[data-detail-field="app_label"]')?.addEventListener('input', event => { detail.appLabel = event.target.value; detail.dirty = true })
    screen.querySelector('[data-detail-field="enabled"]')?.addEventListener('change', event => { detail.enabled = event.target.checked; detail.dirty = true })
    screen.querySelector('[data-profile-action="back-list"]')?.addEventListener('click', () => openList())
    screen.querySelector('[data-profile-action="relearn"]')?.addEventListener('click', () => { state = createDraft('relearn', detail.profile); mountWizard() })
    screen.querySelector('[data-profile-action="save-detail"]')?.addEventListener('click', saveDetails)
    screen.querySelector('[data-profile-action="copy-marker"]')?.addEventListener('click', copyMarker)
  }

  async function saveDetails() {
    try {
      const result = await root.MTShortcutCapture.updateProfile(detail.profile.id, { name: String(detail.name || '').trim(), app_label: String(detail.appLabel || '').trim(), enabled: detail.enabled, compiled_rule: detail.profile.compiled_rule, expected_version: detail.profile.profile_version })
      showDetails({ ...detail.profile, ...(result.profile || result), name: detail.name, app_label: detail.appLabel, enabled: detail.enabled })
    } catch (error) {
      if (String(error?.code || error?.message || '').includes('profile_conflict')) return openConflict('metadata')
      detail.error = errorMessage(error)
      mount(renderDetails(detail.profile), bindDetails)
    }
  }

  async function openConflict(mode) {
    try {
      conflictStatus = 'idle'
      const profileId = mode === 'metadata' ? detail?.profile?.id : state.profileId
      const result = await root.MTShortcutCapture.getProfile(profileId)
      conflict = { mode, latest: result.profile || result }
      mount(renderConflict(), bindConflict)
    } catch (error) {
      conflictStatus = 'idle'
      if (mode === 'metadata' && detail?.profile) {
        detail.error = errorMessage(error)
        mount(renderDetails(detail.profile), bindDetails)
      } else {
        state.saveStatus = 'idle'
        state.errors = { test: errorMessage(error) }
        mountWizard()
      }
    }
  }

  function bindConflict() {
    if (conflictStatus === 'saving') return
    root.document?.querySelector('[data-profile-action="conflict-back"]')?.addEventListener('click', () => modeBackFromConflict())
    root.document?.querySelector('[data-profile-action="conflict-discard"]')?.addEventListener('click', () => {
      if (!conflict?.latest) return
      const latest = conflict.latest
      state = createDraft('create')
      conflict = null
      conflictStatus = 'idle'
      showDetails(latest)
    })
    root.document?.querySelector('[data-profile-action="conflict-reapply"]')?.addEventListener('click', () => confirmConflict())
  }

  function modeBackFromConflict() { if (conflict?.mode === 'metadata' && detail?.profile) showDetails(detail.profile); else mountWizard() }

  function confirmConflict() {
    if (conflictStatus === 'saving') return
    const apply = async () => {
      if (!conflict?.latest) return
      conflictStatus = 'saving'
      mount(renderConflict(), bindConflict)
      if (conflict.mode === 'metadata') {
        try {
          const result = await root.MTShortcutCapture.updateProfile(conflict.latest.id, { name: String(detail.name || '').trim(), app_label: String(detail.appLabel || '').trim(), enabled: detail.enabled, compiled_rule: conflict.latest.compiled_rule, expected_version: conflict.latest.profile_version })
          conflictStatus = 'idle'
          showDetails({ ...conflict.latest, ...(result.profile || result), name: detail.name, app_label: detail.appLabel, enabled: detail.enabled })
        } catch (error) { conflictStatus = 'idle'; notify(errorMessage(error), 'error'); mount(renderConflict(), bindConflict) }
        return
      }
      state.profile = conflict.latest
      state.expectedVersion = conflict.latest.profile_version
      runLocalTests()
      if (state.testResults.some(result => result.status !== 'complete')) { conflictStatus = 'idle'; return mountWizard() }
      try {
        const rule = compileDraft()
        const result = await root.MTShortcutCapture.updateProfile(state.profileId, { name: getDefaultProfileName(state), app_label: state.appLabel.trim(), enabled: true, compiled_rule: rule, expected_version: state.expectedVersion })
        conflictStatus = 'idle'
        completion = { ...(result.profile || result), direction: state.direction, mustContain: [...state.mustContain], mustNotContain: [...state.mustNotContain] }
        state = createDraft('create')
        mount(renderCompletion(completion), bindCompletion)
      } catch (error) { conflictStatus = 'idle'; notify(errorMessage(error), 'error'); mount(renderConflict(), bindConflict) }
    }
    if (root.App?.showConfirm) root.App.showConfirm({ title: 'แทนที่โปรไฟล์เวอร์ชันล่าสุด?', body: 'ระบบจะใช้ข้อมูลที่คุณเพิ่งทดสอบและแทนที่กฎล่าสุด', danger: true, confirmLabel: 'ยืนยันการแทนที่', onConfirm: apply })
    else apply()
  }

  function bindList() {
    const screen = root.document?.querySelector?.('.shortcut-profile-screen')
    if (!screen) return
    screen.querySelector('[data-profile-action="close"]')?.addEventListener('click', () => { clear(); root.App?.closeSubScreen?.() })
    screen.querySelector('[data-profile-action="new"]')?.addEventListener('click', () => { completion = null; state = createDraft('create'); mountWizard() })
    screen.querySelector('[data-profile-action="retry"]')?.addEventListener('click', openList)
    screen.querySelectorAll('[data-profile-open]').forEach(button => button.addEventListener('click', () => openDetails(button.dataset.profileOpen)))
  }

  async function openDetails(profileId) {
    mount(renderDetails({ name: 'กำลังโหลด…', app_label: '', enabled: true }), () => {})
    try {
      const result = await root.MTShortcutCapture.getProfile(profileId)
      showDetails(result.profile || result)
    } catch (error) { mount(renderList({}, error), bindList) }
  }

  async function openList() {
    completion = null
    mount(renderList({ loading: true }), () => {})
    try {
      const result = await root.MTShortcutCapture.listProfiles()
      mount(renderList(result), bindList)
    } catch (error) { mount(renderList({}, error), bindList) }
  }

  function openEditor(profileId = '', handoff = {}) {
    completion = null
    if (!profileId) { state = createDraft('create', null, handoff); mountWizard(); return }
    root.MTShortcutCapture.getProfile(profileId).then(result => { state = createDraft('relearn', result.profile || result, handoff); mountWizard() }).catch(error => notify(errorMessage(error), 'error'))
  }

  const api = { openList, openEditor, clear }
  if (typeof module !== 'undefined' && module.exports) api.__test = { createDraft, validateStep, profileViewModel, getDefaultProfileName, stepHeading, stepLabels: STEP_LABELS }
  root.addEventListener?.('mt:auth-state-changed', clear)
  root.addEventListener?.('pagehide', clear)
  return Object.freeze(api)
})
