# Shortcut Inbox deployment and rollback

This feature is review-first: a LINE notification or `Get What's On Screen` capture is queued, then the user opens Money Tracker, reviews/edits it, and presses Save. The iOS Shortcut never receives a service-role key and never writes a transaction directly.

## Before deployment

1. Use a separate Supabase project/ref for staging and production. Confirm the project ref and the HTTPS function URL:

   `https://<project-ref>.supabase.co/functions/v1/ingest-shortcut-capture`

2. Generate two independent random secrets locally with a password manager or an approved secret manager. Store only the values in Supabase secrets; do not paste them into chat, a commit, a terminal transcript, or a Shortcut:

   - `MT_SHORTCUT_TOKEN_PEPPER_V1` — at least 32 random bytes, used to verify device Tokens.
   - `MT_SHORTCUT_INBOX_KEY_V1` — an AES-GCM key-ring value, versioned as `v1` by the shared crypto helper.

3. Apply the migration and inspect the resulting policies/RPC grants. The two inbox tables must have no direct `anon` or `authenticated` table access; only the Edge Functions use the service-role client.

## Deploy

Run from the repository root. Use the project-link/profile mechanism approved for the deployment environment; do not include secret values in command arguments or logs.

```sh
supabase db push
supabase secrets set --env-file /secure/secret-file
supabase functions deploy ingest-shortcut-capture --no-verify-jwt
supabase functions deploy manage-shortcut-tokens
supabase functions deploy shortcut-inbox
```

Only `ingest-shortcut-capture` may use `--no-verify-jwt`: it authenticates the one-time device Token itself. `manage-shortcut-tokens` and `shortcut-inbox` must retain gateway JWT verification and resolve the signed-in user before constructing an admin client.

Confirm the scheduled cleanup job exists and is enabled. Its job removes expired ciphertext and retains the dedupe receipt for the configured retention period.

## Mobile setup

1. Sign in to Money Tracker.
2. Open **เพิ่มเติม → ตั้งค่า → เชื่อมต่อ iOS Shortcut**.
3. Create a labelled device Token and copy it immediately. The plaintext Token is shown once; it is not retrievable from the app or API later.
4. Use `outputs/money-tracker-shortcut-simple-setup-th.md`: the Shortcut sends only `raw_text` and `capture_method`; the server parses UOB, SCB Connect, and LINE Wallet.
5. Paste the Token into the `Authorization: Bearer ...` header and use the production ingestion URL shown in that guide.
6. Run a harmless synthetic or personal notification. Switch to the Inbox and review/edit before pressing Save; the Shortcut never writes a transaction directly.

### Notification automation check

Importing a `.shortcut` does not install an iPhone Personal Automation. On the iPhone, create `Shortcuts → Automation → Notification`, choose `App = LINE`, build a `Text` action from the Notification's available `Title`, `Subtitle`, and `Message/Body` fields, then add `Run Shortcut → Money Tracker - Notification Inbox` with that Text as its input. Passing the Notification object directly can lose the message body on some iOS versions. Keep `Ask Before Running` enabled for the first test. A normal LINE notification without this device-local trigger cannot reach the ingestion endpoint.

The corrected native workflow has a local guard: a missing input shows a diagnostic and stops before `Get Contents of URL`. If that diagnostic appears, repair the Automation's `Run Shortcut` input rather than changing the Token. Background automation may not display Quick Look; the authoritative result is the authenticated Money Tracker Inbox after refresh.

## Synthetic smoke test

Use only a fixture such as the SCB text in `work/fixtures/scb-single.input.json`. The expected first response is HTTP `202` with `{ "status": "queued", "duplicate": false }`. Repeating the exact same payload must return HTTP `200` with `{ "duplicate": true }` and the same `capture_id`.

Verify in the app that the item appears in Transactions → Shortcut Inbox, opens a draft without saving, preserves the raw-text disclosure in collapsed form, and is consumed only after the user presses Save. A failed acknowledgement may leave a local retry receipt, but it must never create a second transaction.

### Multi-transaction and partial-result smoke

1. Use a synthetic `Get What's On Screen` fixture with two adjacent UOB Thai/English pairs. The response must be HTTP `202`, `found: 2`, `queued: 2`, `duplicate: 0`, `failed: 0`, and two ordered results. Confirm exactly two independent Inbox rows; the Thai/English copies must not become four rows.
2. Open the first Inbox item, review/edit it, and press **Save**. Confirm that the second item remains pending, then open and save it separately. Saving one item must not consume or alter the other.
3. Send the same two-pair fixture again. It must return HTTP `200` with `duplicate: 2` and the same two capture IDs; no new rows should appear.
4. Use a fixture with one complete SCB/UOB group followed by an anchored group missing its required screen suffix. Expect HTTP `202`, `status: partial`, `queued: 1`, `duplicate: 0`, `failed: 1`, and a failed ordinal only. The readable item must still be reviewable in Inbox; recapture or enter the failed item manually.
5. If the response is `ingest_failed`, rerun the identical Shortcut input. The first request may have inserted some rows before the infrastructure error; dedupe must report those as duplicates and insert only the remaining rows.

## Rollback

1. If ingestion is unsafe, revoke the affected device Token in the app immediately. This blocks new captures without deleting the review inbox.
2. If the release itself is faulty, roll back the web assets and Edge Function versions together. Keep the database migration and encryption key available while existing ciphertext is being reviewed.
3. Never delete `MT_SHORTCUT_INBOX_KEY_V1` while ciphertext may still exist. A key rotation requires a new key version, decrypt/re-encrypt migration, and a tested retention window.
4. After rollback, run the synthetic duplicate and revoked-Token smoke checks again. Do not use real bank notifications as a rollback test.

## Evidence required before production

- `supabase test db --workdir supabase` succeeds against a running local Supabase/Docker stack.
- All Edge Function tests and `node --test tests/*.test.js` pass.
- iOS checks cover notification and screen entry paths, multi-block ordering, bilingual UOB grouping, partial-result counts, light/dark 320px layout, closed-app ingestion, network loss/retry, claim conflict, dismiss/restore, and transfer editing.
- Production evidence must show that responses and logs contain only stable status/counts, item ordinals, IDs, and error codes—never source text, amount, merchant, card/account suffix, decrypted payloads, device Tokens, or encryption keys. Evidence should include a two-item screen, one partial unreadable item, and an independent review/Save of each Inbox row.
- Logs contain only stable error codes and request IDs; never raw text, decrypted payloads, device Tokens, or encryption keys.
