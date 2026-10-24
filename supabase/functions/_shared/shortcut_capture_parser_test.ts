import { parseRawShortcutCaptures } from './shortcut_capture_parser.ts'

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

async function parseRawShortcutCapture(input: unknown) {
  const result = await parseRawShortcutCaptures(input)
  equal(result.found, 1, 'expected one logical capture')
  equal(result.failures, [], 'unexpected parse failures')
  return result.captures[0].capture
}

Deno.test('server parser returns the latest SCB block with complete fields', async () => {
  const result = await parseRawShortcutCaptures({
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
  equal(result.found, 2)
  const capture = result.captures[1].capture
  equal(capture.source, 'scb_connect')
  equal(capture.bank, 'SCB')
  equal(capture.amount, '80.00')
  equal(capture.direction, 'debit')
  equal(capture.merchant, 'MBR9')
  equal(capture.account_last4, '4078')
  equal(capture.transaction_datetime, '2026-10-05T21:39:00+07:00')
  equal(capture.parse_status, 'complete')
  if (!/^[0-9a-f]{64}$/.test(capture.dedupe_key)) throw new Error('missing dedupe key')
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

Deno.test('server parser accepts compact UOB notification previews without available credit', async () => {
  const thai = await parseRawShortcutCapture({
    raw_text: 'UOB แจ้งเตือน\nมีการใช้บัตร UOB-1234 จำนวน 1,250.75 THB ที่ร้าน CENTRAL ONLINE',
    capture_method: 'line_notification',
    captured_at: '2026-10-05T09:01:00+07:00',
  })
  equal(thai.source, 'uob_thai')
  equal(thai.bank, 'UOB')
  equal(thai.amount, '1250.75')
  equal(thai.card_last4, '1234')
  equal(thai.merchant, 'CENTRAL ONLINE')
  equal(thai.transaction_datetime, null)

  const english = await parseRawShortcutCapture({
    raw_text: 'UOB\nYou have spent THB 499.00 on card ending 5678 at NETFLIX.COM',
    capture_method: 'line_notification',
    captured_at: '2026-10-05T09:01:00+07:00',
  })
  equal(english.source, 'uob_thai')
  equal(english.bank, 'UOB')
  equal(english.amount, '499.00')
  equal(english.card_last4, '5678')
  equal(english.merchant, 'NETFLIX.COM')
  equal(english.transaction_datetime, null)
})

Deno.test('server parser still rejects compact UOB text without a positive amount', async () => {
  await rejectsCode(
    () => parseRawShortcutCapture({
      raw_text: 'มีการใช้บัตร UOB-1234 ที่ร้าน CENTRAL ONLINE',
      capture_method: 'line_notification',
      captured_at: '2026-10-05T09:01:00+07:00',
    }),
    'invalid_capture',
  )
  await rejectsCode(
    () => parseRawShortcutCapture({
      raw_text: 'มีการใช้บัตร UOB-1234 ที่ร้าน CENTRAL ONLINE วงเงินคงเหลือใช้ได้ 3,000.00 THB',
      capture_method: 'line_notification',
      captured_at: '2026-10-05T09:01:00+07:00',
    }),
    'invalid_capture',
  )
})

Deno.test('server parser returns ordered compact UOB notification blocks', async () => {
  const result = await parseRawShortcutCaptures({
    raw_text: [
      'มีการใช้บัตร UOB-1111 จำนวน 10.00 THB ที่ร้าน OLD MERCHANT',
      'มีการใช้บัตร UOB-2222 จำนวน 20.00 THB ที่ร้าน NEW MERCHANT',
    ].join('\n'),
    capture_method: 'line_notification',
    captured_at: '2026-10-05T09:01:00+07:00',
  })
  equal(result.found, 2)
  equal(result.captures.map(({ capture }) => [capture.amount, capture.card_last4, capture.merchant]), [
    ['10.00', '1111', 'OLD MERCHANT'],
    ['20.00', '2222', 'NEW MERCHANT'],
  ])
})

Deno.test('server parser accepts compact SCB and LINE Wallet notification previews', async () => {
  const scb = await parseRawShortcutCapture({
    raw_text: [
      'SCB Connect',
      'รายการเงินออก',
      '-80.00 บาท',
      'จากบัญชี THANAPHORN U. X-4078',
      'เข้าบัญชี MBR9',
    ].join('\n'),
    capture_method: 'line_notification',
    captured_at: '2026-10-05T09:01:00+07:00',
  })
  equal(scb.source, 'scb_connect')
  equal(scb.amount, '80.00')
  equal(scb.merchant, 'MBR9')
  equal(scb.account_last4, '4078')

  const line = await parseRawShortcutCapture({
    raw_text: 'LINE Pay Purchase ฿45.00\nMerchant: Bakery',
    capture_method: 'line_notification',
    captured_at: '2026-10-05T09:01:00+07:00',
  })
  equal(line.source, 'line_wallet')
  equal(line.amount, '45.00')
  equal(line.merchant, 'Bakery')
})

Deno.test('server parser accepts the observed UOB Thai notification preview', async () => {
  const result = await parseRawShortcutCapture({
    raw_text: [
      'UOB Thai',
      'มีการใช้บัตร UOB-0386 @TMN 7-11 104.00 THB วันที่ 18/10 วงเงินคงเหลือใช้ได้ 82,941.00 THB',
      'You have spent THB 104.00 using UOB card (ending UOB-0386) at @TMN 7-11 ...',
    ].join('\n'),
    capture_method: 'line_notification',
    captured_at: '2026-10-18T22:48:41+07:00',
  })
  equal(result.source, 'uob_thai')
  equal(result.amount, '104.00')
  equal(result.card_last4, '0386')
  equal(result.merchant, '@TMN 7-11')
})

Deno.test('server parser accepts a UOB Thai-only notification preview without จำนวน', async () => {
  const result = await parseRawShortcutCapture({
    raw_text: 'UOB Thai\nมีการใช้บัตร UOB-0386 @TMN 7-11 104.00 THB วันที่ 18/10 วงเงินคงเหลือใช้ได้ 82,941.00 THB',
    capture_method: 'line_notification',
    captured_at: '2026-10-18T22:48:41+07:00',
  })
  equal(result.source, 'uob_thai')
  equal(result.amount, '104.00')
  equal(result.card_last4, '0386')
  equal(result.merchant, '@TMN 7-11')
})

Deno.test('server parser accepts LINE Wallet spacing after the baht symbol', async () => {
  const result = await parseRawShortcutCapture({
    raw_text: 'LINE Wallet\nLINE Pay Purchase ฿ 49.00 Payment complete. Merchant:\nMcDonald',
    capture_method: 'line_notification',
    captured_at: '2026-10-18T22:48:27+07:00',
  })
  equal(result.source, 'line_wallet')
  equal(result.amount, '49.00')
  equal(result.merchant, 'McDonald')
})

Deno.test('server parser preserves SCB credit notification date with an at-sign time', async () => {
  const result = await parseRawShortcutCapture({
    raw_text: 'SCB Connect\nรายการเงินเข้า 200.00 บาท เข้าบัญชี X-4078 วันที่ 18/10/2026 @20:42 ยอดเงินที่ใช้ได้ 950.46 บาท',
    capture_method: 'line_notification',
    captured_at: '2026-10-18T20:42:30+07:00',
  })
  equal(result.source, 'scb_connect')
  equal(result.direction, 'credit')
  equal(result.amount, '200.00')
  equal(result.account_last4, '4078')
  equal(result.transaction_datetime, '2026-10-18T20:42:00+07:00')
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

Deno.test('server parser returns every complete SCB block in screen order', async () => {
  const result = await parseRawShortcutCaptures({
    raw_text: [
      'รายการเงินออก -20.00 บาท',
      'จากบัญชี SAMPLE X-1111',
      'เข้าบัญชี FIRST SHOP',
      'ยอดเงินที่ใช้ได้ 2,000.00 บาท',
      'รายการเงินออก -80.00 บาท',
      'จากบัญชี SAMPLE X-1111',
      'เข้าบัญชี SECOND SHOP',
      'ยอดเงินที่ใช้ได้ 1,920.00 บาท',
    ].join('\n'),
    capture_method: 'whats_on_screen',
    captured_at: '2026-10-24T16:20:00+07:00',
  })
  equal(result.found, 2)
  equal(result.failures, [])
  equal(result.captures.map(({ item, capture }) => [item, capture.amount, capture.merchant]), [
    [1, '20.00', 'FIRST SHOP'],
    [2, '80.00', 'SECOND SHOP'],
  ])
})

function uobPair({
  amount = '12.34',
  card = '1111',
  thaiMerchant = '@SHOP ONE',
  englishMerchant = thaiMerchant,
  thaiCredit = '90,000.00',
  englishCredit = thaiCredit,
  thaiDate = '24/10/2026 16:00',
  englishDate = thaiDate,
}: {
  amount?: string
  card?: string
  thaiMerchant?: string
  englishMerchant?: string
  thaiCredit?: string
  englishCredit?: string
  thaiDate?: string
  englishDate?: string
} = {}) {
  return [
    `มีการใช้บัตร UOB-${card} ${thaiMerchant} ${amount} THB วันที่/เวลา ${thaiDate} วงเงินคงเหลือใช้ได้ ${thaiCredit} THB`,
    `You have spent THB ${amount} using UOB card (ending UOB-${card}) at ${englishMerchant} on ${englishDate}. Available credit: THB ${englishCredit}`,
  ]
}

Deno.test('server parser collapses each adjacent bilingual UOB message once', async () => {
  const rawText = [
    ...uobPair(),
    ...uobPair({ amount: '56.78', thaiMerchant: '@SHOP TWO' }),
  ].join('\n')
  const result = await parseRawShortcutCaptures({
    raw_text: rawText,
    capture_method: 'line_notification',
    captured_at: '2026-10-24T16:20:00+07:00',
  })
  equal(result.found, 2)
  equal(result.failures, [])
  equal(result.captures.map(({ capture }) => [capture.amount, capture.card_last4]), [
    ['12.34', '1111'],
    ['56.78', '1111'],
  ])
  equal(result.captures[0].capture.raw_text, uobPair().join('\n'))
  equal(result.captures[1].capture.raw_text, uobPair({ amount: '56.78', thaiMerchant: '@SHOP TWO' }).join('\n'))
  equal(result.captures.map(({ capture }) => capture.relevant_text), [
    normalize(uobPair()[1]),
    normalize(uobPair({ amount: '56.78', thaiMerchant: '@SHOP TWO' })[1]),
  ])
})

function normalize(value: string) {
  return value.replace(/[ \t]+/g, ' ').trim()
}

Deno.test('server parser preserves the old latest-block dedupe key', async () => {
  const capturedAt = '2026-10-24T16:20:00+07:00'
  const second = uobPair({ amount: '56.78', thaiMerchant: '@SHOP TWO' })
  const both = await parseRawShortcutCaptures({
    raw_text: [...uobPair(), ...second].join('\n'),
    capture_method: 'line_notification',
    captured_at: capturedAt,
  })
  const latest = await parseRawShortcutCaptures({
    raw_text: second[1],
    capture_method: 'line_notification',
    captured_at: capturedAt,
  })
  equal(both.captures[1].capture.dedupe_key, latest.captures[0].capture.dedupe_key)
})

Deno.test('same-language UOB candidates stay separate', async () => {
  const result = await parseRawShortcutCaptures({
    raw_text: [
      uobPair({ amount: '12.34', thaiMerchant: '@THAI ONE' })[0],
      uobPair({ amount: '56.78', thaiMerchant: '@THAI TWO' })[0],
    ].join('\n'),
    capture_method: 'line_notification',
    captured_at: '2026-10-24T16:20:00+07:00',
  })
  equal(result.found, 2)
  equal(result.captures.map(({ capture }) => capture.amount), ['12.34', '56.78'])
})

Deno.test('UOB pairing requires matching amount card merchant credit and date', async () => {
  const cases = [
    { name: 'amount', thai: { amount: '12.34' }, english: { amount: '56.78' } },
    { name: 'card', thai: { card: '1111' }, english: { card: '2222' } },
    { name: 'merchant', thai: { thaiMerchant: '@SHOP ONE' }, english: { englishMerchant: '@SHOP TWO' } },
    { name: 'credit', thai: { thaiCredit: '90,000.00' }, english: { englishCredit: '80,000.00' } },
    { name: 'date', thai: { thaiDate: '24/10/2026 16:00' }, english: { englishDate: '25/10/2026 16:00' } },
  ]
  for (const mismatch of cases) {
    const thai = uobPair(mismatch.thai)[0]
    const english = uobPair(mismatch.english)[1]
    const result = await parseRawShortcutCaptures({
      raw_text: `${thai}\n${english}`,
      capture_method: 'line_notification',
      captured_at: '2026-10-24T16:20:00+07:00',
    })
    equal(result.found, 2, mismatch.name)
  }
})

Deno.test('UOB pairing treats zero available credit as a real matching value', async () => {
  const result = await parseRawShortcutCaptures({
    raw_text: uobPair({ thaiCredit: '0.00', englishCredit: '100.00' }).join('\n'),
    capture_method: 'line_notification',
    captured_at: '2026-10-24T16:20:00+07:00',
  })
  equal(result.found, 2)
})

Deno.test('SCB debit direction is not changed by merchant text', async () => {
  const result = await parseRawShortcutCaptures({
    raw_text: [
      'รายการเงินออก -20.00 บาท',
      'จากบัญชี SAMPLE X-1111',
      'เข้าบัญชี ร้านรายการเงินเข้า',
      'ยอดเงินที่ใช้ได้ 2,000.00 บาท',
    ].join('\n'),
    capture_method: 'whats_on_screen',
    captured_at: '2026-10-24T16:20:00+07:00',
  })
  equal(result.captures[0].capture.direction, 'debit')
})

Deno.test('whats_on_screen UOB requires the THB available-credit suffix', async () => {
  await rejectsCode(
    () => parseRawShortcutCaptures({
      raw_text: 'มีการใช้บัตร UOB-1111 @SHOP 12.34 THB วงเงินคงเหลือใช้ได้ 100.00',
      capture_method: 'whats_on_screen',
      captured_at: '2026-10-24T16:20:00+07:00',
    }),
    'invalid_capture',
  )
})

Deno.test('complete UOB partner absorbs its matching incomplete translation', async () => {
  const pair = uobPair()
  const result = await parseRawShortcutCaptures({
    raw_text: `${pair[0]}\n${pair[1].replace(/\. Available credit:[^\n]+/u, '')}`,
    capture_method: 'line_notification',
    captured_at: '2026-10-24T16:20:00+07:00',
  })
  equal(result.found, 1)
  equal(result.failures, [])
  equal(result.captures[0].capture.amount, '12.34')
})

Deno.test('parser reports unreadable groups without dropping readable groups', async () => {
  const result = await parseRawShortcutCaptures({
    raw_text: [
      'รายการเงินออก -20.00 บาท',
      'จากบัญชี SAMPLE X-1111',
      'เข้าบัญชี FIRST SHOP',
      'ยอดเงินที่ใช้ได้ 2,000.00 บาท',
      'รายการเงินออก -80.00 บาท',
      'จากบัญชี SAMPLE X-1111',
      'เข้าบัญชี SECOND SHOP',
    ].join('\n'),
    capture_method: 'whats_on_screen',
    captured_at: '2026-10-24T16:20:00+07:00',
  })
  equal(result.found, 2)
  equal(result.captures.map(({ item, capture }) => [item, capture.amount]), [[1, '20.00']])
  equal(result.failures, [{ item: 2, code: 'unreadable_capture' }])
})

Deno.test('anchor words inside merchant lines do not split candidates', async () => {
  const result = await parseRawShortcutCaptures({
    raw_text: [
      'รายการเงินออก -20.00 บาท',
      'จากบัญชี SAMPLE X-1111',
      'เข้าบัญชี YOU HAVE SPENT CAFE',
      'ยอดเงินที่ใช้ได้ 2,000.00 บาท',
    ].join('\n'),
    capture_method: 'whats_on_screen',
    captured_at: '2026-10-24T16:20:00+07:00',
  })
  equal(result.found, 1)
  equal(result.captures[0].capture.merchant, 'YOU HAVE SPENT CAFE')
})

Deno.test('parser rejects more than ten logical groups', async () => {
  const text = Array.from({ length: 11 }, (_, index) => [
    `LINE Pay Purchase ฿${index + 1}.00`,
    `Merchant: STORE ${index + 1}`,
    'Balance: THB 900.00',
  ].join('\n')).join('\n')
  await rejectsCode(
    () => parseRawShortcutCaptures({ raw_text: text, capture_method: 'line_notification', captured_at: '2026-10-24T16:20:00+07:00' }),
    'too_many_captures',
  )
})

Deno.test('server parser rejects unsupported or non-transaction text', async () => {
  await rejectsCode(() => parseRawShortcutCaptures({ raw_text: 'hello', capture_method: 'whats_on_screen' }), 'invalid_capture')
  await rejectsCode(() => parseRawShortcutCaptures({ raw_text: 'รายการเงินออก -80.00 บาท', capture_method: 'email' }), 'invalid_capture')
})
