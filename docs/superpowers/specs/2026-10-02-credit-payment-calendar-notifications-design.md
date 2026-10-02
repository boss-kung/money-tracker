# Credit payments, billing calendar, and notifications design

สถานะ: ข้อเสนอสำหรับการแก้ครบ 9 findings จากการตรวจวันที่ 2 ตุลาคม 2026; ยังไม่ได้ implement หรือ deploy

## เป้าหมายและขอบเขต

ทำให้ Ledger, รอบบิล, การชำระ, Dashboard, ปฏิทิน และ Notification Snapshot ใช้ยอดคงเหลือที่สอดคล้องกัน จ่ายหมดแล้วไม่เกิดหนี้เดิมซ้ำ จ่ายบางส่วนแล้วยังเห็นส่วนที่ค้าง และวางแผนเงินสดโดยไม่บวกบิลกับแผนชำระซ้ำ

ครอบคลุม findings 1–9 เท่านั้น รวม consumer ที่นำยอดไปใช้คำนวณ เช่น AI Insights และ Finance Intelligence ไม่เพิ่มระบบดอกเบี้ย ยอดขั้นต่ำ การเชื่อมธนาคาร หรือเปลี่ยนกฎวันหยุดธนาคาร

## ทางเลือก

1. แนะนำ: เพิ่ม allocation engine ที่เป็น pure function ใน `credit_card_cycles.js`, เก็บ metadata รอบบิลใน Wallet และใช้ผลเดียวกันทุก consumer ทยอยส่งมอบได้และทดสอบโดยไม่ boot UI
2. แก้เงื่อนไขแยกตามหน้าจอ: diff เล็ก แต่ไม่แก้การจัดสรรเงินข้ามรอบ และยังเกิดยอดต่างกันได้
3. ย้ายข้อมูลการเงินทั้งหมดขึ้น server: เปลี่ยนสถาปัตยกรรม local-first และเพิ่มข้อมูลการเงินบน cloud เกินขอบเขต

## ข้อกำหนดร่วม

- ใช้ Vanilla JavaScript, UMD/IIFE แบบเดิม, Node `node:test` และ Supabase Edge Functions; ไม่เพิ่ม bundler หรือ dependency ของ production
- Ledger เป็นแหล่งคำนวณ balance; billing engine ไม่เขียน balance หรือแก้ยอด Transaction
- เก็บรายการเดิมและ `statementId` เดิม; allocation เป็นผลคำนวณใหม่ ไม่สร้าง expense/payment ซ้ำ
- เงินคำนวณเป็น integer satang; รับเฉพาะ finite number; output บาททศนิยมสองตำแหน่ง
- Transaction วันที่อนาคตไม่เปลี่ยนยอดชำระแล้วหรือยอดค้างจริง
- วันของรอบบิลยังเป็น calendar date ตามกติกาปัจจุบัน; snapshot และเวลาส่งแจ้งเตือนใช้ `Asia/Bangkok` ทั้ง client และ server
- UI ใช้ tokens/components จาก `docs/UI_DESIGN_SPEC.md`, ตรวจ light/dark และมือถือ; แยก PR ที่แตะ UI ทีละหน้าจอตาม `CLAUDE.md`
- Server รับเฉพาะ numeric trigger signals และ metadata การซิงค์ ไม่รับชื่อบิล ชื่อบัตร จำนวนเงิน หรือ transaction/statement IDs
- วางแผนการ deploy แยกจากการแก้ไฟล์; ไม่ถือว่าการสร้างแผนเป็นคำสั่ง deploy

## 1. Billing metadata และ migration

เพิ่ม `wallet.ccBilling` เป็น nested metadata:

- `version: 2`
- `opening: { statementId, start, end, dueDate, provenance }` เป็น anchor คงที่สำหรับ signed `openingBalance`; provenance คือ `explicit` หรือ `inferred`
- `periods: [{ id, start, end, dueDate }]` เก็บช่วง/กำหนดชำระของรอบที่ปิดแล้ว ใช้ card settings สร้างรอบใหม่เท่านั้น
- baseline amount อ่านจาก `wallet.openingBalance` เสมอ ไม่เก็บเงินซ้ำใน metadata

Migration สร้าง candidate state ก่อน persist ผ่าน State Commit และ rollback เมื่อบันทึกไม่ได้ ต้องรันซ้ำแล้วได้ผลเดิม ไม่แก้จำนวนเงิน/วันที่/ID ของรายการเดิม

สำหรับหนี้ตั้งต้นเก่า: เลือก anchor จาก valid statement reference ที่เก่าสุดใน payment ของบัตร; หากไม่มี ใช้รอบที่ปิดก่อนวันที่ Posted Transaction แรก; หากไม่มีรายการ ใช้รอบปิดล่าสุด ณ วันที่ migration แล้วบันทึกถาวร ถ้าเลือกอัตโนมัติให้ระบุ `inferred` และเปิดให้แก้ช่วง/วันครบกำหนดตั้งต้นได้ในหน้าบัตร ห้ามแสดงว่ากำหนดนี้ยืนยันจากธนาคารแล้ว

รักษารอบที่อ้างด้วย statementId เดิม: parse ช่วงวันที่และตรวจ cardId/ขอบเขตให้ถูกต้อง; dueDate เก่าที่ไม่เคยเก็บให้ derive หนึ่งครั้งจากค่าปัจจุบันและระบุเป็นประมาณการ ความแม่นยำของวันครบกำหนดในอดีตที่สูญข้อมูลไปแล้วกู้ไม่ได้โดยอัตโนมัติ

Wallet ใหม่ที่มีหนี้ตั้งต้นใช้ anchor ที่กำหนด ณ การสร้าง; การแก้ balance ภายหลังคง anchor เดิมและคำนวณจาก baseline ใหม่ การเปลี่ยนวันตัดรอบ/วันครบกำหนดมีผลเฉพาะรอบที่ยังไม่ปิด ไม่เปลี่ยน ID/วันครบกำหนดของรอบปิดเก่า

Metadata อยู่ใน wallets ที่ backup/sync อยู่แล้ว ไม่เพิ่ม collection ใหม่ ทดสอบ hydration, backup, import replace/merge, encrypted vault merge และ rescue round-trip โดยรักษา field นี้ รวมทั้ง import ข้อมูลเก่าที่ไม่มี metadata

## 2. Allocation engine

API หลัก:

`CreditCardCycles.buildCardBillingState({ card, transactions, refDate, amountForTx, isPostedTx })`

คืน `{ statements, payableStatements, openStatement, allocations, creditBalance, postedDebt, reconciliation }`:

- `statements` เก็บ `purchaseTotal`, `openingDebt`, `paidTotal`, `creditTotal`, `balanceDue`, `status`, `daysLeft` และ period metadata
- `status` คือ `open`, `unpaid`, `partial`, `paid`, `overdue`; `paid` ต้องยอดค้างเป็นศูนย์; overdue มีความสำคัญเหนือ partial เมื่อเลยกำหนด
- `allocations` เก็บ `{ transactionId, statementId, amount, kind }`, kind เป็น `payment` หรือ `credit`; เก็บเฉพาะในผลคำนวณ
- `postedDebt` ไม่รวม installment อนาคต; committed installments แสดงแยกตามกติกาเดิม

สร้าง obligation จาก signed baseline ครั้งเดียว และจาก debit ที่มีผลต่อ card Ledger แล้ว replay Posted Transactions ตาม `date`, `createdSequence`, `createdAt`, `id` เพื่อให้ผล deterministic ไม่ขึ้นกับลำดับ array

Allocation policy:

1. ถ้า credit/payment มี valid `statementId` ให้หักรอบนั้นก่อน แม้บันทึกหลังวันตัดรอบหรือวันครบกำหนด
2. ส่วนที่เหลือ หรือรายการไม่มี reference: หักรอบปิดที่ยังค้างตาม dueDate/start/id จากเก่าสุดก่อน ไม่หยุดเพราะเลยกำหนด
3. จากนั้นหักรอบเปิดที่มี debit เกิดขึ้นแล้ว
4. ส่วนเกินเป็น `creditBalance` และใช้หัก debit ที่เกิดถัดไป; ไม่ทิ้งเงินเพราะรอบหนึ่งถูกจ่ายครบ
5. openingBalance บวกคือเครดิตตั้งต้น ใช้ policy เดียวกัน
6. refund/income เข้าบัตร และ transfer เข้าบัตรเป็น credit; transfer ออกจากบัตรเป็น debit ตาม Ledger เพื่อไม่เกิด reconciliation gap
7. reference ผิด/ลบ/บัตรคนละใบต้องไม่กินเงินหาย: ใช้ fallback พร้อม diagnostic ภายใน และไม่แก้ reference เดิมอัตโนมัติ

`amount` ของ cc_payment ใช้ลดหนี้; `cashAmount` ใช้ลดเงินต้นทางและวางแผน cashflow ส่วนลดการชำระไม่ทำให้ allocation ลดหนี้น้อยกว่ายอด amount

Invariant ในทุก fixture:

`sum(statement.balanceDue) - creditBalance === -ledgerCardBalance` (ปัด satang)

เมื่อ net balance เป็นเครดิต ไม่มี payable statements; total allocated ของ credit/payment ไม่เกิน amount; transaction อนาคตไม่อยู่ใน allocations

API เดิม `getCardStatement`, `getStatementHistory`, `getPayableStatements`, `getNextPayableDueInfo`, `getCreditDueNotificationRows` delegate มาที่ engine เดียวกัน รองรับ includeOpen/history เดิม `purchaseTotal` ใช้เฉพาะยอดซื้อ ไม่รวม openingDebt; consumer แสดงหนี้ตั้งต้นแยก

## 3. หน้าชำระบัตรและ Dashboard

หน้าชำระใช้ยอดค้างรอบที่เลือก พร้อมช่วงรอบ/วันครบกำหนด เลือกรอบอื่นได้; เมื่อไม่มีรอบปิดค้าง ใช้ยอด debit รอบเปิดเป็นค่าตั้งต้น การจ่ายเกินยังทำได้และ preview บอกส่วนที่จะเป็นเครดิตล่วงหน้า ปุ่มเต็มจำนวนหมายถึงเต็มยอดรอบที่เลือก แยกจากจ่ายหนี้ทั้งหมด

คง validation กระเป๋าต้นทาง ยอดเงินพอ ส่วนลดตรงกับเงินจ่ายจริง และ rollback หลัง persist ล้มเหลว

Dashboard แสดงทุกบิลค้างใกล้ถึงใน 3 วันและทุกบิล overdue รวมยอดของบัตรเดียวกันได้แต่ต้องไม่ซ่อนบิลที่เหลือเพราะมี payment บางส่วน ตัด `hasPaymentForCreditDue()` ออกจากเงื่อนไขการซ่อน ใช้ balanceDue > 0 เท่านั้น ไม่ใช้ payment อนาคตซ่อนเตือน

## 4. ปฏิทินและยอดภาระเงินสด

สร้าง pure projection ใน `upcoming_obligations.js`:

`projectCreditObligations({ billingStates, transactions, refDate, endDate, amountForTx })`

คืนแถวบิลทุกรอบที่ยังค้างและอยู่ใน horizon รวม overdue พร้อม `statementId`, `amount` (ค้างจริง), `plannedAmount`, `unplannedAmount`, `cashRequired`, `cashflowKind`, `status` แถว planned cc_payment มี linked allocations และ `cashRequired` เท่ากับเงินจ่ายจริง

Replay payment อนาคตเฉพาะ projection เพื่อคำนวณ plannedAmount; ไม่เอาผล projection ไปเปลี่ยน balanceDue/paid/notification filter

สูตรยอดเงินต้องเตรียม:

`sum(cashRequired ของ scheduled payments) + sum(unplannedAmount ของบิลใน horizon)`

ตัวอย่าง: บิล 5,000 ตั้งชำระ 5,000 จ่ายจริง 4,900 → cashRequired รวม 4,900; บิล 5,000 ตั้งชำระ 2,000 จ่ายจริง 1,900 → รวม 4,900 (1,900 + 3,000)

นับ plans เฉพาะช่วงที่แสดง แต่ scheduled payment ใน horizon ที่หักบิลนอก horizon ยังเป็นเงินที่ต้องเตรียม; payment หลัง horizon ไม่ลดบิลใน horizon แผนชำระหลัง due แสดงสถานะว่าตั้งไว้หลังครบกำหนดและไม่ซ่อน overdue

`App.getUpcomingItems()` รวม projection กับ recurring/upcomingBills/goals/BNPL เดิม; ไม่เหมารายรับ การโอน หรือยอดรูดบัตรอนาคตว่าเป็นเงินสดที่ต้องจ่ายทันที เพิ่ม `App.getUpcomingCashRequirement(rows)` เป็น API กลางและเปลี่ยน AI Insights/Finance Intelligence/Dashboard ให้เรียกแทนการ sum ตาม type labels

Calendar แสดง “ค้างชำระ”, “ตั้งชำระแล้ว”, “ยังไม่ได้ตั้งชำระ” และเปิดรอบบิลที่คลิกได้ ยังไม่สร้าง UI ปฏิทินเดือนใหม่

## 5. Snapshot และการส่งแจ้งเตือน

Snapshot v2 ยังเก็บ signed `daysLeft` ตาม snapshotDate; ห้าม clamp overdue เป็น 0 ห้ามแปลง NaN/Infinity/วันที่ผิดเป็นรายการครบวันนี้ จำกัด signal arrays 100 รายการ และลดเฉพาะ numeric daysLeft ที่ซ้ำกันได้ก่อน truncate เพราะ rules ปัจจุบันตรวจ any-match

เพิ่ม `snapshot_schema_version` และ `snapshot_revision` ในตาราง; revision เป็น counter ที่ persist ต่อ user+install ใน localStorage (ไม่ใช่ financial collection) server รับได้เฉพาะ revision ใหม่กว่าด้วย atomic SQL RPC พร้อม ownership check old requests ห้ามเขียนทับ v2; legacy reader ยังอ่านแถวเดิมได้

สำหรับ `credit_card_due` และ `upcoming_bill_due` คำนวณ:

`effectiveDaysLeft = storedDaysLeft - calendarDaysBetween(snapshotDate, todayBangkok)`

ใช้ snapshot อายุ 0–90 วัน; snapshot อนาคต/วันที่ผิด/อายุเกิน 90 วันไม่ส่ง debt-driven notification กฎ no_transaction_today/budget/recurring เดิมยังใช้ same-day semantics เพื่อไม่เปลี่ยน scope โดยไม่ตั้งใจ

Pre-due rule mode `due` ส่งเมื่อ effectiveDaysLeft === daysBefore; mode `overdue` ส่งเมื่อ effectiveDaysLeft < 0 กฎเก่า default mode `due`; เพิ่มตัวเลือกเตือนเลยกำหนดใน editor โดยไม่เปิดกฎใหม่เอง

Delivery: cron ยังคงทุก 15 นาที; ให้ debt rules ส่งได้ตั้งแต่ configured time จนจบวัน Bangkok เพื่อชดเชย sync/cron ที่ช้า ส่งหนึ่งครั้งต่อ install+rule+Bangkok date; ไม่มี catch-up ข้ามวัน ไม่เปลี่ยน daily/weekly rules อื่น

ใช้ atomic claim ก่อนส่ง (log status `pending`/`sent`/`error`, lease 120 วินาที) cron สองตัวพร้อมกันไม่ส่งซ้ำ บันทึกผลส่งต้องตรวจ error; retry เฉพาะ error/lease หมดอายุ ในวันเดียวกัน Push transport ไม่รับประกัน exactly-once เมื่อ process ตายหลังส่งแต่ก่อนบันทึกผล; reuse tag/dedupe key เพื่อลดการแสดงซ้ำ

ข้อจำกัดที่ต้องบอกตรงกัน: ไม่มี server ใดรู้ payment ที่ยังไม่ sync การชำระ offline อาจยังได้รับข้อความจาก snapshot ล่าสุด; ไม่ใส่ยอดหรือบอกว่าเป็นข้อมูลธนาคารแบบเรียลไทม์ เปิดหน้า settings แสดงเวลาซิงค์ล่าสุด/pending เพื่อเข้าใจสถานะ

## 6. Sync หลัง State Commit

ติด observer ที่ `getStateCommit().addAfterCommit()`; debounce 1 วินาทีเมื่อ state ที่มีผลต่อ snapshot เปลี่ยน (create/edit/delete payment, statement credit/refund, bill status, baseline/settings, import, cloud merge)

เทียบ fingerprint ของ sanitized snapshot เพื่อไม่ส่งใหม่เมื่อ commit ไม่เกี่ยวข้อง dirty snapshot bypass TTL 10 นาที; snapshot ที่เหมือนเดิม refresh เมื่อวัน Bangkok เปลี่ยน

หนึ่ง request in-flight; ถ้ามี commit เพิ่มให้ส่ง state ล่าสุดต่อทันทีเมื่อ request เดิมเสร็จ dirty flag/revision persist แบบ scoped ต่อ user+install retry เมื่อ online/visibility visible/pageshow และตรวจวันใหม่ตอน visible ด้วย timer 60 วินาที

บันทึกซิงค์สำเร็จเฉพาะ response revision ที่ยอมรับ ไม่เคลียร์ dirty ของ state ใหม่ที่เกิดระหว่างส่ง persist financial state ล้มเหลวห้าม enqueue/sync sign-out/account switch ยกเลิกงานเก่าและไม่ส่งข้าม user

## Acceptance และ rollout

- ทั้ง 9 findings มี behavioral regression tests (ไม่ใช้ regex อย่างเดียว)
- หนี้ตั้งต้น 5,000 จ่ายหมดแล้วเปลี่ยนเดือนยังคงศูนย์; baseline metadata อยู่ครบหลัง reload/import/cloud merge
- จ่ายก่อนตัดรอบ/จ่ายข้ามหลายรอบ/เครดิตคืนหลังตัดรอบ reconcile กับ Ledger ได้และไม่เตือนยอดที่จ่ายแล้ว
- จ่ายบางส่วน 2,000 จาก 5,000 ทุกหน้าที่ใช้บิลแสดงค้าง 3,000; overdue ยังแสดง
- ปฏิทินแสดงทุกบิลค้าง; แผนชำระไม่เปลี่ยน paid จริงและไม่ถูกนับภาระซ้ำ
- ไม่เปิดแอปวันนี้แต่มี snapshot ที่ยังใช้ได้ยังส่งเตือนจากวันกำหนดจริง; ค้าง -10 ไม่กลายเป็นวันนี้
- ชำระ online แล้วส่ง snapshot ใหม่ที่ไม่มีบิลนั้น; cron ถัดไปไม่เตือนจาก snapshot เก่า
- run Node suite ทั้งหมด, Edge Function tests, migration tests, manual PWA/light-dark/mobile QA
- Deploy additive schema + compatible server ก่อน client; บังคับ v2 refresh หลัง client update; release manifest/cache keys อัปเดตตาม repo workflow
- Rollback ด้วย compatible app/server รุ่นก่อนหน้าของ rollout นี้ที่อ่าน metadata v2 ได้; ไม่ลบ metadata หรือคืน bug เดิม ไม่มี automatic data rewrite เพื่อ rollback
