# Phase 3 — Backend Atomicity / Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make notification rule sync, daily delivery, registration preferences, and deletion OTP flows atomic, retry-safe, and resistant to abuse.

**Architecture:** Keep authentication and installation ownership checks in Edge Functions. Move multi-row replacement/claim/OTP state transitions into service-role-only Postgres RPCs with row locks and unique dedupe constraints. Preserve the existing HTTP payloads and shared delivery helper.

**Tech Stack:** Supabase Postgres migrations/RPCs, Deno TypeScript Edge Functions, Deno unit/contract tests, existing Web Crypto APIs.

**Spec:** `docs/superpowers/specs/2026-10-06-phase3-backend-atomicity-security-design.md`

## Global Constraints

- Existing Edge Function authentication and cron-secret checks remain mandatory.
- Existing client-facing request/response shapes remain compatible.
- Existing rows remain readable; migrations are additive and rerunnable.
- No financial payload is added to notification logs or OTP state.
- Do not claim integration success without a Supabase test database; unit/contract tests must still run offline.

## Review Focus

- Rule insert failure after delete must leave the previous rule set unchanged — Task 1 test.
- Two daily cron workers must produce at most one push and reclaim only expired/error leases — Task 2 tests.
- Re-registering an installation must not reset explicit user preferences — Task 3 test.
- OTP requests and guesses must be rate-limited/locked without revealing whether a code exists — Task 4 tests.
- A valid OTP must be consumed exactly once even under concurrent verification — Task 4 test.

---

### Task 1: Atomic notification-rule replacement

**Files:**
- Create: `supabase/migrations/202610060002_notification_rule_replace_rpc.sql`
- Modify: `supabase/functions/sync-notification-rules/index.ts`
- Create: `supabase/functions/_shared/notification_rule_sync_test.ts`

**Interfaces:**
- Produces service-role RPC `mt_replace_notification_rules(text, uuid, jsonb) -> jsonb`.
- RPC returns `{ synced: number }`; all delete/insert work occurs in one transaction.

- [x] Write a failing contract test asserting the sync function performs one RPC call and does not issue separate rules delete/insert calls.
- [x] Add migration with owner check, transactional replacement, `security definer`, fixed `search_path`, and service-role-only grant.
- [x] Replace the Edge Function delete/insert sequence with one RPC call and validate its response shape.
- [x] Run `deno test --allow-env supabase/functions/_shared/notification_rule_sync_test.ts` and the existing notification tests.
- [x] Run `deno check supabase/functions/sync-notification-rules/index.ts`.

### Task 2: Atomic daily delivery claim

**Files:**
- Create: `supabase/migrations/202610060003_daily_notification_delivery_claim.sql`
- Modify: `supabase/functions/send-daily-expense-reminders/index.ts`
- Create: `supabase/functions/_shared/daily_notification_claim_test.ts`

**Interfaces:**
- Produces service-role RPC `mt_claim_daily_notification(text, uuid, text, text, text) -> uuid | null`.
- Uses existing `mt_notification_logs` lease columns and unique `(install_id, notification_type, dedupe_key)`.

- [x] Write failing tests for concurrent claim, already-sent skip, expired-lease reclaim, and error-lease retry.
- [x] Add the daily claim RPC with ownership/device checks and atomic lease acquisition.
- [x] Refactor the daily function to call `deliverClaimedNotification` around the RPC claim and lease-token-fenced finish update.
- [x] Run focused Deno tests and existing shared delivery tests.
- [x] Run `deno check supabase/functions/send-daily-expense-reminders/index.ts`.

### Task 3: Registration preference preservation

**Files:**
- Modify: `supabase/functions/register-notification-device/index.ts`
- Create: `supabase/functions/_shared/notification_registration_test.ts`

**Interfaces:**
- Registration continues to accept the current payload.
- Device registration upserts device metadata; preference defaults are inserted only when the installation has no preference row.

- [x] Write failing tests asserting a second registration does not overwrite existing preferences and a preference write error is returned.
- [x] Change preference persistence to insert-once (`ignoreDuplicates`) and check the returned error; do not write user preference values from registration metadata.
- [x] Run focused tests plus notification lifecycle regressions.
- [x] Run `deno check supabase/functions/register-notification-device/index.ts`.

### Task 4: OTP issuance and verification hardening

**Files:**
- Create: `supabase/migrations/202610060004_delete_otp_hardening.sql`
- Modify: `supabase/functions/send-delete-otp/index.ts`
- Modify: `supabase/functions/delete-account/index.ts`
- Create: `supabase/functions/_shared/delete_otp_test.ts`

**Interfaces:**
- Adds `attempt_count`, `requested_at`, and `locked_until` to `mt_delete_otps`.
- Produces service-role RPCs `mt_issue_delete_otp(text,text,timestamptz) -> boolean` and `mt_consume_delete_otp(text,text) -> boolean`.

- [x] Write failing tests for CSPRNG code generation, one-minute request throttling, five-failure/fifteen-minute lockout, expiry rejection, and concurrent one-time consumption.
- [x] Add additive OTP columns and locked RPCs with row-level `FOR UPDATE` transitions and service-role-only grants.
- [x] Replace `Math.random()` with `crypto.getRandomValues`; use issue RPC and return a rate-limit response without exposing OTP state.
- [x] Replace direct OTP select/delete verification with consume RPC before account cleanup.
- [x] Run focused Deno tests and delete-account contract tests.
- [x] Run `deno check` for both OTP functions.

### Task 5: Phase 3 verification and documentation

**Files:**
- Modify: `.superpowers/sdd/2026-10-06-phase3-backend-atomicity-security/progress.md`

- [x] Run all Deno tests under `supabase/functions/_shared/*_test.ts`.
- [x] Run `deno check` for every changed Edge Function.
- [x] Run `node --test tests/*.test.js`, `node --check` for changed JS, and `git diff --check`.
- [x] Record whether Supabase integration migrations were exercised or remain pending because no test DB is configured.
