import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { decryptShortcutJson, encryptShortcutJson, loadInboxKeyring, type EncryptedCapture, type InboxKeyring } from '../_shared/shortcut_crypto.ts'
import { validateShortcutProfileRule, type ShortcutProfileRule } from '../_shared/shortcut_profile.ts'

type QueryResult = { data: unknown; error: any; count?: number | null }
type AdminClientLike = { from: (table: string) => any; rpc: (name: string, args: Record<string, unknown>) => Promise<QueryResult> }
type ProfileRow = Record<string, unknown>

export type ShortcutParserProfilesDeps = {
  requireUser: (req: Request) => Promise<string>
  createAdminClient: () => AdminClientLike
  loadKeyring: () => Promise<InboxKeyring>
  encrypt: (payload: unknown, context: { objectId: string; userId: string; objectType: 'profile_rule'; objectVersion: string }, keyring: InboxKeyring) => Promise<EncryptedCapture>
  decrypt: (record: EncryptedCapture, context: { objectId: string; userId: string; objectType: 'profile_rule'; objectVersion: string }, keyring: InboxKeyring) => Promise<unknown>
  uuid: () => string
  randomBytes: (length: number) => Uint8Array
  now: () => Date
}

class ProfileRequestError extends Error {
  status: number
  code: string
  constructor(status: number, code: string) { super(code); this.name = 'ProfileRequestError'; this.status = status; this.code = code }
}

function errorResponse(error: unknown, req: Request): Response {
  if (error instanceof ProfileRequestError) return jsonResponse({ error: error.code, code: error.code }, error.status, req)
  const status = Number(Reflect.get(error as object, 'status') || 500)
  const rawCode = String(Reflect.get(error as object, 'code') || '')
  const message = String(Reflect.get(error as object, 'message') || '')
  const code = message.includes('active_profile_limit') ? 'active_profile_limit'
    : message.includes('profile_limit') ? 'profile_limit'
    : message.includes('invalid_profile') ? 'invalid_profile'
    : message.includes('profile_conflict') || rawCode === 'P0001' ? 'profile_conflict'
    : message.includes('profile_not_found') ? 'profile_not_found'
    : message.includes('profile_code_conflict') || rawCode === '23505' ? 'profile_code_conflict'
    : status === 401 ? 'UNAUTHORIZED' : 'profile_failed'
  const mappedStatus = code === 'invalid_profile' ? 400 : ['active_profile_limit', 'profile_limit', 'profile_conflict', 'profile_code_conflict'].includes(code) ? 409 : status
  return jsonResponse({ error: code, code }, mappedStatus, req)
}

function uuid(value: unknown): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) throw new ProfileRequestError(400, 'profile_not_found')
  return result
}

function byteaHex(value: Uint8Array): string { return `\\x${Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('')}` }
function bytesFromDatabase(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return new Uint8Array(value as number[])
  if (typeof value !== 'string') throw new Error('profile_ciphertext_missing')
  const text = value.trim()
  if (/^\\x[0-9a-f]+$/i.test(text)) {
    const hex = text.slice(2); const result = new Uint8Array(hex.length / 2)
    for (let i = 0; i < result.length; i++) result[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    return result
  }
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0))
}

function text(value: unknown, max: number, required = false): string | null {
  if (value === undefined || value === null) { if (required) throw new ProfileRequestError(400, 'invalid_profile'); return null }
  if (typeof value !== 'string') throw new ProfileRequestError(400, 'invalid_profile')
  const cleaned = value.normalize('NFKC').trim()
  if ((!cleaned && required) || cleaned.length > max) throw new ProfileRequestError(400, 'invalid_profile')
  return cleaned || null
}

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProfileRequestError(400, 'invalid_json')
  return value as Record<string, unknown>
}

function rejectSamples(body: Record<string, unknown>): void {
  if (['sample', 'samples', 'raw_text', 'notification_text', 'sampleText'].some(key => key in body)) throw new ProfileRequestError(400, 'invalid_profile')
}

function compiledRule(body: Record<string, unknown>): ShortcutProfileRule {
  try { return validateShortcutProfileRule(body.compiled_rule) } catch { throw new ProfileRequestError(400, 'invalid_profile') }
}

function metadata(row: ProfileRow): Record<string, unknown> {
  return { id: row.id, short_code: row.short_code, name: row.name, app_label: row.app_label, enabled: row.enabled, disabled_at: row.disabled_at, format_version: row.format_version, profile_version: row.profile_version, created_at: row.created_at, updated_at: row.updated_at }
}

async function ownedRow(supabase: AdminClientLike, userId: string, profileId: string): Promise<ProfileRow> {
  const result = await supabase.from('mt_shortcut_parser_profiles').select('*').eq('id', profileId).eq('user_id', userId).maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw new ProfileRequestError(404, 'profile_not_found')
  return result.data as ProfileRow
}

function profileContext(id: string, userId: string, format: unknown, version: number) {
  return { objectId: id, userId, objectType: 'profile_rule' as const, objectVersion: `${Number(format)}:${version}` }
}

async function encryptRule(rule: ShortcutProfileRule, id: string, userId: string, format: number, version: number, deps: ShortcutParserProfilesDeps) {
  const keyring = await deps.loadKeyring()
  return deps.encrypt(rule, profileContext(id, userId, format, version), keyring)
}

async function createProfile(supabase: AdminClientLike, userId: string, body: Record<string, unknown>, deps: ShortcutParserProfilesDeps): Promise<Record<string, unknown>> {
  rejectSamples(body)
  const name = text(body.name, 64, true) as string
  const appLabel = text(body.app_label, 64)
  const enabled = body.enabled === undefined ? true : body.enabled
  if (typeof enabled !== 'boolean') throw new ProfileRequestError(400, 'invalid_profile')
  const rule = compiledRule(body)
  const format = rule.format_version
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = deps.uuid()
    const shortCode = Array.from(deps.randomBytes(6), value => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[value % 32]).join('')
    const encrypted = await encryptRule(rule, id, userId, format, 1, deps)
    const result = await supabase.rpc('mt_shortcut_create_profile', { p_user_id: userId, p_profile_id: id, p_short_code: shortCode, p_name: name, p_app_label: appLabel, p_enabled: enabled, p_format_version: format, p_rule_ciphertext: byteaHex(encrypted.ciphertext), p_rule_iv: byteaHex(encrypted.iv), p_rule_encryption_key_version: encrypted.keyVersion, p_now: deps.now().toISOString() })
    if (!result.error) return { ...(metadata({ id, short_code: shortCode, name, app_label: appLabel, enabled, disabled_at: enabled ? null : deps.now().toISOString(), format_version: format, profile_version: 1, created_at: deps.now().toISOString(), updated_at: deps.now().toISOString() })), compiled_rule: rule }
    if (String(result.error.code || '') !== '23505' && !String(result.error.message || '').includes('profile_code_conflict')) throw result.error
  }
  throw new ProfileRequestError(409, 'profile_code_conflict')
}

async function updateProfile(supabase: AdminClientLike, userId: string, profileId: string, body: Record<string, unknown>, deps: ShortcutParserProfilesDeps, archive = false): Promise<Record<string, unknown>> {
  rejectSamples(body)
  const row = await ownedRow(supabase, userId, profileId)
  const expected = Number(body.expected_version)
  if (!Number.isInteger(expected) || expected !== Number(row.profile_version)) throw new ProfileRequestError(409, 'profile_conflict')
  const name = archive ? String(row.name) : text(body.name, 64, true) as string
  const appLabel = archive ? (row.app_label === null ? null : String(row.app_label)) : text(body.app_label, 64)
  const enabled = archive ? false : body.enabled
  if (typeof enabled !== 'boolean') throw new ProfileRequestError(400, 'invalid_profile')
  const format = Number(row.format_version)
  const rule = archive ? await decryptRule(row, userId, deps) : compiledRule(body)
  const encrypted = archive ? { ciphertext: bytesFromDatabase(row.rule_ciphertext), iv: bytesFromDatabase(row.rule_iv), keyVersion: Number(row.rule_encryption_key_version) } : await encryptRule(rule, profileId, userId, format, expected + 1, deps)
  const result = await supabase.rpc('mt_shortcut_update_profile', { p_user_id: userId, p_profile_id: profileId, p_expected_version: expected, p_name: name, p_app_label: appLabel, p_enabled: enabled, p_format_version: format, p_rule_ciphertext: byteaHex(encrypted.ciphertext), p_rule_iv: byteaHex(encrypted.iv), p_rule_encryption_key_version: encrypted.keyVersion, p_now: deps.now().toISOString() })
  if (result.error) throw result.error
  return { ...metadata({ ...row, name, app_label: appLabel, enabled, disabled_at: enabled ? null : row.disabled_at || deps.now().toISOString(), profile_version: Number(result.data || expected + 1), updated_at: deps.now().toISOString() }) }
}

async function decryptRule(row: ProfileRow, userId: string, deps: ShortcutParserProfilesDeps): Promise<ShortcutProfileRule> {
  try {
    const keyring = await deps.loadKeyring()
    return validateShortcutProfileRule(await deps.decrypt({ ciphertext: bytesFromDatabase(row.rule_ciphertext), iv: bytesFromDatabase(row.rule_iv), keyVersion: Number(row.rule_encryption_key_version) }, profileContext(String(row.id), userId, row.format_version, Number(row.profile_version)), keyring))
  } catch { throw new ProfileRequestError(503, 'profile_unavailable') }
}

export function createShortcutParserProfilesHandler(deps: ShortcutParserProfilesDeps): (req: Request) => Promise<Response> {
  return async req => {
    const options = handleOptions(req); if (options) return options
    const url = new URL(req.url); const parts = url.pathname.split('/').filter(Boolean)
    if (!parts.length || parts[0] !== 'shortcut-parser-profiles') return jsonResponse({ error: 'Method not allowed' }, 405, req)
    try {
      const userId = await deps.requireUser(req)
      const supabase = deps.createAdminClient()
      if (req.method === 'GET' && parts.length === 1) {
        const result = await supabase.from('mt_shortcut_parser_profiles').select('id,short_code,name,app_label,enabled,disabled_at,format_version,profile_version,created_at,updated_at').eq('user_id', userId).order('updated_at', { ascending: false })
        if (result.error) throw result.error
        return jsonResponse({ profiles: (Array.isArray(result.data) ? result.data : []).map(metadata) }, 200, req)
      }
      const profileId = parts.length >= 2 ? uuid(parts[1]) : ''
      if (req.method === 'GET' && parts.length === 2) {
        const row = await ownedRow(supabase, userId, profileId)
        return jsonResponse({ profile: { ...metadata(row), compiled_rule: await decryptRule(row, userId, deps) } }, 200, req)
      }
      if (req.method !== 'POST' && req.method !== 'PUT') return jsonResponse({ error: 'Method not allowed' }, 405, req)
      let body: Record<string, unknown>; try { body = bodyObject(await req.json()) } catch (error) { if (error instanceof ProfileRequestError) throw error; throw new ProfileRequestError(400, 'invalid_json') }
      if (parts.length === 3 && parts[2] === 'archive' && req.method === 'POST') return jsonResponse({ profile: await updateProfile(supabase, userId, profileId, body, deps, true) }, 200, req)
      if (parts.length === 2 && req.method === 'POST' && body.archive === true) return jsonResponse({ profile: await updateProfile(supabase, userId, profileId, body, deps, true) }, 200, req)
      if (parts.length === 1 && req.method === 'POST') return jsonResponse({ profile: await createProfile(supabase, userId, body, deps) }, 201, req)
      if (parts.length === 2 && req.method === 'PUT') return jsonResponse({ profile: await updateProfile(supabase, userId, profileId, body, deps) }, 200, req)
      return jsonResponse({ error: 'Method not allowed' }, 405, req)
    } catch (error) { return errorResponse(error, req) }
  }
}

if (import.meta.main) {
  const { adminClient, requireAuthenticatedUserId } = await import('../_shared/supabase.ts')
  Deno.serve(createShortcutParserProfilesHandler({
    requireUser: requireAuthenticatedUserId,
    createAdminClient: () => adminClient() as unknown as AdminClientLike,
    loadKeyring: () => loadInboxKeyring(name => Deno.env.get(name)),
    encrypt: encryptShortcutJson,
    decrypt: decryptShortcutJson,
    uuid: () => crypto.randomUUID(),
    randomBytes: length => crypto.getRandomValues(new Uint8Array(length)),
    now: () => new Date(),
  }))
}
