-- Additive schema; old rows remain readable, old clients cannot overwrite v2.
alter table public.mt_notification_snapshots
 add column if not exists snapshot_schema_version integer not null default 1,
 add column if not exists snapshot_revision bigint not null default 0;

create or replace function public.mt_upsert_notification_snapshot_v2(
 p_install_id text,p_user_id uuid,p_schema_version integer,p_revision bigint,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare stored public.mt_notification_snapshots%rowtype;
begin
 if not exists(select 1 from public.mt_notification_devices where install_id=p_install_id and user_id=p_user_id) then
  raise exception 'Installation ownership mismatch' using errcode='42501';
 end if;
 if p_schema_version not in (1,2) or p_revision<0 or (p_schema_version=2 and p_revision=0) then raise exception 'Invalid snapshot revision'; end if;
 -- Per-install lock also serializes first insert, which SELECT FOR UPDATE cannot lock.
 perform pg_advisory_xact_lock(hashtextextended(p_install_id,0));
 select * into stored from public.mt_notification_snapshots where install_id=p_install_id;
 if found and ((stored.snapshot_schema_version=2 and p_schema_version=1) or (p_schema_version=2 and stored.snapshot_revision>=p_revision)) then
  return jsonb_build_object('accepted',false,'revision',stored.snapshot_revision);
 end if;
 insert into public.mt_notification_snapshots(install_id,user_id,snapshot_date,today_tx_count,last_tx_date,upcoming_bills,credit_due,budget_alerts,recurring_due,privileges_expiring,last_exported_at,app_version,snapshot_schema_version,snapshot_revision)
 values(p_install_id,p_user_id,(p_payload->>'snapshot_date')::date,coalesce((p_payload->>'today_tx_count')::integer,0),nullif(p_payload->>'last_tx_date','')::date,
 coalesce(p_payload->'upcoming_bills','[]'::jsonb),coalesce(p_payload->'credit_due','[]'::jsonb),coalesce(p_payload->'budget_alerts','[]'::jsonb),coalesce(p_payload->'recurring_due','[]'::jsonb),coalesce(p_payload->'privileges_expiring','[]'::jsonb),nullif(p_payload->>'last_exported_at','')::timestamptz,p_payload->>'app_version',p_schema_version,p_revision)
 on conflict(install_id) do update set user_id=excluded.user_id,snapshot_date=excluded.snapshot_date,today_tx_count=excluded.today_tx_count,last_tx_date=excluded.last_tx_date,upcoming_bills=excluded.upcoming_bills,credit_due=excluded.credit_due,budget_alerts=excluded.budget_alerts,recurring_due=excluded.recurring_due,privileges_expiring=excluded.privileges_expiring,last_exported_at=excluded.last_exported_at,app_version=excluded.app_version,snapshot_schema_version=excluded.snapshot_schema_version,snapshot_revision=excluded.snapshot_revision;
 return jsonb_build_object('accepted',true,'revision',p_revision);
end; $$;
revoke all on function public.mt_upsert_notification_snapshot_v2(text,uuid,integer,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.mt_upsert_notification_snapshot_v2(text,uuid,integer,bigint,jsonb) to service_role;
