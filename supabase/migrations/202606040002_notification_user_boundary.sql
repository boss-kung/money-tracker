alter table public.mt_notification_devices
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.mt_notification_preferences
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.mt_notification_snapshots
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.mt_notification_rules
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.mt_notification_logs
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists mt_notification_devices_user_id_idx
  on public.mt_notification_devices (user_id);

create index if not exists mt_notification_preferences_user_id_idx
  on public.mt_notification_preferences (user_id);

create index if not exists mt_notification_snapshots_user_id_idx
  on public.mt_notification_snapshots (user_id);

create index if not exists mt_notification_rules_user_id_idx
  on public.mt_notification_rules (user_id);

create index if not exists mt_notification_logs_user_id_idx
  on public.mt_notification_logs (user_id);
