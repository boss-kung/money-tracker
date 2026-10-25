import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { decryptCapture, loadInboxKeyring, type InboxKeyring } from '../_shared/shortcut_crypto.ts'
import { sha256Hex } from '../_shared/shortcut_capture.ts'

type QueryResult = { data: unknown; error: unknown; count?: number | null }
type AdminClientLike = { from: (table: string) => any; rpc: (name: string, args: Record<string, unknown>) => Promise<QueryResult> }
type CaptureRow = Record<string, unknown>

export type ShortcutInboxDeps = {
  requireUser: (req: Request) => Promise<string>
  createAdminClient: () => AdminClientLike
  loadKeyring: () => Promise<InboxKeyring>
  decrypt: (record: { ciphertext: Uint8Array; iv: Uint8Array; keyVersion: number }, context: { captureId: string; userId: string; schemaVersion: string }, keyring: InboxKeyring) => Promise<Record<string, unknown>>
  hash: (value: string) => Promise<string>
  randomBytes: (length: number) => Uint8Array
  now: () => Date
}

class InboxRequestError extends Error {
  status: number
  code: string
  constructor(status: number, code: string) { super(code); this.name = 'InboxRequestError'; this.status = status; this.code = code }
}

function responseError(error: unknown, req: Request): Response {
  if (error instanceof InboxRequestError) return jsonResponse({ error: error.code, code: error.code }, error.status, req)
  const status = Number(Reflect.get(error as object, 'status') || 500)
  const code = String(Reflect.get(error as object, 'code') || (status === 401 ? 'UNAUTHORIZED' : 'inbox_failed'))
  return jsonResponse({ error: code, code }, status, req)
}

function uuid(value: unknown): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) throw new InboxRequestError(400, 'invalid_capture_id')
  return result
}

function bytesFromDatabase(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return new Uint8Array(value as number[])
  if (typeof value !== 'string') throw new Error('capture_ciphertext_missing')
  const text = value.trim()
  if (/^\\x[0-9a-f]+$/i.test(text)) {
    const hex = text.slice(2)
    if (hex.length % 2) throw new Error('capture_ciphertext_invalid')
    const result = new Uint8Array(hex.length / 2)
    for (let index = 0; index < result.length; index++) result[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    return result
  }
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0))
}

function byteaHex(hex: string): string {
  return `\\x${hex.replace(/^0x/, '')}`
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function pageSize(value: string | null): number {
  const parsed = Number(value || 20)
  if (!Number.isFinite(parsed)) return 20
  return Math.min(50, Math.max(1, Math.floor(parsed)))
}

function cursor(value: string | null): { acceptedAt: string; id: string } | null {
  if (!value) return null
  const separator = value.lastIndexOf(',')
  if (separator < 1) throw new InboxRequestError(400, 'invalid_cursor')
  const acceptedAt = value.slice(0, separator)
  const id = uuid(value.slice(separator + 1))
  if (Number.isNaN(Date.parse(acceptedAt))) throw new InboxRequestError(400, 'invalid_cursor')
  return { acceptedAt, id }
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid')
    return body as Record<string, unknown>
  } catch {
    throw new InboxRequestError(400, 'invalid_json')
  }
}

async function rowFor(supabase: AdminClientLike, userId: string, captureId: string): Promise<CaptureRow> {
  const result = await supabase.from('mt_shortcut_captures').select('*').eq('id', captureId).eq('user_id', userId).maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw new InboxRequestError(404, 'capture_not_found')
  return result.data as CaptureRow
}

async function decryptRow(row: CaptureRow, userId: string, deps: ShortcutInboxDeps): Promise<Record<string, unknown>> {
  try {
    if (!row.ciphertext || !row.iv || row.encryption_key_version === null || row.encryption_key_version === undefined) throw new Error('capture_ciphertext_missing')
    const keyring = await deps.loadKeyring()
    return await deps.decrypt({
      ciphertext: bytesFromDatabase(row.ciphertext), iv: bytesFromDatabase(row.iv), keyVersion: Number(row.encryption_key_version),
    }, { captureId: String(row.id), userId, schemaVersion: String(row.schema_version) }, keyring)
  } catch {
    throw new InboxRequestError(503, 'capture_unavailable')
  }
}

async function reclaimExpiredClaims(supabase: AdminClientLike, userId: string, deps: ShortcutInboxDeps): Promise<void> {
  const result = await supabase.rpc('mt_shortcut_reclaim_expired_claims', {
    p_user_id: userId,
    p_now: deps.now().toISOString(),
  })
  if (result.error) throw result.error
}

function preview(row: CaptureRow, payload: Record<string, unknown>) {
  if (payload.parse_status === 'needs_review') {
    return {
      capture_id: String(row.id), status: String(row.status), accepted_at: row.accepted_at, updated_at: row.updated_at,
      source: payload.source, profile_id: payload.profile_id, profile_name: payload.profile_name, captured_at: payload.captured_at,
      parse_status: 'needs_review',
    }
  }
  return {
    capture_id: String(row.id), status: String(row.status), accepted_at: row.accepted_at, updated_at: row.updated_at,
    source: payload.source, bank: payload.bank, amount: payload.amount, currency: payload.currency, direction: payload.direction,
    merchant: payload.merchant, description: payload.description, account_last4: payload.account_last4, card_last4: payload.card_last4,
    transaction_date: payload.transaction_date, transaction_datetime: payload.transaction_datetime, captured_at: payload.captured_at, capture_method: payload.capture_method,
  }
}

function terminalResponse(result: unknown, req: Request): Response {
  const status = String(result)
  if (status === 'consumed' || status === 'already_consumed_same') return jsonResponse({ status: 'consumed', duplicate: status === 'already_consumed_same' }, 200, req)
  if (status === 'capture_already_consumed') throw new InboxRequestError(409, 'capture_already_consumed')
  if (status === 'claim_conflict') throw new InboxRequestError(409, 'capture_claimed')
  if (status === 'not_found') throw new InboxRequestError(404, 'capture_not_found')
  throw new InboxRequestError(409, 'capture_unavailable')
}

async function claim(supabase: AdminClientLike, row: CaptureRow, userId: string, deviceId: string, deps: ShortcutInboxDeps): Promise<Record<string, unknown>> {
  const now = deps.now()
  if (row.status === 'claimed' && row.claim_expires_at && new Date(String(row.claim_expires_at)) > now) throw new InboxRequestError(409, 'capture_claimed')
  const claimSecret = base64Url(deps.randomBytes(32))
  const claimHash = await deps.hash(claimSecret)
  const result = await supabase.rpc('mt_shortcut_claim_capture', {
    p_user_id: userId, p_capture_id: String(row.id), p_claim_token_hash: byteaHex(claimHash), p_claim_device_id: deviceId.slice(0, 128), p_now: now.toISOString(),
  })
  if (result.error) throw result.error
  if (result.data !== true) throw new InboxRequestError(409, 'capture_claimed')
  const payload = await decryptRow(row, userId, deps)
  return { capture_id: String(row.id), capture: payload, claim_secret: claimSecret, claim_expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString() }
}

async function claimSecretHash(value: unknown, deps: ShortcutInboxDeps): Promise<string> {
  if (typeof value !== 'string' || !value.trim()) throw new InboxRequestError(400, 'claim_required')
  return byteaHex(await deps.hash(value.trim()))
}

export function createShortcutInboxHandler(deps: ShortcutInboxDeps): (req: Request) => Promise<Response> {
  return async req => {
    const options = handleOptions(req)
    if (options) return options
    const url = new URL(req.url)
    const parts = url.pathname.split('/').filter(Boolean)
    if (!parts.length || parts[0] !== 'shortcut-inbox') return jsonResponse({ error: 'Method not allowed' }, 405, req)
    try {
      const userId = await deps.requireUser(req)
      const supabase = deps.createAdminClient()
      if (req.method === 'GET') {
        const view = url.searchParams.get('view') || 'pending'
        const limit = pageSize(url.searchParams.get('limit'))
        const after = cursor(url.searchParams.get('cursor'))
        if (!['count', 'pending', 'dismissed'].includes(view)) throw new InboxRequestError(400, 'invalid_view')
        if (view !== 'dismissed') await reclaimExpiredClaims(supabase, userId, deps)
        let query = supabase.from('mt_shortcut_captures').select(view === 'count' ? 'id' : '*', view === 'count' ? { count: 'exact', head: true } : undefined).eq('user_id', userId).eq('status', view === 'dismissed' ? 'dismissed' : 'pending')
        if (after) query = query.or(`accepted_at.lt.${after.acceptedAt},and(accepted_at.eq.${after.acceptedAt},id.lt.${after.id})`)
        query = query.order('accepted_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
        const result = await query
        if (result.error) throw result.error
        if (view === 'count') return jsonResponse({ count: Number(result.count ?? (Array.isArray(result.data) ? result.data.length : 0)) }, 200, req)
        const rows = Array.isArray(result.data) ? result.data as CaptureRow[] : []
        const items: Record<string, unknown>[] = []
        for (const row of rows) {
          try { items.push(preview(row, await decryptRow(row, userId, deps))) } catch (error) {
            if (error instanceof InboxRequestError && error.code === 'capture_unavailable') continue
            throw error
          }
        }
        const last = rows.length === limit ? rows[rows.length - 1] : null
        return jsonResponse({ items, next_cursor: last ? `${last.accepted_at},${last.id}` : null }, 200, req)
      }
      if (req.method !== 'POST' || parts.length !== 2) return jsonResponse({ error: 'Method not allowed' }, 405, req)
      const operation = parts[1]
      const body = await parseBody(req)
      const captureId = uuid(body.capture_id)
      if (operation === 'claim') {
        const row = await rowFor(supabase, userId, captureId)
        const deviceId = typeof body.device_id === 'string' ? body.device_id.trim().slice(0, 128) : ''
        return jsonResponse(await claim(supabase, row, userId, deviceId, deps), 200, req)
      }
      if (operation === 'release') {
        const result = await supabase.rpc('mt_shortcut_release_capture', { p_user_id: userId, p_capture_id: captureId, p_claim_token_hash: await claimSecretHash(body.claim_secret, deps) })
        if (result.error) throw result.error
        if (result.data !== true) throw new InboxRequestError(409, 'claim_conflict')
        return jsonResponse({ ok: true }, 200, req)
      }
      if (operation === 'consume' || operation === 'ack') {
        const transactionId = operation === 'ack' ? `shortcut:${captureId}` : String(body.transaction_id || '')
        if (!transactionId || transactionId.length > 256) throw new InboxRequestError(400, 'transaction_required')
        const claimHash = operation === 'ack' ? null : await claimSecretHash(body.claim_secret, deps)
        const result = await supabase.rpc('mt_shortcut_consume_capture', {
          p_user_id: userId, p_capture_id: captureId, p_claim_token_hash: claimHash, p_transaction_id_hash: byteaHex(await deps.hash(transactionId)), p_retry: operation === 'ack', p_now: deps.now().toISOString(),
        })
        if (result.error) throw result.error
        return terminalResponse(result.data, req)
      }
      if (operation === 'dismiss') {
        const result = await supabase.rpc('mt_shortcut_dismiss_capture', { p_user_id: userId, p_capture_id: captureId, p_claim_token_hash: body.claim_secret ? await claimSecretHash(body.claim_secret, deps) : null, p_now: deps.now().toISOString() })
        if (result.error) throw result.error
        if (result.data === 'dismissed') return jsonResponse({ status: 'dismissed' }, 200, req)
        return terminalResponse(result.data, req)
      }
      if (operation === 'restore') {
        const result = await supabase.rpc('mt_shortcut_restore_capture', { p_user_id: userId, p_capture_id: captureId, p_now: deps.now().toISOString() })
        if (result.error) throw result.error
        if (result.data === 'restored') return jsonResponse({ status: 'pending' }, 200, req)
        throw new InboxRequestError(409, 'capture_unavailable')
      }
      return jsonResponse({ error: 'Method not allowed' }, 405, req)
    } catch (error) {
      return responseError(error, req)
    }
  }
}

if (import.meta.main) {
  const { adminClient, requireAuthenticatedUserId } = await import('../_shared/supabase.ts')
  const { decryptCapture } = await import('../_shared/shortcut_crypto.ts')
  Deno.serve(createShortcutInboxHandler({
    requireUser: requireAuthenticatedUserId,
    createAdminClient: () => adminClient() as unknown as AdminClientLike,
    loadKeyring: () => loadInboxKeyring(name => Deno.env.get(name)),
    decrypt: decryptCapture,
    hash: sha256Hex,
    randomBytes: length => crypto.getRandomValues(new Uint8Array(length)),
    now: () => new Date(),
  }))
}

