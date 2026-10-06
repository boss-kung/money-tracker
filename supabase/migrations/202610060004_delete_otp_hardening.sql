-- Harden deletion OTPs with request throttling and atomic verification.
alter table public.mt_delete_otps
  add column if not exists attempt_count integer not null default 0,
  add column if not exists requested_at timestamptz not null default now(),
  add column if not exists locked_until timestamptz;

create or replace function public.mt_issue_delete_otp(
  p_user_id text,
  p_otp_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  issued_user_id text;
begin
  insert into public.mt_delete_otps as current_otp (user_id, otp_hash, expires_at, attempt_count, requested_at, locked_until)
  values (p_user_id, p_otp_hash, p_expires_at, 0, now(), null)
  on conflict (user_id) do update set
    otp_hash = excluded.otp_hash,
    expires_at = excluded.expires_at,
    attempt_count = 0,
    requested_at = now(),
    locked_until = null
  where (
    coalesce(current_otp.locked_until, '-infinity'::timestamptz) <= now()
    and current_otp.requested_at <= now() - interval '1 minute'
  )
  returning user_id into issued_user_id;
  return issued_user_id is not null;
end;
$$;

create or replace function public.mt_consume_delete_otp(
  p_user_id text,
  p_otp_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.mt_delete_otps%rowtype;
  next_attempts integer;
begin
  select * into existing
  from public.mt_delete_otps
  where user_id = p_user_id
  for update;

  if not found
     or existing.expires_at <= now()
     or coalesce(existing.locked_until, '-infinity'::timestamptz) > now() then
    return false;
  end if;

  if existing.otp_hash <> p_otp_hash then
    next_attempts := existing.attempt_count + 1;
    update public.mt_delete_otps
    set attempt_count = next_attempts,
        locked_until = case
          when next_attempts >= 5 then now() + interval '15 minutes'
          else locked_until
        end
    where user_id = p_user_id;
    return false;
  end if;

  delete from public.mt_delete_otps where user_id = p_user_id;
  return true;
end;
$$;

revoke all on function public.mt_issue_delete_otp(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.mt_consume_delete_otp(text, text) from public, anon, authenticated;
grant execute on function public.mt_issue_delete_otp(text, text, timestamptz) to service_role;
grant execute on function public.mt_consume_delete_otp(text, text) to service_role;
