# Money Tracker Shortcut Verification

วันที่ตรวจล่าสุด: 2026-10-18 (Asia/Bangkok)

## ผลสรุป

| รายการ | ผล | หลักฐาน/ขอบเขต |
|---|---|---|
| Worktree แยก | ผ่าน | `/Users/bosskung/.codex/worktrees/money-tracker-ios-shortcut/Money Tracker` จาก `origin/main` |
| Baseline repository tests | ผ่าน | `node --test tests/*.test.js` → 454/454 |
| Fixture JSON 8 input + 1 expected file | ผ่าน | JSON parser อ่านได้ครบ; ครอบคลุม SCB credit และ mixed-source latest block เพิ่มเติม |
| Native draft `Money Tracker Parser` ใน Shortcuts | สร้างได้แต่ยังไม่พร้อม Production | มี input dictionary, regex block, Last Item, amount/merchant/last4 extraction, payload preview; ยังไม่ผ่าน contract ครบ |
| Native parser fixture run | ยืนยันว่า draft ไม่ครบ | ได้ `work/results/scb-single-output.json` หนึ่งครั้ง แต่ `transaction_datetime`/`relevant_text` ว่างและไม่มี `dedupe_key`; การรันซ้ำค้างที่ interactive `Quick Look` จึงยกเลิก |
| Export `.shortcut` | ล้มเหลวภายนอก | Shortcuts Export “For Anyone” ตอบ `NSURLErrorDomain error 500`; wrapper ที่ปรากฏภายหลังเป็น AEA เสียและตรวจไม่ได้ |
| Local Shortcuts DB fallback | ถูกระบบปฏิเสธ | macOS TCC ตอบ `Operation not permitted`; ไม่พยายามข้ามการป้องกัน |
| Signed/importable `.shortcut` | ไม่ได้สร้าง | `aea id` ตอบ `invalid auth data blob`; `shortcuts sign` ตอบ `Failed to verify this shortcut`; ไม่ส่งไฟล์เสียให้ผู้ใช้ |
| Reference parser contract | ผ่าน | `node --test work/reference-parser.test.mjs` → 10/10 |
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

Reference parser เป็น executable specification บน Mac เท่านั้น ไม่ใช่ dependency ของ Shortcut และไม่ถูกใช้ส่งข้อมูล

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
