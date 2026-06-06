import { adminClient, getAuthenticatedUserId } from '../_shared/supabase.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'

const VAULT_TABLE = 'mt_user_vaults'
const OTP_TABLE   = 'mt_delete_otps'

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

    // Require OTP in request body
    const body = await req.json().catch(() => ({})) as Record<string, string>
    const otp = String(body.otp ?? '').trim()
    if (!otp) return jsonResponse({ error: 'otp is required' }, 400, req)

    const supabase = adminClient()

    // Verify OTP
    const { data: row, error: otpErr } = await supabase
      .from(OTP_TABLE)
      .select('otp_hash, expires_at')
      .eq('user_id', userId)
      .single()

    if (otpErr || !row) return jsonResponse({ error: 'รหัส OTP ไม่ถูกต้องหรือหมดอายุ' }, 400, req)
    if (new Date(row.expires_at) < new Date()) {
      await supabase.from(OTP_TABLE).delete().eq('user_id', userId)
      return jsonResponse({ error: 'รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่' }, 400, req)
    }

    const expectedHash = await hashOtp(otp, userId)
    if (expectedHash !== row.otp_hash) return jsonResponse({ error: 'รหัส OTP ไม่ถูกต้อง' }, 400, req)

    // OTP valid — delete it immediately (single-use)
    await supabase.from(OTP_TABLE).delete().eq('user_id', userId)

    // Delete vault data
    await supabase.from(VAULT_TABLE).delete().eq('user_id', userId)

    // Delete auth user
    const { error: deleteErr } = await supabase.auth.admin.deleteUser(userId)
    if (deleteErr) throw deleteErr

    return jsonResponse({ ok: true }, 200, req)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500, req)
  }
})
