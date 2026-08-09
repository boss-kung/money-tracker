import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

export function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export class RequestAuthError extends Error {
  status: number

  constructor(message: string, status = 401) {
    super(message)
    this.name = 'RequestAuthError'
    this.status = status
  }
}

// Verifies the Bearer token from the request Authorization header.
// Returns the authenticated user's ID, or null for anonymous / invalid tokens.
// Edge functions should use this instead of trusting body.userId from the client.
export async function getAuthenticatedUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) return null
  try {
    const { data: { user } } = await createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}

export async function requireAuthenticatedUserId(req: Request): Promise<string> {
  const userId = await getAuthenticatedUserId(req)
  if (!userId) throw new RequestAuthError('Unauthorized', 401)
  return userId
}

export function requireCronSecret(req: Request): void {
  const expected = Deno.env.get('MT_NOTIFICATION_CRON_SECRET')
  const supplied = req.headers.get('x-mt-cron-secret')
  if (!expected || expected.length < 16) {
    throw new Error('MT_NOTIFICATION_CRON_SECRET is not configured')
  }
  if (!supplied || supplied !== expected) throw new RequestAuthError('Unauthorized', 401)
}

export async function requireInstallOwnership(
  supabase: ReturnType<typeof adminClient>,
  installId: string,
  userId: string,
  options: { allowUnregistered?: boolean; allowClaimAnonymous?: boolean } = {},
): Promise<void> {
  const { data, error } = await supabase
    .from('mt_notification_devices')
    .select('user_id')
    .eq('install_id', installId)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    if (options.allowUnregistered) return
    throw new RequestAuthError('Notification device is not registered', 403)
  }
  if (data.user_id === userId) return
  if (data.user_id === null && options.allowClaimAnonymous) return
  throw new RequestAuthError('Notification device belongs to another user', 403)
}

export function requestErrorStatus(error: unknown): number {
  return error instanceof RequestAuthError ? error.status : 500
}
