begin;

-- Rows created before user ownership was enforced cannot be safely attributed.
-- Remove them before tightening the ownership contract below.
delete from public.mt_notification_logs
 where user_id is null;
delete from public.mt_notification_rules
 where user_id is null;
delete from public.mt_notification_snapshots
 where user_id is null;
delete from public.mt_notification_preferences
 where user_id is null;
delete from public.mt_notification_devices
 where user_id is null;

-- Replace the original SET NULL relationship with an explicit account-delete
-- cascade. Named constraints make this migration safe to re-run in staging.
alter table public.mt_notification_devices
  drop constraint if exists mt_notification_devices_user_id_fkey;
alter table public.mt_notification_devices
  alter column user_id set not null;
alter table public.mt_notification_devices
  add constraint mt_notification_devices_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.mt_notification_preferences
  drop constraint if exists mt_notification_preferences_user_id_fkey;
alter table public.mt_notification_preferences
  alter column user_id set not null;
alter table public.mt_notification_preferences
  add constraint mt_notification_preferences_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.mt_notification_snapshots
  drop constraint if exists mt_notification_snapshots_user_id_fkey;
alter table public.mt_notification_snapshots
  alter column user_id set not null;
alter table public.mt_notification_snapshots
  add constraint mt_notification_snapshots_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.mt_notification_rules
  drop constraint if exists mt_notification_rules_user_id_fkey;
alter table public.mt_notification_rules
  alter column user_id set not null;
alter table public.mt_notification_rules
  add constraint mt_notification_rules_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.mt_notification_logs
  drop constraint if exists mt_notification_logs_user_id_fkey;
alter table public.mt_notification_logs
  alter column user_id set not null;
alter table public.mt_notification_logs
  add constraint mt_notification_logs_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

commit;
