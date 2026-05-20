drop trigger if exists mt_notification_rules_normalize_route on public.mt_notification_rules;
drop function if exists public.mt_normalize_notification_rule_route();

update public.mt_notification_rules
set route = 'recurring'
where route = 'budgets'
  and (
    trigger_type = 'recurring_due_today'
    or lower(coalesce(title, '') || ' ' || coalesce(body, '')) ~ '(ประจำ|recurring)'
  );
