import {
  buildCaptureDedupeIdentity,
  canonicalDedupeMaterial,
  readBoundedJson,
  sha256Hex,
  validateCaptureV1,
} from './shortcut_capture.ts'
import { parseRawShortcutCaptures } from './shortcut_capture_parser.ts'

function equal(actual: unknown, expected: unknown, message = '') {
  if (actual !== expected) throw new Error(`${message} ${String(actual)} !== ${String(expected)}`)
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

function capture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 'money-tracker.capture.v1',
    parser_version: 'ios-shortcut-1.0.0',
    source: 'scb_connect',
    bank: 'SCB',
    amount: '80.00',
    currency: 'THB',
    direction: 'debit',
    merchant: 'MBR9',
    description: 'MBR9',
    account_last4: '4078',
    card_last4: null,
    transaction_date: null,
    transaction_reference: null,
    transaction_datetime: '2026-10-05T21:39:00+07:00',
    captured_at: '2026-10-05T21:40:03+07:00',
    capture_method: 'whats_on_screen',
    raw_text: 'SCB Connect\nรายการเงินออก -80.00 บาท',
    relevant_text: 'รายการเงินออก -80.00 บาท\nยอดเงินที่ใช้ได้ 1,088.37 บาท',
    parse_status: 'complete',
    dedupe_version: 1,
    dedupe_key: '0'.repeat(64),
    ...overrides,
  }
}

const TEST_SERVER_NOW = new Date('2026-10-06T00:00:00+07:00')

async function validate(input: unknown, serverNow = TEST_SERVER_NOW) {
  return validateCaptureV1(input, serverNow)
}

async function withDedupeKey(input: Record<string, unknown>) {
  return {
    ...input,
    dedupe_key: await sha256Hex(await canonicalDedupeMaterial(input)),
  }
}

Deno.test('validates a complete v1 capture and canonicalizes amount', async () => {
  const input = await withDedupeKey(capture({ amount: '80' }))
  const result = await validate(input)
  equal(result.amount, '80.00')
  equal(result.currency, 'THB')
  equal(result.parse_status, 'complete')
  equal(result.dedupe_key, input.dedupe_key)
  equal(result.transaction_datetime, '2026-10-05T21:39:00+07:00')
})

Deno.test('keeps the local transaction date used by the client fingerprint', async () => {
  const input = await withDedupeKey(capture({
    transaction_datetime: '2026-10-05T00:30:00+07:00',
  }))
  const result = await validate(input)
  equal(result.transaction_datetime, '2026-10-05T00:30:00+07:00')
})

Deno.test('normalizes NFKC and whitespace before comparing a fingerprint', async () => {
  const first = await withDedupeKey(capture({
    merchant: 'ＭＢＲ９',
    relevant_text: 'รายการเงินออก -80.00 บาท\r\n\r\nยอดเงินที่ใช้ได้ 1,088.37 บาท',
  }))
  const second = await withDedupeKey(capture({
    merchant: 'MBR9',
    relevant_text: 'รายการเงินออก -80.00 บาท\nยอดเงินที่ใช้ได้ 1,088.37 บาท',
  }))
  equal(first.dedupe_key, second.dedupe_key, 'equivalent normalized blocks')

  const different = await withDedupeKey(capture({ relevant_text: 'รายการเงินออก -80.00 บาท\nยอดเงินที่ใช้ได้ 988.37 บาท' }))
  if (different.dedupe_key === second.dedupe_key) throw new Error('different relevant blocks must not collide')
})

Deno.test('rejects unsupported, incomplete, and unsafe payloads', async () => {
  await rejectsCode(() => validate(capture({ source: 'unknown' })), 'invalid_capture')
  await rejectsCode(() => validate(capture({ parse_status: 'invalid' })), 'invalid_capture')
  await rejectsCode(() => validate(capture({ amount: '0.00' })), 'invalid_capture')
  await rejectsCode(() => validate(capture({ currency: 'USD' })), 'invalid_capture')
  await rejectsCode(() => validate(capture({ account_last4: '123' })), 'invalid_capture')
  await rejectsCode(() => validate(capture({ dedupe_key: 'f'.repeat(64) })), 'invalid_dedupe_key')
})

async function withV2Identity(input: Record<string, unknown>) {
  const versioned = { ...input, dedupe_version: 2 }
  const identity = await buildCaptureDedupeIdentity(versioned)
  return { ...versioned, dedupe_key: identity.dedupeKey }
}

Deno.test('validates optional transaction date and reference fields without breaking v1', async () => {
  const input = await withDedupeKey(capture({
    transaction_date: '2026-10-04',
    transaction_reference: '  REF\u00a0123  ',
  }))
  const result = await validate(input)
  equal(result.transaction_date, '2026-10-04')
  equal(result.transaction_reference, 'REF 123')

  const legacy = capture()
  delete (legacy as Record<string, unknown>).transaction_date
  delete (legacy as Record<string, unknown>).transaction_reference
  const legacyResult = await validate(await withDedupeKey(legacy))
  equal(legacyResult.transaction_date, null)
  equal(legacyResult.transaction_reference, null)
  await rejectsCode(async () => validate(await withDedupeKey(capture({ transaction_date: '2026-02-29' }))), 'invalid_capture')
  await rejectsCode(async () => validate(await withDedupeKey(capture({ transaction_reference: 'x'.repeat(129) }))), 'invalid_capture')
})

Deno.test('uses transaction date then Bangkok datetime then Bangkok capture date', async () => {
  const explicit = await validate(await withDedupeKey(capture({
    transaction_date: '2026-10-04',
    transaction_datetime: '2026-10-05T00:30:00+07:00',
  })))
  equal(explicit.transaction_date, '2026-10-04')

  const datetime = await validate(await withDedupeKey(capture({
    transaction_date: null,
    transaction_datetime: '2026-10-04T18:30:00Z',
  })))
  equal(datetime.transaction_date, null)

  const dateOnly = await validate(await withDedupeKey(capture({
    transaction_date: null,
    transaction_datetime: null,
    captured_at: '2026-10-05T00:30:00+07:00',
  })))
  equal(dateOnly.captured_at, '2026-10-05T00:30:00+07:00')
})

Deno.test('bounds explicit captured_at using the injected server receipt time', async () => {
  const serverNow = new Date('2026-10-06T00:00:00+07:00')
  await validate(await withDedupeKey(capture({ captured_at: '2026-09-29T00:00:00+07:00' })), serverNow)
  await validate(await withDedupeKey(capture({ captured_at: '2026-10-06T00:10:00+07:00' })), serverNow)
  await rejectsCode(async () => validate(await withDedupeKey(capture({ captured_at: '2026-09-28T23:59:59+07:00' })), serverNow), 'invalid_capture')
  await rejectsCode(async () => validate(await withDedupeKey(capture({ captured_at: '2026-10-06T00:10:01+07:00' })), serverNow), 'invalid_capture')
})

Deno.test('validates raw parser captures with dedupe version 2', async () => {
  const parsed = await parseRawShortcutCaptures({
    raw_text: 'มีการใช้บัตร UOB-1111 จำนวน 12.34 THB ที่ร้าน SHOP วันที่ 25/10 วงเงินคงเหลือใช้ได้ 90,000.00 THB',
    capture_method: 'line_notification',
    captured_at: '2026-10-25T16:20:00+07:00',
  }, '2026-10-25T16:20:00+07:00')
  equal(parsed.captures[0].capture.dedupe_version, 2)
  const result = await validate(parsed.captures[0].capture, new Date('2026-10-25T16:20:00+07:00'))
  equal(result.transaction_date, '2026-10-25')
  equal(result.dedupe_version, 2)
})

Deno.test('builds strong and timeless v2 identities with five-minute buckets', async () => {
  const strongA = await buildCaptureDedupeIdentity({
    ...capture({ transaction_date: '2026-10-05', transaction_datetime: '2026-10-05T21:39:00+07:00' }),
    dedupe_version: 2,
  })
  const strongB = await buildCaptureDedupeIdentity({
    ...capture({ transaction_date: '2026-10-05', transaction_datetime: '2026-10-05T21:39:00+07:00', captured_at: '2026-10-06T08:00:00+07:00' }),
    dedupe_version: 2,
  })
  equal(strongA.strong, true)
  equal(strongA.dedupeKey, strongB.dedupeKey)

  const referenceA = await buildCaptureDedupeIdentity({
    ...capture({ transaction_datetime: null, transaction_reference: 'REF-123' }),
    dedupe_version: 2,
  })
  const referenceB = await buildCaptureDedupeIdentity({
    ...capture({ transaction_datetime: null, transaction_reference: 'REF-123', captured_at: '2026-10-06T08:00:00+07:00' }),
    dedupe_version: 2,
  })
  equal(referenceA.strong, true)
  equal(referenceA.dedupeKey, referenceB.dedupeKey)

  const before = await buildCaptureDedupeIdentity({ ...capture({ transaction_datetime: null, transaction_date: '2026-10-05', captured_at: '2026-10-05T12:04:59+07:00' }), dedupe_version: 2 })
  const after = await buildCaptureDedupeIdentity({ ...capture({ transaction_datetime: null, transaction_date: '2026-10-05', captured_at: '2026-10-05T12:05:01+07:00' }), dedupe_version: 2 })
  const later = await buildCaptureDedupeIdentity({ ...capture({ transaction_datetime: null, transaction_date: '2026-10-05', captured_at: '2026-10-05T12:11:00+07:00' }), dedupe_version: 2 })
  equal(before.strong, false)
  equal(before.baseKey, after.baseKey)
  if (before.dedupeKey === after.dedupeKey) throw new Error('adjacent timeless buckets must differ')
  if (before.dedupeKey === later.dedupeKey) throw new Error('later timeless events must differ')
})

Deno.test('keeps legacy key and Bangkok calendar identity stable across offsets', async () => {
  const legacy = await withDedupeKey(capture({ transaction_date: '2026-10-05', transaction_reference: 'REF-123' }))
  const identity = await buildCaptureDedupeIdentity({ ...legacy, dedupe_version: 2 })
  equal(identity.legacyKey, legacy.dedupe_key)

  const utc = await buildCaptureDedupeIdentity({ ...capture({ transaction_date: null, transaction_datetime: '2026-10-24T18:30:00Z' }), dedupe_version: 2 })
  const bangkok = await buildCaptureDedupeIdentity({ ...capture({ transaction_date: null, transaction_datetime: '2026-10-25T01:30:00+07:00' }), dedupe_version: 2 })
  equal(utc.baseKey, bangkok.baseKey)
})

Deno.test('changes v2 base identity when event fields change', async () => {
  const base = { ...capture({ transaction_datetime: null, transaction_date: '2026-10-05' }), dedupe_version: 2 }
  const baseline = await buildCaptureDedupeIdentity(base)
  const changes = [
    { source: 'uob_thai' },
    { amount: '81.00' },
    { direction: 'credit' },
    { account_last4: '9999' },
    { transaction_date: '2026-10-06' },
    { description: 'OTHER' },
    { relevant_text: 'different relevant event' },
  ]
  for (const change of changes) {
    const next = await buildCaptureDedupeIdentity({ ...base, ...change } as Record<string, unknown>)
    if (next.baseKey === baseline.baseKey) throw new Error(`base identity did not change for ${JSON.stringify(change)}`)
  }
})

Deno.test('reads a bounded JSON body independent of Content-Length', async () => {
  const body = JSON.stringify({ value: 'x'.repeat(32700) })
  const request = new Request('https://example.test', {
    method: 'POST',
    headers: { 'content-length': '1' },
    body,
  })
  const result = await readBoundedJson(request, 32768)
  equal((result as { value: string }).value.length, 32700)
})

Deno.test('rejects a streamed body over 32 KiB and malformed UTF-8', async () => {
  const chunks = [new TextEncoder().encode('{"value":"' + 'x'.repeat(20000)), new TextEncoder().encode('x'.repeat(13000) + '"}')]
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  const streamedRequest = Object.assign({ method: 'POST', body: stream }, { duplex: 'half' }) as RequestInit
  await rejectsCode(() => readBoundedJson(new Request('https://example.test', streamedRequest), 32768), 'payload_too_large')
  await rejectsCode(() => readBoundedJson(new Request('https://example.test', { method: 'POST', body: new Uint8Array([0xc3, 0x28]) }), 32768), 'invalid_json')
})
