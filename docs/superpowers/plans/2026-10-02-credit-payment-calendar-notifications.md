# Credit Payment, Calendar, and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. ผู้ใช้ขอวางแผนเท่านั้น; ยังไม่เริ่ม implementation หรือ deploy. ถ้าผู้ใช้เลือก delegation ภายหลัง ใช้ superpowers:subagent-driven-development แทนได้.

**Goal:** แก้ทั้ง 9 findings ให้การชำระบัตร การเตือน และปฏิทินแสดงยอดค้างจริงตรงกัน โดยไม่สูญรายการเดิมหรือบวกภาระเงินสดซ้ำ

**Architecture:** เพิ่ม pure allocation engine ในโมดูลรอบบิลเดิม และเก็บ anchor/closed-period metadata ใน Wallet. ปฏิทินใช้ projection แยกจากยอด posted จริง. Notification Snapshot เก็บ numeric signals เดิมพร้อม revision และนับวันต่อบน server ได้; client sync หลัง durable commit.

**Tech Stack:** Vanilla JavaScript UMD/IIFE, Node `node:test`, localStorage/MTStateCommit, Supabase PostgreSQL + Deno Edge Functions, GitHub Pages PWA.

**Spec:** `docs/superpowers/specs/2026-10-02-credit-payment-calendar-notifications-design.md`

## Global Constraints

- ใช้ Vanilla JavaScript, UMD/IIFE แบบเดิม, Node `node:test` และ Supabase Edge Functions; ไม่เพิ่ม bundler หรือ dependency ของ production
- Ledger เป็นแหล่งคำนวณ balance; billing engine ไม่เขียน balance หรือแก้ยอด Transaction
- เก็บรายการเดิมและ `statementId` เดิม; allocation เป็นผลคำนวณใหม่ ไม่สร้าง expense/payment ซ้ำ
- เงินคำนวณเป็น integer satang; รับเฉพาะ finite number; output บาททศนิยมสองตำแหน่ง
- Transaction วันที่อนาคตไม่เปลี่ยนยอดชำระแล้วหรือยอดค้างจริง
- วันของรอบบิลยังเป็น calendar date ตามกติกาปัจจุบัน; snapshot และเวลาส่งแจ้งเตือนใช้ `Asia/Bangkok` ทั้ง client และ server
- UI ใช้ tokens/components จาก `docs/UI_DESIGN_SPEC.md`, ตรวจ light/dark และมือถือ; แยก PR ที่แตะ UI ทีละหน้าจอตาม `CLAUDE.md`
- Server รับเฉพาะ numeric trigger signals และ metadata การซิงค์ ไม่รับชื่อบิล ชื่อบัตร จำนวนเงิน หรือ transaction/statement IDs
- วางแผนการ deploy แยกจากการแก้ไฟล์; ไม่ถือว่าการสร้างแผนเป็นคำสั่ง deploy

## Review Focus

- วันเดียวกันมีหลาย payment/credit และ array เรียงต่างกัน: ผล allocation ต้องเหมือนเดิม — Task 1
- Metadata เก่าหาย/statementId ผิด/เปลี่ยนวันตัดรอบ: เงินไม่หาย รอบที่ปิดแล้วไม่เปลี่ยน — Tasks 1–2
- แผนจ่ายหลัง due หรือหลัง horizon: ไม่ซ่อน overdue และไม่ลดเงินต้องเตรียมในช่วงผิด — Task 6
- สองแท็บหรือสอง request ซิงค์แข่งกัน/sign-out ระหว่างส่ง: snapshot ล่าสุดและ user ownership ต้องรักษา — Tasks 8–10
- cron วิ่งซ้ำ/ข้ามวัน Bangkok/Push สำเร็จแต่ log ล้มเหลว: ไม่ข้าม guard หรือกล่าวอ้าง exactly-once — Task 9

## Coverage ของ findings

| Finding | งานหลัก | หลักฐานที่ต้องผ่าน |
|---|---|---|
| 1 หนี้ตั้งต้นกลับมา | 1–2 | จ่าย 5,000 หมด แล้วข้ามเดือนยังศูนย์ |
| 2 จ่ายล่วงหน้า/เกินไม่ยกยอด | 1, 3 | รอบถัดไปถูกหักครบ; creditBalance ไม่หาย |
| 3 Statement Credit ไม่หักบิล | 1, 3 | บิล 1,000 คืน 100 เหลือ 900 |
| 4 ไม่เปิดแอปแล้วไม่เตือน | 8–9 | snapshot วันก่อนยัง match วันเตือนจริง |
| 5 จ่ายบางส่วนแล้วเตือนหาย | 4 | บิล 5,000 จ่าย 2,000 ยังเตือน 3,000 |
| 6 ปฏิทินมีแค่รอบแรก | 6–7 | บิลค้าง 1,000 และ 2,000 แสดงทั้งคู่ |
| 7 บวกบิลกับแผนจ่ายซ้ำ | 6–7 | บิล/แผนจ่าย 5,000 รวมเงินต้องเตรียม 5,000 |
| 8 overdue เป็นวันนี้ | 8–9 | -10 คงเป็น -10 และไม่ match due-today |
| 9 snapshot ไม่เปลี่ยนหลังจ่าย | 10 | commit สำเร็จแล้ว snapshot ล่าสุดไม่มีบิลจ่ายหมด |

## File map และลำดับ dependencies

- `credit_card_cycles.js`: engine, allocation, migration candidate และ compatibility APIs
- `app_v2.js`: hydration/migration integration, ชำระ, Dashboard, CC Detail, calendar adapters และ post-commit wiring
- `upcoming_obligations.js` (ใหม่): pure calendar projection/cash requirement
- `calculations.js`, `ai_insights.js`, `finance_intelligence.js`: consume billing totals/cashRequired กลาง
- `notification_snapshot.js` (ใหม่): pure privacy-limited numeric snapshot projection, Bangkok date math
- `notification_sync.js` (ใหม่): scoped dirty queue, revision, debounce/retry lifecycle; inject transport/storage ใน tests
- `notifications_v2.js`: snapshot/sync adapters, editor overdue mode, sync status
- `supabase/functions/_shared/notification_rules.ts` (ใหม่): pure sanitize/date/trigger evaluator แยกจาก Deno.serve
- `supabase/functions/_shared/notification_snapshot_store.ts` (ใหม่): revision-aware snapshot RPC adapter
- `supabase/functions/_shared/notification_delivery.ts` (ใหม่): atomic claim/send/log adapter ที่ inject dependencies ได้
- migrations, snapshot/sender/rule Edge Functions: schema contract, validation และ wiring
- `storage_v2.js`, `auth_sync.js`, `rescue.html`: แก้เฉพาะ path ที่ round-trip test พบว่าทำ metadata หาย
- `release_manifest.js`, `index.html`, `demo/index.html`: dependency order, offline assets และ cache keys

Dependencies: Task 1 → 2 → 3; Task 1 → 4–5; Tasks 1–2 → 6 → 7; Tasks 1–2 → 8 → 9; Tasks 8–9 → 10; ทุก task → 11. ทำตามลำดับรายการนี้ใน session เดียวเป็นค่าเริ่มต้น.

แต่ละ task ทำ failing behavioral test → ยืนยัน failure → implement → ผ่าน targeted tests → review diff → commit. ห้ามยอมให้ tests เดิมผ่านโดยเปลี่ยน assertion ให้ตรง bug; เปลี่ยน semantic expectation เฉพาะที่ spec นิยามใหม่ (เช่น openingDebt ไม่อยู่ใน purchaseTotal).

---

### Task 1: Allocation engine ที่ reconcile กับ Ledger (findings 1–3)

**Files:** Modify `credit_card_cycles.js`; Create `tests/fixtures/credit_billing.js`, `tests/credit_billing_allocation.test.js`; Modify `tests/credit_card_cycles.test.js`.

**Interfaces:** `buildCardBillingState(options)` และ outputs ตาม spec §2; API เดิม delegate engine โดยไม่เรียกกันวน. Fixtures export `card`, `purchase(id,date,amount)`, `payment(id,date,amount,statementId)`, `credit(id,date,amount,statementId)`.

- [ ] เขียน failing tests: openingBalance -5,000, payment 5,000 วันที่ 2026-06-01 reference รอบ 2026-04-26–2026-05-25; refDate 2026-06-03 และ 2026-06-26 ต้อง `postedDebt=0`, payable=[] ทั้งคู่.
- [ ] เขียน tests: expense 1,000 วันที่ 2026-06-01, payment 1,000 วันที่ 2026-06-03 reference รอบเก่าที่ไม่มีหนี้ → refDate 2026-06-26 ไม่มี payable; ซื้อ 1,000 สองรอบแล้วจ่าย 2,000 ผูกใบแรก → ไม่มี payable; จ่ายเพิ่ม 500 → creditBalance=500.
- [ ] เขียน tests: expense 1,000 ในรอบ May25, income 100 วันที่ Jun1 ผูก May25 → ค้าง 900; เครดิตเต็ม/เกิน, openingBalance บวก, late legacy payment ไม่มี statementId และ transfer เข้าบัตรต้องไม่ทำเงินหาย.
- [ ] เขียน invariant tests เปรียบเทียบ `MTLedger.compute/reconcileWallets`: sum(balanceDue)-creditBalance=-balance; future payment ไม่ allocate; discounted payment amount=1,000/cashAmount=900 ลดหนี้ 1,000; shuffled input/same-day tie ให้ผลเหมือนเดิม; invalid amount/reference diagnostic.
- [ ] Run `node --test tests/credit_card_cycles.test.js tests/credit_billing_allocation.test.js` → ต้องพบ failure ใหม่ตรงกรณี bug ก่อนแก้.
- [ ] Implement replay/credit carry ตาม spec; normalize cents/date validation; รวม card-relevant Ledger debit/credit ทุกชนิด; history ใช้ผล engine เดียว ไม่คำนวณ allocation ซ้ำแยกต่อ statement.
- [ ] Run command เดิม + `node --test tests/ledger.test.js tests/shared_reimbursement.test.js` → ทุกข้อผ่าน; ตรวจ consumer ของ purchaseTotal ก่อนแก้ expectation.
- [ ] Commit `fix: reconcile credit billing allocations with ledger`.

### Task 2: Anchor คงที่และ migration แบบไม่สูญข้อมูล (finding 1)

**Files:** Modify `credit_card_cycles.js`, hydration/`saveWallet`/import adapters ใน `app_v2.js`; Create `tests/credit_billing_migration.test.js`; Modify storage/auth/rescue เฉพาะที่จำเป็น.

**Interfaces:** `CreditCardCycles.prepareBillingMigration({wallets,transactions,refDate}) -> {wallets,changed,diagnostics}` เป็น pure candidate; `App.ensureCreditBillingMetadata({reason}) -> boolean` persist/rollback; fields `wallet.ccBilling` ตาม spec §1.

- [ ] Tests anchor จาก statement reference/earliest activity/no transactions, positive baseline, idempotent migration และ original transactions byte-for-byte unchanged.
- [ ] Tests หลัง reload/refDate เปลี่ยน 3 เดือน anchor/dueDate คงเดิม; edit cycleDay แล้ว closed period ID/dueDate ไม่เปลี่ยน; invalid metadata ถูกซ่อมโดยไม่กระทบยอด.
- [ ] Tests State Commit fail → state และ durable migration flag ไม่เปลี่ยน; backup/export/import replace/import merge/vault merge/rescue รักษา nested metadata; import legacy ไม่มี metadata migrate ครั้งเดียว.
- [ ] Run `node --test tests/credit_billing_migration.test.js tests/storage_schema.test.js tests/auth_sync_security.test.js tests/state_commit.test.js` → ยืนยัน failure ใหม่.
- [ ] Implement candidate migration หลัง storage hydrated และก่อน consumer/render; ใช้ atomic State Commit; run migration หลัง import/cloud hydrate ด้วย; existing snapshots ให้แก้เฉพาะ wallets metadata ไม่มี synthetic payment/expense.
- [ ] Run command เดิม + allocation suite → PASS; เปิด dump ของ fixture ยืนยันจำนวน/ยอด transaction เท่าเดิม.
- [ ] Commit `fix: preserve credit billing baseline across cycles and imports`.

### Task 3: หน้าชำระและ Statement Credit ใช้รอบที่ถูกต้อง (findings 2–3)

**Files:** Modify `App.openCCPay`, `saveCCPay`, preview helpers, `recordActualRewards` ใน `app_v2.js`; Create `tests/credit_payment_flow.test.js`; CSS เฉพาะ sheet นี้ถ้าจำเป็น.

**Interfaces:** `App.openCCPay(cardId, editingTxId='', statementId='')`; preview อ่าน allocations จาก candidate engine state; Transaction ยังคง `{amount,cashAmount,discountAmount,statementId}` เดิม.

- [ ] DOM-adapter tests สร้าง/แก้ไข payment: เลือกรอบถูกต้อง, ไม่มี closed due ให้ prepay open debit, overpay preview มี carry credit, default/chip เต็มจำนวนสัมพันธ์กับรอบที่เลือก.
- [ ] Tests payment edit เปลี่ยนเงินต้นทาง/ส่วนลด ไม่ทำยอด allocated เกิน amount; save fail rollback; future tx edit ไม่บวกเงินที่ยังไม่เคยตัดกลับเป็น availableSourceBalance.
- [ ] Tests Statement Credit วันที่หลังตัดรอบ reference เดิมลด balanceDue; draft cashback ก่อน persist failure ไม่เหลือ Transaction/Reward Ledger ครึ่งเดียว.
- [ ] Run `node --test tests/credit_payment_flow.test.js tests/p1_regressions.test.js` → failure ใหม่ตรง flow.
- [ ] Implement selector/preview และ persist validation; ไม่สร้าง allocations ใน transactions; รักษา explicit ID ตอน edit, fallback diagnostic กรณีอ้างผิด; เพิ่ม preview “เครดิตล่วงหน้า” แทนเรียกทุกยอดว่า “ยอดค้างชำระ”.
- [ ] Run targeted tests + browser QA sheet light/dark/mobile → PASS.
- [ ] Commit เฉพาะหน้าชำระ `fix: support credit prepayment and multi-statement settlement`.

### Task 4: Dashboard เตือนยอดคงเหลือและ overdue (finding 5)

**Files:** Modify Dashboard credit alert ใน `app_v2.js`; Create `tests/credit_dashboard_alerts.test.js`.

**Interfaces:** `App.getCreditCardPayableStatements(card,refDate)` ใช้ engine; Dashboard filter ด้วย balanceDue/daysLeft เท่านั้น.

- [ ] Tests บิล 5,000 จ่าย 2,000 → alert amount=3,000; payment อนาคตไม่ซ่อน; จ่ายเต็มไม่เตือนแม้มี open spending ใหม่; overdue ต้องแสดง; หลายบิล/หลายบัตรไม่หายเพราะแสดงใบแรก.
- [ ] Run `node --test tests/credit_dashboard_alerts.test.js tests/derived_finance_correctness.test.js` → failure.
- [ ] ตัด hasPaymentForCreditDue และ recent-payment heuristic จาก decision; ใช้ closed payable <=3 วันรวม overdue; debug helper คืนยอด engine/diagnostic เดียวกัน.
- [ ] Run targeted tests; QA Dashboard light/dark/privacy-hide-money → PASS.
- [ ] Commit `fix: keep partial and overdue credit bills visible on dashboard`.

### Task 5: หน้าบัตรและสรุปเครดิตใช้ billing state กลาง

**Files:** Modify CC Detail/history/reward adapters ใน `app_v2.js`, `calculations.js`, `ai_insights.js`; Create `tests/credit_billing_consumers.test.js`.

**Interfaces:** `App.getCreditCardBillingState(card,refDate)` ส่งผล engine; `Calc.getCreditLiabilitySummary` ใช้ sum(closed balances), open cycle metrics และ committed installments แยกกัน.

- [ ] Tests openingDebt แสดงแยก purchaseTotal, closed total รวมหลายรอบ, open-cycle spending ใช้รอบเปิดจริง; future installments ไม่ปน postedDebt; reward ของรอบเดิมไม่ย้ายเมื่อมี payment ใหม่.
- [ ] Tests CC Detail transaction list รวม cc_payment ที่ `toWalletId=cardId`; เลือก history แล้วปุ่มจ่ายส่ง statementId รอบที่แสดง.
- [ ] Run `node --test tests/credit_billing_consumers.test.js tests/derived_finance_correctness.test.js` → failure.
- [ ] Implement compatibility adapters/consumers; cache เฉพาะ derived result ตาม state revision/refDate และ invalidate หลัง commit/วันเปลี่ยน; ไม่รวม baseline debt เข้า reward estimates.
- [ ] Run tests และ QA เฉพาะ CC Detail light/dark/history pager → PASS.
- [ ] Commit `fix: align credit detail and summaries with shared billing state`.

### Task 6: Pure calendar projection และ dedupe cash requirement (findings 6–7)

**Files:** Create `upcoming_obligations.js`, `tests/upcoming_obligations.test.js`; Modify integration ใน `App.getUpcomingItems`.

**Interfaces:** `MTUpcomingObligations.projectCreditObligations(options)` และ `getUpcomingCashRequirement(rows)->number`; browser global/Node export แบบ UMD ตาม spec §4.

- [ ] Tests บิลค้าง 1,000 + 2,000 ต้องมี 2 credit_due rows; due ก่อนวันนี้ยังอยู่; บิลนอก horizon ไม่อยู่.
- [ ] Tests บิล 5,000+scheduled pay 5,000 → sum cashRequired=5,000 แต่ balanceDue ยังคง 5,000; discounted cash=4,900 → total=4,900; partial planned amount=2,000/cash=1,900 → total=4,900.
- [ ] Tests schedule หลายใบ/ไม่มี statementId/overpay รวมเงินแต่ละ payment ครั้งเดียว; payment หลัง horizon ไม่ลด unplanned ใน horizon; pay หลัง due ไม่ซ่อน overdue; planned payment ใน horizon สำหรับบิลนอก horizon ยังนับ cash.
- [ ] Tests income/neutral transfer/future card purchase/goal ไม่รวมเงินสดต้องจ่าย; recurring/upcomingBills/BNPL เดิมนับตาม cashflowKind; เงิน fraction satang ไม่สะสม floating error.
- [ ] Run `node --test tests/upcoming_obligations.test.js` → failure; implement projection โดยใช้ candidate future replay แยกจาก posted engine; existing type ของแถวคงเดิม เพิ่ม cashRequired/linked metadata.
- [ ] Run tests + allocation suite → PASS; assert engine payable output ไม่เปลี่ยนเมื่อเรียก projection.
- [ ] Commit `fix: project all credit bills without double-counting planned payments`.

### Task 7: ปฏิทินและทุก consumer ใช้ cashRequired เดียวกัน

**Files:** Modify `openUpcomingScreen`/`getUpcomingItems`/`getUpcomingCashRequirement` ใน `app_v2.js`, `ai_insights.js`, `finance_intelligence.js`; Create `tests/upcoming_cash_requirement_consumers.test.js`.

**Interfaces:** `App.getUpcomingCashRequirement(rows)` delegate pure helper; credit_due rows เปิดรอบที่เลือกด้วย statementId.

- [ ] Tests Calendar/AI/Finance Intelligence ใช้ fixture เดียวให้ total=5,000 ไม่ใช่ 10,000; รวม upcoming_bill/BNPL ตาม cashflowKind และไม่บวกรายรับ/รูดบัตร; forecast month-end ไม่ sum raw amount ของแถวที่เชื่อมกัน.
- [ ] Run `node --test tests/upcoming_cash_requirement_consumers.test.js tests/finance_intelligence.test.js` → failure.
- [ ] Implement labels ค้างจริง/ตั้งชำระ/ยังไม่ตั้งและ projected cash total; แก้ type-label sum ใน Dashboard insights (~3691), AI buildPayload และ Finance Intelligence ใช้ API กลาง; ไม่เปลี่ยนหน้ารายงานออกแบบอื่น.
- [ ] Run targeted tests; QA Calendar light/dark/mobile พร้อมหลายรอบบิล/partial/overdue/hidden amounts → PASS.
- [ ] Commit `fix: unify upcoming cash totals across calendar and insights`.

### Task 8: Snapshot v2 signed days และ revision-safe transport (findings 4, 8)

**Files:** Create `notification_snapshot.js`, shared `notification_rules.ts`/`notification_snapshot_store.ts`, migration `supabase/migrations/202610020001_credit_notification_snapshot_v2.sql`; Modify snapshot Edge Function และ client buildSnapshot; Create Node/Deno tests.

**Interfaces:** `MTNotificationSnapshot.buildCreditSignals({billingStates,snapshotDate}) -> [{daysLeft}]`; `buildBillSignals({bills,snapshotDate}) -> [{daysLeft}]`; `sanitizeDaysLeft(input)` signed finite integers; `upsertSnapshotIfNewer({installId,userId,schemaVersion,revision,payload}) -> {accepted,revision}`.

- [ ] Node tests ใช้ actual dates: -10 คง -10; all payable rows; 25+ บิลไม่ถูก slice ก่อน numeric projection; invalid dueDate/NaN/Infinity ไม่กลายเป็น 0; notification payload ไม่มี title/amount/IDs.
- [ ] Deno tests signed sanitizer/UTC+Bangkok วันเปลี่ยน/snapshot schema backward compatibility; revision 12 ตามด้วย 11 → 11 ถูกปฏิเสธ; legacy payload หลัง v2 ไม่เขียนทับ; install ของคนอื่น → 403.
- [ ] Run `node --test tests/notification_snapshot.test.js tests/notification_contract.test.js`; `deno test supabase/functions/_shared/notification_snapshot_test.ts` → failure.
- [ ] Implement pure projection/date helpers; arrays dedupe numeric signalก่อน limit100; schema fields `snapshot_schema_version integer default 1`, `snapshot_revision bigint default 0`; RPC conditional update atomically. SQL SECURITY DEFINER จำกัด execute service_role, set search_path, enforce supplied owner against device row, ไม่ให้ client ข้าม Edge auth.
- [ ] ทดสอบ migration ใน local Supabase ด้วย `supabase db reset` เฉพาะ local disposable database หลังตรวจ environment; ตรวจ migration ซ้ำ/old rows preserved/RLS/RPC ACL; ห้าม reset remote.
- [ ] Run targeted Node/Deno tests → PASS; commit `fix: preserve overdue signals and reject stale notification snapshots`.

### Task 9: Server นับวันต่อเอง, catch-up, overdue mode และ delivery dedupe (findings 4, 8)

**Files:** Modify sender และ rule sync Edge Functions; shared `notification_rules.ts`; Create `notification_delivery.ts`, Deno tests, migration `supabase/migrations/202610020002_credit_notification_delivery_claim.sql`.

**Interfaces:** `evaluateNotificationRule({rule,snapshot,nowBangkok})->{shouldSend,dedupeKey,reason}`; `effectiveDaysLeft({daysLeft,snapshotDate,today})`; `deliverClaimedNotification({rule,snapshot,transport,logStore,now})`.

- [ ] Tests snapshot Jun2 daysLeft2 → Jun3 effective1 match daysBefore1 โดยไม่ต้อง snapshot วันนี้; future/invalid snapshot ไม่ส่ง; age90 ใช้ได้/age91 ไม่ใช้; non-debt triggers ยังคง same-day.
- [ ] Tests daysLeft -10 ไม่ match mode due/daysBefore0; overdue mode match<0 เท่านั้น; old rules ไม่มี mode → due; time09:00 request09:20 ยังส่ง, 08:59 ยังไม่ส่ง, ไม่มี catch-up เมื่อวันข้าม.
- [ ] Tests cron สอง instance claim keyเดียว มี senderหนึ่งตัว; sent แล้วไม่ส่งอีก; error retry ได้; pending lease120sec หมดจึง retry; log write error ไม่รายงาน success; snapshot revision เปลี่ยนก่อน send ต้องประเมินใหม่.
- [ ] Run `deno test supabase/functions/_shared/notification_rules_test.ts supabase/functions/_shared/notification_delivery_test.ts` → failure.
- [ ] Implement evaluator ดึง pure logic ออกจาก Deno.serve; generic rule body ตามเดิม; เพิ่ม `triggerConfig.mode` validation due/overdue; atomic RPC claim lease120sec, check owner/auth/cron secret เดิม; ตรวจ snapshot ล่าสุดก่อน claim/send.
- [ ] Run tests + local migration test concurrency; commit `fix: deliver credit reminders across days with safe retries`.

### Task 10: Sync หลัง commit พร้อม offline queue และ editor/status (finding 9)

**Files:** Create `notification_sync.js`, `tests/notification_sync.test.js`; Modify `notifications_v2.js`, App State Commit wiring; notification settings UI เฉพาะหน้าเดียว.

**Interfaces:** `MTNotificationSync.create({readSnapshot,transport,scopedStorage,clock,canSync,onStatus})` คืน `markDirty`, `flush`, `resume`, `dispose`; `App` adapter เพิ่ม afterCommit hook เมื่อ hydrate พร้อม.

- [ ] Tests create/edit/delete payment/credit/bill/baseline และ import/cloud merge: durable commit → enqueue; commit fail → ไม่ enqueue; ไม่เกี่ยวกับ snapshot → ไม่ส่ง; dirty financial change bypass10min TTL.
- [ ] fake-clock tests debounce1sec, request in-flight มี commitใหม่ส่งล่าสุดต่อ, stale responseไม่เคลียร์ dirtyใหม่, offline dirtyอยู่หลัง reload และ onlineกลับมาส่ง; hidden commitเก็บ dirty resumeบน visible; วันใหม่ refreshจาก timer60secเมื่อ visible.
- [ ] Tests user+install scope/sign-out abort; retryไม่ส่งข้าม user; revision counterไม่ย้อนหลังเมื่อreload; tabs serialize counter/read-write ด้วย Web Locks และ single sender โดยใช้ storage/BroadcastChannel wakeup. หาก Web Locks unavailableใช้ server revision read/CAS และ retry conflict ไม่อ้างว่า localStorage incrementเป็นatomic.
- [ ] Run `node --test tests/notification_sync.test.js tests/state_commit.test.js` → failure.
- [ ] Implement queue โดยไม่ส่ง names/amounts; signed days/ Bangkok snapshotDate จาก Task8; update LAST_SYNC เฉพาะ accepted revision; manual force/boot/online/pageshow/visibility/timer ใช้ queueเดียว; fingerprintเปลี่ยนเมื่อวันใหม่; เพิ่ม overdue selector defaultไม่เปิดเองและ status last successful sync/pending/offline.
- [ ] Run tests; integration fixture paymentจ่ายหมดหลัง snapshotแรก → uploadที่สอง creditDue=[] → evaluator cronไม่ส่ง.
- [ ] QA notification settings light/dark และ save/reload rules; commit `fix: refresh notification state after durable financial changes`.

### Task 11: End-to-end verification และ release checklist

**Files:** Create `tests/credit_billing_end_to_end.test.js`, `docs/credit-billing-verification.md`; Update `NOTIFICATIONS_SETUP.md`, `CONTEXT.md`, `release_manifest.js`, HTML cache keys/dependency order.

- [ ] Integration tests shared fixture: baseline → purchase → partial payment → cashback → full payment → month rollover; Ledger/billing/Dashboard/calendar/snapshot/evaluator ต้องให้ยอดเดียวกันทุกจุด.
- [ ] Tests same day ordering/history31/Feb leap year/year rollover, due mode fixedDay/afterCycle/holiday policyเดิม; baseline date inferred warning; imports idempotent; future installments not payableก่อนposted; signed creditBalanceไม่มีnegative payable.
- [ ] เพิ่ม scripts ใหม่ใน release coreAssets และ HTML production/demo: credit_card_cycles/upcoming_obligations/notification_snapshot/notification_sync ก่อน consumer ตาม global dependencies; bump version แล้ว run `node scripts/update-release-version.js`.
- [ ] Run `node --test tests/*.test.js` → 0 failures; `deno test supabase/functions/_shared/notification_snapshot_test.ts supabase/functions/_shared/notification_rules_test.ts supabase/functions/_shared/notification_delivery_test.ts` → 0 failures; `deno check` สำหรับ shared modules/Edge Functions ที่แก้ (ใช้ network permissionเฉพาะตรวจ official imports ตาม environment).
- [ ] Run local Supabase migration/RPC concurrency/ownership tests ด้วย fixtures; ระบุผลจริงและ environmentใน verification doc ไม่เขียนว่า Pushจริงผ่านจาก mocked transport.
- [ ] Serve `python3 -m http.server 8765`; QA production+demo, mobile360/390px, light/dark, hideMoney, reload offline PWA และ assetsครบ; จ่ายจริง1000มีส่วนลด100, partial3000, baselineข้ามรอบ, multi statements, planned cashdedupe และ inferred anchor correction.
- [ ] เขียน deployment checklist: additive migrations → Edge Functions compatible readers → clientPWA v2 → forced snapshot refresh; staging Push testไม่เปิดแอปในวันเตือน/จ่ายonlineแล้วไม่เตือนซ้ำ/latecron; ไม่เรียก deploy จนผู้ใช้สั่ง.
- [ ] Rollback checklist: retain v2 metadata/schema, revert compatible app/server behavior only; มี backupก่อนmigration; ไม่ลง clientเก่าที่ลบmetadata. หากยังไม่มี compatible rollback build ให้สร้างก่อน rollout.
- [ ] ตรวจ diff ทั้ง branch, mappingครบ9finding, ไม่มี unrelated refactor; commit `test: verify credit billing and notification lifecycle`.

## เกณฑ์เสร็จและขอบเขตการรับรอง

งานแก้โค้ดเสร็จเมื่อ tests/QA ข้างต้นผ่านจริงและ reviewครบ โดยแจ้งแยกผล Node, Deno, local database และ real Push staging. การส่ง Pushจริง/remote migration เป็นอีกขั้นของ rollout ไม่ถือว่าทำแล้วจาก unit tests.

ข้อจำกัดที่ต้องคงไว้ใน UI/docs: offline paymentยังไม่ทราบโดยserverจนsync; inferred opening due/historyที่ไม่เคยบันทึกต้องแก้ได้โดยผู้ใช้; ไม่รับประกันexactly-onceในtransport crash window. ไม่คำนวณขั้นต่ำ/ดอกเบี้ยใหม่โดยอาศัยยอดประมาณการ.
