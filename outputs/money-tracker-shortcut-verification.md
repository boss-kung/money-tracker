# Money Tracker Shortcut Verification

วันที่ตรวจล่าสุด: 2026-10-18 (Asia/Bangkok)

## ผลสรุป

## Root-cause verification

- The imported Notification Shortcut contains actions for reading input, building the capture envelope, posting it, and showing the response; the `.shortcut` file does **not** install an iPhone Notification Automation.
- The required device-local Automation must pass the `Notification` magic variable into `Money Tracker - Notification Inbox`.
- Before this recovery run, a UOB LINE preview that omitted the full available-credit line was rejected by the server block matcher; the compact-notification parser now accepts that notification-only shape while keeping full-screen parsing strict.

## Recovery run — 2026-10-18

- Compact UOB Thai/English notification parsing: **ผ่าน** — `deno test supabase/functions/_shared/shortcut_capture_parser_test.ts` → 6/6.
- Edge Function, crypto, capture, and Inbox contract tests: **ผ่าน** — Deno suite → 30/30.
- Money Tracker Shortcut Inbox client/security/transaction tests: **ผ่าน** — targeted Node suite → 23/23; full repository Node suite → 513/513.
- Local database migration gate: **ยังตรวจไม่ได้** — local Postgres `127.0.0.1:54322` ไม่พร้อมใน environment นี้.
- Live Supabase `202 queued`/duplicate smoke: **ยังไม่รัน** — ต้องทำจาก environment ที่มี network และ Token ทดสอบ; ยังไม่ส่งข้อมูลจริงจาก session นี้.

| รายการ | ผล | หลักฐาน/ขอบเขต |
|---|---|---|
| Worktree แยก | ผ่าน | `/Users/bosskung/.codex/worktrees/shortcut-notification-fix/Money Tracker` จาก `origin/main` |
| Repository regression tests | ผ่าน | `node --test tests/*.test.js` → 513/513 |
| Fixture JSON 8 input + 1 expected file | ผ่าน | JSON parser อ่านได้ครบ; ครอบคลุม SCB credit และ mixed-source latest block เพิ่มเติม |
| Native draft `Money Tracker Parser` ใน Shortcuts | สร้างได้แต่ยังไม่พร้อม Production | มี input dictionary, regex block, Last Item, amount/merchant/last4 extraction, payload preview; ยังไม่ผ่าน contract ครบ |
| Native parser fixture run | ยืนยันว่า draft ไม่ครบ | ได้ `work/results/scb-single-output.json` หนึ่งครั้ง แต่ `transaction_datetime`/`relevant_text` ว่างและไม่มี `dedupe_key`; การรันซ้ำค้างที่ interactive `Quick Look` จึงยกเลิก |
| Export `.shortcut` | ล้มเหลวภายนอก | Shortcuts Export “For Anyone” ตอบ `NSURLErrorDomain error 500`; wrapper ที่ปรากฏภายหลังเป็น AEA เสียและตรวจไม่ได้ |
| Local Shortcuts DB fallback | ถูกระบบปฏิเสธ | macOS TCC ตอบ `Operation not permitted`; ไม่พยายามข้ามการป้องกัน |
| Signed/importable `.shortcut` | ไม่ได้สร้าง | `aea id` ตอบ `invalid auth data blob`; `shortcuts sign` ตอบ `Failed to verify this shortcut`; ไม่ส่งไฟล์เสียให้ผู้ใช้ |
| Reference parser contract | ผ่าน | `node --test work/reference-parser.test.mjs` → 10/10; canonical amount is a two-decimal string and v1 key includes the normalized relevant-text hash |
| Security static gates | ผ่าน | `node --test tests/shortcut_capture_security_static.test.js` → JWT boundary, auth ordering, no service-role client surface, and no payload logging |
| Live pgTAP migration gate | ต้องรันใน environment ที่มี Docker/Supabase | `supabase test db --workdir supabase` เชื่อม `127.0.0.1:54322` ไม่ได้ใน sandbox นี้; migration ยังไม่ถือว่า live-verified |
| Release contract | ผ่าน | `2026.10.18-shortcut-inbox-r143`; `scripts/update-release-version.js` regenerated `index.html` and `demo/index.html` query versions |
| Cross-path dedupe stability | ผ่านใน reference contract | notification/screen variant ของ SCB เดียวกันได้ SHA-256 key เดียวกัน |
| Latest relevant block | ผ่านใน reference contract | เลือก block ท้ายสุดทั้งกรณี source เดียวและหลาย source บนหน้าจอ |
| Existing user shortcuts | ไม่แก้ไข | ไม่แตะ `Log LINE Notifications from UOB and SCB`, `Money Tracker`, `Get What’s On Screen` |

## สิ่งที่พบใน native draft

Draft ที่สร้างด้วย Shortcuts “Describe a Shortcut” ชื่อ `Money Tracker Parser` เป็นเพียง construction aid และไม่ควรใช้ส่งข้อมูลจริง เพราะยังมีข้อแตกต่างจากสเปก:

- ไม่มี `dedupe_key` และ SHA-256 canonical basis.
- ไม่มี Production safety gate และ `Get Contents of URL`.
- ยังไม่มี transaction datetime extraction ที่ยืนยันแล้ว.
- `Replace Text` normalization ที่ตรวจพบเปิด Regular Expression ไม่ครบ.
- LINE branch ตั้ง `bank = LINE` แต่ contract ที่อนุมัติใช้ `bank = null`.
- Payload มี 18 fields; contract ต้องมี 19 fieldsรวม `dedupe_key`.

Action-by-action guide และ `money-tracker-shortcut-action-map.json` จึงเป็นแหล่งอ้างอิงที่ถูกต้องกว่า draft นี้

## การทดสอบ reference contract

คำสั่ง:

```sh
node --test work/reference-parser.test.mjs
```

ผลล่าสุด:

```text
tests 10
pass 10
fail 0
```

ครอบคลุม:

- SCB debit, credit และ multi-block; multi-block เลือกยอด `350.00` รายการหลังสุด.
- UOB Thai และ English.
- LINE Wallet.
- Mixed UOB + SCB เลือก SCB ซึ่งเป็น complete block ท้ายสุดบนหน้าจอ.
- Invalid text.
- Input validation.
- Dedupe key ข้าม `line_notification`/`whats_on_screen`.

Reference parser เป็น executable specification บน Mac เท่านั้น ไม่ใช่ dependency ของ Shortcut และไม่ถูกใช้ส่งข้อมูล. จำนวนเงินใน payload เป็นข้อความ canonical เช่น `80.00`; dedupe v1 ต่อท้าย SHA-256 ของ `relevant_text` ที่ normalize แล้ว ก่อนทำ SHA-256 ชั้นนอก

## ขอบเขตการยืนยันไฟล์

- Signed: **ไม่**
- Preview accepted by Shortcuts import: **ไม่**
- Fully re-imported: **ไม่**
- เหตุผล: Apple export service error 500; ไฟล์ wrapper ที่ตามมามี SHA-256 `05083dc16ede2a321a7206212896f5218a8d7d8a916a4fa4e96af7e255f08b6d` แต่ AEA auth blob เสีย จึง sign/import verification ไม่ได้

การกลับมาทำต่อเมื่อ Apple export ใช้งานได้:

1. สร้าง native actions ตาม `money-tracker-shortcut-setup-th.md`.
2. รัน fixtures บนอุปกรณ์และตรวจ Quick Look.
3. Export parser/screen wrapper.
4. `shortcuts sign --mode anyone` กับไฟล์ unsigned ที่ export สำเร็จ.
5. เปิด signed file และยืนยันหน้า Add Shortcut; แยกบันทึก preview acceptance กับ full re-import.

## Safety

- ไม่มี network POST ถูกเรียกขณะตรวจ.
- endpoint/API key ทุกจุดเป็น placeholder.
- fixture เป็นข้อมูลสังเคราะห์.
- ไม่มีการอ่านหรือส่งข้อความ LINE/ข้อมูลธุรกรรมจริง.
- ยังไม่ถือว่า production-ready จนกว่าจะรัน local Supabase/Docker, deploy secrets, และทำ synthetic smoke test ตาม `docs/SHORTCUT_INBOX_DEPLOYMENT.md`.
