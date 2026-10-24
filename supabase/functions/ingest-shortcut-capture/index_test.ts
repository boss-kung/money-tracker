import { canonicalDedupeMaterial, sha256Hex } from '../_shared/shortcut_capture.ts'
import { parseRawShortcutCaptures } from '../_shared/shortcut_capture_parser.ts'
import { createIngestShortcutCaptureHandler, type IngestShortcutCaptureDeps } from './index.ts'

function equal(actual: unknown, expected: unknown, message = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
}

async function body(response: Response) { return response.json() as Promise<Record<string, unknown>> }

const tokenId = '11111111-1111-4111-8111-111111111111'
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const secret = 's'.repeat(43)
const token = `mtst_v1.${tokenId}.${secret}`
const tokenRow = { id: tokenId, user_id: userId, secret_verifier: new TextEncoder().encode(`${secret}:${'pepper'.repeat(4)}`), revoked_at: null }

function capture(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'money-tracker.capture.v1', parser_version: 'ios-shortcut-1.0.0', source: 'scb_connect', bank: 'SCB',
    amount: '80.00', currency: 'THB', direction: 'debit', merchant: 'MBR9', description: 'MBR9', account_last4: '4078', card_last4: null,
    transaction_datetime: '2026-10-05T21:39:00+07:00', captured_at: '2026-10-05T21:40:03+07:00', capture_method: 'whats_on_screen',
    raw_text: 'SCB Connect\nรายการเงินออก -80.00 บาท', relevant_text: 'รายการเงินออก -80.00 บาท\nยอดเงินที่ใช้ได้ 1,088.37 บาท',
    parse_status: 'complete', dedupe_version: 1, dedupe_key: '0'.repeat(64), ...overrides,
  }
}

async function withKey(input: Record<string, unknown>) {
  return { ...input, dedupe_key: await sha256Hex(await canonicalDedupeMaterial(input)) }
}

function request(bodyValue: unknown, auth = token, options: { stream?: ReadableStream<Uint8Array>; contentLength?: string } = {}) {
  return new Request('https://example.test/ingest-shortcut-capture', {
    method: 'POST', headers: { authorization: `Bearer ${auth}`, ...(options.contentLength ? { 'content-length': options.contentLength } : {}) },
    body: options.stream ?? JSON.stringify(bodyValue),
  })
}

type FakeInsertResult = { data: unknown; error: unknown }

function fakeDatabase(options: {
  tokenRow?: Record<string, unknown> | null
  existing?: Record<string, unknown> | null
  rate?: boolean
  existingByDedupe?: Map<string, Record<string, unknown>>
  rows?: Map<string, Record<string, unknown>>
  insert?: FakeInsertResult
  insertSequence?: FakeInsertResult[]
  events?: string[]
}) {
  const calls: { method: string; args?: unknown }[] = []
  let insertCount = 0
  const database = {
    calls,
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ method: `rpc:${name}`, args })
      return { data: options.rate ?? true, error: null }
    },
    from(table: string) {
      const query: Record<string, any> = {}
      const state: { table: string; operation: string; filters: Record<string, unknown>; insertRow?: Record<string, unknown> } = { table, operation: 'select', filters: {} }
      query.select = (...args: unknown[]) => { calls.push({ method: `${table}:select`, args }); return query }
      query.eq = (...args: unknown[]) => { state.filters[String(args[0])] = args[1]; calls.push({ method: `${table}:eq`, args }); return query }
      query.is = (...args: unknown[]) => { calls.push({ method: `${table}:is`, args }); return query }
      query.insert = (...args: unknown[]) => { state.operation = 'insert'; state.insertRow = args[0] as Record<string, unknown>; calls.push({ method: `${table}:insert`, args }); return query }
      query.maybeSingle = async () => {
        calls.push({ method: `${table}:maybeSingle` })
        if (table === 'mt_shortcut_tokens') return { data: options.tokenRow ?? null, error: null }
        if (state.operation === 'insert') {
          options.events?.push('insert')
          const dedupeKey = String(state.insertRow?.dedupe_key ?? '')
          const implicitRace = options.rows?.has(dedupeKey)
            ? { data: null, error: { code: '23505', message: 'mt_shortcut_captures_dedupe_uq' } }
            : undefined
          const outcome = options.insertSequence?.[insertCount] ?? options.insert ?? implicitRace ?? { data: { id: state.insertRow?.id ?? 'capture-1' }, error: null }
          insertCount += 1
          if (!outcome.error && options.rows && state.insertRow?.dedupe_key) options.rows.set(String(state.insertRow.dedupe_key), { id: String(state.insertRow.id), status: 'pending' })
          return outcome
        }
        const key = String(state.filters.dedupe_key ?? '')
        return { data: options.rows?.get(key) ?? options.existingByDedupe?.get(key) ?? options.existing ?? null, error: null }
      }
      return query
    },
  }
  return database
}

function deps(db: ReturnType<typeof fakeDatabase>, overrides: Partial<IngestShortcutCaptureDeps> = {}) {
  const keyring = { currentVersion: 1, keys: new Map<number, CryptoKey>() }
  const base: IngestShortcutCaptureDeps = {
    createAdminClient: () => db,
    getEnv: (name: string) => name === 'MT_SHORTCUT_TOKEN_PEPPER_V1' ? 'pepper'.repeat(4) : undefined,
    verifyToken: async (value: string, pepper: string) => new TextEncoder().encode(`${value}:${pepper}`),
    compareVerifier: (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((value, index) => value === right[index]),
    loadKeyring: async () => keyring,
    encrypt: async () => ({ ciphertext: new Uint8Array([1, 2, 3]), iv: new Uint8Array(12), keyVersion: 1 }),
    randomUUID: () => '22222222-2222-4222-8222-222222222222',
    now: () => new Date('2026-10-18T00:00:00Z'),
  }
  return { ...base, ...overrides }
}

function uobPairText(amount: string, card: string, merchant: string) {
  return [
    `มีการใช้บัตร UOB-${card} ${merchant} ${amount} THB วันที่/เวลา 24/10/2026 16:00 วงเงินคงเหลือใช้ได้ 90,000.00 THB`,
    `You have spent THB ${amount} using UOB card (ending UOB-${card}) at ${merchant} on 24/10/2026 16:00. Available credit: THB 90,000.00`,
  ].join('\n')
}

function twoUobTransactions() {
  return `${uobPairText('12.34', '1111', '@SHOP ONE')}\n${uobPairText('56.78', '1111', '@SHOP TWO')}`
}

function twoScbTransactions(second = 'complete') {
  return [
    'รายการเงินออก -20.00 บาท',
    'จากบัญชี SAMPLE X-1111',
    'เข้าบัญชี FIRST SHOP',
    'ยอดเงินที่ใช้ได้ 2,000.00 บาท',
    'รายการเงินออก -80.00 บาท',
    'จากบัญชี SAMPLE X-1111',
    'เข้าบัญชี SECOND SHOP',
    ...(second === 'complete' ? ['ยอดเงินที่ใช้ได้ 1,920.00 บาท'] : []),
  ].join('\n')
}

async function parsedCaptures(rawText: string, captureMethod: 'line_notification' | 'whats_on_screen' = 'line_notification') {
  const result = await parseRawShortcutCaptures({ raw_text: rawText, capture_method: captureMethod, captured_at: '2026-10-24T16:20:00+07:00' })
  return result.captures
}

async function validRequest(overrides: Record<string, unknown> = {}) {
  return request(await withKey(capture(overrides)))
}

Deno.test('auth happens before detailed payload validation and invalid tokens are safe', async () => {
  const db = fakeDatabase({ tokenRow: null })
  const handler = createIngestShortcutCaptureHandler(deps(db))
  const response = await handler(request({ not: 'a capture' }, 'not-a-token'))
  equal(response.status, 401)
  equal(await body(response), { error: 'invalid_token', code: 'invalid_token' })
  equal(db.calls.length, 0)
})

Deno.test('accepts a validated capture only after encryption, returning a queued receipt', async () => {
  const db = fakeDatabase({ tokenRow: { id: tokenId, user_id: userId, secret_verifier: new TextEncoder().encode(`${secret}:${'pepper'.repeat(4)}`), revoked_at: null } })
  const order: string[] = []
  const handler = createIngestShortcutCaptureHandler(deps(db, {
    encrypt: async () => { order.push('encrypt'); return { ciphertext: new Uint8Array([9]), iv: new Uint8Array(12), keyVersion: 1 } },
  }))
  const response = await handler(await validRequest())
  equal(response.status, 202)
  equal(await body(response), { status: 'queued', capture_id: '22222222-2222-4222-8222-222222222222', duplicate: false })
  if (!order.includes('encrypt')) throw new Error('encryption must precede insert')
  if (!db.calls.some(call => call.method === 'mt_shortcut_captures:insert')) throw new Error('capture was not inserted')
})

Deno.test('accepts a raw text envelope and parses it before encryption', async () => {
  const db = fakeDatabase({ tokenRow: { id: tokenId, user_id: userId, secret_verifier: new TextEncoder().encode(`${secret}:${'pepper'.repeat(4)}`), revoked_at: null } })
  const handler = createIngestShortcutCaptureHandler(deps(db))
  const response = await handler(request({
    raw_text: 'รายการเงินออก -80.00 บาท\nจากบัญชี THANAPHORN U. X-4078\nเข้าบัญชี MBR9\nยอดเงินที่ใช้ได้ 1,088.37 บาท',
    capture_method: 'whats_on_screen',
    captured_at: '2026-10-05T21:40:00+07:00',
  }))
  equal(response.status, 202)
  const insert = db.calls.find(call => call.method === 'mt_shortcut_captures:insert')
  if (!insert) throw new Error('raw capture was not inserted')
  const row = (insert.args as unknown[])[0] as Record<string, unknown>
  equal(row.schema_version, 'money-tracker.capture.v1')
  equal(row.dedupe_version, 1)
  if (row.dedupe_key === undefined || String(row.dedupe_key).length !== 64) throw new Error('raw capture missing dedupe key')
})

Deno.test('rejects revoked tokens and rate-limited tokens without parsing capture details', async () => {
  const revoked = fakeDatabase({ tokenRow: { id: tokenId, user_id: userId, secret_verifier: new TextEncoder().encode(`${secret}:${'pepper'.repeat(4)}`), revoked_at: '2026-10-17T00:00:00Z' } })
  const handler = createIngestShortcutCaptureHandler(deps(revoked))
  equal((await handler(request({ bad: true }))).status, 401)

  const limited = fakeDatabase({ tokenRow: { id: tokenId, user_id: userId, secret_verifier: new TextEncoder().encode(`${secret}:${'pepper'.repeat(4)}`), revoked_at: null }, rate: false })
  equal((await createIngestShortcutCaptureHandler(deps(limited))(request({ bad: true }))).status, 429)
})

Deno.test('returns the existing id for every duplicate terminal status', async () => {
  for (const status of ['pending', 'claimed', 'consumed', 'dismissed', 'expired']) {
    const db = fakeDatabase({
      tokenRow: { id: tokenId, user_id: userId, secret_verifier: new TextEncoder().encode(`${secret}:${'pepper'.repeat(4)}`), revoked_at: null },
      existing: { id: `capture-${status}`, status },
    })
    let encrypted = false
    const handler = createIngestShortcutCaptureHandler(deps(db, { encrypt: async () => { encrypted = true; return { ciphertext: new Uint8Array([1]), iv: new Uint8Array(12), keyVersion: 1 } } }))
    const response = await handler(await validRequest())
    equal(response.status, 200, status)
    equal(await body(response), { status: 'queued', capture_id: `capture-${status}`, duplicate: true }, status)
    equal(encrypted, false, `${status} must not re-encrypt`)
  }
})

Deno.test('maps a uniqueness race to the winner and leaves no duplicate row', async () => {
  const db = fakeDatabase({
    tokenRow: { id: tokenId, user_id: userId, secret_verifier: new TextEncoder().encode(`${secret}:${'pepper'.repeat(4)}`), revoked_at: null },
    existing: { id: 'capture-winner', status: 'pending' },
    insert: { data: null, error: { code: '23505', message: 'mt_shortcut_captures_dedupe_uq' } },
  })
  const handler = createIngestShortcutCaptureHandler(deps(db))
  const response = await handler(await validRequest())
  equal(response.status, 200)
  equal(await body(response), { status: 'queued', capture_id: 'capture-winner', duplicate: true })
})

Deno.test('queues two parsed UOB transactions as independent encrypted rows', async () => {
  const events: string[] = []
  const db = fakeDatabase({ tokenRow, rows: new Map(), events })
  const ids = [
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ]
  const encryptedContexts: Array<Record<string, unknown>> = []
  const handler = createIngestShortcutCaptureHandler(deps(db, {
    randomUUID: () => ids.shift() as string,
    encrypt: async (payload, context) => {
      events.push('encrypt')
      encryptedContexts.push({ ...context, dedupeKey: payload.dedupe_key })
      return { ciphertext: new Uint8Array([9]), iv: new Uint8Array([encryptedContexts.length]), keyVersion: 1 }
    },
  }))
  const response = await handler(request({ raw_text: twoUobTransactions(), capture_method: 'line_notification', captured_at: '2026-10-24T16:20:00+07:00' }))
  equal(response.status, 202)
  equal(await body(response), {
    status: 'queued',
    message: 'เข้า Inbox 2 รายการ • ซ้ำ 0 รายการ • อ่านไม่สำเร็จ 0 รายการ',
    found: 2,
    queued: 2,
    duplicate: 0,
    failed: 0,
    results: [
      { item: 1, status: 'queued', capture_id: '22222222-2222-4222-8222-222222222222', duplicate: false },
      { item: 2, status: 'queued', capture_id: '33333333-3333-4333-8333-333333333333', duplicate: false },
    ],
  })
  equal(events, ['encrypt', 'encrypt', 'insert', 'insert'])
  equal(encryptedContexts.map(context => context.captureId), [
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ])
  const inserts = db.calls.filter(call => call.method === 'mt_shortcut_captures:insert').map(call => (call.args as unknown[])[0] as Record<string, unknown>)
  equal(inserts.map(row => [row.id, row.dedupe_key]), [
    ['22222222-2222-4222-8222-222222222222', encryptedContexts[0].dedupeKey],
    ['33333333-3333-4333-8333-333333333333', encryptedContexts[1].dedupeKey],
  ])
  if (String(encryptedContexts[0].dedupeKey) === String(encryptedContexts[1].dedupeKey)) throw new Error('batch items must have different dedupe keys')
})

Deno.test('returns ordered queued and duplicate results for a mixed batch', async () => {
  const rawText = twoUobTransactions()
  const captures = await parsedCaptures(rawText)
  const existingByDedupe = new Map([[captures[1].capture.dedupe_key, { id: 'existing-second', status: 'pending' }]])
  const db = fakeDatabase({ tokenRow, existingByDedupe })
  const handler = createIngestShortcutCaptureHandler(deps(db))
  const response = await handler(request({ raw_text: rawText, capture_method: 'line_notification', captured_at: '2026-10-24T16:20:00+07:00' }))
  equal(response.status, 202)
  equal(await body(response), {
    status: 'queued',
    message: 'เข้า Inbox 1 รายการ • ซ้ำ 1 รายการ • อ่านไม่สำเร็จ 0 รายการ',
    found: 2,
    queued: 1,
    duplicate: 1,
    failed: 0,
    results: [
      { item: 1, status: 'queued', capture_id: '22222222-2222-4222-8222-222222222222', duplicate: false },
      { item: 2, status: 'duplicate', capture_id: 'existing-second', duplicate: true },
    ],
  })
})

Deno.test('returns a partial result for one queued and one unreadable group', async () => {
  const db = fakeDatabase({ tokenRow })
  const handler = createIngestShortcutCaptureHandler(deps(db))
  const response = await handler(request({ raw_text: twoScbTransactions('incomplete'), capture_method: 'whats_on_screen', captured_at: '2026-10-24T16:20:00+07:00' }))
  equal(response.status, 202)
  equal(await body(response), {
    status: 'partial',
    message: 'เข้า Inbox 1 รายการ • ซ้ำ 0 รายการ • อ่านไม่สำเร็จ 1 รายการ',
    found: 2,
    queued: 1,
    duplicate: 0,
    failed: 1,
    results: [
      { item: 1, status: 'queued', capture_id: '22222222-2222-4222-8222-222222222222', duplicate: false },
      { item: 2, status: 'failed', code: 'unreadable_capture' },
    ],
  })
})

Deno.test('returns a partial result for one duplicate and one unreadable group', async () => {
  const first = await parsedCaptures(twoScbTransactions('incomplete'), 'whats_on_screen')
  const existingByDedupe = new Map([[first[0].capture.dedupe_key, { id: 'existing-first', status: 'pending' }]])
  const db = fakeDatabase({ tokenRow, existingByDedupe })
  const handler = createIngestShortcutCaptureHandler(deps(db))
  const response = await handler(request({ raw_text: twoScbTransactions('incomplete'), capture_method: 'whats_on_screen', captured_at: '2026-10-24T16:20:00+07:00' }))
  equal(response.status, 200)
  equal(await body(response), {
    status: 'partial',
    message: 'เข้า Inbox 0 รายการ • ซ้ำ 1 รายการ • อ่านไม่สำเร็จ 1 รายการ',
    found: 2,
    queued: 0,
    duplicate: 1,
    failed: 1,
    results: [
      { item: 1, status: 'duplicate', capture_id: 'existing-first', duplicate: true },
      { item: 2, status: 'failed', code: 'unreadable_capture' },
    ],
  })
})

Deno.test('returns only safe failure ordinals when every group is unreadable', async () => {
  const db = fakeDatabase({ tokenRow })
  const handler = createIngestShortcutCaptureHandler(deps(db))
  const response = await handler(request({ raw_text: twoScbTransactions('incomplete').replace('ยอดเงินที่ใช้ได้ 2,000.00 บาท', ''), capture_method: 'whats_on_screen', captured_at: '2026-10-24T16:20:00+07:00' }))
  equal(response.status, 400)
  equal(await body(response), {
    error: 'invalid_capture',
    code: 'invalid_capture',
    found: 2,
    queued: 0,
    duplicate: 0,
    failed: 2,
    results: [
      { item: 1, status: 'failed', code: 'unreadable_capture' },
      { item: 2, status: 'failed', code: 'unreadable_capture' },
    ],
  })
  if (db.calls.some(call => call.method === 'mt_shortcut_captures:insert')) throw new Error('unreadable batch must not insert')
})

Deno.test('rejects more than ten groups before encryption or inserts', async () => {
  const rawText = Array.from({ length: 11 }, (_, index) => `LINE Pay Purchase ฿${index + 1}.00\nMerchant: STORE ${index + 1}`).join('\n')
  const db = fakeDatabase({ tokenRow })
  let encrypted = false
  const handler = createIngestShortcutCaptureHandler(deps(db, { encrypt: async () => { encrypted = true; return { ciphertext: new Uint8Array([1]), iv: new Uint8Array(12), keyVersion: 1 } } }))
  const response = await handler(request({ raw_text: rawText, capture_method: 'line_notification', captured_at: '2026-10-24T16:20:00+07:00' }))
  equal(response.status, 400)
  equal(await body(response), { error: 'too_many_captures', code: 'too_many_captures' })
  equal(encrypted, false)
  if (db.calls.some(call => call.method === 'mt_shortcut_captures:insert')) throw new Error('too many groups must not insert')
})

Deno.test('resolves identical same-language candidates in one request as queued then duplicate', async () => {
  const rawText = [
    'มีการใช้บัตร UOB-1111 @SAME SHOP 12.34 THB วันที่ 24/10 วงเงินคงเหลือใช้ได้ 90,000.00 THB',
    'มีการใช้บัตร UOB-1111 @SAME SHOP 12.34 THB วันที่ 24/10 วงเงินคงเหลือใช้ได้ 90,000.00 THB',
  ].join('\n')
  const db = fakeDatabase({ tokenRow, rows: new Map() })
  const handler = createIngestShortcutCaptureHandler(deps(db))
  const response = await handler(request({ raw_text: rawText, capture_method: 'line_notification', captured_at: '2026-10-24T16:20:00+07:00' }))
  equal(response.status, 202)
  const result = await body(response)
  equal(result.queued, 1)
  equal(result.duplicate, 1)
  equal(result.failed, 0)
  equal(result.results, [
    { item: 1, status: 'queued', capture_id: '22222222-2222-4222-8222-222222222222', duplicate: false },
    { item: 2, status: 'duplicate', capture_id: '22222222-2222-4222-8222-222222222222', duplicate: true },
  ])
})

Deno.test('encrypts every new item before inserting any batch row', async () => {
  const events: string[] = []
  const db = fakeDatabase({ tokenRow, events })
  const handler = createIngestShortcutCaptureHandler(deps(db, { encrypt: async () => { events.push('encrypt'); return { ciphertext: new Uint8Array([1]), iv: new Uint8Array(12), keyVersion: 1 } } }))
  const response = await handler(request({ raw_text: twoUobTransactions(), capture_method: 'line_notification', captured_at: '2026-10-24T16:20:00+07:00' }))
  equal(response.status, 202)
  equal(events, ['encrypt', 'encrypt', 'insert', 'insert'])

  const failingDb = fakeDatabase({ tokenRow, events: [] })
  let encryptCount = 0
  const failing = createIngestShortcutCaptureHandler(deps(failingDb, { encrypt: async () => { encryptCount += 1; if (encryptCount === 2) throw new Error('cipher failed'); return { ciphertext: new Uint8Array([1]), iv: new Uint8Array(12), keyVersion: 1 } } }))
  equal((await failing(request({ raw_text: twoUobTransactions(), capture_method: 'line_notification', captured_at: '2026-10-24T16:20:00+07:00' }))).status, 500)
  if (failingDb.calls.some(call => call.method === 'mt_shortcut_captures:insert')) throw new Error('encryption failure must not insert')
})

Deno.test('retry converges after the second insert fails', async () => {
  const rows = new Map<string, Record<string, unknown>>()
  const db = fakeDatabase({
    tokenRow,
    rows,
    insertSequence: [
      { data: { id: 'first-id' }, error: null },
      { data: null, error: { code: 'XX999', message: 'temporary database failure' } },
    ],
  })
  const ids = ['first-id', 'second-id']
  const handler = createIngestShortcutCaptureHandler(deps(db, { randomUUID: () => ids.shift() as string }))
  const input = { raw_text: twoUobTransactions(), capture_method: 'line_notification', captured_at: '2026-10-24T16:20:00+07:00' }
  equal((await handler(request(input))).status, 500)
  const retry = await handler(request(input))
  equal(retry.status, 202)
  const result = await body(retry)
  equal(result.queued, 1)
  equal(result.duplicate, 1)
  equal(rows.size, 2)
})

Deno.test('bounds streamed bodies and never inserts when encryption fails', async () => {
  const db = fakeDatabase({ tokenRow: { id: tokenId, user_id: userId, secret_verifier: new TextEncoder().encode(`${secret}:${'pepper'.repeat(4)}`), revoked_at: null } })
  const tooLarge = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"x":"' + 'x'.repeat(33000))); controller.close() } })
  const handler = createIngestShortcutCaptureHandler(deps(db))
  equal((await handler(request({}, token, { stream: tooLarge }))).status, 413)

  const failing = createIngestShortcutCaptureHandler(deps(db, { encrypt: async () => { throw new Error('cipher failed') } }))
  const response = await failing(await validRequest())
  equal(response.status, 500)
  equal(await body(response), { error: 'ingest_failed', code: 'ingest_failed' })
  if (db.calls.some(call => call.method === 'mt_shortcut_captures:insert')) throw new Error('encryption failure must not insert')
})

