import { evaluateNotificationRule, sanitizeDaysLeft } from './notification_rules.ts'
function equal(a:unknown,b:unknown){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`)}
const rule={rule_id:'r',trigger_type:'credit_card_due',trigger_config:{time:'09:00',daysBefore:1}}
const now={date:'2026-06-03',minutes:560,weekday:'wed',dayOfMonth:3}
Deno.test('previous-day snapshot delivers at the actual due reminder day and catches up late',()=>{
 equal(evaluateNotificationRule({rule,snapshot:{snapshot_date:'2026-06-02',credit_due:[{daysLeft:2}]},nowBangkok:now}).shouldSend,true)
 equal(evaluateNotificationRule({rule,snapshot:{snapshot_date:'2026-06-02',credit_due:[{daysLeft:2}]},nowBangkok:{...now,minutes:539}}).shouldSend,false)
})
Deno.test('overdue remains negative and never matches due-today',()=>{
 equal(sanitizeDaysLeft([{daysLeft:-10},{daysLeft:null},{}]),[{daysLeft:-10}])
 const snapshot={snapshot_date:now.date,credit_due:[{daysLeft:-10}]}
 equal(evaluateNotificationRule({rule:{...rule,trigger_config:{time:'09:00',daysBefore:0}},snapshot,nowBangkok:now}).shouldSend,false)
 equal(evaluateNotificationRule({rule:{...rule,trigger_config:{time:'09:00',mode:'overdue'}},snapshot,nowBangkok:now}).shouldSend,true)
})
Deno.test('future invalid and expired snapshots cannot drive debt alerts',()=>{
 for(const date of ['2026-06-04','2026-02-30','2026-01-01']) equal(evaluateNotificationRule({rule,snapshot:{snapshot_date:date,credit_due:[{daysLeft:1}]},nowBangkok:now}).shouldSend,false)
})
Deno.test('non-debt rules still require same-day data and a 15-minute time window',()=>{
 const noTx={rule_id:'n',trigger_type:'no_transaction_today',trigger_config:{time:'09:00'}}
 equal(evaluateNotificationRule({rule:noTx,snapshot:{snapshot_date:now.date,today_tx_count:0},nowBangkok:now}).shouldSend,false)
 equal(evaluateNotificationRule({rule:noTx,snapshot:{snapshot_date:'2026-06-02',today_tx_count:0},nowBangkok:{...now,minutes:540}}).shouldSend,false)
})
