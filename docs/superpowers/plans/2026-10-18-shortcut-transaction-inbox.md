# Shortcut Transaction Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure, encrypted review inbox that receives normalized iOS Shortcut captures and creates a Money Tracker transaction only after the user reviews and explicitly saves it.

**Architecture:** A scoped per-device token sends a strict capture envelope to a custom-auth Supabase Edge Function, which stores only AES-GCM ciphertext plus minimal operational metadata. Authenticated Money Tracker clients claim captures, map them into the existing Add Transaction form, save through the existing durable transaction path, then acknowledge consumption with deterministic IDs and an offline retry queue.

**Tech Stack:** Vanilla JavaScript PWA, Node `node:test`, Supabase Postgres/pgTAP, Supabase Edge Functions on Deno/TypeScript, Web Crypto AES-256-GCM/HMAC-SHA-256, native iOS Shortcuts

**Spec:** `docs/superpowers/specs/2026-10-18-shortcut-transaction-inbox-design.md`

## Global Constraints

- Accept only `money-tracker.capture.v1`, THB, `line_notification`/`whats_on_screen`, and `uob_thai`/`scb_connect`/`line_wallet` in version 1.
- A capture never changes Ledger, balances, reports, or Vault before explicit user Save through existing `App.saveTx` validation and `persist()`.
- Test mode never sends a request; Production mode rejects incomplete parsing, non-HTTPS URLs, unchanged template values, and non-positive amounts.
- Store no bank, amount, account/card, merchant, description, capture-method, raw-text, or relevant-text field as plaintext in Postgres.
- Use a fresh 96-bit IV for AES-256-GCM and bind capture ID, user ID, schema version, and key version as AAD.
- Allow at most five active tokens per user and 30 authenticated ingestion requests per token per fixed database minute.
- Claims last ten minutes; pending captures last 30 days; consumed/dismissed ciphertext lasts seven days; dedupe receipts last 180 days.
- Duplicate ingestion returns HTTP 200 and the existing capture ID; accepted ingestion returns HTTP 202.
- Acknowledgement failure never rolls back a locally committed transaction; the retry queue contains no token or captured text.
- Do not add realtime, push, OCR, non-THB parsing, automatic transfer inference, automatic transaction saving, or new runtime dependencies.

## Review Focus

- Same user, amount, merchant, and date but different normalized relevant blocks must produce distinct fingerprints; exact re-capture must remain a duplicate (Task 2 tests).
- A local Save followed by network loss and claim expiry must reconcile once through `ack`, without a second transaction (Tasks 1, 5, 7, and 8 tests).
- Account switching during a fetch or with queued acknowledgements must never render or send the previous user's data (Task 8 tests).
- Malformed UTF-8/JSON, a lying or absent `Content-Length`, and a body crossing 32 KiB while streamed must be rejected without partial rows or sensitive logs (Tasks 2 and 4 tests).
- Double Save and attempts to mark an external capture recurring/installment must not fan one bank event into multiple transactions (Task 7 tests).

## File Map

| Area | Files | Responsibility |
| --- | --- | --- |
| Database | `supabase/migrations/202610180001_shortcut_transaction_inbox.sql`, `supabase/tests/database/shortcut_transaction_inbox.test.sql` | Tables, constraints, atomic token/rate/claim/state RPCs, retention cleanup |
| Backend contract | `supabase/functions/_shared/shortcut_capture.ts`, `shortcut_capture_test.ts` | Strict v1 validation, bounded JSON reading, normalization, fingerprinting, safe errors |
| Backend crypto | `supabase/functions/_shared/shortcut_crypto.ts`, `shortcut_crypto_test.ts` | Token generation/verifiers, constant-time compare, AES-GCM key ring and AAD |
| Token API | `supabase/functions/manage-shortcut-tokens/index.ts`, `index_test.ts` | Authenticated list/create/revoke |
| Ingestion API | `supabase/functions/ingest-shortcut-capture/index.ts`, `index_test.ts`, `supabase/config.toml` | Custom-token append-only ingestion and duplicate response |
| Inbox API | `supabase/functions/shortcut-inbox/index.ts`, `index_test.ts` | Authenticated list/count/claim/release/consume/dismiss/restore/ack |
| Client core | `shortcut_capture_core.js`, `tests/shortcut_capture_core.test.js`, `quick_capture.js` | Pure draft mapping, aliases, deterministic IDs, queue rules, category suggestion seam |
| Transaction seam | `app_v2.js`, `tests/shortcut_capture_transaction.test.js` | Preserve metadata, force deterministic IDs, block duplicate/fan-out saves |
| Client feature | `shortcut_capture.js`, `ui_v2.css`, `tests/shortcut_capture_transport.test.js`, `tests/shortcut_capture_ui.test.js` | API transport, scoped retry queue, Inbox/settings UI, hooks and refresh lifecycle |
| Loading/release | `feature_loader.js`, `release_manifest.js`, `index.html`, `demo/index.html`, existing loader/release tests | Ordered deferred loading and cache version |
| Shortcut kit | `outputs/money-tracker-shortcut-action-map.json`, setup/verification docs, `work/reference-parser.mjs`, `work/reference-parser.test.mjs` | Backend-compatible native Shortcut instructions and fixtures |
| Operations | `tests/shortcut_capture_security_static.test.js`, `docs/SHORTCUT_INBOX_DEPLOYMENT.md` | Security invariants, deployment, smoke test, rollback |

---

### Task 1: Postgres Inbox State Machine

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/tests/database/shortcut_transaction_inbox.test.sql`
- Create: `supabase/migrations/202610180001_shortcut_transaction_inbox.sql`

**Interfaces:**
- Consumes: Supabase `auth.users`, `pgcrypto`, and `pg_cron` already used by the project.
- Produces: `mt_shortcut_tokens`, `mt_shortcut_captures`; service-role-only RPCs `mt_shortcut_create_token(uuid,text,bytea,text)`, `mt_shortcut_take_rate_slot(uuid,timestamptz,integer)`, `mt_shortcut_claim_capture(uuid,uuid,bytea,text,timestamptz)`, `mt_shortcut_release_capture(uuid,uuid,bytea)`, `mt_shortcut_consume_capture(uuid,uuid,bytea,bytea,boolean,timestamptz)`, `mt_shortcut_dismiss_capture(uuid,uuid,bytea,timestamptz)`, `mt_shortcut_restore_capture(uuid,uuid,timestamptz)`, and `mt_shortcut_cleanup(timestamptz)`.

- [ ] **Step 1: Create local Supabase test configuration**

Create `supabase/config.toml` with project ID `money-tracker` and default JWT verification. Do not disable verification for any function yet.

- [ ] **Step 2: Write failing pgTAP state-machine tests**

Cover table RLS/no client grants, a transactional sixth-token rejection, 30 allowed rate slots then rejection, user-scoped dedupe uniqueness, ten-minute claim takeover, claim-token release, consume idempotency by transaction-ID hash, retry consume after lease expiry, cross-user denial, seven-day dismiss restore, 30/7/180-day cleanup, and `auth.users` cascade. Name the retry assertion `ack after an expired claim consumes once`.

- [ ] **Step 3: Run the database tests to verify they fail**

Run: `supabase test db --workdir supabase`

Expected: FAIL because the Shortcut tables and RPCs do not exist.

- [ ] **Step 4: Implement the migration**

Use checked status values `pending|claimed|consumed|dismissed|expired`, unique `(user_id,dedupe_version,dedupe_key)`, nullable ciphertext only for purged terminal rows, advisory locking around the active-token count, and atomic RPC transitions. Revoke table and function access from `public`, `anon`, and `authenticated`; grant only required RPC execution to `service_role`. Schedule hourly `mt_shortcut_capture_cleanup` with SQL-only `pg_cron`.

- [ ] **Step 5: Run database tests**

Run: `supabase test db --workdir supabase`

Expected: all `shortcut_transaction_inbox` pgTAP assertions PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/config.toml supabase/migrations/202610180001_shortcut_transaction_inbox.sql supabase/tests/database/shortcut_transaction_inbox.test.sql
git commit -m "feat: add shortcut inbox database state machine"
```

### Task 2: Capture Validation, Fingerprinting, and Crypto

**Files:**
- Create: `supabase/functions/_shared/shortcut_capture.ts`
- Create: `supabase/functions/_shared/shortcut_capture_test.ts`
- Create: `supabase/functions/_shared/shortcut_crypto.ts`
- Create: `supabase/functions/_shared/shortcut_crypto_test.ts`

**Interfaces:**
- Consumes: Web Crypto and environment values `MT_SHORTCUT_TOKEN_PEPPER_V1`, `MT_SHORTCUT_INBOX_KEY_V1` (future numbered keys follow the same name).
- Produces: `readBoundedJson(req, 32768)`, `validateCaptureV1(input)`, `canonicalDedupeMaterial(capture)`, `sha256Hex(text)`, `generateDeviceToken()`, `parseDeviceToken(token)`, `tokenVerifier(secret,pepper)`, `timingSafeEqual(a,b)`, `loadInboxKeyring(getEnv)`, `encryptCapture(payload,context,keyring)`, and `decryptCapture(record,context,keyring)`.

- [ ] **Step 1: Write failing validation and dedupe tests**

Assert exact accepted enums and required fields, canonical two-decimal amount strings, ISO timestamps, four-digit identifiers, NFKC/whitespace normalization, server recomputation of the supplied fingerprint, and rejection of partial/unknown/non-THB payloads. Pin the Review Focus case: two otherwise identical captures with different normalized `relevant_text` hashes differ; whitespace-only variants match.

- [ ] **Step 2: Write failing bounded-body and crypto tests**

Assert streamed bodies of 32 KiB pass and 32 KiB + 1 byte fail regardless of `Content-Length`; malformed UTF-8/JSON fails safely. Assert token format `mtst_v1.<uuid>.<base64url-secret>`, 256-bit random secret material, fixed-length verifier comparison, fresh 96-bit IVs, AES-GCM round-trip, wrong AAD failure, key-version selection, and no plaintext in ciphertext fixtures.

- [ ] **Step 3: Run the shared tests to verify they fail**

Run: `deno test supabase/functions/_shared/shortcut_capture_test.ts supabase/functions/_shared/shortcut_crypto_test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement the shared modules**

Define `CaptureEnvelopeV1` and `ValidatedCaptureV1` explicitly. Throw `ShortcutRequestError` with stable `status` and `code`; do not include captured values in messages. Canonical AAD must be `${captureId}|${userId}|${schemaVersion}|${keyVersion}` encoded as UTF-8.

- [ ] **Step 5: Run shared tests**

Run: `deno test supabase/functions/_shared/shortcut_capture_test.ts supabase/functions/_shared/shortcut_crypto_test.ts`

Expected: all validation, Review Focus, bounded-body, token, and encryption tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/shortcut_capture.ts supabase/functions/_shared/shortcut_capture_test.ts supabase/functions/_shared/shortcut_crypto.ts supabase/functions/_shared/shortcut_crypto_test.ts
git commit -m "feat: add shortcut capture validation and encryption"
```

### Task 3: Device Token Management API

**Files:**
- Create: `supabase/functions/manage-shortcut-tokens/index.ts`
- Create: `supabase/functions/manage-shortcut-tokens/index_test.ts`

**Interfaces:**
- Consumes: `requireAuthenticatedUserId`, `adminClient`, crypto helpers, and `mt_shortcut_create_token`.
- Produces: `createManageShortcutTokensHandler(deps)` and production routes `GET /manage-shortcut-tokens`, `POST /manage-shortcut-tokens`, `POST /manage-shortcut-tokens/:id/revoke`.

- [ ] **Step 1: Write failing handler tests**

Assert auth occurs before admin access; list omits verifiers; create trims a 1–64 character label, returns plaintext token once with HTTP 201, and maps the atomic active-token limit to `409 active_token_limit`; revoke is owner-scoped and idempotent. Include malformed UUID, blank/Unicode label length, and concurrent sixth-token outcomes.

- [ ] **Step 2: Run the token tests to verify they fail**

Run: `deno test supabase/functions/manage-shortcut-tokens/index_test.ts`

Expected: FAIL because the handler does not exist.

- [ ] **Step 3: Implement the injectable handler and Deno entry point**

The dependency interface must inject user resolution, admin client creation, token generation/verifier creation, and environment reads. Guard `Deno.serve` with `import.meta.main` so importing the module in tests does not start a server. Never return or log `secret_verifier`.

- [ ] **Step 4: Run token tests**

Run: `deno test supabase/functions/manage-shortcut-tokens/index_test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/manage-shortcut-tokens
git commit -m "feat: add shortcut token management API"
```

### Task 4: Append-Only Ingestion API

**Files:**
- Modify: `supabase/config.toml`
- Create: `supabase/functions/ingest-shortcut-capture/index.ts`
- Create: `supabase/functions/ingest-shortcut-capture/index_test.ts`

**Interfaces:**
- Consumes: shared validation/crypto, `mt_shortcut_tokens`, `mt_shortcut_take_rate_slot`, and unique capture insert.
- Produces: `createIngestShortcutCaptureHandler(deps)`; `POST /ingest-shortcut-capture` returning `{status:'queued',capture_id,duplicate}`.

- [ ] **Step 1: Write failing ingestion tests**

Assert request-size check; indexed token parsing; constant-time verifier use; revoked/invalid token 401; rate limit 429; authentication before detailed JSON validation; exact fingerprint validation; encryption before insert; accepted 202; existing and uniqueness-race duplicates 200 for every terminal status; database/encryption failure 500 with no row. Pin malformed streamed-body cases and assert captured fields never reach logger arguments.

- [ ] **Step 2: Run ingestion tests to verify they fail**

Run: `deno test supabase/functions/ingest-shortcut-capture/index_test.ts`

Expected: FAIL because the handler is missing.

- [ ] **Step 3: Implement custom-token ingestion**

Use the operation order from the spec. Preselect the capture UUID for AAD, discard ciphertext after a uniqueness race, update `last_used_at`, and expose only stable safe errors. Add only `[functions.ingest-shortcut-capture] verify_jwt = false` to `supabase/config.toml`; leave both authenticated functions on gateway JWT verification.

- [ ] **Step 4: Run ingestion and shared tests**

Run: `deno test supabase/functions/_shared/shortcut_*_test.ts supabase/functions/ingest-shortcut-capture/index_test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml supabase/functions/ingest-shortcut-capture
git commit -m "feat: add encrypted shortcut capture ingestion"
```

### Task 5: Authenticated Inbox API

**Files:**
- Create: `supabase/functions/shortcut-inbox/index.ts`
- Create: `supabase/functions/shortcut-inbox/index_test.ts`

**Interfaces:**
- Consumes: Supabase JWT user resolution, inbox key ring, capture state RPCs.
- Produces: `createShortcutInboxHandler(deps)`; GET `?view=count|pending|dismissed&cursor=<accepted_at,id>&limit=20`; POST subpaths `/claim`, `/release`, `/consume`, `/dismiss`, `/restore`, `/ack`.

- [ ] **Step 1: Write failing list/claim tests**

Assert auth precedes admin access; count/list are owner-scoped and cursor-stable; list decrypts only preview fields and strips raw/relevant text; claim records the supplied browser device ID and returns the full payload plus one-time claim secret; active foreign claim returns `409 capture_claimed`; expired claim can be replaced.

- [ ] **Step 2: Write failing terminal/reconciliation tests**

Assert claim-secret release/consume, same transaction hash idempotency, different hash `409 capture_already_consumed`, confirmation-neutral dismiss, restore only before ciphertext purge, and `ack` consuming pending or expired-claim state exactly once with `shortcut:<capture-id>`. Assert decryption/AAD failure returns a generic unavailable code and logs no payload.

- [ ] **Step 3: Run inbox tests to verify they fail**

Run: `deno test supabase/functions/shortcut-inbox/index_test.ts`

Expected: FAIL because the handler is missing.

- [ ] **Step 4: Implement the inbox handler**

Clamp page size to 1–50. Return ISO cursors and stable codes. Hash transaction IDs before RPC calls. Keep claim secrets in response/session only, never in capture ciphertext or Vault data.

- [ ] **Step 5: Run all Edge Function tests**

Run: `deno test supabase/functions/_shared/*_test.ts supabase/functions/manage-shortcut-tokens/index_test.ts supabase/functions/ingest-shortcut-capture/index_test.ts supabase/functions/shortcut-inbox/index_test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/shortcut-inbox
git commit -m "feat: add authenticated shortcut inbox API"
```

### Task 6: Pure Client Mapping and Suggestion Seam

**Files:**
- Create: `shortcut_capture_core.js`
- Create: `tests/shortcut_capture_core.test.js`
- Modify: `quick_capture.js`
- Create: `tests/shortcut_capture_quick_capture_static.test.js`

**Interfaces:**
- Consumes: validated capture previews/payloads, current wallets/categories/transactions, and an injected merchant suggestion callback.
- Produces: UMD global/CommonJS `MTShortcutCaptureCore` with `transactionId(captureId)`, `aliasKey(capture)`, `findWalletByAlias(wallets,key)`, `mapCaptureToDraft(capture,context)`, `findExistingCaptureTransaction(transactions,captureId)`, `rememberWalletAlias(wallets,walletId,key)`, `makeAckJob(captureId,transactionId,dedupeVersion,dedupeKey,now)`, and `mergeAckJob(queue,job)`; browser global `MTQuickCapture.inferCategoryId(text,type)`.

- [ ] **Step 1: Write failing core tests**

Assert debit→expense, credit→income, positive amount, transaction date then visibly marked captured-time fallback, description mapping, no transfer inference, exact alias before merchant wallet suggestion, category suggestion fallback, deterministic `shortcut:<uuid>` ID, external metadata, existing-capture lookup, alias idempotency, and acknowledgement queue coalescing without raw text/token.

- [ ] **Step 2: Write failing Quick Capture seam test**

Assert `quick_capture.js` exports only the pure category inference entry point and still leaves confirmation/save behavior unchanged.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/shortcut_capture_core.test.js tests/shortcut_capture_quick_capture_static.test.js`

Expected: FAIL because the client core and public suggestion seam are absent.

- [ ] **Step 4: Implement the pure UMD core and narrow Quick Capture export**

`mapCaptureToDraft` returns `{draft,aliasKey,usedCapturedAtFallback}`; it never mutates inputs. `rememberWalletAlias` clones only the matched wallet and stores `{source,kind,last4}` values under `wallet.shortcutCaptureAliases` without merchant/raw text.

- [ ] **Step 5: Run core tests**

Run: `node --test tests/shortcut_capture_core.test.js tests/shortcut_capture_quick_capture_static.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shortcut_capture_core.js quick_capture.js tests/shortcut_capture_core.test.js tests/shortcut_capture_quick_capture_static.test.js
git commit -m "feat: add shortcut capture client mapping"
```

### Task 7: Durable Transaction Integration

**Files:**
- Modify: `app_v2.js`
- Create: `tests/shortcut_capture_transaction.test.js`

**Interfaces:**
- Consumes: `MTShortcutCaptureCore.transactionId`, `S.tx.externalCapture`, existing `validateTransactionDraft`, `cleanTxFromDraft`, and `persist('transaction')`.
- Produces: deterministic transaction creation, persisted `externalCapture`, duplicate guard, and a successful `transactionSave` hook result only after durable commit.

- [ ] **Step 1: Write failing transaction integration tests**

Using the existing VM/runtime style, assert no capture transaction before Save; failed validation/storage returns false and creates nothing; successful Save uses `shortcut:<capture-id>` and preserves provider/capture/dedupe metadata; repeat/double Save keeps one transaction; editing preserves metadata; transfer remains allowed; recurring/installment flags return a clear validation error and create no fan-out rows. Add a `transactionClose` screen-hook assertion so manual form closure has an explicit release seam.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/shortcut_capture_transaction.test.js tests/runtime_cleanup.test.js tests/screen_hooks.test.js`

Expected: the new capture assertions FAIL while existing transaction tests remain green.

- [ ] **Step 3: Implement the narrow `App.saveTx` seam**

Choose the deterministic ID only for new drafts carrying valid `externalCapture`; preserve metadata from `S.tx` or the existing transaction in `cleanTxFromDraft`; detect existing capture ID before insertion; reject recurring/installment only while external capture metadata is present. Add `transactionClose: 'closeAddTx'` to the existing `MTScreenHooks.install` mapping. Do not bypass existing validation, commit, wallet calculations, merchant registration, or hooks.

- [ ] **Step 4: Run transaction tests**

Run: `node --test tests/shortcut_capture_transaction.test.js tests/runtime_cleanup.test.js tests/screen_hooks.test.js tests/state_commit.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app_v2.js tests/shortcut_capture_transaction.test.js
git commit -m "feat: persist reviewed shortcut transactions safely"
```

### Task 8: Auth-Scoped Transport and Acknowledgement Recovery

**Files:**
- Create: `shortcut_capture.js`
- Create: `tests/shortcut_capture_transport.test.js`

**Interfaces:**
- Consumes: `MTAuthSync.state`, `mt:auth-state-changed`, Supabase URL/anon key globals, `MTShortcutCaptureCore`, `MTScreenHooks`, `S`, `App`, and `persist`.
- Produces: global `MTShortcutCapture` methods `refresh()`, `claim(id)`, `release(id)`, `dismiss(id)`, `restore(id)`, `openDraft(id)`, `listTokens()`, `createToken(label)`, `revokeToken(id)`, `retryAcknowledgements()`, and read-only `snapshot()`.

- [ ] **Step 1: Write failing transport tests**

Assert every app request captures `{userId,accessToken}` and rejects its response if auth scope changes; previous-user summaries are cleared on auth event; offline requests are skipped without losing queue; timeout/network/5xx acknowledge errors enqueue once; 4xx terminal conflicts surface for reconciliation; startup, visibility, pageshow, online, and explicit refresh trigger the specified work without polling/realtime. Assert each claim supplies a stable random UUID from `mt_shortcut_client_device`.

- [ ] **Step 2: Write failing save-before-ack tests**

Install real `transactionSave` and `transactionClose` hooks around fake durable App methods. Assert `context.result !== true` never aliases/acks; true Save records the alias only for expense/income, persists wallets, calls consume, displays `Saved; inbox sync pending` on failure, and later `ack` drains only the current user's job after claim expiry. Manual close releases online and otherwise lets the lease expire. Pin the account-switch and network-loss Review Focus cases.

- [ ] **Step 3: Run transport tests to verify they fail**

Run: `node --test tests/shortcut_capture_transport.test.js`

Expected: FAIL because the feature module is missing.

- [ ] **Step 4: Implement transport/orchestration without UI markup**

Namespace the durable queue as `mt_shortcut_ack_queue:<user-id>`. Store only capture ID, deterministic transaction ID, dedupe version/key, attempts, and retry timestamps. Generate and retain the non-secret browser claim-device UUID separately under `mt_shortcut_client_device`. Use bounded fetch timeouts and response codes from the spec. Keep decrypted summaries, payloads, and claim secrets in memory only. `openDraft` maps into `S.tx`, opens the existing Add Transaction detail form, and retains active capture state until Save or the `transactionClose` release hook.

- [ ] **Step 5: Run transport and transaction tests**

Run: `node --test tests/shortcut_capture_transport.test.js tests/shortcut_capture_core.test.js tests/shortcut_capture_transaction.test.js tests/screen_hooks.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shortcut_capture.js tests/shortcut_capture_transport.test.js
git commit -m "feat: add shortcut inbox transport and recovery"
```

### Task 9: Inbox, Review, and Token Settings UI

**Files:**
- Modify: `shortcut_capture.js`
- Modify: `ui_v2.css`
- Modify: `feature_loader.js`
- Modify: `release_manifest.js`
- Create: `tests/shortcut_capture_ui.test.js`
- Modify: `tests/feature_loader.test.js`

**Interfaces:**
- Consumes: transport snapshot/actions, `App.openSubScreen`, `App.showConfirm`, existing Add Transaction overlay, and `MTScreenHooks` screens `transactions`, `more`, `addTransactionDetail`.
- Produces: Transactions Inbox button/badge, dedicated Inbox sub-screen, review disclosure, and More > Settings token-management row/screen.

- [ ] **Step 1: Write failing UI/loader tests**

Assert capture group order `quick_capture.js` → `shortcut_capture_core.js` → `shortcut_capture.js`; both new files are deferred/offline assets; hooks are registered without reassigning render methods; Inbox renders loading/empty/offline/error/pending/claimed states; dismissed rows require confirmation and allow restore; raw text is collapsed and HTML-escaped; token plaintext appears only in the create-result screen with Copy and disappears after close.

- [ ] **Step 2: Run UI tests to verify they fail**

Run: `node --test tests/shortcut_capture_ui.test.js tests/feature_loader.test.js tests/release_manifest.test.js tests/xss_escape_holes_static.test.js`

Expected: FAIL because assets, hooks, and UI are not wired.

- [ ] **Step 3: Implement screen hooks and semantic markup**

Inject one Inbox control into the Transactions header and one `Connect iOS Shortcut` row into the Settings pane after render. Use existing cards/buttons/sub-screen patterns, accessible labels/focus, a collapsed `<details>` disclosure, and confirmation before dismiss. The review screen calls `openDraft`; it never exposes an auto-save action.

- [ ] **Step 4: Add focused responsive styles**

Add `.shortcut-inbox-*` and `.shortcut-token-*` classes to `ui_v2.css` for 320px width, safe-area/keyboard scrolling, light/dark tokens, badge contrast, disabled/loading states, and 44px touch targets. Do not add inline theme constants beyond existing design tokens.

- [ ] **Step 5: Wire deferred loading and cache assets**

Update `feature_loader.js` and both `coreAssets`/`deferredAssets` arrays in `release_manifest.js`; do not bump the release version yet.

- [ ] **Step 6: Run UI and accessibility/static tests**

Run: `node --test tests/shortcut_capture_ui.test.js tests/feature_loader.test.js tests/release_manifest.test.js tests/xss_escape_holes_static.test.js tests/touch_target_size_static.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shortcut_capture.js ui_v2.css feature_loader.js release_manifest.js tests/shortcut_capture_ui.test.js tests/feature_loader.test.js
git commit -m "feat: add shortcut transaction inbox UI"
```

### Task 10: Shortcut Contract, Security Gates, and Release Runbook

**Files:**
- Modify: `outputs/money-tracker-shortcut-action-map.json`
- Modify: `outputs/money-tracker-shortcut-setup-th.md`
- Modify: `outputs/money-tracker-shortcut-verification.md`
- Modify: `work/reference-parser.mjs`
- Modify: `work/reference-parser.test.mjs`
- Create: `tests/shortcut_capture_security_static.test.js`
- Create: `docs/SHORTCUT_INBOX_DEPLOYMENT.md`
- Modify: `release_manifest.js`
- Modify generated query versions: `index.html`, `demo/index.html`

**Interfaces:**
- Consumes: released Edge Function contracts, app token UI, parser fixtures, and release tooling.
- Produces: backend-compatible native Shortcut build instructions, deploy/smoke/rollback procedure, and release `2026.10.18-shortcut-inbox-r143`.

- [ ] **Step 1: Write failing parser-contract and security tests**

Update parser expectations to a two-decimal amount string and the v1 fingerprint including normalized relevant-text hash. Add static assertions that only ingestion has `verify_jwt=false`; manage/inbox call `requireAuthenticatedUserId` before `adminClient`; client files contain no service-role secret; migration grants no direct client access; logger calls cannot receive capture payload fields.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `node --test work/reference-parser.test.mjs tests/shortcut_capture_security_static.test.js`

Expected: FAIL against the old Shortcut contract and absent security gate.

- [ ] **Step 3: Update the native Shortcut build kit**

Set the Production URL pattern to `https://<project-ref>.supabase.co/functions/v1/ingest-shortcut-capture`, document obtaining the one-time device token from Money Tracker, send it as Bearer authorization, handle queued 202/duplicate 200, and retain Quick Look/no-network Test mode. Keep the signing limitation explicit: no importable `.shortcut` is promised unless exported and signed by Apple Shortcuts on the user's device.

- [ ] **Step 4: Write deployment and rollback runbook**

Document migration, `MT_SHORTCUT_TOKEN_PEPPER_V1` and `MT_SHORTCUT_INBOX_KEY_V1` generation/storage, function deployment with `--no-verify-jwt` only for ingestion, scheduled cleanup verification, synthetic smoke payloads, token revocation, key-retention rollback, and manual mobile light/dark/cross-device/network-loss checks. Do not print secret values in commands or logs.

- [ ] **Step 5: Bump and regenerate release assets**

Set `release_manifest.js` version to `2026.10.18-shortcut-inbox-r143`, then run:

`node scripts/update-release-version.js`

Expected: `index.html` and `demo/index.html` local JS/CSS query versions match the release manifest.

- [ ] **Step 6: Run focused backend, client, and parser verification**

Run:

```bash
supabase test db --workdir supabase
deno test supabase/functions/_shared/*_test.ts supabase/functions/manage-shortcut-tokens/index_test.ts supabase/functions/ingest-shortcut-capture/index_test.ts supabase/functions/shortcut-inbox/index_test.ts
node --test work/reference-parser.test.mjs tests/shortcut_capture_core.test.js tests/shortcut_capture_transaction.test.js tests/shortcut_capture_transport.test.js tests/shortcut_capture_ui.test.js tests/shortcut_capture_security_static.test.js tests/feature_loader.test.js tests/release_manifest.test.js
```

Expected: every focused suite PASS.

- [ ] **Step 7: Run the full product suite**

Run: `node --test tests/*.test.js`

Expected: all tests PASS with zero failures.

- [ ] **Step 8: Perform synthetic manual acceptance**

Using no real banking text, verify Notification and `Get What's On Screen`, latest-block selection, Test mode, Production queued/duplicate results, closed-app ingestion, review/edit/save, transfer edit, offline acknowledgement retry, dismiss/restore, revoked token, claim conflict, and 320px light/dark UI. Record results in `outputs/money-tracker-shortcut-verification.md`.

- [ ] **Step 9: Commit**

```bash
git add outputs work/reference-parser.mjs work/reference-parser.test.mjs tests/shortcut_capture_security_static.test.js docs/SHORTCUT_INBOX_DEPLOYMENT.md release_manifest.js index.html demo/index.html
git commit -m "docs: finalize shortcut inbox release workflow"
```

## Completion Gate

Before calling the feature complete, verify the worktree is clean, every commit above is present, the full Node suite and focused Deno/pgTAP suites pass from fresh state, and the manual evidence contains no real bank notification, token, encryption key, or decrypted payload. The resulting branch is ready for review but must not be deployed until Supabase secrets are configured and the synthetic production smoke test passes.
