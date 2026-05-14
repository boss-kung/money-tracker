alter table public.mt_notification_snapshots
  add column if not exists privileges_expiring jsonb not null default '[]'::jsonb;
