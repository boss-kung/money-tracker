# Shortcut Multi-Transaction Ingest Design

Date: 2026-10-24 (Asia/Bangkok)

## Intent

Allow one Shortcut screen capture to queue every supported transaction visible in
the capture, while preserving the existing review-first workflow. Each parsed
transaction becomes its own Shortcut Inbox item and must still be opened, edited,
and saved separately before it affects the Ledger.

The motivating UOB screen contains two transaction messages. Each message repeats
the same event in Thai and English, so the server must produce two logical
transactions—not the current one latest transaction and not four language-block
duplicates.

If a capture contains both readable and unreadable logical transactions, the
readable transactions must still enter the Inbox. The Shortcut response must say
how many were queued, already known, and unreadable so the user is not left with a
silent omission.

## Goals

- Keep the existing Shortcut request unchanged: one `raw_text` string plus
  `capture_method` and optional `captured_at`.
- Parse up to ten supported logical transactions from one authenticated request.
- Collapse adjacent Thai and English UOB representations of the same event into
  one logical transaction using conservative matching.
- Queue every successfully parsed logical transaction as an independent encrypted
  `mt_shortcut_captures` row.
- Preserve per-transaction deduplication across retries and uniqueness races.
- Accept readable transactions when another logical transaction in the same input
  is unreadable, and return a safe partial-result summary.
- Keep the current Inbox list, claim, review, Save, consume, and acknowledgement
  behavior unchanged.

## Non-goals

- No batch review or Save All action.
- No direct transaction creation and no change to the Ledger write boundary.
- No OCR implementation, unsupported-bank parsing, transfer inference, or new
  currencies.
- No attempt to derive the bank transaction time from a LINE chat bubble timestamp
  outside the supported message block.
- No client-supplied array of normalized captures; advanced Shortcuts that send one
  complete `money-tracker.capture.v1` payload remain single-item requests.
- No redesign of the existing v1 rule for two genuinely distinct transactions
  whose complete dedupe material is identical.

## Constraints

- Authentication, the 32 KiB request-body limit, encryption, retention, and the
  existing review-first trust boundaries remain authoritative.
- Raw or relevant bank text, amounts, merchants, and card/account identifiers must
  never appear in logs or ingestion responses.
- Existing single-item request and response behavior must remain compatible.
- A malformed or unsupported text fragment that has no supported transaction
  anchor is ignored; it is not reported as an unreadable transaction.
- More than ten logical transaction groups is rejected as `too_many_captures`
  before any row is inserted. The endpoint continues to rate-limit by authenticated
  request; the ten-item bound limits amplification without a database migration.

## Approaches considered

### Selected: split and persist multiple transactions on the server

The Shortcut continues to post one raw envelope. The server discovers candidate
blocks, groups bilingual representations, parses each group, and persists each
successful result through the existing encrypted Inbox boundary.

This keeps the fragile parsing logic out of iOS Shortcuts, centralizes tests and
rollout, and fits the current one-row-per-Inbox-item data model.

### Rejected: split and POST repeatedly from the Shortcut

This would avoid changing the ingestion response, but it would duplicate regex,
loop, error, and retry behavior in iOS Shortcuts. It is harder to test and would
behave differently across installed Shortcut versions.

### Rejected: store a batch row and expand it in the web app

This would provide a durable parent batch, but it requires a new table or batch
columns, new lifecycle states, and new UI despite the chosen requirement to review
items separately. The batch has no accounting meaning after ingestion.

## Architecture

```text
Shortcut raw_text
  -> authenticate + request rate limit
  -> discover supported transaction anchors
  -> parse candidates without persisting
  -> group matching adjacent UOB Thai/English candidates
  -> logical groups: successful or unreadable
  -> validate and dedupe each successful capture
  -> encrypt and insert each new capture row
  -> return ordered queued/duplicate/failed counts
  -> existing Shortcut Inbox review, one item at a time
```

The database remains one row per logical capture. No schema change is required.
The existing Inbox endpoint and Money Tracker client already list and review
multiple rows independently, so they require no product behavior change.

## Parser interface

Replace the ingestion path's single-result parser contract with a batch result:

```ts
type RawCaptureFailure = {
  item: number
  code: 'unreadable_capture'
}

type RawCaptureBatch = {
  found: number
  captures: Array<{ item: number; capture: ValidatedCaptureV1 }>
  failures: RawCaptureFailure[]
}

parseRawShortcutCaptures(input: unknown, now?: string): Promise<RawCaptureBatch>
```

`item` is a one-based logical-group position in screen order. `found` must equal
`captures.length + failures.length`. The parser does not return raw candidate text
inside failure objects.

The current exported singular parser is replaced in server code and tests rather
than retained as a second, ambiguous source of selection behavior. Parsing one
candidate still returns a batch with one capture.

## Candidate discovery and completeness

1. Validate the raw envelope and normalize a parsing copy with the existing CRLF,
   non-breaking-space, and horizontal-whitespace rules.
2. Scan in source order for the existing supported anchors:
   - UOB Thai: `มีการใช้บัตร UOB-####`
   - UOB English: `You have spent`
   - SCB: `รายการเงินออก` or `รายการเงินเข้า`
   - LINE Wallet: `LINE Pay Purchase`
3. A candidate extends from its anchor to the next supported anchor or the end of
   the normalized input. Surrounding UI text before the first anchor is ignored.
4. Parse each candidate into an intermediate record containing its source,
   language where applicable, extracted transaction fields, block position,
   completeness, and transient matching fields such as UOB available credit.
5. Preserve the existing completeness distinction: `whats_on_screen` requires the
   full supported screen suffix, while `line_notification` may use the existing
   compact-preview rules.

An anchored candidate that cannot meet the source's completeness and positive
amount requirements remains available for UOB grouping but is otherwise an
`unreadable_capture` failure. Text with no recognized anchor is not counted.

## UOB bilingual grouping

Only adjacent UOB candidates of opposite languages may be grouped. Two Thai
candidates or two English candidates are never collapsed merely because their
fields match.

The candidates form one group only when all of these checks pass:

- both have the same canonical positive amount;
- both expose the same four-digit card suffix;
- merchants match after NFKC, case, punctuation, and whitespace normalization when
  both merchants are present;
- available-credit values match when both are present;
- transaction calendar dates match when both are present; and
- no SCB, LINE Wallet, or other UOB candidate occurs between them.

These rules intentionally prefer an extra review item over silently merging two
distinct financial events. Available credit is used only for pairing and is not
added to the stored capture schema.

A bilingual group succeeds when at least one member is complete. The later complete
member is the primary representation; missing optional fields may be filled from
its matching partner only when there is no conflict. Using the later complete block
as `relevant_text` preserves the previous `latestBlock` dedupe material for the
single bilingual UOB notification shape already supported. The encrypted
`raw_text` for the item contains only the normalized member block or paired blocks,
not the entire multi-transaction screen.

SCB and LINE Wallet candidates each form their own logical group. Logical groups
remain in screen order.

## Dedupe and backward compatibility

Each successful logical group continues to produce a validated
`money-tracker.capture.v1` payload with `dedupe_version: 1`. The existing
`canonicalDedupeMaterial()` and database uniqueness constraint remain unchanged.

For an existing multi-item screen, the last logical transaction uses the same
primary relevant block that the old `latestBlock()` implementation selected. A
retry after deployment therefore recognizes an already queued last transaction as
a duplicate while adding the previously ignored earlier transactions.

Within one request, captures are processed in screen order. The handler checks
existing receipts before encryption. A unique-constraint race is resolved using
the existing winner lookup and reported as a duplicate. Each new row receives its
own UUID, IV, AES-GCM payload, and deterministic downstream transaction ID.

## Persistence semantics

The handler performs these phases:

1. Bound the body, authenticate the device token, and take the existing request
   rate-limit slot.
2. Parse a raw envelope into logical successes and failures, or validate a direct
   normalized payload as a one-item batch.
3. Reject zero discovered groups as `invalid_capture`; reject more than ten groups
   as `too_many_captures` before persistence.
4. Validate every successful capture with `validateCaptureV1()`.
5. Resolve existing dedupe receipts for every valid capture.
6. Load the keyring once, generate an ID for each new item, and encrypt all new
   payloads before the first insert. An encryption failure therefore inserts none.
7. Insert new rows individually in screen order. Resolve uniqueness races as
   duplicates.
8. Return ordered results and aggregate counts.

Parse failure is an intentional partial-success condition. Encryption or database
failure is not: it returns the existing safe `500 ingest_failed`. If an unexpected
database failure happens after an earlier row was inserted, retrying the identical
request converges because the earlier row is found by its dedupe key and the
remaining rows can be inserted. The response and documentation must tell the user
to rerun the Shortcut after `ingest_failed`.

## Response contract

A single successful logical item with no parse failure keeps the current response
shape and status codes:

```json
{ "status": "queued", "capture_id": "uuid", "duplicate": false }
```

- new row: HTTP 202;
- existing receipt: HTTP 200 with `duplicate: true`.

Multiple logical items or any partial parse use the batch response:

```json
{
  "status": "partial",
  "message": "เข้า Inbox 1 รายการ • ซ้ำ 0 รายการ • อ่านไม่สำเร็จ 1 รายการ",
  "found": 2,
  "queued": 1,
  "duplicate": 0,
  "failed": 1,
  "results": [
    { "item": 1, "status": "queued", "capture_id": "uuid", "duplicate": false },
    { "item": 2, "status": "failed", "code": "unreadable_capture" }
  ]
}
```

The top-level status is:

- `partial` when `failed > 0` and at least one capture was queued or duplicate;
- `queued` when all groups succeeded and at least one new row was queued;
- `duplicate` when all successful groups were existing receipts.

HTTP status is 202 when `queued > 0`, otherwise 200 when at least one duplicate
exists. If every discovered group is unreadable, return HTTP 400
`invalid_capture` with only safe aggregate counts and failure ordinals.

`results` follows screen order. The response exposes no source, bank text, amount,
merchant, identifier, or raw/relevant text. The human-readable Thai message is a
convenience for the current Quick Look action; counts and status values are the
stable machine-readable contract.

## Shortcut and Inbox behavior

The generated native Shortcut and the manual setup continue posting the same two
JSON keys. Their existing Quick Look action can display the new `message` and
counts without requiring parsing logic on the device.

No Inbox UI change is required. Each queued row appears as an ordinary pending
item. Opening one claims only that capture; Save consumes only that capture; Close
releases only that capture. Successfully saving one item has no effect on the
other items from the same screen capture.

Documentation must replace statements that screen capture selects only the latest
transaction with the new all-supported-visible-transactions behavior and must
explain partial results and safe retry after an infrastructure error.

## Security and privacy

- Token authentication still precedes detailed parser errors.
- The request stays bounded at 32 KiB and each request produces at most ten logical
  items.
- Only the source text belonging to a logical item is copied into that item's
  encrypted payload; unrelated screen text and other transactions are not
  duplicated across encrypted rows.
- Failure output contains only an ordinal and stable error code.
- No raw text or parsed financial field is logged.
- Encryption is completed for all new items before insertion begins, and every row
  retains independent AES-GCM AAD binding.

## Validation

Parser tests use synthetic data matching the observed structure and cover:

- two bilingual UOB messages produce exactly two captures in screen order;
- one bilingual UOB message produces one capture, not two;
- same-language adjacent UOB messages remain separate candidates;
- mismatched amount, card suffix, merchant, available credit, or date prevents a
  bilingual merge;
- two SCB blocks and mixed-source screens produce all logical captures;
- one complete and one incomplete logical group yields one capture and one failure;
- an incomplete UOB language member is absorbed when its strictly matching partner
  is complete;
- no anchors, all failures, and more than ten groups are rejected correctly;
- the old latest UOB/SCB block retains its prior v1 dedupe key.

Ingestion tests cover:

- two new items produce two encrypted inserts and HTTP 202;
- new plus duplicate, new plus unreadable, all duplicates, and all unreadable;
- per-item uniqueness races;
- encryption failure before insertion;
- retry convergence after a simulated later insert failure;
- unchanged single raw and direct normalized payload responses;
- bounded body, token revocation, request rate limiting, and response/log privacy.

The complete Deno Edge Function suite and repository Node suite must pass. A
synthetic device smoke test must verify two Inbox rows, separate review and Save,
partial-result visibility in Quick Look, and duplicate retry behavior before
production deployment.

## Rollout and rollback

Deploy the shared parser and `ingest-shortcut-capture` function together, then
update the Shortcut setup and deployment documentation. No migration, Inbox client
release, or replacement device token is required.

Rollback redeploys the previous parser/function version. Existing rows remain valid
because the capture schema, encryption format, dedupe version, and database schema
do not change. A rollback restores latest-only screen behavior, so it should be
treated as loss of multi-item ingestion capability rather than a data migration.

## Acceptance criteria

- The synthetic equivalent of the supplied two-message UOB screen queues exactly
  two Inbox items, not one and not four.
- The two items can be reviewed, edited, and saved independently through the
  existing UI.
- If one of two logical items is unreadable, the readable item is queued and the
  Shortcut response visibly reports one failure.
- Retrying the same screen creates no duplicate Inbox rows.
- Existing one-item Shortcuts continue to receive their legacy response shape.
- No database schema or Inbox client behavior change is required.
