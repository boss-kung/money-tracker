# Notification registration recovery verification

Date: 2026-10-03 (Asia/Bangkok). Base: GitHub main `ad79ecf`. Branch: `codex/notification-registration-recovery`. Release: `2026.10.03-notifications-r132`.

## Result

Notification snapshot/rules/preferences writes reconcile a device registration using the actual browser subscription before sync. Concurrent writers share registration. A missing-device 403 can register again and retry once; another owner's device remains rejected. The frontend understands both legacy error text and stable backend error codes.

Initial enable preserves the local off state until registration and preferences succeed, reuses existing subscriptions, and does not claim success after a partial sync failure. Disabled, unauthenticated, permission-denied and offline states do not start background requests. Auth restoration schedules recovery; account/session changes invalidate old completions. Rules success hashes and timestamps are now scoped by user/install.

Snapshot persistence/revisions and cross-tab locks remain in place. A separate in-memory context generation guards an old response when the same account signs out and returns. Device reconciliation failures remain pending and are throttled; server/browser deadlines remain bounded. Pending registration settles before disable is written so a late enable cannot override it.

## Verification evidence

- Baseline Node suite: 266 passed, 0 failed.
- Implemented Node suite: 301 passed, 0 failed, including 35 added behavioral tests across transport, lifecycle, queue and auth events.
- Deno auth/snapshot/rule/delivery tests: 13 passed, 0 failed.
- `deno check` passed for register device, update preferences, sync rules and sync snapshot.
- `git diff --check` passed.
- Browser synthetic fixtures: all six cases displayed PASS: reload recovery, delayed registration, failed activation, disabled switch, authentication arriving late, offline then online. The fixtures execute the release's actual notification code/queue/coordinator in browser frames; subscription, auth and HTTP responses are synthetic. Successful traces begin register → preferences → rules/snapshot. They do not send production API requests.
- Browser application smoke: demo dashboard/settings loaded and showed r132; notification section rendered at 390×844 in light/dark without horizontal overflow; original theme/viewport restored. Production entry showed the Google authentication gate. An initial scratch fixture produced an IAB `MutationObserver.observe` instrumentation error; dynamic script loading was replaced with normal script loading, with no subsequent error logged during the repeated fixture/app smoke. None of the loaded notification modules uses MutationObserver. This is recorded separately from application assertions.

Tests were written and observed failing before fixes for transport identity/auth guarding, registration ordering, failed activation, disabled state, late auth scheduling, scope changes, bounded retries, pending disable, same-scope session response rejection, subscription lookup timeout and truthful registration status. The old queue's paid-debt/cross-tab/offline regression coverage is retained.

## Implementation decisions

- Use a native isolated worktree from latest main; preserve the user's existing feature checkout. Cost: the fix must be integrated from the new branch.
- Throttle automatic registration retries for 60 seconds and retain ownership conflict until lifecycle reset; bound browser subscription lookup to 10 seconds. Cost: a transient failure can delay recovery by up to a minute.
- Add optional `readContext()` to the queue instead of changing its persistent user/install storage key. Cost: one optional interface; existing revision continuity remains intact.
- Include the coordinator in the offline manifest with its integration, and wait for a pending registration before disable. Cost: disable can wait for the bounded in-flight request.

## Deployment checklist (not executed)

- Deploy `register-notification-device`, `update-notification-preferences`, `sync-notification-rules`, and `sync-notification-snapshot` with their compatible shared error helper; retain JWT verification and ownership checks.
- Deploy Pages assets for r132 afterward. Pages CI does not deploy Edge Functions.
- On an authenticated real PWA/device, verify successful register/preferences precede sync and repeat reload/visibility/online does not produce the reported 403.
- Verify an ownership conflict is still rejected, disabled settings remain disabled, and accepted payment snapshot suppresses the obsolete reminder.
- Verify real closed-app Push delivery. Local mocks and browser fixtures do not certify real device delivery, database concurrency, or production row state.

No SQL migration, production database write, push, merge, PR creation, or remote deployment was performed for this implementation.
