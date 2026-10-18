import {
  canonicalDedupeMaterial,
  readBoundedJson,
  sha256Hex,
  validateCaptureV1,
} from './shortcut_capture.ts'

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

function capture(overrides: Record<string, unknown> = {}) {
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

async function withDedupeKey(input: Record<string, unknown>) {
  return {
    ...input,
    dedupe_key: await sha256Hex(canonicalDedupeMaterial(input)),
  }
}

Deno.test('validates a complete v1 capture and canonicalizes amount', async () => {
  const input = await withDedupeKey(capture({ amount: '80' }))
  const result = await validateCaptureV1(input)
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
  const result = await validateCaptureV1(input)
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
  await rejectsCode(() => validateCaptureV1(capture({ source: 'unknown' })), 'invalid_capture')
  await rejectsCode(() => validateCaptureV1(capture({ parse_status: 'invalid' })), 'invalid_capture')
  await rejectsCode(() => validateCaptureV1(capture({ amount: '0.00' })), 'invalid_capture')
  await rejectsCode(() => validateCaptureV1(capture({ currency: 'USD' })), 'invalid_capture')
  await rejectsCode(() => validateCaptureV1(capture({ account_last4: '123' })), 'invalid_capture')
  await rejectsCode(() => validateCaptureV1(capture({ dedupe_key: 'f'.repeat(64) })), 'invalid_dedupe_key')
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
