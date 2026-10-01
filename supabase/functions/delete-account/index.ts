import { adminClient, getAuthenticatedUserId } from '../_shared/supabase.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'

async function hashOtp(otp: string, userId: string): Promise<string> {
  const data = new TextEncoder().encode(`${otp}:${userId}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async req => {
  const options = handleOptions(req)
  if (options) return options
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, req)

  try {
    const userId = await getAuthenticatedUserId(req)
    if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401, req)

    const body = await req.json().catch(() => ({})) as { otp?: string }
    const otp = String(body?.otp || '').replace(/\D/g, '')
    if (!/^\d{6}$/.test(otp)) return jsonResponse({ error: 'A 6-digit deletion OTP is required' }, 400, req)

    const admin = adminClient()
    const { data: otpRow, error: otpError } = await admin
      .from('mt_delete_otps')
      .select('otp_hash, expires_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (otpError) throw otpError
    const expectedHash = await hashOtp(otp, userId)
    const valid = otpRow
      && String(otpRow.otp_hash || '') === expectedHash
      && new Date(String(otpRow.expires_at || '')).getTime() > Date.now()
    if (!valid) return jsonResponse({ error: 'Invalid or expired deletion OTP' }, 401, req)

    // Consume the OTP before the destructive operation so it is one-time even if
    // the client retries after a network timeout.
    const { data: consumedRows, error: consumeError } = await admin
      .from('mt_delete_otps')
      .delete()
      .eq('user_id', userId)
      .eq('otp_hash', expectedHash)
      .select('user_id')
    if (consumeError) throw consumeError
    if (!Array.isArray(consumedRows) || consumedRows.length !== 1) {
      return jsonResponse({ error: 'Invalid or expired deletion OTP' }, 401, req)
    }

    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) throw error

    return jsonResponse({ ok: true }, 200, req)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500, req)
  }
})
