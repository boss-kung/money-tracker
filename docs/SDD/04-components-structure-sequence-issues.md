# SDD ตอนที่ 4 — Components / Code Structure / Sequence / Known Issues / Improvements

ต่อจากตอนที่ 3 (SECTION 7–11)

---

# SECTION 12 — Reusable Components

ระบบไม่มี component framework จึงไม่มี component ในความหมายของ React/Vue
สิ่งที่ใช้ซ้ำมี 3 รูปแบบ
1. ฟังก์ชัน JavaScript ที่คืนสตริง HTML (HTML builder)
2. คลาส CSS ที่ใช้ร่วมกัน
3. ฟังก์ชันจัดการพฤติกรรม (behavior helper)

## 12.1 HTML Builder Functions

### `App._emptyState(icon, title, subtitle)`
- ใช้ที่ไหน — 31 จุด ทั่วทั้งแอป (หน้ารายการ, รายการประจำ, ศูนย์ผ่อน, รายการล่าสุดของบัตร, ปฏิทินบิล ฯลฯ)
- รับพารามิเตอร์ — icon (emoji), title (ข้อความหลัก), subtitle (คำอธิบายเสริม)
- คืนค่า — สตริง HTML ของ empty state
- ไม่ส่ง event ใด ๆ

### `App._sectionHeader(title, actionLabel?, actionOnclick?)`
- ใช้ที่ไหน — 10 จุด (หน้า CC detail, แดชบอร์ด, รายงาน)
- รับพารามิเตอร์ — หัวข้อ และปุ่มลัดฝั่งขวา (ไม่บังคับ)
- ส่ง event — ผ่าน `onclick` string ที่ส่งเข้ามา

### `App._txRow(tx, opts)`
- ใช้ที่ไหน — 7 จุด (หน้ารายการ, รายการล่าสุดบนแดชบอร์ด, รายการของบัตร, หน้ารายละเอียดกระเป๋า)
- รับพารามิเตอร์ — object ธุรกรรม และ `{ showDate: boolean }`
- ใช้ state — `S.categories`, `S.wallets`, `S.settings.hideMoney`
- Event — ผูกทีหลังด้วย `App._bindTxRows(containerId)` ไม่ใช่ inline onclick

### `App._walletCard(w, ctx)`
- ใช้ที่ไหน — หน้ากระเป๋า (ทุกประเภทยกเว้น BNPL)
- รับพารามิเตอร์ — wallet และ context `{ dataAttrs, dragCls, dragHandle, editBtn, reorderMode }`
- คู่ขนาน — `BNPL.ui.walletCard(w, ctx)` ใช้ ctx โครงเดียวกันเป๊ะ (จงใจให้เข้ากันได้)

### `App._txDetailRowsHtml(tx)`
- ใช้ที่ไหน — ทั้ง overlay รายละเอียด (`_renderTxDetail`) และ sub-screen รายละเอียด (`openTxDetailSub`)
- เป็นตัวอย่างการใช้ซ้ำที่ดี — เนื้อหาเดียวกันแสดงได้ 2 บริบท

### `App._txField`, `App._showFieldError(elementId, message)`
- `_showFieldError` ใช้ 26 จุด — เป็นกลไกแสดง error ระดับฟิลด์ที่เป็นมาตรฐานเดียวของแอป

### `App.showConfirm({title, body, danger, confirmLabel, onConfirm})`
- ใช้ที่ไหน — 33 จุด
- สร้าง overlay `v23-confirm-overlay` พร้อมปุ่ม `.v23-cancel-btn` และ `.v23-ok-btn`
- ถูก patch โดยระบบ back-button ให้ push/pop history อัตโนมัติ

### `App.openDynamicSheet(...)` / `App.closeDynamicSheet()`
- ใช้ 12 จุด — bottom sheet ทั่วไปที่สร้างเนื้อหาแบบ dynamic

### `App.openSubScreen(html, opts)` / `App.replaceSubScreen(html)` / `App.closeSubScreen()`
- ใช้ 50 และ 58 จุดตามลำดับ — เป็น component ที่ถูกใช้ซ้ำมากที่สุดในระบบ
- ผลข้างเคียงในตัว: `formatNumberInputsIn`, `_bindSubBackLongPress`, ผูก edge-swipe ครั้งเดียวต่อ element, จัดการ animation

### Builder ของ Finance Intelligence
`App._financePill`, `_financeMeter`, `_financeRing`, `_financeMiniStat`, `_financeSparkBars`, `_financeSplitBar`,
`_financeEmptyVisual`, `_financeScreenIntro`, `_financeJourneyLinks`, `_financeLifeIcon`, `_financeScenarioIcon`
— ชุด visual primitive สำหรับหน้าจอกลุ่มวางแผน ใช้ซ้ำ 5–14 ครั้งต่อฟังก์ชัน

### Builder ของ BNPL (`bnpl.js`)
`BNPLui.walletCard`, `_heroHtml`, `_planListHtml`, `_paymentHistoryHtml`, `_payModalHtml`, `_editPlanHtml`

### Builder ของหารบิล (`split_bill.js`)
`stepBar()`, `stepHeader(backFn)`, `navRow(nextLabel, nextFn, backFn)`, `pName(id)`, `_lineText(bill, result)`, `_sbItemFormHtml(item)`

## 12.2 CSS Component Classes

| คลาส | ใช้ทำอะไร | ใช้ที่ไหน |
|---|---|---|
| `.card` / `.card-pad` | container พื้นฐาน | ทุกหน้า |
| `.sec-title` | หัวข้อกลุ่ม | ทุกหน้า |
| `.settings-row` + `.s-icon` `.s-label` `.s-value` `.s-arrow` | แถวเมนู/รายการ | More, ให้ยืมเงิน, ทุก sub-screen ที่เป็นลิสต์ |
| `.form-group` + `.form-label` + `.form-input` + `.form-hint` | ฟิลด์ฟอร์ม | ทุกฟอร์ม |
| `.btn` + `.btn-primary` `.btn-secondary` `.btn-outline` `.btn-sm` | ปุ่ม | ทุกหน้า |
| `.btn-icon` / `.icon-btn` | ปุ่มไอคอน | header ของ sub-screen, แถวรายการ |
| `.chip` | ตัวกรอง | เดือน, ประเภท, มุมมองรายงาน |
| `.chips` | container ของ chip | header ของหน้า |
| `.toggle` (+ `.on`) | สวิตช์ | โหมดมืด, ส่วนลด CC, กฎแจ้งเตือน, App Lock |
| `.segmented-tabs` + `.segmented-tab` | แท็บแบบ segmented | จัดการหมวดหมู่ |
| `.more-tab-strip` + `.more-tab-btn` + `.more-tab-pane` | แท็บของหน้า More | More |
| `.search-field-wrap` + `.search-input` + `.search-clear-btn` | ช่องค้นหาพร้อมปุ่มล้าง | หมวดหมู่, ร้านค้า, More |
| `.overlay` + `.overlay-backdrop` + `.sheet` + `.sheet-handle` + `.sheet-header` + `.sheet-body` | bottom sheet | ทุก overlay |
| `.sub-header` + `.sub-scroll` | โครง sub-screen | 50+ หน้า |
| `.list-item-icon` `.list-item-info` `.list-item-name` `.list-item-sub` | แถวรายการทั่วไป | รายการประจำ, ลิสต์ต่าง ๆ |
| `.wallet-card` + `.wallet-card-colored` + `.wc-*` + `.cc-due-strip` | การ์ดกระเป๋า | หน้ากระเป๋า (ใช้ร่วมกันระหว่าง app_v2 กับ bnpl) |
| `.cc-hero` | ส่วนหัวหน้าบัตร | CC detail, BNPL plan list |
| `.tx-date-header` + `.tx-group-card` | กลุ่มรายการตามวัน | หน้ารายการ |
| `.compact-card-list` + `.installment-compact-row` + `.installment-mini-row` | รายการผ่อนแบบกระชับ | ศูนย์ผ่อน, CC detail |
| `.amount-summary-card` | การ์ดสรุปยอด | ชำระบัตร, ฟอร์มบันทึกรายการ |
| `.color-row` + `.color-dot` | เลือกสี | ฟอร์มกระเป๋า, ตั้งค่าสีธีม |
| `.toast` | ข้อความแจ้ง | ทั้งแอป |
| `.mt-*` (mt-topbar, mt-net-card, mt-recurring-alert, mt-summary-banner, mt-integrity-warn ฯลฯ) | องค์ประกอบเฉพาะแดชบอร์ด | Dashboard |
| `.bento-card` `.list-card` `.ai-bar` `.seg-pill` | ชุดใหม่ตาม UI_DESIGN_SPEC | ระหว่าง rollout |

## 12.3 Behavior Helpers ที่ใช้ซ้ำ

| ฟังก์ชัน | หน้าที่ |
|---|---|
| `toast(msg, type)` | แจ้งเตือน มี dedup 2 ชั้น |
| `persist()` | บันทึกทั้ง state พร้อม guard และ hook |
| `moneyFmt(n)` | จัดรูปแบบเงิน เคารพ `hideMoney` |
| `Calc.fmt` / `fmtNum` / `fmtSigned` / `fmtAssetUnits` | จัดรูปแบบตัวเลข |
| `Calc.labelDate` / `shortDate` / `monthLabel` | จัดรูปแบบวันที่แบบไทย |
| `App._esc(v)` | escape HTML |
| `App._withUndo(msg, undoFn, commitFn)` | ลบแบบย้อนได้ |
| `App._syncSearchClear(input)` | ซ่อน/แสดงปุ่มล้างในช่องค้นหา (ใช้ 11 จุด) |
| `formatNumberInputsIn(scope)` | แปลง number input ให้ใส่คอมมาอัตโนมัติ |
| `readNumberInput(id, fallback)` | อ่านค่าตัวเลขโดยถอดคอมมา |
| `App._bindTxRows(containerId)` | ผูก event ให้แถวรายการ |
| `App._sectionHeader` | หัวข้อพร้อมปุ่มลัด |
| `App.recalculateWalletBalances(opts)` | คำนวณยอดใหม่ (36 จุดเรียก) |
| `Calc.genId()` | สร้าง id |

## 12.4 การใช้ซ้ำที่ยังทำได้ไม่ดี

1. `esc()` ถูกนิยามใหม่อย่างน้อย 7 ที่ ด้วยชุดอักขระที่ไม่เหมือนกัน (บางตัวไม่ escape `'`)
2. `fmtDate()` ถูกนิยามใหม่ใน `bnpl.js` และ `loans_v2.js` ทั้งที่ `Calc.labelDate` ทำงานเดียวกัน
3. `money()` / `fmt()` ถูกนิยามใหม่ในเกือบทุกโมดูล
4. `today()` / `todayStr()` ถูกนิยามใหม่ในเกือบทุกโมดูล
5. `addMonths()` มีอย่างน้อย 2 ตัว (`app_v2.js` บรรทัด 5518 และ `bnpl.js` บรรทัด 21) ที่ตรรกะต่างกันเล็กน้อย
6. `App._investmentValueTHB` กับ `App._walletValueTHB` ทำงานทับซ้อนกัน
7. `Calc.isPostedTx` กับ `App._isPostedTx` มีตรรกะเดียวกันคนละที่
8. `Calc.isReimbursementTx` กับ `App.isReimbursementTx` มีตรรกะเดียวกันคนละที่
9. `Calc.getCCPaymentCashAmount` กับ `App.getCCPaymentCashAmount` มีตรรกะเดียวกันคนละที่

---

# SECTION 13 — Code Structure

## 13.1 Layer

```
┌──────────────────────────────────────────────────────────┐
│ Presentation                                             │
│   index.html (shell) + style_v2.css + ui_v2.css          │
│   template string ที่คืนจากฟังก์ชัน render               │
├──────────────────────────────────────────────────────────┤
│ Application / Controller                                 │
│   window.App (เมธอดประมาณ 500 ตัว)                       │
│   render* / open* / save* / delete* / toggle* / _handlers │
├──────────────────────────────────────────────────────────┤
│ Domain / Business Logic                                  │
│   Calc (calculations.js)         — ฟังก์ชันบริสุทธิ์      │
│   CreditCardCycles               — ฟังก์ชันบริสุทธิ์      │
│   BNPLCalc, SplitBillCalc        — ฟังก์ชันบริสุทธิ์      │
│   InsightEngine, FinanceIntelligence, AskMyMoneyCore     │
│   App._ledgerFlows และตระกูล ledger (ยังผูกกับ S)         │
├──────────────────────────────────────────────────────────┤
│ Data Access                                              │
│   Storage (storage_v2.js)        — localStorage เท่านั้น  │
│   LoanStore, BNPLStore, SbStore  — store เฉพาะโดเมน      │
├──────────────────────────────────────────────────────────┤
│ Infrastructure                                           │
│   Service Worker, MTAuthSync, MTAppLock, MTCryptoVault,  │
│   MTGoldMarket, notifications_v2                         │
├──────────────────────────────────────────────────────────┤
│ External                                                 │
│   Supabase (Auth / REST / Edge Functions / pg_cron)      │
│   Google Apps Script, Cloudflare Worker, Public APIs     │
└──────────────────────────────────────────────────────────┘
```

การแยกชั้นทำได้ดีในระดับโมดูลบริวาร แต่ในตัว `app_v2.js` ชั้น Presentation / Controller / Domain ปนกันเกือบทั้งหมด
เพราะฟังก์ชันเดียวมักทำทั้งอ่าน state คำนวณ สร้าง HTML และเขียน DOM

## 13.2 Architecture Pattern

รูปแบบที่ระบบใช้จริง

1. Global Singleton — `S` (state) และ `App` (namespace ของทุก behavior)
2. Sequential IIFE Blocks — `app_v2.js` แบ่งเป็นบล็อก IIFE ประมาณ 58 บล็อก คั่นด้วยแบนเนอร์คอมเมนต์
   แต่ละบล็อกมี `const esc`, `const money`, `const today` เป็นของตัวเอง แล้วเพิ่ม/แทนที่เมธอดของ `App`
3. Monkey Patching / Decorator — โมดูลที่โหลดทีหลังห่อเมธอดเดิม
   ```
   const prev = App.renderDashboard?.bind(App)
   App.renderDashboard = function () { prev?.(); /* เพิ่มพฤติกรรม */ }
   ```
   ใช้ใน `onboarding.js` (6 ฟังก์ชัน), `loans_v2.js` (2 ฟังก์ชัน), บล็อก back-button (5 ฟังก์ชัน), Wave 4 (renderTransactions)
4. Module Pattern (Revealing) — โมดูลบริวารทุกตัวเป็น IIFE ที่ export ผ่าน `window.<Name>`
5. UMD-lite — `calculations.js`, `credit_card_cycles.js`, `gold_market.js`, `crypto_vault.js`, `ask_my_money_core.js`,
   `finance_intelligence.js` มี `if (typeof module !== 'undefined') module.exports = ...` เพื่อให้ Node เทสต์ได้
6. Template Method — `openSubScreen(html)` เป็นโครงกลาง ผู้เรียกส่งเนื้อหาเข้ามา
7. Repository — `LoanStore`, `BNPLStore`, `SbStore`, `Storage`
8. Guard Clause — ใช้หนาแน่นมาก (`if (!x) return`) แทน nested if
9. Defensive Programming — `typeof App !== 'undefined'`, optional chaining, try/catch ครอบทุกจุดที่แตะ storage/DOM

## 13.3 Separation of Concerns

ทำได้ดี
- `calculations.js` เป็นฟังก์ชันบริสุทธิ์เกือบทั้งหมด ไม่แตะ DOM
- `credit_card_cycles.js` เป็นฟังก์ชันบริสุทธิ์ 100% รับทุก dependency ผ่าน parameter (`rewardForTx`, `amountForTx`, `isPostedTx`)
  จึงเทสต์ได้เต็มที่ ถือเป็นโมดูลที่ออกแบบดีที่สุดในรีโพ
- `crypto_vault.js` แยกการเข้ารหัสออกจากตรรกะซิงก์อย่างสะอาด
- `gold_market.js` แยก parser ออกจาก fetch strategy
- `storage_v2.js` เป็นจุดเดียวที่แตะ localStorage สำหรับข้อมูลหลัก
- `ask_my_money_core.js` แยกการ parse intent ออกจากการสร้างคำตอบ ทำให้เทสต์ regex ได้

ทำได้ไม่ดี
- `app_v2.js` 24,720 บรรทัด รวมทุกอย่างไว้ในไฟล์เดียว
- ฟังก์ชัน render ทำหน้าที่ทั้ง query, transform, สร้าง HTML และเขียน DOM
- `_ledgerFlows` และตระกูลอ่าน `S` โดยตรง จึงเทสต์แยกไม่ได้
- ตรรกะธุรกิจบางส่วนฝังใน HTML string เช่น `onchange="(function(){var m=this.value==='monthly'; ...}).call(this)"` (บรรทัด 6295)
- `finance_intelligence.js` และ `ai_insights.js` อ่าน `localStorage` เองโดยไม่ผ่าน `Storage`

## 13.4 Dependency Direction

```
sample-data_v2.js   (ไม่พึ่งใคร — เป็นฐานของทุกอย่าง)
     ↑
thai_bank_holidays.js
     ↑
storage_v2.js       (พึ่ง DEFAULT_* และ toast ที่อาจยังไม่มี — จึงใช้ setTimeout ห่อ)
     ↑
calculations.js     (พึ่ง getTODAY และอ้างถึง App แบบ optional)
     ↑
ai_insights.js, finance_intelligence.js, ask_my_money_core.js
     ↑
notification_config.js
     ↑
app_lock.js, credit_card_cycles.js, bnpl.js, crypto_vault.js, auth_sync.js, gold_market.js
     ↑
app_v2.js           (สร้าง S และ App — จุดศูนย์กลาง)
     ↑
split_bill.js, loans_v2.js, quick_capture.js, notifications_v2.js, onboarding.js
```

ปัญหาที่พบ
- `calculations.js` โหลดก่อน `app_v2.js` แต่เรียก `App.getLedgerAmountForTx`, `App._isPostedTx`, `App.getCardStatement`
  จึงต้องมี `typeof App !== 'undefined'` ทุกจุด — เป็น circular dependency ที่แก้ด้วย runtime guard
- `storage_v2.js` เรียก `toast()` ที่อยู่ใน `app_v2.js` จึงต้องห่อด้วย `setTimeout(..., 0)`
- ลำดับสคริปต์ใน `index.html` เป็น dependency ที่ไม่มีอะไรบังคับ — สลับลำดับเมื่อไรแอปพัง

## 13.5 Reusability

ระดับสูง (นำไปใช้โปรเจกต์อื่นได้ทันที)
- `credit_card_cycles.js` — pure, ไม่มี dependency, รับทุกอย่างผ่าน parameter
- `crypto_vault.js` — pure crypto helper
- `gold_market.js` — รับ `fetchImpl` และ `storage` ผ่าน options ได้
- `ask_my_money_core.js` — pure

ระดับกลาง
- `calculations.js` — ส่วนใหญ่ pure แต่มีจุดที่เรียก `App`
- `ai_insights.js` — รับ `S` ผ่าน parameter แต่เขียน localStorage เอง
- `bnpl.js` — ตรรกะ (`BNPLCalc`) แยกได้ดี แต่ `BNPLStore` และ `BNPLui` ผูกกับ `S` และ DOM

ระดับต่ำ (ผูกแน่นกับโปรเจกต์นี้)
- `app_v2.js` ทั้งไฟล์
- `loans_v2.js`, `split_bill.js`, `quick_capture.js`, `onboarding.js` (พึ่ง `App` และ `S` global)

## 13.6 Naming Convention ที่สังเกตได้

- `App.openXxx()` — เปิดหน้าจอหรือ dialog
- `App.saveXxx()` — บันทึกข้อมูล
- `App.deleteXxx()` — ลบข้อมูล
- `App.renderXxx()` — วาดหน้า
- `App.getXxx()` — คำนวณหรืออ่านค่า (ไม่เปลี่ยน state)
- `App.toggleXxx()` — สลับสถานะ
- `App.confirmXxx()` — ยืนยันการกระทำ
- `App._xxx()` — internal ไม่ควรเรียกจากภายนอก (แต่ในทางปฏิบัติถูกเรียกจาก inline onclick ใน HTML string จำนวนมาก)
- `App.ensureXxxState()` — เติมค่า default ให้ state ที่อาจไม่มี
- คำนำหน้าเวอร์ชัน — `_beforePersistV40`, `_beforePersistV50`, `_investmentUnitPriceV4`, `currentTxFilteredV42`, `esc32`, `v23-confirm-overlay`
  แสดงร่องรอยการพัฒนาแบบเพิ่มเวอร์ชันทับ ไม่ใช่การ refactor

## 13.7 Error Handling Pattern

```
try { ... } catch (_) {}          — ใช้มากที่สุด (silent fail) พบหลายร้อยจุด
try { ... } catch (e) { console.warn(...) }
try { ... } catch (err) { console.error(...); notify(...) }   — ใช้ใน saveTx
optional chaining + ?.()          — เรียกฟังก์ชันที่อาจยังไม่ถูกนิยาม
```
ข้อดี — แอปแทบไม่มีทางพังทั้งหน้าจอจาก error เดียว
ข้อเสีย — error ถูกกลืนเงียบจำนวนมาก ทำให้ debug ยากและอาจซ่อนบั๊กจริง

## 13.8 Testing Structure

```
tests/
├── unit tests (ทดสอบโมดูลที่ export ได้)
│   ├── credit_card_cycles.test.js     รอบบิล/วันครบกำหนด
│   ├── bnpl_schedule.test.js          ตารางงวด BNPL (320 บรรทัด — ไฟล์เทสต์ที่ใหญ่ที่สุด)
│   ├── split_bill.test.js             การแบ่งเงิน
│   ├── finance_intelligence.test.js   พยากรณ์/scenario
│   ├── gold_market.test.js            parser ราคาทอง
│   ├── crypto_vault.test.js           เข้ารหัส/ถอดรหัส
│   ├── ask_my_money_core.test.js      parse intent
│   └── shared_reimbursement.test.js   ค่าใช้จ่ายร่วม
└── static analysis tests (regex over source)
    ├── xss_escape_holes_static.test.js
    ├── touch_target_size_static.test.js
    ├── thai_text_clipping_static.test.js
    ├── date_year_consistency_static.test.js
    ├── back_button_nav_static.test.js
    ├── boot_skeleton_static.test.js
    ├── fab_scroll_clearance_static.test.js
    ├── reports_fade_static.test.js
    ├── transaction_list_ux_static.test.js
    ├── add_tx_category_order_static.test.js
    ├── auth_gate_demo_entry_static.test.js
    ├── auth_sync_security.test.js
    ├── cc_benefit_rule_sheet_static.test.js
    ├── dashboard_net_card_static.test.js
    ├── gold_market_static.test.js
    ├── import_dropped_rows_warning_static.test.js
    ├── privilege_note_link_static.test.js
    └── shared_expense_add_tx_static.test.js
```
รวม 26 ไฟล์ รันด้วย `node --test tests/`

การใช้ static analysis test เป็นทางเลือกที่สมเหตุสมผลสำหรับโค้ดที่ไม่มี module system —
เป็นการล็อกไม่ให้ regression กลับมา แม้จะทดสอบพฤติกรรมจริงไม่ได้

## 13.9 Versioning Convention

- ทุก `<script>` และ `<link>` มี `?v=<string>` เพื่อ cache-bust
- `service-worker_v2.js` บรรทัด 1 มี `APP_VERSION` ของตัวเอง
- `app_v2.js` บรรทัด 893 มี `APP_VERSION` ของตัวเอง
- `CLAUDE.md` ระบุกติกา: แก้ไฟล์ JS ใดต้องบั๊มเวอร์ชันของไฟล์นั้นใน `index.html`; แก้ `index.html` ต้องบั๊ม `APP_VERSION` ใน SW
- สถานะปัจจุบัน (ตรวจจากไฟล์)
  - `service-worker_v2.js` — `2026.07.23-fix-duplicate-tx-history-race`
  - `app_v2.js` ใน HTML — `2026.07.23-fix-duplicate-tx-history-race`
  - `app_v2.js` ค่าคงที่ในไฟล์ — `2026.06.23-credit-due-r107` (ไม่ตรงกัน — ดู SECTION 15)
  - `style_v2.css` — `2026.07.23-remove-boot-skeleton-r120`

---

# SECTION 14 — Sequence Diagram (Text)

## 14.1 บันทึกรายจ่ายบนบัตรเครดิตที่มีสิทธิประโยชน์

```
ผู้ใช้
  │ แตะ FAB
  ▼
FAB (index.html)
  │ onclick="App.openAddTx()"
  ▼
App.openAddTx
  │ รีเซ็ต S.tx
  │ App.openOverlay('overlay-add-tx')
  │      └─> patched openOverlay ─> pushLayer() ─> queueMicrotask ─> history.pushState()
  │ App._renderAddTxAmount()
  ▼
DOM (#add-tx-content) แสดง numpad
  │
ผู้ใช้ กดตัวเลข
  │ onclick="App._numpad('5')"
  ▼
App._numpad
  │ ตรวจความยาว (จำนวนเต็ม ≤10, ทศนิยม ≤2)
  │ S.tx.amount = '5'
  │ App._syncAddTxAmountUI() หรือ _renderAddTxAmount()
  ▼
DOM อัปเดตตัวเลข
  │
ผู้ใช้ กด "ถัดไป"
  ▼
App._goToDetail
  │ App._evalCalc()
  │ ตรวจ parseFloat(amount) ≠ 0
  │ S.tx.step = 'detail'
  │ App._renderAddTxDetail()
  ▼
App._renderAddTxDetail
  │ อ่าน S.wallets, S.categories, S.merchants, S.settings.customChannels
  │ ถ้ากระเป๋าเป็น credit:
  │     └─> App.getSuggestedBenefitRules(draft)
  │            └─> App.applyBenefitRule(rule, tx) ต่อกฎ
  │                   └─> App.getRuleCycleUsage(rule) ─> อ่าน S.transactions
  │     └─> App.getOptimalBenefitSelection(draft)
  │     └─> App.calculateSelectedRewardEstimate(draft, ids)
  ▼
DOM แสดงฟอร์มพร้อมกฎที่แนะนำและยอดเงินคืนโดยประมาณ
  │
ผู้ใช้ กด "บันทึก"
  ▼
App.saveTx
  ├─> App.validateTransactionDraft(draft)
  │      ├─> walletById() ─> S.wallets
  │      ├─> App.getCreditLimitForCard(w)
  │      │      └─> App.getCreditLimitGroup() ─> S.creditLimitGroups
  │      └─> App.getAvailableCreditForCard(w)
  │             └─> App.getCreditUsageForCard / _getUnpostedInstallmentDebt
  │      (ไม่ผ่าน → toast(error) → จบ)
  ├─> cleanTxFromDraft(id)
  │      ├─> normalizeSharedExpenseDraft(S.tx)
  │      ├─> App.getOptimalBenefitSelection (ถ้ายังไม่แตะเอง)
  │      ├─> App._rewardEstimateForTx(tx)
  │      │      ├─> App.calculateSelectedRewardEstimate
  │      │      ├─> App.decorateRewardEstimateValues(cardId, est)
  │      │      └─> App._slimRewardEstimate(est)
  │      ├─> App._applyInstantDiscountToTx(tx, gross)
  │      └─> App.getLedgerAmountForTx(tx)
  ├─> S.transactions.unshift(tx)
  ├─> App._registerMerchantFromTx(tx) ─> อาจเพิ่มลง S.merchants
  ├─> App.refreshTransactionRewardEstimates()
  ├─> App.recalculateWalletBalances({save:false, recordSnapshot:true})
  │      ├─> App._validateLedgerIntegrity() ─> S._ledgerIssues
  │      ├─> App.ensureLedgerBaselines(false)
  │      ├─> App._ledgerFlows()
  │      │      └─> (patched by loans_v2) _addLoanFlows(prevLedger())
  │      ├─> เขียน wallet.balance / wallet.units ใหม่ทุกใบ
  │      └─> App.recordNetWorthSnapshot() ─> S.netWorthSnapshots
  ├─> persist()
  │      ├─> App._beforePersistV50 / V40 ─> ensureV4State + recalc + storageMeta
  │      ├─> App.ensurePrivilegesState()
  │      ├─> Storage.saveAll(S)
  │      │      ├─> Storage.save() × 31 คีย์ (แต่ละคีย์ setItem + readback)
  │      │      └─> Storage.verifyState(S, 4 คีย์หลัก)
  │      └─> MTAuthSync.markDirty()
  │             └─> debounce 2500ms ─> autoSyncIfReady() ─> syncNow()
  │                    ├─> Storage.buildExportPayload(S)
  │                    ├─> MTCryptoVault.canonicalStringify + encryptVault
  │                    └─> fetch POST {supabaseUrl}/rest/v1/mt_user_vaults
  ├─> App.closeOverlay('overlay-add-tx') ─> popLayer() ─> history.back()
  ├─> App.showPage('transactions')
  │      └─> App.render() ─> App.renderTransactions() ─> renderTransactionsList()
  └─> toast('บันทึกรายการแล้ว','success')
```

## 14.2 ปลดล็อกด้วย Face ID

```
ผู้ใช้ เปิดแอป
  ▼
app_lock.js MTAppLock.start(init)
  ├─> setupLifecyclePrivacy()  ผูก visibilitychange / pagehide / blur / pageshow
  ├─> readConfig() ─> localStorage['mt_app_lock']
  ├─> config.enabled = true ─> renderUnlock()
  │      ├─> ensureOverlay() สร้าง #mt-app-lock
  │      ├─> keypadHtml()
  │      ├─> setOverlay(true, false)
  │      └─> queueAutoBiometric(config)
  │             └─> setTimeout 280ms ─> MTAppLock.unlockWithBiometric()
  └─> callback() = init()   ← แอปบูตเบื้องหลังไปพร้อมกัน
  ▼
MTAppLock.unlockWithBiometric
  ├─> verifyBiometricCredential(config)
  │      ├─> hasPlatformAuthenticator()
  │      │      └─> PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  │      ├─> navigator.credentials.get({publicKey:{challenge, allowCredentials, userVerification:'required'}})
  │      │      ▼
  │      │   ระบบปฏิบัติการ แสดง Face ID
  │      │      ├─ สำเร็จ ─> คืน credential
  │      │      └─ ผู้ใช้ยกเลิก ─> throw NotAllowedError
  │      └─> เทียบ base64(rawId) กับ bio.credentialId
  ├─ สำเร็จ ─> unlockSuccess(config,'biometric')
  │      ├─> unlocked = true
  │      ├─> writeConfig({failureCount:0, lockedUntil:0, lastUnlockedAt, lastUnlockMethod})
  │      ├─> sessionStorage['mt_app_lock_session'] = now
  │      ├─> overlay.classList.add('unlocked') ─> setTimeout 360ms ─> setOverlay(false)
  │      └─> App.renderMore()
  └─ ล้มเหลว ─> renderUnlock(message, {auto:false}) ─> รอ PIN
```

## 14.3 การแจ้งเตือนแบบตั้งเวลาเอง (end to end)

```
[ฝั่งผู้ใช้ — ตอนตั้งค่า]
ผู้ใช้ สร้างกฎแจ้งเตือน
  ▼
App.saveNotificationRule(ruleId)
  ├─> normalizeCustomRule(raw)
  ├─> เขียนลง S.settings (notification rules)
  ├─> persist()
  └─> syncCustomRules({force:true})
        ├─> คำนวณ hash ของกฎทั้งชุด (stableStringify + simpleHash)
        ├─> ถ้า hash ตรงกับที่ซิงก์ล่าสุดและยังไม่หมด TTL 6 ชม. ─> ข้าม
        └─> callFunction('sync-notification-rules', {installId, rules, appVersion})
              ▼
        POST {supabaseUrl}/functions/v1/sync-notification-rules
              ├─> handleOptions / ตรวจ method
              ├─> getAuthenticatedUserId(req)
              ├─> normalizeRule() ต่อกฎ (validate + clamp + default route)
              ├─> DELETE ทุกกฎของ install_id
              ├─> INSERT กฎใหม่ทั้งชุด
              │      └─> trigger mt_notification_rules_normalize_route_by_trigger
              └─> 200 {ok:true, synced:N}

[ฝั่งเซิร์ฟเวอร์ — ทุก 15 นาที]
pg_cron 'mt_custom_notification_rules'
  │ net.http_post(url, headers{apikey, Authorization}, body{source:'supabase-cron'})
  ▼
Edge Function send-custom-notification-rules
  ├─> adminClient() ด้วย service_role
  ├─> SELECT devices WHERE enabled AND permission='granted'
  ├─> SELECT rules WHERE enabled AND install_id IN (...)
  ├─> SELECT snapshots WHERE install_id IN (...)
  └─> ต่อกฎ:
        ├─> shouldSend(rule, snapshot, bangkokParts())
        │      ├─> minutesOf(config.time)
        │      ├─> isInCurrentWindow(ruleMinutes, nowMinutes)  (หน้าต่าง 15 นาที)
        │      └─> เงื่อนไขเฉพาะ trigger
        ├─ คืน '' ─> skipped++
        └─ คืน dedupeKey
              ├─> SELECT mt_notification_logs WHERE (install_id, type, dedupe_key)
              │      └─ status='sent' แล้ว ─> skipped++
              └─> ต่อ device:
                    ├─> sendWebPush(subscription, payload)
                    │      ├─> webpush.setVapidDetails(subject, pub, priv)
                    │      └─> POST ไปยัง push service ของเบราว์เซอร์
                    ├─ สำเร็จ ─> sentForRule++
                    └─ ล้มเหลว ─> failures.push({installId, ruleId, error})
              └─> upsert mt_notification_logs {status: sentForRule>0 ? 'sent':'error'}

[ฝั่งอุปกรณ์ — ตอนได้รับ]
Push Service ─> Service Worker 'push' event
  ├─> event.data.json()
  └─> self.registration.showNotification(title, {body, icon, badge, tag, data, actions})
        ▼
ผู้ใช้ แตะ notification
        ▼
Service Worker 'notificationclick'
  ├─> notification.close()
  ├─> route = action !== 'open' ? action : data.route
  ├─> targetUrl = './index.html' + routeHash(route)
  └─> clients.matchAll({type:'window', includeUncontrolled:true})
        ├─ พบ client ที่ origin+pathname ตรง
        │     ├─> client.focus()
        │     └─> client.postMessage({type:'NOTIFICATION_NAVIGATE', route})
        │            ▼
        │        app_v2.js message listener
        │            ├─> App.showPage(pageMap[route])
        │            └─> rAF×2 ─> เปิด sub-screen ที่ตรงกับ route
        └─ ไม่พบ ─> clients.openWindow(targetUrl)
                       ▼
                   init() ─> parseAppHashRoute() ─> เปิดหน้าและ sub-screen จาก ?open=
```

## 14.4 ซิงก์ข้อมูลขึ้นคลาวด์

```
persist() สำเร็จ
  ▼
MTAuthSync.markDirty()
  │ ตั้ง flag + setTimeout(DIRTY_DEBOUNCE_MS = 2500)
  ▼
autoSyncIfReady()
  ├─> ตรวจ configured() / มี session / vault ปลดล็อกแล้ว
  └─> syncNow({direction:'push'})
        ├─> currentPayload() = Storage.buildExportPayload(S)
        ├─> vaultRequest('GET') ─> ดึง data_version ปัจจุบันจากเซิร์ฟเวอร์
        │      ├─ ใหม่กว่าที่เรามี ─> handleRemoteConflict(remote)
        │      │      └─> ให้ผู้ใช้เลือก: ใช้ของเครื่อง / ใช้ของคลาวด์
        │      └─ ตรงกัน ─> ไปต่อ
        ├─> buildEncryptedRow(recoveryKey, payload, previousMeta)
        │      ├─> MTCryptoVault.deriveKey(recoveryKey, salt, {iterations:310000})
        │      ├─> MTCryptoVault.generateDataKey()
        │      ├─> MTCryptoVault.wrapDataKey(dataKey, passphraseKey)
        │      └─> MTCryptoVault.encryptVault(payload, dataKey)
        │             ├─> canonicalStringify(payload)   (คีย์เรียง → deterministic)
        │             ├─> crypto.subtle.encrypt AES-GCM
        │             └─> sha256Base64(plaintext) เป็น checksum
        ├─> fetch POST/PATCH /rest/v1/mt_user_vaults
        │      └─> RLS ตรวจ auth.uid() = user_id
        │             ├─ ผ่าน ─> 200/201
        │             └─ ไม่ผ่าน ─> 401/403
        └─> rememberAppliedVaultVersion(newVersion)
```

## 14.5 คำนวณรอบบิลและแสดงหน้า CC Detail

```
ผู้ใช้ แตะการ์ดบัตรเครดิต
  ▼
App.openCCDetail(cardId)
  ├─> walletById(cardId)
  ├─> App.getCreditCardDueInfo(card)
  │      └─> CreditCardCycles.getNextPayableDueInfo({card, transactions, refDate, rewardForTx, amountForTx, isPostedTx})
  │             └─> getPayableStatements()
  │                    └─> getStatementHistory({count:6})
  │                           └─> ต่อรอบ: getCardStatement()
  │                                  ├─> getStatementPeriod(card, cursor)
  │                                  │      └─> clampCycleDay + clampDay ตามจำนวนวันจริงของเดือน
  │                                  ├─> resolveDueDate(card, period.end)
  │                                  │      ├─ โหมด fixedDay ─> buildFixedDueDateForCycleEnd()
  │                                  │      │     └─> shiftBackwardsToBusinessDay()
  │                                  │      │            └─> isWeekendDateStr / isHolidayDateStr
  │                                  │      │                   └─> ThaiBankHolidays.has() + DEFAULT_THAI_BANK_HOLIDAYS_MMDD
  │                                  │      └─ โหมด afterCycle ─> addDays(end, dueAfterCycleDays)
  │                                  ├─> กรอง purchases (expense + posted + ในช่วง)
  │                                  ├─> กรอง payments (statementId ตรง หรือวันที่ในหน้าต่าง)
  │                                  ├─> คำนวณ purchaseTotal / paidTotal / balanceDue
  │                                  └─> รวม reward ผ่าน rewardForTx() ที่ส่งเข้ามา
  │                                         └─> App.getTransactionRewardEstimate(tx)
  ├─> App.getCreditLimitForCard(card) ─> อาจอ่าน S.creditLimitGroups
  ├─> App._getUnpostedInstallmentDebt(cardId)
  ├─> App.getInstallmentGroups() ─> กรองเฉพาะของบัตรนี้
  ├─> App._renderCCCycleContent / _renderCCCyclePager / _renderCCStatementPanel / _renderCCBenefitPanel
  ├─> App.openSubScreen(html)
  │      ├─> ss.innerHTML = html
  │      ├─> formatNumberInputsIn(ss)
  │      ├─> App._bindSubBackLongPress(ss)
  │      ├─> ผูก edge-swipe (ครั้งเดียวต่อ element)
  │      ├─> จัดการ animation (no-page-slide / suppress)
  │      └─> patched ─> pushLayer() ─> history.pushState()
  └─> App._bindCCCycleSwipe()  ผูกการปัดเปลี่ยนรอบบิล
```

## 14.6 บันทึกเร็วด้วยเสียง

```
ผู้ใช้ แตะไมค์
  ▼
App._qcMicStart(event)
  ├─> _setMicListening(true) ─> _injectQcStyles() ─> แสดง waveform
  └─> startListening(onResult, onError, onEnd)
        └─> new SpeechRecognition() {lang:'th-TH', interimResults:false, continuous:false}
              ▼
        เบราว์เซอร์/OS ─> ขอ permission ไมค์ (ถ้ายังไม่เคย)
              ├─ ปฏิเสธ ─> onerror('not-allowed') ─> toast('กรุณาอนุญาตการเข้าถึงไมค์')
              └─ อนุญาต ─> รับเสียง ─> onresult(transcript)
                    ▼
              เติมข้อความลง #qc-input ─> setTimeout 350ms ─> App._qcSubmit()
                    ▼
              parseQuickCapture(raw)
                    ├─> normalizeThaiDigits ─> replaceThaiNumbers (ตาราง 100+ คำ)
                    ├─> ตรวจ INCOME_KW ─> กำหนด type
                    ├─> extractDate ─> แปลง "เมื่อวาน"/"3 วันก่อน" เป็นวันที่จริง
                    ├─> _buildWalletMap(S.wallets) + _buildMerchantLookup(S.merchants)
                    ├─> matchWallet(text, wallets, wMap)   4 กลยุทธ์
                    ├─> extractAmount(text)                2 ระดับความสำคัญ
                    ├─> splitItemMerchant(remaining, fuzzyFind)
                    │      └─> fuzzyFind 4 ชั้น (exact ─> normalized ─> token ─> phonetic+Levenshtein)
                    ├─> App.getMerchantSuggestion(merchantName) ─> อาจเติมหมวด+กระเป๋าให้
                    ├─> inferCategoryId(item) ─> inferCategoryId(merchant) ─> inferCategoryId(raw)
                    └─> primaryWallet() เป็น fallback สุดท้าย
                    ▼
              _qcRenderPreview(result)
                    ▼
              ผู้ใช้ กด "บันทึก"
                    ├─> _applyToSxState(result) ─> เขียน S.tx ทั้งก้อน
                    ├─> App.closeQuickCapture()
                    └─> App.saveTx()   (เข้าเส้นทางเดียวกับ 14.1)
```

## 14.7 นำเข้าไฟล์ backup

```
ผู้ใช้ เลือกไฟล์
  ▼
App.importData(input)
  └─> Storage.importJSON(file, onSuccess, onError)
        ├─> ตรวจขนาด ≤ 10MB
        ├─> FileReader.readAsText
        └─> onload
              ├─> JSON.parse
              └─> Storage.normalizeBackupPayload(data)
                    ├─> _stripDangerousKeys (recursive: __proto__/constructor/prototype)
                    ├─> ตรวจ transactions/wallets เป็น array
                    ├─> aiInsightStore: ลบ action, กรอง insight ที่ไม่มี id
                    └─> เติม default ตาม BACKUP_DEFAULTS
        ▼
App._validateImportPayload(normalized)
  ├─> สร้าง walletIds Set
  ├─> validTypes = 8 ชนิด
  └─> กรอง transactions + สะสม warnings
        ▼
App.openImportPreview(result)
  └─> App.openSubScreen(html แสดง originalCount vs ที่ผ่าน + warnings)
        ▼
ผู้ใช้ กดยืนยัน
        ▼
App.confirmImportPayload()
  ├─> Storage.createLocalBackup(S, 'pre-import')
  │      └─> เขียน mt_local_backup_snapshots (rotation 3 ชุด, ลดเหลือ 2 ถ้าพื้นที่ไม่พอ)
  ├─> App._applyBackupPayload(data) หรือ _applyImportMergePayload(data)
  │      └─> เขียนทับทุก collection ใน S
  ├─> App.recalculateWalletBalances({save:false, recordSnapshot:true})
  ├─> persist()
  └─> App.render()
```

---

# SECTION 15 — Known Issues

ทุกข้อมีหลักฐานจากโค้ดจริง แยกตามหมวด

## 15.1 TODO / FIXME ที่มีอยู่

พบ TODO เพียง 3 จุด ทั้งหมดอยู่ใน `promo-search-worker/src/index.js`
- บรรทัด 120 — `// TODO: verify current URL for First Choice promotions`
- บรรทัด 147 — `// TODO: verify current URL for TTB promotions`
- บรรทัด 156 — `// TODO: verify current URL for AEON promotions`

ไม่พบ FIXME, HACK, หรือ XXX ในความหมายของหมายเหตุค้างงาน
(`XXXX-XXXX-...` ใน `auth_sync.js` เป็น placeholder ของ recovery key ไม่ใช่ TODO)

## 15.2 ความไม่สอดคล้องระหว่างโค้ดกับ Schema ฐานข้อมูล (ความรุนแรงสูง)

Edge Functions ทั้ง 3 ตัว (`register-notification-device`, `send-daily-expense-reminders`, `send-custom-notification-rules`)
อ่านและเขียนคอลัมน์ `push_subscription` ของตาราง `mt_notification_devices`
แต่ไม่พบ migration ใดในรีโพที่เพิ่มคอลัมน์นี้

ยิ่งกว่านั้น migration `202605140001` ยังนิยาม
```sql
fcm_token text not null unique
```
ซึ่งเป็น NOT NULL แต่ `register-notification-device` ไม่เคยส่งค่า `fcm_token` เลย
ถ้า schema จริงเป็นไปตาม migration ในรีโพ การ upsert อุปกรณ์จะล้มเหลวด้วย not-null violation

ข้อสรุป — schema จริงบนเซิร์ฟเวอร์ต้องถูกแก้ด้วยมือ (ผ่าน Supabase Studio) โดยไม่ได้บันทึกเป็น migration
ทำให้ไม่สามารถสร้างสภาพแวดล้อมใหม่จากรีโพนี้ได้ (`ไม่พบในโค้ด`: migration ที่เพิ่ม `push_subscription` และลบข้อจำกัดของ `fcm_token`)

## 15.3 RLS Policy ที่ขาดหายไป

`supabase/migrations/202606040003_notification_rls_policies.sql` สร้าง policy ให้ 4 ตาราง
- `mt_notification_devices` — for all
- `mt_notification_preferences` — for all
- `mt_notification_snapshots` — for all
- `mt_notification_logs` — select only

แต่ไม่มี policy สำหรับ `mt_notification_rules` ทั้งที่ตารางนี้ `enable row level security` ไว้ตั้งแต่ migration 202605140003
ผลคือผู้ใช้ที่ล็อกอินอ่านกฎแจ้งเตือนของตัวเองจาก REST API โดยตรงไม่ได้
(ในทางปฏิบัติแอปไม่ได้อ่านตารางนี้กลับ จึงยังทำงานได้ แต่เป็นช่องว่างของนโยบายที่ไม่ตั้งใจ)

## 15.4 โค้ดที่ไม่ถูกใช้งาน (Dead Code)

1. `supabase/functions/_shared/fcm.ts` (97 บรรทัด) — ไม่มี edge function ใด import `sendFcm`
   ทุกตัวใช้ `sendWebPush` แทน โค้ด FCM ทั้งชุดรวมถึงการ sign JWT ด้วย service account เป็น dead code
   และคอลัมน์ `fcm_message_id` ใน `mt_notification_logs` ถูกเซ็ตเป็น `null` เสมอ
2. `supabase/functions/send-delete-otp/index.ts` (96 บรรทัด) และตาราง `mt_delete_otps`
   — ไคลเอนต์ (`auth_sync.js`) ใช้ GoTrue `/auth/v1/reauthenticate` และ `/auth/v1/verify` แทน
   ไม่มีโค้ดใดเรียก `send-delete-otp` และไม่มี endpoint ที่ตรวจสอบ OTP ที่ฟังก์ชันนี้สร้าง
   ดังนั้นตาราง `mt_delete_otps` จะมีแถวค้างที่ไม่ถูกลบ ถ้ามีการเรียกฟังก์ชันนี้จากที่อื่น
3. `style_v2.css.bak` (6,575 บรรทัด) — ถูก track ใน git (ยืนยันจาก `git ls-files`) ไม่ถูกโหลดที่ใด
4. `App._computeWalletFlows` (บรรทัด 5248) — บอดี้ทั้งหมดเป็น dead code เพราะบรรทัดแรก
   `if (typeof App._ledgerFlows === 'function') return App._ledgerFlows()` จะคืนค่าเสมอในสภาพการทำงานจริง
5. `App.exportCSVLegacy` — ชื่อบ่งบอกว่าเป็นของเก่าที่ถูกแทนที่ด้วย `App.exportCSV`
6. มุมมองรายงาน `networth` — `renderReports` เวอร์ชันแรก (บรรทัด 6666) มี chip `['networth','📈 ความมั่งคั่ง']`
   และมีสาขา `if (S.rptView === 'networth')` (บรรทัด 6669, 6901) แต่เวอร์ชันหลัง (บรรทัด 18835 และ 23595)
   ไม่มี chip นี้แล้ว ผู้ใช้จึงเข้าถึงไม่ได้ผ่าน UI แต่โค้ดยังอยู่ (และถ้า `S.rptView` ค้างเป็น `networth` จากเซสชันเก่าจะได้หน้าที่ไม่มี chip ตรงกัน)
7. `App._selectWalletColor` (บรรทัด 1440) อ้างถึง `#wf-color` และ `#wf-color-row` — ต้องตรวจว่าฟอร์มกระเป๋าปัจจุบันยังใช้ id เหล่านี้อยู่หรือไม่
8. `find_dead_css.py` และ `remove_dead_css.py` (รวม 1,099 บรรทัด) เป็นเครื่องมือ one-off ที่อยู่ใน root ของโปรเจกต์
9. `ui_v2_preview.html` — หน้า preview ที่ไม่ถูกลิงก์จากที่ใด

## 15.5 โค้ดซ้ำซ้อน (Duplicate Code)

1. ฟังก์ชัน `esc()` ถูกนิยามอย่างน้อย 7 ที่ ด้วย 2 พฤติกรรมที่ต่างกัน
   - escape 5 ตัวรวม `'` — `App._esc`, `quick_capture.js`
   - escape 4 ตัวไม่รวม `'` — `bnpl.js` บรรทัด 8, `loans_v2.js` บรรทัด 19, `onboarding.js` บรรทัด 34,
     `app_v2.js` บรรทัด 5484 / 7706 / 17253
   นี่ไม่ใช่แค่ปัญหาความสะอาด แต่เป็นความเสี่ยง XSS จริง ถ้า template ใดใช้ single quote ครอบ attribute
   แล้วเรียก esc ตัวที่ไม่ escape `'`
2. `Calc.isPostedTx` (calculations.js:178) กับ `App._isPostedTx` (app_v2.js:5574) — ตรรกะเหมือนกันทุกบรรทัด
3. `Calc.isReimbursementTx` (calculations.js:198) กับ `App.isReimbursementTx` (app_v2.js:5834) — เหมือนกัน
4. `Calc.getCCPaymentCashAmount` (calculations.js:206) กับ `App.getCCPaymentCashAmount` (app_v2.js:5595) — เหมือนกัน
5. `App.getLedgerAmountForTx` กับ `App._expectedLedgerAmountForTx` — ต่างกันแค่บรรทัดแรก
6. `addMonths()` มี 2 implementation ที่ต่างกัน (`app_v2.js:5518` ใช้ `new Date(y, m-1+months, 1)` แล้ว clamp;
   `bnpl.js:21` คำนวณเดือน/ปีด้วยเลขคณิตแล้ว clamp) — ให้ผลเหมือนกันแต่ต้องดูแล 2 ที่
7. รายการวันหยุดธนาคารไทยอยู่ 2 ที่: `credit_card_cycles.js` (`DEFAULT_THAI_BANK_HOLIDAYS_MMDD`) และ `thai_bank_holidays.js`
8. `Calc.getMonthlyStats` กับ `Calc.getMonthlyIncomeExpense` คำนวณสิ่งเดียวกันแต่คืนโครงสร้างต่างกัน
   และมีพฤติกรรมต่างกันในกรณี `income === 0` (ตัวหนึ่งคืน `savingsRate: 0` อีกตัวคืน `null`)
9. `Calc.getNetWorth` กับ `Calc.getAssetBreakdown` ให้ตัวเลข net worth ที่อาจไม่ตรงกัน
   เพราะตัวแรกไม่กรอง `hiddenFromWalletList` และไม่รวมมูลค่า crypto portfolio ขณะที่ตัวหลังทำทั้งสองอย่าง
   ทั้งสองถูกใช้ในหน้าเดียวกัน (`renderDashboard` เรียกทั้ง `Calc.getNetWorth` และ `Calc.getUsableMoney`)

## 15.6 ฟังก์ชัน render ที่ถูกนิยามทับซ้อนหลายครั้ง

| ฟังก์ชัน | จำนวนครั้งที่ถูกนิยาม/ทับ | บรรทัด |
|---|---|---|
| `App.renderDashboard` | 5 + wrap อีก 1 (onboarding) | 874, 4211, 17426, 18755, 19199 |
| `App.renderReports` | 5 + wrap อีก 1 | 6646, 17644, 18807, 19256, และ patch ปฏิทิน 23583 |
| `App._renderAddTxDetail` | 4 | 3351, 15185, 18923, 19348 |
| `App.renderWallets` | 2 + wrap อีก 1 | 862, 14039 |
| `App.renderTransactions` | 1 + wrap อีก 1 (Wave 4) | 7446, 23681 |
| `App.renderTransactionsList` | 2 | 7472, 17473 |
| `App.renderMore` | 1 ใน app_v2 + เขียนทับโดย notifications_v2.js และ split_bill.js + wrap โดย onboarding.js | 23706 |
| `App.openAddTx` | 2 | 2834, 17354 |
| `App._renderAddTxAmount` | 2 | 2754, 18794 |

ผลกระทบ
- การหาว่าโค้ดไหนทำงานจริงต้องไล่ลำดับการโหลดและลำดับบรรทัด
- นิยามที่ถูกทับกลายเป็น dead code ที่ยังกินพื้นที่และทำให้เข้าใจผิดได้
- การแก้บั๊กในนิยามที่ถูกทับจะไม่มีผลใด ๆ
- `App.renderMore` ถูกเขียนทับโดย 3 ไฟล์ ทำให้พฤติกรรมขึ้นกับลำดับสคริปต์ล้วน ๆ

## 15.7 เวอร์ชันไม่ตรงกัน

- `app_v2.js` บรรทัด 893: `const APP_VERSION = '2026.06.23-credit-due-r107'`
- `index.html` บรรทัด 388: `app_v2.js?v=2026.07.23-fix-duplicate-tx-history-race`
- `service-worker_v2.js` บรรทัด 1: `2026.07.23-fix-duplicate-tx-history-race`

`APP_VERSION` ในโค้ดถูกใช้ใน 3 ที่: แสดงในหน้า More, ส่งเป็น `appVersion` ไปยังเซิร์ฟเวอร์แจ้งเตือน,
และเก็บใน `settings.storageMeta.appVersion` ที่ติดไปกับ backup
ผลคือเลขเวอร์ชันที่ผู้ใช้เห็นและที่ส่งขึ้นเซิร์ฟเวอร์ล้าหลังของจริงประมาณ 1 เดือน

## 15.8 ปัญหาด้าน Performance

1. `renderTransactionsList` สร้าง HTML ของทั้งเดือนแล้วเซ็ต `innerHTML` ครั้งเดียว — ผู้ใช้ที่มี 500+ รายการต่อเดือนจะเห็นการกระตุก
   ไม่มี virtualization ไม่มี pagination
2. `App.recalculateWalletBalances` วนทุกธุรกรรมทั้งหมดในระบบ และถูกเรียก 36 จุดในโค้ด
   รวมถึงถูกเรียกซ้ำจาก `_beforePersistV40` ทุกครั้งที่ `persist()` — คือ O(n) ต่อการบันทึกหนึ่งครั้ง
3. `Storage.saveAll` เขียน 31 คีย์ทุกครั้ง แม้จะเปลี่ยนแค่คีย์เดียว และแต่ละคีย์ยัง `getItem` กลับมาเทียบ (readback)
   ทำให้ค่าใช้จ่ายในการบันทึกหนึ่งครั้งคือ serialize + write + read ทั้ง dataset
4. `App._ledgerFlows` วนทุกธุรกรรมทุกครั้งที่เรียก และถูก wrap ด้วย loan flows อีกชั้น
5. `_registerMerchantFromTx` และ `refreshTransactionRewardEstimates` วนทุกธุรกรรมหลังบันทึกทุกครั้ง
6. MutationObserver ที่บรรทัด 1119 ผูกกับ `document.documentElement` แบบ `subtree: true`
   และเรียก `formatNumberInputsIn(node)` ทุก node ที่ถูกเพิ่ม — ทำงานทุกครั้งที่ render หน้าใหม่
7. `App.render()` ปิดท้ายด้วย `formatNumberInputsIn(document)` ซึ่ง query ทั้ง document
8. `getStatementHistory` เรียก `getCardStatement` 6 ครั้ง แต่ละครั้ง filter ทุกธุรกรรม = O(6n) ต่อบัตรหนึ่งใบ
   และแดชบอร์ดเรียกซ้ำสำหรับทุกบัตร
9. `promo-search-worker/node_modules` มีอยู่ในไฟล์ระบบ (แม้จะ gitignored) ทำให้การค้นหาไฟล์ในโปรเจกต์ช้า

## 15.9 ปัญหา Memory / Resource Leak ที่เป็นไปได้

1. MutationObserver ที่บรรทัด 1119 ไม่เคยถูก disconnect — อยู่ตลอดอายุของหน้า (โดยเจตนา แต่ควรรับรู้)
2. `App._merchantDropdownPositionFrame` — `requestAnimationFrame` loop สำหรับตำแหน่ง dropdown
   ถ้าไม่ถูกยกเลิกเมื่อปิด dropdown จะวนต่อไป
3. `document.addEventListener('pointerdown', ..., true)` และ `submit` / `keydown` ที่บรรทัด 1112–1116 ผูกถาวร
4. `setTimeout` ที่ใช้ลบ toast (3000ms) — ถ้าผู้ใช้แตะปิดเองก่อน `el.remove()` จะถูกเรียกซ้ำโดยไม่มีผลเสีย (ปลอดภัย)
5. `overlayCloseTimer` ใน `app_lock.js` ถูก `clearTimeout` ทุกครั้งที่ `setOverlay` ถูกเรียก (จัดการถูกต้องแล้ว)
6. Event listener ที่ผูกกับ element ใน `innerHTML` จะถูกทิ้งพร้อม element (ไม่ leak) แต่ listener ที่ผูกกับ
   `document` / `window` ในบล็อกที่รันซ้ำได้ อาจถูกผูกซ้ำ — ระบบใช้ flag เช่น `ss._edgeSwipeReady`, `btn.dataset.bound`, `backBtn._mtLongBackReady` เพื่อกัน ซึ่งครอบคลุมกรณีที่รู้จัก

## 15.10 ความเสี่ยงด้านความปลอดภัย

1. XSS จากฟังก์ชัน escape ที่ไม่สม่ำเสมอ (ดู 15.5 ข้อ 1) — ความเสี่ยงจำกัดเพราะข้อมูลมาจากผู้ใช้เอง
   แต่ไฟล์ backup ที่ผู้ใช้ได้รับจากคนอื่นเป็นช่องทางนำข้อมูลจากภายนอกเข้ามาได้
2. CSP ต้องใช้ `'unsafe-inline'` ใน `script-src` เพราะทั้งแอปใช้ `onclick=` inline — ทำให้ CSP แทบไม่ช่วยกัน XSS
3. `send-daily-expense-reminders` และ `send-custom-notification-rules` ไม่ตรวจ authentication ใด ๆ
   ใครก็ตามที่รู้ URL และมี anon key (ซึ่งเป็น public) สามารถยิงให้ส่งแจ้งเตือนได้
   ผลกระทบถูกจำกัดด้วย dedupe key (ส่งซ้ำในวัน/หน้าต่างเดิมไม่ได้) แต่ยังเป็นช่องให้ทำ resource exhaustion
4. anon JWT ถูก hard-code ในไฟล์ migration 2 ไฟล์ (`202605140002`, `202605140004`)
   — anon key เป็นค่าสาธารณะโดยออกแบบ แต่การฝังในไฟล์ทำให้หมุนเวียนคีย์ยาก (ต้องแก้ migration แล้วรันใหม่)
5. `notification_config.js` ที่ commit ไว้มี Supabase URL และ anon key ของ production จริง
   (ไฟล์เขียนกำกับว่าเป็น placeholder และ CI จะเขียนทับ แต่ค่าที่อยู่จริงคือค่า production)
6. `MT_PROMO_SEARCH_ENDPOINT` hard-code ใน `index.html` — ใครก็เรียก endpoint นี้ได้ อาจทำให้โควตา Gemini ถูกใช้หมด
7. App Lock ไม่ใช่ security boundary — `MTAppLock.start()` เรียก `init()` ทันทีแม้ยังล็อกอยู่ (บรรทัด 390–393)
   ข้อมูลถูกโหลดเข้าหน่วยความจำและ DOM ถูก render เบื้องหลัง ใครที่เปิด devtools ได้ก็อ่านข้อมูลได้
8. `rescue.html` เข้าถึงและเขียน localStorage ได้โดยไม่ผ่าน App Lock
9. `Storage.reset()` ลบเฉพาะคีย์ใน `KEYS` — คีย์อื่นอีกกว่า 20 คีย์ (App Lock config, auth state, recovery key,
   notification install id) ยังคงอยู่หลัง "รีเซ็ตข้อมูลทั้งหมด"
10. `promo-search-appscript.js` และ Cloudflare Worker ดึง HTML จากเว็บธนาคารมา parse — ถ้าเว็บถูกแทรกเนื้อหา
    ข้อมูลนั้นจะไหลเข้าสู่ AI extractor และกลายเป็นกฎสิทธิประโยชน์ในแอป (ผู้ใช้ต้องตรวจก่อนบันทึกเสมอ)
11. CORS whitelist ไม่มีพอร์ต 8765 ซึ่งเป็นพอร์ต dev ที่ `CLAUDE.md` และ `.claude/launch.json` กำหนด
    ทำให้การทดสอบ edge function ในเครื่องล้มเหลวโดยไม่มีสาเหตุที่ชัดเจน

## 15.11 ปัญหาด้าน Accessibility

1. zoom lock (`app_v2.js` บรรทัด 10–81) ขัดกับ WCAG 2.1 SC 1.4.4
2. ไม่พบ focus trap ใน overlay/sheet
3. ไม่พบการคืน focus เมื่อปิด overlay
4. ไม่พบ `prefers-reduced-motion` ทั้งที่มี animation suite ขนาดใหญ่
5. จุดแสดง PIN บนจอล็อกมี 6 จุดตายตัว ไม่สะท้อน PIN ที่ยาวกว่านั้น (`app_lock.js` `keypadHtml` และ `refreshKeypad` ใช้ `MIN_PIN_LENGTH`)
6. emoji ถูกใช้เป็นไอคอนสื่อความหมายจำนวนมากโดยไม่มีข้อความทางเลือก

## 15.12 ปัญหาเชิงกระบวนการ

1. CI ไม่รันเทสต์ — `.github/workflows/deploy.yml` มีเพียง generate config → configure-pages → upload → deploy
   ทั้งที่มีเทสต์ 26 ไฟล์ที่รันได้ด้วย `node --test tests/`
2. ไม่มี lint / formatter — ไม่พบ `.eslintrc`, `.prettierrc`, หรือ config ใด ๆ
3. ไม่มี `package.json` ที่ระดับ root (มีเฉพาะใน `promo-search-worker/`)
4. ไม่มี type checking (ไม่มี TypeScript หรือ JSDoc type annotation ที่เป็นระบบ) ยกเว้นฝั่ง Supabase Edge Functions
5. `supabase/.temp/` ถูกเก็บอยู่ในโปรเจกต์ (มีไฟล์ว่าง 9 ไฟล์) — เป็น artifact ของ Supabase CLI
6. `.superpowers/` และ `.codex-ui-audit/` เป็น artifact ของเครื่องมือพัฒนาที่ปนอยู่ในรีโพ
7. `codex-skills/` เป็น git repository ซ้อนใน git repository

## 15.13 ปัญหาเชิงตรรกะที่พบจากการอ่านโค้ด

1. `Calc.getAssetBreakdown` ตัดยอดติดลบของกระเป๋าเงินสด/ธนาคารทิ้ง (`max(0, value)`)
   ถ้าบัญชีธนาคารติดลบจริง (overdraft) จะไม่ถูกนับเป็นหนี้สิน ทำให้ net worth สูงเกินจริง
2. `Calc.getNetWorth` และ `Calc.getAssetBreakdown` ใช้กติกาต่างกัน จึงให้ตัวเลขต่างกันบนหน้าจอเดียวกันได้
3. `Storage.init()` ไม่โหลด 6 คีย์ที่อยู่ใน `KEYS` (`aiInsightStore`, `financialMemory`, `monthlyFinancialFeatures`,
   `financialRecommendationFeedback`, `financialActionLog`, `financialLifePlans`) และ `saveAll` ก็ไม่เขียน
   ทำให้ `S` ไม่มีฟิลด์เหล่านี้ แต่ `buildExportPayload` ยังพยายามอ่านจาก `state[key]` (จะได้ค่า default)
   โดยมี special case อ่าน `aiInsightStore` จาก localStorage ตรง ๆ เพียงตัวเดียว
   ผลคือ **ข้อมูล financial memory / life plans / action log อาจไม่ถูกรวมใน backup อย่างถูกต้อง**
4. `Storage.buildExportPayload` มี special case อ่านจาก localStorage ตรงสำหรับ
   `splitBills, splitPeople, splitBillDraft, loans, bnplPlans` — บ่งชี้ว่าเคยมีปัญหาข้อมูลใน `S` ไม่ตรงกับ localStorage
5. `App.getSharedReceivableForTx` เมื่อไม่พบ tx จะคืน object ที่มี `status: 'orphaned'` แต่ค่าอื่นเป็น 0
   — เป็นการจัดการที่ดี แต่ไม่มีที่ใดใน UI แสดงสถานะ orphaned นี้
6. `BNPLStore.payInstallment` และ `payoffAll` คืน `null` เงียบ ๆ เมื่อประเภทกระเป๋าไม่ถูกต้อง
   และ `BNPLui.openPayModal` ก็ `return` เงียบเมื่อไม่พบแผนหรืองวดจ่ายแล้ว — ผู้ใช้จะกดปุ่มแล้วไม่มีอะไรเกิดขึ้น
7. ประเภทกระเป๋า `saving` และ `crypto` ถูกใช้ในตรรกะการคำนวณหลายที่
   (`getSpendableCashWallets`, `getAssetBreakdown`, `TRANSFERABLE_MONEY_TYPES`, `_walletOptions` ใน loans/bnpl)
   แต่ไม่มีในรายการ `TYPES` ของฟอร์มสร้างกระเป๋า (`app_v2.js` บรรทัด 10757)
   ผู้ใช้จึงสร้างกระเป๋าประเภทนี้ผ่าน UI ไม่ได้ — จะมีได้ก็ต่อเมื่อ import เข้ามา
8. `App.getSharedExpenseSettlement` เป็น wrapper บาง ๆ ของ `getSharedReceivableForTx` ที่คืน subset ของฟิลด์
   — เพิ่ม indirection โดยไม่จำเป็น
9. `hasPaymentForCreditDue` ใช้หน้าต่าง "3 วันย้อนหลัง" เป็น fallback ซึ่งอาจทำให้ alert หายไป
   ถ้าผู้ใช้ชำระบัตรใบอื่นในช่วงเดียวกัน (ตรวจเฉพาะ `toWalletId` ตรงกัน จึงไม่น่าเกิด แต่ logic ซับซ้อนพอที่จะพลาดได้)
10. `MTAppLock.start` เรียก `callback()` สองครั้งไม่ได้ (มี `appStarted` guard) แต่โครงสร้างที่เรียก `callback()`
    ทั้งในสาขา "ไม่ได้เปิด App Lock" และในสาขา "เปิดอยู่" ทำให้อ่านแล้วเข้าใจผิดว่าเป็นการล็อกจริง

## 15.14 เอกสารที่ไม่ตรงกับโค้ด

`CLAUDE.md` ระบุในตารางโมดูลบริวารว่า
```
| crypto_vault.js | — | IIFE, adds crypto portfolio |
```
แต่ `crypto_vault.js` จริง ๆ คือชุดฟังก์ชันเข้ารหัส (PBKDF2/AES-GCM) สำหรับ cloud sync
ไม่เกี่ยวกับพอร์ตคริปโตเลย โค้ดพอร์ตคริปโตอยู่ใน `app_v2.js` บล็อก "Centralized crypto portfolio" (บรรทัด 12733)

`CLAUDE.md` ยังระบุ `App._ledgerFlows` อยู่ที่บรรทัด ~5377 แต่จริง ๆ อยู่ที่ 5628
และระบุ `saveTx` ที่ ~5860 แต่จริง ๆ อยู่ที่ 6018 (เอกสารล้าหลังการเปลี่ยนแปลง)

---

# SECTION 16 — Improvement Suggestions

## High Priority

### H-1 แก้ความไม่สอดคล้องของ schema ฐานข้อมูลแจ้งเตือน
- ปัญหา — โค้ดใช้คอลัมน์ `push_subscription` ที่ไม่มีใน migration และ `fcm_token` ยังเป็น NOT NULL
- เหตุผล — สร้างสภาพแวดล้อมใหม่จากรีโพนี้ไม่ได้ ระบบแจ้งเตือนจะพังทันทีที่ deploy ใหม่
- แนวทาง — เขียน migration ใหม่ที่ `add column if not exists push_subscription jsonb`,
  `alter column fcm_token drop not null` (หรือ drop คอลัมน์ถ้าเลิกใช้ FCM แล้ว)
  แล้วตรวจสอบ schema จริงบน production ให้ตรงกับ migration

### H-2 เพิ่ม RLS policy ให้ `mt_notification_rules`
- ปัญหา — RLS เปิดแต่ไม่มี policy = ปฏิเสธทุกอย่างสำหรับ authenticated
- แนวทาง — เพิ่ม policy รูปแบบเดียวกับอีก 3 ตาราง

### H-3 รันเทสต์ใน CI
- ปัญหา — มีเทสต์ 26 ไฟล์แต่ไม่มีอะไรบังคับให้ผ่านก่อน deploy
- แนวทาง — เพิ่ม step `- run: node --test tests/` ก่อน `upload-pages-artifact`
  และเพิ่ม step ตรวจว่า `APP_VERSION` ใน `app_v2.js` ตรงกับ `?v=` ใน `index.html`
- เหตุผล — เทสต์ที่เขียนไว้แล้วให้คุณค่าเป็นศูนย์ถ้าไม่มีอะไรรันมัน

### H-4 รวมฟังก์ชัน escape ให้เหลือตัวเดียว
- ปัญหา — 7 implementation, 2 พฤติกรรม, บางตัวไม่ escape single quote
- แนวทาง — ย้าย `esc()` ที่ escape ครบ 5 อักขระไปไว้ใน `calculations.js` (โหลดก่อนทุกโมดูล)
  แล้วให้ทุกโมดูลเรียกใช้ตัวเดียวกัน; ขยาย `tests/xss_escape_holes_static.test.js` ให้ตรวจว่าไม่มีการนิยาม esc ซ้ำ

### H-5 เพิ่ม authentication ให้ edge function ที่ส่งแจ้งเตือน
- ปัญหา — `send-daily-expense-reminders` และ `send-custom-notification-rules` เปิดให้ใครก็ยิงได้
- แนวทาง — ใช้ shared secret ใน header ที่ pg_cron แนบมา แล้วตรวจในฟังก์ชัน
  (Supabase รองรับการเก็บ secret ใน vault และอ้างอิงใน cron job)

### H-6 แก้เวอร์ชันที่ไม่ตรงกัน
- ปัญหา — `APP_VERSION` ในโค้ดล้าหลัง 1 เดือน มีผลต่อข้อมูลที่ส่งขึ้นเซิร์ฟเวอร์และที่ผู้ใช้เห็น
- แนวทาง — สร้างจุดเดียวของความจริง เช่นไฟล์ `version.js` ที่ทั้ง `index.html`, `app_v2.js` และ SW อ่านร่วมกัน
  หรืออย่างน้อยเพิ่ม test ที่บังคับให้ตรงกัน

### H-7 แก้ปัญหาข้อมูล Finance Intelligence ไม่ถูกโหลด/บันทึกผ่าน Storage
- ปัญหา — 6 คีย์อยู่ใน `KEYS` และ `BACKUP_SCHEMA_KEYS` แต่ `init()` ไม่โหลดและ `saveAll()` ไม่เขียน
  ทำให้ backup อาจไม่มีข้อมูล memory / life plans / action log จริง
- แนวทาง — เลือกทางใดทางหนึ่งอย่างชัดเจน
  (ก) เพิ่มการโหลด/บันทึกใน `Storage.init` และ `saveAll` ให้ครบตามที่ `CLAUDE.md` กำหนด 5 touch point
  (ข) หรือถ้าตั้งใจให้โมดูลจัดการเอง ก็ให้ `buildExportPayload` อ่านจาก localStorage ตรงเหมือนที่ทำกับ `aiInsightStore`
  ทางที่ปลอดภัยกว่าคือ (ข) เพราะกระทบโค้ดน้อยและแก้ปัญหา backup ได้ทันที

### H-8 ทำให้ `Storage.reset()` ล้างข้อมูลได้จริง
- ปัญหา — "รีเซ็ตข้อมูลทั้งหมด" ทิ้งคีย์ไว้กว่า 20 คีย์ รวมถึง recovery key และ auth state
- แนวทาง — วน `localStorage` ลบทุกคีย์ที่ขึ้นต้นด้วย `mt_` และ `MT_` พร้อมยืนยันกับผู้ใช้ให้ชัดว่าจะลบอะไรบ้าง

## Medium Priority

### M-1 ยุบฟังก์ชัน render ที่ถูกนิยามซ้ำ
- ปัญหา — `renderDashboard` 5 ตัว, `renderReports` 5 ตัว, `_renderAddTxDetail` 4 ตัว
- แนวทาง — ไล่ตรวจว่านิยามใดทำงานจริง (ตัวสุดท้าย) แล้วลบตัวที่ตายทิ้ง
  เริ่มจาก `_renderAddTxDetail` ที่เสี่ยงที่สุดเพราะเป็นฟอร์มหลัก
- ควรทำทีละตัวพร้อมเทสต์ static ที่ตรวจว่าเหลือนิยามเดียว

### M-2 แยก `app_v2.js` ออกเป็นไฟล์ตามโดเมน
- ปัญหา — 24,720 บรรทัดในไฟล์เดียว, 58 บล็อก IIFE
- แนวทางที่ทำได้โดยไม่ต้องมี build step — แยกเป็นไฟล์ตามแบนเนอร์ที่มีอยู่แล้ว
  (`app_core.js`, `app_transactions.js`, `app_wallets.js`, `app_credit.js`, `app_reports.js`, `app_finance.js`, `app_animation.js`)
  แล้วโหลดเรียงกันใน `index.html` เหมือนเดิม
- ประโยชน์ — ลดเวลาที่ใช้ค้นหาโค้ด, ลด merge conflict, ทำให้ SW cache ไฟล์ที่ไม่เปลี่ยนได้

### M-3 ลด O(n) ในการบันทึก
- ปัญหา — ทุก `persist()` เรียก recalc ทั้งระบบและเขียน 31 คีย์พร้อม readback
- แนวทาง — เก็บ dirty flag ต่อ collection แล้วเขียนเฉพาะที่เปลี่ยน;
  ทำ readback verify เฉพาะคีย์ที่เขียนจริง; แคชผลของ `_ledgerFlows` แล้ว invalidate เมื่อ transactions เปลี่ยน

### M-4 เพิ่ม virtualization หรือ pagination ให้หน้ารายการ
- ปัญหา — render ทั้งเดือนพร้อมกัน ไม่มีขีดจำกัด
- แนวทาง — render 50 แถวแรกแล้วเพิ่มเมื่อ scroll (IntersectionObserver) — ทำได้โดยไม่ต้องใช้ไลบรารี

### M-5 รวมฟังก์ชันที่ทำงานซ้ำกัน
- `isPostedTx`, `isReimbursementTx`, `getCCPaymentCashAmount` (อย่างละ 2 ที่)
- `fmtDate`, `money`, `today`, `addMonths` ในโมดูลบริวาร
- วันหยุดธนาคารไทย 2 แหล่ง
- แนวทาง — ให้ `calculations.js` เป็นเจ้าของทั้งหมด แล้วให้โมดูลอื่นเรียกใช้

### M-6 ทำให้ `Calc.getNetWorth` และ `Calc.getAssetBreakdown` ให้ผลตรงกัน
- ปัญหา — ทั้งคู่คำนวณ net worth ด้วยกติกาต่างกัน และถูกใช้ในหน้าเดียวกัน
- แนวทาง — ให้ `getNetWorth` เรียก `getAssetBreakdown` ภายในแล้วคืน subset

### M-7 เพิ่ม draft ให้ฟอร์มบันทึกรายการ
- ปัญหา — ปิด overlay = ข้อมูลหายหมด ขณะที่หารบิลมี draft
- แนวทาง — บันทึก `S.tx` ลง localStorage เมื่อปิดโดยที่ยังมีข้อมูล แล้วถามผู้ใช้ตอนเปิดครั้งถัดไป

### M-8 เพิ่ม route ให้ sub-screen
- ปัญหา — 50+ หน้าไม่มี URL แชร์ไม่ได้ รีเฟรชแล้วหลุด
- แนวทาง — ขยาย hash routing ให้รองรับ `#more/goals` หรือใช้ `?open=` ที่มีอยู่แล้วให้ครบทุกหน้า
  (ระบบ back-button ที่มีอยู่แล้วทำให้การเพิ่มนี้ปลอดภัยขึ้นมาก)

### M-9 แก้ปัญหา Accessibility ที่กระทบผู้ใช้จริง
- เพิ่ม focus trap และการคืน focus ใน overlay
- เพิ่ม `@media (prefers-reduced-motion: reduce)` ปิด animation
- แก้จุด PIN ให้สะท้อนความยาวจริง
- พิจารณาผ่อนคลาย zoom lock (อนุญาต zoom แต่กัน double-tap zoom โดยไม่ตั้งใจ)

### M-10 ให้ feedback เมื่อการกระทำล้มเหลวเงียบ ๆ
- `BNPLui.openPayModal` และ `BNPLStore.payInstallment` คืน `null` เงียบ
- แนวทาง — เพิ่ม toast อธิบายเหตุผลทุกจุดที่ return เงียบในเส้นทางที่ผู้ใช้กดปุ่ม

### M-11 ลบ dead code ที่ยืนยันแล้ว
- `_shared/fcm.ts` (ถ้ายืนยันว่าไม่ใช้ FCM แล้ว)
- `send-delete-otp` + ตาราง `mt_delete_otps` (ถ้ายืนยันว่าใช้ GoTrue reauthenticate แทน)
- `style_v2.css.bak`
- บอดี้ของ `App._computeWalletFlows`
- สาขา `networth` ในรายงาน (หรือคืน chip กลับมา)
- `App.exportCSVLegacy`

### M-12 เพิ่มพอร์ต 8765 ใน CORS whitelist
- ให้ตรงกับ dev server ที่ `CLAUDE.md` และ `.claude/launch.json` กำหนด

### M-13 ปรับหน้า Dashboard ให้แน่นน้อยลง
- จำกัด alert ที่แสดงพร้อมกันไม่เกิน 2 บล็อก ที่เหลือรวมเป็น "ดูทั้งหมด (N)"

## Low Priority

### L-1 เพิ่ม lint และ formatter
- ESLint config พื้นฐาน + Prettier จะจับ dead code, ตัวแปรที่ไม่ได้ใช้, และ shadowing ได้อัตโนมัติ

### L-2 เพิ่ม JSDoc type annotation ให้ฟังก์ชันสาธารณะ
- เริ่มจาก `calculations.js`, `credit_card_cycles.js`, `storage_v2.js` ซึ่ง pure และเป็น API ที่คนอื่นเรียก
- ใช้ `// @ts-check` ที่หัวไฟล์เพื่อให้ editor ตรวจให้โดยไม่ต้องแปลงเป็น TypeScript

### L-3 ย้าย inline style ที่ซ้ำบ่อยไปเป็นคลาส
- โดยเฉพาะใน `loans_v2.js`, `bnpl.js`, `onboarding.js` ที่แทบไม่ใช้คลาสเลย
- ทำให้สอดคล้องกับ `UI_DESIGN_SPEC.md` และลดขนาด HTML string

### L-4 แทน hardcode hex ด้วย design token
- `#6c48c5`, `#22c55e`, `#ef4444`, `#FCA5A5`, `#D97706` และอื่น ๆ ในโมดูลบริวาร

### L-5 ย้าย artifact ของเครื่องมือออกจากรีโพ
- `.superpowers/`, `.codex-ui-audit/`, `supabase/.temp/`, `codex-skills/`, `reports-coach-sheet-r56.png`
- ย้ายไป `.gitignore` หรือเก็บนอกโปรเจกต์

### L-6 เพิ่มเทสต์พฤติกรรมสำหรับ ledger engine
- ปัจจุบัน `_ledgerFlows` ผูกกับ `S` global จึงเทสต์ไม่ได้
- แนวทาง — refactor ให้รับ `transactions` และ `wallets` เป็นพารามิเตอร์ (เก็บ wrapper เดิมที่อ่าน `S` ไว้เพื่อความเข้ากันได้)
  แล้วเขียนเทสต์ครอบทุกชนิดธุรกรรม — นี่คือส่วนที่ผิดพลาดแล้วเสียหายที่สุดในระบบ

### L-7 เพิ่ม preset ให้ pipeline ของหารบิล
- preset "ร้านทั่วไป (+10% เซอร์วิส แล้ว +7% VAT)" และ "ร้านที่รวม VAT แล้ว"

### L-8 ปรับปรุงเอกสาร CLAUDE.md ให้ตรงกับโค้ด
- แก้คำอธิบาย `crypto_vault.js`
- อัปเดตเลขบรรทัดที่อ้างถึง (`_ledgerFlows` 5377 → 5628, `saveTx` 5860 → 6018)
- เพิ่มหมายเหตุว่าประเภทกระเป๋า `saving` และ `crypto` ไม่มีใน UI สร้างกระเป๋า

### L-9 เพิ่มปุ่ม 00 ใน numpad
- ผู้ใช้ไทยพิมพ์เลขหลักร้อย/พันบ่อย

### L-10 ทำให้พฤติกรรมหลังบันทึกสม่ำเสมอ
- ตอนนี้เพิ่มใหม่เด้งไปหน้ารายการ แต่แก้ไขอยู่ที่เดิม — เลือกอย่างใดอย่างหนึ่งให้ชัด
