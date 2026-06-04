import { adminClient, getAuthenticatedUserId } from '../_shared/supabase.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'

type WebPushSubscription = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

Deno.serve(async req => {
  const options = handleOptions(req)
  if (options) return options
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, req)

  try {
    const body = await req.json()
    const installId = String(body.installId || '').trim()
    if (!installId) return jsonResponse({ error: 'installId is required' }, 400, req)

    const pushSubscription = body.pushSubscription as WebPushSubscription | null
    if (body.enabled !== false && (!pushSubscription?.endpoint || !pushSubscription?.keys?.p256dh)) {
      return jsonResponse({ error: 'pushSubscription is required when enabling notifications' }, 400, req)
    }

    const userId = await getAuthenticatedUserId(req)
    const supabase = adminClient()
    const device = {
      install_id: installId,
      user_id: userId,
      push_subscription: pushSubscription ?? null,
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
      .upsert(device, { onConflict: 'install_id' })
    if (error) throw error

    await supabase
      .from('mt_notification_preferences')
      .upsert({
        install_id: installId,
        user_id: userId,
        daily_expense_enabled: true,
        timezone: device.timezone,
        hide_amounts_in_notification: Boolean(body.hideAmounts),
      }, { onConflict: 'install_id', ignoreDuplicates: false })

    return jsonResponse({ ok: true }, 200, req)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500, req)
  }
})
