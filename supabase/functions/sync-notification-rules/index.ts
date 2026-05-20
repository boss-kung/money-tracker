import { adminClient } from '../_shared/supabase.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'

type CustomRule = {
  id?: string
  enabled?: boolean
  title?: string
  body?: string
  route?: string
  actionLabel?: string
  triggerType?: string
  triggerConfig?: Record<string, unknown>
}

const VALID_ROUTES = new Set([
  'dashboard',
  'addTx',
  'transactions',
  'wallets',
  'reports',
  'more',
  'upcomingBills',
  'creditCards',
  'goals',
  'recurring',
  'budgets',
  'privileges',
])

const VALID_TRIGGERS = new Set([
  'daily_time',
  'weekly_time',
  'one_time',
  'no_transaction_today',
  'upcoming_bill_due',
  'credit_card_due',
  'backup_stale',
  'monthly_time',
  'weekday_only_time',
  'no_tx_streak',
  'budget_over',
  'recurring_due_today',
  'privilege_expiry',
])

function cleanText(value: unknown, max = 160) {
  return String(value || '').trim().slice(0, max)
}

function defaultRouteForTrigger(triggerType: string) {
  const routes: Record<string, string> = {
    no_transaction_today: 'addTx',
    upcoming_bill_due: 'upcomingBills',
    credit_card_due: 'creditCards',
    budget_over: 'budgets',
    recurring_due_today: 'recurring',
    privilege_expiry: 'privileges',
    backup_stale: 'more',
    no_tx_streak: 'addTx',
  }
  return routes[triggerType] || 'dashboard'
}

function defaultRouteForRule(rule: CustomRule, triggerType: string) {
  const triggerRoute = defaultRouteForTrigger(triggerType)
  if (triggerRoute !== 'dashboard') return triggerRoute
  const text = `${rule.title || ''} ${rule.body || ''}`.toLowerCase()
  if (/งบ|budget/.test(text)) return 'budgets'
  if (/สิทธิ|privilege|voucher|คูปอง/.test(text)) return 'privileges'
  if (/บัตรเครดิต|credit/.test(text)) return 'creditCards'
  if (/บิล|รอจ่าย|bill|due/.test(text)) return 'upcomingBills'
  if (/ประจำ|recurring/.test(text)) return 'recurring'
  return 'dashboard'
}

function shouldUseDefaultRoute(route: string, triggerType: string) {
  if (!route) return true
  if (route === 'dashboard' || route === 'more') return true
  return route === defaultRouteForTrigger(triggerType)
}

function normalizeRule(rule: CustomRule, installId: string, appVersion = '') {
  const id = cleanText(rule.id, 80) || crypto.randomUUID()
  const title = cleanText(rule.title, 120)
  if (!title) return null
  const triggerType = VALID_TRIGGERS.has(String(rule.triggerType || ''))
    ? String(rule.triggerType)
    : 'daily_time'
  const route = VALID_ROUTES.has(String(rule.route || ''))
    ? String(rule.route)
    : 'dashboard'
  const resolvedRoute = shouldUseDefaultRoute(route, triggerType)
    ? defaultRouteForRule(rule, triggerType)
    : route

  return {
    install_id: installId,
    rule_id: id,
    enabled: rule.enabled !== false,
    title,
    body: cleanText(rule.body, 240),
    route: VALID_ROUTES.has(resolvedRoute) ? resolvedRoute : 'dashboard',
    action_label: cleanText(rule.actionLabel, 40) || 'เปิดแอป',
    trigger_type: triggerType,
    trigger_config: rule.triggerConfig && typeof rule.triggerConfig === 'object' ? rule.triggerConfig : {},
    app_version: appVersion || null,
    source: 'custom',
  }
}

Deno.serve(async req => {
  const options = handleOptions(req)
  if (options) return options
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json()
    const installId = cleanText(body.installId, 120)
    if (!installId) return jsonResponse({ error: 'installId is required' }, 400)

    const rules = Array.isArray(body.rules) ? body.rules : []
    const rows = rules
      .map((rule: CustomRule) => normalizeRule(rule, installId, cleanText(body.appVersion, 80)))
      .filter(Boolean)

    const supabase = adminClient()
    const { error: deleteError } = await supabase
      .from('mt_notification_rules')
      .delete()
      .eq('install_id', installId)
    if (deleteError) throw deleteError

    if (rows.length) {
      const { error } = await supabase
        .from('mt_notification_rules')
        .insert(rows)
      if (error) throw error
    }

    return jsonResponse({ ok: true, synced: rows.length })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : JSON.stringify(error) }, 500)
  }
})
