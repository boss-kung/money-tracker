import { createShortcutInboxHandler, type ShortcutInboxDeps } from './index.ts'
import { sha256Hex } from '../_shared/shortcut_capture.ts'

function equal(actual: unknown, expected: unknown, message = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
}

async function body(response: Response) { return response.json() as Promise<Record<string, unknown>> }
function req(method: string, path: string, value?: unknown) {
  return new Request(`https://example.test${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value),
  })
}

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const captureId = '22222222-2222-4222-8222-222222222222'
const payload = {
  schema_version: 'money-tracker.capture.v1', parser_version: 'ios-shortcut-1.0.0', source: 'scb_connect', bank: 'SCB', amount: '80.00', currency: 'THB', direction: 'debit', merchant: 'MBR9', description: 'MBR9', account_last4: '4078', card_last4: null, transaction_datetime: '2026-10-05T21:39:00+07:00', captured_at: '2026-10-05T21:40:03+07:00', capture_method: 'whats_on_screen', raw_text: 'RAW SECRET', relevant_text: 'RELEVANT SECRET', parse_status: 'complete', dedupe_version: 1, dedupe_key: 'a'.repeat(64),
}

function captureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: captureId, user_id: userId, schema_version: payload.schema_version, dedupe_version: 1, dedupe_key: payload.dedupe_key, status: 'pending',
    ciphertext: '\\x010203', iv: '\\x000000000000000000000000', encryption_key_version: 1, claim_expires_at: null, claim_device_id: null, accepted_at: '2026-10-18T00:00:00Z', updated_at: '2026-10-18T00:00:00Z',
    ...overrides,
  }
}

function database(options: { rows?: Record<string, unknown>[]; row?: Record<string, unknown> | null; rpc?: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }) {
  const calls: { method: string; args?: unknown }[] = []
  const rows = options.rows ?? [captureRow()]
  const db = {
    calls,
    from(table: string) {
      const query: Record<string, any> = {}
      query.select = (...args: unknown[]) => { calls.push({ method: `${table}:select`, args }); return query }
      query.eq = (...args: unknown[]) => { calls.push({ method: `${table}:eq`, args }); return query }
      query.lt = (...args: unknown[]) => { calls.push({ method: `${table}:lt`, args }); return query }
      query.or = (...args: unknown[]) => { calls.push({ method: `${table}:or`, args }); return query }
      query.order = (...args: unknown[]) => { calls.push({ method: `${table}:order`, args }); return query }
      query.limit = (...args: unknown[]) => { calls.push({ method: `${table}:limit`, args }); return query }
      query.maybeSingle = async () => ({ data: options.row === undefined ? rows[0] ?? null : options.row, error: null })
      query.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null, count: rows.length })
      return query
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ method: `rpc:${name}`, args })
      return options.rpc ? options.rpc(name, args) : { data: name === 'mt_shortcut_claim_capture' ? true : 'consumed', error: null }
    },
  }
  return db
}

function deps(db: ReturnType<typeof database>, overrides: Partial<ShortcutInboxDeps> = {}) {
  const keyring = { currentVersion: 1, keys: new Map<number, CryptoKey>() }
  const base: ShortcutInboxDeps = {
    requireUser: async () => userId,
    createAdminClient: () => db,
    loadKeyring: async () => keyring,
    decrypt: async () => payload,
    hash: async (value: string) => sha256Hex(value),
    randomBytes: (length: number) => new Uint8Array(length).fill(7),
    now: () => new Date('2026-10-18T00:00:00Z'),
  }
  return { ...base, ...overrides }
}

Deno.test('auth precedes privileged access and lists owner-scoped preview fields only', async () => {
  let adminCalls = 0
  const db = database({ rows: [captureRow()] })
  const handler = createShortcutInboxHandler({ ...deps(db), requireUser: async () => { throw Object.assign(new Error('Unauthorized'), { status: 401, code: 'UNAUTHORIZED' }) }, createAdminClient: () => { adminCalls++; return db } })
  equal((await handler(req('GET', '/shortcut-inbox?view=pending'))).status, 401)
  equal(adminCalls, 0)

  const authenticated = createShortcutInboxHandler(deps(db))
  const response = await authenticated(req('GET', '/shortcut-inbox?view=pending&limit=20'))
  equal(response.status, 200)
  const result = await body(response)
  const item = (result.items as Record<string, unknown>[])[0]
  if ('raw_text' in item || 'relevant_text' in item) throw new Error('list leaked review text')
  equal(item.merchant, 'MBR9')
  equal(result.next_cursor, null)
})

Deno.test('count clamps the page and cursor uses accepted_at plus id', async () => {
  const db = database({ rows: [captureRow()] })
  const handler = createShortcutInboxHandler(deps(db))
  const response = await handler(req('GET', '/shortcut-inbox?view=count&limit=999&cursor=2026-10-18T00:00:00Z,' + captureId))
  equal(response.status, 200)
  equal(await body(response), { count: 1 })
  if (!db.calls.some(call => call.method === 'mt_shortcut_captures:limit' && JSON.stringify(call.args) === JSON.stringify([50]))) throw new Error('limit was not clamped')
})

Deno.test('pending and count views reclaim expired claim leases before listing', async () => {
  const db = database({ rows: [captureRow({ status: 'claimed', claim_expires_at: '2026-10-17T23:59:00Z' })] })
  const handler = createShortcutInboxHandler(deps(db))
  equal((await handler(req('GET', '/shortcut-inbox?view=pending'))).status, 200)
  equal((await handler(req('GET', '/shortcut-inbox?view=count'))).status, 200)
  const reclaimCalls = db.calls.filter(call => call.method === 'rpc:mt_shortcut_reclaim_expired_claims')
  equal(reclaimCalls.length, 2)
  equal((reclaimCalls[0]?.args as Record<string, unknown>).p_user_id, userId)
})

Deno.test('claim records device id and returns one-time secret with full decrypted payload', async () => {
  const db = database({ row: captureRow() })
  const handler = createShortcutInboxHandler(deps(db))
  const response = await handler(req('POST', '/shortcut-inbox/claim', { capture_id: captureId, device_id: 'Safari on iPhone' }))
  equal(response.status, 200)
  const result = await body(response)
  equal(result.claim_secret, 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc')
  equal((result.capture as Record<string, unknown>).raw_text, 'RAW SECRET')
  const rpc = db.calls.find(call => call.method === 'rpc:mt_shortcut_claim_capture')
  if (!rpc || JSON.stringify(rpc.args).includes('RAW SECRET')) throw new Error('claim RPC received plaintext')
})

Deno.test('foreign active claims return 409 while expired claims can be replaced', async () => {
  const active = database({ row: captureRow({ status: 'claimed', claim_expires_at: '2026-10-18T00:05:00Z', claim_device_id: 'other' }) })
  const handler = createShortcutInboxHandler(deps(active))
  equal((await handler(req('POST', '/shortcut-inbox/claim', { capture_id: captureId, device_id: 'this-device' }))).status, 409)

  const expired = database({ row: captureRow({ status: 'claimed', claim_expires_at: '2026-10-17T23:59:00Z' }) })
  const replaced = createShortcutInboxHandler(deps(expired))
  equal((await replaced(req('POST', '/shortcut-inbox/claim', { capture_id: captureId, device_id: 'this-device' }))).status, 200)
})

Deno.test('release and consume hash secrets and transaction IDs; ack is deterministic', async () => {
  const db = database({ row: captureRow({ status: 'claimed' }), rpc: async (name) => ({ data: name === 'mt_shortcut_release_capture' ? true : 'already_consumed_same', error: null }) })
  const handler = createShortcutInboxHandler(deps(db))
  equal((await handler(req('POST', '/shortcut-inbox/release', { capture_id: captureId, claim_secret: 'claim-secret' }))).status, 200)
  equal((await handler(req('POST', '/shortcut-inbox/consume', { capture_id: captureId, claim_secret: 'claim-secret', transaction_id: 'shortcut:' + captureId }))).status, 200)
  const ack = await handler(req('POST', '/shortcut-inbox/ack', { capture_id: captureId }))
  equal(ack.status, 200)
  const consumeCalls = db.calls.filter(call => call.method === 'rpc:mt_shortcut_consume_capture')
  if (consumeCalls.some(call => JSON.stringify(call.args).includes('claim-secret'))) throw new Error('claim secret sent in plaintext')
  const ackArgs = consumeCalls[consumeCalls.length - 1]?.args as Record<string, unknown>
  equal(ackArgs.p_transaction_id_hash, '\\x' + await sha256Hex('shortcut:' + captureId))
})

Deno.test('maps terminal outcomes and keeps decryption failure generic', async () => {
  const consumed = database({ row: captureRow({ status: 'consumed' }), rpc: async () => ({ data: 'capture_already_consumed', error: null }) })
  const handler = createShortcutInboxHandler(deps(consumed))
  equal((await handler(req('POST', '/shortcut-inbox/consume', { capture_id: captureId, claim_secret: 'x', transaction_id: 'other' }))).status, 409)

  const failing = createShortcutInboxHandler(deps(database({ row: captureRow() }), { decrypt: async () => { throw new Error('bad aad') } }))
  const response = await failing(req('POST', '/shortcut-inbox/claim', { capture_id: captureId, device_id: 'device' }))
  equal(response.status, 503)
  equal(await body(response), { error: 'capture_unavailable', code: 'capture_unavailable' })
})

Deno.test('dismiss and restore stay confirmation-neutral and honor the retention window RPC', async () => {
  const db = database({ row: captureRow(), rpc: async (name) => ({ data: name === 'mt_shortcut_dismiss_capture' ? 'dismissed' : 'restored', error: null }) })
  const handler = createShortcutInboxHandler(deps(db))
  equal((await handler(req('POST', '/shortcut-inbox/dismiss', { capture_id: captureId }))).status, 200)
  equal((await handler(req('POST', '/shortcut-inbox/restore', { capture_id: captureId }))).status, 200)
  if (!db.calls.some(call => call.method === 'rpc:mt_shortcut_restore_capture')) throw new Error('restore RPC missing')
})

