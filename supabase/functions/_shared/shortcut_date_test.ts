import {
  bangkokCalendarDate,
  normalizeShortcutCapturedAt,
  parseShortcutDateFromText,
  validateShortcutTransactionDate,
} from './shortcut_date.ts'

function equal(actual: unknown, expected: unknown, message = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
}

function codeOf(error: unknown): string {
  return String(Reflect.get(error as object, 'code') || '')
}

function throwsCode(fn: () => unknown, code: string) {
  try {
    fn()
  } catch (error) {
    equal(codeOf(error), code, 'error code')
    return
  }
  throw new Error(`Expected ${code}`)
}

Deno.test('parses date-only and full Bangkok dates without inventing time', () => {
  equal(parseShortcutDateFromText('วันที่ 18/10', '2026-10-25T10:00:00+07:00'), {
    transactionDate: '2026-10-18', transactionDateTime: null,
  })
  equal(parseShortcutDateFromText('วันที่ 18/10/2026 @21:39', '2026-10-25T10:00:00+07:00'), {
    transactionDate: '2026-10-18', transactionDateTime: '2026-10-18T21:39:00+07:00',
  })
})

Deno.test('converts Buddhist years and rejects invalid calendars', () => {
  equal(parseShortcutDateFromText('29/02/2567', '2026-10-25T10:00:00+07:00').transactionDate, '2024-02-29')
  for (const value of ['29/02/2566', '31/02/2026', '00/10/2026', '01/01/26', '01/01/1800', '01/01/2300']) {
    throwsCode(() => parseShortcutDateFromText(value, '2026-10-25T10:00:00+07:00'), 'invalid_capture')
  }
})

Deno.test('resolves missing years around New Year', () => {
  equal(parseShortcutDateFromText('31/12', '2026-01-01T00:30:00+07:00').transactionDate, '2025-12-31')
  equal(parseShortcutDateFromText('01/01', '2025-12-31T23:30:00+07:00').transactionDate, '2026-01-01')
  equal(parseShortcutDateFromText('02/01', '2026-12-31T23:30:00+07:00').transactionDate, '2026-01-02')
})

Deno.test('converts instants to Bangkok calendar dates', () => {
  equal(bangkokCalendarDate('2026-10-24T18:30:00Z'), '2026-10-25')
  equal(bangkokCalendarDate('2026-10-25T01:00:00-05:00'), '2026-10-25')
})

Deno.test('bounds explicit capture time but supports the missing legacy value', () => {
  const now = '2026-10-25T00:05:00Z'
  equal(normalizeShortcutCapturedAt('2026-10-18T00:05:00Z', now), '2026-10-18T00:05:00Z')
  equal(normalizeShortcutCapturedAt('2026-10-25T00:15:00Z', now), '2026-10-25T00:15:00Z')
  equal(normalizeShortcutCapturedAt(null, now), '2026-10-25T07:05:00+07:00')
  throwsCode(() => normalizeShortcutCapturedAt('2026-10-18T00:04:59Z', now), 'invalid_capture')
  throwsCode(() => normalizeShortcutCapturedAt('2026-10-25T00:15:01Z', now), 'invalid_capture')
  throwsCode(() => normalizeShortcutCapturedAt('2026-10-25T00:05:00', now), 'invalid_capture')
})

Deno.test('validates strict transaction calendar dates', () => {
  equal(validateShortcutTransactionDate('2026-02-28'), '2026-02-28')
  equal(validateShortcutTransactionDate(null, true), null)
  throwsCode(() => validateShortcutTransactionDate('2026-02-29'), 'invalid_capture')
  throwsCode(() => validateShortcutTransactionDate('2026-1-02'), 'invalid_capture')
})
