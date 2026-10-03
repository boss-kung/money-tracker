# ผล cleanup ของ Money Tracker

วันที่ 3 ตุลาคม 2026 · Release `2026.10.03-cleanup-r127` · ผู้ใช้อนุญาต commit และ deploy production ผ่าน GitHub Pages workflow

## สิ่งที่แก้ไข

ตรวจการอ้างอิงใน JavaScript, HTML production/demo, CSS และเอกสารก่อนลบ พบ 56 จุดที่ยืนยันว่าเลิกใช้ ซ้ำ หรือไม่มีผลแล้ว รวมฟังก์ชันส่วนตัว ตัวแปร helper ที่ไม่มีผู้เรียก, motion block ที่เข้าไม่ถึง, export CSV รุ่นเก่า, helper Gold/FCD ที่ไม่มีผู้ใช้ และไฟล์ `style_v2.css.bak` กับ `reports-coach-sheet-r56.png` เพิ่มเติมจากนั้นย้าย onboarding save wrapper เข้า hook เดียวกัน

เก็บ `ui_v2_preview.html`, เครื่องมือตรวจ CSS, UI audit baselines, migration/recovery/backend และไฟล์ของผู้ใช้ใน `reports/` กับ `codex-skills` ไว้ CSS ลบเฉพาะ reduced-motion block ที่ซ้ำกันตรงตัว โดยยังมี block เดิมอีกแห่งบังคับลด animation/transition อยู่

JavaScript ที่อยู่ในรายการ core assets ลดจาก 2,099,432 เป็น 2,066,841 bytes: ลด 32,591 bytes (ประมาณ 31.8 KiB, 1.55%) ก่อนบีบอัด ไฟล์สำรอง CSS และภาพเก่าที่ลบไม่ได้อยู่ในชุด startup assets จึงไม่นับเป็นการลดขนาดโหลดแอป

## งานซ้ำที่ลดลง

| เส้นทาง | ก่อน | หลัง |
| --- | --- | --- |
| Ledger flow calculation ต่อการ reconcile | 2 ครั้ง | 1 ครั้ง |
| Ledger flow calculation เมื่อสร้าง Loan | 4 ครั้ง | 1 ครั้ง |
| การกำหนด `App.saveTx` ใน app_v2 + onboarding | 8 ชั้น/implementation sites | 2 จุด: core และ duplicate guard |
| การกำหนด Transaction list renderer | 5 จุด | 1 implementation พร้อม named hooks |
| Collection payload ที่ไม่เปลี่ยน | เขียน localStorage ซ้ำ | ไม่เขียน แต่ยังตรวจ saved state |
| BNPL plan จาก Transaction ใหม่ | helper บันทึกก่อน outer commit | บันทึกพร้อม Transaction ครั้งเดียว |

ไม่มี cache ข้ามการ reconcile: เปลี่ยนวันจาก Scheduled เป็น Posted หรือแก้ amount แล้วคำนวณใหม่เสมอ การสร้าง baseline ที่ขาดยังรักษายอดเงินและจำนวนหน่วยเดิม

Save ใช้ผล boolean เดียวกันทั้ง core และ hooks เมื่อ Storage ปฏิเสธการบันทึก จะโหลด financial state กลับจาก durable snapshot เก็บ draft/form ให้ลองใหม่ และไม่ส่ง success feedback จาก save hooks การ rollback ใน Storage เป็น best effort ตามพฤติกรรมเดิม หาก storage ใช้งานไม่ได้ทั้งหมด ยังต้องใช้ backup/recovery เดิม

## การตรวจสอบ

- `node --test tests/*.test.js`: 250 ผ่าน, 0 ล้มเหลว (ก่อนแก้ 238)
- เพิ่ม tests สำหรับ missing cash/investment baseline, date transition, in-place edits, Loan/Transaction commit count, save failure, deferred BNPL/Split Bill linkage, onboarding success gating, changed-only storage writes และ rollback/readback
- `node --check`: JavaScript ของโปรเจกต์ 84 ไฟล์ผ่าน
- `git diff --check`: ผ่าน
- Isolated Chrome, viewport 430×932, ข้อมูลสังเคราะห์และปิด external requests: production auth gate ยังปรากฏ; หลัง override การซ่อนแอปจาก gate เฉพาะ test fixture ตรวจ 5 หน้าหลักทั้ง light/dark และ UI v2 เปิด/ปิด; demo ตรวจ 5 หน้าทั้งสอง theme พร้อม reduced-motion
- Browser flows: ordinary save และ installment save คำนวณ Ledger/commit ครั้งเดียว; installment total ครบ; recurring linkage ครบ; BNPL plan+Transaction commit ครั้งเดียว; double tap/duplicate confirmation ไม่เพิ่มรายการ; failed save คืนยอด/รายการเดิมและเก็บฟอร์ม; Split Bill link บันทึกพร้อม Transaction และไม่ค้างเมื่อบันทึกล้มเหลว; CSV download สำเร็จ; ไม่มี uncaught page errors
- Service worker: release ใหม่ precache core assets ครบ 39 รายการและ offline reload โหลด App/Ledger ได้
- ตรวจ diff ภายในและ independent review: พบ readback ของ skipped collections และ Split Bill link commit; เพิ่ม regression tests และแก้ทั้งสองจุดแล้ว ผู้ตรวจยืนยันว่าไม่มี material findings ค้าง

## ขอบเขตที่ยังต้องวัดต่อ

ผลยืนยันว่าโค้ดและงานคำนวณซ้ำลดลง แต่ยังไม่ยืนยันว่าอาการช้า/กระตุกหายทั้งหมดบนอุปกรณ์จริง ตัวเลขเวลาเปิดหน้าใน local browser เป็น sample เดียวและมีผลจาก cache จึงไม่ใช้สรุปเปอร์เซ็นต์ความเร็ว ส่วนการทดสอบ gate ไม่ใช่การทดสอบ Google login หรือ cloud sync ด้วยบัญชีจริง

ยังมี eager Dashboard renders หลายครั้งตอน boot, observers และ animation/forced layout อีกหลายส่วนที่มีพฤติกรรมจริง จึงไม่ลบทิ้งจากการดูชื่อซ้ำอย่างเดียว การรวม boot renders ต้องทำ profiling ต่อและทดสอบ auth/app-lock/deep links; recurring save ยังมีหลาย commit เพื่อสร้างและเชื่อม metadata ตามเส้นทางเดิม การแบ่ง app_v2.js เป็น modules เป็นงานสถาปัตยกรรมถัดไป ไม่ได้รวมอยู่ใน cleanup นี้
