# SDD ตอนที่ 3 — Business Logic / Database / API / Permission / State

ต่อจากตอนที่ 2 (SECTION 4–6)

---

# SECTION 7 — Business Logic

## 7.1 หลักการกลาง: Ledger เป็น Source of Truth

กติกาที่โค้ดยึดถือ (คอมเมนต์ที่ `app_v2.js` บรรทัด 5569–5573 และ `CLAUDE.md`)

> ยอดคงเหลือของกระเป๋าไม่ใช่ข้อมูลที่แก้ตรง ๆ แต่เป็นผลลัพธ์ที่คำนวณใหม่จาก openingBalance บวกกับผลรวมของทุกธุรกรรมที่ posted แล้ว

สูตร
```
กระเป๋าเงินสด/ธนาคาร/e-wallet/ออมทรัพย์/บัตรเครดิต/BNPL:
  balance = round2(openingBalance + cashFlow[walletId])

กระเป๋าลงทุน (gold / crypto / fcd):
  units   = round8(openingUnits + unitsFlow[walletId])
  balance = round2(units × unitPriceTHB)
```

`App._ledgerFlows()` (บรรทัด 5628) เป็นตัวสร้าง `{ cash, units }` โดย
1. ข้ามธุรกรรมที่ยังไม่ posted (`App._isPostedTx(tx) === false`)
2. เลือกยอดที่ใช้: ถ้าเป็น expense ใช้ `App._expectedLedgerAmountForTx(tx)` มิฉะนั้นใช้ `App.getLedgerAmountForTx(tx)`
3. ข้ามถ้าทั้งยอดและ unit เป็น 0
4. กระจายตามชนิดธุรกรรม

| ชนิด | ผลต่อ cash | ผลต่อ units |
|---|---|---|
| `income` | `+amt` ที่ `walletId` | — |
| `expense` | `-amt` ที่ `walletId` | — |
| `transfer` | `-amt` ที่ `walletId`, `+amt` ที่ `toWalletId` | — |
| `cc_payment` | `-getCCPaymentCashAmount(tx)` ที่ `walletId`, `+amt` ที่ `toWalletId` | — |
| `bnpl_payment` | `-amt` ที่ `walletId`, `+amt` ที่ `toWalletId` | — |
| `investment_buy` | `-amt` ที่ `cashWalletId || sourceWalletId` | `+units` ที่ `walletId` |
| `investment_sell` | `+amt` ที่ `cashWalletId || sourceWalletId` | `-|units|` ที่ `walletId` |
| `investment_adjust` | — | `+unitsDelta || units` ที่ `walletId` |

`loans_v2.js` ห่อฟังก์ชันนี้เพิ่ม
```
_addLoanFlows(result):
  ทุก loan:  cash[loan.walletId] -= loan.amount
  ทุก repayment: cash[rep.walletId] += rep.amount
```
ข้อสำคัญที่ระบุใน `CLAUDE.md` — `bnpl.js` ห้ามทำแบบเดียวกัน ต้องเพิ่ม `bnpl_payment` เข้าไปในตัว `_ledgerFlows` เดิมโดยตรง
(และในโค้ดจริงก็ทำเช่นนั้น — บรรทัด 5652)

กับดักที่โค้ดเตือนไว้ — `App._computeWalletFlows` (บรรทัด 5248) ไม่ใช่ฟังก์ชันเดียวกับ `_ledgerFlows`
แต่จะ delegate ไปทันทีถ้ามี `_ledgerFlows` อยู่ ตรรกะที่เขียนไว้ในตัวมันเองเป็น fallback ที่ตายแล้วในทางปฏิบัติ

## 7.2 Posted vs Scheduled

```
App._isPostedTx(tx):
   ถ้า tx.scheduled !== true  → posted เสมอ (เข้ากันได้กับข้อมูลเก่าที่ไม่มีฟิลด์นี้)
   ถ้า tx.scheduled === true  → posted ก็ต่อเมื่อ tx.date <= วันนี้
```
ผลกระทบ
- งวดผ่อนในอนาคตไม่ลดยอดกระเป๋า/ไม่เพิ่มหนี้บัตรวันนี้
- แต่พอถึงวัน งวดนั้นจะ posted อัตโนมัติโดยไม่ต้องมีใครมาแก้ข้อมูล
- `Calc.isPostedTx` ใน `calculations.js` มีตรรกะเดียวกัน (ซ้ำซ้อนกัน 2 ที่)
- `App._getUnpostedInstallmentDebt(cardId)` รวมยอดงวดที่ยังไม่ posted ไว้หักวงเงินคงเหลือ

## 7.3 ledgerAmount กับ amount — สองยอดที่ไม่เท่ากัน

- `amount` = ยอดที่จ่ายออกไปจริงจากกระเป๋า
- `ledgerAmount` = ยอดที่ควรนับเป็น "รายจ่ายของเรา" ในรายงาน

กติกาการกำหนดใน `cleanTxFromDraft` (บรรทัด 6005–6014)
```
ถ้า expense และมี splitBillId:
    sharedExpense = null
    ledgerAmount  = max(0, splitBillOwnerShare ?? amount)
ถ้า expense และ sharedExpense.enabled:
    sharedExpense = ค่าที่ normalize แล้ว
    ledgerAmount  = sharedExpense.myShare
มิฉะนั้น:
    sharedExpense = null
    ถ้า expense: ledgerAmount = App.getLedgerAmountForTx(tx)
```

`App.getLedgerAmountForTx(tx)` (บรรทัด 5580)
```
ถ้ามี ledgerAmount ที่เป็นตัวเลข finite อยู่แล้ว → คืนค่านั้น (round2)
ถ้าไม่ใช่ expense → คืน amount
ถ้ากระเป๋าไม่ใช่ credit → คืน amount
ถ้ามี instantDiscountAmount > 0 → คืน amount (เพราะ amount ถูกลดไปแล้ว)
คำนวณ discount จาก rewardEstimate
   ถ้า discount <= 0 → คืน amount
   มิฉะนั้น → คืน max(0, amount - discount)
```

`App._expectedLedgerAmountForTx` มีตรรกะเหมือนกันทุกประการ ต่างกันแค่ไม่อ่านค่า `ledgerAmount` ที่เก็บไว้
ใช้สำหรับตรวจสอบว่าค่าที่เก็บไว้ยัง "ถูกต้อง" อยู่ไหม (ใช้ใน `_repairInstallmentLedgerAmounts`)

## 7.4 การบันทึกรายการ (saveTx) — ลำดับเต็ม

```
App.saveTx()
 1. เก็บชุด id เดิมของ transactions และ recurring ไว้เปรียบเทียบทีหลัง
 2. isEdit = (S.txMode === 'edit' && S.editingTxId)
 3. สร้าง draft จาก S.tx (แปลง amount เป็นตัวเลข)
 4. ถ้า draft.isRecurring → เติมค่า recurrence จาก S.tx
 5. validateTransactionDraft(draft, {isEdit, editingTxId})
       ไม่ผ่าน → toast(error) → return
 6. ถ้าเป็น income ที่รับคืน และยอดเกินยอดค้าง + 0.005 และยังไม่ยืนยัน
       → ตั้ง allowOverReimbursement = true → toast เตือน → return
 7. ถ้าเป็นการผ่อน (ไม่ใช่ edit, expense, isInstallment, months >= 2)
       สำหรับ i = 0..months-1:
          amount = (i คือตัวสุดท้าย) ? round2(total - allocated) : floor2(total/months)
          tx = cleanTxFromDraft(newId)
          ตั้ง date = addMonths(baseDate, i), installmentGroupId, installmentNo, installmentMonths,
              installmentTotalAmount, scheduled = (date > today)
          ลบ benefitBaseAmount / instantDiscountAmount / rewardEstimate ที่ติดมาจาก draft
          ตรวจ getBenefitCycleShiftOption แล้วลบ benefitDateOverride ถ้าไม่ตรง
          คำนวณ rewardEstimate ใหม่ต่อแถว
          _applyInstantDiscountToTx(tx, amount)
          ลบแล้วคำนวณ ledgerAmount ใหม่ต่อแถว
       unshift ทุกแถวเข้าหัว array
       _registerMerchantFromTx(txs[0])
       refreshTransactionRewardEstimates()
       recalculateWalletBalances({save:false, recordSnapshot:true})
       persist(); ปิด overlay; showPage('transactions'); toast; return
 8. tx = cleanTxFromDraft(isEdit ? editingTxId : newId)
 9. isEdit ? แทนที่แถวเดิมด้วย {...เดิม, ...tx} : unshift
10. ถ้าเป็นการรับคืน → _syncSharedExpenseSettlement(parentId)
    ถ้าแก้ไขแล้วเปลี่ยน parent → sync parent เดิมด้วย
11. ถ้ามี splitBillId → linkSplitBillToTransaction()
12. _registerMerchantFromTx(tx); refreshTransactionRewardEstimates()
13. ถ้าเป็น expense ใหม่บนกระเป๋า bnpl และงวด >= 2 → BNPL.store.createPlan()
14. recalculateWalletBalances({save:false, recordSnapshot:true})
15. persist()
16. ปิด overlay; isEdit ? render() : showPage('transactions'); toast
17. รีเซ็ต S.txMode = 'add', S.editingTxId = null
18. ถ้าเป็นการเพิ่มใหม่ + isRecurring + expense
       _createRecurringFromDraft() แล้วผูก metadata กลับเข้า tx
       (sourceRecurringId, recurringDueDate, recurringOccurrenceNo, recurringInstanceKey)
       updateRecurringNext(); persist() อีกครั้ง
```

## 7.5 การคำนวณสถิติรายเดือน

`Calc.getMonthlyIncomeExpense(transactions, month)` (calculations.js บรรทัด 235)
```
กรองเฉพาะ tx ที่ date ขึ้นต้นด้วย month และ isPostedTx
สะสม:
  income              += amount        (เฉพาะ income ที่ไม่ใช่ reimbursement)
  reimbursementInflow += amount        (income ที่เป็น reimbursement)
  expense             += getExpenseLedgerAmount(t)
  transfer            += amount
  ccPayment           += getCCPaymentCashAmount(t)
  bnplPayment         += amount
คำนวณ:
  netCashflow     = income - expense
  cashNetCashflow = income + reimbursementInflow - expense
  savingsRate     = income > 0 ? (netCashflow / income) × 100 : null
ปัดทุกค่าเป็น 2 ตำแหน่ง (savingsRate ปัด 1 ตำแหน่ง)
```

จุดสำคัญเชิงธุรกิจ
- เงินที่เพื่อนโอนคืนไม่ถูกนับเป็นรายได้ (ไม่ทำให้ savings rate ดูดีเกินจริง) แต่ยังนับในกระแสเงินสด (`cashNetCashflow`)
- `savingsRate` คืน `null` เมื่อไม่มีรายรับ ต่างจาก `Calc.getMonthlyStats` ที่คืน 0 — สองฟังก์ชันนี้มีพฤติกรรมต่างกัน

## 7.6 การจำแนกสินทรัพย์และหนี้สิน

`Calc.getAssetBreakdown(wallets, {cryptoTotal})` (บรรทัด 366)
```
ข้ามกระเป๋าที่ hiddenFromWalletList
cash        += max(0, balance)   สำหรับ type ∈ {cash, bank, ewallet, saving}
gold        += max(0, balance)   สำหรับ type = gold
fcd         += max(0, balance)   สำหรับ type = fcd
liabilities += |min(0, balance)| สำหรับ type ∈ {credit, bnpl}
investment  += max(0, balance)   สำหรับ type อื่นทั้งหมดที่ไม่ใช่ crypto
crypto       = max(0, cryptoTotal)   (ส่งเข้ามาจาก getCryptoPortfolioSummary)
assets   = cash + investment + gold + fcd + crypto
netWorth = assets - liabilities
```
ข้อสังเกต — ยอดติดลบของกระเป๋าเงินสด/ธนาคารถูกตัดทิ้ง (`max(0, ...)`) ไม่ถูกนับเป็นหนี้สิน

`Calc.getNetWorth(wallets)` ใช้กติกาต่างออกไป — บวกทุก balance >= 0 เป็นสินทรัพย์ และทุก balance < 0 เป็นหนี้
ไม่กรอง `hiddenFromWalletList` และไม่รวม crypto จาก portfolio (ดู SECTION 15)

## 7.7 เงินพร้อมใช้และการกันยอด

```
getSpendableCashWallets(state)  = กระเป๋า type ∈ {bank, cash, ewallet, saving} ที่ไม่ถูกซ่อน
getTotalActualSpendableCash     = ผลรวม balance ของกระเป๋าข้างต้น
getPendingUpcomingBills         = upcomingBills ที่ status === 'pending'
getUpcomingReservedTotal        = ผลรวม amount ของบิลที่ค้าง
getTotalAvailableCash           = getTotalActualSpendableCash - getUpcomingReservedTotal
getWalletAvailableBalance(w)    = ถ้าเป็นกระเป๋าใช้จ่ายได้ → balance - บิลที่ผูกกับกระเป๋านี้
                                  มิฉะนั้น → balance
```
แนวคิด — "เงินในบัญชี" กับ "เงินที่ใช้ได้จริง" ต่างกัน เพราะบิลที่รู้แล้วว่าต้องจ่ายถือว่าถูกจองไว้แล้ว

## 7.8 คะแนนสุขภาพการเงิน (Dashboard)

`app_v2.js` บรรทัด 4420–4450
```
ถ้า income <= 0 และ expense <= 0 → คืน null (ไม่แสดง)

องค์ประกอบที่ 1: อัตราการออม (น้ำหนัก 50%)
  savingsRate  = income > 0 ? (income - expense) / income : -1
  savingsScore = savingsRate <= 0 ? 0 : min(1, savingsRate / 0.20) × 100
  (ออม 20% ขึ้นไป = เต็ม 100 ตามกฎ 50/30/20)

องค์ประกอบที่ 2: ภาระหนี้ (น้ำหนัก 30%)
  debtScore = creditDebt <= 0 ? 100
            : liquid <= 0     ? 0
            : max(0, 1 - creditDebt / max(creditDebt + liquid, 1)) × 100

องค์ประกอบที่ 3: เงินสำรองฉุกเฉิน (น้ำหนัก 20%)
  bufferScore = (monthlyExpense <= 0 หรือ liquid <= 0)
                  ? (liquid > 0 ? 100 : 0)
                  : min(1, liquid / (3 × monthlyExpense)) × 100
  (มีเงินสำรอง 3 เท่าของรายจ่ายเดือน = เต็ม 100)

raw   = savingsScore×0.5 + debtScore×0.3 + bufferScore×0.2
คะแนน = clamp(round(raw), 0, 100)
เก็บรายละเอียดไว้ที่ S._lastHealthyBreakdown เพื่อให้ App._showHealthyBreakdown แสดงที่มาได้
```

## 7.9 รอบบิลบัตรเครดิต

`getStatementPeriod(card, refDate, {includeOpen})`
```
cycleDay = clamp(card.cycleDay || 25, 1, 31)
end = วันที่ cycleDay ของเดือนอ้างอิง (clamp ตามจำนวนวันจริงของเดือน)

ถ้า includeOpen === true และ วันปัจจุบัน > cycleDay:
     end = cycleDay ของเดือนถัดไป      (คือรอบที่ยังเปิดอยู่)
ถ้า includeOpen !== true และ วันปัจจุบัน <= cycleDay:
     end = cycleDay ของเดือนก่อนหน้า   (คือรอบที่ปิดแล้ว)

start = วันถัดจาก cycleDay ของเดือนก่อน end
```

`resolveDueDate(card, statementEnd)`
```
โหมด 'fixedDay':
   fixedDay = clamp(card.fixedDueDay || card.dueDay || 23, 1, 31)
   monthOffset = (fixedDay <= cycleDay) ? 1 : 0
   raw = วันที่ fixedDay ของเดือน (end + monthOffset)
   ถ้า holidayShiftEnabled === false → คืน raw
   มิฉะนั้น shiftBackwardsToBusinessDay(raw, {customHolidays, includeDefaultHolidays})
       → ถอยหลังทีละวันจนกว่าจะไม่ใช่เสาร์/อาทิตย์/วันหยุด (สูงสุด 20 รอบ)
โหมด 'afterCycle' (ค่าเริ่มต้น):
   คืน statementEnd + clamp(card.dueAfterCycleDays || 10, 1, 60)
```

`getCardStatement`
```
purchases = tx ที่ type='expense', walletId = card.id, date อยู่ใน [start, end], และ posted
payments  = tx ที่ type='cc_payment', toWalletId = card.id, และ
              (statementId ตรงกับ id ของรอบนี้) หรือ (date > end และ date <= dueDate)
purchaseTotal = round2(ผลรวม amountForTx(purchase))
paidTotal     = round2(ผลรวม amount(payment))
balanceDue    = max(0, round2(purchaseTotal - paidTotal))
paid          = (balanceDue <= 0 และ purchaseTotal > 0)
reward        = ผลรวม points (floor), cashback (round2), discount (round2) ของทุก purchase
id            = "{cardId}:{start}:{end}"
```

การรับรู้ว่า "จ่ายแล้ว" บนแดชบอร์ด (`hasPaymentForCreditDue` บรรทัด 4234) มีตรรกะพิเศษ 2 ชั้น
1. ถ้ามีวันครบกำหนดและมีฟังก์ชัน `getCardStatement` — ไล่ย้อนรอบสูงสุด 3 รอบ หา statement ที่ `dueDate` ตรงกัน
   แล้วเช็ค `paidTotal > 0` หรือมีการชำระในหน้าต่างของรอบนั้น
2. ถ้าไม่ได้ — fallback `hasRecentPayment()` = มี cc_payment ในช่วง (วันนี้ - 3 วัน) ถึง (dueDate หรือวันนี้)

การแสดง alert บนแดชบอร์ด
```
alertCards = บัตรที่มองเห็นได้ ที่มี used > 0 และ daysLeft >= 0 และยังไม่พบการชำระ
             เรียงตาม daysLeft น้อย → มาก
CREDIT_ALERT_DAYS = 3
แสดงเฉพาะเมื่อ minDaysLeft อยู่ในช่วง [0, 3]
และแสดงเฉพาะบัตรที่ daysLeft เท่ากับ minDaysLeft เท่านั้น (ไม่แสดงทุกใบพร้อมกัน)
```

## 7.10 สิทธิประโยชน์บัตรเครดิต

ลำดับการทำงานเมื่อบันทึกรายจ่ายบนบัตรเครดิต
```
cleanTxFromDraft()
 ├─ useRewardRules = (wallet.type === 'credit' และ tx.type === 'expense')
 ├─ ถ้าผู้ใช้ยังไม่แตะตัวเลือกเอง (rewardRulesTouched !== true)
 │     rewardRuleIds = App.getOptimalBenefitSelection(rewardDraft).selectedRuleIds
 ├─ กรองกฎที่ fullyUsed ออก (จาก App.getSuggestedBenefitRules)
 ├─ App._rewardEstimateForTx(tx)
 │     ├─ ถ้ามี rewardRuleIds → App.calculateSelectedRewardEstimate(rewardTx, ids)
 │     │      → decorateRewardEstimateValues(cardId, estimate)
 │     │      → _slimRewardEstimate(...)   ย่อเหลือ 12 ฟิลด์ต่อกฎ
 │     └─ ถ้าไม่มี → ใช้ระบบเก่า Calc.getCardRewards(benefit)
 └─ App._applyInstantDiscountToTx(tx, grossAmount)
       ถ้า discount > 0:
          benefitBaseAmount    = gross
          instantDiscountAmount = discount
          amount               = max(0, gross - discount)
       มิฉะนั้นลบทั้งสองฟิลด์ทิ้ง
```

`App.getBenefitCalculationAmount(tx)` — ใช้ `benefitBaseAmount` ถ้ามีและมากกว่า 0 มิฉะนั้นใช้ `amount`
เพื่อให้การคำนวณสิทธิประโยชน์อ้างอิงยอด "ก่อนหักส่วนลด" เสมอ

`App._slimRewardEstimate` เก็บเฉพาะฟิลด์เหล่านี้ต่อกฎ
`ruleId, ruleName, type, eligibleAmount, cashback, finalCashback, discount, finalDiscount, points, finalPoints, triggerCount, capApplied, rewardPending`
และระดับบนสุด `cashback, discount, points, potentialCashback, potentialDiscount, potentialPoints, rewardPending, source, status, calculatedAt, rules`
เหตุผลที่คอมเมนต์ระบุ — `applyBenefitRule` คืนราว 50 ฟิลด์ต่อกฎ ทำให้กิน localStorage ประมาณ 1.8KB ต่อธุรกรรม

## 7.11 การหารบิลและค่าใช้จ่ายร่วม

`normalizeSharedExpenseDraft(draft)` (บรรทัด 5789)
```
เงื่อนไขเปิดใช้: draft.type === 'expense' และ raw.enabled === true
                และ draft.isInstallment !== true และ amount > 0
   (ผ่อนกับค่าใช้จ่ายร่วมใช้ร่วมกันไม่ได้)
peopleCount  = clamp(round(raw.peopleCount || 2), 1, 99)
equalShare   = peopleCount > 1 ? round2(amount / peopleCount) : 0
myShare      = ถ้าระบุเอง → clamp(rawMyShare, 0, amount)
               ถ้าไม่ระบุ → equalShare
mode         = |myShare - equalShare| > 0.005 ? 'custom' : 'equal'
reimbursable = round2(max(0, amount - myShare))
status       = 'settled' | 'partial' | 'pending'
```

`App.getSharedReceivableForTx(txId)` (บรรทัด 5851) แยก 3 กรณี
1. `splitBillId` มีค่า → source = `split_bill`
   - อ่านสถานะการผูกจาก `getSplitBillLinkStateByTxId` เพื่อได้ `paidAmount`, `shareAmount`, `reimbursableAmount`, `ownerId`
   - ถ้าสถานะไม่ใช่ `linked` หรือ `mismatch` จะเก็บเป็น warning
   - ดึงรายการโอนจาก `SplitBillCalc.calcResult(bill).transfers` แล้วคำนวณสถานะรายคน
2. `sharedExpense.enabled` → source = `quick` ใช้ `myShare` และ `reimbursableAmount`
3. ไม่เข้าทั้งคู่ → คืน `null`

การจำแนกสถานะ (threshold 0.005 บาท)
```
received > expected + 0.005      → 'over_reimbursed'
remaining <= 0.005               → 'settled'
received > 0                     → 'partial'
มิฉะนั้น                          → 'pending'
```

`App.isReimbursementTx(tx)` เป็นจริงเมื่อเข้าเงื่อนไขใดเงื่อนไขหนึ่ง
`reimbursesSharedExpenseTxId` มีค่า, `incomeTreatment === 'reimbursement'`,
`reimbursementSource === 'quick_shared'`, หรือ `reimbursementSource === 'split_bill'`
(`Calc.isReimbursementTx` มีตรรกะเดียวกันซ้ำอีกที่หนึ่ง)

## 7.12 การแบ่งเงินระดับสตางค์ (Split Bill)

`allocateCents(ids, weights, totalAmount)` — แบ่งยอดตามน้ำหนักโดยรับประกันว่าผลรวมของทุกส่วนเท่ากับยอดรวมพอดี
ไม่มีเศษหายหรือเกินจากการปัดเศษ ซึ่งเป็นปัญหาคลาสสิกของการหารบิล

`runPipeline(subtotal, pipeline, rounding)` — ประมวลผลค่าบริการ/ภาษี/ส่วนลดตามลำดับที่ผู้ใช้กำหนด
โดยแต่ละขั้นระบุ "ฐาน" ของตัวเองได้ (คิดจาก subtotal เดิม หรือจากยอดสะสม)
ซึ่งรองรับความจริงที่ว่าร้านแต่ละร้านคิด VAT/เซอร์วิสในลำดับต่างกัน

`roundToUnit(satang, unit)` — ปัดเศษตามหน่วยที่เลือก (ขึ้น/ลง/ใกล้สุด ตาม `_sbToggleRoundingSign`)

## 7.13 BNPL

`BNPLCalc.buildSchedule(total, n, purchaseDate, payDay)`
```
unitAmt = floor((total / n) × 100) / 100
lastAmt = round((total - unitAmt × (n-1)) × 100) / 100
สำหรับงวดที่ i (0-based):
   dueDate = addMonths(purchaseDate, i+1)
   ถ้ามี payDay ในช่วง 1..28 → บังคับวันที่เป็น payDay
   amount = (i คือตัวสุดท้าย) ? lastAmt : unitAmt
```
เหตุผลที่จำกัด `payDay <= 28` — เพื่อให้มีวันนั้นในทุกเดือนรวมกุมภาพันธ์

`BNPLCalc` ตัวคำนวณวงเงิน
```
getUsedCredit(wallet)      = |min(0, wallet.balance)|
getAvailableCredit(wallet) = max(0, wallet.creditLimit + wallet.balance)
getUsagePct(wallet)        = creditLimit <= 0 ? 0 : min(100, round(used / limit × 100))
```

`BNPLStore.updatePlan` — เมื่อเปลี่ยนโครงสร้าง
```
ตรวจ newTotal > 0 และ newN >= 1  → มิฉะนั้นคืน {error:'invalid_values'}
maxPaidNo = งวดสูงสุดที่จ่ายแล้ว
ถ้า newN < maxPaidNo             → คืน {error:'installments_below_paid'}
rebuild schedule ใหม่ แล้วคงค่า paidTxId ของงวดเดิมที่จ่ายแล้ว
ถ้าทุกงวดจ่ายครบ → status = 'paid_off' มิฉะนั้น 'active'
ถ้ายอดรวมเปลี่ยน → ซิงก์ amount ของ tx ต้นทางด้วย
```

## 7.14 การให้ยืมเงิน

```
LoanStore.create(data):
   สร้าง loan { status:'outstanding', repayments:[] }
   _adjustWallet(walletId, -amount)     ← หักเงินออกจากกระเป๋าทันที
   persist()

LoanStore.addRepayment(loanId, data):
   สร้าง repayment { id, date, amount, walletId, note }
   _adjustWallet(rep.walletId, +rep.amount)
   ถ้า remaining(loan) <= 0 → status = 'settled'
   persist()

LoanStore.remaining(loan) = max(0, loan.amount - ผลรวม repayments.amount)

LoanStore.update(id, data):
   ถ้า amount หรือ walletId เปลี่ยน:
      _adjustWallet(old.walletId, +old.amount)          ← ย้อนของเดิม
      _adjustWallet(new.walletId, -new.amount)          ← ลงของใหม่
   เขียนทับ (คง repayments เดิมไว้)

LoanStore.delete(id):
   _adjustWallet(loan.walletId, +loan.amount)
   ทุก repayment: _adjustWallet(rep.walletId, -rep.amount)
   ลบออกจาก S.loans
```
หมายเหตุ — `_adjustWallet` แก้ `wallet.balance` ตรง ๆ แต่เนื่องจาก `loans_v2.js` patch `_ledgerFlows` ไว้ด้วย
การ recalc ครั้งถัดไปจึงจะได้ผลลัพธ์เดียวกัน (ไม่นับซ้ำ เพราะ recalc เขียนทับ balance ทั้งหมด)

## 7.15 Recurring — การคำนวณรอบถัดไป

```
โหมด 'days':
   nextDueDate = addDays(nextDueDate, everyDays)
โหมด 'monthly':
   วันที่ = clampDay(ปี, เดือน, recurringDayOfMonth)
   (ถ้าตั้งวันที่ 31 แต่เดือนนั้นมี 30 วัน จะใช้ 30)
durationMonths: จำกัดจำนวนรอบทั้งหมด (totalOccurrences)
```
ฟังก์ชันที่เกี่ยวข้อง — `occurrenceDate(rec, n)`, `instanceKey(recId, n, date)`, `updateRecurringNext(rec)`
`instanceKey` ทำหน้าที่กันการโพสต์รอบเดิมซ้ำ

## 7.16 ราคาสินทรัพย์

```
App._investmentUnitPriceTHB(wallet):
   หาราคาต่อหน่วยเป็นเงินบาทตามประเภท
      gold   → ราคาทองจาก S.marketPrices (jewelryBuy / barBuy)
      fcd    → อัตราแลกเปลี่ยนจาก frankfurter
      crypto → ราคาจาก CoinGecko/CoinCap แปลงเป็นบาท
   fallback → wallet.manualPrice

App._walletValueTHB(wallet)     = units × unitPrice
App._investmentValueTHB(wallet) = เช่นเดียวกัน (ชื่อซ้ำซ้อน)
```

ราคาทอง — `fetchThaiGoldViaSource` ไล่แหล่ง 5 ชั้น (รายละเอียดใน SECTION 2 F-24)
โดยทุกครั้งที่ได้ข้อมูลสำเร็จจะเขียน cache (`writeGoldCache`) และแนบ `fetchedVia` บอกว่ามาจากแหล่งไหน
cache ถือว่าสดถ้าอายุน้อยกว่า 12 ชั่วโมง (`GOLD_CACHE_FRESH_MS`)

## 7.17 การเข้ารหัส Vault

```
สร้าง vault ครั้งแรก
 1. recoveryKey = generateRecoveryKey()               (สุ่มในเครื่อง แสดงให้ผู้ใช้บันทึก)
 2. salt = randomBytes(32)
 3. passphraseKey = deriveKey(recoveryKey, salt, {iterations: 310000, hash:'SHA-256'})
       → AES-GCM 256 บิต, usages: wrapKey/unwrapKey, extractable: false
 4. dataKey = generateDataKey()                       (AES-GCM 256, extractable)
 5. {wrappedKey, iv} = wrapDataKey(dataKey, passphraseKey)   (iv 12 ไบต์)
 6. plaintext = canonicalStringify(payload)           (คีย์เรียงตัวอักษร → deterministic)
 7. ciphertext = AES-GCM encrypt(plaintext, dataKey, iv2)
 8. checksum = base64(SHA-256(plaintext))
 9. POST ขึ้น mt_user_vaults พร้อม kdf_params, schema_version, data_version, device_id

ถอดรหัส
 1. passphraseKey = deriveKey(recoveryKey, salt จากเซิร์ฟเวอร์, kdf_params จากเซิร์ฟเวอร์)
 2. dataKey = unwrapDataKey(wrapped_key, passphraseKey, wrapped_key_iv)
 3. plaintext = AES-GCM decrypt(ciphertext, dataKey, iv)
 4. ตรวจ SHA-256(plaintext) === checksum → ถ้าไม่ตรง throw 'Vault checksum mismatch'
 5. JSON.parse(plaintext)
       ถ้า parse ล้มเหลว → แทนที่ทุก ":undefined" ที่ตามด้วย , } ] ด้วย ":null" แล้ว parse ใหม่
       (การกู้คืนแบบครั้งเดียวสำหรับ vault ที่เข้ารหัสก่อนแก้บั๊ก canonicalStringify)
```

`canonicalStringify` มีความสำคัญเชิงความถูกต้อง — เรียงคีย์ก่อน serialize เพื่อให้ checksum เสถียร
และจัดการ `undefined` ให้เหมือน `JSON.stringify` (ข้ามใน object, เป็น `null` ใน array)

## 7.18 การจัดการ localStorage เต็ม

```
Storage.save(key, data, _retried = false)
 ├─ localStorage ใช้ไม่ได้ → บันทึก error + toast → คืน false
 ├─ setItem แล้ว readback เทียบ payload
 │     ├─ ไม่ตรง → บันทึก 'readback mismatch after save' → คืน false
 │     └─ ตรง → ล้าง error เดิมของคีย์นี้ → คืน true
 └─ catch (e)
      ├─ isQuotaError และยังไม่ retry และไม่ใช่คีย์ backup เอง
      │     ├─ removeItem('mt_pre_import_backup')
      │     ├─ pruneLocalBackups(1)
      │     └─ ถ้าปล่อยพื้นที่ได้ → เรียกตัวเองซ้ำด้วย _retried = true
      ├─ isQuotaError → toast('พื้นที่จัดเก็บเต็ม กรุณาส่งออกข้อมูลก่อนเพิ่มรายการใหม่')
      └─ อื่น ๆ → toast('บันทึกข้อมูลไม่สำเร็จ กรุณาส่งออกข้อมูลสำรองไว้ก่อน')
      (toast มี throttle 1200ms ผ่าน _lastStorageToastAt)
```

`Storage.saveAll(state)` เขียน 31 คีย์แล้วตรวจ 4 คีย์สำคัญด้วย `verifyState(state, ['transactions','wallets','settings','upcomingBills'])`
ถ้าคีย์ใดล้มเหลวหรือ verify ไม่ผ่าน จะคืน `false` ทั้งชุด

## 7.19 การจัดการเวลาและวันที่

- ทุกวันที่เก็บเป็นสตริง `YYYY-MM-DD` แบบ local timezone ไม่ใช่ UTC
- `_localDateStr(d)` ใน `sample-data_v2.js` ประกอบสตริงจาก `getFullYear/getMonth/getDate` โดยตรง — จงใจไม่ใช้ `toISOString()` เพื่อกันวันเพี้ยนข้ามเขตเวลา
- `getTODAY()` และ `getTHISMONTH()` เป็นฟังก์ชัน (ไม่ใช่ค่าคงที่) เพื่อให้ถูกต้องแม้เปิดแอปค้างข้ามเที่ยงคืน
- ค่าคงที่ `TODAY`, `THIS_MONTH`, `LAST_MONTH` ยังคงอยู่เพื่อความเข้ากันได้ย้อนหลัง ใช้เฉพาะ seed ข้อมูลเริ่มต้น
- ฝั่งเซิร์ฟเวอร์ใช้เวลาไทยด้วยการบวก offset ตรง ๆ (`send-custom-notification-rules` `bangkokParts()` บวก 7 ชั่วโมง)
  หรือใช้ `Intl.DateTimeFormat` timeZone `Asia/Bangkok` (`send-daily-expense-reminders` `bangkokDate()`)
- มีเทสต์ตรวจความสม่ำเสมอของปีในวันที่ (`tests/date_year_consistency_static.test.js`)

## 7.20 การป้องกัน XSS

- `App._esc(v)` escape 5 อักขระ: `& < > ' "`
- ทุก template string ที่แทรกข้อมูลผู้ใช้ควรผ่าน `esc()` ก่อน
- มีเทสต์ static ตรวจว่ามีจุดที่ลืม escape หรือไม่ (`tests/xss_escape_holes_static.test.js`)
- `storage_v2.js` ป้องกัน prototype pollution ด้วย `_stripDangerousKeys` และป้องกัน code injection โดยลบฟิลด์ `action` ของ AI insight ตอน import
- CSP ที่ `index.html` จำกัด `script-src` เป็น `'self'` + `'unsafe-inline'` + gstatic + script.google.com
  (`'unsafe-inline'` จำเป็นเพราะโค้ดใช้ `onclick=` inline ทั้งแอป)

---

# SECTION 8 — Database Analysis

ระบบมีที่เก็บข้อมูล 3 ระดับ

## 8.1 ระดับที่ 1 — localStorage (ฐานข้อมูลหลัก)

37 คีย์ตาม `storage_v2.js` `KEYS` โดย 31 คีย์ถูกเขียนใน `saveAll`

| ตัวแปรใน S | คีย์ localStorage | ชนิด | ค่าเริ่มต้น | อยู่ใน backup |
|---|---|---|---|---|
| transactions | `mt_transactions` | array | `DEFAULT_TRANSACTIONS` | ใช่ |
| wallets | `mt_wallets` | array | `DEFAULT_WALLETS` | ใช่ |
| categories | `mt_categories` | `{expense[], income[]}` | `DEFAULT_CATEGORIES` | ใช่ |
| budgets | `mt_budgets` | array | `DEFAULT_BUDGETS` | ใช่ |
| settings | `mt_settings` | object | `DEFAULT_SETTINGS` | ใช่ |
| recurring | `mt_recurring` | array | `[]` | ใช่ |
| upcomingBills | `mt_upcoming_bills` | array | `DEFAULT_UPCOMING_BILLS` | ใช่ |
| merchants | `mt_merchants` | array | `DEFAULT_MERCHANTS` | ใช่ |
| ccBenefits | `mt_cc_benefits` | object (คีย์ = walletId) | `DEFAULT_CC_BENEFITS` | ใช่ |
| ccBenefitRules | `mt_cc_benefit_rules` | array | `[]` | ใช่ |
| incomeBudgets | `mt_income_budgets` | array | `DEFAULT_INCOME_BUDGETS` | ใช่ |
| marketPrices | `mt_market_prices` | object | `{}` | ใช่ |
| rewardLedger | `mt_reward_ledger` | array | `[]` | ใช่ |
| netWorthSnapshots | `mt_net_worth_snapshots` | array | `[]` | ใช่ |
| investmentSnapshots | `mt_investment_snapshots` | array | `[]` | ใช่ |
| creditLimitGroups | `mt_credit_limit_groups` | array | `[]` | ใช่ |
| rewardAccounts | `mt_reward_accounts` | array | `DEFAULT_REWARD_ACCOUNTS` | ใช่ |
| cryptoAssets | `mt_crypto_assets` | array | `[]` | ใช่ |
| cryptoHoldings | `mt_crypto_holdings` | array | `[]` | ใช่ |
| cryptoTransactions | `mt_crypto_transactions` | array | `[]` | ใช่ |
| cryptoSyncMeta | `mt_crypto_sync_meta` | object | `{}` | ใช่ |
| goals | `mt_goals` | array | `[]` | ใช่ |
| privileges | `mt_privileges` | array | `DEFAULT_PRIVILEGES` (เฉพาะผู้ใช้ใหม่) | ใช่ |
| creditCardPromoSearches | `mt_credit_card_promo_searches` | array | `[]` | ใช่ |
| creditCardPromotions | `mt_credit_card_promotions` | array | `[]` | ใช่ |
| splitBills | `mt_split_bills` | array | `[]` | ใช่ |
| splitPeople | `mt_split_people` | array | `[]` | ใช่ |
| splitBillDraft | `mt_split_bill_draft` | object หรือ null | `null` | ใช่ |
| loans | `mt_loans` | array | `[]` | ใช่ |
| bnplPlans | `mt_bnpl_plans` | array | `[]` | ใช่ |
| migrations | `mt_migrations` | object | `{cryptoCentralizedV1:false}` | ใช่ |
| — | `mt_ai_insight_store` | object | store ว่าง | ใช่ (แต่ไม่อยู่ใน saveAll) |
| — | `mt_financial_memory` | array | `[]` | ใช่ (ไม่อยู่ใน saveAll) |
| — | `mt_monthly_financial_features` | array | `[]` | ใช่ (ไม่อยู่ใน saveAll) |
| — | `mt_financial_recommendation_feedback` | array | `[]` | ใช่ (ไม่อยู่ใน saveAll) |
| — | `mt_financial_action_log` | array | `[]` | ใช่ (ไม่อยู่ใน saveAll) |
| — | `mt_financial_life_plans` | array | `[]` | ใช่ (ไม่อยู่ใน saveAll) |

หมายเหตุสำคัญ — 6 คีย์สุดท้ายอยู่ใน `KEYS` และ `BACKUP_SCHEMA_KEYS` แต่ `Storage.init()` ไม่โหลด และ `Storage.saveAll()` ไม่เขียน
โมดูลที่เป็นเจ้าของ (`ai_insights.js`, `finance_intelligence.js`) อ่านเขียน `localStorage` ด้วยตัวเองโดยตรง

คีย์นอกระบบ `KEYS` ที่พบในโค้ด
`mt_local_backup_snapshots` (rotation 3 ชุด), `mt_pre_import_backup` (เลิกใช้ ถูกลบตอน init),
`mt_pre_migration_backup` (เลิกใช้), `mt_boot_last_log`, `mt_last_page`, `mt_onboarding`,
`mt_app_lock`, `mt_auth_sync_state`, `mt_auth_sync_device`, `mt_auth_sync_pkce_verifier`,
`mt_auth_sync_recovery_key`, `mt_auth_fresh_start`, `mt_notification_install_id`,
`mt_notification_push_sub`, `mt_notification_last_snapshot_sync`, `mt_notification_last_rules_sync`,
`mt_notification_last_rules_hash`, `MT_GOLD_LAST`, `MT_GOLD_PROXY_URL`, `MT_GOLD_AURORA_PROXY_URL`
และ sessionStorage: `mt_app_lock_session`, `mt_backup_reminded`, `mt_sw_update_reload`

## 8.2 Schema ของ Entity หลัก

### Transaction
```
{
  id: string                       (Calc.genId — base36 timestamp + random)
  type: 'income'|'expense'|'transfer'|'cc_payment'|'bnpl_payment'
        |'investment_buy'|'investment_sell'|'investment_adjust'
  amount: number                   ยอดจริงที่จ่าย (หลังหักส่วนลดทันที)
  walletId: string                 กระเป๋าต้นทาง
  toWalletId?: string              ปลายทาง (transfer, cc_payment, bnpl_payment)
  categoryId?: string
  merchant: string                 canonicalized ให้ตรงกับ S.merchants
  channel: string                  เฉพาะ expense
  note: string
  date: string                     'YYYY-MM-DD'
  scheduled?: boolean              true = ยังไม่ posted (งวดผ่อนอนาคต)
  ledgerAmount?: number            ยอดที่นับเป็นรายจ่ายของเราจริง
  benefitBaseAmount?: number       ยอดก่อนหักส่วนลดทันที
  instantDiscountAmount?: number
  rewardRuleIds: string[]
  rewardRulesTouched?: boolean
  rewardIncludePoints: boolean
  rewardIncludeCashback: boolean
  rewardEstimate?: object          slim แล้ว
  benefitDateOverride?: string
  isRecurring: boolean
  isInstallment: boolean
  installmentGroupId?: string
  installmentNo?: number
  installmentMonths?: number
  installmentTotalAmount?: number
  sourceRecurringId?: string
  recurringDueDate?: string
  recurringOccurrenceNo?: number
  recurringInstanceKey?: string
  statementId?: string             เฉพาะ cc_payment ('cardId:start:end')
  cashAmount?: number              เฉพาะ cc_payment ที่มีส่วนลด
  discountAmount?: number
  discountSource?: string          เช่น 'platform'
  sharedExpense: object|null
  splitBillId?: string
  splitBillOwnerPersonId?: string
  reimbursesSharedExpenseTxId?: string
  reimbursementSource?: 'quick_shared'|'split_bill'
  reimbursementSplitBillId?: string
  incomeTreatment?: 'reimbursement'
  fromSplitPersonId?: string
  toSplitPersonId?: string
  reimbursementStatus?: string
  reimbursedAmount?: number
  remainingReimbursableAmount?: number
  bnplPlanId?: string              เฉพาะ bnpl_payment
  bnplInstallmentNo?: number
  bnplPayoffAll?: boolean
  units?: number                   เฉพาะ investment_*
  unitsDelta?: number
  cashWalletId?: string
  sourceWalletId?: string
  isRewardReceived?: boolean
}
```

### Wallet
```
{
  id, name, type, icon, color, balance
  type ∈ 'bank'|'cash'|'ewallet'|'saving'|'credit'|'bnpl'|'gold'|'crypto'|'fcd'
  openingBalance?: number          baseline สำหรับ ledger
  openingUnits?: number            baseline สำหรับกระเป๋าลงทุน
  units?: number
  symbol?: string                  'XAU','BTC','USD',...
  currency?: string                เฉพาะ fcd
  manualPrice?: number
  archived?: boolean
  hiddenFromWalletList?: boolean
  // เฉพาะบัตรเครดิต
  limit?: number
  cycleDay?: number                วันตัดรอบ 1–31
  dueDay?: number
  dueAfterCycleDays?: number       1–60
  dueDateMode?: 'afterCycle'|'fixedDay'
  fixedDueDay?: number             1–31
  holidayShiftEnabled?: boolean
  customHolidays?: string[]
  includeDefaultHolidays?: boolean
  issuer?: string
  creditLimitMode?: 'individual'|'shared'
  creditLimitGroupId?: string
  rewardAccountId?: string
  // เฉพาะ BNPL
  creditLimit?: number
  payDay?: number                  1–28
  provider?: string
}
```

### BNPL Plan
```
{
  id: 'bnpl_...'
  walletId, txId, merchant, purchaseDate
  totalAmount: number
  installments: number
  interestRate: 0                  (คงที่ ไม่มี UI ให้แก้)
  schedule: [{ no, dueDate, amount, paidTxId: string|null }]
  status: 'active'|'paid_off'
  createdAt: ISO string
}
```

### Loan
```
{
  id: 'loan_...'
  borrowerName, borrowerContact, amount, walletId, date, dueDate, note
  status: 'outstanding'|'settled'
  repayments: [{ id:'rep_...', date, amount, walletId, note }]
  createdAt: ISO string
}
```

### Upcoming Bill
```
{
  id, title, amount
  amountType: 'fixed'|'estimated'
  dueDate, categoryId, walletId, merchantId, merchant
  status: 'pending'|...            (โค้ดเช็คเฉพาะ 'pending')
  reminderDaysBefore: number[]     เช่น [7,3,1]
  note, source
  createdAt, updatedAt, paidAt
  transactionId: string|null       ผูกกับ tx ที่สร้างตอนจ่าย
}
```

### Privilege
```
{
  id, title
  source: 'shopee'|'line'|'lazada'|'brand'|'credit_card'|...
  type: 'discount_code'|'voucher'|'free_item'|'cashback'
  code, description, expiryDate
  quantity, usedQuantity
  estimatedValue, actualSavedAmount
  usedAt: string|null
  note, createdAt, updatedAt
  status?: 'active'|'archived'
}
```

### Reward Account
```
{
  id, name, issuer
  type: 'points'|...
  openingBalance: number
  pointsValue: { avgPoints, avgBaht }
  createdAt, updatedAt
}
```

### AI Insight Store
```
{
  version: 2
  lastRefreshed: ISO string|null
  payloadHash: string
  insights: [{
    id, type, key, title, body, severity, urgency, impact, evidence,
    state: 'active'|'dismissed'|'snoozed'|'acted'
    seenCount, lastSeenAt, dismissedAt, snoozedUntil, actedAt, userRating
    action?: object                (ถูกลบทิ้งเสมอตอน import)
  }]
  hiddenTypes: string[]
  feedback: [{ insightId, rating, at }]
}
```

## 8.3 Relationships (ความสัมพันธ์เชิงตรรกะ)

ระบบไม่มี foreign key จริงเพราะเป็น localStorage ทั้งหมด ความสัมพันธ์บังคับด้วยโค้ดล้วน

```
Wallet 1 ──< N Transaction            (walletId, toWalletId, cashWalletId, sourceWalletId)
Wallet 1 ──< N Recurring              (walletId)
Wallet 1 ──< N UpcomingBill           (walletId)
Wallet 1 ──< N BnplPlan               (walletId)
Wallet 1 ──< N Loan                   (walletId) + N Repayment (walletId)
Wallet N ──> 1 CreditLimitGroup       (creditLimitGroupId เมื่อ creditLimitMode='shared')
Wallet N ──> 1 RewardAccount          (rewardAccountId)
Wallet 1 ──< N CcBenefitRule          (กฎผูกกับบัตร)
Wallet 1 ──> 1 CcBenefits             (ccBenefits[walletId] — โครงสร้างเก่า)

Category 1 ──< N Transaction          (categoryId)
Category 1 ──< N Budget / IncomeBudget (categoryId)
Category 1 ──< N Recurring / UpcomingBill

Merchant 1 ──< N Transaction          (จับคู่ด้วยชื่อ ไม่ใช่ id)

Transaction 1 ──< N Transaction       (reimbursesSharedExpenseTxId — รายรับชี้กลับรายจ่ายแม่)
Transaction N ──> 1 InstallmentGroup  (installmentGroupId — เป็นกลุ่มเสมือน ไม่มีตารางแยก)
Transaction N ──> 1 Statement         (statementId — id เป็นสตริงคำนวณ ไม่มีตารางแยก)
Transaction N ──> 1 BnplPlan          (bnplPlanId) และ BnplPlan.schedule[].paidTxId ชี้กลับ (two-way)
Transaction N ──> 1 SplitBill         (splitBillId) และ SplitBill.linkedTxId ชี้กลับ (two-way)
Transaction 1 ──> 1 Recurring         (sourceRecurringId) และ Recurring.createdFromTxId ชี้กลับ
Transaction 1 ──> 1 UpcomingBill      (UpcomingBill.transactionId)

SplitBill N ──< M SplitPerson         (ผ่านรายการ item และ shares)
```

## 8.4 Constraints ที่บังคับด้วยโค้ด

| ข้อจำกัด | บังคับที่ไหน |
|---|---|
| `name` ≤ 50, `title` ≤ 100, `merchant` ≤ 100, `note` ≤ 1000, `label` ≤ 50, `icon` ≤ 10 | `FIELD_MAX` + `_fieldTooLong` |
| amount > 0 | `validateTransactionDraft`, `_validateImportPayload` |
| ยอดกระเป๋าต้องพอ (ยกเว้น credit/bnpl) | `validateTransactionDraft` |
| ไม่เกินวงเงินบัตร/BNPL | `validateTransactionDraft` |
| transfer ต้องเป็นกระเป๋าเงินสดเท่านั้น | `TRANSFERABLE_MONEY_TYPES` |
| BNPL payment ต้องจ่ายจากกระเป๋าเงินสด | `validSourceTypes` ใน bnpl.js (ตรวจ 2 ที่) |
| CC payment ต้องไม่จ่ายจากบัตรหรือ BNPL | filter ใน `openCCPay` |
| ลบกระเป๋า/หมวดหมู่ที่มีการอ้างอิงไม่ได้ | `deleteWallet`, `deleteCategory` → archive แทน |
| ลดจำนวนงวด BNPL ต่ำกว่างวดที่จ่ายแล้วไม่ได้ | `BNPLStore.updatePlan` |
| `payDay` ของ BNPL ต้องอยู่ในช่วง 1–28 | `buildSchedule` |
| `cycleDay` 1–31, `dueAfterCycleDays` 1–60, `fixedDueDay` 1–31 | `clampCycleDay`, `clampDueAfter`, `clampFixedDueDay` |
| `peopleCount` 1–99 | `normalizeSharedExpenseDraft` |
| PIN 6–12 หลัก | `MIN_PIN_LENGTH` / `MAX_PIN_LENGTH` |
| ไฟล์ backup ≤ 10MB | `Storage.importJSON` |
| `__proto__`/`constructor`/`prototype` ถูกลบตอน import | `_stripDangerousKeys` |
| local backup เก็บสูงสุด 3 ชุด | `LOCAL_BACKUP_LIMIT` |
| net worth snapshot เก็บสูงสุด 370 แถว | `recordNetWorthSnapshot` slice(-370) |
| boot log เก็บ 80 รายการล่าสุด | `MTBoot.mark` slice(-80) |

## 8.5 ระดับที่ 2 — Supabase PostgreSQL

### ตาราง `mt_user_vaults` (migration 202606040001)
```sql
user_id        uuid primary key references auth.users(id) on delete cascade
ciphertext     text not null
iv             text not null
salt           text not null
wrapped_key    text not null
wrapped_key_iv text not null
kdf_params     jsonb not null default '{"name":"PBKDF2","hash":"SHA-256","iterations":310000}'
schema_version integer not null default 3
data_version   bigint not null default 1
checksum       text not null
device_id      text
created_at     timestamptz not null default now()
updated_at     timestamptz not null default now()
```
- Index: `mt_user_vaults_user_id_idx` on `(user_id)` (ซ้ำซ้อนกับ primary key — ดู SECTION 15)
- Trigger: `mt_user_vaults_touch_updated_at` (before update)
- RLS: เปิด, `revoke all from anon`, `grant select/insert/update/delete to authenticated`
- Policy 4 ข้อ (select/insert/update/delete) ทุกข้อใช้เงื่อนไข `(select auth.uid()) = user_id`
- เซิร์ฟเวอร์เก็บเฉพาะ ciphertext ถอดรหัสไม่ได้ (zero-knowledge)

### ตาราง `mt_notification_devices` (202605140001 + 202606040002)
```sql
id           uuid primary key default gen_random_uuid()
install_id   text not null
fcm_token    text not null unique          -- ยังคงอยู่จาก migration เดิม
platform     text not null default 'unknown'
browser      text not null default 'unknown'
timezone     text not null default 'Asia/Bangkok'
permission   text not null default 'default'
enabled      boolean not null default true
app_version  text
user_agent   text
last_seen_at timestamptz not null default now()
created_at   timestamptz not null default now()
updated_at   timestamptz not null default now()
user_id      uuid references auth.users(id) on delete set null   -- เพิ่มภายหลัง
```
- Index: `mt_notification_devices_install_id_idx`, `mt_notification_devices_user_id_idx`
- RLS: เปิด, policy "Users can manage their own notification device" for all to authenticated
- หมายเหตุ — โค้ด `register-notification-device` upsert คอลัมน์ `push_subscription` แต่ไม่พบ migration ที่เพิ่มคอลัมน์นี้ (ดู SECTION 15)

### ตาราง `mt_notification_preferences`
```sql
install_id                    text primary key
daily_expense_enabled         boolean not null default true
daily_expense_time            text not null default '20:30'
upcoming_bill_enabled         boolean not null default true
credit_card_due_enabled       boolean not null default true
budget_alert_enabled          boolean not null default false
recurring_enabled             boolean not null default true
backup_reminder_enabled       boolean not null default true
monthly_summary_enabled       boolean not null default false
hide_amounts_in_notification  boolean not null default false
timezone                      text not null default 'Asia/Bangkok'
updated_at, created_at        timestamptz not null default now()
user_id                       uuid references auth.users(id) on delete set null
```

### ตาราง `mt_notification_snapshots`
```sql
install_id          text primary key
snapshot_date       date not null default current_date
today_tx_count      integer not null default 0
last_tx_date        date
upcoming_bills      jsonb not null default '[]'
credit_due          jsonb not null default '[]'
budget_alerts       jsonb not null default '[]'
recurring_due       jsonb not null default '[]'
privileges_expiring jsonb not null default '[]'   -- เพิ่มใน 202605140005
last_exported_at    timestamptz
app_version         text
updated_at, created_at
user_id             uuid references auth.users(id) on delete set null
```
เนื้อหา jsonb ถูก sanitize ให้เหลือเฉพาะ `{daysLeft:number}` หรือ `{pct:number, over:boolean}` สูงสุด 100 แถว

### ตาราง `mt_notification_rules` (202605140003)
```sql
id             uuid primary key default gen_random_uuid()
install_id     text not null
rule_id        text not null
enabled        boolean not null default true
title          text not null
body           text not null default ''
route          text not null default 'dashboard'
action_label   text not null default 'เปิดแอป'
trigger_type   text not null default 'daily_time'
trigger_config jsonb not null default '{}'
source         text not null default 'custom'
app_version    text
created_at, updated_at
user_id        uuid references auth.users(id) on delete set null
unique (install_id, rule_id)
```
- Index: `mt_notification_rules_install_enabled_idx` on `(install_id, enabled)`, `mt_notification_rules_user_id_idx`
- Trigger 1: `mt_notification_rules_touch_updated_at`
- Trigger 2: `mt_notification_rules_normalize_route_by_trigger` (202605200002) — ถ้า route ว่าง/dashboard/more จะแทนที่ด้วย route ที่เหมาะกับ trigger
  แมป: `no_transaction_today`/`no_tx_streak`→`addTx`, `upcoming_bill_due`→`upcomingBills`, `credit_card_due`→`creditCards`,
  `budget_over`→`budgets`, `recurring_due_today`→`recurring`, `privilege_expiry`→`privileges`, `backup_stale`→`more`
- migration เดียวกันยังทำ data fix ย้อนหลัง 2 ชุด

### ตาราง `mt_notification_logs`
```sql
id                uuid primary key default gen_random_uuid()
install_id        text not null
notification_type text not null
dedupe_key        text not null
title             text not null
body              text
status            text not null default 'pending'    -- 'sent' | 'error' | 'pending'
fcm_message_id    text
error             text
sent_at           timestamptz not null default now()
created_at        timestamptz not null default now()
user_id           uuid references auth.users(id) on delete set null
unique (install_id, notification_type, dedupe_key)   ← กลไก dedupe หลัก
```
- Index: `mt_notification_logs_sent_at_idx` on `(sent_at desc)`, `mt_notification_logs_user_id_idx`
- RLS policy: อ่านได้อย่างเดียวสำหรับ authenticated (เขียนโดย edge function ด้วย service_role ที่ bypass RLS)

### ตาราง `mt_delete_otps` (202606060001)
```sql
user_id    text primary key
otp_hash   text not null           -- SHA-256 ของ "{otp}:{userId}"
expires_at timestamptz not null
```
- RLS เปิดแต่ไม่มี policy เลย = เข้าถึงได้เฉพาะ service_role
- อายุ 10 นาที (`OTP_EXPIRY_MINUTES`), upsert หนึ่งแถวต่อผู้ใช้

### Function และ Trigger ร่วม
```sql
public.mt_touch_updated_at()  -- ตั้ง new.updated_at = now() ใช้กับ 5 ตาราง
```

### Scheduled Jobs (pg_cron)
| job | ตาราง cron | ยิงไปที่ |
|---|---|---|
| `mt_daily_expense_reminders` | `30 13 * * *` (UTC = 20:30 เวลาไทย) | `send-daily-expense-reminders` |
| `mt_custom_notification_rules` | `*/15 * * * *` | `send-custom-notification-rules` |

ทั้งสองใช้ `net.http_post` จาก extension `pg_net` และแนบ anon key ที่ hard-code ในไฟล์ migration

## 8.6 ระดับที่ 3 — Cache

- Service Worker Cache API — ชื่อ cache = `money-tracker-v2-{APP_VERSION}` ล้าง cache เก่าทุกครั้งที่ activate
- Gold cache — `localStorage['MT_GOLD_LAST']` = `{savedAt: epochMs, data: {...}}` สดภายใน 12 ชั่วโมง
- AI Insight cache — ใน `mt_ai_insight_store` ควบคุมด้วย `payloadHash` + TTL 4 ชั่วโมง
- Finance feature store — `mt_monthly_financial_features` มี schema version และ freshness check
- Promo search cache — CacheService ฝั่ง Apps Script
- Notification sync TTL — snapshot 10 นาที, rules 6 ชั่วโมง (+ hash guard)

## 8.7 Data Flow

```
[ผู้ใช้กรอกฟอร์ม]
      ↓
   S (in-memory)
      ↓  persist()
Storage.saveAll() → localStorage 31 คีย์ → verify readback 4 คีย์
      ↓  (ถ้าสำเร็จ)
MTAuthSync.markDirty() → debounce 2.5s
      ↓
buildExportPayload(S) → canonicalStringify → AES-GCM encrypt
      ↓
POST /rest/v1/mt_user_vaults (ciphertext เท่านั้น)

[แยกสายสำหรับแจ้งเตือน]
   S → buildSnapshot() → sanitize → POST /functions/v1/sync-notification-snapshot
   S → getCustomRules() → POST /functions/v1/sync-notification-rules
      ↓
   pg_cron → edge function → shouldSend() → sendWebPush() → mt_notification_logs
      ↓
   Service Worker push event → showNotification
      ↓
   notificationclick → postMessage → App.showPage + เปิด sub-screen
```

---

# SECTION 9 — API Documentation

## 9.0 ภาพรวม

แอปหลักไม่มี REST API ของตัวเอง — ข้อมูลทั้งหมดอยู่ในเครื่อง
API ที่มีจริงแบ่งเป็น 4 กลุ่ม
1. Supabase Auth (GoTrue) — เรียกตรงจากเบราว์เซอร์
2. Supabase REST (PostgREST) — เรียกตรงจากเบราว์เซอร์ ผ่าน RLS
3. Supabase Edge Functions — 7 endpoint
4. API ภายนอก — ราคาทอง อัตราแลกเปลี่ยน คริปโต และ AI promo search

Base URL — `window.MT_SUPABASE_URL` (ตั้งใน `notification_config.js` ที่ CI สร้างจาก secrets)

## 9.1 Supabase Auth (GoTrue)

### GET/POST `{supabaseUrl}/auth/v1/authorize`
- ใช้: `signInWithGoogle()`
- Method: redirect (browser navigation)
- Query: `provider=google`, `redirect_to`, `code_challenge`, `code_challenge_method=S256`
- Auth: anon key
- Response: redirect กลับมาที่ `MT_AUTH_REDIRECT_URL?code=...`

### POST `{supabaseUrl}/auth/v1/token?grant_type=pkce`
- ใช้: `exchangeCodeForSession(code)`
- Body: `{ auth_code, code_verifier }`
- Response: `{ access_token, refresh_token, expires_in, expires_at, user }`
- Error: 400 เมื่อ code ผิดหรือหมดอายุ

### POST `{supabaseUrl}/auth/v1/token?grant_type=refresh_token`
- ใช้: `refreshSession(refreshToken)` และ `refreshSessionWithRetry` (สูงสุด 3 ครั้ง)
- Retry logic — ถ้า `isTokenRejectedError(error)` เป็นจริง จะไม่ retry (ถือว่า token ตายแล้ว) และไป sign out

### GET `{supabaseUrl}/auth/v1/user`
- ใช้: `fetchUser(session)`
- Headers: `apikey`, `Authorization: Bearer <access_token>`
- Response: user object

### GET `{supabaseUrl}/auth/v1/reauthenticate`
- ใช้: `sendDeleteOtp()` — Supabase ส่ง OTP ไปยังอีเมลผู้ใช้
- Headers: `Authorization: Bearer <access_token>`

### POST `{supabaseUrl}/auth/v1/verify`
- ใช้: `verifyOtpAndDelete(token)`
- Body: `{ token, type: 'reauthentication' }`
- Error: 400 เมื่อ OTP ผิดหรือหมดอายุ

## 9.2 Supabase REST — ตาราง mt_user_vaults

### GET `{supabaseUrl}/rest/v1/mt_user_vaults?<query>`
- ใช้: `vaultRequest('GET')` ภายใน `pullRemoteVault()`
- Headers: `apikey`, `Authorization: Bearer <token>`, `Content-Type: application/json`
- Authorization: RLS บังคับ `auth.uid() = user_id` — ผู้ใช้เห็นได้เฉพาะแถวของตัวเอง
- Response: array ของแถว vault (0 หรือ 1 แถว)

### POST / PATCH `{supabaseUrl}/rest/v1/mt_user_vaults`
- ใช้: `createVaultFromLocalData`, `pushEncryptedVault`
- Body: `{ user_id, ciphertext, iv, salt, wrapped_key, wrapped_key_iv, kdf_params, schema_version, data_version, checksum, device_id }`
- Conflict handling — `handleRemoteConflict(remote)` เมื่อ `data_version` บนเซิร์ฟเวอร์ใหม่กว่าที่ไคลเอนต์ถือ

### DELETE `{supabaseUrl}/rest/v1/mt_user_vaults?user_id=eq.<id>`
- ใช้: `deleteVault()`

## 9.3 Supabase Edge Functions

ทุก endpoint ใช้ CORS whitelist เดียวกัน (`_shared/cors.ts`)
```
ALLOWED_ORIGINS = {
  https://boss-kung.github.io,
  http://localhost:8080, http://localhost:3000,
  http://127.0.0.1:8080, http://127.0.0.1:3000
}
ถ้า Origin ไม่อยู่ใน whitelist → ตอบด้วย 'https://boss-kung.github.io' (ทำให้ browser บล็อกเอง)
Allow-Headers: authorization, x-client-info, apikey, content-type
Allow-Methods: GET, POST, OPTIONS
Vary: Origin
```
ทุก endpoint ตอบ `OPTIONS` ด้วย 204 และปฏิเสธ method ที่ไม่รองรับด้วย 405 `{error:'Method not allowed'}`

### POST `/functions/v1/register-notification-device`
- จุดประสงค์: ลงทะเบียนอุปกรณ์รับ push
- Body
  ```
  {
    installId: string        (required)
    pushSubscription: { endpoint, keys:{p256dh, auth} } | null
    platform, browser, timezone, permission: string
    enabled: boolean
    appVersion, userAgent: string
    hideAmounts: boolean
  }
  ```
- Validation
  - `installId` ว่าง → 400 `{error:'installId is required'}`
  - `enabled !== false` แต่ไม่มี `pushSubscription.endpoint` หรือ `keys.p256dh` → 400 `{error:'pushSubscription is required when enabling notifications'}`
  - ตัดความยาว: platform/browser/timezone 64, permission 32, appVersion 80, userAgent 512
- Authentication: optional — `getAuthenticatedUserId(req)` คืน null ได้ (อุปกรณ์ที่ยังไม่ล็อกอินก็ลงทะเบียนได้)
- Authorization: ใช้ service_role (bypass RLS)
- Side effect: upsert ทั้ง `mt_notification_devices` (onConflict `install_id`) และ `mt_notification_preferences`
- Response: 200 `{ok:true}` / 500 `{error:message}`

### POST `/functions/v1/update-notification-preferences`
- Body: `{ installId, preferences:{...}, timezone }`
- Validation: `installId` required; รับเฉพาะ 8 คีย์ boolean ใน `BOOL_KEYS`; `daily_expense_time` ต้องตรง `/^\d{2}:\d{2}$/`
- Response: 200 `{ok:true}` / 400 / 500

### POST `/functions/v1/sync-notification-snapshot`
- Body: `{ installId, snapshotDate, todayTxCount, lastTxDate, upcomingBills[], creditDue[], budgetAlerts[], recurringDue[], privilegesExpiring[], lastExportedAt, appVersion }`
- Validation
  - `installId` required
  - `snapshotDate` ต้องตรง `/^\d{4}-\d{2}-\d{2}$/` มิฉะนั้นใช้วันนี้
  - `lastTxDate` ต้องตรงรูปแบบเดียวกัน มิฉะนั้นเป็น null
  - `todayTxCount` = `max(0, floor(Number(...)))`
- Privacy sanitization (จุดสำคัญ)
  - `sanitizeDaysLeft` — คงเฉพาะ `{daysLeft: max(0, floor(number))}` สูงสุด 100 รายการ
  - `sanitizeBudgetAlerts` — คงเฉพาะ `{pct: max(0, floor(number)), over: boolean}` สูงสุด 100 รายการ
  - ชื่อบิล ชื่อบัตร ยอดเงิน และ id ทั้งหมดถูกทิ้ง ไม่ถึงเซิร์ฟเวอร์
- Response: 200 `{ok:true}`

### POST `/functions/v1/sync-notification-rules`
- Body: `{ installId, rules: CustomRule[], appVersion }`
- Validation ต่อกฎ (`normalizeRule`)
  - `title` ว่าง → กฎนั้นถูกทิ้ง (คืน null)
  - `id` ตัด 80 ตัวอักษร ถ้าว่างสร้าง `crypto.randomUUID()`
  - `title` ตัด 120, `body` ตัด 240, `actionLabel` ตัด 40 (ค่าเริ่มต้น 'เปิดแอป')
  - `triggerType` ต้องอยู่ใน `VALID_TRIGGERS` (13 ค่า) มิฉะนั้นเป็น `daily_time`
  - `route` ต้องอยู่ใน `VALID_ROUTES` (12 ค่า) มิฉะนั้นใช้ default ตาม trigger
  - ถ้า route เป็น dashboard/more แต่ trigger มี default route ที่เจาะจงกว่า → ใช้ default นั้นแทน
- กลยุทธ์การเขียน: DELETE ทุกกฎของ `install_id` แล้ว INSERT ใหม่ทั้งชุด (replace ทั้งก้อน)
- Response: 200 `{ok:true, synced:number}`

### POST หรือ GET `/functions/v1/send-daily-expense-reminders`
- ผู้เรียก: pg_cron ทุกวัน 13:30 UTC
- Method: รับทั้ง GET และ POST
- Logic
  ```
  today = วันที่ตามเขต Asia/Bangkok
  dedupeKey = "daily-expense:{today}"
  ดึง devices ที่ enabled=true และ permission='granted'
  ดึง preferences ของ install_id ทั้งหมด
  ต่อ device:
     ไม่มี push_subscription.endpoint → skipped++
     preferences.daily_expense_enabled !== true → skipped++
     มี log status='sent' สำหรับ dedupeKey แล้ว → skipped++
     มิฉะนั้น sendWebPush({
        title:'อย่าลืมจดรายจ่ายวันนี้',
        body:'เปิดแอปเพื่อบันทึกหรือทบทวนรายการของคุณ',
        data:{type:'daily_expense', route:'addTx', date:today},
        actions:[{action:'addTx',title:'เพิ่มรายจ่าย'},{action:'open',title:'เปิดแอป'}]
     })
     สำเร็จ → upsert log status='sent', sent++
     ล้มเหลว → upsert log status='error' + error message, failures.push()
  ```
- Authentication: ไม่มีการตรวจ (พึ่ง anon key ที่ pg_cron แนบมา)
- Response: `{ok:true, date, sent, skipped, failures[]}`

### POST หรือ GET `/functions/v1/send-custom-notification-rules`
- ผู้เรียก: pg_cron ทุก 15 นาที
- `WINDOW_MINUTES = 15`
- Logic — ดู SECTION 4.8 (Flow การส่งจริง) และเงื่อนไข `shouldSend` แต่ละ trigger
- Payload ที่ส่ง
  ```
  { title: rule.title, body: rule.body, icon:'./assets/icon.svg', badge:'./assets/icon.svg',
    tag: dedupeKey,
    data:{ type:'custom_rule', ruleId, route, actionLabel },
    actions:[{action: route||'open', title: actionLabel}, {action:'open', title:'เปิดแอป'}] }
  ```
- Response: `{ok:true, sent, skipped, failures[]}`

### POST `/functions/v1/send-delete-otp`
- Authentication: required — `getAuthenticatedUserId(req)` ต้องไม่เป็น null มิฉะนั้น 401 `{error:'Unauthorized'}`
- Logic
  ```
  ดึงอีเมลผู้ใช้ผ่าน admin API (getUserById)
     ไม่พบ → 404 {error:'User not found'}
  otp = สุ่ม 6 หลัก (100000..999999)
  otpHash = hex(SHA-256("{otp}:{userId}"))
  upsert mt_delete_otps { user_id, otp_hash, expires_at: now + 10 นาที }
  ส่งอีเมลผ่าน Resend API (POST https://api.resend.com/emails)
     ไม่มี RESEND_API_KEY → throw 'RESEND_API_KEY not configured'
     ส่งไม่สำเร็จ → throw 'Email send failed: ...'
  ```
- Response: 200 `{ok:true}` / 401 / 404 / 500
- หมายเหตุ — ไม่พบ endpoint ที่ verify OTP นี้ และไคลเอนต์ไม่เรียกฟังก์ชันนี้ (ดู SECTION 15)

### POST `/functions/v1/delete-account`
- Authentication: required → 401 ถ้าไม่มี token ที่ใช้ได้
- Logic: `adminClient().auth.admin.deleteUser(userId)` — ลบผู้ใช้ทั้งหมด และ vault ถูกลบตาม `on delete cascade`
- Response: 200 `{ok:true}` / 401 / 405 / 500

## 9.4 การยืนยันตัวตนในฝั่ง Edge Function

`_shared/supabase.ts` `getAuthenticatedUserId(req)`
```
ไม่มี Authorization header ที่ขึ้นต้นด้วย 'Bearer ' → null
สร้าง client ด้วย anon key + ส่ง Authorization header ต่อ
เรียก auth.getUser() → คืน user.id หรือ null
catch ทุก error → null
```
คอมเมนต์ในโค้ดระบุชัดว่า edge function ควรใช้ฟังก์ชันนี้แทนการเชื่อ `body.userId` จากไคลเอนต์
ซึ่งเป็นการออกแบบที่ถูกต้อง

`adminClient()` ใช้ `SUPABASE_SERVICE_ROLE_KEY` จาก env — bypass RLS ทั้งหมด จึงต้องระวังการใช้

## 9.5 Web Push (`_shared/webpush.ts`)

```
sendWebPush(subscription, payload)
 ├─ ต้องมี VAPID_PUBLIC_KEY และ VAPID_PRIVATE_KEY มิฉะนั้น throw
 ├─ ตรวจ subscription.endpoint, keys.p256dh, keys.auth มิฉะนั้น throw 'Invalid push subscription'
 ├─ subject = origin ของ MT_APP_LINK ถ้าตั้งไว้ มิฉะนั้น 'mailto:admin@money-tracker.app'
 ├─ webpush.setVapidDetails(subject, publicKey, privateKey)
 └─ sendNotification(subscription, JSON.stringify(payload), { TTL: 86400 })
      error → throw `WebPush {statusCode}: {body}`
```

## 9.6 FCM (`_shared/fcm.ts`) — โค้ดมีอยู่แต่ไม่ถูกเรียกใช้

```
signJwt()      — สร้าง JWT RS256 จาก FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
                 scope: https://www.googleapis.com/auth/firebase.messaging
                 อายุ 1 ชั่วโมง
getAccessToken() — POST https://oauth2.googleapis.com/token ด้วย grant_type jwt-bearer
sendFcm(message) — POST https://fcm.googleapis.com/v1/projects/{FIREBASE_PROJECT_ID}/messages:send
```
ไม่มี edge function ใดใน `supabase/functions/` import `sendFcm` — ทุกตัวใช้ `sendWebPush` (ดู SECTION 15)

## 9.7 API ภายนอก

### ราคาทอง — `https://api.chnwt.dev/thai-gold-api/latest`
- Method: GET, `cache: 'no-store'`
- Response ถูก normalize ผ่าน `normaliseGoldPayload` ซึ่งรองรับหลายรูปแบบ key
  (`jewelryBuy`/`goldBuy`/`ornamentBuy`/`price`, `gold.buy`/`gold.bid`/`gold.taxBase`, `gold_bar.*` ฯลฯ)
- Fallback: JSONP ผ่าน Apps Script → r.jina.ai → allorigins → corsproxy → cache

### Apps Script Gold Proxy (`gold-proxy-appscript.js`)
- `doGet(e)` — รองรับ JSONP ผ่าน `callback` parameter
- ดึงจาก `GOLDTRADERS_URL` ก่อน (`fetchGoldTraders_`) ถ้าไม่ได้จึงใช้ `THAI_GOLD_API_URL` (`fetchThaiGoldApi_`)
- parser: `parseGoldTradersClassic_(html)` และ `parseThaiGoldApi_(json)`
- `output_(payload, callback)` — คืน JSON หรือ JSONP

### อัตราแลกเปลี่ยน — `https://api.frankfurter.dev`
- อยู่ใน CSP `connect-src` ใช้กับกระเป๋า FCD

### ราคาคริปโต — `https://api.coingecko.com` และ `https://api.coincap.io`
- ใช้ทั้งค้นหาเหรียญและดึงราคา

### AI Promo Search — Google Apps Script Web App
- Endpoint hard-code ที่ `index.html` บรรทัด 363
- `doPost(e)` รับ action แล้วแยกไป `handlePromoSearch(payload)` หรือ `handleBenefitAnalysis(payload)`
- ภายในเรียก Gemini 2 ครั้ง: grounded search (`callGeminiWithSearch`) แล้ว structured extraction (`callGeminiJsonSchema`)
- มี cache ผ่าน CacheService และโหมด mock (`getMockResults`)

### AI Promo Search — Cloudflare Worker (ทางเลือก)
- `POST /promo-search` เท่านั้น (path หรือ method อื่น → error)
- `searchOfficialPromoPages(issuer, month, mode)` → `fetchOfficialSource(url, issuer, month)` → `callAiExtractor(prompt, apiKey)`
- ตั้งค่าใน `wrangler.toml`

### CardX — `https://cdx-prod-ssc-frontend.cardx.co.th`
- อยู่ใน CSP ใช้ดึงหน้าโปรโมชันเพื่อ parse

## 9.8 สรุปสิ่งที่ไม่มีในระบบ

- ไม่มี GraphQL
- ไม่มี WebSocket / realtime subscription
- ไม่มี pagination ใน API ใด ๆ (ทุก endpoint คืนชุดเดียว)
- ไม่มี rate limiting ฝั่งแอป (มีเฉพาะ TTL/hash guard กันส่งซ้ำ)
- ไม่มี API versioning ของ edge function
- ไม่มี retry logic ใน edge function (ล้มเหลวแล้วบันทึก log เป็น error แล้วรอรอบถัดไป)
- ไม่มี idempotency key (ใช้ dedupe_key แทน)

---

# SECTION 10 — Permission Matrix

## 10.1 ข้อสรุปสำคัญ

ระบบไม่มีระบบสิทธิ์ผู้ใช้ ไม่มี role ไม่มี ACL ไม่มี multi-user
ไม่พบคำว่า role, permission, admin, หรือโครงสร้างสิทธิ์ใด ๆ ในโค้ดฝั่งแอป

เหตุผลเชิงสถาปัตยกรรม — แอปเป็น local-first single-user; ข้อมูลอยู่ในเครื่องผู้ใช้ทั้งหมด
เจ้าของอุปกรณ์คือเจ้าของข้อมูลโดยปริยาย

## 10.2 "Role" ที่มีอยู่จริงในระบบ

| ผู้กระทำ | ขอบเขต | เข้าถึงอะไรได้ |
|---|---|---|
| ผู้ใช้แอป (ที่ปลดล็อกแล้ว) | เครื่องนั้น | ทุกฟีเจอร์ ทุกหน้า ทุกข้อมูลในเครื่อง |
| ผู้ใช้แอป (ยังไม่ปลดล็อก App Lock) | เครื่องนั้น | เห็นเฉพาะจอล็อก แต่แอปบูตเบื้องหลังไปแล้ว |
| ผู้ใช้ที่ล็อกอิน Supabase (`authenticated`) | คลาวด์ | เฉพาะแถว vault ของ `auth.uid()` ตัวเอง และ notification rows ของตัวเอง |
| ผู้ใช้ที่ยังไม่ล็อกอิน (`anon`) | คลาวด์ | ถูก `revoke all` จาก `mt_user_vaults`; ยังลงทะเบียนอุปกรณ์แจ้งเตือนได้ (user_id = null) |
| Edge Function (`service_role`) | คลาวด์ | bypass RLS ทั้งหมด เขียนได้ทุกตาราง |
| pg_cron | คลาวด์ | เรียก edge function ด้วย anon key |

## 10.3 Permission Matrix ระดับหน้าจอ

| หน้าจอ / ฟีเจอร์ | ผู้ใช้ที่ปลดล็อกแล้ว | ยังไม่ปลดล็อก | ยังไม่ล็อกอินคลาวด์ |
|---|---|---|---|
| Dashboard | เต็ม | ไม่เห็น | เต็ม |
| Transactions | เต็ม | ไม่เห็น | เต็ม |
| Wallets | เต็ม | ไม่เห็น | เต็ม |
| Reports | เต็ม | ไม่เห็น | เต็ม |
| More | เต็ม | ไม่เห็น | เต็ม |
| บันทึก/แก้ไข/ลบรายการ | ได้ | ไม่ได้ | ได้ |
| Export / Import | ได้ | ไม่ได้ | ได้ |
| App Lock settings | ได้ | ได้ (เฉพาะจอปลดล็อก) | ได้ |
| ซิงก์ขึ้นคลาวด์ | ได้ | ไม่ได้ | ไม่ได้ (ต้องล็อกอินก่อน) |
| ลบบัญชีคลาวด์ | ได้ | ไม่ได้ | ไม่ได้ |
| เปิดการแจ้งเตือน | ได้ | ไม่ได้ | ได้ (user_id เป็น null) |
| โหมด Demo | ได้ | ไม่ได้ | ได้ |
| Rescue | ได้ (หน้าแยก ไม่ผ่าน App Lock) | ได้ | ได้ |

ข้อสังเกตด้านความปลอดภัย — `rescue.html` เป็นหน้าแยกที่ไม่โหลด `app_lock.js` จึงเข้าถึงและเขียน localStorage ได้โดยไม่ต้องผ่าน App Lock

## 10.4 Permission ระดับข้อมูลในคลาวด์ (RLS)

| ตาราง | anon | authenticated | service_role |
|---|---|---|---|
| `mt_user_vaults` | ถูก revoke ทั้งหมด | select/insert/update/delete เฉพาะ `auth.uid() = user_id` | เต็ม (bypass RLS) |
| `mt_notification_devices` | RLS เปิด ไม่มี policy สำหรับ anon = ปฏิเสธ | for all เฉพาะแถวของตัวเอง | เต็ม |
| `mt_notification_preferences` | เช่นเดียวกัน | for all เฉพาะแถวของตัวเอง | เต็ม |
| `mt_notification_snapshots` | เช่นเดียวกัน | for all เฉพาะแถวของตัวเอง | เต็ม |
| `mt_notification_rules` | เช่นเดียวกัน | ไม่มี policy → ปฏิเสธ (ดู SECTION 15) | เต็ม |
| `mt_notification_logs` | ปฏิเสธ | select อย่างเดียว เฉพาะแถวของตัวเอง | เต็ม |
| `mt_delete_otps` | ปฏิเสธ | ปฏิเสธ (ไม่มี policy เลย) | เต็ม |

## 10.5 Permission ระดับเบราว์เซอร์

ดูตารางใน SECTION 4.17 — Notification, Microphone, WebAuthn, Web Share, Clipboard

## 10.6 CORS Whitelist

Edge Functions อนุญาตเฉพาะ 5 origin (`_shared/cors.ts`)
- `https://boss-kung.github.io` (production)
- `http://localhost:8080`, `http://localhost:3000`, `http://127.0.0.1:8080`, `http://127.0.0.1:3000` (dev)

หมายเหตุ — dev server ตามที่ `CLAUDE.md` และ `.claude/launch.json` ระบุคือพอร์ต 8765 ซึ่งไม่อยู่ใน whitelist (ดู SECTION 15)

---

# SECTION 11 — State Management

## 11.1 สรุปแนวทาง

ระบบไม่ใช้ไลบรารีจัดการ state ใด ๆ
ไม่มี Redux ไม่มี Zustand ไม่มี MobX ไม่มี React Query ไม่มี Context API ไม่มี reactive framework
(ยืนยันจากการที่ `index.html` โหลดเฉพาะไฟล์ในโปรเจกต์ และไม่มี `import` statement ใน source ฝั่งแอป)

แนวทางที่ใช้จริงคือ mutable global singleton + manual re-render

## 11.2 Global State — `S`

ประกาศที่ `app_v2.js` บรรทัด 982 เป็น `let S = {...}` (ไม่ใช่ const — สามารถถูกแทนที่ทั้งก้อนได้)

โครงสร้างแบ่งเป็น 4 กลุ่ม

กลุ่มที่ 1 — ข้อมูลถาวร (persist ลง localStorage)
```
transactions, wallets, categories, budgets, incomeBudgets, settings, recurring,
upcomingBills, merchants, ccBenefits, ccBenefitRules, marketPrices, rewardLedger,
netWorthSnapshots, investmentSnapshots, creditLimitGroups, rewardAccounts,
cryptoAssets, cryptoHoldings, cryptoTransactions, cryptoSyncMeta, goals,
privileges, splitBills, splitPeople, splitBillDraft, loans, bnplPlans, migrations
```

กลุ่มที่ 2 — สถานะ UI ที่คงอยู่ระหว่างเซสชัน (ไม่ persist ยกเว้นบางตัว)
```
page             หน้าปัจจุบัน (persist แยกที่ mt_last_page)
dashMonth        เดือนที่ดูบนแดชบอร์ด
txMonth, txType, txSearch    ตัวกรองหน้ารายการ
rptMonth, rptView            หน้ารายงาน (rptMonth persist ผ่าน hash)
moreTab          แท็บในหน้า More
catManageType    ประเภทหมวดหมู่ที่กำลังจัดการ
```

กลุ่มที่ 3 — สถานะ transient ของฟอร์ม
```
tx { step, type, amount, walletId, toWalletId, categoryId, merchant, channel, note, date,
     calcOp, calcLeft, isRecurring, isInstallment, installmentMonths, bnplInstallments,
     rewardRuleIds, rewardRulesTouched, rewardIncludePoints, rewardIncludeCashback,
     rewardEstimate, txSuggestedFields, sharedExpense, splitBillId, splitBillOwnerShare,
     reimbursesSharedExpenseTxId, allowOverReimbursement, benefitDateOverride, ... }
txMode           'add' | 'edit'
editingTxId
selectedTxId
editingWalletId
payingCardId
deleteConfirm
```

กลุ่มที่ 4 — สถานะภายในที่ใช้ชั่วคราว (ขึ้นต้นด้วย `_`)
```
_ledgerIssues              ผลการตรวจ ledger integrity
_isOffline                 สถานะเครือข่าย
_lastHealthyBreakdown      รายละเอียดคะแนนสุขภาพการเงิน
_bnplPlanListWalletId      กระเป๋าที่กำลังดูแผน BNPL
```

## 11.3 การเขียน State

ไม่มี action / reducer / setter กลาง โค้ดเขียนลง `S` โดยตรงทุกที่ เช่น
```
S.tx.amount = v
S.transactions.unshift(tx)
S.wallets = S.wallets.filter(...)
S.settings.darkMode = !S.settings.darkMode
```

ตัวช่วยที่มีอยู่
- `App._txField(field, val)` — setter บาง ๆ สำหรับ `S.tx` เท่านั้น (`S.tx[field] = val`)
- `App.setDashMonth`, `setTxMonth`, `setTxType`, `setRptMonth`, `setRptView`, `_setMoreTab` — setter + re-render
- ไม่มี validation กลางก่อนเขียน state (validation เกิดตอน save เท่านั้น)

## 11.4 การอ่านและ Persist

```
persist()
 ├─ ถ้า MT_STORAGE_HYDRATED เป็นเท็จ → console.warn + return false
 │     (กันการเขียนทับข้อมูลด้วยค่าว่างก่อนโหลดเสร็จ — สำคัญมาก)
 ├─ App._beforePersistV50?.()
 ├─ App._beforePersistV40?.()      → ensureV4State + recalc + อัปเดต storageMeta.lastSavedAt
 ├─ App.ensurePrivilegesState?.()
 ├─ ok = Storage.saveAll(S)
 └─ ok ? MTAuthSync.markDirty() : toast('บันทึกไม่สำเร็จ ...')
```

`MT_STORAGE_HYDRATED` เป็น guard สำคัญ — ตั้งเป็น `true` ที่บรรทัด 1897 หลัง `Storage.init()` เสร็จเท่านั้น

## 11.5 Reactivity — การ Render ใหม่

ไม่มี reactivity อัตโนมัติ ทุกครั้งที่ state เปลี่ยนต้องเรียก render เอง

```
App.render()
 └─ เลือก renderer ตาม S.page จากตาราง
      { dashboard: renderDashboard, transactions: renderTransactions,
        wallets: renderWallets, reports: renderReports, more: renderMore }
 └─ แล้วเรียก formatNumberInputsIn(document)

App.showPage(page)
 ├─ validate page แล้ว fallback เป็น 'dashboard'
 ├─ S.page = page
 ├─ localStorage['mt_last_page'] = page
 ├─ writeAppHashRoute(page)   (ถ้าไม่ได้ถูก suppress)
 ├─ toggle class 'active' ของ .page และ .nav-btn
 ├─ App._syncPageChrome(page)  (ซ่อน/แสดง FAB, toggle class บน body)
 └─ App.render()
```

รูปแบบการ render ที่ใช้จริง 3 แบบ
1. Full page — `content.innerHTML = html` (เช่น `renderMore`)
2. Partial — อัปเดตเฉพาะบางส่วน (`renderTransactionsList` แก้เฉพาะ `#tx-list-content` โดยไม่แตะ header)
3. In-place patch — เขียนค่าลง element ตรง ๆ (เช่น `incEl.textContent = ...`, `BNPLui._refreshPlanScreen()`)

การรักษาสถานะ UI ระหว่าง re-render — ทำด้วยมือ เช่น เก็บ `el.scrollTop` ก่อนแล้วคืนค่าหลัง

## 11.6 Local State ในโมดูล

โมดูลบริวารเก็บ state ของตัวเองในตัวแปร closure ไม่ปนกับ `S`

| โมดูล | ตัวแปร | หน้าที่ |
|---|---|---|
| `loans_v2.js` | `_draft`, `_repDraft`, `_editLoanId` | ร่างฟอร์มให้ยืม/รับคืน |
| `split_bill.js` | `_draft`, `_step` (+ persist ลง `mt_split_bill_draft`) | ร่างบิลหลายขั้น |
| `quick_capture.js` | `_qcResult`, `_recognition`, `_isListening` | ผลการ parse และสถานะไมค์ |
| `app_lock.js` | `appStarted`, `unlocked`, `enteredPin`, `mode`, `biometricAutoInFlight`, `biometricAutoLastAt` | สถานะการล็อก |
| `auth_sync.js` | `state` (session, user), และค่าคงที่ debounce | สถานะการล็อกอิน |
| `notifications_v2.js` | ค่าคงที่ TTL และ hash cache | การซิงก์ |
| `bnpl.js` | ไม่มี local state — อ่านจาก `S.bnplPlans` ตรง ๆ | — |

## 11.7 Cache Strategy

| ชั้น | กลไก | อายุ | invalidate เมื่อ |
|---|---|---|---|
| Service Worker | Cache API ชื่อ `money-tracker-v2-{version}` | จนกว่าจะ activate เวอร์ชันใหม่ | เปลี่ยน `APP_VERSION` ใน SW |
| AI Insights | `payloadHash` + `lastRefreshed` | 4 ชั่วโมง | ข้อมูลเปลี่ยน (hash ต่าง) หรือเรียก `invalidate()` |
| Finance features | feature store + schema version | ตรวจด้วย `isFeatureStoreFresh` | `rebuildFeatureStore` / incremental |
| Gold price | `MT_GOLD_LAST` | 12 ชั่วโมง | ดึงใหม่สำเร็จ |
| Notification snapshot | `mt_notification_last_snapshot_sync` | 10 นาที | force sync |
| Notification rules | `mt_notification_last_rules_sync` + hash | 6 ชั่วโมง | กฎเปลี่ยน (hash ต่าง) หรือ force |
| Finance brief | `App.getCachedFinanceBrief()` | ไม่ระบุชัด | `scheduleFinanceBriefRefresh()` |

## 11.8 Mutation Pattern

รูปแบบมาตรฐานที่ใช้ทั่วโค้ด
```
1. เปลี่ยน S โดยตรง
2. (ถ้ากระทบยอด) App.recalculateWalletBalances({save:false, recordSnapshot:true})
3. persist()
4. App.render() หรือ open<Screen>() ที่เกี่ยวข้อง
5. toast() แจ้งผล
```

รูปแบบสำหรับการลบที่ย้อนได้
```
1. ตัดข้อมูลออกจาก S (เก็บ index และ object เดิมไว้)
2. re-render ทันที
3. App._withUndo(message, undoFn, commitFn)
      undoFn:   splice กลับเข้าที่เดิม + re-render
      commitFn: persist()
```

## 11.9 Optimistic Update

ระบบเป็น optimistic โดยธรรมชาติ เพราะการเขียน localStorage เป็น synchronous
UI อัปเดตทันทีก่อนรู้ผลการซิงก์ขึ้นคลาวด์เสมอ

การซิงก์ขึ้นคลาวด์
```
persist() สำเร็จ → markDirty() → debounce 2500ms → autoSyncIfReady() → syncNow()
```
ถ้าการซิงก์ล้มเหลว ข้อมูลในเครื่องยังอยู่ครบ ผู้ใช้ไม่สูญเสียอะไร
การชนกันของเวอร์ชันจัดการด้วย `data_version` + `handleRemoteConflict`

ไม่มี rollback อัตโนมัติเมื่อซิงก์ล้มเหลว เพราะแหล่งความจริงคือเครื่องผู้ใช้ ไม่ใช่เซิร์ฟเวอร์

## 11.10 State ที่ไม่อยู่ใน S (state ซ่อน)

- `document.body.classList` — `is-dashboard`, `is-transactions`, `keyboard-open`, `ios-standalone`, `standalone`, `mt-app-lock-open`
- `document.documentElement.classList` — `dark`, `ui-v2`, `mt-app-lock-open`
- CSS custom properties — `--primary`, `--app-height`
- DOM dataset — `data-tab`, `data-loan-id`, `data-recurring-id`, `data-card-id`, `data-pane`, `data-view`, `data-bound`, `data-hiding`, `data-number-format`, `data-number-format-ready`, `data-original-type`
- Element property flags — `ss._edgeSwipeReady`, `backBtn._mtLongBackReady`, `btn.dataset.bound`
- Module-level flags — `MT_STORAGE_HYDRATED`, `bootScreenHideRequested`, `bootScreenForceHide`, `bootScreenAuthHold`, `bootScreenHideRetry`, `_uiV2Force`, `lastToastMeta`

การกระจายสถานะไปหลายที่แบบนี้ทำให้การ debug ยากขึ้น และเป็นจุดที่ควรรวมศูนย์ในอนาคต
