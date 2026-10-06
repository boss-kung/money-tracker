-- Daily reminders use the same lease columns as custom-rule delivery, but do
-- not have a row in mt_notification_rules to authorize their claim.
create or replace function public.mt_claim_daily_notification(
  p_install_id text,
  p_user_id uuid,
  p_dedupe_key text,
  p_title text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  token uuid := gen_random_uuid();
  claimed uuid;
begin
  if not exists (
    select 1 from public.mt_notification_devices
    where install_id = p_install_id
      and user_id = p_user_id
      and enabled = true
      and permission = 'granted'
  ) then
    return null;
  end if;

  insert into public.mt_notification_logs (
    install_id, user_id, notification_type, dedupe_key,
    title, body, status, lease_token, lease_until
  ) values (
    p_install_id, p_user_id, 'daily_expense', p_dedupe_key,
    p_title, p_body, 'pending', token, now() + interval '120 seconds'
  )
  on conflict (install_id, notification_type, dedupe_key)
  do update set
    status = 'pending',
    lease_token = token,
    lease_until = now() + interval '120 seconds',
    title = excluded.title,
    body = excluded.body,
    error = null
  where mt_notification_logs.status = 'error'
     or (mt_notification_logs.status = 'pending'
         and (mt_notification_logs.lease_until is null or mt_notification_logs.lease_until < now()))
  returning lease_token into claimed;

  return claimed;
end;
$$;

revoke all on function public.mt_claim_daily_notification(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.mt_claim_daily_notification(text, uuid, text, text, text) to service_role;
