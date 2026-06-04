-- Add RLS policies for notification tables.
-- RLS was enabled in migration 202605140001 but no policies were ever created,
-- leaving these tables either fully open or fully blocked depending on the client role.
-- user_id columns were added in migration 202606040002.

-- mt_notification_devices
drop policy if exists "Users can manage their own notification device" on public.mt_notification_devices;
create policy "Users can manage their own notification device"
on public.mt_notification_devices
for all to authenticated
using  ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- mt_notification_preferences
drop policy if exists "Users can manage their own notification preferences" on public.mt_notification_preferences;
create policy "Users can manage their own notification preferences"
on public.mt_notification_preferences
for all to authenticated
using  ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- mt_notification_snapshots
drop policy if exists "Users can manage their own notification snapshot" on public.mt_notification_snapshots;
create policy "Users can manage their own notification snapshot"
on public.mt_notification_snapshots
for all to authenticated
using  ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- mt_notification_logs: read-only for users; writes are done by scheduled edge functions
-- using service_role (which bypasses RLS) so no insert/update policy is needed here.
drop policy if exists "Users can read their own notification logs" on public.mt_notification_logs;
create policy "Users can read their own notification logs"
on public.mt_notification_logs
for select to authenticated
using ((select auth.uid()) = user_id);
