# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## UI / Design (READ BEFORE TOUCHING ANY UI)

The app is mid-redesign toward a single, consistent visual language ("Calm Banking + AI Bento"). **[`docs/UI_DESIGN_SPEC.md`](docs/UI_DESIGN_SPEC.md) is the controlling source of truth** — read it before editing any screen, card, or style. It defines the design tokens (bound to `:root` in `style_v2.css`), the shared component library (`.bento-card`, `.list-card`, `.ai-bar`, `.seg-pill`, …), per-screen anatomy with code touchpoints, and a per-PR implementation checklist. Rules: use only tokens/components from the spec (no new colors or hardcoded hex), every change must pass light **and** dark mode, and redesign one screen per PR (scope discipline). The full screen-by-screen rollout plan and checklist (every page/sub-screen/sheet/form/dialog, in sequence, with bug-prevention rules) lives in [`docs/UI_REDESIGN_PLAN.md`](docs/UI_REDESIGN_PLAN.md).

## Running the App

```bash
# Serve locally (port 8765)
python3 -m http.server 8765
# Then open http://localhost:8765/index.html
```

The app is a static GitHub Pages site — no build step, no bundler, no npm.

## Running Tests

```bash
# Run all tests
node --test tests/

# Run a single test file
node --test tests/credit_card_cycles.test.js
```

Tests use Node.js built-in `node:test` + `node:assert/strict`. No Jest, no Vitest. Tests are static analysis checks (regex over source strings) or unit tests against pure JS modules — they do NOT require a browser or server.

## Bumping Script Versions

Every `<script>` tag in `index.html` has a `?v=` cache-bust query string. **After editing any JS file, bump its version string in `index.html`** so the Service Worker serves the new file. The SW (`service-worker_v2.js`) also has `APP_VERSION` at line 1 — bump it when `index.html` itself changes.

If cache issues occur during dev, run this in the browser console:
```js
const regs = await navigator.serviceWorker.getRegistrations()
for (const r of regs) await r.unregister()
const keys = await caches.keys()
await Promise.all(keys.map(k => caches.delete(k)))
window.location.reload(true)
```

---

## Architecture

### Global State: `S`

`S` is a single mutable state object defined at line ~970 in `app_v2.js`. Everything lives here: `S.wallets`, `S.transactions`, `S.bnplPlans`, `S.categories`, `S.settings`, etc.

`persist()` (app_v2.js ~line 1018) calls `Storage.saveAll(S)` — it guards against saves before storage is hydrated (`MT_STORAGE_HYDRATED` flag set at line ~1877 after `Storage.init()`).

### Storage Layer (`storage_v2.js`)

`Storage.init()` loads all collections from `localStorage` into a plain object and returns it. `Storage.saveAll(state)` serialises everything back. Adding a new collection requires **5 touch points** in `storage_v2.js`:
1. `KEYS` object — add `key: 'mt_your_key'`
2. `BACKUP_SCHEMA_KEYS` array
3. `BACKUP_DEFAULTS` object
4. `Storage.init()` — load line
5. `Storage.saveAll()` — save line

Also add `S.yourKey = data.yourKey || []` in app_v2.js where `S` is hydrated (~line 1870 range).

### `app_v2.js` Structure

The file is ~24,000 lines of vanilla JS organised as sequential IIFE blocks separated by `/* === ... === */` banners. Each block monkey-patches or extends `window.App`. **There is no module system** — everything is global.

Key sections (by line):
- **~1–940**: Boot fixes, zoom lock, upcoming bills, UX wrappers
- **~943**: Core App Shell — `S` state, `persist()`, theme, toast, nav
- **~2274**: Shared UI — `txAmountStr`, `txVisual`, wallet type labels
- **~2742**: Add-Tx flow — `openAddTx`, `_renderAddTxDetail`, `saveTx`
- **~5244**: Ledger engine — `App._ledgerFlows`, `recalculateWalletBalances`
- **~5860**: `saveTx` — creates tx, triggers BNPL plan creation, calls `persist()`
- **~10216**: Wallet Form — `openWalletForm`, `_syncWalletFormSections`, `saveWallet`
- **~13708**: `renderWallets` — groups wallets into sections and renders cards

### Balance / Ledger System

`App._ledgerFlows()` (line ~5377) is the **source of truth** for wallet balances. It scans all transactions and accumulates `{ cash: { walletId: amount }, units: { walletId: units } }`. `recalculateWalletBalances` calls this and sets `wallet.balance = wallet.openingBalance + cashFlow`.

**Critical**: `App._computeWalletFlows` (line ~5043) immediately delegates to `App._ledgerFlows` — they are NOT the same function. Always add new tx type handling to `App._ledgerFlows`.

`loans_v2.js` patches `App._ledgerFlows` at load time by wrapping it:
```js
const prevLedger = App._ledgerFlows.bind(App)
App._ledgerFlows = function() { return _addLoanFlows(prevLedger()) }
```
`bnpl.js` must NOT do the same — it adds its `bnpl_payment` handling directly inside the original `_ledgerFlows` body.

### Satellite Modules

Loaded after `app_v2.js` via `<script defer>`, each follows the IIFE pattern and exposes a `window.*` global:

| File | Global | Pattern |
|------|--------|---------|
| `loans_v2.js` | `window.LoanStore` | IIFE, patches `App._ledgerFlows` |
| `bnpl.js` | `window.BNPL` | IIFE, exposes `{ store, calc, ui }` |
| `split_bill.js` | — | IIFE, adds `App.*` methods |
| `credit_card_cycles.js` | — | IIFE, adds CC cycle logic |
| `crypto_vault.js` | — | IIFE, adds crypto portfolio |
| `calculations.js` | `window.Calc` | Plain object, `module.exports` for tests |

All satellite modules check `typeof App !== 'undefined'` and `typeof S !== 'undefined'` before accessing state. **Guard new wallet/tx type handling with `typeof BNPL !== 'undefined'`** etc.

### Adding a New Wallet Type

When adding a new wallet type (e.g. `bnpl`), grep for **every** one of these and update:

```bash
grep -n "credit.*ewallet\|type.*credit\|'credit'\|\"credit\"\|credit.*type" app_v2.js
```

Specifically check:
1. `walletTypeLabelMap` and `walletTypeLabel` function (multiple occurrences)
2. `_selectWalletType` — hard-coded allowlist Set
3. `walletFormTypes` Set in `saveWallet`
4. `primaryWallet()` filter (exclude debt wallets)
5. `renderWallets` — filter into section group + `content.innerHTML` sections + tab bar
6. `_walletGroup()` — drag-reorder group mapping
7. `getAssetBreakdown()` in `calculations.js` — liabilities vs assets
8. `_validateImportPayload` — `validTypes` Set for transactions
9. `deleteWallet` — cascade-delete associated data
10. `openCCPay` sources filter — exclude debt wallets
11. `TRANSFERABLE_WALLET_TYPES` — only if wallet should be transferable

### Adding a New Transaction Type

When adding a new tx type (e.g. `bnpl_payment`), check all of these:

1. `App._ledgerFlows` — `addCash` logic
2. `TX_TYPE_LABELS` and all `typeLabel` maps (3+ locations, search `bnpl_payment` to find them)
3. `txAmountStr` / `txVisual` — display formatting and icon
4. `_validateImportPayload` `validTypes` Set — **import will silently drop unknown types**
5. `hideMoney` display branch — bidirectional `↔` pattern
6. CSV export `typeLabel` map

### Wallet Tab Bar (once-injection guard)

`renderWallets` injects the tab bar **once** using:
```js
if (walletPageHeader && !walletPageHeader.querySelector('.wallet-tab-bar')) { ... }
```
After deploy, existing sessions won't see new tabs until they hard-reload. When adding a tab, also remove the old injected tab bar so it re-renders: `walletPageHeader.querySelector('.wallet-tab-bar')?.remove()` before the guard check, or version the tab bar class name.

### CSS Wallet Card Colors

Wallet cards use CSS variables set via inline style, not inline `background:`. The class `.wallet-card-colored` applies `background: linear-gradient(135deg, var(--wallet-color), var(--wallet-color-2)) !important`. Always set:
```html
style="--wallet-color:#EE4D2D;--wallet-color-2:#EE4D2DBB"
```

### `openWalletDetail` vs `openCCDetail`

- `openCCDetail` — credit cards only, shows statement/cycle/benefits
- `openWalletDetail` — all other wallets, shows transaction list
- BNPL wallets currently fall into `openWalletDetail` — no BNPL-specific detail screen exists yet

### Demo vs Production

`App.openDemoApp()` navigates to `/demo/index.html` which loads different script versions. When testing changes to `index.html`, navigate directly to `http://localhost:8765/index.html`.
