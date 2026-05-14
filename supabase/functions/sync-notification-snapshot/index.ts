import { adminClient } from '../_shared/supabase.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'

function limitedArray(value: unknown, limit: number) {
  return Array.isArray(value) ? value.slice(0, limit) : []
}

Deno.serve(async req => {
  const options = handleOptions(req)
  if (options) return options
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json()
    const installId = String(body.installId || '').trim()
    if (!installId) return jsonResponse({ error: 'installId is required' }, 400)

    const row = {
      install_id: installId,
      snapshot_date: String(body.snapshotDate || new Date().toISOString().slice(0, 10)),
      today_tx_count: Math.max(0, Number(body.todayTxCount || 0)),
      last_tx_date: body.lastTxDate || null,
      upcoming_bills: limitedArray(body.upcomingBills, 25),
      credit_due: limitedArray(body.creditDue, 25),
      budget_alerts: limitedArray(body.budgetAlerts, 25),
      recurring_due: limitedArray(body.recurringDue, 25),
      privileges_expiring: limitedArray(body.privilegesExpiring, 25),
      last_exported_at: body.lastExportedAt || null,
      app_version: body.appVersion ? String(body.appVersion).slice(0, 80) : null,
    }

    const { error } = await adminClient()
      .from('mt_notification_snapshots')
      .upsert(row, { onConflict: 'install_id' })
    if (error) throw error

    return jsonResponse({ ok: true })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
