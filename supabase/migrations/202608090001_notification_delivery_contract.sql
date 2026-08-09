-- Align the database with the Web Push payload used by the application.
alter table public.mt_notification_devices
  add column if not exists push_subscription jsonb;

alter table public.mt_notification_devices
  alter column fcm_token drop not null;

-- onConflict: install_id requires a unique contract. Preserve the most recently
-- seen device if older migrations produced duplicate installation rows.
with ranked_devices as (
  select id,
    row_number() over (
      partition by install_id
      order by last_seen_at desc nulls last, created_at desc nulls last, id desc
    ) as duplicate_rank
  from public.mt_notification_devices
)
delete from public.mt_notification_devices
where id in (select id from ranked_devices where duplicate_rank > 1);

create unique index if not exists mt_notification_devices_install_id_uidx
  on public.mt_notification_devices (install_id);

-- Rules are user-owned just like devices, preferences, and snapshots.
drop policy if exists "Users can manage their own notification rules" on public.mt_notification_rules;
create policy "Users can manage their own notification rules"
on public.mt_notification_rules
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

comment on column public.mt_notification_devices.push_subscription is
  'W3C PushSubscription JSON; fcm_token is retained only for legacy rows.';
