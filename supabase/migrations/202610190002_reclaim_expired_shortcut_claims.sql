-- Return abandoned review claims to the Inbox once their short claim lease ends.
-- This is intentionally scoped to one owner so one user's stale review cannot
-- affect another user's capture rows.
create or replace function public.mt_shortcut_reclaim_expired_claims(
  p_user_id uuid,
  p_now timestamptz default now()
)
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
  set status = 'pending',
      claim_token_hash = null,
      claim_device_id = null,
      claim_expires_at = null,
      updated_at = now_ts
  where user_id = p_user_id
    and status = 'claimed'
    and claim_expires_at is not null
    and claim_expires_at <= now_ts;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.mt_shortcut_reclaim_expired_claims(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.mt_shortcut_reclaim_expired_claims(uuid, timestamptz) to service_role;

-- Keep the hourly cleanup job from leaving abandoned claims invisible until the
-- normal 30-day retention expiry.
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
  set status = 'pending', claim_token_hash = null, claim_device_id = null,
      claim_expires_at = null, updated_at = now_ts
  where status = 'claimed' and claim_expires_at is not null
    and claim_expires_at <= now_ts;
  get diagnostics changed = row_count;

  update public.mt_shortcut_captures
  set status = 'expired', ciphertext = null, iv = null, encryption_key_version = null,
      claim_token_hash = null, claim_device_id = null, claim_expires_at = null,
      payload_purge_at = now_ts, updated_at = now_ts
  where status in ('pending', 'claimed') and accepted_at <= now_ts - interval '30 days';
  changed := changed + row_count;

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

revoke all on function public.mt_shortcut_cleanup(timestamptz) from public, anon, authenticated;
grant execute on function public.mt_shortcut_cleanup(timestamptz) to service_role;
