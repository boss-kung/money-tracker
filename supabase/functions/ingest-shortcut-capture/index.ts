import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import {
  validateCaptureV1,
  type ValidatedCaptureV1,
  ShortcutRequestError,
} from '../_shared/shortcut_capture.ts'
import { parseRawShortcutCapture } from '../_shared/shortcut_capture_parser.ts'
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
      let capture: ValidatedCaptureV1
      try {
        const parsed = isRawCaptureEnvelope(input)
          ? await parseRawShortcutCapture(input, deps.now().toISOString())
          : input
        capture = await validateCaptureV1(parsed)
      } catch (error) {
        if (error instanceof ShortcutRequestError) throw error
        throw new IngestRequestError(400, 'invalid_capture')
      }

      const userId = String(row.user_id)
      const existing = await existingCapture(supabase, userId, capture)
      if (existing) return jsonResponse(duplicateResponse(existing), 200, req)

      const captureId = deps.randomUUID()
      const keyring = await deps.loadKeyring()
      const encrypted = await deps.encrypt(capture, {
        captureId,
        userId,
        schemaVersion: capture.schema_version,
      }, keyring)

      const inserted = await supabase.from('mt_shortcut_captures').insert({
        id: captureId,
        user_id: userId,
        token_id: parsedToken.tokenId,
        schema_version: capture.schema_version,
        dedupe_version: capture.dedupe_version,
        dedupe_key: capture.dedupe_key,
        status: 'pending',
        ciphertext: byteaHex(encrypted.ciphertext),
        iv: byteaHex(encrypted.iv),
        encryption_key_version: encrypted.keyVersion,
        accepted_at: deps.now().toISOString(),
        updated_at: deps.now().toISOString(),
      }).select('id').maybeSingle()
      if (!inserted.error) return jsonResponse({ status: 'queued', capture_id: captureId, duplicate: false }, 202, req)

      // A concurrent retry may win the unique dedupe constraint. The encrypted
      // bytes are intentionally discarded and the winner is returned instead.
      if (String(Reflect.get(inserted.error as object, 'code')) === '23505') {
        const winner = await existingCapture(supabase, userId, capture)
        if (winner) return jsonResponse(duplicateResponse(winner), 200, req)
      }
      throw inserted.error
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

