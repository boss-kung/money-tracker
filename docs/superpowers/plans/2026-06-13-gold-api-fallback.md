# Gold API Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Thai gold-price sync recover when the primary JSON API returns blank prices.

**Architecture:** Add a small shared `gold_market.js` helper for parsing, normalization, cache access, and source fallback orchestration. `app_v2.js` delegates its gold sync to that helper while preserving existing `S.marketPrices.thaiGold` / `auroraGold` behavior.

**Tech Stack:** Vanilla browser JavaScript, CommonJS export for Node tests, `node:test`.

---

### Task 1: Regression Tests

**Files:**
- Create: `tests/gold_market.test.js`
- Create: `gold_market.js`

- [ ] **Step 1: Write failing tests** covering blank primary API payload, Aurora HTML fallback, stale cache fallback, and price parsing.
- [ ] **Step 2: Run `node --test tests/gold_market.test.js`** and confirm it fails because `gold_market.js` does not exist.

### Task 2: Shared Helper

**Files:**
- Modify: `gold_market.js`

- [ ] **Step 1: Implement `normaliseGoldPayload`, `parseAuroraGold`, and `fetchThaiGoldViaSource`.**
- [ ] **Step 2: Run `node --test tests/gold_market.test.js`** and confirm it passes.

### Task 3: App Wiring

**Files:**
- Modify: `app_v2.js`
- Modify: `index.html`
- Modify: `demo/index.html`
- Modify: `service-worker_v2.js`

- [ ] **Step 1: Load `gold_market.js` before `app_v2.js`.**
- [ ] **Step 2: Replace the embedded gold fetch chain in `app_v2.js` with `MTGoldMarket.fetchThaiGoldViaSource`.**
- [ ] **Step 3: Add `gold_market.js` to the service worker precache/core-code list.**
- [ ] **Step 4: If JSONP proxy remains supported, allow Apps Script script hosts in CSP.**

### Task 4: Verification

**Files:**
- Test: `tests/gold_market.test.js`

- [ ] **Step 1: Run `node --test tests/gold_market.test.js`.**
- [ ] **Step 2: Run relevant static tests for script/CSP/service-worker wiring.**
- [ ] **Step 3: Start a local server and smoke-check that the app loads.**
