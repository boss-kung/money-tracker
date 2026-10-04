# Money Tracker Performance Optimization Design

**Date:** 2026-10-04  
**Status:** Design for review  
**Scope:** app boot, page navigation, transaction save feedback, and durable-state work scheduling

## Goal

ทำให้ Money Tracker ตอบสนองเร็วขึ้นบน mobile-first local PWA โดยลดงานบน main thread ที่ไม่จำเป็น, ไม่สร้าง DOM รายการธุรกรรมทั้งชุด, และไม่คำนวณ/เขียนข้อมูลทางการเงินซ้ำ โดยรักษาผลลัพธ์ Ledger, billing, reward, cloud-sync และ rollback เดิมทุกกรณี

## Assumptions and success criteria

- Primary device/network: low-to-mid-range mobile บน 4G; desktop ใช้เป็น development baseline แต่ไม่ใช่เป้าหมายเดียว
- Rendering model: auth-walled/local-first static SPA; ไม่ต้องเพิ่ม SSR/SEO pipeline
- Accessibility owner/target: frontend owner ตรวจ WCAG 2.2 AA สำหรับ virtualized/windowed transaction list, focus, keyboard, screen reader และ reduced motion
- Core Web Vitals p75 target: LCP ≤ 2,500 ms, INP ≤ 200 ms, CLS ≤ 0.10 บน mobile 4G
- Main-thread target: ไม่มี synchronous task ที่เกิดจากการเปลี่ยนหน้า/บันทึกเกิน 50 ms ใน synthetic 5,000-transaction benchmark
- Initial JavaScript budget: ≤200 KB gzip for the critical boot path; lazy route/features ≤80 KB gzip per route group
- Lighthouse floors: performance ≥90, accessibility ≥95 on production-like mobile profile
- Functional requirement: financial outputs and durable rollback must remain bit-for-bit equivalent where existing tests define exact values

## Current root causes

1. `index.html` eagerly loads all feature scripts; `defer` still parses and executes every script before the page is fully ready.
2. Boot starts market sync and then calls `persist()` plus full `App.render()` even when no market value changed. Billing hydration also persists on every boot.
3. Reward refresh recalculates every transaction after a single transaction save. Billing preparation filters the complete transaction list for every credit card during every commit.
4. `App.showPage()` renders the selected screen on every navigation. Transactions filters/sorts all rows, replaces the entire list with `innerHTML`, injects delete controls, and attaches touch/click handlers to every row.
5. Transaction save commits correctly but immediately navigates to a full Transactions render, so save-to-visible latency is dominated by list DOM/layout work rather than localStorage.
6. `Storage.saveAll()` avoids unchanged writes but still serializes/readbacks every collection on each commit; multiple callers can also reconcile Ledger before the commit-owned reconciliation.

## Design

### A. Shared state and rendering contracts

- Add a monotonic state revision and named dirty domains. Mutations mark domains (`transactions`, `wallets`, `merchants`, `settings`, etc.) and invalidate only dependent derived indexes.
- Keep `persist(reason)` as the only durable commit entry point. It accepts optional commit metadata (`dirtyKeys`, affected transaction/card/cycle scope) while preserving rollback and State Commit notifications.
- Add a page render cache keyed by page plus relevant state/filter revision. Navigation can activate an already-current page without rebuilding its DOM.
- Expose small pure helpers for transaction filtering/windowing, reward scope calculation, and dirty-key selection so each seam can be tested without a browser.

### B. Boot path

- Keep storage, ledger, calculations, shell, and the selected initial page in the critical path.
- Schedule market/crypto refresh after first meaningful render and browser idle time. Coalesce all startup/visibility refresh callers. Persist/render only when usable market data or metadata actually changed.
- Gate billing migration persistence on the migration result's `changed` flag and a versioned migration marker.
- Split non-critical modules into route/feature groups loaded on idle or first use. Preserve the release manifest and demo entry point; every production dependency remains offline-safe.
- Change the service worker strategy for immutable release-versioned JS/CSS from network-first timeout to cache-first with background revalidation. HTML/update checks remain separately controlled.

### C. Transaction navigation

- Keep totals and filtered count based on the full source collection, but render an accessible initial window of 30–50 rows. Append more rows on an explicit load-more action and IntersectionObserver; preserve date-group headers and stable row ids.
- Replace per-row listener creation with one delegated listener on the transaction list root. Swipe-delete state must remain per-row but use pointer/touch events through the delegated boundary.
- Pre-index wallets/categories and precompute searchable text per transaction revision. Debounce text input by 150–250 ms; non-search filters remain immediate.
- Avoid synchronous layout reads after a full render. Use class/animation scheduling or Web Animations API for navigation feedback and respect `prefers-reduced-motion`.
- Stop hidden-page observers/animations and invalidate a page cache only when its dependencies change.

### D. Save and derived work

- After a successful transaction commit, patch the visible list/summary or render only the initial window; do not rebuild every transaction row solely to show the saved item.
- Recompute reward estimates for the affected card/cycle/rule scope, not all transactions. The affected scope must include earlier rows when caps/thresholds/order can change.
- Reuse billing metadata when card settings, relevant transactions, or the local date have not changed. Keep the existing carryover/opening-debt semantics.
- Make commit-owned Ledger reconciliation the single reconciliation for a state commit. Reuse the same flow snapshot for baseline/snapshot work, and remove duplicate caller-side scans where safe.
- Add dirty-key persistence. Serialize changed collections once, read back changed keys, verify the financial invariants, and retain a rollback snapshot for every key written. Unchanged keys remain checked only where existing safety tests require it.
- Cloud/auth/notification work remains post-commit, coalesced, and must never delay the local success feedback.

## Compatibility and correctness rules

- `S.transactions` remains the source of truth; no derived index may become authoritative.
- Reward, billing, and Ledger calculations must preserve same-day ordering, caps, thresholds, carryovers, future/scheduled rows, installment rounding, BNPL, loans, reimbursements, and credit-card payments.
- A failed durable write must restore all mutated financial collections and must not show success UI or dispatch successful cloud notifications.
- Windowing must preserve keyboard focus, screen-reader row semantics, delete confirmation, swipe behavior, scroll restoration, and an accurate full-result count.
- The release manifest, production/demo HTML cache keys, service-worker update flow, and no-build GitHub Pages deployment remain compatible.

## Verification strategy

1. Add unit/static regression tests before each implementation seam; run the focused test red, then green.
2. Run the complete `node --test tests/*.test.js` suite after each task group.
3. Run browser probes with 1,000 and 5,000 synthetic transactions, with/without reward rules, measuring first meaningful render, final boot render, navigation input-to-paint, save-to-visible, long tasks, rendered row count, and DOM descendants.
4. Run the existing credit-billing, reward, Ledger, State Commit, storage rollback, notification, and cloud-sync tests after changes to commit or derived-state contracts.
5. Verify light/dark mode, reduced motion, keyboard navigation, focus retention, load-more behavior, delete/undo, offline startup, stale service-worker cache, and failed persistence.

## Non-goals

- Do not replace localStorage with IndexedDB in this change; current measurements show rendering and repeated financial calculation dominate.
- Do not redesign visual tokens or screens.
- Do not change financial formulas or cloud data contracts.
- Do not remove rollback/readback verification for the sake of speed.

## Phasing

1. **Foundation:** revision/dirty-domain contracts, transaction render cache/window helpers, and test seams.
2. **Navigation/save:** transaction windowing, delegated events, incremental save patch, and duplicate reconciliation removal.
3. **Boot:** deduped idle market sync, gated billing hydration, reward affected-scope computation, and route/feature scheduling.
4. **Storage/service worker:** dirty-key serialization and immutable asset caching, followed by offline/update regression tests.

Each phase must remain releasable and keep the complete test suite green.
