create table if not exists public.mt_notification_rules (
  id uuid primary key default gen_random_uuid(),
  install_id text not null,
  rule_id text not null,
  enabled boolean not null default true,
  title text not null,
  body text not null default '',
  route text not null default 'dashboard',
  action_label text not null default 'เปิดแอป',
  trigger_type text not null default 'daily_time',
  trigger_config jsonb not null default '{}'::jsonb,
  source text not null default 'custom',
  app_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (install_id, rule_id)
);

create index if not exists mt_notification_rules_install_enabled_idx
  on public.mt_notification_rules (install_id, enabled);

drop trigger if exists mt_notification_rules_touch_updated_at on public.mt_notification_rules;
create trigger mt_notification_rules_touch_updated_at
before update on public.mt_notification_rules
for each row execute function public.mt_touch_updated_at();

alter table public.mt_notification_rules enable row level security;
