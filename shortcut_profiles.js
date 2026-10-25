/* Local two-sample profile wizard. Samples never enter transport or storage. */
;(function (root, factory) {
  const api = factory(root)
  if (root) root.MTShortcutProfiles = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'
  const core = root.MTShortcutProfileCore || (typeof require === 'function' ? require('./shortcut_profile_core.js') : null)
  let state = { profileId: '', profile: null, sampleText: '', samples: ['', ''], direction: 'debit', appLabel: '', mustContain: '', mustNotContain: '', stage: 'metadata', error: '' }

  function escape(value) { return root.MTSafeRender?.escapeHtml ? root.MTSafeRender.escapeHtml(value) : String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])) }
  function clear() { state = { profileId: '', profile: null, sampleText: '', samples: ['', ''], direction: 'debit', appLabel: '', mustContain: '', mustNotContain: '', stage: 'metadata', error: '' } }
  function parseAnchors(value) { return String(value || '').split(/[\n,]+/u).map(item => item.trim()).filter(Boolean).slice(0, 8) }
  function notify(message, type = 'info') { try { root.toast?.(message, type) } catch (_) {} }
  function compiledRule() {
    const samples = state.samples.map(value => String(value || '').trim())
    if (samples.length !== 2 || samples.some(value => !value)) throw new Error('ต้องมีตัวอย่างแจ้งเตือน 2 รายการ')
    const first = core.detectProfileCandidates(samples[0]).find(candidate => candidate.type === 'thb_amount')
    if (!first) throw new Error('เลือกจำนวนเงิน THB จากตัวอย่างก่อนบันทึก')
    const second = core.detectProfileCandidates(samples[1]).find(candidate => candidate.type === 'thb_amount')
    if (!second) throw new Error('ตัวอย่างที่ 2 ต้องมีจำนวนเงิน THB')
    const mustContain = parseAnchors(state.mustContain || state.appLabel)
    if (!mustContain.length) throw new Error('ต้องระบุคำที่ต้องมีอย่างน้อย 1 คำ เช่น ชื่อแอปหรือชื่อธนาคาร')
    const variant = core.compileProfileVariant({ id: 'purchase', direction: state.direction, samples, selections: [{ amount: first.id }, { amount: second.id }], mustContain, mustNotContain: parseAnchors(state.mustNotContain) })
    return { format_version: 1, variants: [variant] }
  }
  function renderList(result = {}, error = '') {
    const profiles = Array.isArray(result.profiles) ? result.profiles : []
    const rows = profiles.map(profile => `<article class="shortcut-profile-row"><div><strong>${escape(profile.name)}</strong><small>${escape(profile.app_label || profile.short_code)} · ${profile.enabled ? 'ใช้งานอยู่' : 'เก็บถาวร'}</small></div><button type="button" class="btn btn-secondary" data-profile-edit="${escape(profile.id)}">แก้ไข</button></article>`).join('')
    return `<section class="shortcut-profile-screen"><div class="sub-header"><button type="button" class="btn-icon" data-profile-action="close" aria-label="ย้อนกลับ">←</button><h2>รูปแบบแจ้งเตือนธนาคาร</h2><div></div></div><p>สร้างจากตัวอย่าง 2 รายการ โดยข้อความตัวอย่างอยู่ในเครื่องเท่านั้น</p>${error ? `<div role="alert">${escape(error)}</div>` : ''}<div class="shortcut-profile-list">${rows || '<p>ยังไม่มีโปรไฟล์</p>'}</div><button type="button" class="btn btn-primary" data-profile-action="new">เพิ่มแอปธนาคาร</button></section>`
  }
  function renderEditor() {
    const canSave = state.samples.every(value => String(value || '').trim())
    const appLabel = state.appLabel || state.profile?.app_label || ''
    return `<section class="shortcut-profile-editor"><div class="sub-header"><button type="button" class="btn-icon" data-profile-action="cancel" aria-label="ยกเลิก">←</button><h2>${state.profileId ? 'แก้ไขรูปแบบแจ้งเตือน' : 'เพิ่มแอปธนาคาร'}</h2><div></div></div><p>ขั้นที่ 1–7: ตั้งชื่อ → ตัวอย่าง 1 → ตัวอย่าง 2 → เลือกทิศทาง/ฟิลด์ → include/exclude → ทดสอบในเครื่อง → บันทึก</p><label>ชื่อโปรไฟล์<input class="form-input" data-profile-field="name" maxlength="64" value="${escape(state.profile?.name || '')}"></label><label>ชื่อแอป (ถ้ามี)<input class="form-input" data-profile-field="app_label" maxlength="64" value="${escape(appLabel)}"></label><label>คำที่ต้องมี (คั่นด้วย comma หรือขึ้นบรรทัดใหม่)<input class="form-input" data-profile-field="must_contain" maxlength="256" placeholder="เช่น UCHOOSE" value="${escape(state.mustContain)}"></label><label>คำที่ต้องไม่พบ (ไม่บังคับ)<input class="form-input" data-profile-field="must_not_contain" maxlength="256" placeholder="เช่น OTP, รหัสผ่าน" value="${escape(state.mustNotContain)}"></label><label>ตัวอย่างที่ 1 (เก็บในเครื่องเท่านั้น)<textarea data-profile-sample="0" rows="5">${escape(state.samples[0])}</textarea></label><label>ตัวอย่างที่ 2 (เก็บในเครื่องเท่านั้น)<textarea data-profile-sample="1" rows="5">${escape(state.samples[1])}</textarea></label><label>ทิศทางเริ่มต้น<select data-profile-field="direction"><option value="debit" ${state.direction === 'debit' ? 'selected' : ''}>เงินออก</option><option value="credit" ${state.direction === 'credit' ? 'selected' : ''}>เงินเข้า/คืนเงิน</option></select></label><p class="form-hint">เลือกจำนวน THB และตรวจผลในเครื่องให้ได้ 1 รายการก่อนเปิดใช้งาน โปรไฟล์จะรับเฉพาะข้อความที่มี marker ของโปรไฟล์</p><button type="button" class="btn btn-primary" data-profile-action="save" ${canSave ? '' : 'disabled'}>บันทึกโปรไฟล์</button><button type="button" class="btn btn-secondary" data-profile-action="test">ทดสอบในเครื่อง</button></section>`
  }
  function renderAutomation(profile) { const code = String(profile?.short_code || ''); return `<div class="shortcut-profile-instructions" role="status"><strong>ตั้ง Automation บน iPhone</strong><p>เพิ่ม Text action เป็น <code>MT-PROFILE:${escape(code)}</code> แล้วต่อด้วย Title, Subtitle และ Message/Body ของ Notification คั่นด้วยบรรทัดใหม่ ก่อน Run Shortcut</p></div>` }
  function showEditor() { root.App?.openSubScreen?.(renderEditor(), { animate: false }); bindEditor() }
  function bindEditor() {
    const doc = root.document; const screen = doc?.querySelector?.('.shortcut-profile-editor'); if (!screen) return
    screen.querySelectorAll('[data-profile-sample]').forEach(input => input.addEventListener('input', event => { state.samples[Number(input.dataset.profileSample)] = event.target.value; showEditor() }))
    screen.querySelector('[data-profile-field="app_label"]')?.addEventListener('input', event => { state.appLabel = event.target.value; showEditor() })
    screen.querySelector('[data-profile-field="must_contain"]')?.addEventListener('input', event => { state.mustContain = event.target.value; showEditor() })
    screen.querySelector('[data-profile-field="must_not_contain"]')?.addEventListener('input', event => { state.mustNotContain = event.target.value; showEditor() })
    screen.querySelector('[data-profile-field="direction"]')?.addEventListener('change', event => { state.direction = event.target.value; showEditor() })
    screen.querySelector('[data-profile-action="cancel"]')?.addEventListener('click', () => { clear(); root.App?.closeSubScreen?.() })
    screen.querySelector('[data-profile-action="test"]')?.addEventListener('click', () => { try { const result = core.matchProfileRule(compiledRule(), state.samples[0], new Date().toISOString()); notify(result.status === 'complete' ? 'ทดสอบผ่าน 1 รายการ' : 'ตัวอย่างยังต้องตรวจสอบ', result.status === 'complete' ? 'success' : 'warn') } catch (error) { notify(error.message, 'warn') } })
    screen.querySelector('[data-profile-action="save"]')?.addEventListener('click', async () => {
      try {
        const name = screen.querySelector('[data-profile-field="name"]')?.value || ''; const appLabel = screen.querySelector('[data-profile-field="app_label"]')?.value || ''; state.appLabel = appLabel; state.mustContain = screen.querySelector('[data-profile-field="must_contain"]')?.value || ''; state.mustNotContain = screen.querySelector('[data-profile-field="must_not_contain"]')?.value || ''; const rule = compiledRule(); const input = { name, app_label: appLabel, enabled: true, compiled_rule: rule }
        const result = state.profileId ? await root.MTShortcutCapture.updateProfile(state.profileId, { ...input, expected_version: state.profile?.profile_version }) : await root.MTShortcutCapture.createProfile(input)
        root.App?.openSubScreen?.(`${renderList({ profiles: [] })}${renderAutomation(result.profile || result)}`, { animate: false }); clear()
      } catch (error) { state.error = error.message || 'บันทึกไม่สำเร็จ'; notify(state.error, 'error') }
    })
  }
  async function openList() {
    try { const result = await root.MTShortcutCapture.listProfiles(); root.App?.openSubScreen?.(renderList(result), { animate: false }); bindList() } catch (error) { root.App?.openSubScreen?.(renderList({}, error), { animate: false }); bindList() }
  }
  function bindList() {
    const screen = root.document?.querySelector?.('.shortcut-profile-screen'); if (!screen) return
    screen.querySelector('[data-profile-action="close"]')?.addEventListener('click', () => { clear(); root.App?.closeSubScreen?.() })
    screen.querySelector('[data-profile-action="new"]')?.addEventListener('click', () => { clear(); showEditor() })
    screen.querySelectorAll('[data-profile-edit]').forEach(button => button.addEventListener('click', async () => { try { const result = await root.MTShortcutCapture.getProfile(button.dataset.profileEdit); state.profileId = button.dataset.profileEdit; state.profile = result.profile; state.samples = ['', '']; showEditor() } catch (error) { notify(error.message, 'error') } }))
  }
  function openEditor(profileId = '', handoff = {}) { clear(); state.profileId = String(profileId || ''); state.sampleText = String(handoff.sampleText || ''); if (state.sampleText) state.samples[0] = state.sampleText; if (profileId) root.MTShortcutCapture.getProfile(profileId).then(result => { state.profile = result.profile; showEditor() }).catch(error => notify(error.message, 'error')); else showEditor() }
  const api = Object.freeze({ openList, openEditor, clear })
  root.addEventListener?.('mt:auth-state-changed', clear)
  root.addEventListener?.('pagehide', clear)
  return api
})
