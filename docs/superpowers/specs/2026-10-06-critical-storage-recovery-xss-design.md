# Critical Storage, Recovery, and Rendering Hardening Design

**Date:** 2026-10-06
**Scope:** CRITICAL-02, CRITICAL-03, CRITICAL-04 from the Money Tracker audit
**Status:** Approved for implementation

## Goal

Prevent financial state from being overwritten by a stale browser tab, preserve corrupt local payloads for recovery instead of overwriting them at boot, and ensure backup/import data cannot become executable JavaScript through inline event handlers.

## Constraints

- Preserve the existing local-first `localStorage` architecture and synchronous `persist()` contract.
- Do not migrate the application to IndexedDB or rewrite all inline handlers in this change.
- Existing valid backups and generated IDs must remain importable.
- A failed or conflicting write must not notify cloud sync as a durable commit.
- Recovery mode must preserve the original corrupt raw value and must never silently reset it.
- Security fixes must cover production app and satellite modules that render dynamic inline handlers.

## Design

### CRITICAL-02 — Revisioned local commits with a synchronous lease

Add a metadata key `mt_state_meta` containing `{ revision, writerId, savedAt }`.
`Storage.init()` reads the metadata and exposes the current local revision. Each tab installs a `storage` listener and, when available, a `BroadcastChannel` listener. A newer remote revision marks the local storage adapter stale; it must not silently overwrite the newer snapshot.

`Storage.saveAll(state)` will:

1. Read the current metadata and reject with a conflict when its revision differs from the tab's hydrated revision.
2. Acquire a short-lived localStorage lease under `mt_state_lock`. Lease acquisition writes a random owner token and immediately reads it back; the entire synchronous save remains inside the same JavaScript task, preventing another tab's synchronous save from interleaving.
3. Re-read metadata after acquiring the lease and repeat the revision check.
4. Write the collection snapshot and verify every written payload.
5. Write `mt_state_meta` with revision + 1 only after collection verification succeeds.
6. Roll back both collection keys and metadata on failure, then release the lease.

Conflict and storage failures remain boolean failures to preserve callers, but `Storage.lastConflict`/`lastSaveError` distinguish them. `persist()` shows a conflict-specific recovery message and does not call the cloud dirty hook because State Commit only runs after `saveAll()` returns true.

### CRITICAL-03 — Structured hydration and recovery mode

Add a raw reader that distinguishes `missing`, `valid`, `corrupt`, and `unavailable` values. `Storage.init()` records corrupt collection names and raw payloads in `Storage.hydrationStatus`, writes a bounded quarantine record under a dedicated key, and returns safe defaults for rendering only.

When any state collection is corrupt:

- `Storage.recoveryMode === true`.
- Normal `Storage.saveAll()` calls return false without writing collection defaults.
- Boot skips the billing-hydration persistence step.
- The app exposes recovery actions: export current in-memory/quarantined data, restore a valid local backup, or explicitly reset the affected collection.
- Recovery writes require an explicit one-shot authorization and clear recovery mode only after the new snapshot and metadata verify successfully.

The original corrupt raw string remains available in quarantine until the user completes recovery or explicitly resets it.

### CRITICAL-04 — Context-safe dynamic rendering and import boundaries

Use `MTSafeRender.jsArg()` for every dynamic value interpolated into an executable HTML event attribute. Existing `escapeHtml()` remains the encoder for text, HTML attributes, and form values. Convert dynamic arguments in `app_v2.js`, `bnpl.js`, `loans_v2.js`, `split_bill.js`, `notifications_v2.js`, `onboarding.js`, and any other production renderer found by the static test.

Backup normalization will validate entity IDs with a conservative allowlist, reject or drop malformed identifiers with a warning, and remove executable-looking fields (`action`, `open`, `skip`, `handler`, `fn`, `code`, and event-prefixed keys) from imported rows. Upcoming-item actions must be derived from typed application state, never trusted from backup fields.

Add a source-level regression test that fails when a dynamic event handler uses `esc(...)` or raw imported executable fields, plus a hostile-ID runtime test proving that HTML attribute decoding cannot escape a single JavaScript argument.

## Error handling and UX

- Conflict: retain the user's in-memory edit, reject the overwrite, show “ข้อมูลถูกแก้ไขจากแท็บอื่น กรุณารีโหลดก่อนบันทึกซ้ำ” and provide a reload/recovery path.
- Corrupt storage: show a recovery warning with the affected collections and keep export available.
- Invalid imported IDs: keep valid rows, skip invalid rows, and show counts/reasons in the existing import preview.
- Any failed durable write remains a failure; success toasts and cloud dirty markers happen only after verified commit.

## Verification contract

- Node tests cover two stale storage clients, lease expiry/release, metadata rollback, corrupt-key quarantine, recovery-mode write blocking, explicit reset/restore authorization, and hostile dynamic IDs.
- Full `node --test tests/*.test.js` remains green.
- `deno test supabase/functions/_shared/*_test.ts` and `deno check supabase/functions/*/index.ts` remain green.
- All root/demo JavaScript passes `node --check` and `git diff --check` passes.
- Browser smoke test covers boot with corrupt localStorage, recovery UI/export, two-tab stale-save rejection, and imported hostile IDs rendered/clicked without code execution.

## Non-goals

- Removing all inline event handlers or removing CSP `unsafe-inline` in this change; that is a follow-up once all dynamic handlers are converted.
- Replacing localStorage with IndexedDB.
- Refactoring unrelated `App.*` patch chains.
