import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import {
  buildCaptureDedupeIdentity,
  buildNeedsReviewDedupeIdentity,
  validateCaptureV1,
  validateNeedsReviewCapture,
  type ValidatedCustomProfileCaptureV1,
  type ValidatedNeedsReviewCaptureV1,
  type CaptureDedupeIdentity,
  type ValidatedCaptureV1,
  ShortcutRequestError,
} from '../_shared/shortcut_capture.ts'
import { normalizeShortcutCapturedAt } from '../_shared/shortcut_date.ts'
import { matchShortcutProfile, parseShortcutProfileMarker, validateShortcutProfileRule, type ShortcutProfileRule } from '../_shared/shortcut_profile.ts'
import { parseRawShortcutCaptures, type RawCaptureBatch } from '../_shared/shortcut_capture_parser.ts'
import {
  encryptCapture,
  decryptShortcutJson,
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
  encrypt: (payload: ValidatedCaptureV1 & Record<string, unknown>, context: { captureId: string; userId: string; schemaVersion: string }, keyring: InboxKeyring) => Promise<EncryptedCapture>
  lookupProfile?: (supabase: AdminClientLike, userId: string, shortCode: string) => Promise<Record<string, unknown> | null>
  decryptProfile?: (row: Record<string, unknown>, userId: string, keyring: InboxKeyring) => Promise<ShortcutProfileRule>
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

function storeResult(value: unknown): { capture_id: string; duplicate: boolean } {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object') throw new Error('invalid_store_result')
  const captureId = Reflect.get(row, 'capture_id')
  const duplicate = Reflect.get(row, 'duplicate')
  if (typeof captureId !== 'string' || !captureId || typeof duplicate !== 'boolean') throw new Error('invalid_store_result')
  return { capture_id: captureId, duplicate }
}

function isRawCaptureEnvelope(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.raw_text === 'string' && typeof record.capture_method === 'string' && !('source' in record)
}

type CustomCapture = ValidatedCustomProfileCaptureV1 | ValidatedNeedsReviewCaptureV1

async function lookupProfile(supabase: AdminClientLike, userId: string, shortCode: string, deps: IngestShortcutCaptureDeps): Promise<Record<string, unknown> | null> {
  if (deps.lookupProfile) return deps.lookupProfile(supabase, userId, shortCode)
  const result = await supabase.from('mt_shortcut_parser_profiles').select('id,user_id,short_code,name,app_label,enabled,disabled_at,format_version,profile_version,rule_ciphertext,rule_iv,rule_encryption_key_version').eq('user_id', userId).eq('short_code', shortCode).eq('enabled', true).is('disabled_at', null).maybeSingle()
  if (result.error) throw result.error
  return result.data as Record<string, unknown> | null
}

async function prepareCustomCapture(input: Record<string, unknown>, marker: { shortCode: string; notificationText: string }, supabase: AdminClientLike, userId: string, receivedAt: Date, deps: IngestShortcutCaptureDeps): Promise<{ ignored: boolean; capture?: CustomCapture; identity?: CaptureDedupeIdentity }> {
  if (input.capture_method !== 'line_notification') throw new IngestRequestError(400, 'invalid_capture')
  const profile = await lookupProfile(supabase, userId, marker.shortCode, deps)
  if (!profile || profile.enabled !== true || profile.disabled_at) throw new IngestRequestError(400, 'invalid_capture')
  const keyring = await deps.loadKeyring()
  if (!deps.decryptProfile) throw new Error('profile_decrypt_unavailable')
  let rule: ShortcutProfileRule
  try { rule = validateShortcutProfileRule(await deps.decryptProfile(profile, userId, keyring)) } catch { throw new IngestRequestError(400, 'invalid_capture') }
  const capturedAt = normalizeShortcutCapturedAt(input.captured_at, receivedAt.toISOString())
  const match = matchShortcutProfile(rule, marker.notificationText, capturedAt)
  if (match.status === 'ignored') return { ignored: true }
  const profileId = String(profile.id || '')
  const profileVersion = Number(profile.profile_version)
  const profileName = String(profile.name || '').trim().slice(0, 64)
  if (!/^[0-9a-f-]{36}$/i.test(profileId) || !Number.isInteger(profileVersion) || profileVersion < 1 || !profileName) throw new IngestRequestError(400, 'invalid_capture')
  if (match.status === 'needs_review') {
    const draft: ValidatedNeedsReviewCaptureV1 = {
      schema_version: 'money-tracker.capture.v1', parser_version: 'shortcut-profile-1', source: 'custom_profile', profile_id: profileId, profile_version: profileVersion, profile_name: profileName,
      captured_at: capturedAt, capture_method: 'line_notification', raw_text: marker.notificationText, relevant_text: marker.notificationText, parse_status: 'needs_review', reason: match.reason, dedupe_version: 2, dedupe_key: '0'.repeat(64),
    }
    const identity = await buildNeedsReviewDedupeIdentity(draft)
    draft.dedupe_key = identity.dedupeKey
    return { ignored: false, capture: await validateNeedsReviewCapture(draft, receivedAt), identity }
  }
  const value = match.value
  const draft = {
    schema_version: 'money-tracker.capture.v1', parser_version: 'shortcut-profile-1', source: 'custom_profile', bank: String(profile.app_label || profile.name || '').slice(0, 64), amount: value.amount, currency: 'THB', direction: value.direction,
    merchant: value.merchant, description: value.merchant, account_last4: value.accountLast4, card_last4: value.cardLast4, transaction_date: value.transactionDate, transaction_reference: value.transactionReference, transaction_datetime: value.transactionDateTime,
    captured_at: capturedAt, capture_method: 'line_notification', raw_text: marker.notificationText, relevant_text: marker.notificationText, parse_status: 'complete', dedupe_version: 2, dedupe_key: '0'.repeat(64), profile_id: profileId, profile_version: profileVersion, profile_name: profileName,
  } as ValidatedCustomProfileCaptureV1
  const identity = await buildCaptureDedupeIdentity(draft)
  draft.dedupe_key = identity.dedupeKey
  return { ignored: false, capture: draft, identity }
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

      const receivedAt = deps.now()
      const rate = await supabase.rpc('mt_shortcut_take_rate_slot', {
        p_token_id: parsedToken.tokenId,
        p_now: receivedAt.toISOString(),
        p_limit: 30,
      })
      if (rate.error) throw rate.error
      if (rate.data !== true) throw new IngestRequestError(429, 'rate_limited')

      const input = parseBody(bodyBytes)
      const userId = String(row.user_id)
      let customPrepared: Awaited<ReturnType<typeof prepareCustomCapture>> | null = null
      let batch: RawCaptureBatch = { found: 0, captures: [], failures: [] }
      try {
        if (isRawCaptureEnvelope(input)) {
          const marker = parseShortcutProfileMarker(String(input.raw_text))
          if (marker) {
            customPrepared = await prepareCustomCapture(input, marker, supabase, userId, receivedAt, deps)
            if (customPrepared.ignored) return jsonResponse({ status: 'ignored', ignored: true }, 200, req)
            batch = { found: 1, captures: [], failures: [] }
          } else {
            batch = await parseRawShortcutCaptures(input, receivedAt.toISOString())
          }
        } else {
          const capture = await validateCaptureV1(input, receivedAt)
          batch = { found: 1, captures: [{ item: 1, capture }], failures: [] }
        }
      } catch (error) {
        if (error instanceof ShortcutRequestError) throw error
        if (error instanceof IngestRequestError) throw error
        throw new IngestRequestError(400, 'invalid_capture')
      }

      if (!customPrepared && !batch.captures.length) return unreadableResponse(batch, req)

      const results = new Map<number, IngestItemResult>()
      for (const failure of batch.failures) {
        results.set(failure.item, { item: failure.item, status: 'failed', code: failure.code })
      }

      const pending: Array<{
        item: number
        capture: ValidatedCaptureV1 | ValidatedCustomProfileCaptureV1 | ValidatedNeedsReviewCaptureV1
        identity: CaptureDedupeIdentity
        captureId: string
        encrypted?: EncryptedCapture
      }> = []
      if (customPrepared?.capture && customPrepared.identity) {
        pending.push({ item: 1, capture: customPrepared.capture, identity: customPrepared.identity, captureId: deps.randomUUID() })
      }
      for (const parsedCapture of batch.captures) {
        const capture = await validateCaptureV1(parsedCapture.capture, receivedAt)
        const identity = await buildCaptureDedupeIdentity(capture)
        pending.push({ item: parsedCapture.item, capture, identity, captureId: deps.randomUUID() })
      }

      if (pending.length) {
        const keyring = await deps.loadKeyring()
        for (const item of pending) {
          item.encrypted = await deps.encrypt(item.capture as ValidatedCaptureV1 & Record<string, unknown>, {
            captureId: item.captureId,
            userId,
            schemaVersion: item.capture.schema_version,
          }, keyring)
        }

        for (const item of pending) {
          const encrypted = item.encrypted as EncryptedCapture
          const stored = await supabase.rpc('mt_shortcut_store_capture', {
            p_id: item.captureId,
            p_user_id: userId,
            p_token_id: parsedToken.tokenId,
            p_schema_version: item.capture.schema_version,
            p_dedupe_version: item.identity.version,
            p_dedupe_key: item.identity.dedupeKey,
            p_dedupe_base_key: item.identity.version === 2 ? item.identity.baseKey : null,
            p_legacy_dedupe_key: item.identity.legacyKey,
            p_is_strong: item.identity.strong,
            p_captured_at: item.identity.capturedAt,
            p_ciphertext: byteaHex(encrypted.ciphertext),
            p_iv: byteaHex(encrypted.iv),
            p_encryption_key_version: encrypted.keyVersion,
            p_now: receivedAt.toISOString(),
          })
          if (stored.error) throw stored.error
          const receipt = storeResult(stored.data)
          results.set(item.item, receipt.duplicate
            ? { item: item.item, status: 'duplicate', capture_id: receipt.capture_id, duplicate: true }
            : { item: item.item, status: 'queued', capture_id: receipt.capture_id, duplicate: false })
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
    decryptProfile: async (row, userId, keyring) => validateShortcutProfileRule(await decryptShortcutJson({ ciphertext: bytesFromDatabase(row.rule_ciphertext), iv: bytesFromDatabase(row.rule_iv), keyVersion: Number(row.rule_encryption_key_version) }, { objectId: String(row.id), userId, objectType: 'profile_rule', objectVersion: `${Number(row.format_version)}:${Number(row.profile_version)}` }, keyring)),
    randomUUID: () => crypto.randomUUID(),
    now: () => new Date(),
  }))
}

