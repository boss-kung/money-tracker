import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { generateDeviceToken, tokenVerifier, type DeviceToken } from '../_shared/shortcut_crypto.ts'

type QueryResult = { data: unknown; error: unknown }
type AdminClientLike = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<QueryResult>
  from: (table: string) => any
}

export type ManageShortcutTokenDeps = {
  requireUser: (req: Request) => Promise<string>
  createAdminClient: () => AdminClientLike
  generateToken: () => DeviceToken
  makeVerifier: (secret: string, pepper: string) => Promise<Uint8Array>
  getEnv: (name: string) => string | undefined
  now: () => Date
}

class TokenRequestError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message = code) {
    super(message)
    this.name = 'TokenRequestError'
    this.status = status
    this.code = code
  }
}

function errorResponse(error: unknown, req: Request): Response {
  const status = typeof Reflect.get(error as object, 'status') === 'number'
    ? Number(Reflect.get(error as object, 'status'))
    : 500
  const body = {
    error: error instanceof Error ? error.message : String(error),
    ...(typeof Reflect.get(error as object, 'code') === 'string'
      ? { code: String(Reflect.get(error as object, 'code')) }
      : {}),
  }
  return jsonResponse(body, status || 500, req)
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function parseLabel(value: unknown): string {
  if (typeof value !== 'string') throw new TokenRequestError(400, 'invalid_label')
  const label = value.normalize('NFKC').trim()
  if (!label || Array.from(label).length > 64) throw new TokenRequestError(400, 'invalid_label')
  return label
}

function mapCreateError(error: unknown): never {
  const code = String(Reflect.get(error as object, 'code') || '')
  const message = String(Reflect.get(error as object, 'message') || '')
  if (code === 'P0001' || message.includes('active_token_limit')) {
    throw new TokenRequestError(409, 'active_token_limit')
  }
  if (message.includes('invalid_token_label')) throw new TokenRequestError(400, 'invalid_label')
  throw error
}

async function listTokens(supabase: AdminClientLike, userId: string): Promise<Record<string, unknown>[]> {
  const result = await supabase
    .from('mt_shortcut_tokens')
    .select('id,label,secret_prefix,created_at,last_used_at,revoked_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (result.error) throw result.error
  const rows = Array.isArray(result.data) ? result.data : []
  return rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    label: String(row.label),
    secret_prefix: String(row.secret_prefix),
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
  }))
}

async function createToken(supabase: AdminClientLike, userId: string, label: string, deps: ManageShortcutTokenDeps) {
  const generated = deps.generateToken()
  const pepper = deps.getEnv('MT_SHORTCUT_TOKEN_PEPPER_V1')
  if (!pepper || pepper.length < 16) throw new Error('MT_SHORTCUT_TOKEN_PEPPER_V1 is not configured')
  const verifier = await deps.makeVerifier(generated.secret, pepper)
  const { data, error } = await supabase.rpc('mt_shortcut_create_token', {
    p_user_id: userId,
    p_token_id: generated.tokenId,
    p_label: label,
    p_secret_verifier: verifier,
    p_secret_prefix: generated.secretPrefix,
  })
  if (error) mapCreateError(error)
  return { id: String(data), label, token: generated.token }
}

async function revokeToken(supabase: AdminClientLike, userId: string, tokenId: string, now: Date) {
  if (!isUuid(tokenId)) throw new TokenRequestError(400, 'invalid_token_id')
  const { error } = await supabase
    .from('mt_shortcut_tokens')
    .update({ revoked_at: now.toISOString() })
    .eq('id', tokenId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle()
  if (error) throw error
  return { ok: true }
}

export function createManageShortcutTokensHandler(deps: ManageShortcutTokenDeps): (req: Request) => Promise<Response> {
  return async req => {
    const options = handleOptions(req)
    if (options) return options
    const url = new URL(req.url)
    const parts = url.pathname.split('/').filter(Boolean)
    const base = parts.length === 1 && parts[0] === 'manage-shortcut-tokens'
    const revoke = parts.length === 3 && parts[0] === 'manage-shortcut-tokens' && parts[2] === 'revoke'
    if ((!base && !revoke) || (base && !['GET', 'POST'].includes(req.method)) || (revoke && req.method !== 'POST')) {
      return jsonResponse({ error: 'Method not allowed' }, 405, req)
    }

    try {
      // Resolve identity before constructing the privileged client on every route.
      const userId = await deps.requireUser(req)
      const supabase = deps.createAdminClient()
      if (revoke) {
        return jsonResponse(await revokeToken(supabase, userId, parts[1], deps.now()), 200, req)
      }
      if (req.method === 'GET') {
        return jsonResponse({ tokens: await listTokens(supabase, userId) }, 200, req)
      }
      let body: unknown
      try { body = await req.json() } catch { throw new TokenRequestError(400, 'invalid_json') }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TokenRequestError(400, 'invalid_json')
      const label = parseLabel(Reflect.get(body, 'label'))
      return jsonResponse(await createToken(supabase, userId, label, deps), 201, req)
    } catch (error) {
      return errorResponse(error, req)
    }
  }
}

if (import.meta.main) {
  const { adminClient, requireAuthenticatedUserId } = await import('../_shared/supabase.ts')
  Deno.serve(createManageShortcutTokensHandler({
    requireUser: requireAuthenticatedUserId,
    createAdminClient: () => adminClient() as unknown as AdminClientLike,
    generateToken: generateDeviceToken,
    makeVerifier: tokenVerifier,
    getEnv: name => Deno.env.get(name),
    now: () => new Date(),
  }))
}

