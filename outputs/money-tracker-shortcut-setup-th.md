# Money Tracker Shortcuts — วิธีติดตั้งแบบสั้น

ไฟล์ที่ต้องใช้มี 2 ไฟล์:

- `Money Tracker - Notification Inbox.shortcut` — รับข้อความจาก LINE Notification
- `Money Tracker - Manual Screen Capture.shortcut` — อ่านข้อความจากหน้าจอด้วย Get What's On Screen

## 1) นำเข้าใน iPhone

ส่งไฟล์ `.shortcut` ไปที่ iPhone ด้วย AirDrop หรือเก็บไว้ใน iCloud Drive แล้วแตะไฟล์ > **Add Shortcut**.

ถ้า iPhone ถามให้ตรวจสอบ Shortcut ให้แตะ **Add Shortcut** ได้ เพราะไฟล์นี้เป็น Shortcut ของ Money Tracker ที่สร้างไว้สำหรับ endpoint ของโปรเจกต์นี้

## 2) ใส่ Device Token

ต้องทำซ้ำกับ Shortcut ทั้งสองตัว:

1. เปิด Shortcut แล้วแตะ **Edit**
2. แตะ action **Get Contents of URL**
3. เปิด **Headers**
4. ที่ `Authorization` เปลี่ยนเฉพาะคำว่า `PASTE_DEVICE_TOKEN_HERE`
5. ต้องคงรูปแบบเป็น `Bearer ตามด้วย-token-จริง`

ไม่ต้องเปลี่ยน URL — ไฟล์ใส่ endpoint ของ Money Tracker ไว้แล้ว:

`https://bwtoyxxwwmsaoaitihqj.supabase.co/functions/v1/ingest-shortcut-capture`

อย่าส่ง token ให้คนอื่นหรือใส่ไว้ในข้อความแชต

## 3) ตั้ง LINE Notification Automation

บน iPhone รุ่น/ระบบที่มี **Notification trigger**:

1. เปิด **Shortcuts > Shortcuts**
2. แตะ `Money Tracker - Notification Inbox` > **Edit** > **Automation**
3. เลือก **Notification**
4. ตั้ง **App = LINE**
5. เพิ่ม filter ที่ช่วยแยกแจ้งเตือนธุรกรรม เช่น `UOB`, `SCB`, `LINE Pay`, `ใช้บัตร`, หรือ `รายการเงินออก`
6. ให้ automation เรียก Shortcut `Money Tracker - Notification Inbox`
7. เปิดให้รันอัตโนมัติถ้าต้องการ แล้วแตะ **Done**

แนะนำให้เริ่มจากเปิด **Ask Before Running** ไว้ก่อน เพื่อทดสอบและตรวจข้อมูลก่อน จากนั้นค่อยปิดเมื่อมั่นใจ

ถ้าเมนูไม่มี `Notification` ให้ใช้ Manual Screen Capture แทน หรืออัปเดต iOS/Shortcuts ให้รองรับ trigger นี้

## 4) ใช้ Manual Screen Capture

เปิดหน้าแจ้งเตือนหรือหน้ารายการของ UOB Thai, SCB Connect หรือ LINE Wallet ให้เห็นธุรกรรมที่ต้องการ แล้วเรียก `Money Tracker - Manual Screen Capture` จากแอป Shortcuts, Home Screen หรือ Share Sheet. Server จะอ่านธุรกรรมที่รองรับทุกกลุ่มบนหน้าจอตามลำดับ และแยกแต่ละกลุ่มเป็น Inbox item; สำเนา UOB ภาษาไทย/อังกฤษของรายการเดียวกันจะรวมเป็นรายการเดียว

Shortcut จะส่งข้อความหน้าจอทั้งก้อนให้ Money Tracker แล้วรับผลรวม `queued`, `duplicate`, `failed` กลับมา: รายการใหม่เข้า Inbox, รายการซ้ำไม่สร้างใหม่, ส่วนรายการที่อ่านไม่สำเร็จให้จับภาพใหม่หรือกรอกเอง. ถ้าได้ `ingest_failed` ให้รัน Shortcut เดิมซ้ำได้อย่างปลอดภัย

## หลังส่งสำเร็จ

Money Tracker จะเก็บแต่ละรายการไว้ใน **Shortcut Inbox** แยกกัน เพื่อให้คุณเปิดตรวจ แก้ไข merchant/amount/account/date และกด **บันทึก** ทีละรายการเป็นรายการเงินจริง การส่งซ้ำจึงปลอดภัยและรองรับการตรวจ duplicate

ถ้า Quick Look แสดงผลตอบกลับจาก API แปลว่าส่งเข้า Inbox สำเร็จแล้ว

## 5) วันที่รายการและการส่งซ้ำ

ไฟล์ Native จะมี action `Current Date` และ `Format Date` อยู่ต้น workflow โดยอ่านเวลาหนึ่งครั้งแล้วส่ง `captured_at` เป็น ISO 8601 พร้อม offset (`yyyy-MM-dd'T'HH:mm:ssXXX`, เวลา Asia/Bangkok) ทั้งใน Dictionary และ JSON request. ไม่ใช้ค่าจาก workflow ก่อนหน้า และไม่ให้รายการที่ 2 ยืมวันที่ของรายการที่ 1

วันที่ในร่าง Inbox ใช้ลำดับ `transaction_date` → วันที่ของ `transaction_datetime` → วันที่ของ `captured_at`. ถ้าข้อความแจ้งเตือนไม่มีวันที่ ระบบจะแสดงคำเตือนบนฟอร์มว่าใช้วันที่รับแจ้งเตือน โปรดตรวจสอบก่อนกด **บันทึก**. ธุรกรรมหลายกลุ่มบนหน้าจอจะถูกแยกและคงวันที่ของแต่ละกลุ่มไว้

ถ้าส่งซ้ำทันทีหลัง network error ให้รัน Shortcut เดิมได้ ระบบจะ dedupe รายการเดิมภายในประมาณ 5 นาที. รายการที่ไม่มีเวลา/เลขอ้างอิงและส่งช้ากว่านั้นอาจถูกจัดเป็นรายการใหม่ จึงควรตรวจ Inbox ก่อนบันทึกทุกครั้ง

## 6) เพิ่มรูปแบบธนาคารด้วยตัวอย่าง 2 รายการ

ใน Money Tracker เปิด **เพิ่มเติม → ตั้งค่า → รูปแบบแจ้งเตือนธนาคาร** แล้วสร้างโปรไฟล์สำหรับ UCHOOSE หรือแอปอื่น โดยคัดลอกข้อความแจ้งเตือนตัวอย่าง 2 รายการลงในตัวช่วยสร้าง เลือกจำนวน THB, ทิศทาง, ช่องวันที่/เวลา/ร้านค้า/เลขอ้างอิง และข้อความที่ต้องมีหรือห้ามมี จากนั้นกด **ทดสอบในเครื่อง** ให้ผ่านหนึ่งรายการก่อนบันทึก

ตัวอย่างดิบไม่ถูกส่งออกจาก browser และไม่เก็บใน local/session storage; เซิร์ฟเวอร์รับเฉพาะ compiled rule ที่เข้ารหัส. ระบบไม่รับ regex, JavaScript หรือ pattern ที่รันโค้ด. หลังบันทึก ให้สร้าง Automation ของ LINE โดยวาง Text action `MT-PROFILE:<รหัส 6 ตัว>` แล้วต่อด้วย Title, Subtitle และ Message/Body ของ Notification คั่นบรรทัด ก่อน Run Shortcut. การตั้ง Automation เป็นรายเครื่อง ต้องทำซ้ำบน iPhone แต่ละเครื่อง และควรเปิด Show Previews ระหว่างทดสอบ

โปรไฟล์ที่ตรงครบจะเข้า Inbox เป็นรายการจาก `custom_profile`; ถ้าไม่ครบ/กำกวม/เนื้อหาถูกซ่อนจะแสดง `ต้องตรวจเอง` โดยไม่เดาจำนวนเงินหรือทิศทาง. เลือก **สร้างรายการเอง** เพื่อกรอกผ่านฟอร์มปกติ, **ปรับรูปแบบ** เพื่อกลับไปแก้โปรไฟล์, หรือ **ทิ้งรายการ**. ข้อความ OTP/การตลาดที่ตรง `mustNotContain` จะถูก `ignored` และไม่สร้างรายการ
