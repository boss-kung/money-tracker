-- Replace one installation's custom rules atomically. The Edge Function still
-- authenticates the caller; this service-role RPC repeats the ownership check
-- so a future caller cannot use the write primitive as an arbitrary delete.
create or replace function public.mt_replace_notification_rules(
  p_install_id text,
  p_user_id uuid,
  p_rules jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer := 0;
begin
  if not exists (
    select 1 from public.mt_notification_devices
    where install_id = p_install_id and user_id = p_user_id
  ) then
    raise exception 'Installation ownership mismatch' using errcode = '42501';
  end if;

  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then
    raise exception 'Rules payload must be an array' using errcode = '22023';
  end if;

  delete from public.mt_notification_rules
  where install_id = p_install_id and user_id = p_user_id;

  insert into public.mt_notification_rules (
    install_id, user_id, rule_id, enabled, title, body, route,
    action_label, trigger_type, trigger_config, app_version, source
  )
  select
    p_install_id,
    p_user_id,
    left(coalesce(row->>'rule_id', ''), 80),
    coalesce((row->>'enabled')::boolean, true),
    left(coalesce(row->>'title', ''), 120),
    left(coalesce(row->>'body', ''), 240),
    left(coalesce(row->>'route', 'dashboard'), 80),
    left(coalesce(row->>'action_label', 'เปิดแอป'), 40),
    left(coalesce(row->>'trigger_type', 'daily_time'), 80),
    coalesce(row->'trigger_config', '{}'::jsonb),
    nullif(left(coalesce(row->>'app_version', ''), 80), ''),
    left(coalesce(row->>'source', 'custom'), 40)
  from jsonb_array_elements(p_rules) as rows(row);

  get diagnostics inserted_count = row_count;
  return jsonb_build_object('synced', inserted_count);
end;
$$;

revoke all on function public.mt_replace_notification_rules(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mt_replace_notification_rules(text, uuid, jsonb) to service_role;
