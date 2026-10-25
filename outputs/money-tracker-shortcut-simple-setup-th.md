# Money Tracker — Shortcut แบบง่าย

Shortcut นี้ไม่ต้องมี regex หรือ JSON 19 ช่องบน iPhone อีกต่อไป ตัว Shortcut ส่งเพียงข้อความดิบกับชนิดการจับภาพ แล้ว Money Tracker จะ parse UOB, SCB และ LINE Wallet ฝั่ง server

เวอร์ชัน Native ที่แก้ไขจะตรวจ input ก่อนส่งทุกครั้ง ถ้า Automation ไม่ส่งข้อความ จะขึ้นคำแนะนำบนเครื่องและไม่ยิง request ที่ทำให้เกิด `invalid_capture`.

## 1. สร้าง Shortcut เดียว

สร้าง Shortcut ชื่อ `Money Tracker Capture` แล้วใส่ action ตามลำดับนี้:

1. `Get Shortcut Input`
2. `If Shortcut Input has any value`
   - ในแขนง `If`: `Get Text from Input` → ตั้งชื่อตัวแปร `Raw Text`
   - ตั้งค่า Text เป็น `line_notification` → ตัวแปร `Capture Method`
   - ใน `Otherwise`: `Get What's On Screen` → `Get Text from Input` → `Raw Text`
   - ตั้งค่า Text เป็น `whats_on_screen` → `Capture Method`
3. `Dictionary` มี 2 key:

```text
raw_text       Raw Text
capture_method Capture Method
```

4. `Get Contents of URL`

```text
URL: https://bwtoyxxwwmsaoaitihqj.supabase.co/functions/v1/ingest-shortcut-capture
Method: POST
Request Body: JSON
JSON: Dictionary จากข้อ 3
Header: Content-Type = application/json
Header: Authorization = Bearer <device token>
```

แทน `<device token>` ด้วย Token ที่สร้างจาก **Money Tracker → เพิ่มเติม → ตั้งค่า → เชื่อมต่อ iOS Shortcut** โดยวางทั้งค่า เช่น `mtst_v1....` ต่อท้ายคำว่า `Bearer `

5. `Quick Look` เพื่อดูผลตอบกลับ

อย่าใช้ Supabase anon key หรือ service-role key แทน device token

## 2. ใช้กับ LINE Notification

การติดตั้ง Shortcut อย่างเดียว **ยังไม่สร้าง Automation** ให้ ต้องสร้าง Personal Automation บน iPhone:

1. เลือก trigger `Notification` และ App = `LINE`
2. เริ่มต้นใช้ filter กว้าง เช่น `UOB` หรือไม่ใส่ filter เพื่อไม่ให้ตัดแจ้งเตือนทิ้งก่อนทดสอบ
3. เพิ่ม action `Text` ก่อน `Run Shortcut` แล้วใส่ Magic Variable จาก `Notification` โดยเลือก `Title`, `Subtitle` และ `Message/Body` ที่มีอยู่ คั่นแต่ละส่วนด้วยบรรทัดใหม่
4. เพิ่ม action `Run Shortcut` → ชื่อ Shortcut ที่ติดตั้งไว้ (ชุดนี้ใช้ `Money Tracker - Notification Inbox`; ถ้าสร้างตามคู่มือเดิมใช้ `Money Tracker Capture`)
5. ตั้ง Input ของ `Run Shortcut` เป็นผลลัพธ์จาก action `Text` นี้ ไม่ใช่ `Notification` object ตรง ๆ. ถ้าใช้ไฟล์ Native ที่สร้างใหม่และต้องการส่ง object ตรง ๆ ให้ตั้งเป็น Magic Variable `Notification`; แต่แบบ Text รวมฟิลด์จะเสถียรกว่าบน iOS รุ่นต่าง ๆ
6. เปิด `Ask Before Running` ไว้ก่อนเพื่อยืนยันว่า Automation ถูกเรียกจริง
7. ปิด `Ask Before Running` ได้หลังจากทดสอบผ่านแล้ว

ถ้าส่ง `Notification` object ตรง ๆ บางรุ่นของ iOS จะได้เฉพาะชื่อแอปหรือข้อความว่าง ทำให้ parser หา transaction ไม่เจอ. การรัน Shortcut จากแอป Shortcuts โดยไม่ส่ง input ไม่ใช่การทดสอบ Notification path.

ถ้าต้องรองรับหลายข้อความ ให้สร้าง Automation แยกกัน เพราะ filter หลายตัวใน automation เดียวอาจถูกตีความเป็น AND

## 3. ใช้จับจากหน้าจอ

เปิดหน้า UOB, SCB Connect หรือ LINE Wallet แล้วรัน Shortcut ชื่อเดียวกับที่ตั้งไว้จากแอป Shortcuts, Action Button หรือ Back Tap

เมื่อไม่มี Shortcut Input ระบบจะใช้ `Get What's On Screen` เอง แล้วส่งข้อความหน้าจอทั้งก้อนให้ server แยกธุรกรรมที่รองรับทุกรายการตามลำดับบนจอ. UOB Thai/English ที่เป็นธุรกรรมเดียวกันจะถูกรวมเป็นรายการเดียว และแต่ละธุรกรรมจะเข้า Inbox แยกกัน

## 4. ผลลัพธ์และความปลอดภัย

- `queued` = จำนวนรายการใหม่ที่เข้า Shortcut Inbox
- `duplicate` = จำนวนรายการที่เคยรับแล้ว ระบบไม่สร้างซ้ำ
- `failed` = กลุ่มข้อความที่มีจุดเริ่มต้นธุรกรรมแต่ server อ่านไม่ได้ ให้กรอกเองหรือจับภาพใหม่; รายการที่อ่านได้ยังเข้า Inbox ตามปกติ
- ครั้งแรกของรายการใหม่ตอบ `202`; ถ้าทุกรายการเป็นของเดิมตอบ `200 duplicate`
- ส่งข้อความเดิมซ้ำตอบ `200 duplicate` และไม่สร้างรายการซ้ำ
- ถ้าตอบ `ingest_failed` ให้รัน Shortcut เดิมซ้ำได้อย่างปลอดภัย ระบบจะ dedupe แถวที่เข้าแล้วและเติมเฉพาะรายการที่ยังไม่เข้า
- รายการจะเข้า **Transactions → รายการจาก Shortcut** เท่านั้น
- ต้องเปิดดู แก้ไข และกด Save เองจึงจะสร้าง Transaction จริง
- ถ้า Token รั่ว ให้ revoke จากหน้าเชื่อมต่อ iOS Shortcut แล้วสร้างใหม่

## 5. วันที่รายการและการส่งซ้ำ

Native Shortcut จะบันทึก `captured_at` ด้วย `Current Date` เพียงครั้งเดียวตอนเริ่ม workflow แล้วแปลงเป็น ISO 8601 ที่มี offset (`yyyy-MM-dd'T'HH:mm:ssXXX`, เวลา Asia/Bangkok) ก่อนส่งทุกครั้ง จึงไม่ใช้วันที่ของรายการก่อนหน้าเป็นวันที่รายการถัดไป

ใน Inbox วันที่ร่างรายการเลือกตามลำดับนี้: `transaction_date` จากข้อความธนาคาร → วันที่ของ `transaction_datetime` → วันที่ของ `captured_at`. ถ้าไม่มีวันที่ในข้อความ ระบบจะแสดงคำเตือนว่าใช้วันที่รับแจ้งเตือน โปรดตรวจสอบก่อนกด **บันทึก**. รายการจากหน้าจอเดียวกันแต่ละกลุ่มจะเก็บวันของตัวเอง

กดส่งซ้ำทันทีหลัง network error ได้อย่างปลอดภัย: รายการเดิมภายในหน้าต่างประมาณ 5 นาทีจะเป็น `duplicate` และไม่สร้างแถวใหม่. หากเป็นการซื้อรายการเดิมที่ส่งช้ากว่านั้นและไม่มีเลขอ้างอิง/เวลาในข้อความ อาจเข้า Inbox เป็นรายการใหม่ ให้ตรวจสอบก่อนบันทึกเสมอ

## 6. เพิ่มแอปธนาคารเอง เช่น UCHOOSE

ไปที่ **เพิ่มเติม → ตั้งค่า → รูปแบบแจ้งเตือนธนาคาร → เพิ่มแอปธนาคาร** แล้ววางตัวอย่างแจ้งเตือนที่คัดจากเครื่อง 2 รายการ (เช่น ซื้อสินค้า 1 รายการและคืนเงิน 1 รายการถ้ามี). ตัวอย่างอยู่ในหน่วยความจำของหน้านี้เท่านั้น ไม่ถูกส่งไปสร้างโปรไฟล์

เลือกจำนวน THB และทิศทางให้ตรงในตัวอย่าง จากนั้นกด **ทดสอบในเครื่อง** ให้ได้ผลลัพธ์ complete หนึ่งรายการก่อนกดบันทึก. ระบบรับเฉพาะ anchor แบบข้อความธรรมดาและช่องดึงค่าที่จำกัด ไม่รับ regex หรือโค้ด. หลังบันทึกให้สร้าง Personal Automation ของ LINE โดยเพิ่ม Text `MT-PROFILE:<รหัส 6 ตัว>` ต่อด้วย Title, Subtitle และ Message/Body ของ Notification แล้วส่งเข้า `Money Tracker - Notification Inbox`

ถ้ารูปแบบไม่ตรง รายการจะเข้า Inbox เป็น `ต้องตรวจเอง` โดยไม่เติมจำนวนเงิน/ร้านค้าให้เดาเอง: เลือก **สร้างรายการเอง**, **ปรับรูปแบบ** หรือ **ทิ้งรายการ**. ข้อความ OTP/การตลาดที่ตรง `mustNotContain` จะตอบ `ignored` และไม่สร้าง Inbox row

คู่มือเดิมแบบ parser/action map บน iPhone ยังเป็น legacy และเลือกเฉพาะ block ล่าสุด; อย่าใช้เมื่อต้องการเก็บหลายธุรกรรมจากหน้าจอเดียว. เก็บไว้เป็นเอกสารขั้นสูง: `money-tracker-shortcut-setup-th.md`
