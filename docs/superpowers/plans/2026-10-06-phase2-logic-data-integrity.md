# Phase 2 — Logic / Data Integrity Fix Plan

## Tasks

- [x] 2.1 Add runtime coverage for one-commit transaction+recurring save,
  rollback, and retry.
- [x] 2.2 Fix BNPL edit-limit double restoration and test same/change-wallet
  boundaries.
- [x] 2.3 Add integer-satang money helpers, safe amount validation, and rounded
  budget/report aggregates.
- [x] 2.4 Centralize transaction wallet references and reuse the contract in
  ledger, import, Data Health, and delete protection.
- [x] 2.5 Align monthly stats with the posted-only reporting contract and add
  an explicit scheduled projection helper.
- [x] Run full regression and document residual risks.

## Files

- `app_v2.js`
- `calculations.js`
- `ledger.js`
- `tests/runtime_cleanup.test.js`
- `tests/phase2_integrity.test.js`

## Stop condition

Do not begin Phase 3 until the full regression suite is green and any residual
compatibility issue is recorded.
