create or replace function public.mt_normalize_notification_rule_route()
returns trigger
language plpgsql
as $$
declare
  rule_text text := lower(coalesce(new.title, '') || ' ' || coalesce(new.body, ''));
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
    when rule_text ~ '(งบ|budget)' then 'budgets'
    when rule_text ~ '(สิทธิ|privilege|voucher|คูปอง)' then 'privileges'
    when rule_text ~ '(บัตรเครดิต|credit)' then 'creditCards'
    when rule_text ~ '(บิล|รอจ่าย|bill|due)' then 'upcomingBills'
    when rule_text ~ '(ประจำ|recurring)' then 'recurring'
    else coalesce(nullif(new.route, ''), 'dashboard')
  end;

  return new;
end;
$$;

drop trigger if exists mt_notification_rules_normalize_route on public.mt_notification_rules;
create trigger mt_notification_rules_normalize_route
before insert or update on public.mt_notification_rules
for each row execute function public.mt_normalize_notification_rule_route();

update public.mt_notification_rules
set route = case
  when trigger_type in ('no_transaction_today', 'no_tx_streak') then 'addTx'
  when trigger_type = 'upcoming_bill_due' then 'upcomingBills'
  when trigger_type = 'credit_card_due' then 'creditCards'
  when trigger_type = 'budget_over' then 'budgets'
  when trigger_type = 'recurring_due_today' then 'recurring'
  when trigger_type = 'privilege_expiry' then 'privileges'
  when trigger_type = 'backup_stale' then 'more'
  when lower(coalesce(title, '') || ' ' || coalesce(body, '')) ~ '(งบ|budget)' then 'budgets'
  when lower(coalesce(title, '') || ' ' || coalesce(body, '')) ~ '(สิทธิ|privilege|voucher|คูปอง)' then 'privileges'
  when lower(coalesce(title, '') || ' ' || coalesce(body, '')) ~ '(บัตรเครดิต|credit)' then 'creditCards'
  when lower(coalesce(title, '') || ' ' || coalesce(body, '')) ~ '(บิล|รอจ่าย|bill|due)' then 'upcomingBills'
  when lower(coalesce(title, '') || ' ' || coalesce(body, '')) ~ '(ประจำ|recurring)' then 'recurring'
  else route
end
where route in ('dashboard', 'more');
