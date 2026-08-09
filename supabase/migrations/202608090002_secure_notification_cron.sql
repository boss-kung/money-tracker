-- Prerequisites (Supabase Vault): project_url, anon_key, and
-- mt_notification_cron_secret. The same cron secret must be configured as the
-- MT_NOTIFICATION_CRON_SECRET Edge Function secret.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mt_daily_expense_reminders') then
    perform cron.unschedule('mt_daily_expense_reminders');
  end if;
  if exists (select 1 from cron.job where jobname = 'mt_custom_notification_rules') then
    perform cron.unschedule('mt_custom_notification_rules');
  end if;
end $$;

select cron.schedule(
  'mt_daily_expense_reminders',
  '30 13 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/send-daily-expense-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'x-mt-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mt_notification_cron_secret')
    ),
    body := jsonb_build_object('source', 'supabase-cron')
  );
  $$
);

select cron.schedule(
  'mt_custom_notification_rules',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/send-custom-notification-rules',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'x-mt-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mt_notification_cron_secret')
    ),
    body := jsonb_build_object('source', 'supabase-cron')
  );
  $$
);
