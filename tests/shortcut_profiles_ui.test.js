const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '../shortcut_profiles.js'), 'utf8')
const productionHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')
const demoHtml = fs.readFileSync(path.join(__dirname, '../demo/index.html'), 'utf8')
const release = require('../release_manifest.js')
const api = require('../shortcut_profiles.js').__test
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/shortcut_profile_cases.json'), 'utf8'))

function draftWithSamples() {
  const samples = [fixture.purchase.text, fixture.purchase.text.replace('120.50', '80.00')]
  const amountSelections = samples.map(sample => require('../shortcut_profile_core.js').detectProfileAmountCandidates(sample).find(item => item.currencyConfirmed)?.id)
  return { ...api.createDraft('create'), appLabel: 'UCHOOSE', samples, direction: 'debit', amountSelections, mustContain: ['UCHOOSE'], mustNotContain: [], testResults: [{ status: 'complete' }, { status: 'complete' }] }
}

test('profile wizard exposes two local sample stages and a local test before save', () => {
  assert.match(source, /data-profile-sample="\$\{index\}"/)
  assert.match(source, /ทดลองก่อนเปิดใช้/)
  assert.match(source, /ต้องมีตัวอย่างแจ้งเตือน 2 รายการ/)
  assert.match(source, /compiled_rule/)
})

test('profile wizard never sends or persists raw samples', () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(/)
  assert.match(source, /createProfile\(payload\)/)
  assert.doesNotMatch(source, /createProfile\([^)]*samples?/i)
  assert.match(source, /MT-PROFILE:/)
})

test('profile wizard uses user-supplied anchors instead of hardcoding one bank', () => {
  assert.match(source, /data-profile-field="must_contain"/)
  assert.match(source, /data-profile-field="must_not_contain"/)
  assert.match(source, /state\.mustContain/)
  assert.match(source, /state\.mustNotContain/)
  assert.doesNotMatch(source, /mustContain:\s*\[\s*['"]uchoose['"]\s*\]/i)
})

test('wizard draft starts neutral and exposes three explicit steps', () => {
  const draft = api.createDraft('create')
  assert.equal(draft.direction, null)
  assert.deepEqual(api.stepLabels, ['วางตัวอย่าง', 'ตรวจสอบข้อมูล', 'ทดลองและเปิดใช้'])
  assert.equal(api.stepHeading('samples'), 'ขั้น 1 จาก 3')
  assert.equal(api.stepHeading('confirm'), 'ขั้น 2 จาก 3')
  assert.equal(api.stepHeading('test'), 'ขั้น 3 จาก 3')
})

test('input listeners mutate the draft without re-rendering the whole sub-screen', () => {
  const sampleListenerStart = source.indexOf('data-profile-sample')
  const listStart = source.indexOf('function openList')
  const listenerBlock = source.slice(sampleListenerStart, listStart)
  assert.doesNotMatch(listenerBlock, /showEditor\(\)/)
  assert.doesNotMatch(listenerBlock, /openSubScreen\(/)
  assert.match(source, /refreshWizardAction\(screen\)/)
})

test('wizard back moves between steps while cancel keeps the discard guard', () => {
  assert.match(source, /function returnToPreviousStep\(\)/)
  assert.match(source, /state\.step = 'confirm'/)
  assert.match(source, /state\.step = 'samples'/)
  assert.match(source, /function handleWizardCancel\(\)/)
  assert.match(source, /root\.App\?\.showConfirm/)
})

test('default profile name follows app and direction only until the user edits it', () => {
  const draft = api.createDraft('create')
  draft.appLabel = 'UCHOOSE'
  draft.direction = 'debit'
  assert.equal(api.getDefaultProfileName(draft), 'UCHOOSE — เงินออก')
  draft.name = 'ค่าใช้จ่าย UCHOOSE'
  draft.nameTouched = true
  assert.equal(api.getDefaultProfileName(draft), 'ค่าใช้จ่าย UCHOOSE')
})

test('step validation requires a shared phrase before local activation', () => {
  const draft = draftWithSamples()
  draft.mustContain = ['ไม่พบในตัวอย่าง']
  const result = api.validateStep(draft, 'confirm')
  assert.equal(result.valid, false)
  assert.equal(result.errors.mustContain, 'คำที่ต้องมีต้องพบในตัวอย่างทั้งสองรายการ')
})

test('activation stays blocked until both local samples match completely', () => {
  const draft = draftWithSamples()
  draft.testResults = [{ status: 'complete' }, { status: 'needs_review' }]
  assert.equal(api.validateStep(draft, 'test').valid, false)
  draft.testResults = [{ status: 'complete' }, { status: 'complete' }]
  assert.equal(api.validateStep(draft, 'test').valid, true)
})

test('wizard invalidates a stale amount selection when a sample changes', () => {
  assert.match(source, /amountSelections\[index\]\s*=\s*null/)
  assert.match(source, /detectProfileAmountCandidates\(event\.target\.value\)/)
  assert.match(source, /prepareConfirm\(\)/)
})

test('wizard keeps save and navigation actions disabled while saving', () => {
  assert.match(source, /state\.saveStatus === 'saving'/)
  assert.match(source, /กำลังบันทึก/)
  assert.match(source, /if \(state\.saveStatus === 'saving'\) return/)
})

test('completion and details expose a guide and rule metadata without raw samples', () => {
  assert.match(source, /เปิดคู่มือการตั้ง Automation/)
  assert.match(source, /shortcut-profile-rule-summary/)
  assert.match(source, /directionLabel\(/)
  assert.doesNotMatch(source, /profile\.samples/)
})

test('conflict screen exposes the latest version and discards draft state safely', () => {
  assert.match(source, /latest\.profile_version/)
  assert.match(source, /pendingEnabled/)
  assert.match(source, /conflictStatus === 'saving'/)
  assert.match(source, /state\s*=\s*createDraft\('create'\)/)
})

test('profile marker follows the currently opened detail profile', () => {
  assert.match(source, /detail\?\.profile\?\.short_code \|\| completion\?\.short_code/)
  assert.match(source, /completion = null\n    detail = \{ profile/)
})

test('profile view model exposes metadata only and never raw samples or compiled rule', () => {
  const view = api.profileViewModel({ id: 'p1', name: 'UCHOOSE', app_label: 'UCHOOSE', enabled: true, short_code: 'ABC234', profile_version: 2, compiled_rule: { secret: true }, samples: ['private'] })
  assert.deepEqual(view, { id: 'p1', name: 'UCHOOSE', app_label: 'UCHOOSE', enabled: true, short_code: 'ABC234', profile_version: 2 })
})

test('profile wizard release assets are present and versioned in production and demo', () => {
  assert.equal(release.version, '2026.10.25-shortcut-profiles-r155')
  for (const html of [productionHtml, demoHtml]) {
    assert.match(html, new RegExp(`style_v2\\.css\\?v=${release.version}`))
    assert.match(html, new RegExp(`ui_v2\\.css\\?v=${release.version}`))
  }
})
