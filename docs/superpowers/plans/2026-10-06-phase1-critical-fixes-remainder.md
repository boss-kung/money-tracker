# Phase 1 Critical Fixes Remainder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining Phase 1 critical fixes for account-delete isolation and durable mutation-result handling.

**Architecture:** Enforce notification ownership at the database boundary with a cleanup-and-cascade migration, and make account deletion explicitly clean owned rows before auth deletion. Add one shared client-side commit helper that rolls back in-memory mutations when persistence fails, then apply it to the remaining recurring, category, and goal mutation flows.

**Tech Stack:** Supabase SQL migrations, Supabase Edge Functions (Deno/TypeScript), browser JavaScript, Node test runner.

**Spec:** `reports/full-code-audit-2026-10-06.md` (FIX PLAN Phase 1 items 1.1 and 1.5; CRITICAL-01 and BUG-01).

## Global Constraints

- Existing user data must not be silently exposed to another account.
- No success UI may be shown when `persist()` reports failure.
- Orphan notification rows must be removed before constraints become stricter.
- Preserve unrelated user changes already present in the worktree.

## Review Focus

- Existing orphan notification rows: migration removes them before adding non-null/cascade ownership.
- Account deletion cleanup failure: endpoint aborts before auth deletion and returns an error.
- Push cron rows with null ownership: cron queries exclude them even before migration rollout completes.
- Persistence failure after recurring/category/goal mutation: state is restored and success UI is skipped.
- Persistence success after mutation: normal navigation/toast behavior remains unchanged.

---

### Task 1: Account-delete cascade and notification ownership

**Files:**
- Create: `supabase/migrations/202610060001_notification_account_delete_cascade.sql`
- Modify: `supabase/functions/delete-account/index.ts`
- Modify: `supabase/functions/send-daily-expense-reminders/index.ts`
- Modify: `supabase/functions/send-custom-notification-rules/index.ts`
- Test: `tests/account_delete_cascade.test.js`

**Interfaces:**
- Produces: named `ON DELETE CASCADE` ownership constraints and non-null `user_id` columns for notification tables; delete endpoint explicitly removes owned rows before `auth.admin.deleteUser`.

- [ ] **Step 1: Write the failing static contract tests** for the migration, delete endpoint cleanup ordering, and null-owner cron filters.
- [ ] **Step 2: Run the focused test and verify it fails** because the migration/cleanup/filter contract is absent.
- [ ] **Step 3: Add the migration and endpoint/cron guards** with cleanup before auth deletion and fail-closed error handling.
- [ ] **Step 4: Run the focused test and verify it passes.**
- [ ] **Step 5: Run SQL/source syntax checks** for the changed edge-function files.

### Task 2: Commit-result enforcement for remaining mutation flows

**Files:**
- Modify: `app_v2.js`
- Test: `tests/commit_result_enforcement.test.js`

**Interfaces:**
- Consumes: `persist(): boolean` and existing flow-specific state objects.
- Produces: `commitMutation({ mutate, rollback, onSuccess })` shared helper; recurring, category/merchant, and goal mutations gate success behavior on a successful commit and restore prior state on failure.

- [ ] **Step 1: Write the failing static contract tests** for the shared helper and each target flow.
- [ ] **Step 2: Run the focused test and verify it fails** against current bare `persist()` calls.
- [ ] **Step 3: Implement the helper and convert target mutation flows** while preserving successful UX.
- [ ] **Step 4: Run the focused test and verify it passes.**
- [ ] **Step 5: Run the full JavaScript/Deno regression suites.**
