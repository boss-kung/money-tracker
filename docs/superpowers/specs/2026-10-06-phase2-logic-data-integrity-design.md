# Phase 2 — Logic / Data Integrity Design

## Scope

Phase 2 closes the remaining high/medium logic findings from the 2026-10-06
audit without changing the persisted decimal-money format or starting Phase 3.

## Decisions

1. Transaction + recurring creation has one durable commit boundary. A failed
   write restores the durable collections while preserving the draft so the
   user can retry. The recurring helper remains pure and retrying does not
   leave a partial row.
2. BNPL edit-limit validation derives available credit from the effective
   balance once. The original expense is reverted only by `effectiveBalance`.
3. Decimal money remains backward-compatible at rest, but aggregation and
   comparisons normalize to integer satang. Non-finite or unsafe-cent input is
   rejected at transaction, import, and credit-payment boundaries.
4. `ledger.js` owns the transaction wallet-reference schema. It covers
   transfer, credit payment, BNPL payment, investment cash/source aliases, and
   is reused by integrity checks, import validation, Data Health, and wallet
   delete protection.
5. Monthly actual income/expense/savings are posted-only. Future scheduled
   rows are exposed separately through `getMonthlyScheduledTotals` and are not
   allowed to inflate actual reporting or budgets.

## Compatibility

- Existing decimal JSON values and legacy `sourceWalletId` investment rows are
  accepted.
- Existing UI labels and storage keys remain unchanged.
- Missing wallet references are reported as integrity findings; no destructive
  repair is performed automatically.

## Verification

- Focused Phase 2 tests cover precision, scheduled-vs-actual semantics,
  BNPL edit boundaries, retry behavior, and every wallet-reference variant.
- Full Node tests, Edge Function tests, syntax checks, and diff checks remain
  required before completion.
