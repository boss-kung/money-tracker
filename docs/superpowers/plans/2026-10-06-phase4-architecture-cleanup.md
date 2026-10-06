# Phase 4 — Architecture Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce runtime patch-chain risk by moving high-risk cross-cutting behavior behind explicit extension seams and stable domain interfaces.

**Architecture:** Keep one canonical implementation for each core flow. Feature modules register extensions or middleware instead of replacing core methods. Preserve existing UI behavior and durable-commit semantics while making ownership and ordering visible in source.

**Scope:** This phase is intentionally incremental. Each patch chain is flattened independently and verified before the next one is touched.

## Global Constraints

- Preserve the public `App.*` interfaces used by existing screens and tests.
- Do not change financial calculations while moving orchestration code.
- Every durable mutation must continue to gate success UI on a successful commit.
- Keep the static GitHub Pages runtime dependency-free and compatible with the current cache manifest.
- Do not claim Supabase integration success without a configured test database.

## Review Focus

- Duplicate and rapid double-submit protection belongs at the transaction-save boundary.
- Report views are registered extensions, not nested replacements of `renderReports`.
- Delete-flow behavior must remain ordered and undo-safe when converted to middleware.
- Architecture changes must be observable through focused static tests, not only browser behavior.

### Task 1: Flatten transaction-save orchestration

**Files:**
- Modify: `app_v2.js`
- Modify: `tests/commit_result_enforcement.test.js`
- Create: `tests/phase4_architecture.test.js`

- [x] Move duplicate detection and rapid double-submit protection into the canonical `App.saveTx(forceSkipDuplicateCheck)` implementation.
- [x] Preserve the explicit confirmation retry path and clear the in-progress guard on every commit failure/catch path.
- [x] Remove the later `_prevSaveTx` wrapper patch.
- [x] Add a static architecture test that prevents the wrapper from returning.

### Task 2: Register report views through an extension seam

**Files:**
- Modify: `app_v2.js`
- Modify: `tests/phase4_architecture.test.js`

- [x] Let the canonical `App.renderReports` compose default views with registered extensions.
- [x] Register trend and calendar renderers through `App._reportViewExtensions`.
- [x] Preserve the existing chips, selected view behavior, and renderer output.
- [x] Add a static test that prevents `renderReports` replacement patches.

### Task 3: Flatten delete-flow patch chains

**Files:**
- Modify: `app_v2.js`
- Create/modify: focused delete-flow tests

- [x] Define an explicit delete middleware registry with a documented ordering contract.
- [x] Move shared reimbursement, recurring/upcoming, and animation behavior into middleware entries.
- [x] Keep the canonical delete/undo transaction inside one durable commit boundary.
- [x] Add regression coverage for the middleware ordering and existing rollback paths.

### Task 4: Consolidate domain service boundaries

**Files:**
- Modify: domain/runtime modules selected after Task 3 review
- Create/modify: service contract tests

- [x] Identify remaining calculation ownership split across `app_v2.js` and feature modules.
- [x] Move one bounded calculation at a time behind a stable service interface.
- [x] Remove only wrappers proven redundant by focused tests.

### Task 5: Phase 4 verification and handoff

- [x] Run the complete Node test suite and syntax checks after each cleanup slice.
- [x] Reconfirm the existing Deno checks for backend contracts from Phase 3.
- [x] Run `git diff --check` and review the final diff for unrelated changes.
- [x] Re-run Supabase migrations once credentials or a test database are available.
- [x] Commit or open a PR when repository write permissions permit Git metadata updates.
