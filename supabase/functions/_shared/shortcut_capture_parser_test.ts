import { parseRawShortcutCapture } from './shortcut_capture_parser.ts'

function equal(actual: unknown, expected: unknown, message = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
}

async function rejectsCode(fn: () => Promise<unknown>, code: string) {
  try {
    await fn()
  } catch (error) {
    equal(Reflect.get(error as object, 'code'), code, 'error code')
    return
  }
  throw new Error(`Expected ${code}`)
}

Deno.test('server parser selects the latest SCB block and builds a complete capture', async () => {
  const result = await parseRawShortcutCapture({
    raw_text: [
      'SCB Connect',
      'รายการเงินออก -20.00 บาท',
      'เข้าบัญชี OLD X-1111',
      'ยอดเงินที่ใช้ได้ 2,000.00 บาท',
      'รายการเงินออก -80.00 บาท',
      'จากบัญชี THANAPHORN U. X-4078',
      'เข้าบัญชี MBR9',
      'วันที่/เวลา 05/10/2026 21:39',
      'ยอดเงินที่ใช้ได้ 1,088.37 บาท',
    ].join('\n'),
    capture_method: 'whats_on_screen',
    captured_at: '2026-10-05T21:40:00+07:00',
  })
  equal(result.source, 'scb_connect')
  equal(result.bank, 'SCB')
  equal(result.amount, '80.00')
  equal(result.direction, 'debit')
  equal(result.merchant, 'MBR9')
  equal(result.account_last4, '4078')
  equal(result.transaction_datetime, '2026-10-05T21:39:00+07:00')
  equal(result.parse_status, 'complete')
  if (!/^[0-9a-f]{64}$/.test(result.dedupe_key)) throw new Error('missing dedupe key')
})

Deno.test('server parser supports UOB Thai and LINE Wallet', async () => {
  const uob = await parseRawShortcutCapture({
    raw_text: 'มีการใช้บัตร UOB-1234 จำนวน 120.50 THB ที่ร้าน COFFEE วันที่/เวลา 05/10/2026 09:00 วงเงินคงเหลือใช้ได้ 3,000.00 THB',
    capture_method: 'line_notification',
    captured_at: '2026-10-05T09:01:00+07:00',
  })
  equal(uob.source, 'uob_thai')
  equal(uob.card_last4, '1234')
  equal(uob.amount, '120.50')

  const line = await parseRawShortcutCapture({
    raw_text: 'LINE Pay Purchase ฿45.00\nMerchant: Bakery\nBalance: THB 900.00',
    capture_method: 'line_notification',
    captured_at: '2026-10-05T09:01:00+07:00',
  })
  equal(line.source, 'line_wallet')
  equal(line.merchant, 'Bakery')
  equal(line.amount, '45.00')
})

Deno.test('notification and screen raw captures share a dedupe key', async () => {
  const text = [
    'รายการเงินออก -80.00 บาท',
    'จากบัญชี THANAPHORN U. X-4078',
    'เข้าบัญชี MBR9',
    'วันที่/เวลา 05/10/2026 21:39',
    'ยอดเงินที่ใช้ได้ 1,088.37 บาท',
  ].join('\n')
  const common = { captured_at: '2026-10-05T21:40:00+07:00' }
  const notification = await parseRawShortcutCapture({ ...common, raw_text: text, capture_method: 'line_notification' })
  const screen = await parseRawShortcutCapture({ ...common, raw_text: `SCB Connect\nเมนูหลัก\n${text}\nหน้าแรก`, capture_method: 'whats_on_screen' })
  equal(notification.dedupe_key, screen.dedupe_key)
})

Deno.test('server parser rejects unsupported or non-transaction text', async () => {
  await rejectsCode(() => parseRawShortcutCapture({ raw_text: 'hello', capture_method: 'whats_on_screen' }), 'invalid_capture')
  await rejectsCode(() => parseRawShortcutCapture({ raw_text: 'รายการเงินออก -80.00 บาท', capture_method: 'email' }), 'invalid_capture')
})
