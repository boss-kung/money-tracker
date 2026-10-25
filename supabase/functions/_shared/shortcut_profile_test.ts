import cases from '../../../tests/fixtures/shortcut_profile_cases.json' with { type: 'json' }
import { matchShortcutProfile, normalizeProfileText, parseShortcutProfileMarker, validateShortcutProfileRule } from './shortcut_profile.ts'

function assertEquals(actual: unknown, expected: unknown, message = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
}
function assertThrows(fn: () => unknown) {
  let thrown = false
  try { fn() } catch { thrown = true }
  if (!thrown) throw new Error('expected function to throw')
}

const rule = validateShortcutProfileRule({
  format_version: 1,
  variants: [
    {
      id: 'purchase', direction: 'debit', mustContain: ['uchOOSE', 'ซื้อสินค้า'], mustNotContain: ['otp'],
      amount: { before: 'จำนวน ', after: ' thb', occurrence: 1, valueType: 'thb_amount', maxLength: 32 },
      date: { before: 'วันที่ ', after: ' เวลา', occurrence: 1, valueType: 'date', maxLength: 16 },
      time: { before: 'เวลา ', after: ' เลขที่', occurrence: 1, valueType: 'time', maxLength: 16 },
      merchant: { before: 'ร้าน ', after: ' จำนวน', occurrence: 1, valueType: 'text', maxLength: 64 },
      transactionReference: { before: 'เลขที่ ', occurrence: 1, valueType: 'reference', maxLength: 32 },
    },
    {
      id: 'refund', direction: 'credit', mustContain: ['uchOOSE', 'คืนเงิน'], mustNotContain: ['otp'],
      amount: { before: 'จำนวน ', after: ' thb', occurrence: 1, valueType: 'thb_amount', maxLength: 32 },
      date: { before: 'วันที่ ', after: ' เวลา', occurrence: 1, valueType: 'date', maxLength: 16 },
      time: { before: 'เวลา ', after: ' เลขที่', occurrence: 1, valueType: 'time', maxLength: 16 },
      transactionReference: { before: 'เลขที่ ', occurrence: 1, valueType: 'reference', maxLength: 32 },
    },
  ],
})

for (const [name, fixture] of Object.entries(cases as Record<string, { text: string; expected: Record<string, unknown> }>)) {
  Deno.test(`profile fixture: ${name}`, () => {
    const result = matchShortcutProfile(rule, fixture.text, '2026-10-25T12:00:00+07:00')
    if (fixture.expected.status === 'complete') {
      assertEquals(result.status, 'complete')
      if (result.status === 'complete') {
        for (const key of ['direction', 'amount', 'transactionDate', 'transactionDateTime', 'variantId']) assertEquals(result.value[key as keyof typeof result.value], fixture.expected[key])
        if (fixture.expected.merchant !== undefined) assertEquals(result.value.merchant, fixture.expected.merchant)
        if (fixture.expected.transactionReference !== undefined) assertEquals(result.value.transactionReference, fixture.expected.transactionReference)
      }
    } else {
      assertEquals(result, fixture.expected)
    }
  })
}

Deno.test('profile text normalization is whitespace and case stable', () => {
  assertEquals(normalizeProfileText(' UCHOOSE\u00a0 ซื้อ\nสินค้า '), 'uchoose ซื้อ สินค้า')
})

Deno.test('profile marker removes only the first non-empty marker line', () => {
  assertEquals(parseShortcutProfileMarker('\nMT-PROFILE:ABCD23\nTitle\nBody'), { shortCode: 'ABCD23', notificationText: 'Title\nBody' })
  assertEquals(parseShortcutProfileMarker('MT-PROFILE:AAAAAI\nBody'), null)
})

Deno.test('profile validation rejects regex-like and unsafe unknown fields', () => {
  assertThrows(() => validateShortcutProfileRule({ format_version: 1, variants: [{ id: 'x', direction: 'debit', mustContain: ['x'], mustNotContain: [], amount: { before: 'x', occurrence: 1, valueType: 'thb_amount', maxLength: 32, pattern: '.*' } }] }))
  assertThrows(() => validateShortcutProfileRule({ format_version: 1, variants: [{ id: 'x', direction: 'debit', mustContain: [], mustNotContain: [], amount: { after: 'x', occurrence: 2, valueType: 'thb_amount', maxLength: 32 } }] }))
})
