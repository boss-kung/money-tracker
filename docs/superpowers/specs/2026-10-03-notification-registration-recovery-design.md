# Notification registration recovery: diagnosis and requirements

Date: 2026-10-03 (Asia/Bangkok).

## Baseline and evidence

The GitHub default branch was read with `git ls-remote origin HEAD refs/heads/main` and fetched without checking out or merging it. Baseline: `ad79ecfbc31608f160c96952146d915164472ecc` (`main`), release `2026.10.03-audit-r131`. The user's local checkout remains on `feat/credit-carryover-opening-edit`; implementation must start from the latest default branch, not that checkout.

Reported requests:

- `sync-notification-rules`: HTTP 403, originating at `notifications_v2.js:228`, called from the boot background sync.
- `sync-notification-snapshot`: HTTP 403, same transport, called through `notification_sync.js:42`.
- User supplied response: `{"error":"Notification device is not registered"}`. A separate response body for each request and historical registration logs were not supplied.

In the baseline backend, this exact message is emitted only by `requireInstallOwnership()` when the query for `mt_notification_devices.install_id` returns no row. Authentication is checked first. Thus this response identifies the missing device record branch, not token rejection, an ownership mismatch, or a database query error. This establishes the reason for the reported response; it does not establish why the row became missing.

Relevant baseline locations:

| Location | Finding |
| --- | --- |
| `supabase/functions/_shared/supabase.ts:42–75` | Missing authentication returns 401; missing device and another owner's device return distinct 403 messages. |
| `supabase/functions/sync-notification-rules/index.ts:109–117` | User authentication and ownership precede rules writes. |
| `supabase/functions/sync-notification-snapshot/index.ts:33–35` | Same guards precede snapshot writes. |
| `notifications_v2.js:285–290` | Enabled preference, granted permission, or cached subscription independently permits sync; no registration check. |
| `notifications_v2.js:365–394` | Snapshot queue checks for a user ID but has no registration prerequisite. |
| `notifications_v2.js:545–565` | Rules sync has no user/session prerequisite and uses global TTL/hash keys. |
| `notifications_v2.js:628–659` | Enable saves subscription and `enabled=true`, invokes `persist()`, then registers the device. Failed registration leaves those local flags set. |
| `notifications_v2.js:1068–1094` | Boot starts both sync paths without registering/reconciling the device. |
| `notifications_v2.js:1153–1155` | Queue resumes on visibility, storage events, and a minute timer; a fix only in the boot scheduler would be incomplete. |
| `notifications_v2.js:219–242` | Transport falls back to anon Authorization and discards response status/type when constructing an Error. |
| `.github/workflows/deploy.yml` | GitHub Actions deploys Pages assets; it does not deploy Supabase functions. |

The r131 changes to this module removed obsolete exports and unused variables. The registration prerequisite gap predates those changes; no evidence identifies r131 as the introduction of this bug.

## Reproduction and limits

An isolated archive of the exact baseline was extracted to `/private/tmp/money-tracker-notification-r131-audit`. A temporary Deno/Node VM harness executes the actual frontend module and queue plus the actual ownership helper. Its Supabase table reads, browser APIs, and auth boundary are mocked; no production API requests or database mutations are performed. The helper's external client import is replaced with an unused stub to allow an offline diagnostic seam.

`deno test --no-check --allow-read=/private/tmp/money-tracker-notification-r131-audit diagnostic-repro.test.ts`: 5 passed:

1. Authenticated client with no device row sends both requests and receives the exact 403 message; snapshot stays dirty.
2. Same inputs with a device owned by the user allow both sync requests.
3. Granted permission alone permits sync with the master switch off.
4. Signed-out rules still send an anonymous request (401), while snapshot skips.
5. Enable registration failure leaves `enabled=true` and a stored subscription; those are already set when registration starts.

Existing focused tests at the baseline: `node --test tests/notification_contract.test.js tests/notification_sync.test.js tests/notification_snapshot.test.js tests/notification_deeplink_static.test.js`: 17 passed. They do not cover frontend registration-before-sync behavior. These results reproduce the failure pattern locally; they are not verification of the deployed database or a completed fix.

## Remaining historical hypotheses

Ranked investigation targets, not established facts:

1. Registration never completed, leaving local enabled/subscription flags. Prediction: register request failed or never appeared; retrying valid registration creates the missing record.
2. Local installation identity changed or the remote row was deleted. Prediction: the outgoing install ID differs from the registered one, or a previously present row is absent.
3. Sync races initial enable because `persist()` marks the queue dirty before registration finishes. Prediction: under a delayed register request, sync begins before registration succeeds.

Use narrowly scoped registration status/timing evidence to distinguish them. Do not dump tokens, subscription endpoints, or user records to logs. A read-only check for the supplied install ID is sufficient if live diagnosis is needed.

## Required behavior

- Every notification mutation uses a captured authenticated user, session token, and installation scope.
- No background sync when the master setting is off, permission is missing, the app is offline, or authenticated context is unavailable. User activation has its own explicit registration path.
- With notifications enabled and an existing browser PushSubscription, register/reconcile the device before snapshot, rules, or preference writes. Reuse `pushManager.getSubscription()`; never silently request permission or create a new subscription in the background.
- With no actual browser subscription, skip sync and report that the user must enable notifications again. Cached subscription JSON alone is insufficient authority.
- Concurrent callers share one registration promise per user/install scope. A successful result is valid only for that scope and current lifecycle; sign-out, account change, or install change invalidates readiness. Auth completion schedules reconciliation explicitly, including login later than the boot timer.
- A known missing-device 403 can invalidate readiness, re-register, and retry the original request at most once. Another-owner 403 must stop and remain visible; do not transfer ownership or treat all 403 responses as recoverable.
- Failed registration must not establish a confirmed enabled/synced state. Preserve the browser subscription for a later retry; do not set fresh enabled state until initial registration succeeds. Existing enabled devices that temporarily fail reconciliation remain locally enabled but blocked/pending, with no false success.
- Keep dirty snapshots and unsynced rules pending on failures; mark sync success only after accepted responses. Scope the rules hash/TTL by user and install, matching the snapshot queue boundary.
- Capture and revalidate scope after asynchronous waits. A completion from a prior account cannot clear the new account's queue/status or send its data. Preserve current snapshot revisions, cross-tab ownership, locks, and privacy-limited signals.
- Backend authentication/ownership protections remain enforced. Keep existing error text for compatibility while adding stable codes for missing device and ownership mismatch.
- Both manual sync and activation messages reflect skipped, pending, failed, and completed operations accurately.
- No speculative SQL migration, ownership relaxation, anonymous notification writes, or JWT disabling is required for this missing-row error.

## Acceptance and rollout

Reproduce the missing-record condition in controlled fixtures, then verify register precedes both sync requests and the dirty snapshot becomes clean only after acceptance. Cover initial enable, delayed/failed registration, disabled state with granted permission, signed-out state, slow auth restoration, missing subscription, ownership conflict, scope changes, offline recovery, and a deleted remote row after prior success.

If backend error codes are implemented, deploy the compatible shared helper and all four mutation handlers before the frontend; preserve JWT verification. Frontend handling must still recognize the legacy status/message combination during staggered deployment. Bump the shared release manifest and regenerate production/demo asset keys. Real authenticated PWA reload and Network ordering remain a production verification requirement, as does closing the app and checking actual Push delivery when testing end-to-end notification behavior.
