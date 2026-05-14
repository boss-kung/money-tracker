import { adminClient } from '../_shared/supabase.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'

Deno.serve(async req => {
  const options = handleOptions(req)
  if (options) return options
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json()
    const installId = String(body.installId || '').trim()
    const fcmToken = String(body.fcmToken || '').trim()
    if (!installId || !fcmToken) return jsonResponse({ error: 'installId and fcmToken are required' }, 400)

    const supabase = adminClient()
    const device = {
      install_id: installId,
      fcm_token: fcmToken,
      platform: String(body.platform || 'unknown').slice(0, 64),
      browser: String(body.browser || 'unknown').slice(0, 64),
      timezone: String(body.timezone || 'Asia/Bangkok').slice(0, 64),
      permission: String(body.permission || 'granted').slice(0, 32),
      enabled: body.enabled !== false,
      app_version: body.appVersion ? String(body.appVersion).slice(0, 80) : null,
      user_agent: body.userAgent ? String(body.userAgent).slice(0, 512) : null,
      last_seen_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('mt_notification_devices')
      .upsert(device, { onConflict: 'fcm_token' })
    if (error) throw error

    await supabase
      .from('mt_notification_preferences')
      .upsert({
        install_id: installId,
        daily_expense_enabled: false,
        timezone: device.timezone,
        hide_amounts_in_notification: Boolean(body.hideAmounts),
      }, { onConflict: 'install_id', ignoreDuplicates: false })

    return jsonResponse({ ok: true })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
