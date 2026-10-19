-- The original Inbox migration used `current_time` as a PL/pgSQL variable.
-- PostgreSQL also reserves CURRENT_TIME as a time-with-time-zone value; on the
-- claim path that can resolve to the built-in and raise SQLSTATE 42883 when it
-- is compared with a timestamptz column. Recreate the state-machine functions
-- with an unambiguous variable name.

create or replace function public.mt_shortcut_claim_capture(
  p_user_id uuid,
  p_capture_id uuid,
  p_claim_token_hash bytea,
  p_claim_device_id text,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_data public.mt_shortcut_captures%rowtype;
  now_ts timestamptz := coalesce(p_now, now());
begin
  if p_claim_token_hash is null then return false; end if;
  select * into row_data
  from public.mt_shortcut_captures
  where id = p_capture_id and user_id = p_user_id
  for update;
  if not found or row_data.status in ('consumed', 'expired') then return false; end if;
  if row_data.status = 'claimed'
     and row_data.claim_expires_at is not null
     and row_data.claim_expires_at > now_ts then
    return false;
  end if;

  update public.mt_shortcut_captures
  set status = 'claimed',
      claim_token_hash = p_claim_token_hash,
      claim_device_id = nullif(left(trim(coalesce(p_claim_device_id, '')), 128), ''),
      claim_expires_at = now_ts + interval '10 minutes',
      updated_at = now_ts
  where id = p_capture_id and user_id = p_user_id;
  return true;
end;
$$;

create or replace function public.mt_shortcut_consume_capture(
  p_user_id uuid,
  p_capture_id uuid,
  p_claim_token_hash bytea,
  p_transaction_id_hash bytea,
  p_retry boolean,
  p_now timestamptz
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_data public.mt_shortcut_captures%rowtype;
  now_ts timestamptz := coalesce(p_now, now());
begin
  select * into row_data
  from public.mt_shortcut_captures
  where id = p_capture_id and user_id = p_user_id
  for update;
  if not found then return 'not_found'; end if;
  if row_data.status = 'consumed' then
    if row_data.consumed_transaction_id_hash = p_transaction_id_hash then return 'already_consumed_same'; end if;
    return 'capture_already_consumed';
  end if;
  if row_data.status in ('dismissed', 'expired') then return 'invalid_state'; end if;
  if not p_retry and not (row_data.status = 'claimed' and row_data.claim_token_hash = p_claim_token_hash) then
    return 'claim_conflict';
  end if;
  if p_retry and row_data.status = 'claimed'
     and row_data.claim_expires_at is not null
     and row_data.claim_expires_at > now_ts
     and (p_claim_token_hash is null or row_data.claim_token_hash <> p_claim_token_hash) then
    return 'claim_conflict';
  end if;

  update public.mt_shortcut_captures
  set status = 'consumed', consumed_transaction_id_hash = p_transaction_id_hash,
      consumed_at = now_ts, payload_purge_at = now_ts + interval '7 days',
      claim_token_hash = null, claim_device_id = null, claim_expires_at = null,
      updated_at = now_ts
  where id = p_capture_id and user_id = p_user_id;
  return 'consumed';
end;
$$;

create or replace function public.mt_shortcut_dismiss_capture(
  p_user_id uuid,
  p_capture_id uuid,
  p_claim_token_hash bytea,
  p_now timestamptz
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_data public.mt_shortcut_captures%rowtype;
  now_ts timestamptz := coalesce(p_now, now());
begin
  select * into row_data from public.mt_shortcut_captures
  where id = p_capture_id and user_id = p_user_id for update;
  if not found then return 'not_found'; end if;
  if row_data.status in ('consumed', 'expired') then return 'invalid_state'; end if;
  if row_data.status = 'claimed' and (p_claim_token_hash is null or row_data.claim_token_hash <> p_claim_token_hash)
     and row_data.claim_expires_at > now_ts then return 'claim_conflict'; end if;
  update public.mt_shortcut_captures
  set status = 'dismissed', dismissed_at = now_ts,
      payload_purge_at = now_ts + interval '7 days',
      claim_token_hash = null, claim_device_id = null, claim_expires_at = null,
      updated_at = now_ts
  where id = p_capture_id and user_id = p_user_id;
  return 'dismissed';
end;
$$;

create or replace function public.mt_shortcut_restore_capture(
  p_user_id uuid,
  p_capture_id uuid,
  p_now timestamptz
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  now_ts timestamptz := coalesce(p_now, now());
begin
  update public.mt_shortcut_captures
  set status = 'pending', dismissed_at = null, payload_purge_at = null, updated_at = now_ts
  where id = p_capture_id and user_id = p_user_id and status = 'dismissed'
    and ciphertext is not null and (payload_purge_at is null or payload_purge_at > now_ts);
  if found then return 'restored'; end if;
  return 'invalid_state';
end;
$$;

create or replace function public.mt_shortcut_cleanup(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  now_ts timestamptz := coalesce(p_now, now());
  changed integer := 0;
begin
  update public.mt_shortcut_captures
  set status = 'expired', ciphertext = null, iv = null, encryption_key_version = null,
      claim_token_hash = null, claim_device_id = null, claim_expires_at = null,
      payload_purge_at = now_ts, updated_at = now_ts
  where status in ('pending', 'claimed') and accepted_at <= now_ts - interval '30 days';
  get diagnostics changed = row_count;

  update public.mt_shortcut_captures
  set ciphertext = null, iv = null, encryption_key_version = null,
      claim_token_hash = null, claim_device_id = null, claim_expires_at = null,
      updated_at = now_ts
  where status in ('consumed', 'dismissed') and payload_purge_at is not null
    and payload_purge_at <= now_ts;
  changed := changed + row_count;

  delete from public.mt_shortcut_captures
  where accepted_at <= now_ts - interval '180 days';
  changed := changed + row_count;
  return changed;
end;
$$;

revoke all on function public.mt_shortcut_claim_capture(uuid, uuid, bytea, text, timestamptz) from public, anon, authenticated;
revoke all on function public.mt_shortcut_consume_capture(uuid, uuid, bytea, bytea, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.mt_shortcut_dismiss_capture(uuid, uuid, bytea, timestamptz) from public, anon, authenticated;
revoke all on function public.mt_shortcut_restore_capture(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.mt_shortcut_cleanup(timestamptz) from public, anon, authenticated;

grant execute on function public.mt_shortcut_claim_capture(uuid, uuid, bytea, text, timestamptz) to service_role;
grant execute on function public.mt_shortcut_consume_capture(uuid, uuid, bytea, bytea, boolean, timestamptz) to service_role;
grant execute on function public.mt_shortcut_dismiss_capture(uuid, uuid, bytea, timestamptz) to service_role;
grant execute on function public.mt_shortcut_restore_capture(uuid, uuid, timestamptz) to service_role;
grant execute on function public.mt_shortcut_cleanup(timestamptz) to service_role;
