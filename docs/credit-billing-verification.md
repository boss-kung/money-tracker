# Credit billing and notifications verification

Date: 2026-10-02. Branch: `codex/credit-billing-notifications`. Release: `2026.10.02-credit-r125`.

## Implemented coverage

| Original finding | Implementation and regression evidence |
|---|---|
| Opening debt returns after rollover | Persisted opening statement anchor; migration idempotency, settled baseline rollover tests |
| Advance/extra payments disappear | Chronological satang allocation, explicit target then other balances, credit carry and provenance tests |
| Statement credits do not reduce bills | Income/transfer credits allocated into statement balances; credit/payment flow tests |
| Reminders require opening app daily | Server ages Bangkok calendar-day signals; prior-day and late-cron Deno evaluator tests |
| Partial payment suppresses reminders | Remaining statement balance drives dashboard and snapshots; partial-payment regression |
| Calendar shows only first statement | All outstanding statements retained; multi-statement projection tests |
| Calendar double counts scheduled payment | Planned allocation and unplanned cash requirement; discounted scheduled cash and AI/finance consumers |
| Overdue becomes due today | Signed day sanitizer and distinct due/overdue evaluator rules |
| Payment does not refresh snapshot | Durable commit queue, offline retry, in-flight change, revision conflict and cross-tab tests |

Independent review found and verified additional regressions: cycle setting changes reassigned historical purchases, future tagged payments moved baseline into the open cycle, self-transfers created false credit, and stale tabs overwrote newer paid snapshots. Fixes preserve closed periods and transitional boundaries, exclude future metadata anchors, ignore net-zero transfers, and gate cross-tab uploads by ownership plus revisions present at hydration. Separate reload/day-change and commit-before-debounce race regressions are covered. Late authentication uses scope revisions captured at queue creation. Dirty commits advance the shared revision immediately, before network upload.

## Executed checks

- `node --test tests/*.test.js`: **235 passed, 0 failed**. Baseline before changes: 198.
- `deno test supabase/functions/_shared/notification_snapshot_test.ts supabase/functions/_shared/notification_rules_test.ts supabase/functions/_shared/notification_delivery_test.ts`: **9 passed, 0 failed**.
- `deno check` on the three changed Edge Functions: passed.
- `git diff --check`: passed.
- Integration fixture: opening debt → purchase → partial discounted payment → statement cashback → full settlement → month/year rollover. Ledger, billing, calendar cash requirement and numeric debt snapshots agree.
- Browser smoke: demo starts; statement selector changes amount from 14,960 to 2,550; dashboard shows overdue and upcoming bills; calendar lists both and navigates to the selected historic statement; opening debt has an inferred-date warning/correction control. Credit detail inspected at 390×844; production entry shows the normal authentication gate. No captured browser console errors on either entry.
- Release manifest includes new modules; production/demo asset versions updated from the shared release contract.

## Limitations at implementation verification

Local Supabase cannot run: Docker daemon is unavailable. SQL migrations, real ownership/concurrency/lease expiry, and actual Push delivery are **not runtime-certified**. Deno delivery tests use mocked claims/transports; passing these does not prove database atomicity or real delivery. No remote migration, deployment, or Push was attempted during implementation verification; see the subsequent deployment record below.

The full manual QA matrix remains a staging requirement: authenticated production payment flow, rule save/reload, light/dark, hide-money, 360px layout, offline PWA reload/cache update and real closed-app Push. The demo smoke used generated local sample data and did not record a payment.

## Rollout and rollback gates

1. Back up database and export representative encrypted financial data.
2. Apply both additive 20261002 migrations in staging; test ownership rejection, revision races, concurrent delivery claims, expired leases, error retries and disabled devices/rules.
3. Deploy compatible Edge Functions, then client release r125, then force a snapshot refresh.
4. Verify closed-app due delivery, same-day late cron, overdue mode, and payment suppression after accepted sync.
5. Test offline PWA update and the manual QA matrix before production rollout.
6. For rollback, retain wallet v2 metadata and database v2 columns. Prepare a compatible rollback build before rollout; do not publish an older writer that removes metadata or overwrites v2 snapshots.

Offline payments remain unknown to the server until accepted sync. Inferred historical due dates require user correction where old records are insufficient. Delivery leases reduce duplicates but cannot guarantee exactly-once after a transport success/log failure. Interest/minimum payment rules were not invented.

## Implementation rulings

Work stayed in an isolated native worktree. Shared app adapters were edited together, with feature-specific behavioral regressions. Earlier static assertions that discarded surplus or clamped overdue were replaced with the approved behavior. The initial optional hydration call preceded extension registration; it now invokes the metadata-aware durable persist directly. No unrelated architectural rewrite, remote push or deploy was performed. Plan tasks 1–10 have implementation/regression coverage; task 11 code/release checks are done, with environment-dependent database and staging QA explicitly outstanding above.

## Authorized production deployment — 2026-10-02

User authorized local merge, push and deployment. `main` fast-forwarded to `83acfc4`; merged-tree Node235/Deno9/type checks passed. After the user restored Supabase CLI access, linked migration dry-run confirmed only the two new migrations were pending.

- Docker-based full schema dump was unavailable. A schema-only JSON export of affected columns, constraints and existing RPC definitions was saved locally at `/tmp/money-tracker-credit-r125-schema-backup.json`. This is a targeted schema export, not a full database/data backup. Automatic approval review rejected exporting notification user records; none were exported.
- Both additive 20261002 migrations applied successfully to `bwtoyxxwwmsaoaitihqj`.
- Hosted SQL smoke passed for accepted/rejected/legacy revisions, ownership mismatch, active claim deduplication, expired lease reclamation, error retry, disabled rule and restricted RPC execution. Synthetic fixtures ran inside a transaction and were rolled back. Parallel transaction concurrency was not exercised.
- Deployed `sync-notification-snapshot`, `sync-notification-rules`, and `send-custom-notification-rules` with server-side bundling; existing JWT verification retained.
- Real device Push delivery and the complete manual staging matrix remain unverified. Deployment status for the frontend is verified separately through GitHub Actions and live release assets.
