export type ReminderRule = { rule_id: string; trigger_type: string; trigger_config?: Record<string, unknown> }
export type SignalSnapshot = { snapshot_date: string; credit_due?: unknown; upcoming_bills?: unknown; today_tx_count?: number }
export type BangkokNow = { date: string; minutes: number; weekday?: string; dayOfMonth?: number }
function dateNumber(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value ? d.getTime()/86400000 : null
}
export function calendarDaysBetween(from: string, to: string) {
  const a=dateNumber(from),b=dateNumber(to)
  return a===null || b===null ? null : b-a
}
export function sanitizeDaysLeft(input: unknown): Array<{daysLeft:number}> {
  if (!Array.isArray(input)) return []
  return [...new Set(input.filter(v=>v && typeof v.daysLeft==='number' && Number.isFinite(v.daysLeft)).map(v=>Math.trunc(v.daysLeft)))].slice(0,100).map(daysLeft=>({daysLeft}))
}
export function effectiveDaysLeft({daysLeft,snapshotDate,today}: {daysLeft:number;snapshotDate:string;today:string}) {
  const elapsed=calendarDaysBetween(snapshotDate,today)
  return elapsed===null || elapsed<0 || elapsed>90 ? null : daysLeft-elapsed
}
export function evaluateNotificationRule({rule,snapshot,nowBangkok}: {rule:ReminderRule;snapshot?:SignalSnapshot;nowBangkok:BangkokNow}) {
  const config=rule.trigger_config || {}, match=String(config.time || '09:00').match(/^(\d{2}):(\d{2})$/)
  const result=(shouldSend:boolean,reason:string)=>({shouldSend,reason,dedupeKey:shouldSend?`custom-rule:${rule.rule_id}:${nowBangkok.date}`:''})
  if (!match || Number(match[1])>23 || Number(match[2])>59) return result(false,'invalid-time')
  const start=Number(match[1])*60+Number(match[2])
  if (nowBangkok.minutes<start) return result(false,'before-time')
  if (['credit_card_due','upcoming_bill_due'].includes(rule.trigger_type)) {
    if (!snapshot) return result(false,'no-snapshot')
    const daysBefore=Number(config.daysBefore ?? 1)
    if (!Number.isInteger(daysBefore) || daysBefore<0 || daysBefore>90) return result(false,'invalid-days-before')
    const mode=config.mode || 'due'
    if (!['due','overdue'].includes(String(mode))) return result(false,'invalid-mode')
    const values=sanitizeDaysLeft(rule.trigger_type==='credit_card_due'?snapshot.credit_due:snapshot.upcoming_bills)
    const matched=values.some(item=> {
      const days=effectiveDaysLeft({daysLeft:item.daysLeft,snapshotDate:snapshot.snapshot_date,today:nowBangkok.date})
      return days!==null && (mode==='overdue'?days<0:days===daysBefore)
    })
    return result(matched,matched?'due-match':'no-match')
  }
  if (rule.trigger_type==='no_transaction_today') return result(snapshot?.snapshot_date===nowBangkok.date && nowBangkok.minutes-start<15 && Number(snapshot.today_tx_count || 0)===0,'daily-state')
  return result(false,'unsupported')
}
