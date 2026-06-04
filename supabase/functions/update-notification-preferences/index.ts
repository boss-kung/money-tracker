import { adminClient, getAuthenticatedUserId } from '../_shared/supabase.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'

const BOOL_KEYS = [
  'daily_expense_enabled',
  'upcoming_bill_enabled',
  'credit_card_due_enabled',
  'budget_alert_enabled',
  'recurring_enabled',
  'backup_reminder_enabled',
  'monthly_summary_enabled',
  'hide_amounts_in_notification',
]

Deno.serve(async req => {
  const options = handleOptions(req)
  if (options) return options
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json()
    const installId = String(body.installId || '').trim()
    if (!installId) return jsonResponse({ error: 'installId is required' }, 400)

    const prefs = body.preferences && typeof body.preferences === 'object' ? body.preferences : {}
    const row: Record<string, unknown> = {
      install_id: installId,
      user_id: await getAuthenticatedUserId(req),
      timezone: String(prefs.timezone || body.timezone || 'Asia/Bangkok').slice(0, 64),
    }
    BOOL_KEYS.forEach(key => {
      if (typeof prefs[key] === 'boolean') row[key] = prefs[key]
    })
    if (/^\d{2}:\d{2}$/.test(String(prefs.daily_expense_time || ''))) {
      row.daily_expense_time = String(prefs.daily_expense_time)
    }

    const { error } = await adminClient()
      .from('mt_notification_preferences')
      .upsert(row, { onConflict: 'install_id' })
    if (error) throw error

    return jsonResponse({ ok: true })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
