# Money Tracker — คู่มือสร้าง iOS Shortcut แบบ Native

เอกสารนี้เป็น fallback แบบ action-by-action หลังจาก Shortcuts บน Mac สร้าง draft ได้ แต่บริการ export/sign ของ Apple ตอบ `NSURLErrorDomain error 500` จึงยังไม่มีไฟล์ `.shortcut` ที่พิสูจน์แล้วว่า import ได้จริง อย่าใช้ draft ที่ชื่อ `Money Tracker Parser` ส่งข้อมูลจริงจนกว่าจะตรวจตามหัวข้อ “ทดสอบก่อน Production” ครบ

ไฟล์ประกอบ:

- `money-tracker-shortcut-action-map.json` — regex, schema และกติกา dedupe แบบ copy/paste
- `money-tracker-test-fixtures.json` — expected result ของ 6 กรณี
- `../work/reference-parser.mjs` และ `../work/reference-parser.test.mjs` — reference ที่รันบน Mac เพื่อยืนยัน regex/dedupe; ไม่ใช่ runtime ของ iPhone

## 1. สร้าง `Money Tracker Parser`

สร้าง Shortcut ใหม่ชื่อนี้ตรงตัว และใช้เฉพาะ action มาตรฐานของ Apple

### 1.1 Config และ input

1. `Dictionary` ตั้งชื่อผลลัพธ์เป็น `Config`:
   - `mode` (Text): `test`
   - `endpoint` (Text): `https://YOUR-MONEY-TRACKER.example/api/transactions`
   - `api_key` (Text): `REPLACE_WITH_SCOPED_API_KEY`
   - `schema_version` (Text): `money-tracker.capture.v1`
   - `parser_version` (Text): `ios-shortcut-1.0.0`
2. `Get Dictionary from Input` ใช้ `Shortcut Input`; ตั้งผลลัพธ์เป็น `Input`.
3. `Get Dictionary Value` จาก `Input` จำนวน 4 ครั้ง:
   - `raw_text` → `RawText`
   - `capture_method` → `CaptureMethod`
   - `captured_at` → `CapturedAt`
   - `force_test` → `ForceTest`
4. `If CapturedAt does not have any value`:
   - `Current Date`
   - `Format Date`: Custom `yyyy-MM-dd'T'HH:mm:ssXXX`, Time Zone `Asia/Bangkok`
   - `Set Variable CapturedAt`
5. ค่าเริ่มต้นก่อน parse:
   - `source = unknown`
   - `bank = Nothing`
   - `amount = Nothing`
   - `currency = THB`
   - `direction = unknown`
   - `merchant = Nothing`
   - `description = Nothing`
   - `account_last4 = Nothing`
   - `card_last4 = Nothing`
   - `transaction_datetime = Nothing`
   - `relevant_text = Nothing`
   - `parse_status = invalid`
   - `dedupe_key = Nothing`

`RawText` ต้องเก็บต้นฉบับไว้ ห้ามเอาผล normalization เขียนทับ

### 1.2 Normalize เฉพาะข้อความสำหรับ parse

ทำ `Replace Text` ต่อกัน 3 ครั้งและเปิด `Regular Expression` ทุกครั้ง:

| Find | Replace |
|---|---|
| `\r\n?` | ใส่ line break จริงหนึ่งตัว |
| `\u00A0` | ช่องว่างหนึ่งตัว |
| `[ \t]+` | ช่องว่างหนึ่งตัว |

ตั้งผลสุดท้ายเป็น `ParseText`. อย่าใช้ `\s+` เพราะจะลบ line break ที่ regex block ต้องใช้

### 1.3 หา block ล่าสุด

เพิ่ม `Match Text` **หนึ่งตัว** กับ `ParseText` ด้วย combined pattern นี้:

```regex
(?is)(?:มีการใช้บัตร\s+UOB-\d{4}[\s\S]*?วงเงินคงเหลือใช้ได้\s*[\d,]+(?:\.\d{1,2})?\s*THB|You have spent[\s\S]*?Available credit:\s*THB\s*[\d,]+(?:\.\d{1,2})?|รายการเงิน(?:ออก|เข้า)\s*-?[\d,]+(?:\.\d{1,2})?\s*บาท[\s\S]*?ยอดเงินที่ใช้ได้\s*[\d,]+(?:\.\d{1,2})?\s*บาท|LINE Pay Purchase[\s\S]*?Balance:\s*(?:THB\s*)?[\d,]+(?:\.\d{1,2})?)
```

ตั้งผลเป็น `AllBlocks` → `Count`:

- ถ้า Count = 0 ให้คง payload เป็น `invalid`.
- ถ้า Count > 0 ให้ `Get Item from List: Last Item` → `RelevantText`.
- ตรวจ `RelevantText`: มี `มีการใช้บัตร`/`You have spent` → UOB; มี `รายการเงินออก`/`รายการเงินเข้า` → SCB; มี `LINE Pay Purchase` → LINE Wallet.

ต้อง Match ด้วย combined pattern ก่อนแล้วค่อย Last Item เพื่อให้เลือก block ท้ายสุดตามลำดับบนหน้าจอ แม้หน้าจอเดียวมีหลายธนาคาร

### 1.4 Extract UOB

เมื่อ `RelevantText` เป็น UOB:

1. ตั้ง `source = uob_thai`, `bank = UOB`, `direction = debit`.
2. Amount: ลอง pattern แรก; ถ้าไม่พบใช้ pattern ที่สอง:

```regex
จำนวน\s*([\d,]+(?:\.\d{1,2})?)\s*THB
```

```regex
(?i)spent\s+THB\s*([\d,]+(?:\.\d{1,2})?)
```

3. `Get Group from Matched Text: Group At Index 1`, ลบ `,`, แล้ว `Calculate` ค่านั้น → `amount`.
4. Merchant: ลองตามลำดับ แล้วเอา Group 1 → `merchant` และ `description`:

```regex
ที่ร้าน\s*([^\n\r]+)
```

```regex
(?i)\sat\s+(.+?)\s+on\s+\d{2}/
```

5. Card last four: ลองตามลำดับ แล้วเอา Group 1 → `card_last4`:

```regex
UOB-(\d{4})
```

```regex
(?i)ending\s+(\d{4})
```

### 1.5 Extract SCB Connect

เมื่อ `RelevantText` เป็น SCB:

1. ตั้ง `source = scb_connect`, `bank = SCB`.
2. Match:

```regex
รายการเงิน(ออก|เข้า)\s*-?([\d,]+(?:\.\d{1,2})?)\s*บาท
```

3. Group 1 เป็น `เข้า` → `direction = credit`; ค่าอื่น → `direction = debit`.
4. Group 2 ลบ `,`, `Calculate` → `amount`.
5. Merchant/description ให้เลือกตาม Group 1:

```regex
เข้าบัญชี\s+([^\n\r]+)
```

ใช้ pattern นี้เมื่อเงินออก; เมื่อเงินเข้าใช้:

```regex
จากบัญชี\s+([^\n\r]+)
```

เอา Group 1 → `merchant` และ `description`.
6. Account last four: เงินออกใช้ pattern แรก; เงินเข้าใช้ patternที่สอง:

```regex
จากบัญชี[^\n\r]*X-(\d{4})
```

```regex
เข้าบัญชี[^\n\r]*X-(\d{4})
```

เอา Group 1 → `account_last4`.

### 1.6 Extract LINE Wallet

เมื่อ `RelevantText` เป็น LINE Wallet:

1. ตั้ง `source = line_wallet`, `bank = Nothing`, `direction = debit`.
2. Amount:

```regex
(?i)LINE Pay Purchase\s*(?:฿|THB\s*)?([\d,]+(?:\.\d{1,2})?)
```

เอา Group 1, ลบ `,`, `Calculate` → `amount`.
3. Merchant/description:

```regex
(?i)Merchant:\s*([^\n\r]+)
```

เอา Group 1 → `merchant` และ `description`.

### 1.7 Normalize transaction datetime

ใน branch ที่รองรับ ให้ `Match Text` กับ `RelevantText`:

```regex
(\d{2})/(\d{2})/(\d{4})\s+(\d{2}):(\d{2})
```

ถ้าพบ ให้ดึง Group 1–5 แล้วสร้าง `Text` โดยไม่มีช่องว่าง:

```text
[Group 3]-[Group 2]-[Group 1]T[Group 4]:[Group 5]:00+07:00
```

ตั้งเป็น `transaction_datetime`. ถ้าไม่พบให้คง `Nothing`; อย่าใช้ `CapturedAt` แทนฟิลด์นี้

### 1.8 Validate และสร้าง dedupe key

1. ถ้า `source != unknown` และ `amount > 0` ให้ `parse_status = complete`; นอกนั้นคง `invalid`.
2. `Format Number` ของ `amount`: Decimal, 2 decimal places, locale ที่ใช้จุดเป็น decimal → `Amount2`.
3. `If account_last4 has any value` ใช้ค่านั้น; Otherwise ใช้ `card_last4`; ถ้ายังไม่มีให้ Text ว่าง → `Identifier`.
4. ถ้า `transaction_datetime` มีค่า ใช้ค่านั้น → `DateKey`; Otherwise ใช้ 10 ตัวแรกของ `CapturedAt` (`yyyy-MM-dd`).
5. ถ้า `description` ไม่มีค่าใช้ Text ว่าง; ถ้ามีให้:
   - `Trim Whitespace`
   - `Replace Text` regex `[ \t]+` → ช่องว่างหนึ่งตัว
   - `Change Case: lowercase`
   - ตั้งเป็น `DescriptionKey`
6. `Text` หนึ่งบรรทัด:

```text
v1|[source]|[direction]|[Amount2]|THB|[Identifier]|[DateKey]|[DescriptionKey]
```

7. `Hash`: SHA-256 → `Change Case: lowercase` → `dedupe_key`.
8. ถ้า `parse_status != complete` ให้คง `dedupe_key = Nothing`.

ห้ามใส่ `raw_text`, `relevant_text` หรือ `capture_method` ลง hash มิฉะนั้น notification กับ screen ของ transaction เดียวกันจะ dedupe ไม่ได้

### 1.9 Payload Dictionary

สร้าง `Dictionary` ชื่อ `Payload` ด้วย key ครบ 19 ตัว:

| Key | Type/value |
|---|---|
| `schema_version` | Text จาก Config |
| `parser_version` | Text จาก Config |
| `source` | Text |
| `bank` | Text หรือ `Nothing` |
| `amount` | Number หรือ `Nothing` |
| `currency` | `THB` |
| `direction` | Text |
| `merchant` | Text หรือ `Nothing` |
| `description` | Text หรือ `Nothing` |
| `account_last4` | Text หรือ `Nothing` |
| `card_last4` | Text หรือ `Nothing` |
| `transaction_datetime` | Text หรือ `Nothing` |
| `captured_at` | Text |
| `capture_method` | Text |
| `raw_text` | `RawText` ต้นฉบับ |
| `relevant_text` | Text หรือ `Nothing` |
| `parse_status` | Text |
| `dedupe_version` | Number `1` |
| `dedupe_key` | Text หรือ `Nothing` |

บน iPhone ของคุณ ให้เปิด Quick Look แล้วตรวจว่า `Nothing` แสดงเป็น JSON `null`. ถ้ารุ่น OS นั้นตัด key ทิ้ง ให้สร้าง JSON Text ที่มี `null` ก่อน แล้วใช้ `Get Dictionary from Input` เพื่อคง key ไว้

### 1.10 Test/Production safety gate

เรียง action หลัง `Payload` แบบนี้:

1. `If parse_status is not complete`: `Quick Look Payload` → `Stop and Output Payload`.
2. `If ForceTest is true`: `Quick Look Payload` → `Stop and Output Payload`.
3. อ่าน `mode`, `endpoint`, `api_key` จาก `Config`.
4. `If mode is test`: `Quick Look Payload` → `Stop and Output Payload`.
5. Production gate ต้องผ่านทุกข้อ:
   - `mode is production`
   - endpoint begins with `https://`
   - endpoint ไม่เท่ากับ placeholder
   - api key ไม่เท่ากับ placeholder
6. ถ้า gate ไม่ผ่าน: `Show Alert` ว่า “Production config ไม่ครบ—ยังไม่ส่งข้อมูล” → `Stop and Output Payload`.
7. ถ้าผ่าน: `Get Contents of URL`:
   - URL = endpoint
   - Method = POST
   - Request Body = JSON
   - JSON = `Payload`
   - Header `Content-Type: application/json`
   - Header `Authorization: Bearer [api_key]`
8. `Stop and Output` response.

## 2. สร้าง `Money Tracker Screen`

1. `Get What's On Screen`.
2. `Get Text from Input` → `RawText`.
3. ถ้าไม่มีข้อความ: `Show Alert` “ไม่พบข้อความบนหน้าจอ” → Stop.
4. `Current Date` → `Format Date` custom `yyyy-MM-dd'T'HH:mm:ssXXX`, Time Zone `Asia/Bangkok`.
5. `Dictionary`:
   - `raw_text`: RawText
   - `capture_method`: `whats_on_screen`
   - `captured_at`: formatted Current Date
   - `force_test`: Boolean false
6. `Run Shortcut: Money Tracker Parser` โดยส่ง Dictionary เป็น input.
7. `Stop and Output` ผลจาก Parser.

ใช้จาก Shortcuts app, Action Button, Back Tap หรือ Control Center ขณะเปิดแชต UOB Thai, SCB Connect หรือ LINE Wallet. Parser จะเลือก complete block สุดท้ายบนจอ

## 3. LINE Notification Automation

Shortcuts รุ่นปัจจุบันมี trigger ชื่อ `Notification` ที่เลือก App และ filter `Message`, `Subtitle`, `Title` ได้ แต่ความสามารถในการรันโดยไม่ถามขึ้นกับ iOS และการตั้งค่าเครื่อง ให้สร้างบน iPhone จริงและทดสอบตอนล็อกจอด้วย

เพื่อทำ OR ระหว่างสามแหล่ง ให้สร้าง automation ของ App `LINE` แยก 3 ตัว โดยแต่ละตัวมี filter เดียว:

1. `มีการใช้บัตร` หรือ `You have spent`
2. `รายการเงินออก` หรือ `รายการเงินเข้า`
3. `LINE Pay Purchase`

ถ้าหน้า filter รองรับเงื่อนไขเดียว ให้สร้างเพิ่มเป็น automation แยก อย่าใส่หลาย filter ใน automation เดียว เพราะหลาย criteria อาจถูกตีความเป็น AND

ภายในแต่ละ automation:

1. ใช้ magic variable `Notification`; เปิดรายละเอียดแล้วดึง `Title`, `Subtitle`, `Message`/`Body` ที่มีในเครื่อง.
2. `Text` รวมค่าที่มี โดยคั่นแต่ละส่วนด้วย line break → `RawText`.
3. `Current Date` → format ISO แบบเดียวกับด้านบน.
4. `Dictionary`:
   - `raw_text`: RawText
   - `capture_method`: `line_notification`
   - `captured_at`: formatted Current Date
   - `force_test`: Boolean false
5. `Run Shortcut: Money Tracker Parser` ด้วย Dictionary.

ถ้า Notification variable ไม่มี message body ให้ตรวจ LINE/iOS ว่าอนุญาต Show Previews; ถ้า iOS ไม่ยอมรัน trigger อัตโนมัติ ให้ใช้การยืนยันจาก notification หรือ fallback `Money Tracker Screen`. อย่าส่งข้อความ LINE ทุกชนิดเข้า Production โดยไม่มี parser invalid gate

## 4. ทดสอบก่อน Production

1. คง `mode = test`.
2. ทดสอบอย่างน้อย UOB Thai, UOB English, SCB เงินออก, SCB เงินเข้า, SCB สองรายการ, หลายธนาคารบนจอ, LINE Wallet และข้อความที่ไม่ใช่ธุรกรรม.
3. SCB สองรายการและหลายธนาคารบนจอต้องได้ block รายการหลังสุด.
4. ส่ง transaction เดียวกันผ่าน notification และ screen; `dedupe_key` ต้องเหมือนกันและเป็น hex 64 ตัว.
5. Invalid ต้องเป็น `source = unknown`, `amount = null`, `parse_status = invalid`, และห้ามมี prompt ขอ network.
6. บน Mac ตรวจ reference logic ได้ด้วย:

```sh
node --test work/reference-parser.test.mjs
```

reference parser มีไว้ตรวจ contract เท่านั้น ไม่ได้ถูกเรียกจาก iPhone

## 5. เปิด Production

1. สร้าง ingestion token ที่จำกัดสิทธิ์เฉพาะ endpoint รับ transaction; ห้ามใช้ admin/service-role key.
2. ใช้ HTTPS endpoint จริงและเปลี่ยน placeholder ทั้ง endpoint/key.
3. ทดสอบ Quick Look ครบทุก source ก่อน.
4. เปลี่ยน `mode` จาก `test` เป็น `production` เป็นขั้นตอนสุดท้าย.
5. ผู้ที่แก้ Shortcut ได้จะเห็น API key; หากต้องการความลับจริง ให้ใช้ token อายุสั้นหรือให้ backend ออก scoped token.

หากภายหลัง Apple export กลับมาใช้งานได้ ให้ export “For Anyone”, sign/validate แล้วทดลอง preview import โดยไม่กดแทน Shortcut เดิมจนกว่าจะตรวจชื่อและ action ครบ
