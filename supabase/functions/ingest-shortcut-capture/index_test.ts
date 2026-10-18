import { canonicalDedupeMaterial, sha256Hex } from '../_shared/shortcut_capture.ts'
import { createIngestShortcutCaptureHandler, type IngestShortcutCaptureDeps } from './index.ts'

function equal(actual: unknown, expected: unknown, message = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
}

async function body(response: Response) { return response.json() as Promise<Record<string, unknown>> }

const tokenId = '11111111-1111-4111-8111-111111111111'
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const secret = 's'.repeat(43)
const token = `mtst_v1.${tokenId}.${secret}`

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

function fakeDatabase(options: {
  tokenRow?: Record<string, unknown> | null
  existing?: Record<string, unknown> | null
  rate?: boolean
  insert?: { data: unknown; error: unknown }
}) {
  const calls: { method: string; args?: unknown }[] = []
  const database = {
    calls,
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ method: `rpc:${name}`, args })
      return { data: options.rate ?? true, error: null }
    },
    from(table: string) {
      const query: Record<string, any> = {}
      const state = { table, operation: 'select' }
      query.select = (...args: unknown[]) => { calls.push({ method: `${table}:select`, args }); return query }
      query.eq = (...args: unknown[]) => { calls.push({ method: `${table}:eq`, args }); return query }
      query.is = (...args: unknown[]) => { calls.push({ method: `${table}:is`, args }); return query }
      query.insert = (...args: unknown[]) => { state.operation = 'insert'; calls.push({ method: `${table}:insert`, args }); return query }
      query.maybeSingle = async () => {
        calls.push({ method: `${table}:maybeSingle` })
        if (table === 'mt_shortcut_tokens') return { data: options.tokenRow ?? null, error: null }
        if (state.operation === 'insert') return options.insert ?? { data: { id: 'capture-1' }, error: null }
        return { data: options.existing ?? null, error: null }
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

