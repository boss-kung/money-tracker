import { adminClient } from '../_shared/supabase.ts'
import { sendFcm } from '../_shared/fcm.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'

const APP_LINK = Deno.env.get('MT_APP_LINK') || '/'

type DeviceRow = {
  install_id: string
  fcm_token: string
}

type PreferenceRow = {
  install_id: string
  daily_expense_enabled: boolean
}

type SnapshotRow = {
  install_id: string
  today_tx_count: number
  snapshot_date: string
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

function appLink(pathAndHash: string) {
  try {
    const base = new URL(APP_LINK)
    return new URL(pathAndHash, base).href
  } catch (_) {
    return undefined
  }
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
      .select('install_id, fcm_token, enabled, permission')
      .eq('enabled', true)
      .eq('permission', 'granted')
    if (error) throw error

    const deviceRows = (devices || []) as DeviceRow[]
    const installIds = [...new Set(deviceRows.map(device => String(device.install_id)))]
    const { data: prefsRows, error: prefsError } = installIds.length
      ? await supabase
        .from('mt_notification_preferences')
        .select('install_id, daily_expense_enabled, hide_amounts_in_notification')
        .in('install_id', installIds)
      : { data: [], error: null }
    if (prefsError) throw prefsError

    const { data: snapshotRows, error: snapshotError } = installIds.length
      ? await supabase
        .from('mt_notification_snapshots')
        .select('install_id, today_tx_count, snapshot_date')
        .in('install_id', installIds)
      : { data: [], error: null }
    if (snapshotError) throw snapshotError

    const prefsByInstallId = new Map((prefsRows || []).map(row => [String(row.install_id), row as PreferenceRow]))
    const snapshotByInstallId = new Map((snapshotRows || []).map(row => [String(row.install_id), row as SnapshotRow]))

    let sent = 0
    let skipped = 0
    const failures: Array<{ installId: string; error: string }> = []

    for (const device of deviceRows) {
      const installId = String(device.install_id)
      const prefs = prefsByInstallId.get(installId)
      if (prefs?.daily_expense_enabled === false) {
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

      const snapshot = snapshotByInstallId.get(installId)
      const count = snapshot?.snapshot_date === today ? Number(snapshot.today_tx_count || 0) : 0
      const title = count > 0 ? 'เช็กวันนี้อีกนิด' : 'อย่าลืมจดรายจ่ายวันนี้'
      const body = count > 0
        ? `วันนี้มีบันทึกแล้ว ${count} รายการ มีอะไรตกหล่นไหม?`
        : 'ใช้เวลาแป๊บเดียว แล้วรายงานเดือนนี้จะแม่นขึ้น'

      try {
        const link = appLink('index.html#dashboard?open=addTx')
        const result = await sendFcm({
          token: String(device.fcm_token),
          notification: { title, body },
          data: {
            type: 'daily_expense',
            route: 'addTx',
            date: today,
          },
          webpush: {
            ...(link ? { fcm_options: { link } } : {}),
            notification: {
              icon: '/assets/icon.svg',
              badge: '/assets/icon.svg',
              tag: dedupeKey,
              renotify: false,
              actions: [
                { action: 'addTx', title: 'เพิ่มรายจ่าย' },
                { action: 'open', title: 'เปิดแอป' },
              ],
            },
          },
        })

        await supabase.from('mt_notification_logs').upsert({
          install_id: installId,
          notification_type: 'daily_expense',
          dedupe_key: dedupeKey,
          title,
          body,
          status: 'sent',
          fcm_message_id: result?.name || null,
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
