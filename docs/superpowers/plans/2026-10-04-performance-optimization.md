# Money Tracker Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ลดเวลา boot, page navigation และ transaction save-to-visible โดยลดงาน main-thread/DOM/storage ที่ซ้ำ พร้อมรักษาผลลัพธ์ทางการเงินและ rollback เดิม

**Architecture:** เพิ่ม metadata seam ใน State Commit/Storage เพื่อเขียนเฉพาะ dirty collections; เพิ่ม transaction list window/delegated-event seam ใน `app_v2.js`; เพิ่ม page render revision และ idle market scheduler; แยก feature loader สำหรับโมดูลที่ไม่จำเป็นต่อ initial shell และปรับ Service Worker สำหรับ immutable release assets

**Tech Stack:** Vanilla JavaScript, static GitHub Pages PWA, Node `node:test`, Playwright benchmark scripts, Service Worker Cache API

**Spec:** `docs/superpowers/specs/2026-10-04-performance-optimization-design.md`

## Global Constraints

- Preserve `S.transactions` as source of truth and all existing Ledger/billing/reward semantics.
- `persist()` remains the only durable commit entry; failed writes restore every collection written by that commit and emit no success effects.
- Initial interaction target is mobile 4G: LCP ≤2,500 ms, INP ≤200 ms, CLS ≤0.10, Lighthouse performance ≥90 and accessibility ≥95.
- Critical boot JavaScript budget is ≤200 KB gzip; deferred feature groups are ≤80 KB gzip each.
- Transaction window defaults to 40 rows and must keep accurate full-result totals/count, stable row ids, focus, keyboard, screen-reader, delete/undo and reduced-motion behavior.
- No IndexedDB migration, visual-token redesign, financial-formula change, cloud contract change, destructive cleanup, or dependency installation.

## Review Focus

- A failed dirty-key write must roll back both an early-written transaction payload and later wallet/settings payloads; covered in Task 1 storage rollback tests.
- A same-day reward threshold/cap edit must recompute every affected row in deterministic durable order; covered in Task 3 reward-scope tests plus the existing benefit suite.
- Navigating away and back without state/filter changes must reuse DOM, but a save or filter change must invalidate it; covered in Task 2 render-revision tests.
- Loading more transaction rows must preserve the full count and totals and must not duplicate date groups or handlers; covered in Task 2 list model/static tests and browser probe.
- A stale service-worker cache must serve an offline release asset while a background update is allowed; covered in Task 4 service-worker static tests and browser smoke.

---

### Task 1: Dirty-key State Commit and Storage Interface

**Files:**
- Modify: `state_commit.js:create().commit`
- Modify: `storage_v2.js:saveAll`
- Modify: `app_v2.js:persist` and `App.saveAll`
- Test: `tests/state_commit.test.js`
- Test: `tests/storage_schema.test.js`
- Test: `tests/performance_regressions.test.js`

**Interfaces:**
- Consumes: existing `StateCommit.create({ readState, storage, beforeCommit, afterCommit })` and `Storage.collectionNames`.
- Produces: `commit({ reason, dirtyKeys })`, `Storage.saveAll(state, { dirtyKeys })`, and `persist(reason, { dirtyKeys })`; omitted `dirtyKeys` retains current all-collection behavior.

- [ ] **Step 1: Write failing tests** for forwarding `{ reason, dirtyKeys }` through preparation/write hooks and for `Storage.saveAll` serializing/readback only named collection keys while retaining rollback.
- [ ] **Step 2: Run `node --test tests/state_commit.test.js tests/storage_schema.test.js` and verify the new assertions fail because metadata is not forwarded and dirty filtering is unsupported.
- [ ] **Step 3: Implement metadata forwarding in `state_commit.js`, dirty entry selection/readback/verification/rollback in `storage_v2.js`, and optional metadata in `persist`/`App.saveAll`.
- [ ] **Step 4: Run the focused tests and then `node --test tests/state_commit.test.js tests/storage_schema.test.js tests/performance_regressions.test.js`; expected all pass.
- [ ] **Step 5: Commit `perf: add dirty-key state commit interface`.

### Task 2: Transaction Windowing, Delegated Events, and Render Revision

**Files:**
- Modify: `app_v2.js:App.showPage`, `App.renderTransactionsList`, `App._bindTxRows`, filter handlers, and transaction list hooks
- Modify: `style_v2.css` for load-more/reduced-motion list affordances only
- Test: `tests/transaction_list_ux_static.test.js`
- Test: `tests/performance_regressions.test.js`

**Interfaces:**
- Consumes: Task 1 `persist` revision invalidation and existing `MTScreenHooks` transaction adapters.
- Produces: `App.loadMoreTransactions()`, a 40-row initial window, full-filter totals/count, one delegated list interaction boundary, and page render keys that include state revision and active filters.

- [ ] **Step 1: Write failing static/unit tests** asserting the initial window/load-more contract, a delegated root handler with no per-row click/touch listeners, and cache invalidation after filters or durable state revision changes.
- [ ] **Step 2: Run the focused tests and verify they fail against the current all-row `innerHTML` render and per-row listener implementation.
- [ ] **Step 3: Implement page render revision keys in `app_v2.js`, windowed row rendering with an accessible load-more control, and reset the window on search/type/month/filter changes.
- [ ] **Step 4: Replace per-row click/touch handlers with one root delegation boundary while preserving wallet/card detail routing, swipe reveal, delete confirmation, and undo semantics.
- [ ] **Step 5: Replace forced navigation `offsetWidth` reads with scheduled animation classes/WAAPI and add reduced-motion handling without altering visual tokens.
- [ ] **Step 6: Run focused tests, then the complete `node --test tests/*.test.js`; expected all pass.
- [ ] **Step 7: Commit `perf: window transaction navigation and delegate row events`.

### Task 3: Incremental Save Feedback, Reward Scope, and Idle Market Sync

**Files:**
- Modify: `app_v2.js:saveTx`, `refreshTransactionRewardEstimates`, `persist`, market/crypto sync functions, startup scheduling
- Create: `tests/performance_scope.test.js`
- Modify: `tests/performance_regressions.test.js`
- Test: `tests/runtime_cleanup.test.js` and existing Ledger/billing suites

**Interfaces:**
- Consumes: Task 1 dirty-key commit options and Task 2 transaction window/load-more/render revision seam.
- Produces: affected card/cycle/rule reward refresh, one coalesced idle market scheduler, changed-data-only market render, and save feedback that invalidates only the relevant page.

- [ ] **Step 1: Write failing tests** for same-day threshold/cap scope recomputation, no market persist/render when all sources fail or values are unchanged, and transaction save forwarding dirty keys plus showing success only after durable success.
- [ ] **Step 2: Run focused tests and verify the current whole-transaction refresh and unconditional market persist/render violate the assertions.
- [ ] **Step 3: Implement a pure affected-scope helper using card id, effective benefit date, selected rules, and `getCyclePeriodForDate`; recompute all rows in affected cycles in existing durable order and leave unrelated rows untouched.
- [ ] **Step 4: Pass explicit dirty-key metadata from transaction/credit-payment saves and increment the page render revision only after a successful commit; keep rollback behavior unchanged.
- [ ] **Step 5: Add one startup/visibility market scheduler with idle fallback, in-flight coalescing, changed-data comparison, and remove the duplicate 1.2-second crypto startup call.
- [ ] **Step 6: Run focused tests, existing billing/reward/Ledger/State Commit suites, and the complete test suite; expected all pass.
- [ ] **Step 7: Commit `perf: scope derived work and defer market sync`.

### Task 4: Deferred Feature Loading and Service Worker Asset Strategy

**Files:**
- Create: `feature_loader.js`
- Modify: `index.html` and `demo/index.html` to leave only critical/interaction-safe scripts in the defer path and register deferred groups
- Modify: `app_v2.js` to schedule optional groups after first render and ensure a group before its first dependent screen/action
- Modify: `release_manifest.js` to expose deferred assets while keeping them offline-cacheable
- Modify: `service-worker_v2.js` to cache-first immutable release JS/CSS/fonts with background revalidation
- Test: `tests/performance_regressions.test.js`
- Test: `tests/release_manifest.test.js`
- Test: new `tests/feature_loader.test.js` if the loader exposes a pure API

**Interfaces:**
- Consumes: Task 3 first-render/idle scheduler and existing global IIFE module contracts.
- Produces: `MTFeatureLoader.load(group)`, `MTFeatureLoader.ready(group)`, release manifest `deferredAssets`, and offline-safe deferred asset caching.

- [ ] **Step 1: Write failing tests** for ordered group loading, duplicate-load coalescing, release-manifest coverage, and cache-first handling of versioned core/deferred assets.
- [ ] **Step 2: Run focused tests and verify the loader/manifest/service-worker contracts are absent or still network-first.
- [ ] **Step 3: Implement the loader with ordered script injection, promise coalescing, timeout/error status, and a first-render idle schedule; keep critical scripts deterministic.
- [ ] **Step 4: Move only modules proven non-critical for the initial shell into deferred groups, add first-use guards for Reports/More/notifications, and preserve demo behavior.
- [ ] **Step 5: Implement cache-first immutable asset handling with a background fetch/update and preserve HTML/update semantics.
- [ ] **Step 6: Run release/loader tests and the complete test suite; expected all pass.
- [ ] **Step 7: Commit `perf: defer optional features and cache immutable assets`.

### Task 5: Browser Verification and Regression Evidence

**Files:**
- Create: `reports/performance-2026-10-04/mt-perf-boot.cjs`
- Create: `reports/performance-2026-10-04/mt-perf-nav-save.cjs`
- Create: `reports/performance-2026-10-04/README.md`
- Modify: `reports/performance-review-2026-10-03.md` only if a new linked evidence section is requested; otherwise keep historical report unchanged

**Interfaces:**
- Consumes: completed runtime behavior from Tasks 1–4.
- Produces: repeatable 1,000/5,000 transaction measurements for boot, navigation, save-to-visible, long tasks, row count, DOM descendants, and cache/offline behavior.

- [ ] **Step 1: Port the existing synthetic probes into the new report directory without changing production source.
- [ ] **Step 2: Run three runs per condition with reward rules on/off and market data fresh/stale; record medians and long-task maxima.
- [ ] **Step 3: Run navigation/save probes at 1,000 and 5,000 transactions and verify initial rows ≤40, load-more count/totals, and input-to-paint improvement.
- [ ] **Step 4: Run `node --test tests/*.test.js`, inspect `git diff --check`, and document any benchmark limitation (desktop Chrome, blocked external network, no real auth/cloud).
- [ ] **Step 5: Commit `test: add repeatable performance evidence`.

## Execution order

Tasks are intentionally ordered so the save/storage metadata contract exists before transaction rendering can depend on it, and runtime changes land before the browser probes. After each task, keep the full suite green; no task may alter financial output to gain a benchmark improvement.
