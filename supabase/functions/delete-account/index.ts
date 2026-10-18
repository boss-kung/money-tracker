import { adminClient, getAuthenticatedUserId } from '../_shared/supabase.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'
import { consumeDeleteOtp, hashDeleteOtp } from '../_shared/delete_otp.ts'

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
    const expectedHash = await hashDeleteOtp(otp, userId)
    const valid = await consumeDeleteOtp(admin, { userId, otpHash: expectedHash })
    if (!valid) {
      return jsonResponse({ error: 'Invalid or expired deletion OTP' }, 401, req)
    }

    // Keep account deletion explicit even after the database cascade is live.
    // This makes cleanup observable and protects deployments where migrations
    // are applied in stages.
    for (const table of [
      'mt_notification_logs',
      'mt_notification_rules',
      'mt_notification_snapshots',
      'mt_notification_preferences',
      'mt_notification_devices',
      'mt_user_vaults',
      'mt_delete_otps',
    ]) {
      const { error: cleanupError } = await admin
        .from(table)
        .delete()
        .eq('user_id', userId)
      if (cleanupError) throw cleanupError
    }

    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) throw error

    return jsonResponse({ ok: true }, 200, req)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500, req)
  }
})
