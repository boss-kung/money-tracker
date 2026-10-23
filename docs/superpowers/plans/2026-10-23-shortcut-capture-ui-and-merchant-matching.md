# Shortcut Capture UI and Merchant Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Shortcut transaction entry visually full-width on iPhone and resolve imported merchant descriptions to the safest, most specific existing merchant.

**Architecture:** Keep the existing Quick Capture parser and Add Transaction sheet. Add deterministic scoring helpers inside `quick_capture.js`, and apply narrowly scoped CSS to the existing launcher and Add Transaction overlay. Do not introduce dependencies or restructure global app state.

**Tech Stack:** Vanilla JavaScript, CSS, Node built-in test runner, static HTML/PWA.

**Spec:** `docs/superpowers/specs/2026-10-23-shortcut-capture-ui-and-merchant-matching-design.md`

## Global Constraints

- Preserve the user's unrelated `quick_capture.js` modification.
- Use only existing design tokens and support both light and dark themes.
- Keep the microphone available inside the Shortcut capture input.
- Do not change the layout behavior of unrelated sheets.
- Matching must prefer false negatives over destructive false positives when candidates are ambiguous.

## Review Focus

1. `SHOPEE*SHOPEEFOOD` selects `SHOPEEFOOD` regardless of merchant array order.
2. Exact names beat broader containment, while company suffixes and punctuation are ignored safely.
3. Ambiguous or weak fuzzy candidates do not overwrite the parsed merchant text.
4. The Add Transaction overlay fills the viewport width without globally changing other sheets.
5. Form controls compute to at least 16px on mobile so iOS does not auto-zoom the app shell.

### Task 1: Specify merchant matching behavior with failing tests

**Files:**
- Modify: `tests/p2_regressions.test.js`
- Test: `tests/p2_regressions.test.js`

- [ ] Allow the parser test helper to accept merchant fixtures.
- [ ] Add order-independent assertions for `SHOPEE*SHOPEEFOOD`.
- [ ] Add exact-name, corporate suffix, near-spelling, and ambiguous fallback cases.
- [ ] Run `node --test tests/p2_regressions.test.js` and confirm the specificity cases fail before implementation.

### Task 2: Implement deterministic, specificity-aware merchant matching

**Files:**
- Modify: `quick_capture.js`
- Test: `tests/p2_regressions.test.js`

- [ ] Add comparison-only normalization for separators, parenthetical location text, and legal suffixes.
- [ ] Rank exact, component, containment, token, phonetic, and edit-similarity matches conservatively.
- [ ] Make tie-breaking independent of merchant array order and reject unclear fuzzy ties.
- [ ] Return the existing merchant's canonical stored name.
- [ ] Run `node --test tests/p2_regressions.test.js` and confirm all merchant cases pass.

### Task 3: Specify and implement the Shortcut launcher and full-width sheet fix

**Files:**
- Modify: `quick_capture.js`
- Modify: `style_v2.css`
- Modify: `tests/fab_scroll_clearance_static.test.js`
- Create: `tests/shortcut_capture_ui_static.test.js`

- [ ] Add static assertions for the `รายการจาก Shortcut` launcher and removal of the floating microphone-only control.
- [ ] Add static assertions that only the Add Transaction overlay/sheet is fixed to `100vw`.
- [ ] Add a static assertion for the 16px mobile form-control zoom guard.
- [ ] Run the two UI tests and confirm they fail before implementation.
- [ ] Replace the floating mic markup with an accessible text pill while retaining the inner capture microphone.
- [ ] Update scroll clearance for the renamed launcher.
- [ ] Add scoped viewport-width rules for `#overlay-add-tx` and `#sheet-add-tx`.
- [ ] Make mobile `.form-input` controls 16px with sufficient cascade priority.
- [ ] Run both UI tests and confirm they pass.

### Task 4: Release metadata and end-to-end verification

**Files:**
- Modify: `release_manifest.js`
- Modify mechanically: `index.html`
- Modify mechanically: `demo/index.html`

- [ ] Bump the release version to a unique Shortcut-capture release identifier.
- [ ] Run `node scripts/update-release-version.js`.
- [ ] Run `node --test tests/*.test.js` and record the passing totals.
- [ ] Serve the app locally and inspect dashboard launcher plus Shortcut-to-details flow at a narrow mobile viewport in both themes.
- [ ] Confirm no unrelated working-tree changes were overwritten.
