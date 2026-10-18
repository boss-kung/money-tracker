# Money Tracker — Shortcut แบบง่าย

Shortcut นี้ไม่ต้องมี regex หรือ JSON 19 ช่องบน iPhone อีกต่อไป ตัว Shortcut ส่งเพียงข้อความดิบกับชนิดการจับภาพ แล้ว Money Tracker จะ parse UOB, SCB และ LINE Wallet ฝั่ง server

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

สร้าง Personal Automation ในแอป Shortcuts:

1. เลือก trigger `Notification` และ App = `LINE`
2. ตั้ง filter เป็นข้อความธุรกรรม เช่น `มีการใช้บัตร`, `รายการเงินออก`, `รายการเงินเข้า` หรือ `LINE Pay Purchase`
3. เพิ่ม action `Run Shortcut` → `Money Tracker Capture`
4. ถ้ามีช่องรับ Input ให้เลือก Magic Variable `Notification`
5. ปิด `Ask Before Running` เฉพาะเมื่อทดสอบแล้วว่าต้องการให้ทำงานอัตโนมัติ

ถ้าต้องรองรับหลายข้อความ ให้สร้าง Automation แยกกัน เพราะ filter หลายตัวใน automation เดียวอาจถูกตีความเป็น AND

## 3. ใช้จับจากหน้าจอ

เปิดหน้า UOB, SCB Connect หรือ LINE Wallet แล้วรัน `Money Tracker Capture` จากแอป Shortcuts, Action Button หรือ Back Tap

เมื่อไม่มี Shortcut Input ระบบจะใช้ `Get What's On Screen` เอง และเลือกธุรกรรมล่าสุดบนหน้าจอ

## 4. ผลลัพธ์และความปลอดภัย

- ครั้งแรกตอบ `202 queued`
- ส่งข้อความเดิมซ้ำตอบ `200 duplicate` และไม่สร้างรายการซ้ำ
- รายการจะเข้า **Transactions → รายการจาก Shortcut** เท่านั้น
- ต้องเปิดดู แก้ไข และกด Save เองจึงจะสร้าง Transaction จริง
- ถ้า Token รั่ว ให้ revoke จากหน้าเชื่อมต่อ iOS Shortcut แล้วสร้างใหม่

คู่มือเดิมแบบ parser บน iPhone เก็บไว้เป็นเอกสารขั้นสูง: `money-tracker-shortcut-setup-th.md`
