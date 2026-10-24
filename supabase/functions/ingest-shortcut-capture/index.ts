import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import {
  validateCaptureV1,
  type ValidatedCaptureV1,
  ShortcutRequestError,
} from '../_shared/shortcut_capture.ts'
import { parseRawShortcutCaptures, type RawCaptureBatch } from '../_shared/shortcut_capture_parser.ts'
import {
  encryptCapture,
  loadInboxKeyring,
  parseDeviceToken,
  timingSafeEqual,
  tokenVerifier,
  type EncryptedCapture,
  type InboxKeyring,
} from '../_shared/shortcut_crypto.ts'

type QueryResult = { data: unknown; error: unknown }
type AdminClientLike = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<QueryResult>
  from: (table: string) => any
}

export type IngestShortcutCaptureDeps = {
  createAdminClient: () => AdminClientLike
  getEnv: (name: string) => string | undefined
  verifyToken: (secret: string, pepper: string) => Promise<Uint8Array>
  compareVerifier: (left: Uint8Array, right: Uint8Array) => boolean
  loadKeyring: () => Promise<InboxKeyring>
  encrypt: (payload: ValidatedCaptureV1, context: { captureId: string; userId: string; schemaVersion: string }, keyring: InboxKeyring) => Promise<EncryptedCapture>
  randomUUID: () => string
  now: () => Date
}

class IngestRequestError extends Error {
  status: number
  code: string

  constructor(status: number, code: string) {
    super(code)
    this.name = 'IngestRequestError'
    this.status = status
    this.code = code
  }
}

function responseError(error: unknown, req: Request): Response {
  if (error instanceof IngestRequestError) return jsonResponse({ error: error.code, code: error.code }, error.status, req)
  if (error instanceof ShortcutRequestError) return jsonResponse({ error: error.code, code: error.code }, error.status, req)
  return jsonResponse({ error: 'ingest_failed', code: 'ingest_failed' }, 500, req)
}

function invalidToken(): never { throw new IngestRequestError(401, 'invalid_token') }

function tokenFromRequest(req: Request): { tokenId: string; secret: string } {
  const header = req.headers.get('Authorization') || ''
  if (!/^Bearer\s+/i.test(header)) invalidToken()
  try {
    const parsed = parseDeviceToken(header.replace(/^Bearer\s+/i, '').trim())
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.tokenId)) invalidToken()
    return parsed
  } catch {
    invalidToken()
  }
}

function bytesFromDatabase(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value) && value.every(item => Number.isInteger(item))) return new Uint8Array(value as number[])
  if (typeof value !== 'string') throw new Error('invalid_verifier')
  const text = value.trim()
  if (/^\\x[0-9a-f]+$/i.test(text)) {
    const hex = text.slice(2)
    if (hex.length % 2) throw new Error('invalid_verifier')
    const result = new Uint8Array(hex.length / 2)
    for (let index = 0; index < result.length; index++) result[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    return result
  }
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)
  try {
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0))
  } catch {
    throw new Error('invalid_verifier')
  }
}

function byteaHex(value: Uint8Array): string {
  return `\\x${Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

async function tokenRow(supabase: AdminClientLike, tokenId: string) {
  const result = await supabase.from('mt_shortcut_tokens').select('id,user_id,secret_verifier,revoked_at').eq('id', tokenId).maybeSingle()
  if (result.error) throw result.error
  return result.data as Record<string, unknown> | null
}

async function existingCapture(supabase: AdminClientLike, userId: string, capture: Pick<ValidatedCaptureV1, 'dedupe_version' | 'dedupe_key'>) {
  const result = await supabase
    .from('mt_shortcut_captures')
    .select('id,status')
    .eq('user_id', userId)
    .eq('dedupe_version', capture.dedupe_version)
    .eq('dedupe_key', capture.dedupe_key)
    .maybeSingle()
  if (result.error) throw result.error
  return result.data as { id: string; status?: string } | null
}

function duplicateResponse(capture: { id: string }) {
  return { status: 'queued', capture_id: capture.id, duplicate: true }
}

type IngestItemResult =
  | { item: number; status: 'queued'; capture_id: string; duplicate: false }
  | { item: number; status: 'duplicate'; capture_id: string; duplicate: true }
  | { item: number; status: 'failed'; code: 'unreadable_capture' }

function batchMessage(queued: number, duplicate: number, failed: number): string {
  return `เข้า Inbox ${queued} รายการ • ซ้ำ ${duplicate} รายการ • อ่านไม่สำเร็จ ${failed} รายการ`
}

function aggregateResponse(results: IngestItemResult[], found: number, req: Request): Response {
  const queued = results.filter(result => result.status === 'queued').length
  const duplicate = results.filter(result => result.status === 'duplicate').length
  const failed = results.filter(result => result.status === 'failed').length
  const payload = {
    status: failed > 0 ? 'partial' : queued > 0 ? 'queued' : 'duplicate',
    message: batchMessage(queued, duplicate, failed),
    found,
    queued,
    duplicate,
    failed,
    results,
  }
  return jsonResponse(payload, queued > 0 ? 202 : 200, req)
}

function unreadableResponse(batch: RawCaptureBatch, req: Request): Response {
  return jsonResponse({
    error: 'invalid_capture',
    code: 'invalid_capture',
    found: batch.found,
    queued: 0,
    duplicate: 0,
    failed: batch.failures.length,
    results: batch.failures.map(({ item, code }) => ({ item, status: 'failed' as const, code })),
  }, 400, req)
}

async function readBoundedBody(req: Request): Promise<Uint8Array> {
  if (!req.body) throw new IngestRequestError(400, 'invalid_capture')
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
      size += chunk.byteLength
      if (size > 32 * 1024) throw new IngestRequestError(413, 'payload_too_large')
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

function parseBody(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return JSON.parse(text)
  } catch {
    throw new IngestRequestError(400, 'invalid_capture')
  }
}

function isRawCaptureEnvelope(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.raw_text === 'string' && typeof record.capture_method === 'string' && !('source' in record)
}

export function createIngestShortcutCaptureHandler(deps: IngestShortcutCaptureDeps): (req: Request) => Promise<Response> {
  return async req => {
    const options = handleOptions(req)
    if (options) return options
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, req)

    try {
      // Consume and bound the body before doing any detailed parse. The token is
      // still authenticated before validation errors are returned to the caller.
      // Bound the byte stream without parsing it; this prevents an invalid token
      // caller from receiving schema/parser details, while still enforcing the
      // request-size limit before any privileged lookup.
      const bodyBytes = await readBoundedBody(req)
      const parsedToken = tokenFromRequest(req)
      const supabase = deps.createAdminClient()
      const row = await tokenRow(supabase, parsedToken.tokenId)
      if (!row || String(row.id) !== parsedToken.tokenId) invalidToken()

      const pepper = deps.getEnv('MT_SHORTCUT_TOKEN_PEPPER_V1')
      if (!pepper || pepper.length < 16) throw new Error('token_pepper_missing')
      const expected = await deps.verifyToken(parsedToken.secret, pepper)
      const stored = bytesFromDatabase(row.secret_verifier)
      if (!deps.compareVerifier(expected, stored)) invalidToken()
      if (row.revoked_at) throw new IngestRequestError(401, 'revoked_token')

      const rate = await supabase.rpc('mt_shortcut_take_rate_slot', {
        p_token_id: parsedToken.tokenId,
        p_now: deps.now().toISOString(),
        p_limit: 30,
      })
      if (rate.error) throw rate.error
      if (rate.data !== true) throw new IngestRequestError(429, 'rate_limited')

      const input = parseBody(bodyBytes)
      let batch: RawCaptureBatch
      try {
        if (isRawCaptureEnvelope(input)) {
          batch = await parseRawShortcutCaptures(input, deps.now().toISOString())
        } else {
          const capture = await validateCaptureV1(input)
          batch = { found: 1, captures: [{ item: 1, capture }], failures: [] }
        }
      } catch (error) {
        if (error instanceof ShortcutRequestError) throw error
        throw new IngestRequestError(400, 'invalid_capture')
      }

      const userId = String(row.user_id)
      if (!batch.captures.length) return unreadableResponse(batch, req)

      const results = new Map<number, IngestItemResult>()
      for (const failure of batch.failures) {
        results.set(failure.item, { item: failure.item, status: 'failed', code: failure.code })
      }

      const pending: Array<{ item: number; capture: ValidatedCaptureV1; captureId: string; encrypted?: EncryptedCapture }> = []
      for (const parsedCapture of batch.captures) {
        const capture = await validateCaptureV1(parsedCapture.capture)
        const existing = await existingCapture(supabase, userId, capture)
        if (existing) {
          results.set(parsedCapture.item, { item: parsedCapture.item, status: 'duplicate', capture_id: existing.id, duplicate: true })
          continue
        }
        pending.push({ item: parsedCapture.item, capture, captureId: deps.randomUUID() })
      }

      if (pending.length) {
        const keyring = await deps.loadKeyring()
        for (const item of pending) {
          item.encrypted = await deps.encrypt(item.capture, {
            captureId: item.captureId,
            userId,
            schemaVersion: item.capture.schema_version,
          }, keyring)
        }

        for (const item of pending) {
          const encrypted = item.encrypted as EncryptedCapture
          const inserted = await supabase.from('mt_shortcut_captures').insert({
            id: item.captureId,
            user_id: userId,
            token_id: parsedToken.tokenId,
            schema_version: item.capture.schema_version,
            dedupe_version: item.capture.dedupe_version,
            dedupe_key: item.capture.dedupe_key,
            status: 'pending',
            ciphertext: byteaHex(encrypted.ciphertext),
            iv: byteaHex(encrypted.iv),
            encryption_key_version: encrypted.keyVersion,
            accepted_at: deps.now().toISOString(),
            updated_at: deps.now().toISOString(),
          }).select('id').maybeSingle()
          if (!inserted.error) {
            results.set(item.item, { item: item.item, status: 'queued', capture_id: item.captureId, duplicate: false })
            continue
          }

          // A concurrent retry may win the unique dedupe constraint. The
          // encrypted bytes are intentionally discarded and the winner is
          // returned instead.
          if (String(Reflect.get(inserted.error as object, 'code')) === '23505') {
            const winner = await existingCapture(supabase, userId, item.capture)
            if (winner) {
              results.set(item.item, { item: item.item, status: 'duplicate', capture_id: winner.id, duplicate: true })
              continue
            }
          }
          throw inserted.error
        }
      }

      const orderedResults = [...results.values()].sort((left, right) => left.item - right.item)
      if (batch.found === 1 && batch.failures.length === 0) {
        const only = orderedResults[0]
        if (only.status === 'queued') return jsonResponse({ status: 'queued', capture_id: only.capture_id, duplicate: false }, 202, req)
        if (only.status === 'duplicate') return jsonResponse(duplicateResponse({ id: only.capture_id }), 200, req)
      }
      return aggregateResponse(orderedResults, batch.found, req)
    } catch (error) {
      return responseError(error, req)
    }
  }
}

if (import.meta.main) {
  const { adminClient } = await import('../_shared/supabase.ts')
  Deno.serve(createIngestShortcutCaptureHandler({
    createAdminClient: () => adminClient() as unknown as AdminClientLike,
    getEnv: name => Deno.env.get(name),
    verifyToken: tokenVerifier,
    compareVerifier: timingSafeEqual,
    loadKeyring: () => loadInboxKeyring(name => Deno.env.get(name)),
    encrypt: encryptCapture,
    randomUUID: () => crypto.randomUUID(),
    now: () => new Date(),
  }))
}

