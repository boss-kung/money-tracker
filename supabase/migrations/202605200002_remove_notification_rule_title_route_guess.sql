drop trigger if exists mt_notification_rules_normalize_route on public.mt_notification_rules;
drop function if exists public.mt_normalize_notification_rule_route();

update public.mt_notification_rules
set route = 'recurring'
where route = 'budgets'
  and (
    trigger_type = 'recurring_due_today'
    or lower(coalesce(title, '') || ' ' || coalesce(body, '')) ~ '(ประจำ|recurring)'
  );

update public.mt_notification_rules
set route = case
  when trigger_type in ('no_transaction_today', 'no_tx_streak') then 'addTx'
  when trigger_type = 'upcoming_bill_due' then 'upcomingBills'
  when trigger_type = 'credit_card_due' then 'creditCards'
  when trigger_type = 'budget_over' then 'budgets'
  when trigger_type = 'recurring_due_today' then 'recurring'
  when trigger_type = 'privilege_expiry' then 'privileges'
  when trigger_type = 'backup_stale' then 'more'
  else route
end
where route in ('dashboard', 'more')
  and trigger_type in (
    'no_transaction_today',
    'no_tx_streak',
    'upcoming_bill_due',
    'credit_card_due',
    'budget_over',
    'recurring_due_today',
    'privilege_expiry',
    'backup_stale'
  );
