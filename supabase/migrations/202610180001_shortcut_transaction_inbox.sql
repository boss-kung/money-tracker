create extension if not exists pgcrypto;

create table if not exists public.mt_shortcut_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 64),
  secret_verifier bytea not null,
  secret_prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  rate_window_started_at timestamptz,
  rate_window_count integer not null default 0 check (rate_window_count >= 0)
);

create index if not exists mt_shortcut_tokens_user_active_idx
  on public.mt_shortcut_tokens(user_id, created_at desc)
  where revoked_at is null;

create table if not exists public.mt_shortcut_captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_id uuid references public.mt_shortcut_tokens(id) on delete set null,
  schema_version text not null,
  dedupe_version integer not null,
  dedupe_key text not null check (dedupe_key ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('pending', 'claimed', 'consumed', 'dismissed', 'expired')),
  ciphertext bytea,
  iv bytea,
  encryption_key_version integer,
  claim_token_hash bytea,
  claim_device_id text,
  claim_expires_at timestamptz,
  consumed_transaction_id_hash bytea,
  accepted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  consumed_at timestamptz,
  dismissed_at timestamptz,
  payload_purge_at timestamptz,
  constraint mt_shortcut_captures_dedupe_uq unique (user_id, dedupe_version, dedupe_key),
  constraint mt_shortcut_captures_ciphertext_pair_ck check ((ciphertext is null) = (iv is null))
);

create index if not exists mt_shortcut_captures_user_status_idx
  on public.mt_shortcut_captures(user_id, status, accepted_at desc, id desc);
create index if not exists mt_shortcut_captures_cleanup_idx
  on public.mt_shortcut_captures(status, accepted_at, payload_purge_at);

alter table public.mt_shortcut_tokens enable row level security;
alter table public.mt_shortcut_captures enable row level security;
revoke all on table public.mt_shortcut_tokens from public, anon, authenticated;
revoke all on table public.mt_shortcut_captures from public, anon, authenticated;

drop function if exists public.mt_shortcut_create_token(uuid, text, bytea, text);

create or replace function public.mt_shortcut_create_token(
  p_user_id uuid,
  p_token_id uuid,
  p_label text,
  p_secret_verifier bytea,
  p_secret_prefix text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  token_id uuid;
begin
  if p_user_id is null or p_token_id is null or p_secret_verifier is null or p_secret_prefix is null then
    raise exception 'invalid_token_input' using errcode = '22023';
  end if;
  if char_length(trim(p_label)) < 1 or char_length(trim(p_label)) > 64 then
    raise exception 'invalid_token_label' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if (
    select count(*)
    from public.mt_shortcut_tokens
    where user_id = p_user_id and revoked_at is null
  ) >= 5 then
    raise exception 'active_token_limit' using errcode = 'P0001';
  end if;

  insert into public.mt_shortcut_tokens(id, user_id, label, secret_verifier, secret_prefix)
  values (p_token_id, p_user_id, trim(p_label), p_secret_verifier, p_secret_prefix)
  returning id into token_id;
  return token_id;
end;
$$;

create or replace function public.mt_shortcut_take_rate_slot(
  p_token_id uuid,
  p_now timestamptz,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_window timestamptz := date_trunc('minute', coalesce(p_now, now()));
  allowed boolean := false;
begin
  update public.mt_shortcut_tokens
  set
    rate_window_started_at = case
      when rate_window_started_at is null or rate_window_started_at < current_window then current_window
      else rate_window_started_at
    end,
    rate_window_count = case
      when rate_window_started_at is null or rate_window_started_at < current_window then 1
      when rate_window_count < greatest(1, p_limit) then rate_window_count + 1
      else rate_window_count
    end,
    last_used_at = case
      when rate_window_started_at is null or rate_window_started_at < current_window then coalesce(p_now, now())
      when rate_window_count < greatest(1, p_limit) then coalesce(p_now, now())
      else last_used_at
    end
  where id = p_token_id and revoked_at is null
    and (rate_window_started_at is null
      or rate_window_started_at < current_window
      or rate_window_count < greatest(1, p_limit))
  returning true into allowed;
  return coalesce(allowed, false);
end;
$$;

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
  current_time timestamptz := coalesce(p_now, now());
begin
  if p_claim_token_hash is null then return false; end if;
  select * into row_data
  from public.mt_shortcut_captures
  where id = p_capture_id and user_id = p_user_id
  for update;
  if not found or row_data.status in ('consumed', 'expired') then return false; end if;
  if row_data.status = 'claimed'
     and row_data.claim_expires_at is not null
     and row_data.claim_expires_at > current_time then
    return false;
  end if;

  update public.mt_shortcut_captures
  set status = 'claimed',
      claim_token_hash = p_claim_token_hash,
      claim_device_id = nullif(left(trim(coalesce(p_claim_device_id, '')), 128), ''),
      claim_expires_at = current_time + interval '10 minutes',
      updated_at = current_time
  where id = p_capture_id and user_id = p_user_id;
  return true;
end;
$$;

create or replace function public.mt_shortcut_release_capture(
  p_user_id uuid,
  p_capture_id uuid,
  p_claim_token_hash bytea
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.mt_shortcut_captures
  set status = 'pending', claim_token_hash = null, claim_device_id = null,
      claim_expires_at = null, updated_at = now()
  where id = p_capture_id and user_id = p_user_id and status = 'claimed'
    and claim_token_hash = p_claim_token_hash;
  return found;
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
  current_time timestamptz := coalesce(p_now, now());
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
     and row_data.claim_expires_at > current_time
     and (p_claim_token_hash is null or row_data.claim_token_hash <> p_claim_token_hash) then
    return 'claim_conflict';
  end if;

  update public.mt_shortcut_captures
  set status = 'consumed', consumed_transaction_id_hash = p_transaction_id_hash,
      consumed_at = current_time, payload_purge_at = current_time + interval '7 days',
      claim_token_hash = null, claim_device_id = null, claim_expires_at = null,
      updated_at = current_time
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
  current_time timestamptz := coalesce(p_now, now());
begin
  select * into row_data from public.mt_shortcut_captures
  where id = p_capture_id and user_id = p_user_id for update;
  if not found then return 'not_found'; end if;
  if row_data.status in ('consumed', 'expired') then return 'invalid_state'; end if;
  if row_data.status = 'claimed' and (p_claim_token_hash is null or row_data.claim_token_hash <> p_claim_token_hash)
     and row_data.claim_expires_at > current_time then return 'claim_conflict'; end if;
  update public.mt_shortcut_captures
  set status = 'dismissed', dismissed_at = current_time,
      payload_purge_at = current_time + interval '7 days',
      claim_token_hash = null, claim_device_id = null, claim_expires_at = null,
      updated_at = current_time
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
  current_time timestamptz := coalesce(p_now, now());
begin
  update public.mt_shortcut_captures
  set status = 'pending', dismissed_at = null, payload_purge_at = null, updated_at = current_time
  where id = p_capture_id and user_id = p_user_id and status = 'dismissed'
    and ciphertext is not null and (payload_purge_at is null or payload_purge_at > current_time);
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
  current_time timestamptz := coalesce(p_now, now());
  changed integer := 0;
begin
  update public.mt_shortcut_captures
  set status = 'expired', ciphertext = null, iv = null, encryption_key_version = null,
      claim_token_hash = null, claim_device_id = null, claim_expires_at = null,
      payload_purge_at = current_time, updated_at = current_time
  where status in ('pending', 'claimed') and accepted_at <= current_time - interval '30 days';
  get diagnostics changed = row_count;

  update public.mt_shortcut_captures
  set ciphertext = null, iv = null, encryption_key_version = null,
      claim_token_hash = null, claim_device_id = null, claim_expires_at = null,
      updated_at = current_time
  where status in ('consumed', 'dismissed') and payload_purge_at is not null
    and payload_purge_at <= current_time;
  changed := changed + row_count;

  delete from public.mt_shortcut_captures
  where accepted_at <= current_time - interval '180 days';
  changed := changed + row_count;
  return changed;
end;
$$;

do $schedule$
begin
  perform cron.schedule(
    'mt_shortcut_capture_cleanup',
    '0 * * * *',
    $$select public.mt_shortcut_cleanup(now());$$
  );
exception when duplicate_object then
  null;
end;
$schedule$;

revoke all on function public.mt_shortcut_create_token(uuid, uuid, text, bytea, text) from public, anon, authenticated;
revoke all on function public.mt_shortcut_take_rate_slot(uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.mt_shortcut_claim_capture(uuid, uuid, bytea, text, timestamptz) from public, anon, authenticated;
revoke all on function public.mt_shortcut_release_capture(uuid, uuid, bytea) from public, anon, authenticated;
revoke all on function public.mt_shortcut_consume_capture(uuid, uuid, bytea, bytea, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.mt_shortcut_dismiss_capture(uuid, uuid, bytea, timestamptz) from public, anon, authenticated;
revoke all on function public.mt_shortcut_restore_capture(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.mt_shortcut_cleanup(timestamptz) from public, anon, authenticated;

grant execute on function public.mt_shortcut_create_token(uuid, uuid, text, bytea, text) to service_role;
grant execute on function public.mt_shortcut_take_rate_slot(uuid, timestamptz, integer) to service_role;
grant execute on function public.mt_shortcut_claim_capture(uuid, uuid, bytea, text, timestamptz) to service_role;
grant execute on function public.mt_shortcut_release_capture(uuid, uuid, bytea) to service_role;
grant execute on function public.mt_shortcut_consume_capture(uuid, uuid, bytea, bytea, boolean, timestamptz) to service_role;
grant execute on function public.mt_shortcut_dismiss_capture(uuid, uuid, bytea, timestamptz) to service_role;
grant execute on function public.mt_shortcut_restore_capture(uuid, uuid, timestamptz) to service_role;
grant execute on function public.mt_shortcut_cleanup(timestamptz) to service_role;
