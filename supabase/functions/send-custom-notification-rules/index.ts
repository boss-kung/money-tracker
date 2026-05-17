import { adminClient } from '../_shared/supabase.ts'
import { sendWebPush } from '../_shared/webpush.ts'
import type { WebPushSubscription } from '../_shared/webpush.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'

const WINDOW_MINUTES = 15

type DeviceRow = { install_id: string; push_subscription: WebPushSubscription | null }
type RuleRow = {
  install_id: string
  rule_id: string
  title: string
  body: string
  route: string
  action_label: string
  trigger_type: string
  trigger_config: Record<string, unknown>
}
type SnapshotRow = {
  install_id: string
  snapshot_date: string
  today_tx_count: number
  last_tx_date: string | null
  upcoming_bills: Array<Record<string, unknown>>
  credit_due: Array<Record<string, unknown>>
  budget_alerts: Array<{ pct: number; over: boolean; categoryId: string; label: string }>
  recurring_due: Array<Record<string, unknown>>
  privileges_expiring: Array<{ id: string; daysLeft: number }>
  last_exported_at: string | null
}

function bangkokParts() {
  const OFFSET_MS = 7 * 60 * 60 * 1000
  const bkk = new Date(Date.now() + OFFSET_MS)
  const iso = bkk.toISOString()
  const date = iso.slice(0, 10)
  const hour = Number(iso.slice(11, 13))
  const minute = Number(iso.slice(14, 16))
  const day = Number(iso.slice(8, 10))
  const weekdayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const weekday = weekdayNames[bkk.getUTCDay()]
  return { date, weekday, minutes: hour * 60 + minute, dayOfMonth: day }
}

function minutesOf(time: unknown) {
  const match = String(time || '').match(/^(\d{2}):(\d{2})$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

function isInCurrentWindow(ruleMinutes: number | null, nowMinutes: number) {
  if (ruleMinutes === null) return false
  const delta = nowMinutes - ruleMinutes
  return delta >= 0 && delta < WINDOW_MINUTES
}

function daysSince(dateIso: string | null, today: string) {
  if (!dateIso) return Number.POSITIVE_INFINITY
  const date = new Date(dateIso)
  const ref = new Date(`${today}T00:00:00+07:00`)
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY
  return Math.floor((ref.getTime() - date.getTime()) / 86400000)
}

function shouldSend(rule: RuleRow, snapshot: SnapshotRow | undefined, now = bangkokParts()) {
  const config = rule.trigger_config || {}
  const time = minutesOf(config.time || '09:00')
  const todayDedupe = `custom-rule:${rule.rule_id}:${now.date}`

  if (rule.trigger_type === 'daily_time') {
    return isInCurrentWindow(time, now.minutes) ? todayDedupe : ''
  }
  if (rule.trigger_type === 'weekly_time') {
    const days = Array.isArray(config.weekdays) ? config.weekdays.map(String) : []
    return days.includes(now.weekday) && isInCurrentWindow(time, now.minutes) ? todayDedupe : ''
  }
  if (rule.trigger_type === 'one_time') {
    return config.date === now.date && isInCurrentWindow(time, now.minutes)
      ? `custom-rule:${rule.rule_id}:once:${now.date}`
      : ''
  }
  if (rule.trigger_type === 'no_transaction_today') {
    if (!isInCurrentWindow(time, now.minutes)) return ''
    return Number(snapshot?.today_tx_count || 0) === 0 ? todayDedupe : ''
  }
  if (rule.trigger_type === 'upcoming_bill_due') {
    const daysBefore = Number(config.daysBefore ?? 1)
    const hasMatch = (snapshot?.upcoming_bills || []).some(item => Number(item.daysLeft) === daysBefore)
    return hasMatch ? `custom-rule:${rule.rule_id}:bill:${now.date}:${daysBefore}` : ''
  }
  if (rule.trigger_type === 'credit_card_due') {
    const daysBefore = Number(config.daysBefore ?? 1)
    const hasMatch = (snapshot?.credit_due || []).some(item => Number(item.daysLeft) === daysBefore)
    return hasMatch ? `custom-rule:${rule.rule_id}:credit:${now.date}:${daysBefore}` : ''
  }
  if (rule.trigger_type === 'backup_stale') {
    const staleDays = Math.max(1, Number(config.staleDays || 30))
    return daysSince(snapshot?.last_exported_at || null, now.date) >= staleDays
      ? `custom-rule:${rule.rule_id}:backup:${now.date}:${staleDays}`
      : ''
  }
  if (rule.trigger_type === 'monthly_time') {
    const dayOfMonth = Math.min(28, Math.max(1, Number(config.dayOfMonth || 1)))
    return now.dayOfMonth === dayOfMonth && isInCurrentWindow(time, now.minutes)
      ? `custom-rule:${rule.rule_id}:monthly:${now.date.slice(0, 7)}:${dayOfMonth}`
      : ''
  }
  if (rule.trigger_type === 'weekday_only_time') {
    const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri']
    return weekdays.includes(now.weekday) && isInCurrentWindow(time, now.minutes) ? todayDedupe : ''
  }
  if (rule.trigger_type === 'no_tx_streak') {
    const streakDays = Math.max(1, Number(config.streakDays || 3))
    return daysSince(snapshot?.last_tx_date || null, now.date) >= streakDays && isInCurrentWindow(time, now.minutes)
      ? `custom-rule:${rule.rule_id}:streak:${now.date}:${streakDays}`
      : ''
  }
  if (rule.trigger_type === 'budget_over') {
    const threshold = Math.max(1, Number(config.threshold || 90))
    const budgetAlerts = (snapshot?.budget_alerts || []) as Array<{ pct: number }>
    const hasMatch = budgetAlerts.some(b => Number(b.pct || 0) >= threshold)
    return hasMatch && isInCurrentWindow(time, now.minutes)
      ? `custom-rule:${rule.rule_id}:budget:${now.date.slice(0, 7)}:${threshold}`
      : ''
  }
  if (rule.trigger_type === 'recurring_due_today') {
    const hasDue = (snapshot?.recurring_due || []).length > 0
    return hasDue && isInCurrentWindow(time, now.minutes)
      ? `custom-rule:${rule.rule_id}:recurring:${now.date}`
      : ''
  }
  if (rule.trigger_type === 'privilege_expiry') {
    const daysBefore = Number(config.daysBefore ?? 3)
    const hasMatch = (snapshot?.privileges_expiring || []).some(p => Number(p.daysLeft) === daysBefore)
    return hasMatch ? `custom-rule:${rule.rule_id}:priv:${now.date}:${daysBefore}` : ''
  }
  return ''
}

Deno.serve(async req => {
  const options = handleOptions(req)
  if (options) return options
  if (!['GET', 'POST'].includes(req.method)) return jsonResponse({ error: 'Method not allowed' }, 405)

  const supabase = adminClient()

  try {
    const { data: devices, error: devicesError } = await supabase
      .from('mt_notification_devices')
      .select('install_id, push_subscription')
      .eq('enabled', true)
      .eq('permission', 'granted')
    if (devicesError) throw devicesError

    const deviceRows = (devices || []) as DeviceRow[]
    const installIds = [...new Set(
      deviceRows
        .filter(d => d.push_subscription?.endpoint)
        .map(device => String(device.install_id))
    )]
    if (!installIds.length) return jsonResponse({ ok: true, sent: 0, skipped: 0, failures: [] })

    const { data: rules, error: rulesError } = await supabase
      .from('mt_notification_rules')
      .select('install_id, rule_id, title, body, route, action_label, trigger_type, trigger_config')
      .eq('enabled', true)
      .in('install_id', installIds)
    if (rulesError) throw rulesError

    const { data: snapshots, error: snapshotError } = await supabase
      .from('mt_notification_snapshots')
      .select('install_id, snapshot_date, today_tx_count, last_tx_date, upcoming_bills, credit_due, budget_alerts, recurring_due, privileges_expiring, last_exported_at')
      .in('install_id', installIds)
    if (snapshotError) throw snapshotError

    const devicesByInstallId = new Map<string, DeviceRow[]>()
    deviceRows.forEach(device => {
      if (!device.push_subscription?.endpoint) return
      const list = devicesByInstallId.get(device.install_id) || []
      list.push(device)
      devicesByInstallId.set(device.install_id, list)
    })
    const snapshotByInstallId = new Map((snapshots || []).map(row => [String(row.install_id), row as SnapshotRow]))

    let sent = 0
    let skipped = 0
    const failures: Array<{ installId: string; ruleId: string; error: string }> = []

    for (const rule of (rules || []) as RuleRow[]) {
      const dedupeKey = shouldSend(rule, snapshotByInstallId.get(rule.install_id))
      if (!dedupeKey) {
        skipped++
        continue
      }

      const { data: existing, error: existingError } = await supabase
        .from('mt_notification_logs')
        .select('id, status')
        .eq('install_id', rule.install_id)
        .eq('notification_type', 'custom_rule')
        .eq('dedupe_key', dedupeKey)
        .maybeSingle()
      if (existingError) throw existingError
      if (existing?.status === 'sent') {
        skipped++
        continue
      }

      const devicesForInstall = devicesByInstallId.get(rule.install_id) || []
      let sentForRule = 0

      for (const device of devicesForInstall) {
        if (!device.push_subscription) continue
        try {
          await sendWebPush(device.push_subscription, {
            title: rule.title,
            body: rule.body || '',
            icon: './assets/icon.svg',
            badge: './assets/icon.svg',
            tag: dedupeKey,
            data: {
              type: 'custom_rule',
              ruleId: rule.rule_id,
              route: rule.route || 'dashboard',
              actionLabel: rule.action_label || 'เปิดแอป',
            },
            actions: [
              { action: rule.route || 'open', title: rule.action_label || 'เปิดแอป' },
              { action: 'open', title: 'เปิดแอป' },
            ],
          })
          sentForRule++
        } catch (sendError) {
          failures.push({
            installId: rule.install_id,
            ruleId: rule.rule_id,
            error: sendError instanceof Error ? sendError.message : String(sendError),
          })
        }
      }

      await supabase.from('mt_notification_logs').upsert({
        install_id: rule.install_id,
        notification_type: 'custom_rule',
        dedupe_key: dedupeKey,
        title: rule.title,
        body: rule.body || '',
        status: sentForRule > 0 ? 'sent' : 'error',
        fcm_message_id: null,
        error: sentForRule > 0 ? null : 'No devices were sent successfully',
      }, { onConflict: 'install_id,notification_type,dedupe_key' })

      sent += sentForRule
    }

    return jsonResponse({ ok: true, sent, skipped, failures })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : JSON.stringify(error) }, 500)
  }
})
