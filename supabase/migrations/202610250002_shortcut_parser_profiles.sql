create table if not exists public.mt_shortcut_parser_profiles (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  short_code text not null check (short_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  name text not null check (char_length(name) between 1 and 64),
  app_label text check (app_label is null or char_length(app_label) between 1 and 64),
  enabled boolean not null default true,
  disabled_at timestamptz,
  format_version integer not null check (format_version > 0),
  profile_version integer not null default 1 check (profile_version > 0),
  rule_ciphertext bytea,
  rule_iv bytea,
  rule_encryption_key_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mt_shortcut_parser_profiles_code_uq unique (user_id, short_code),
  constraint mt_shortcut_parser_profiles_ciphertext_ck check (
    (rule_ciphertext is null and rule_iv is null and rule_encryption_key_version is null)
    or (rule_ciphertext is not null and rule_iv is not null and rule_encryption_key_version is not null
      and octet_length(rule_ciphertext) > 0 and octet_length(rule_iv) between 12 and 32 and rule_encryption_key_version > 0)
  )
);

create index if not exists mt_shortcut_parser_profiles_user_idx
  on public.mt_shortcut_parser_profiles(user_id, enabled, updated_at desc);

alter table public.mt_shortcut_parser_profiles enable row level security;
revoke all on table public.mt_shortcut_parser_profiles from public, anon, authenticated;

create or replace function public.mt_shortcut_create_profile(
  p_user_id uuid,
  p_profile_id uuid,
  p_short_code text,
  p_name text,
  p_app_label text,
  p_enabled boolean,
  p_format_version integer,
  p_rule_ciphertext bytea,
  p_rule_iv bytea,
  p_rule_encryption_key_version integer,
  p_now timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result_id uuid;
  now_ts timestamptz := coalesce(p_now, now());
begin
  if p_user_id is null or p_profile_id is null
     or p_short_code is null or p_short_code !~ '^[A-HJ-NP-Z2-9]{6}$'
     or p_name is null or char_length(trim(p_name)) not between 1 and 64
     or p_app_label is not null and char_length(trim(p_app_label)) not between 1 and 64
     or p_format_version is null or p_format_version < 1
     or p_rule_ciphertext is null or p_rule_iv is null or p_rule_encryption_key_version is null
     or octet_length(p_rule_ciphertext) = 0 or octet_length(p_rule_iv) not between 12 and 32
     or p_rule_encryption_key_version < 1 then
    raise exception 'invalid_profile' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':shortcut_profiles', 0));
  if (select count(*) from public.mt_shortcut_parser_profiles where user_id = p_user_id) >= 50 then
    raise exception 'profile_limit' using errcode = 'P0001';
  end if;
  if coalesce(p_enabled, true) and (select count(*) from public.mt_shortcut_parser_profiles where user_id = p_user_id and enabled and disabled_at is null) >= 10 then
    raise exception 'active_profile_limit' using errcode = 'P0001';
  end if;
  insert into public.mt_shortcut_parser_profiles(id, user_id, short_code, name, app_label, enabled, disabled_at, format_version, profile_version, rule_ciphertext, rule_iv, rule_encryption_key_version, created_at, updated_at)
  values (p_profile_id, p_user_id, upper(trim(p_short_code)), trim(p_name), nullif(trim(p_app_label), ''), coalesce(p_enabled, true), case when coalesce(p_enabled, true) then null else now_ts end, p_format_version, 1, p_rule_ciphertext, p_rule_iv, p_rule_encryption_key_version, now_ts, now_ts)
  returning id into result_id;
  return result_id;
exception when unique_violation then
  raise exception 'profile_code_conflict' using errcode = '23505';
end;
$$;

create or replace function public.mt_shortcut_update_profile(
  p_user_id uuid,
  p_profile_id uuid,
  p_expected_version integer,
  p_name text,
  p_app_label text,
  p_enabled boolean,
  p_format_version integer,
  p_rule_ciphertext bytea,
  p_rule_iv bytea,
  p_rule_encryption_key_version integer,
  p_now timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_version integer;
  now_ts timestamptz := coalesce(p_now, now());
  next_version integer;
begin
  if p_user_id is null or p_profile_id is null or p_expected_version is null
     or p_name is null or char_length(trim(p_name)) not between 1 and 64
     or p_app_label is not null and char_length(trim(p_app_label)) not between 1 and 64
     or p_format_version is null or p_format_version < 1
     or p_rule_ciphertext is null or p_rule_iv is null or p_rule_encryption_key_version is null
     or octet_length(p_rule_ciphertext) = 0 or octet_length(p_rule_iv) not between 12 and 32
     or p_rule_encryption_key_version < 1 then
    raise exception 'invalid_profile' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':shortcut_profiles', 0));
  select profile_version into current_version from public.mt_shortcut_parser_profiles where id = p_profile_id and user_id = p_user_id for update;
  if current_version is null then raise exception 'profile_not_found' using errcode = 'P0002'; end if;
  if current_version <> p_expected_version then raise exception 'profile_conflict' using errcode = 'P0001'; end if;
  if coalesce(p_enabled, false) and not exists (select 1 from public.mt_shortcut_parser_profiles where id = p_profile_id and enabled and disabled_at is null)
     and (select count(*) from public.mt_shortcut_parser_profiles where user_id = p_user_id and enabled and disabled_at is null) >= 10 then
    raise exception 'active_profile_limit' using errcode = 'P0001';
  end if;
  next_version := current_version + 1;
  update public.mt_shortcut_parser_profiles
  set name = trim(p_name), app_label = nullif(trim(p_app_label), ''), enabled = coalesce(p_enabled, false), disabled_at = case when coalesce(p_enabled, false) then null else coalesce(disabled_at, now_ts) end,
      format_version = p_format_version, profile_version = next_version, rule_ciphertext = p_rule_ciphertext, rule_iv = p_rule_iv, rule_encryption_key_version = p_rule_encryption_key_version, updated_at = now_ts
  where id = p_profile_id and user_id = p_user_id and profile_version = p_expected_version;
  if not found then raise exception 'profile_conflict' using errcode = 'P0001'; end if;
  return next_version;
end;
$$;

revoke all on function public.mt_shortcut_create_profile(uuid, uuid, text, text, text, boolean, integer, bytea, bytea, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.mt_shortcut_update_profile(uuid, uuid, integer, text, text, boolean, integer, bytea, bytea, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.mt_shortcut_create_profile(uuid, uuid, text, text, text, boolean, integer, bytea, bytea, integer, timestamptz) to service_role;
grant execute on function public.mt_shortcut_update_profile(uuid, uuid, integer, text, text, boolean, integer, bytea, bytea, integer, timestamptz) to service_role;
