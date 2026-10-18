# Notification Registration Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Delegate only when authorized by the user or applicable repository instructions.

**Goal:** Prevent notification rules/snapshot 403 errors by registering the authenticated user's existing device before sync and recovering a missing registration once.

**Architecture:** Add a small lifecycle coordinator shared by all notification mutation paths. Browser subscription, authentication, local notification intent, and server registration become distinct states. Preserve server ownership enforcement and the existing durable snapshot queue.

**Tech Stack:** Vanilla JS/IIFE, Node `node:test`, Supabase Edge Functions/Deno, GitHub Pages/PWA. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-notification-registration-recovery-design.md`.

**Baseline:** GitHub `main` at `ad79ecfbc31608f160c96952146d915164472ecc`, release `2026.10.03-audit-r131`. Re-read HEAD before execution and update line anchors if it advanced. The current local feature branch is not the implementation base.

## Global Constraints

- Every notification mutation uses a captured authenticated user, session token, and installation scope.
- No background sync when the master setting is off, permission is missing, the app is offline, or authenticated context is unavailable.
- Reuse `pushManager.getSubscription()`; never silently request permission or create a new subscription in the background.
- A known missing-device 403 can invalidate readiness, re-register, and retry the original request at most once.
- Another-owner 403 must stop and remain visible; do not transfer ownership or treat all 403 responses as recoverable.
- Backend authentication/ownership protections remain enforced.
- Preserve current snapshot revisions, cross-tab ownership, locks, and privacy-limited signals.
- No new npm dependencies; use the repository's Node/Deno test conventions and shared release manifest.

## Review Focus

- A pending registration fails: local status must not claim enable/sync success; queued work stays pending. Owned by Task 2.
- Permission is granted but master is off: timers and manual refresh must not re-enable or send background data. Owned by Task 2.
- Account/install scope changes while registration or sync is awaiting: old completion cannot authorize new work or clear new status. Owned by Task 2.
- A previously registered remote row disappears: one recovery attempt, then actionable failure without a retry storm. Owned by Tasks 1–2.
- Cached JSON differs from the current browser subscription, or no subscription exists: use the browser subscription and require user action when absent. Owned by Task 2.

---

### Task 1: Preserve error identity and enforce authenticated transport

**Files:**
- Modify: `supabase/functions/_shared/supabase.ts:12–19,42–45,57–79`.
- Modify: `supabase/functions/{register-notification-device,sync-notification-rules,sync-notification-snapshot,update-notification-preferences}/index.ts` error-response branches.
- Modify: `notifications_v2.js:219–250`.
- Create: `tests/notification_lifecycle.test.js` with a browser VM fixture for the actual module, queue and public actions.
- Create: `supabase/functions/_shared/notification_auth_test.ts` behavioral guard tests using mocked table results.

**Interfaces:**
- `RequestAuthError` retains `message`/`status` and adds `code: 'UNAUTHORIZED' | 'DEVICE_NOT_REGISTERED' | 'DEVICE_OWNERSHIP_MISMATCH'`.
- Mutation handlers serialize `{error: string, code?: string}`; arbitrary failures remain 500 and are not labeled as missing devices.
- Internal `captureNotificationScope()` returns `{userId, installId, accessToken, key}` or `null`.
- `callFunction(name, payload, {scope, timeoutMs})` uses the supplied captured scope, verifies it is still current before dispatch, and throws an Error with `status`, `code`, and `functionName` for failed responses. It does not fall back to anon credentials for user mutations.
- Legacy recovery recognition is exactly HTTP 403 plus `error === 'Notification device is not registered'`; retain compatibility with the current deployed backend.

- [ ] Write backend tests for no row, correct owner, another owner, anonymous claim allowed only on registration, and table query error.
- [ ] Write frontend tests for structured/legacy 403 distinction, missing session skipping dispatch, and a captured scope invalidated before dispatch.
- [ ] Run the new tests before implementation and verify failures reflect absent error identity/auth guarding.
- [ ] Implement the compatible error codes and transport contract; preserve existing server guard calls and messages.
- [ ] Run `node --test tests/notification_lifecycle.test.js tests/notification_contract.test.js` and `deno test supabase/functions/_shared/notification_auth_test.ts`.
- [ ] Review diff and commit this independently testable contract.

### Task 2: Reconcile registration before every sync path

**Files:**
- Create: `notification_device_lifecycle.js` as an IIFE/CommonJS-compatible coordinator, separately testable.
- Modify: `notifications_v2.js:285–290,365–415,545–565,606–699,1028–1035,1068–1105,1149–1156`.
- Modify: `auth_sync.js` at successful session restoration/setSession and signOut transitions.
- Create: `tests/notification_device_lifecycle.test.js`.
- Extend: `tests/notification_lifecycle.test.js`, `tests/notification_sync.test.js` and `tests/auth_sync_security.test.js` as appropriate.
- Modify: production/demo script loading to load the coordinator before `notifications_v2.js`; add to release assets in Task 3.

**Interfaces:**
- `MTNotificationDeviceLifecycle.create({readScope, isEnabled, readSubscription, registerDevice, onStatus})` produces `ensureReady({activation=false})`, `invalidate(scopeKey)`, and `reset()`.
- `ensureReady` returns `{status:'ready', scope}` or `{status:'skipped', reason}`. Expected reasons include disabled, unauthenticated, permission-required, subscription-required, offline, and scope-changed. Registration errors propagate as the Task 1 typed transport error.
- Readiness and in-flight registration are keyed by captured `userId:installId`; concurrent callers reuse the same promise. Reset increments a generation so old promises cannot repopulate readiness.
- `runRegisteredMutation(name, payload, options)` ensures readiness, calls the Task 1 transport, and on known missing-device error invalidates/reconciles once before one retry. It never recursively retries registration.
- Registration itself calls raw `callFunction('register-notification-device', ...)` with captured scope to avoid recursive prerequisites.
- Add a single auth lifecycle event, `mt:auth-state-changed`, dispatched when current user/session is ready or signed out. Notification listeners reset registration state and schedule reconciliation for the current authenticated context. Ensure the cached restore path also dispatches and avoid duplicating token-refresh scheduling.

- [ ] Add failing behavioral tests for both sync requests with enabled/registered-missing state: expected network order starts with register, then preferences, then rules/snapshot; no sync is allowed before register resolves.
- [ ] Add tests for initial activation register rejection, delayed registration plus commit debounce, concurrent snapshot/rules callers, and reload with a valid existing subscription.
- [ ] Add tests for granted permission with disabled master, signed-out state, missing subscription despite cached JSON, and current browser subscription differing from cache.
- [ ] Add tests for auth arriving after the boot delay, sign-out/account change/install change during awaited work, stale registration completion, and user-scoped rules TTL/hash invalidation.
- [ ] Add tests for a row deleted after prior success: missing-device triggers one register+retry; persistent missing-device and ownership mismatch stop; transient offline/server failure leaves dirty snapshot/rules pending.
- [ ] Add manual-action tests: skipped operations cannot show sync success; partial sync failure remains visible.
- [ ] Run tests and verify baseline behavior fails the lifecycle assertions before writing coordinator/integration code.
- [ ] Implement the coordinator and wire registration prerequisites into snapshot transport, custom rules, preferences, manual sync and enable/disable flows. Queue retries/visibility/storage/timers therefore use the same gate.
- [ ] Use actual browser subscription reads for recovery; do not unsubscribe/recreate an existing subscription unnecessarily. Initial activation persists confirmed `enabled=true` after register succeeds; in-flight activation cannot open the background gate. Keep failed subscription available for explicit retry.
- [ ] Send preferences after initial/recovered registration and before dependent sync, respecting that registration currently upserts defaults. Do not continuously re-register on every timer, which could reset preferences.
- [ ] Scope custom-rule hash/time keys by user/install; do not adopt legacy global hashes as successful sync for a new scope.
- [ ] Revalidate the captured scope after every awaited registration/preferences/mutation operation before writes to local success markers or status.
- [ ] Keep original queue tests green, adding integration assertions rather than replacing revision/cross-tab coverage.
- [ ] Run the focused lifecycle, queue, snapshot, contract and auth tests; review diff and commit.

### Task 3: Release verification and controlled rollout

**Files:**
- Modify: `release_manifest.js`, `index.html`, `demo/index.html` (via release-version script).
- Modify: `docs/credit-billing-verification.md` or create a dated verification record covering this fix.

**Interfaces:**
- Coordinator is loaded before notification consumers in both entrypoints and included in `coreAssets`.
- Existing server/client error contracts remain compatible during staggered rollout.

- [ ] Choose the next unused release version at execution time, update `release_manifest.js`, then run `node scripts/update-release-version.js`.
- [ ] Run `node --test tests/*.test.js` and the backend auth/snapshot/rules/delivery Deno tests.
- [ ] Run `deno check` on all four mutation handlers and `git diff --check`; verify production/demo/offline asset ordering.
- [ ] Browser smoke with controlled fixtures: delayed registration, failed activation, reload recovery, disabled switch, late auth and offline/resume. Assert request ordering and truthful status. If settings markup changes, read `docs/UI_DESIGN_SPEC.md` first and check light/dark/mobile.
- [ ] Record evidence and limitations. Local mocks do not certify production database state or real Push delivery.
- [ ] Prepare a reviewable diff/PR and deployment checklist. Execution of remote deployment is a separate user-authorized action; no production changes are part of this planning request.
- [ ] On authorized rollout, deploy the shared helper plus four compatible mutation functions, retaining JWT verification; deploy Pages release afterward. Verify independently since Pages CI does not deploy Supabase.
- [ ] Verify authenticated PWA Network trace: one successful registration before sync, successful rules/snapshot, no repeat 403 on reload/visibility/online. Confirm expected backend ownership mismatch remains rejected.

## Plan self-review

The confirmed error maps to the registration prerequisite, not a JWT/RLS bypass. Each required behavior in the diagnosis maps to Task 1 (error/auth contract), Task 2 (all callers/lifecycle/retry/status), or Task 3 (asset/deployment compatibility). The historical reason for the missing row remains unresolved and must not be reported as a proven migration or release regression. A database schema change is not presently justified.
