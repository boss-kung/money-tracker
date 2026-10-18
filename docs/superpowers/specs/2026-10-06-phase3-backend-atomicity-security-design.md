# Phase 3 — Backend Atomicity / Security Design

## Goal

Make notification synchronization and delivery retry-safe, preserve user
notification preferences, and harden account-deletion OTP issuance and
verification without changing the client-facing notification API.

## Scope and invariants

- Every server-side replacement or delivery claim is all-or-nothing.
- A retry after a network timeout is safe: it may retry the same operation but
  must not duplicate rules, sends, or a successful OTP consumption.
- Edge Functions continue to authenticate the caller/cron secret and verify
  installation ownership before calling service-role RPCs.
- Existing rows remain readable; migrations are additive and rerunnable.
- No financial payload is added to notification logs or OTP records.

## 3.1 Atomic notification-rule replacement

Add migration `202610060002_notification_rule_replace_rpc.sql` with a
`security definer` RPC:

```text
mt_replace_notification_rules(
  p_install_id text,
  p_user_id uuid,
  p_rules jsonb
) -> jsonb { synced: integer }
```

The RPC verifies that the installation belongs to the user, deletes that
installation's rules, inserts the normalized rows, and relies on the database
transaction to roll back both actions when any insert fails. Only
`service_role` may execute it. `sync-notification-rules` calls this RPC once;
it no longer performs separate delete/insert writes.

## 3.2 Atomic daily delivery claim

Add a daily-expense claim RPC in migration
`202610060003_daily_notification_delivery_claim.sql` using the existing
`mt_notification_logs.lease_token` / `lease_until` fields:

```text
mt_claim_daily_notification(
  p_install_id text,
  p_user_id uuid,
  p_dedupe_key text,
  p_title text,
  p_body text
) -> uuid | null
```

The claim checks an enabled/granted owned device, inserts or leases the unique
`daily_expense` log row, and returns null when another worker owns a live lease
or the notification was already sent. The daily function uses
`deliverClaimedNotification`; successful delivery marks the row `sent`, while
transport failure releases it as `error` for a later retry.

## 3.3 Registration preference preservation

Keep device registration and preference defaults backward-compatible:

- Device upsert remains the ownership-checked write.
- Preference defaults use insert-once semantics (`on conflict do nothing`) so a
  later registration cannot reset user choices.
- Every preference write result is checked and surfaced as a server error.
- Existing preference rows are never overwritten by registration metadata;
  explicit preference changes still use `update-notification-preferences`.

## 3.4 OTP issuance and verification hardening

Extend `mt_delete_otps` with additive metadata:

- `attempt_count integer not null default 0`
- `requested_at timestamptz not null default now()`
- `locked_until timestamptz`

Add service-role RPCs:

```text
mt_issue_delete_otp(
  p_user_id text,
  p_otp_hash text,
  p_expires_at timestamptz
) -> boolean

mt_consume_delete_otp(
  p_user_id text,
  p_otp_hash text
) -> boolean
```

Issuance is rate-limited (one request per minute) and resets attempts only for
an accepted new code. The send function generates the six-digit code with
`crypto.getRandomValues`, stores only the hash through the RPC, and refuses
requests while locked/rate-limited. Consumption locks the row, rejects expired
or locked codes, increments failed attempts, locks after five failures for
fifteen minutes, and deletes a matching code exactly once. The delete-account
function calls the consume RPC before the existing explicit cleanup and auth
deletion sequence.

## Error and compatibility behavior

- RPC/database errors return the existing structured server-error response; no
  success response is emitted after a failed write.
- A stale rule sync can be retried with the same payload.
- A claimed daily notification can be retried after its lease expires or after
  a transport error.
- Existing OTP rows receive safe defaults during migration and naturally expire
  under the new checks.

## Verification

- Deno tests cover RPC call contracts, failed rule replacement preserving the
  old set, concurrent daily claims, preference preservation/error propagation,
  CSPRNG/rate/attempt/expiry behavior, and one-time OTP consumption.
- `deno check` runs for all changed Edge Functions.
- A Supabase test database should run migration/RPC integration checks when
  available; unit/contract tests remain deterministic without network access.
