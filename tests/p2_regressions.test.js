const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const Calc = require('../calculations.js')

const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function quickParser() {
  const source = read('quick_capture.js')
  const context = {
    S: {
      wallets: [{ id:'cash', name:'เงินสด', type:'cash' }],
      categories: { expense:[{ id:'food', label:'อาหาร' }], income:[{ id:'salary', label:'เงินเดือน' }] },
      merchants: [],
    },
    App: {},
    MTSafeRender: require('../safe_render.js'),
    getTODAY: () => '2026-10-01',
    moneyFmt: value => String(value),
    window: {},
    document: {},
    console,
  }
  vm.runInNewContext(`${source.slice(0, source.indexOf('  // ── Speech API'))}\nApp.__parseQuickCapture = parseQuickCapture;})()`, context)
  return context.App.__parseQuickCapture
}

test('Thai word amounts keep the merchant and use the local calendar date', () => {
  const parse = quickParser()
  const result = parse('กาแฟ สองร้อยห้าสิบ บาท เมื่อวาน')
  assert.equal(result.amount, 250)
  assert.equal(result.merchant, 'กาแฟ')
  assert.equal(result.categoryId, 'food')
  assert.equal(result.date, '2026-09-30')
  assert.equal(result.confidence, 'high')
  const ambiguous = parse('กาแฟ 2050')
  assert.equal(ambiguous.amount, 2050)
  assert.equal(ambiguous.confidence, 'medium')
})

test('asset-unit formatting preserves integer zeroes while trimming only fractional zeroes', () => {
  assert.equal(Calc.fmtAssetUnits(1000), '1,000')
  assert.equal(Calc.fmtAssetUnits(1.25), '1.25')
  assert.equal(Calc.fmtAssetUnits(1.2), '1.2')
})

test('P2 fixes keep durable ordering, explicit long-PIN verification, and recurring overrides', () => {
  const app = read('app_v2.js')
  const lock = read('app_lock.js')
  const notifications = read('notifications_v2.js')
  const notificationFunction = read('supabase/functions/send-custom-notification-rules/index.ts')
  const quick = read('quick_capture.js')

  assert.match(app, /createdSequence/)
  assert.match(app, /nextDueDateOverride/)
  assert.match(app, /Math\.max\(240, usedQuota\(r\) \+ 240\)/)
  assert.match(app, /upcoming_bill/)
  assert.match(app, /subset\.length === 1 \|\| subset\.every\(r => r\.allowStacking !== false\)/)
  assert.match(lock, /MTAppLock\.verify\(\)/)
  assert.doesNotMatch(lock, /if \(enteredPin\.length >= MIN_PIN_LENGTH\) verifyEnteredPin\(\)/)
  assert.match(notificationFunction, /snapshot\?\.snapshot_date !== now\.date/)
  assert.match(notifications, /daysLeft >= 0 && b\.daysLeft <= 90/)
  assert.match(quick, /localDate\(d\)/)
  assert.doesNotMatch(quick, /text\s*=\s*replaceThaiNumbers\(text\)/)
})
