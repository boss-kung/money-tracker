create table if not exists public.mt_notification_devices (
  id uuid primary key default gen_random_uuid(),
  install_id text not null,
  fcm_token text not null unique,
  platform text not null default 'unknown',
  browser text not null default 'unknown',
  timezone text not null default 'Asia/Bangkok',
  permission text not null default 'default',
  enabled boolean not null default true,
  app_version text,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mt_notification_devices_install_id_idx
  on public.mt_notification_devices (install_id);

create table if not exists public.mt_notification_preferences (
  install_id text primary key,
  daily_expense_enabled boolean not null default true,
  daily_expense_time text not null default '20:30',
  upcoming_bill_enabled boolean not null default true,
  credit_card_due_enabled boolean not null default true,
  budget_alert_enabled boolean not null default false,
  recurring_enabled boolean not null default true,
  backup_reminder_enabled boolean not null default true,
  monthly_summary_enabled boolean not null default false,
  hide_amounts_in_notification boolean not null default false,
  timezone text not null default 'Asia/Bangkok',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.mt_notification_snapshots (
  install_id text primary key,
  snapshot_date date not null default current_date,
  today_tx_count integer not null default 0,
  last_tx_date date,
  upcoming_bills jsonb not null default '[]'::jsonb,
  credit_due jsonb not null default '[]'::jsonb,
  budget_alerts jsonb not null default '[]'::jsonb,
  recurring_due jsonb not null default '[]'::jsonb,
  last_exported_at timestamptz,
  app_version text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.mt_notification_logs (
  id uuid primary key default gen_random_uuid(),
  install_id text not null,
  notification_type text not null,
  dedupe_key text not null,
  title text not null,
  body text,
  status text not null default 'pending',
  fcm_message_id text,
  error text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (install_id, notification_type, dedupe_key)
);

create index if not exists mt_notification_logs_sent_at_idx
  on public.mt_notification_logs (sent_at desc);

create or replace function public.mt_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mt_notification_devices_touch_updated_at on public.mt_notification_devices;
create trigger mt_notification_devices_touch_updated_at
before update on public.mt_notification_devices
for each row execute function public.mt_touch_updated_at();

drop trigger if exists mt_notification_preferences_touch_updated_at on public.mt_notification_preferences;
create trigger mt_notification_preferences_touch_updated_at
before update on public.mt_notification_preferences
for each row execute function public.mt_touch_updated_at();

drop trigger if exists mt_notification_snapshots_touch_updated_at on public.mt_notification_snapshots;
create trigger mt_notification_snapshots_touch_updated_at
before update on public.mt_notification_snapshots
for each row execute function public.mt_touch_updated_at();

alter table public.mt_notification_devices enable row level security;
alter table public.mt_notification_preferences enable row level security;
alter table public.mt_notification_snapshots enable row level security;
alter table public.mt_notification_logs enable row level security;
