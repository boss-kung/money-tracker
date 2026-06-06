-- Stores short-lived OTP hashes used to confirm permanent account deletion.
-- One row per user — upsert on each new request, deleted immediately after use.
create table if not exists mt_delete_otps (
  user_id    text        primary key,
  otp_hash   text        not null,
  expires_at timestamptz not null
);

alter table mt_delete_otps enable row level security;
-- No RLS policies: only accessible by service_role (edge functions).
