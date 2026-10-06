import { adminClient, requestErrorStatus, requireCronSecret } from '../_shared/supabase.ts'
import { claimDailyNotification } from '../_shared/notification_daily_claim.ts'
import { deliverClaimedNotification } from '../_shared/notification_delivery.ts'
import { sendWebPush } from '../_shared/webpush.ts'
import type { WebPushSubscription } from '../_shared/webpush.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'

type DeviceRow = {
  install_id: string
  user_id: string
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
  if (!['GET', 'POST'].includes(req.method)) return jsonResponse({ error: 'Method not allowed' }, 405, req)

  try {
    requireCronSecret(req)
    const supabase = adminClient()
    const today = bangkokDate()
    const dedupeKey = `daily-expense:${today}`
    const { data: devices, error } = await supabase
      .from('mt_notification_devices')
      .select('install_id, user_id, push_subscription, enabled, permission')
      .eq('enabled', true)
      .eq('permission', 'granted')
      .not('user_id', 'is', null)
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
      const pushSubscription = device.push_subscription

      const prefs = prefsByInstallId.get(installId)
      if (prefs?.daily_expense_enabled !== true) {
        skipped++
        continue
      }

      const title = 'อย่าลืมจดรายจ่ายวันนี้'
      const body = 'เปิดแอปเพื่อบันทึกหรือทบทวนรายการของคุณ'
      const delivery = await deliverClaimedNotification({
        logStore: {
          claim: () => claimDailyNotification(supabase, {
            installId,
            userId: device.user_id,
            dedupeKey,
            title,
            body,
          }),
          finish: async (token, status, errorMessage) => {
            const { data, error: finishError } = await supabase
              .from('mt_notification_logs')
              .update({ status, error: errorMessage || null, sent_at: new Date().toISOString(), lease_until: null })
              .eq('install_id', installId)
              .eq('user_id', device.user_id)
              .eq('notification_type', 'daily_expense')
              .eq('dedupe_key', dedupeKey)
              .eq('lease_token', token)
              .select('id')
            if (finishError) throw finishError
            if (!data?.length) throw new Error('Daily notification claim was superseded')
          },
        },
        transport: () => sendWebPush(pushSubscription, {
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
        }),
        isStillCurrent: async () => true,
      })
      if (delivery.sent) sent++
      else if (delivery.reason === 'already-claimed') skipped++
      else failures.push({ installId, error: delivery.reason })
    }

    return jsonResponse({ ok: true, date: today, sent, skipped, failures }, 200, req)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : JSON.stringify(error) }, requestErrorStatus(error), req)
  }
})
