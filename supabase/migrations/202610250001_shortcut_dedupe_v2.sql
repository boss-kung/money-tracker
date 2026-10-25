alter table public.mt_shortcut_captures
  add column if not exists dedupe_base_key text,
  add column if not exists dedupe_captured_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mt_shortcut_captures_dedupe_base_key_ck'
      and conrelid = 'public.mt_shortcut_captures'::regclass
  ) then
    alter table public.mt_shortcut_captures
      add constraint mt_shortcut_captures_dedupe_base_key_ck
      check (dedupe_base_key is null or dedupe_base_key ~ '^[0-9a-f]{64}$');
  end if;
end;
$$;

create index if not exists mt_shortcut_captures_dedupe_base_idx
  on public.mt_shortcut_captures(user_id, dedupe_base_key, dedupe_captured_at);

drop function if exists public.mt_shortcut_store_capture(
  uuid, uuid, uuid, text, integer, text, text, text, boolean,
  timestamptz, bytea, bytea, integer, timestamptz
);

create or replace function public.mt_shortcut_store_capture(
  p_id uuid,
  p_user_id uuid,
  p_token_id uuid,
  p_schema_version text,
  p_dedupe_version integer,
  p_dedupe_key text,
  p_dedupe_base_key text,
  p_legacy_dedupe_key text,
  p_is_strong boolean,
  p_captured_at timestamptz,
  p_ciphertext bytea,
  p_iv bytea,
  p_encryption_key_version integer,
  p_now timestamptz
)
returns table(capture_id uuid, duplicate boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_id uuid;
  received_at timestamptz := coalesce(p_now, now());
begin
  if p_id is null or p_user_id is null or p_schema_version is null
     or p_dedupe_version not in (1, 2)
     or p_dedupe_key is null or p_dedupe_key !~ '^[0-9a-f]{64}$'
     or p_legacy_dedupe_key is not null and p_legacy_dedupe_key !~ '^[0-9a-f]{64}$'
     or p_dedupe_version = 2 and (p_dedupe_base_key is null or p_dedupe_base_key !~ '^[0-9a-f]{64}$')
     or p_is_strong is null or p_captured_at is null
     or p_ciphertext is null or octet_length(p_ciphertext) = 0
     or p_iv is null or octet_length(p_iv) not between 12 and 32
     or p_encryption_key_version is null or p_encryption_key_version < 1 then
    raise exception 'invalid_shortcut_capture' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || coalesce(p_dedupe_base_key, p_legacy_dedupe_key), 0)
  );

  if p_dedupe_version = 2 and p_is_strong then
    select id into existing_id
    from public.mt_shortcut_captures
    where user_id = p_user_id
      and dedupe_version = 2
      and dedupe_key = p_dedupe_key
    order by accepted_at, id
    limit 1;
  end if;

  if existing_id is null and p_is_strong and p_legacy_dedupe_key is not null then
    select id into existing_id
    from public.mt_shortcut_captures
    where user_id = p_user_id
      and dedupe_version = 1
      and dedupe_key = p_legacy_dedupe_key
    order by accepted_at, id
    limit 1;
  end if;

  if existing_id is null and p_dedupe_version = 2 and not p_is_strong then
    select id into existing_id
    from public.mt_shortcut_captures
    where user_id = p_user_id
      and dedupe_version = 2
      and dedupe_base_key = p_dedupe_base_key
      and dedupe_captured_at is not null
      and abs(extract(epoch from (dedupe_captured_at - p_captured_at))) <= 300
    order by accepted_at, id
    limit 1;
  end if;

  if existing_id is null and p_legacy_dedupe_key is not null then
    select id into existing_id
    from public.mt_shortcut_captures
    where user_id = p_user_id
      and dedupe_version = 1
      and dedupe_key = p_legacy_dedupe_key
      and abs(extract(epoch from (accepted_at - p_captured_at))) <= 300
    order by accepted_at, id
    limit 1;
  end if;

  if existing_id is not null then
    capture_id := existing_id;
    duplicate := true;
    return next;
    return;
  end if;

  insert into public.mt_shortcut_captures(
    id,
    user_id,
    token_id,
    schema_version,
    dedupe_version,
    dedupe_key,
    dedupe_base_key,
    dedupe_captured_at,
    status,
    ciphertext,
    iv,
    encryption_key_version,
    accepted_at,
    updated_at
  ) values (
    p_id,
    p_user_id,
    p_token_id,
    p_schema_version,
    p_dedupe_version,
    p_dedupe_key,
    case when p_dedupe_version = 2 then p_dedupe_base_key else null end,
    case when p_dedupe_version = 2 then p_captured_at else null end,
    'pending',
    p_ciphertext,
    p_iv,
    p_encryption_key_version,
    received_at,
    received_at
  )
  returning id into capture_id;

  duplicate := false;
  return next;
end;
$$;

revoke all on function public.mt_shortcut_store_capture(
  uuid, uuid, uuid, text, integer, text, text, text, boolean,
  timestamptz, bytea, bytea, integer, timestamptz
) from public, anon, authenticated;

grant execute on function public.mt_shortcut_store_capture(
  uuid, uuid, uuid, text, integer, text, text, text, boolean,
  timestamptz, bytea, bytea, integer, timestamptz
) to service_role;
