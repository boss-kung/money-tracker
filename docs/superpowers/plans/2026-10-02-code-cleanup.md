# Code Cleanup Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. The user authorized auditing and fixing the cleanup together in this session.

**Goal:** Remove confirmed obsolete code and unnecessary repeated runtime work while preserving financial and screen behavior.

**Architecture:** Keep the existing global App, Ledger, State Commit and Screen Hooks. Remove private unreachable implementations, reuse one Ledger flow calculation within a reconciliation, consolidate existing render extensions, and write only changed storage payloads with coherent rollback/readback.

**Tech Stack:** Vanilla JS/CSS, static production/demo HTML, node:test, isolated local Chromium.

**Spec:** `docs/CODE_CLEANUP_PLAN.md` and the user's follow-up authorizing implementation together.

## Global Constraints

- Preserve Wallet Baseline, Posted/Scheduled Transaction, Ledger Amount, credit billing, Loan and BNPL semantics.
- Keep existing screen design, feature flags, light/dark, app lock/auth, demo isolation and offline dependencies.
- Leave user-owned `reports/`, `codex-skills` changes, migrations and externally deployed endpoints intact.
- Use the current user workspace. Initial cleanup was kept as local edits; the user subsequently authorized committing and deploying production. Commit only cleanup files and push main to trigger the existing Pages workflow.
- Do not add runtime libraries or a bundler. Bump the shared release contract after production edits.

## Review Focus

- Missing Wallet Baselines must retain the currently displayed balance when initialized.
- Posted date transitions and reward changes must recompute flows instead of reading a stale cache.
- Unchanged storage payloads must still be verified and a failed changed payload must roll back coherently.
- Save failure/duplicate confirmation must not trigger success motion or budget side effects.
- Screen extension order, demo isolation, auth gate and offline asset completeness must survive cleanup.

### Task 1: Baseline and whole-project deletion audit

**Files:** `app_v2.js`, satellite JS, production/demo HTML, CSS, artifact/document references.

- [x] Run the existing test suite and isolated browser smoke/flow counts before edits.
- [x] Verify candidate references including captured methods, inline handlers and demo.
- [x] Remove only confirmed private unused functions, no-op forwarding layers, empty scaffolds and duplicate unreachable motion; keep recovery/preview/backend code with existing purpose.

### Task 2: Reconciliation and storage repeated work

**Files:** `app_v2.js`, `loans_v2.js`, `storage_v2.js`, `tests/runtime_cleanup.test.js`, `tests/storage_schema.test.js`.

**Interfaces:** Keep `App.recalculateWalletBalances({save,recordSnapshot})`, `Storage.saveAll(state): boolean` and existing `persist(reason)`; allow `ensureLedgerBaselines(force, flows)` to receive the same ephemeral flows.

- [x] Add behavioral tests asserting one Ledger scan per reconciliation, correct missing baselines/date transitions and one reconciliation per Loan commit.
- [x] Add storage tests asserting unchanged collection writes are skipped, changed data is persisted, failed saves restore the previous coherent state and readback remains checked.
- [x] Observe the intended failures, implement the changes, run targeted and full tests.

### Task 3: Screen/transaction extension cleanup

**Files:** `app_v2.js`, `screen_hooks.js`, relevant behavioral tests.

- [x] Characterize the existing Transaction list extension order and successful/failing Transaction save effects.
- [x] Consolidate list render motion into named hooks, and only reduce save extensions where ordering and failure behavior are covered by tests.
- [x] Remove verified duplicate DOM processing without changing input behavior; defer speculative observer/boot rewrites until traces prove they are necessary.

### Task 4: CSS, release and documentation

**Files:** CSS where exact equivalent duplicates are proven, `release_manifest.js`, production/demo HTML, `CLAUDE.md`, `docs/CODE_CLEANUP_RESULTS.md`.

- [x] Apply only proven CSS redundancy removals, keeping responsive/dark/flag contexts.
- [x] Update stale architecture guidance and release cache keys with `scripts/update-release-version.js`.
- [x] Run full tests, JS syntax checks, isolated production/demo/light/dark/saves/storage failure browser checks and compare baseline results.
- [x] Independent review completed; repaired both material findings and reviewer confirmed resolution. Measured scope/limitations are documented.

## Verification record

See `docs/CODE_CLEANUP_RESULTS.md`. Full suite: 250 passing; 84 JS syntax checks; isolated browser financial flows and screen/theme checks; 39 cached assets and offline reload. Production deployment is authorized by the user and uses the existing GitHub Pages workflow on main.
