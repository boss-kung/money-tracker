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
    transaction_date: null, transaction_reference: null, transaction_datetime: '2026-10-05T21:39:00+07:00', captured_at: '2026-10-24T21:40:03+07:00', capture_method: 'whats_on_screen',
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
  const stored: Array<{
    id: string
    userId: string
    version: number
    key: string
    baseKey: string | null
    legacyKey: string | null
    strong: boolean
    capturedAt: string
    acceptedAt: string
    ciphertext: unknown
  }> = []
  const duplicate = (id: string) => ({ data: [{ capture_id: id, duplicate: true }], error: null })
  const queued = (id: string) => ({ data: [{ capture_id: id, duplicate: false }], error: null })
  function findDuplicate(args: Record<string, unknown>): string | null {
    const userId = String(args.p_user_id)
    const version = Number(args.p_dedupe_version)
    const key = String(args.p_dedupe_key)
    const baseKey = args.p_dedupe_base_key ? String(args.p_dedupe_base_key) : null
    const legacyKey = args.p_legacy_dedupe_key ? String(args.p_legacy_dedupe_key) : null
    const strong = Boolean(args.p_is_strong)
    const capturedAt = Date.parse(String(args.p_captured_at))
    for (const row of stored) {
      if (row.userId !== userId) continue
      if (version === 2 && strong && row.version === 2 && row.key === key) return row.id
      if (strong && legacyKey && row.version === 1 && row.key === legacyKey) return row.id
      if (version === 2 && !strong && row.version === 2 && row.baseKey === baseKey
        && Math.abs(Date.parse(row.capturedAt) - capturedAt) <= 5 * 60 * 1000) return row.id
      if (legacyKey && row.version === 1 && row.key === legacyKey
        && Math.abs(Date.parse(row.acceptedAt) - capturedAt) <= 5 * 60 * 1000) return row.id
    }
    if (options.existingByDedupe?.has(key)) return String(options.existingByDedupe.get(key)?.id)
    if (options.existing) return String(options.existing.id)
    return null
  }
  function remember(args: Record<string, unknown>, id: string, ciphertext: unknown) {
    const row = {
      id,
      userId: String(args.p_user_id),
      version: Number(args.p_dedupe_version),
      key: String(args.p_dedupe_key),
      baseKey: args.p_dedupe_base_key ? String(args.p_dedupe_base_key) : null,
      legacyKey: args.p_legacy_dedupe_key ? String(args.p_legacy_dedupe_key) : null,
      strong: Boolean(args.p_is_strong),
      capturedAt: String(args.p_captured_at),
      acceptedAt: String(args.p_now),
      ciphertext,
    }
    stored.push(row)
    options.rows?.set(row.key, { ...row, status: 'pending' })
  }
  const database = {
    calls,
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ method: `rpc:${name}`, args })
      if (name === 'mt_shortcut_store_capture') {
        options.events?.push('store')
        const existingId = findDuplicate(args)
        if (existingId) return duplicate(existingId)
        const outcome = options.insertSequence?.[insertCount] ?? options.insert
        insertCount += 1
        if (outcome) {
          if (outcome.error) return outcome
          const id = String((outcome.data as Record<string, unknown> | null)?.id ?? args.p_id)
          remember(args, id, args.p_ciphertext)
          return queued(id)
        }
        const id = String(args.p_id)
        remember(args, id, args.p_ciphertext)
        return queued(id)
      }
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
    now: () => new Date('2026-10-25T16:20:00+07:00'),
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

Deno.test('passes each screen item date and v2 identity to the atomic store', async () => {
  const encryptedDates: Array<string | null> = []
  const db = fakeDatabase({ tokenRow })
  const handler = createIngestShortcutCaptureHandler(deps(db, {
    encrypt: async payload => {
      encryptedDates.push(payload.transaction_date)
      return { ciphertext: new Uint8Array([1]), iv: new Uint8Array(12), keyVersion: 1 }
    },
  }))
  const response = await handler(request({
    raw_text: [
      'มีการใช้บัตร UOB-1111 จำนวน 12.34 THB ที่ร้าน FIRST SHOP วันที่ 24/10 วงเงินคงเหลือใช้ได้ 90,000.00 THB',
      'มีการใช้บัตร UOB-1111 จำนวน 56.78 THB ที่ร้าน SECOND SHOP วันที่ 25/10 วงเงินคงเหลือใช้ได้ 89,943.22 THB',
    ].join('\n'),
    capture_method: 'line_notification',
    captured_at: '2026-10-25T16:20:00+07:00',
  }))
  equal(response.status, 202)
  equal(encryptedDates, ['2026-10-24', '2026-10-25'])
  const stores = db.calls.filter(call => call.method === 'rpc:mt_shortcut_store_capture')
  equal(stores.length, 2)
  equal(stores.map(call => [
    (call.args as Record<string, unknown>).p_dedupe_version,
    (call.args as Record<string, unknown>).p_dedupe_base_key,
    (call.args as Record<string, unknown>).p_captured_at,
  ]).map(row => [row[0], typeof row[1] === 'string' && /^[0-9a-f]{64}$/.test(row[1]), row[2]]), [
    [2, true, '2026-10-25T16:20:00+07:00'],
    [2, true, '2026-10-25T16:20:00+07:00'],
  ])
})

Deno.test('uses one frozen receipt time for missing and out-of-range captured_at', async () => {
  const db = fakeDatabase({ tokenRow })
  const handler = createIngestShortcutCaptureHandler(deps(db))
  const missing = await handler(request({
    raw_text: 'มีการใช้บัตร UOB-1111 จำนวน 12.34 THB ที่ร้าน SHOP วันที่ 25/10 วงเงินคงเหลือใช้ได้ 90,000.00 THB',
    capture_method: 'line_notification',
  }))
  equal(missing.status, 202)
  const missingStore = db.calls.find(call => call.method === 'rpc:mt_shortcut_store_capture')
  equal((missingStore?.args as Record<string, unknown>).p_captured_at, '2026-10-25T16:20:00+07:00')

  const beforeStoreCount = db.calls.filter(call => call.method === 'rpc:mt_shortcut_store_capture').length
  const invalid = await handler(request({
    raw_text: 'มีการใช้บัตร UOB-1111 จำนวน 12.34 THB ที่ร้าน SHOP วันที่ 25/10 วงเงินคงเหลือใช้ได้ 90,000.00 THB',
    capture_method: 'line_notification',
    captured_at: '2026-10-01T16:20:00+07:00',
  }))
  equal(invalid.status, 400)
  equal(await body(invalid), { error: 'invalid_capture', code: 'invalid_capture' })
  equal(db.calls.filter(call => call.method === 'rpc:mt_shortcut_store_capture').length, beforeStoreCount)
})

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
  if (!db.calls.some(call => call.method === 'rpc:mt_shortcut_store_capture')) throw new Error('capture was not stored')
})

Deno.test('accepts a raw text envelope and parses it before encryption', async () => {
  const db = fakeDatabase({ tokenRow: { id: tokenId, user_id: userId, secret_verifier: new TextEncoder().encode(`${secret}:${'pepper'.repeat(4)}`), revoked_at: null } })
  const handler = createIngestShortcutCaptureHandler(deps(db))
  const response = await handler(request({
    raw_text: 'รายการเงินออก -80.00 บาท\nจากบัญชี THANAPHORN U. X-4078\nเข้าบัญชี MBR9\nยอดเงินที่ใช้ได้ 1,088.37 บาท',
    capture_method: 'whats_on_screen',
    captured_at: '2026-10-24T21:40:00+07:00',
  }))
  equal(response.status, 202)
  const store = db.calls.find(call => call.method === 'rpc:mt_shortcut_store_capture')
  if (!store) throw new Error('raw capture was not stored')
  const args = store.args as Record<string, unknown>
  equal(args.p_schema_version, 'money-tracker.capture.v1')
  equal(args.p_dedupe_version, 2)
  if (args.p_dedupe_key === undefined || String(args.p_dedupe_key).length !== 64) throw new Error('raw capture missing dedupe key')
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
    equal(encrypted, true, `${status} is resolved by the atomic store after encryption`)
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
  equal(events, ['encrypt', 'encrypt', 'store', 'store'])
  equal(encryptedContexts.map(context => context.captureId), [
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ])
  const stores = db.calls.filter(call => call.method === 'rpc:mt_shortcut_store_capture').map(call => call.args as Record<string, unknown>)
  equal(stores.map(row => [row.p_id, row.p_dedupe_key]), [
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
  if (db.calls.some(call => call.method === 'rpc:mt_shortcut_store_capture')) throw new Error('unreadable batch must not store')
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
  if (db.calls.some(call => call.method === 'rpc:mt_shortcut_store_capture')) throw new Error('too many groups must not store')
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
  equal(events, ['encrypt', 'encrypt', 'store', 'store'])

  const failingDb = fakeDatabase({ tokenRow, events: [] })
  let encryptCount = 0
  const failing = createIngestShortcutCaptureHandler(deps(failingDb, { encrypt: async () => { encryptCount += 1; if (encryptCount === 2) throw new Error('cipher failed'); return { ciphertext: new Uint8Array([1]), iv: new Uint8Array(12), keyVersion: 1 } } }))
  equal((await failing(request({ raw_text: twoUobTransactions(), capture_method: 'line_notification', captured_at: '2026-10-24T16:20:00+07:00' }))).status, 500)
  if (failingDb.calls.some(call => call.method === 'rpc:mt_shortcut_store_capture')) throw new Error('encryption failure must not store')
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
  if (db.calls.some(call => call.method === 'rpc:mt_shortcut_store_capture')) throw new Error('encryption failure must not store')
})

Deno.test('dedupes adjacent timeless buckets but queues a later same-shape event', async () => {
  const db = fakeDatabase({ tokenRow })
  const ids = ['first-timeless', 'second-timeless', 'third-timeless']
  const handler = createIngestShortcutCaptureHandler(deps(db, {
    randomUUID: () => ids.shift() as string,
    now: () => new Date('2026-10-25T16:30:01+07:00'),
  }))
  const raw = 'มีการใช้บัตร UOB-1111 จำนวน 12.34 THB ที่ร้าน SHOP วันที่ 25/10 วงเงินคงเหลือใช้ได้ 90,000.00 THB'
  const first = await handler(request({ raw_text: raw, capture_method: 'line_notification', captured_at: '2026-10-25T16:24:59+07:00' }))
  const adjacent = await handler(request({ raw_text: raw, capture_method: 'line_notification', captured_at: '2026-10-25T16:25:01+07:00' }))
  const later = await handler(request({ raw_text: raw, capture_method: 'line_notification', captured_at: '2026-10-25T16:30:01+07:00' }))
  equal(await body(first), { status: 'queued', capture_id: 'first-timeless', duplicate: false })
  equal(await body(adjacent), { status: 'queued', capture_id: 'first-timeless', duplicate: true })
  equal(await body(later), { status: 'queued', capture_id: 'third-timeless', duplicate: false })
})

Deno.test('dedupes strong transaction dates beyond the timeless five-minute window', async () => {
  const db = fakeDatabase({ tokenRow })
  const ids = ['first-strong', 'second-strong']
  const handler = createIngestShortcutCaptureHandler(deps(db, { randomUUID: () => ids.shift() as string }))
  const raw = 'มีการใช้บัตร UOB-1111 จำนวน 12.34 THB ที่ร้าน SHOP วันที่/เวลา 25/10/2026 16:00 วงเงินคงเหลือใช้ได้ 90,000.00 THB'
  const first = await handler(request({ raw_text: raw, capture_method: 'line_notification', captured_at: '2026-10-25T16:20:00+07:00' }))
  const retry = await handler(request({ raw_text: raw, capture_method: 'line_notification', captured_at: '2026-10-25T16:30:00+07:00' }))
  equal(await body(first), { status: 'queued', capture_id: 'first-strong', duplicate: false })
  equal(await body(retry), { status: 'queued', capture_id: 'first-strong', duplicate: true })
})

Deno.test('matches nearby v1 timeless rollout receipts but not older same-day receipts', async () => {
  const db = fakeDatabase({ tokenRow })
  const ids = ['legacy-first', 'legacy-nearby', 'legacy-second']
  const handler = createIngestShortcutCaptureHandler(deps(db, { randomUUID: () => ids.shift() as string }))
  const base = { ...capture({ transaction_datetime: null, transaction_date: null, captured_at: '2026-10-25T16:20:00+07:00' }) }
  const first = await handler(await validRequest(base))
  const nearby = await handler(await validRequest({ ...base, captured_at: '2026-10-25T16:24:59+07:00' }))
  const older = await handler(await validRequest({ ...base, captured_at: '2026-10-25T16:26:01+07:00' }))
  equal(await body(first), { status: 'queued', capture_id: 'legacy-first', duplicate: false })
  equal(await body(nearby), { status: 'queued', capture_id: 'legacy-first', duplicate: true })
  equal(await body(older), { status: 'queued', capture_id: 'legacy-second', duplicate: false })
})

Deno.test('concurrent atomic store calls produce one queued and one duplicate result', async () => {
  const db = fakeDatabase({ tokenRow })
  const ids = ['concurrent-first', 'concurrent-second']
  const handler = createIngestShortcutCaptureHandler(deps(db, { randomUUID: () => ids.shift() as string }))
  const input = { raw_text: twoUobTransactions(), capture_method: 'line_notification', captured_at: '2026-10-24T16:20:00+07:00' }
  const responses = await Promise.all([handler(request(input)), handler(request(input))])
  const bodies = await Promise.all(responses.map(body))
  equal(bodies.filter(result => result.status === 'queued').length, 1)
  equal(bodies.filter(result => result.status === 'duplicate').length, 1)
})

