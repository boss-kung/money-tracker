# Shortcut Transaction Inbox Design

Date: 2026-10-18 (Asia/Bangkok)

## Intent

Connect the native iOS Money Tracker Shortcut to Money Tracker without allowing captured notifications or screen text to create financial records automatically. The Shortcut may collect a supported transaction while the app is closed, but every capture must enter a review inbox. The user can correct the proposed transaction and must explicitly press Save before it affects the Ledger, wallet balances, reports, or encrypted Vault.

Success means:

- both Shortcut entry paths—LINE notification automation and manual `Get What's On Screen`—can submit the same normalized payload;
- UOB Thai/English, SCB Connect, and LINE Wallet THB transactions are supported;
- a screen containing several supported transactions contributes only its latest relevant block;
- duplicate submissions are harmless across Shortcut retries, multiple devices, and acknowledgement failures;
- captured raw text is protected at rest, has bounded retention, and is never written to logs;
- Money Tracker reuses its existing transaction validation, persistence, merchant suggestions, and encrypted Vault flow after user review.

## Scope and non-goals

Version 1 accepts only schema `money-tracker.capture.v1`, currency `THB`, capture methods `line_notification` and `whats_on_screen`, and sources `uob_thai`, `scb_connect`, and `line_wallet`. UOB English text is normalized to the existing `uob_thai` source identifier and `UOB` bank label so the previously delivered Shortcut contract remains compatible.

Version 1 does not:

- save transactions automatically;
- infer transfers automatically;
- support OCR, arbitrary banks, non-THB currencies, or partially parsed submissions;
- write directly to the encrypted user Vault from an Edge Function;
- add a new primary navigation tab, push notification, or realtime subscription;
- provide end-to-end encryption against the Money Tracker server. The server function must decrypt inbox payloads for the authenticated app client.

## Selected approach

Use an encrypted server-side Transaction Inbox. This is preferable to a deep-link-only handoff because notification automation must work while Money Tracker is closed, and preferable to direct transaction or Vault mutation because the user must review the capture and the server does not hold the client's Vault data key.

```text
LINE notification / Get What's On Screen
  -> native iOS Shortcut parser
  -> normalized capture + dedupe fingerprint
  -> ingest-shortcut-capture Edge Function
  -> scoped-token authentication, validation, rate limit, AES-GCM encryption
  -> mt_shortcut_captures
  -> authenticated Money Tracker Inbox
  -> wallet/category/merchant suggestions
  -> existing Add Transaction form
  -> explicit user Save
  -> existing persist() boundary
  -> Ledger, balances, reports, encrypted Vault
```

The inbox is a staging boundary, not a second ledger. A capture has no accounting effect until the existing `App.saveTx` path succeeds.

## Trust boundaries and authorization

There are two distinct authentication boundaries:

1. The Shortcut uses a revocable device token only with `ingest-shortcut-capture`. This function is the sole endpoint deployed with gateway JWT verification disabled. It authenticates the token itself before using the service-role database client.
2. The Money Tracker web app uses its normal Supabase session JWT with `manage-shortcut-tokens` and `shortcut-inbox`. These functions resolve the authenticated user before any service-role access and never accept a user ID from the request body.

A device token has only the authority to append a validated capture to one user's inbox. It cannot list, decrypt, update, dismiss, consume, or delete captures, and it cannot access transactions or the Vault.

Token creation returns the plaintext secret exactly once. The stored credential is an HMAC-SHA-256 verifier made with the server-side `MT_SHORTCUT_TOKEN_PEPPER_V1` secret. The token string contains a non-secret identifier used for indexed lookup plus 256 bits of cryptographically random secret material. Verification compares fixed-length byte arrays in constant time. Logs may include a capture ID, token ID, source, status code, and error code, but never the token, raw text, normalized relevant text, merchant description, encryption material, or decrypted payload.

Each user may have at most five active tokens. A token has a user-editable device label, creation time, last-used time, revocation time, and atomic rate-window counters. Revocation takes effect on the next request. Ingestion is limited to 30 authenticated requests per token per fixed one-minute database window; rejected authentication attempts are additionally subject to platform-level abuse controls.

## Shortcut payload contract

The Shortcut posts JSON to `ingest-shortcut-capture` with `Authorization: Bearer <device-token>` and `Content-Type: application/json`. The decoded request body must be no larger than 32 KiB.

```json
{
  "schema_version": "money-tracker.capture.v1",
  "parser_version": "ios-shortcut-1.0.0",
  "source": "scb_connect",
  "bank": "SCB",
  "amount": "80.00",
  "currency": "THB",
  "direction": "debit",
  "merchant": "MBR9",
  "description": "MBR9",
  "account_last4": "4078",
  "card_last4": null,
  "transaction_datetime": "2026-10-05T21:39:00+07:00",
  "captured_at": "2026-10-05T21:40:03+07:00",
  "capture_method": "whats_on_screen",
  "raw_text": "...",
  "relevant_text": "...",
  "parse_status": "complete",
  "dedupe_version": 1,
  "dedupe_key": "64-lowercase-hex-characters"
}
```

Required fields are schema and parser versions, source, amount, currency, direction, captured time, capture method, raw text, relevant text, complete parse status, dedupe version, and dedupe key. `amount` is a positive decimal string with at most two fractional digits and is canonicalized to exactly two digits before storage. `direction` is `debit` or `credit`. Account and card identifiers, when supplied, are exactly four digits. `transaction_datetime` may be null when the source text has no transaction time; the review draft then proposes `captured_at` and visually identifies that fallback. Merchant and description may be null, but at least one supported source anchor and a positive amount are required.

Before fingerprinting, `relevant_text` is normalized with Unicode NFKC, CRLF-to-LF conversion, non-breaking-space replacement, collapsed horizontal whitespace, collapsed blank lines, and outer trimming. The Shortcut calculates the v1 fingerprint as SHA-256 lowercase hexadecimal over UTF-8 text joined with `|`:

```text
v1 | source | direction | canonical amount | THB |
account_last4 or card_last4 or empty |
transaction_datetime or captured_at calendar date |
trimmed lowercase description or empty |
SHA-256 of normalized relevant_text
```

The server independently canonicalizes the validated fields and recomputes the fingerprint. A mismatch is a `400 invalid_dedupe_key`; the server never trusts a client-provided fingerprint as proof of content.

For `Get What's On Screen`, the Shortcut matches every complete supported block, preserves screen order, selects the last match, and classifies/parses only that block. Notification automation receives one notification text and uses the same parser. Test mode shows the chosen block and complete normalized JSON with Quick Look and never sends a network request. Production mode refuses non-HTTPS endpoints, unchanged template endpoint/token values, unknown sources, incomplete parsing, and non-positive amounts.

## Database design

### `mt_shortcut_tokens`

One row represents one revocable Shortcut installation credential:

- `id uuid primary key`
- `user_id uuid not null references auth.users on delete cascade`
- `label text not null`
- `secret_verifier bytea not null`
- `secret_prefix text not null`
- `created_at timestamptz not null`
- `last_used_at timestamptz`
- `revoked_at timestamptz`
- `rate_window_started_at timestamptz`
- `rate_window_count integer not null default 0`

An indexed active-token lookup uses `id`; the visible prefix is for identification only. Token creation and the five-active-token limit execute in one database transaction so concurrent requests cannot exceed the limit. Only Edge Functions using the service role access secret verifiers.

### `mt_shortcut_captures`

One row is both an encrypted staging item and, after payload deletion, its dedupe receipt:

- `id uuid primary key`
- `user_id uuid not null references auth.users on delete cascade`
- `token_id uuid references mt_shortcut_tokens(id) on delete set null`
- `schema_version text not null`
- `dedupe_version integer not null`
- `dedupe_key text not null`
- `status text not null`: `pending`, `claimed`, `consumed`, `dismissed`, or `expired`
- `ciphertext bytea`, `iv bytea`, `encryption_key_version integer`
- `claim_token_hash bytea`, `claim_device_id text`, `claim_expires_at timestamptz`
- `consumed_transaction_id_hash bytea`
- `accepted_at`, `updated_at`, `consumed_at`, `dismissed_at`, and `payload_purge_at` timestamps

The unique constraint `(user_id, dedupe_version, dedupe_key)` is the authoritative idempotency boundary. The dedupe receipt remains for 180 days from `accepted_at`, including after ciphertext deletion. No bank, amount, account/card, merchant, description, capture-method, or raw-text field is stored in plaintext; the remaining plaintext columns are identifiers, status, dedupe values, cryptographic/claim metadata, and timestamps needed to operate the inbox. Direct client-table access is denied; authenticated access occurs only through `shortcut-inbox`.

## Encryption and retention

The deployment secret `MT_SHORTCUT_INBOX_KEY_V1` contains a 256-bit AES key. Every capture uses AES-256-GCM with a fresh 96-bit random IV. Authenticated additional data binds `capture id`, `user id`, `schema version`, and `encryption key version`; swapping ciphertext between rows therefore fails authentication. The complete validated payload, including raw and relevant text, is encrypted as canonical UTF-8 JSON.

New key versions may be added while older keys remain available for unexpired payloads. New writes always use the highest configured version. Reads select the key by row version. Rotation does not require eagerly rewriting rows because payload lifetimes are short; an old key may be removed only after no retained ciphertext references it.

Retention is deterministic:

- unreviewed `pending` or abandoned `claimed` captures expire 30 days after `accepted_at`; expiration clears ciphertext immediately and leaves an `expired` receipt;
- a consumed payload is retained for seven days after `consumed_at`, then its ciphertext, IV, claim material, and key version are cleared;
- a dismissed payload is retained for seven days after `dismissed_at` so the user can restore it, then the same sensitive fields are cleared;
- every receipt is deleted 180 days after `accepted_at`;
- deleting the user cascades both tokens and captures immediately.

A scheduled cleanup job releases expired claims before applying payload and receipt retention. Cleanup is idempotent and never changes a consumed or dismissed item back to pending.

## Edge Function interfaces

### `manage-shortcut-tokens`

This authenticated endpoint supports:

- `GET /` — list token IDs, labels, visible prefixes, created/last-used times, and revocation state;
- `POST /` — create a labelled token and return its plaintext value once;
- `POST /:id/revoke` — revoke one token owned by the current user.

Creating a sixth active token returns `409 active_token_limit`. Revoking an already revoked owned token is idempotent. The endpoint never returns a verifier or another user's metadata.

### `ingest-shortcut-capture`

This custom-token endpoint performs operations in this order: bounded request-size check, token syntax and indexed lookup, constant-time verification and revocation check, atomic rate-limit update, schema validation and fingerprint recomputation, existing-receipt lookup, encryption using a preselected capture ID, and an insert protected by the unique dedupe constraint. A uniqueness race returns the winning existing row as a duplicate. Authentication occurs before any detailed validation response so an unauthenticated caller cannot use the API as a parser oracle, and encryption failure occurs before any pending row is written.

An accepted item returns HTTP 202:

```json
{ "status": "queued", "capture_id": "uuid", "duplicate": false }
```

A duplicate returns HTTP 200 with the existing capture ID and `duplicate: true`, including when that receipt is already consumed, dismissed, or expired. This tells the Shortcut that no retry is needed without exposing the existing status.

Error responses contain a stable code and safe message: `400 invalid_capture`, `400 invalid_dedupe_key`, `401 invalid_token`, `401 revoked_token`, `413 payload_too_large`, `429 rate_limited`, or `500 ingest_failed`. Encryption or database failure never leaves a pending row without valid ciphertext.

### `shortcut-inbox`

This Supabase-JWT endpoint supports:

- list/count pending items, with cursor pagination;
- claim one capture for review;
- release the caller's active claim;
- consume a claimed capture with its Money Tracker transaction ID;
- dismiss a pending or caller-claimed capture;
- restore a dismissed capture while its seven-day payload window remains;
- retry acknowledgement for a transaction already saved locally.

Claims use a random claim secret whose hash is stored in the database. A claim lasts ten minutes and is required for consume or release. Another device receives `409 capture_claimed`; an expired claim may be replaced atomically. List responses contain only the decrypted preview fields needed to render the authenticated owner's inbox; raw and relevant text are returned only by a successful claim. Claim secrets are never persisted in the encrypted Vault and may be kept only in current client session state.

Consume is idempotent when called again with the same deterministic transaction ID, which is compared through its stored hash. Normal consume requires the active claim secret. The acknowledgement-retry operation may atomically consume a pending item or an item whose claim has expired when supplied with the deterministic `shortcut:<capture-uuid>` transaction ID; this allows a transaction saved just before connectivity loss to reconcile without a live claim. If the capture is already consumed by a different transaction ID, it returns `409 capture_already_consumed`. Dismiss asks for confirmation in the client. Restore returns the capture to pending only while ciphertext exists and it has not been consumed.

## Money Tracker client integration

The implementation adds two focused modules rather than expanding the global application file with transport and parsing logic:

- `shortcut_capture_core.js` is a pure module for response validation, capture-to-draft mapping, deterministic transaction IDs, wallet alias matching, terminal-state rules, and acknowledgement queue decisions;
- `shortcut_capture.js` owns Supabase calls, token-settings UI, inbox rendering, claim lifecycle, connectivity handling, and hooks into the existing transaction form.

Both load in the existing `capture` feature group after `quick_capture.js`. The integration uses established screen/sub-screen patterns and the `MTScreenHooks` seam. Transaction-save handling must check `context.result === true`; failed existing validation must not consume a capture.

The Transactions screen gains an Inbox button with a pending-count badge. The button opens a dedicated sub-screen with loading, empty, offline, error, pending, claimed-by-other-device, and dismissed-history states. More > Settings gains a `Connect iOS Shortcut` section to create, label, copy once, inspect last use, and revoke tokens. It does not embed the secret into the web page after the one-time creation response.

The app fetches the count and pending page after authenticated startup, resume/visibility, network recovery, successful acknowledgement, and explicit refresh. It does not poll continuously, subscribe to realtime, or request push permission. A new remote item therefore requires connectivity and one of those refresh triggers before it appears.

Opening a capture claims it, maps it into the existing Add Transaction form, and leaves every field editable. Closing without saving releases the claim when online; otherwise the lease expires. Raw text appears in a collapsed review-only disclosure and is not copied into the transaction note.

## Draft mapping and suggestions

The initial mapping is:

| Capture value | Draft behavior |
| --- | --- |
| `direction: debit` | Propose `expense` |
| `direction: credit` | Propose `income` |
| amount | Use the positive canonical amount |
| transaction time | Use `transaction_datetime`; otherwise visibly fall back to `captured_at` |
| description/merchant | Propose the transaction description |
| source plus account/card last four | Resolve a remembered wallet alias |
| raw text | Review disclosure only |

The app never infers `transfer`; the user may change the form to Transfer and select both wallets. An exact wallet alias has priority over heuristic suggestions. Wallet aliases are stored as `wallet.shortcutCaptureAliases`, become part of the existing wallet state, and therefore follow the existing encrypted Vault synchronization. After a successful expense or income save with a source identifier and selected wallet, the app records or refreshes the reviewed `source + identifier kind + last4` mapping on that wallet. It must not store raw text or merchant text in the alias.

When no exact alias exists, existing Quick Capture and merchant-history behavior may propose a wallet/category where applicable. Existing `App.getMerchantSuggestion` behavior supplies merchant/category suggestions; suggestions remain editable and never trigger Save. Expense and income still obey the current requirement for a category. The existing transaction validator remains authoritative.

## Save, idempotency, and reconciliation

Every reviewed draft receives deterministic ID `shortcut:<capture-uuid>` and metadata:

```json
{
  "externalCapture": {
    "provider": "ios_shortcut",
    "captureId": "uuid",
    "dedupeVersion": 1,
    "dedupeKey": "64-lowercase-hex-characters"
  }
}
```

The transaction ID and external metadata persist in the existing transaction object and encrypted Vault. Before save, the client checks for that deterministic ID or matching external capture ID. If found, it does not create another local transaction and proceeds only with acknowledgement reconciliation.

The ordered save flow is:

1. claim the capture;
2. open and edit the existing transaction form;
3. run existing validation and `App.saveTx`;
4. let the existing `persist()` boundary update local state, Ledger, balances, reports, and Vault dirty state;
5. only after confirmed local save, call consume with the deterministic transaction ID;
6. if consume fails because of connectivity or a transient server error, keep the local transaction and add a minimal acknowledgement job to a local retry queue;
7. retry after authenticated startup, resume, network recovery, or explicit inbox refresh.

Acknowledgement failure never rolls back an accepted local transaction. A retry job stores only capture ID, transaction ID, dedupe version/key, retry timing, and attempt metadata—not raw text or a device token. If another device races, deterministic IDs and the server's consume rule converge on one logical transaction. A server `capture_already_consumed` response causes the client to compare transaction IDs and show a reconciliation warning instead of silently changing either record.

## Offline behavior

The Shortcut can queue captures while the web app is closed because ingestion is independent of the client Vault. The web app needs an authenticated online session to fetch or open a newly queued item. Already loaded inbox summaries may be shown offline, but encrypted payloads are not added to the Vault or durable browser cache merely for offline review.

If connectivity is lost after the local transaction save and before consume, the local acknowledgement queue preserves reconciliation work. If connectivity is lost before local save, the existing form remains a normal unsaved draft and the server claim eventually expires. Version 1 does not promise cross-device real-time badge accuracy.

## Error handling and user-visible states

- Invalid Shortcut parsing is stopped locally and shown in Quick Look; it is never posted.
- Invalid or oversized server payloads show a concise Shortcut error and retain no remote item.
- Revoked/invalid tokens instruct the user to reconnect the Shortcut from Money Tracker settings.
- Rate limiting returns a retryable error without creating another capture.
- Offline inbox access states that a connection is required; existing Ledger use remains unaffected.
- A claim conflict identifies that another device is reviewing the item and offers refresh, not force takeover.
- Existing transaction validation errors keep the form and claim open and do not acknowledge the capture.
- Acknowledgement failure displays `Saved; inbox sync pending` and schedules retry.
- Decryption/authentication failure returns a generic unavailable state, records only safe operational identifiers, and never returns corrupt plaintext.

## Testing strategy

### Database and Edge Functions

- SQL tests cover ownership, transactional five-token enforcement, token revocation, user deletion cascades, dedupe uniqueness, atomic rate windows, ten-minute claim replacement, consume idempotency, dismiss/restore windows, and cleanup at all retention boundaries.
- Deno unit tests cover strict payload validation, canonical decimal/datetime handling, server fingerprint recomputation, token verifier comparison, AES-GCM round trips, AAD mismatch rejection, key-version reads, revoked tokens, duplicates, and rate limiting.
- Static security tests require authentication before service-role operations, gateway JWT disabling only for ingestion, no plaintext-sensitive logging, and no direct client grants on either table.

### Client

- Node tests cover draft mapping, captured-time fallback, debit/credit defaults, no transfer inference, exact alias priority, deterministic IDs, existing-transaction detection, save-before-ack ordering, retry queue coalescing, and terminal-state transitions.
- Existing parser fixtures remain authoritative for UOB Thai/English, SCB debit/credit, LINE Wallet, noisy screen content, multiple blocks, and latest-relevant-block selection.
- DOM/UI tests cover badge refresh, token copy-once behavior, confirmation before dismiss, seven-day restore, validation failures, claim conflicts, offline states, and acknowledgement warnings.
- Manual checks cover phone-size light/dark layouts, keyboard/form behavior, signed-in reload, app resume, and cross-device claim conflict.

### End to end

Use synthetic bank text only. Verify both Shortcut entry paths in Test mode and Production mode, accepted and duplicate responses, app-closed ingestion, authenticated Inbox review, editing, successful Save, wallet/category effects through the existing transaction path, Vault synchronization, acknowledgement retry after simulated network loss, token revocation, and cleanup. Run the full project suite with `node --test tests/*.test.js` before release.

## Deployment and rollback

Deploy in this order:

1. apply the database migration and scheduled cleanup job;
2. configure the token pepper and `MT_SHORTCUT_INBOX_KEY_V1` secrets;
3. deploy shared helpers and the three Edge Functions, disabling gateway JWT verification only for ingestion;
4. deploy web modules, tests, feature-loader entries, UI assets, and the bumped release manifest;
5. update the Shortcut Production endpoint and provision a device token from the released app;
6. perform synthetic end-to-end verification before enabling real notification automations.

Rollback first revokes active Shortcut tokens or disables ingestion, then hides the Inbox/settings entry points while keeping acknowledgement retries available. Database tables and encryption keys remain until all retained payloads have expired or been safely purged; an application rollback must not strand ciphertext without its key. Migration rollback is not attempted while inbox rows exist.

## Acceptance criteria

The design is complete when implementation can demonstrate all of the following:

- a supported notification or latest supported screen block queues exactly one encrypted inbox item;
- resubmitting the same normalized capture returns the existing capture ID and never creates a second item;
- no capture affects accounting state before explicit user Save through the existing transaction form;
- suggestions are editable and transaction validation remains authoritative;
- the same capture cannot create two transactions during retry or multi-device races;
- raw payload data is absent from logs, direct client access, wallet aliases, transaction notes, and acknowledgement jobs;
- token revocation, rate limits, retention, restore, account deletion, and key rotation behave as specified;
- existing Money Tracker transaction and Vault behavior continues to pass its full test suite.
