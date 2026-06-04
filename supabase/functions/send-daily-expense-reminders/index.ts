import { adminClient } from '../_shared/supabase.ts'
import { sendWebPush } from '../_shared/webpush.ts'
import type { WebPushSubscription } from '../_shared/webpush.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'

type DeviceRow = {
  install_id: string
  push_subscription: WebPushSubscription | null
}

type PreferenceRow = {
  install_id: string
  daily_expense_enabled: boolean
}

function bangkokDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (type: string) => parts.find(part => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

Deno.serve(async req => {
  const options = handleOptions(req)
  if (options) return options
  if (!['GET', 'POST'].includes(req.method)) return jsonResponse({ error: 'Method not allowed' }, 405)

  const supabase = adminClient()
  const today = bangkokDate()
  const dedupeKey = `daily-expense:${today}`

  try {
    const { data: devices, error } = await supabase
      .from('mt_notification_devices')
      .select('install_id, push_subscription, enabled, permission')
      .eq('enabled', true)
      .eq('permission', 'granted')
    if (error) throw error

    const deviceRows = (devices || []) as DeviceRow[]
    const installIds = [...new Set(deviceRows.map(device => String(device.install_id)))]
    const { data: prefsRows, error: prefsError } = installIds.length
      ? await supabase
        .from('mt_notification_preferences')
        .select('install_id, daily_expense_enabled')
        .in('install_id', installIds)
      : { data: [], error: null }
    if (prefsError) throw prefsError

    const prefsByInstallId = new Map((prefsRows || []).map(row => [String(row.install_id), row as PreferenceRow]))

    let sent = 0
    let skipped = 0
    const failures: Array<{ installId: string; error: string }> = []

    for (const device of deviceRows) {
      const installId = String(device.install_id)

      if (!device.push_subscription?.endpoint) {
        skipped++
        continue
      }

      const prefs = prefsByInstallId.get(installId)
      if (prefs?.daily_expense_enabled !== true) {
        skipped++
        continue
      }

      const { data: existing } = await supabase
        .from('mt_notification_logs')
        .select('id, status')
        .eq('install_id', installId)
        .eq('notification_type', 'daily_expense')
        .eq('dedupe_key', dedupeKey)
        .maybeSingle()
      if (existing?.status === 'sent') {
        skipped++
        continue
      }

      const title = 'อย่าลืมจดรายจ่ายวันนี้'
      const body = 'เปิดแอปเพื่อบันทึกหรือทบทวนรายการของคุณ'

      try {
        await sendWebPush(device.push_subscription, {
          title,
          body,
          icon: './assets/icon.svg',
          badge: './assets/icon.svg',
          tag: dedupeKey,
          data: { type: 'daily_expense', route: 'addTx', date: today },
          actions: [
            { action: 'addTx', title: 'เพิ่มรายจ่าย' },
            { action: 'open', title: 'เปิดแอป' },
          ],
        })

        await supabase.from('mt_notification_logs').upsert({
          install_id: installId,
          notification_type: 'daily_expense',
          dedupe_key: dedupeKey,
          title,
          body,
          status: 'sent',
          fcm_message_id: null,
          error: null,
        }, { onConflict: 'install_id,notification_type,dedupe_key' })
        sent++
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : String(sendError)
        failures.push({ installId, error: message })
        await supabase.from('mt_notification_logs').upsert({
          install_id: installId,
          notification_type: 'daily_expense',
          dedupe_key: dedupeKey,
          title,
          body,
          status: 'error',
          error: message,
        }, { onConflict: 'install_id,notification_type,dedupe_key' })
      }
    }

    return jsonResponse({ ok: true, date: today, sent, skipped, failures })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : JSON.stringify(error) }, 500)
  }
})
