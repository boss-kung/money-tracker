create table if not exists public.mt_user_vaults (
  user_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  salt text not null,
  wrapped_key text not null,
  wrapped_key_iv text not null,
  kdf_params jsonb not null default '{"name":"PBKDF2","hash":"SHA-256","iterations":310000}'::jsonb,
  schema_version integer not null default 3,
  data_version bigint not null default 1,
  checksum text not null,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id)
);

create index if not exists mt_user_vaults_user_id_idx
  on public.mt_user_vaults (user_id);

drop trigger if exists mt_user_vaults_touch_updated_at on public.mt_user_vaults;
create trigger mt_user_vaults_touch_updated_at
before update on public.mt_user_vaults
for each row execute function public.mt_touch_updated_at();

alter table public.mt_user_vaults enable row level security;

revoke all on public.mt_user_vaults from anon;
grant select, insert, update, delete on public.mt_user_vaults to authenticated;

drop policy if exists "Users can view their own encrypted vault." on public.mt_user_vaults;
create policy "Users can view their own encrypted vault."
on public.mt_user_vaults
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own encrypted vault." on public.mt_user_vaults;
create policy "Users can create their own encrypted vault."
on public.mt_user_vaults
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own encrypted vault." on public.mt_user_vaults;
create policy "Users can update their own encrypted vault."
on public.mt_user_vaults
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own encrypted vault." on public.mt_user_vaults;
create policy "Users can delete their own encrypted vault."
on public.mt_user_vaults
for delete
to authenticated
using ((select auth.uid()) = user_id);
