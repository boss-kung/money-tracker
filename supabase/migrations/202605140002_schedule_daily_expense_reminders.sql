create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mt_daily_expense_reminders') then
    perform cron.unschedule('mt_daily_expense_reminders');
  end if;
end $$;

select cron.schedule(
  'mt_daily_expense_reminders',
  '30 13 * * *',
  $$
  select
    net.http_post(
      url := 'https://bwtoyxxwwmsaoaitihqj.supabase.co/functions/v1/send-daily-expense-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3dG95eHh3d21zYW9haXRpaHFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDQzOTUsImV4cCI6MjA5NDMyMDM5NX0.zAees7bWHP2Wt-q3jK9ht510ikkfxGYDtd8qYAvcoe0',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3dG95eHh3d21zYW9haXRpaHFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDQzOTUsImV4cCI6MjA5NDMyMDM5NX0.zAees7bWHP2Wt-q3jK9ht510ikkfxGYDtd8qYAvcoe0'
      ),
      body := jsonb_build_object('source', 'supabase-cron')
    );
  $$
);
