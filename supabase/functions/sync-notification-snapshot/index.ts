import { adminClient, requestErrorStatus, requireAuthenticatedUserId, requireInstallOwnership } from '../_shared/supabase.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'

// Keep only the numeric signal needed for trigger logic — strip names, labels, amounts, IDs.
// This prevents any identifying financial detail from reaching the server.
function sanitizeDaysLeft(arr: unknown): Array<{ daysLeft: number }> {
  if (!Array.isArray(arr)) return []
  return arr
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    .map(item => ({ daysLeft: Math.max(0, Math.floor(Number(item.daysLeft ?? 0))) }))
    .slice(0, 100)
}

function sanitizeBudgetAlerts(arr: unknown): Array<{ pct: number; over: boolean }> {
  if (!Array.isArray(arr)) return []
  return arr
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    .map(item => ({ pct: Math.max(0, Math.floor(Number(item.pct ?? 0))), over: Boolean(item.over) }))
    .slice(0, 100)
}

Deno.serve(async req => {
  const options = handleOptions(req)
  if (options) return options
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, req)

  try {
    const body = await req.json()
    const installId = String(body.installId || '').trim()
    if (!installId) return jsonResponse({ error: 'installId is required' }, 400, req)

    const snapshotDate = typeof body.snapshotDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.snapshotDate)
      ? body.snapshotDate
      : new Date().toISOString().slice(0, 10)

    const lastTxDate = typeof body.lastTxDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.lastTxDate)
      ? body.lastTxDate
      : null

    const userId = await requireAuthenticatedUserId(req)
    const supabase = adminClient()
    await requireInstallOwnership(supabase, installId, userId)

    const row = {
      install_id: installId,
      user_id: userId,
      snapshot_date: snapshotDate,
      today_tx_count: Math.max(0, Math.floor(Number(body.todayTxCount ?? 0))),
      last_tx_date: lastTxDate,
      // Sanitized: only numeric trigger signals stored — no names, labels, amounts, or IDs
      upcoming_bills:     sanitizeDaysLeft(body.upcomingBills),
      credit_due:         sanitizeDaysLeft(body.creditDue),
      budget_alerts:      sanitizeBudgetAlerts(body.budgetAlerts),
      recurring_due:      sanitizeDaysLeft(body.recurringDue),
      privileges_expiring: sanitizeDaysLeft(body.privilegesExpiring),
      last_exported_at: body.lastExportedAt || null,
      app_version: body.appVersion ? String(body.appVersion).slice(0, 80) : null,
    }

    const { error } = await supabase
      .from('mt_notification_snapshots')
      .upsert(row, { onConflict: 'install_id' })
    if (error) throw error

    return jsonResponse({ ok: true }, 200, req)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, requestErrorStatus(error), req)
  }
})
