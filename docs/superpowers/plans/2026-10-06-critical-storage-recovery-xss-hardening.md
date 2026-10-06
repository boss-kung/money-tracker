# Critical Storage, Recovery, and XSS Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stale-tab financial overwrites, preserve corrupt local data for recovery, and close backup/import-driven stored XSS in dynamic inline handlers.

**Architecture:** Keep the existing synchronous localStorage interface. Add a revision metadata record and short synchronous lease around `Storage.saveAll()`, add structured hydration/recovery state that blocks implicit writes, and use context-safe JavaScript literals plus import boundary validation for executable attributes. Each critical issue is implemented as an independently testable task before the next boundary is changed.

**Tech Stack:** Vanilla JavaScript, browser `localStorage`/`BroadcastChannel`/`storage` events, Node.js built-in `node:test`, static source assertions, existing Supabase-free browser smoke harness.

**Spec:** `docs/superpowers/specs/2026-10-06-critical-storage-recovery-xss-design.md`

## Global Constraints

- Preserve the existing local-first `localStorage` architecture and synchronous `persist()` contract.
- Do not migrate the application to IndexedDB or rewrite all inline handlers in this change.
- Existing valid backups and generated IDs must remain importable.
- A failed or conflicting write must not notify cloud sync as a durable commit.
- Recovery mode must preserve the original corrupt raw value and must never silently reset it.
- Security fixes must cover production app and satellite modules that render dynamic inline handlers.

## Review Focus

- Two tabs hydrate the same revision, one commits, and the stale tab must be rejected without changing any collection.
- A corrupt collection must remain byte-for-byte recoverable after boot, billing hydration, and an attempted ordinary mutation.
- An explicit recovery restore/reset must be the only path allowed to replace a quarantined collection.
- Hostile IDs and executable-looking imported fields must remain inert when rendered and clicked.
- A quota/readback failure must not advance the revision or trigger cloud dirty-sync.

---

### Task 1: Revisioned local commit and stale-tab rejection

**Files:**
- Modify: `storage_v2.js:Storage metadata, init(), saveAll()`
- Modify: `app_v2.js:persist()` and boot initialization around `init()`
- Modify: `state_commit.js:commit()` only if conflict metadata needs to be propagated
- Test: `tests/storage_schema.test.js` and new `tests/storage_concurrency.test.js`

**Interfaces:**
- Produces `Storage.stateRevision: number`, `Storage.isStale: boolean`, `Storage.lastConflict`, and `Storage.saveAll(state, options?) -> boolean`.
- `Storage.saveAll()` preserves the current boolean contract; conflict is represented by `Storage.lastConflict` and does not write any collection.
- `Storage.init()` hydrates the current `mt_state_meta` revision and installs cross-tab listeners once.

- [ ] **Step 1: Write the failing stale-client test**

  Create two isolated Storage VM instances sharing one fake localStorage. Hydrate both at revision 0, let client A save a transaction, then assert client B's stale `saveAll()` returns `false`, sets `lastConflict`, and leaves A's transaction as the persisted payload. Add a second test that a successful save increments metadata exactly once.

- [ ] **Step 2: Run the focused tests to verify they fail**

  Run: `node --test tests/storage_concurrency.test.js`

  Expected: FAIL because no state metadata or stale-save rejection exists.

- [ ] **Step 3: Implement revision metadata and synchronous lease in `storage_v2.js`**

  Add `mt_state_meta` and `mt_state_lock` constants, a per-tab writer token, metadata read/write helpers, lease acquisition with token readback and expiry, and revision checks before and after the lease. Include metadata in the rollback snapshot. Broadcast successful revisions through `storage` and `BroadcastChannel` listeners; mark the adapter stale when a remote revision is newer.

- [ ] **Step 4: Make `persist()` surface conflicts without cloud dirty notification**

  In `app_v2.js`, use `Storage.lastConflict` to show a reload/recovery message distinct from generic write failure. Do not add any after-commit hook on rejected writes; preserve the existing `StateCommit` success boundary.

- [ ] **Step 5: Run focused and existing storage tests**

  Run: `node --test tests/storage_concurrency.test.js tests/storage_schema.test.js tests/p1_regressions.test.js`

  Expected: all focused tests pass and existing rollback/readback assertions remain green.

- [ ] **Step 6: Commit the isolated task**

  Commit message: `fix: reject stale local state commits`

### Task 2: Corrupt-storage quarantine and explicit recovery mode

**Files:**
- Modify: `storage_v2.js:load(), init(), saveAll(), reset()`
- Modify: `app_v2.js:init()` and recovery rendering/actions near backup/import controls
- Test: `tests/storage_recovery.test.js` and `tests/storage_schema.test.js`

**Interfaces:**
- Produces `Storage.hydrationStatus = { recoveryMode, corruptCollections, quarantinedAt }`.
- Produces `Storage.beginRecoveryWrite()`/`Storage.endRecoveryWrite(success)` for one explicit restore/reset operation.
- `Storage.saveAll(state)` returns `false` in recovery mode unless an authorized recovery write is active.

- [ ] **Step 1: Write failing corruption and recovery tests**

  Assert that malformed `mt_transactions` is reported as corrupt, its original raw string is copied to quarantine, `Storage.init()` returns a safe default without changing the original key, ordinary `saveAll()` is rejected, and an explicit authorized write replaces the key only after successful verification. Assert that a failed authorized write leaves recovery mode active.

- [ ] **Step 2: Run the focused tests to verify they fail**

  Run: `node --test tests/storage_recovery.test.js`

  Expected: FAIL because parse failure currently collapses to `null` and normal boot writes defaults later.

- [ ] **Step 3: Implement structured raw reads and quarantine**

  Add a private raw reader that distinguishes missing/valid/corrupt/unavailable, retain `load()` compatibility for existing callers, collect corrupt state descriptors during `init()`, and write a bounded quarantine record without removing the source key. Do not treat a corrupt value as an ordinary missing default.

- [ ] **Step 4: Block implicit writes and skip boot billing hydration**

  Make normal `saveAll()` refuse writes while recovery mode is active. In `app_v2.js:init()`, do not call `persist('billing-hydration')` when `Storage.hydrationStatus.recoveryMode` is true. Expose a small recovery notice with affected collection names and actions wired to existing export, restore-backup, and reset flows.

- [ ] **Step 5: Gate explicit restore/reset writes**

  Wrap `_applyBackupPayload()` and the explicit reset path with the one-shot recovery authorization. Clear recovery mode only after collection readback and metadata verification succeed; keep the quarantine record available until that point. Preserve emergency export from in-memory state even while ordinary writes are blocked.

- [ ] **Step 6: Run focused and full storage tests**

  Run: `node --test tests/storage_recovery.test.js tests/storage_schema.test.js tests/p1_regressions.test.js`

  Expected: all tests pass, including existing failed-write rollback coverage.

- [ ] **Step 7: Commit the isolated task**

  Commit message: `fix: quarantine corrupt local state during boot`

### Task 3: Context-safe rendering and import sanitization

**Files:**
- Modify: `safe_render.js` (only if helper coverage needs extension)
- Modify: `app_v2.js` dynamic event attributes, `Storage.normalizeBackupPayload` call sites, and upcoming-item action derivation
- Modify: `bnpl.js`, `loans_v2.js`, `split_bill.js`, `notifications_v2.js`, `onboarding.js` dynamic handler arguments
- Test: `tests/safe_render.test.js`, new `tests/context_safe_render_static.test.js`, and import normalization coverage in `tests/storage_schema.test.js`

**Interfaces:**
- `MTSafeRender.jsArg(value)` remains the single encoder for executable inline JavaScript arguments.
- Imported entity IDs must match the conservative safe-ID pattern and malformed rows are skipped with warnings.
- Imported executable-looking fields are removed before state reaches renderers.

- [ ] **Step 1: Write failing static and runtime security tests**

  Add a source scan that fails on dynamic `onclick`, `onchange`, `oninput`, `onkeydown`, `onfocus`, `onblur`, `onload`, or `onerror` arguments using `esc(...)` or raw imported action strings. Add a hostile-ID normalization test that rejects `x');globalThis.pwned=true;//`, and retain the runtime `jsArg()` execution test proving the argument stays inert.

- [ ] **Step 2: Run the focused security tests to verify they fail**

  Run: `node --test tests/safe_render.test.js tests/context_safe_render_static.test.js tests/storage_schema.test.js`

  Expected: FAIL with existing `esc(...)` event-handler matches and permissive imported object fields.

- [ ] **Step 3: Convert dynamic event arguments to `jsArg()`**

  Replace only executable-context interpolations; keep `escapeHtml()` for visible text, HTML attributes, form values, labels, and CSS values. Cover every production renderer identified by the static scan, including satellite modules. Do not rewrite static handlers or unrelated `App.*` patch chains.

- [ ] **Step 4: Harden backup normalization and derive actions**

  Validate IDs before accepting rows, record skip reasons for the existing import preview, strip event-prefixed/executable fields, and make upcoming-item `open/action/skip` values derive from typed rows rather than backup-provided strings.

- [ ] **Step 5: Run focused security tests and hostile browser probe**

  Run: `node --test tests/safe_render.test.js tests/context_safe_render_static.test.js tests/storage_schema.test.js`

  Expected: no unsafe dynamic handler matches; hostile IDs remain inert after HTML attribute decoding and import preview reports skipped rows.

- [ ] **Step 6: Commit the isolated task**

  Commit message: `fix: close backup-driven inline handler injection`

### Task 4: Cross-boundary verification and review

**Files:**
- Test: all existing `tests/*.test.js`
- Test: `supabase/functions/_shared/*_test.ts`
- Verify: root/demo JavaScript files and local browser smoke test

- [ ] **Step 1: Run the complete verification suite**

  Run in parallel where independent:

  ```bash
  node --test tests/*.test.js
  deno test supabase/functions/_shared/*_test.ts
  deno check supabase/functions/*/index.ts
  for f in ./*.js demo/*.js; do node --check "$f" || exit 1; done
  git diff --check
  ```

  Expected: 0 failures, all eight Edge Functions type-check, syntax checks pass, and no whitespace errors are reported.

- [ ] **Step 2: Run browser smoke and security scenarios**

  Serve on port 8765 and verify normal production boot, corrupt-storage recovery without raw-key overwrite, two-tab stale save rejection, import of hostile IDs, and no console/runtime execution of the hostile payload.

- [ ] **Step 3: Review the diff against the spec**

  Confirm no production files outside the three critical boundaries changed, recovery writes are explicit, every new test exercised the pre-fix failure, and cloud dirty-sync is only reached after durable success.

- [ ] **Step 4: Final commit/review handoff**

  Commit message: `fix: harden local state recovery and dynamic rendering`.
