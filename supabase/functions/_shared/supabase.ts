import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

export function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
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
