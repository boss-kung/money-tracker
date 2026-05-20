drop trigger if exists mt_notification_rules_normalize_route on public.mt_notification_rules;
drop function if exists public.mt_normalize_notification_rule_route();

create or replace function public.mt_normalize_notification_rule_route_by_trigger()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.route, '') not in ('', 'dashboard', 'more') then
    return new;
  end if;

  new.route := case
    when new.trigger_type in ('no_transaction_today', 'no_tx_streak') then 'addTx'
    when new.trigger_type = 'upcoming_bill_due' then 'upcomingBills'
    when new.trigger_type = 'credit_card_due' then 'creditCards'
    when new.trigger_type = 'budget_over' then 'budgets'
    when new.trigger_type = 'recurring_due_today' then 'recurring'
    when new.trigger_type = 'privilege_expiry' then 'privileges'
    when new.trigger_type = 'backup_stale' then 'more'
    else coalesce(nullif(new.route, ''), 'dashboard')
  end;

  return new;
end;
$$;

drop trigger if exists mt_notification_rules_normalize_route_by_trigger on public.mt_notification_rules;
create trigger mt_notification_rules_normalize_route_by_trigger
before insert or update on public.mt_notification_rules
for each row execute function public.mt_normalize_notification_rule_route_by_trigger();

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
