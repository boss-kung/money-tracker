# Shortcut Multi-Transaction Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one authenticated Shortcut screen capture queue every readable supported transaction as a separate review item while safely reporting unreadable items.

**Architecture:** Replace the server parser's latest-block return value with an ordered batch of logical transaction groups. The ingestion function validates, deduplicates, pre-encrypts, and inserts each successful group through the existing one-row-per-capture Inbox model; the web client and database schema remain unchanged.

**Tech Stack:** Deno TypeScript, Supabase Edge Functions, existing AES-GCM Shortcut Inbox helpers, Deno tests, Node repository tests, iOS Shortcuts JSON/Quick Look contract.

**Spec:** `docs/superpowers/specs/2026-10-24-shortcut-multi-transaction-ingest-design.md`

## Global Constraints

- Keep the Shortcut request contract unchanged: `raw_text`, `capture_method`, and optional `captured_at`.
- Accept at most 32 KiB per request and at most 10 logical transaction groups.
- Keep `money-tracker.capture.v1`, `dedupe_version: 1`, `canonicalDedupeMaterial()`, and the existing unique database constraint unchanged.
- Preserve the exact legacy single-item response: HTTP 202/200 with `{ status: "queued", capture_id, duplicate }`.
- Store one encrypted Inbox row per readable logical transaction; no database migration, batch row, client-side batch Save, or Ledger bypass.
- `whats_on_screen` keeps full-block completeness rules; only `line_notification` accepts compact previews.
- Never expose or log raw/relevant text, source, amount, merchant, or card/account identifiers in ingestion results.
- A parse failure may produce a partial response; encryption or database failure must produce `500 ingest_failed` and rely on idempotent retry.
- Preserve unrelated working-tree changes. In particular, `outputs/money-tracker-shortcut-setup-th.md` already contains a user-owned 340-to-56-line rewrite: patch only its current multi-capture wording and do not stage or commit that file without explicit confirmation.

## Review Focus

- Anchor words inside a merchant or description line must not create a false transaction candidate; Task 1 pins anchors to normalized line starts.
- Adjacent UOB messages with equal amount/card but different available credit must remain separate; Task 1 tests every pairing discriminator.
- Eleven logical groups must fail before encryption or insertion rather than silently taking the first ten; Tasks 1 and 2 test both boundaries.
- Two identical same-language items in one new request must converge through the existing dedupe race to one queued row plus one duplicate result; Task 2 tests in-request duplication.
- A database failure after the first insert must return `ingest_failed`, and an identical retry must finish the remaining item without duplicating the first; Task 2 uses a stateful fake database to prove convergence.

---

### Task 1: Replace latest-block parsing with ordered logical batches

**Files:**
- Modify: `supabase/functions/_shared/shortcut_capture_parser.ts:9-138`
- Modify: `supabase/functions/_shared/shortcut_capture_parser_test.ts:1-219`

**Interfaces:**
- Consumes: `ValidatedCaptureV1`, `normalizeCaptureText()`, `canonicalDedupeMaterial()`, and `sha256Hex()` from `shortcut_capture.ts`.
- Produces:

```ts
export type RawCaptureFailure = {
  item: number
  code: 'unreadable_capture'
}

export type RawCaptureBatch = {
  found: number
  captures: Array<{ item: number; capture: ValidatedCaptureV1 }>
  failures: RawCaptureFailure[]
}

export async function parseRawShortcutCaptures(
  input: unknown,
  now?: string,
): Promise<RawCaptureBatch>
```

- Invariant: `found === captures.length + failures.length`; item numbers are one-based logical-group positions in screen order.
- Removes: exported `parseRawShortcutCapture()` and the internal `latestBlock()` selector.

- [ ] **Step 1: Convert existing parser tests to the plural contract and add the multi-block failing tests**

Change the import to `parseRawShortcutCaptures`. Add a local helper that asserts one successful item for the existing single-capture tests, then change those tests to read `single(result).capture` without weakening any current source, amount, merchant, date, or dedupe assertions.

Add `server parser returns every complete SCB block in screen order`:

```ts
const result = await parseRawShortcutCaptures({
  raw_text: [
    'รายการเงินออก -20.00 บาท',
    'จากบัญชี SAMPLE X-1111',
    'เข้าบัญชี FIRST SHOP',
    'ยอดเงินที่ใช้ได้ 2,000.00 บาท',
    'รายการเงินออก -80.00 บาท',
    'จากบัญชี SAMPLE X-1111',
    'เข้าบัญชี SECOND SHOP',
    'ยอดเงินที่ใช้ได้ 1,920.00 บาท',
  ].join('\n'),
  capture_method: 'whats_on_screen',
  captured_at: '2026-10-24T16:20:00+07:00',
})
equal(result.found, 2)
equal(result.failures, [])
equal(result.captures.map(({ item, capture }) => [item, capture.amount, capture.merchant]), [
  [1, '20.00', 'FIRST SHOP'],
  [2, '80.00', 'SECOND SHOP'],
])
```

Add `server parser collapses each adjacent bilingual UOB message once` with two synthetic Thai/English pairs. Assert `found === 2`, synthetic amounts `['12.34', '56.78']`, card suffixes `['1111', '1111']`, two captures rather than four, no failures, pair-local `raw_text`, and that each `relevant_text` is the later English block.

Add `server parser preserves the old latest-block dedupe key` by parsing the last English UOB block alone and asserting its key equals the second capture's key from the two-pair input when `captured_at` is identical.

- [ ] **Step 2: Add failing pairing, partial-read, anchor, and limit tests**

Add these named cases with exact assertions:

- `same-language UOB candidates stay separate`: two adjacent Thai blocks yield `found === 2` and two captures.
- `UOB pairing requires matching amount card merchant credit and date`: table-drive one mismatch at a time; each case yields two logical groups rather than one.
- `complete UOB partner absorbs its matching incomplete translation`: a full Thai screen block plus adjacent English block missing `Available credit` yields one successful group and no failure.
- `parser reports unreadable groups without dropping readable groups`: one full SCB block followed by an anchored SCB block without available balance yields `found === 2`, one capture at item 1, and `[{ item: 2, code: 'unreadable_capture' }]`.
- `anchor words inside merchant lines do not split candidates`: text such as `เข้าบัญชี YOU HAVE SPENT CAFE` remains one SCB capture; candidate anchors are matched only at normalized line starts, case-insensitively where appropriate.
- `parser rejects more than ten logical groups`: eleven complete LINE Wallet blocks reject with `ShortcutRequestError.code === 'too_many_captures'`.
- Existing unsupported text and invalid capture-method cases continue rejecting with `invalid_capture`.

- [ ] **Step 3: Run the parser suite and confirm the red state**

Run: `deno test supabase/functions/_shared/shortcut_capture_parser_test.ts`

Expected: FAIL because `parseRawShortcutCaptures` is not exported and the old implementation returns only one latest block.

- [ ] **Step 4: Implement line-anchored candidate discovery and source parsing**

In `shortcut_capture_parser.ts`, retain the existing raw-envelope, timestamp, amount, merchant, date, and source extraction rules, but replace full-text `matchAll()`/`latestBlock()` selection with ordered candidate segments beginning at supported anchors on normalized line starts.

Introduce an internal candidate representation carrying block position, normalized block text, source, UOB language, completeness, parsed capture fields, and transient canonical available-credit value. A candidate ends at the next supported line-start anchor or normalized input end. Ignore surrounding text before the first anchor.

Keep full suffix checks for `whats_on_screen`; apply the current compact rules only to `line_notification`. Retain partially extracted UOB candidates for pairing. Convert ungrouped incomplete candidates into `unreadable_capture` results instead of throwing when another logical group succeeds.

- [ ] **Step 5: Implement conservative UOB grouping and per-group payload creation**

Group only adjacent opposite-language UOB candidates with equal canonical amount and equal four-digit card suffix. When both values exist, also require equal normalized merchant, available credit, and transaction calendar date. Never group same-language candidates.

For a matched pair, choose the later complete candidate as primary; if it is incomplete, use the earlier complete candidate. Fill a missing optional field from the partner only when there is no conflict. Store only the member block(s) in encrypted `raw_text`, and use the primary block as `relevant_text`. Build and hash each successful `ValidatedCaptureV1` independently with dedupe version 1.

Return logical groups in screen order. Throw `invalid_capture` when no supported anchor exists and `too_many_captures` when the grouped count exceeds 10. An all-unreadable batch is returned to the ingestion handler so it can produce the specified aggregate HTTP 400 response.

- [ ] **Step 6: Run the parser suite and all shared Shortcut tests**

Run: `deno test supabase/functions/_shared/shortcut_capture_parser_test.ts`

Expected: PASS with all original source/compact/dedupe behavior plus the new batch cases.

Run: `deno test supabase/functions/_shared/shortcut_*_test.ts`

Expected: PASS; no regression in capture validation or crypto helpers.

- [ ] **Step 7: Commit the parser contract**

```bash
git add supabase/functions/_shared/shortcut_capture_parser.ts supabase/functions/_shared/shortcut_capture_parser_test.ts
git commit -m "feat: parse multiple shortcut transactions"
```

### Task 2: Persist batches and return queued, duplicate, and failed results

**Files:**
- Modify: `supabase/functions/ingest-shortcut-capture/index.ts:1-249`
- Modify: `supabase/functions/ingest-shortcut-capture/index_test.ts:1-173`

**Interfaces:**
- Consumes: `parseRawShortcutCaptures(input, now): Promise<RawCaptureBatch>` from Task 1 and the existing `validateCaptureV1()`, encryption, token-authentication, rate-limit, and database helpers.
- Produces: unchanged legacy single-item response, plus this ordered batch item union:

```ts
type IngestItemResult =
  | { item: number; status: 'queued'; capture_id: string; duplicate: false }
  | { item: number; status: 'duplicate'; capture_id: string; duplicate: true }
  | { item: number; status: 'failed'; code: 'unreadable_capture' }
```

- Produces batch aggregate fields `status`, `message`, `found`, `queued`, `duplicate`, `failed`, and `results` exactly as specified in the design.

- [ ] **Step 1: Make the fake database capable of representing per-item state**

Extend `fakeDatabase()` so select and insert outcomes can depend on captured dedupe keys and call order. Let tests provide a deterministic UUID sequence rather than returning the same UUID for every call. Preserve the existing token-row, rate-limit, and singular tests.

The fake must support a persistent rows map shared across two handler calls so the retry-convergence test observes the first call's successful insert.

- [ ] **Step 2: Add failing batch response and persistence tests**

Add `queues two parsed UOB transactions as independent encrypted rows` using two synthetic bilingual pairs and UUIDs `22222222-2222-4222-8222-222222222222` and `33333333-3333-4333-8333-333333333333`.

Assert HTTP 202, two encryption calls before the first insert, two insert rows with different IDs/dedupe keys/IV-bound encryption contexts, and this aggregate shape:

```ts
equal(await body(response), {
  status: 'queued',
  message: 'เข้า Inbox 2 รายการ • ซ้ำ 0 รายการ • อ่านไม่สำเร็จ 0 รายการ',
  found: 2,
  queued: 2,
  duplicate: 0,
  failed: 0,
  results: [
    { item: 1, status: 'queued', capture_id: '22222222-2222-4222-8222-222222222222', duplicate: false },
    { item: 2, status: 'queued', capture_id: '33333333-3333-4333-8333-333333333333', duplicate: false },
  ],
})
```

Add exact cases for:

- one new plus one existing receipt: HTTP 202, counts `1/1/0`, ordered queued/duplicate results;
- one new plus one unreadable group: HTTP 202, top-level `partial`, counts `1/0/1`, and a failed ordinal without raw fields;
- one existing receipt plus one unreadable group: HTTP 200, top-level `partial`, counts `0/1/1`;
- all duplicates: HTTP 200, top-level `duplicate`, no encryption or inserts;
- all unreadable: HTTP 400 with `error/code: invalid_capture`, safe aggregate counts, and only failed ordinals;
- eleven groups: HTTP 400 `too_many_captures`, no encryption or inserts;
- two identical same-language candidates in a new request: one queued and one duplicate result after the second insert hits the uniqueness race;
- any multi-item JSON response contains none of the synthetic source text, amount, merchant, or card suffix.

- [ ] **Step 3: Add failing all-before-insert and retry-convergence tests**

Add `encrypts every new item before inserting any batch row`. Record operation order and assert it is `encrypt`, `encrypt`, `insert`, `insert`. Make the second encryption throw and assert HTTP 500 with zero inserts.

Add `retry converges after the second insert fails`. The first request inserts item 1 then receives a non-uniqueness database error for item 2 and returns `500 ingest_failed`. The identical second request must report item 1 duplicate, insert item 2 once, and leave exactly two unique persisted dedupe keys.

Keep the existing single direct normalized payload and single raw-envelope assertions byte-for-byte so their response shape cannot drift.

- [ ] **Step 4: Run the ingestion suite and confirm the red state**

Run: `deno test supabase/functions/ingest-shortcut-capture/index_test.ts`

Expected: FAIL because the handler still imports the singular parser, returns after the first receipt, and does not produce aggregate responses.

- [ ] **Step 5: Implement batch validation, dedupe lookup, and pre-encryption**

Change the parser import to `parseRawShortcutCaptures`. Convert a direct normalized `money-tracker.capture.v1` input into a one-item `RawCaptureBatch`; do not accept a caller-provided array.

After authentication and the existing one-slot request rate limit:

1. Parse/validate every successful logical item.
2. If every discovered item failed, return the safe aggregate `invalid_capture` response directly.
3. Resolve existing receipts for all successful captures in screen order.
4. Load the keyring once, assign one UUID per new capture, and encrypt every new payload before the first insert.

Do not change `IngestShortcutCaptureDeps`, token verification, 32 KiB body handling, or database schema.

- [ ] **Step 6: Implement ordered inserts, uniqueness-race recovery, and response formatting**

Insert pre-encrypted rows sequentially in screen order. On `23505`, look up the winner for that capture and emit an item-level duplicate; propagate every other database error as `ingest_failed`.

Return the exact legacy response when `found === 1` and `failed === 0`. Otherwise build the batch aggregate:

- `partial` when any item failed and at least one readable item queued or duplicated;
- `queued` when no item failed and at least one new row was inserted;
- `duplicate` when all readable items were existing receipts;
- HTTP 202 when `queued > 0`, otherwise HTTP 200 when `duplicate > 0`.

Use the exact Thai message template `เข้า Inbox {queued} รายการ • ซ้ำ {duplicate} รายการ • อ่านไม่สำเร็จ {failed} รายการ`. Results and counts are the stable contract; the message is display convenience only.

- [ ] **Step 7: Run targeted and complete Edge Function tests**

Run: `deno test supabase/functions/ingest-shortcut-capture/index_test.ts`

Expected: PASS, including unchanged auth-before-validation, revoked-token, rate-limit, bounded-body, and encryption-failure tests.

Run: `deno test supabase/functions/_shared/*_test.ts supabase/functions/manage-shortcut-tokens/index_test.ts supabase/functions/ingest-shortcut-capture/index_test.ts supabase/functions/shortcut-inbox/index_test.ts`

Expected: PASS with zero failures.

Run: `deno check supabase/functions/_shared/shortcut_capture_parser.ts supabase/functions/ingest-shortcut-capture/index.ts`

Expected: both modules type-check.

- [ ] **Step 8: Commit the ingestion behavior**

```bash
git add supabase/functions/ingest-shortcut-capture/index.ts supabase/functions/ingest-shortcut-capture/index_test.ts
git commit -m "feat: ingest shortcut transaction batches"
```

### Task 3: Update active setup guidance and run full verification

**Files:**
- Modify: `outputs/money-tracker-shortcut-simple-setup-th.md:57-71`
- Modify carefully without staging pre-existing user changes: `outputs/money-tracker-shortcut-setup-th.md:46-56`
- Modify: `docs/SHORTCUT_INBOX_DEPLOYMENT.md:34-66`

**Interfaces:**
- Consumes: the request/response behavior delivered by Tasks 1 and 2.
- Produces: current Thai setup guidance and deployment smoke steps that describe all-visible-item ingestion, individual review, partial parse counts, duplicate retry, and `ingest_failed` retry.

- [ ] **Step 1: Update the simple Thai setup guide**

Replace the statement that `Get What's On Screen` selects only the latest transaction. State that the server queues every readable supported transaction visible on screen, collapses UOB Thai/English copies, and places each logical transaction in a separate Inbox item.

Document the three batch counts and user action:

- `queued`: new Inbox items;
- `duplicate`: items already received and not recreated;
- `failed`: anchored items the parser could not read, which must be entered manually or recaptured;
- `ingest_failed`: rerun the same Shortcut; dedupe makes the retry safe.

Explicitly say the legacy on-device parser/action map remains latest-only and must not be used when multi-item capture is required.

- [ ] **Step 2: Patch the current short native-Shortcut guide without overwriting its existing rewrite**

First run `git diff -- outputs/money-tracker-shortcut-setup-th.md` and confirm the existing 340-to-56-line replacement is still present. Modify only the current Manual Screen Capture and success paragraphs: change “เห็นรายการล่าสุด/เลือก transaction block ล่าสุด” to all readable visible transactions, separate Inbox review, and partial-result counts.

Do not restore the old 340-line advanced parser guide. Do not stage or commit this file unless the user separately confirms that the pre-existing rewrite should be included.

- [ ] **Step 3: Update deployment smoke and evidence requirements**

In `docs/SHORTCUT_INBOX_DEPLOYMENT.md`, retain the current single-item 202/200 smoke check and add a synthetic two-pair UOB screen check that expects exactly two Inbox rows. Add a partial fixture check with one valid and one unreadable group, separate review/Save verification, safe duplicate retry, and the instruction to rerun after `ingest_failed`.

Replace “latest-block selection” in production evidence with multi-block ordering, bilingual UOB grouping, partial-result reporting, and response/log privacy.

- [ ] **Step 4: Check active documentation for stale latest-only claims**

Run:

```bash
rg -n "เลือกธุรกรรมล่าสุด|เลือก transaction block ล่าสุด|latest-block selection" outputs/money-tracker-shortcut-simple-setup-th.md outputs/money-tracker-shortcut-setup-th.md docs/SHORTCUT_INBOX_DEPLOYMENT.md
```

Expected: no matches. Historical specs, verification records, `work/reference-parser.mjs`, and the legacy action-map artifact are not runtime contracts and are not rewritten by this task.

- [ ] **Step 5: Run complete automated verification**

Run:

```bash
deno test supabase/functions/_shared/*_test.ts supabase/functions/manage-shortcut-tokens/index_test.ts supabase/functions/ingest-shortcut-capture/index_test.ts supabase/functions/shortcut-inbox/index_test.ts
node --test tests/*.test.js
git diff --check
```

Expected: all Deno and Node tests pass; `git diff --check` prints nothing.

- [ ] **Step 6: Review the final diff against the acceptance criteria**

Confirm from tests and diff that:

- the synthetic two-message bilingual UOB screen yields two logical rows, not one or four;
- partial parse keeps readable rows and reports failed ordinals;
- single-item requests retain their exact response contract;
- no migration or Inbox client code changed;
- no response/log contains protected financial text;
- only item-local raw text is encrypted;
- unrelated working-tree edits remain intact.

- [ ] **Step 7: Commit only clean documentation paths and hand off the overlapping file separately**

```bash
git add outputs/money-tracker-shortcut-simple-setup-th.md docs/SHORTCUT_INBOX_DEPLOYMENT.md docs/superpowers/specs/2026-10-24-shortcut-multi-transaction-ingest-design.md docs/superpowers/plans/2026-10-24-shortcut-multi-transaction-ingest.md
git commit -m "docs: describe multi-transaction shortcut capture"
```

Leave `outputs/money-tracker-shortcut-setup-th.md` unstaged because its baseline rewrite predates this plan. Report the small wording patch in the handoff so the user can decide whether to include that pre-existing document rewrite in a later commit.
