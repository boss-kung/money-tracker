# Code audit รอบ 2 — แผน cleanup / แก้ bug

วันที่ 3 ตุลาคม 2026 · ต่อจาก [cleanup รอบแรก](CODE_CLEANUP_RESULTS.md) (release `r127`) · ฐานที่ตรวจ: release `2026.10.03-backnav-r130`

ผลการดำเนินการและการตรวจ regression อยู่ท้ายเอกสาร ([ผลลัพธ์](#ผลลัพธ์))

## วิธีตรวจ (trace runtime จริง ไม่ดูแค่ import)

| เครื่องมือ | สิ่งที่ตรวจ |
| --- | --- |
| AST trace ตามลำดับโหลดจริงของ `index.html` (acorn) | ทุก `App.*` definition (object literal, `App.x =`, `Object.assign`) ว่าตัวไหนชนะตอน runtime, ตัวไหนถูก wrap (`const prev = App.x`) และตัวไหนถูกเขียนทับโดยไม่มีใครเรียก |
| Reachability analysis | อ้างอิง `App.x` แบบ text (รวม `onclick="App.x()"` ใน template string) แล้วไล่ว่า member ไหนเข้าถึงได้จาก root จริง (top-level, HTML, event handler, ไฟล์อื่น) |
| Load-time call trace | `App.render*`/`persist` ที่รัน synchronous ระหว่างโหลดไฟล์ (`init()` ถูกเรียกกลาง `app_v2.js` บรรทัด ~2075) |
| ESLint `no-unused-vars` / `no-undef` (รวม global ข้ามไฟล์) | ตัวแปร/helper ที่ไม่ใช้ และการอ้างชื่อที่ไม่มีใน scope (ถูกกลืนด้วย `try/catch` หรือ `?.()`) |
| CSS scan (postcss) | selector ที่อ้าง class/id ที่ไม่มีโค้ดใดสร้างได้ (รวม class แบบ dynamic `` `is-${x}` ``) และ declaration ที่ถูก selector เดียวกันใน context เดียวกันทับเสมอ |
| Browser harness (Playwright, ข้อมูลสังเคราะห์, ปิด network ภายนอก) | DOM snapshot + computed-style fingerprint ของ 5 หน้า (boot ตรงผ่าน hash และหลังสลับหน้า) + 10 sheet/sub-screen, light/dark, production และ demo |

ทุกข้อด้านล่างตรวจ references/calls/inline handlers/demo/tests ก่อนจัดหมวด

## 1. Bug ที่ยืนยันแล้ว (แก้)

| # | จุด | อาการจริง (ยืนยันใน browser) | สาเหตุ | แก้ |
| --- | --- | --- | --- | --- |
| B1 | `App.openCryptoHoldingForm` (`app_v2.js` ~13205) | กด "＋ เพิ่มเหรียญ" ในหน้า Wallets แล้วไม่มีอะไรเกิดขึ้น: `ReferenceError: jsArg is not defined` | block Crypto ไม่มี `jsArg` ใน scope | ใช้ `MTSafeRender.jsArg` |
| B2 | `App.saveInstallmentGroupEdit` (~7281) | แก้ชุดผ่อนแล้วไม่บันทึก: `ReferenceError: nowISO is not defined` | block V4.2 ไม่มี `nowISO` | ใช้ timestamp ISO ใน block นั้น |
| B3 | `saveTx` catch (~5740) | เมื่อบันทึกล้มเหลว ผู้ใช้ไม่เห็น toast error เลย: catch เองโยน `ReferenceError: notify is not defined` | block ไม่มี `notify` | ใช้ `toast()` แบบเดียวกับ success path |
| B4 | นำเข้าโปรบัตรด้วย parser (~8619) | โปรที่มีข้อความหมวดหมู่ทำให้ import ล้ม: `inferCategoryIdsFromText is not defined` | ฟังก์ชันอยู่คนละ block (14345) และไม่ถูกใช้ที่นั่น | expose เป็น `App._inferCategoryIdsFromText` แล้วเรียกผ่าน App |
| B5 | Sheet รายการตามกฎสิทธิ์ (~9610, ~9647) | การแบ่ง cap ต่อร้านค้าใน sheet ไม่ตรงกับ engine เมื่อชื่อร้านต่างกันแค่ช่องว่าง/zero-width | `typeof normalizeCompareText` เป็น false เสมอ จึงใช้แค่ `toLowerCase()` | ใช้ normalizer ตัวเดียวกับ engine (`App._normalizeCompareText`) |
| B6 | Spending calendar / day sheet / daily budget chip (~23110, ~23212, ~23600) | ช่วง 00:00–06:59 เวลาไทย "วันนี้" และเดือนปัจจุบันเป็นของเมื่อวาน (UTC) | `typeof today === 'function'` เป็น false เสมอ → fallback `toISOString()` | ใช้ `getTODAY()` (local date) |
| B7 | hook `budgets.capture-month` (~23676) | ถ้า draft ไม่มีวันที่ hook โยน ReferenceError และ budget check หลังบันทึกไม่ทำงาน | `today` ไม่มีใน scope | ใช้ `getTODAY()` |
| B8 | Wallet form ทอง/FCD (~10543) | มีกล่องขอบว่างสูง 22px ใต้ช่องราคาสำรอง | `#wf-market-price-link` ถูกเติมโดย `syncInvestmentWalletForm` ซึ่งอยู่คนละ scope และไม่เคยรันได้ | ลบกล่องว่าง + helper ที่ตาย (ดู D) — ฟีเจอร์ price box ไม่เคยทำงานใน UI ปัจจุบัน |
| B9 | Wallet form `wf-symbol` (~10540) | ค่า symbol ที่มี `"` ทำให้ attribute แตก | ใส่ user input ลง `value="..."` โดยไม่ escape | ใช้ `esc()` |
| B10 | Notification deep link ตอน cold start (`init()`) | กดแจ้งเตือนที่เปิด `#more?open=goals` / `budgets` / `upcomingBills` / `addTx` แล้วไปแค่หน้า More ไม่เปิดหน้าย่อย | `showPage()` เขียน hash ใหม่เป็น `#more` ก่อน `parseAppHashRoute()` รอบสองจะอ่าน `open=` | ใช้ route ที่ parse ไว้ต้น `init()` |
| B11 | วันที่ UTC อีกหลายจุด (พบระหว่างแก้ B6) | ช่วง 00:00–06:59 ช่วง "3 เดือน" ใน wallet, ป้าย "เมื่อวาน", รอบ sheet สิทธิ์บัตร และเดือนปัจจุบันของ Monthly Review เลื่อนไปหนึ่งวัน/เดือน | ใช้ `toISOString().slice()` | ใช้ `getTODAY()` / `getTHISMONTH()` / `_localDateStr()` |
| B12 | ค่าคงที่ `TODAY` / `THIS_MONTH` ตอน runtime | เปิดแอปค้างข้ามวัน (iOS PWA) แล้วกด "ทำซ้ำ" รายการ ได้วันที่ของวันที่เปิดแอป; Monthly Review/Finance month ค้างเดือนเก่า | ค่าคงที่คำนวณครั้งเดียวตอนโหลด (`sample-data_v2.js` เองระบุว่าห้ามใช้ตอน runtime) | ใช้ `getTODAY()` / `getTHISMONTH()` |

## 2. โค้ดเก่าที่ถูกเขียนทับแล้ว (ลบ/รวม)

| Member | เวอร์ชันที่ตาย | เวอร์ชันที่ชนะ | เหตุผล |
| --- | --- | --- | --- |
| `openInstallmentCenter` | 7294 | 17379 | ถูกแทนที่ก่อนมีผู้เรียก |
| `markCashbackReceived` (dialog 41 บรรทัด) + `_v45ConfirmCashback` + alias 11196 | 10030–10105, 11196 | `recordActualRewards` | dialog ถูกแทนด้วย alias และ alias เองไม่มีผู้เรียก |
| `importData` | 16465 | 16917 (preview + merge/replace) | ถูกแทนที่ก่อนมีผู้เรียก |
| `getSharedExpenseReimbursements` / `getSharedExpenseSettlement` / `_syncSharedExpenseSettlement` | สำเนาที่ 23937–23971 | เก็บตัวที่ 5398–5493 (คู่กับ `getSharedReceivableForTx`) | logic เท่ากันสำหรับ tx id จริง; สำเนาท้ายไฟล์มี `|| t.type === 'income'` ที่ซ้ำซ้อนและอันตรายถ้า id ว่าง → เพิ่ม guard id ว่าง |
| `_investmentUnitPriceTHB` / `_investmentValueTHB` | สำเนาที่ 10005–10025 | ตัวแรก 2161 (ใช้ระหว่าง boot render อยู่แล้ว) | logic เหมือนกัน |
| `openOverlay` / `closeOverlay` | stub ใน `const App = {}` | implementation ใน Animation Suite | ย้าย implementation จริงเข้า App literal ที่เดียว ลบตัว override; wrapper เชิงฟีเจอร์ (handle pulse, swipe reset, back-nav) คงเดิม |
| `App.ensureCreditBillingMetadata` | 16075 | `persist()` ทำงานเดียวกันทุกครั้ง | ไม่มี production caller; ย้าย test ให้ทดสอบ rollback ของ `persist()` จริงแทน |

## 3. Dead code (ลบ)

**App members ที่ไม่มีทางเข้าถึง** (ไม่มี caller, ไม่มี inline handler, ไม่มีใน demo/tests):
`_applyBalance`, `_selectWalletColor`, `replaceSubScreen` (App literal, ledger เป็น source of truth แล้ว) · alias ที่ไม่มีผู้ใช้ `_jsArg`, `_fmtMoney`, `_fmtSignedMoney`, `_getTransferableWallets`, `_isTransferableWallet`, `_normaliseThaiGoldPayload`, `_fetchAuroraGoldViaProxy`, `_resolveCardDueDate`, `_shiftBackwardsToBusinessDay`, `_buildFixedDueDateForCycleEnd`, `_isHolidayDateStr`, `_isWeekendDateStr`, `_normalizeHolidayEntries`, `exportCSVCanonical`, `saveCreditOpeningDate`, `setCategoryColor` · ฟังก์ชันไม่มีผู้เรียก `_parseAuroraGold`, `getFinancialAdvisorInsights`, `showAllTxCategories`, `hideAllTxCategories`, `_getMostRecentWallet`, `insightRate`, `_showRescueBannerIfNeeded`, `openAdjustPointsForm` + `saveAdjustPoints`, `openSplitBillFromAddTx`, `getSplitBillLinkState` (`split_bill.js`), `_qcMicStop` (`quick_capture.js`), `syncCustomNotificationRules`, `syncNotificationSnapshot` (`notifications_v2.js`; background sync ยังใช้ฟังก์ชันภายในเดิม) · หน้าจอ Finance ที่ไม่มีปุ่มเข้า `openFinanceCoachProfile`, `openScenarioCompare`, `openProactiveBrief`, `openFeedbackAnalytics` และ panel ที่ใช้เฉพาะหน้าเหล่านั้น `_financeForecastBoard`, `_financeBehaviorBoard`, `_financeAssumptionEditor`, `renderFinanceAssumptionPreview`, `_financeLearningPanel`

**ตัวแปร/helper ภายใน block ที่ไม่ใช้** (ESLint 79 จุด เช่น `clampPct`, `numFmt`, `AURORA_GOLD_URL`, `TX_TYPE_LABELS`, `reimbursementInflow`, `fallbackFailedIds`) และ helper ที่ตายตามมาหลังลบข้างบน — ลบเฉพาะที่ initializer ไม่มี side effect

**Fallback ที่ไม่มีวันรัน**: `App._esc || (...)` ~20 จุดหลัง `App._esc` ถูกตั้งแล้ว; `getRuleEligibility`/`txShouldCountForRule` fallback (อ้างชื่อนอก scope); `typeof visibleWallets` (ไม่เคยมีใน scope); `?? isPrivilegeExpired(...)` (summary คืนตัวเลขเสมอ); `typeLabel` identity map ใน CSV export; boot calls `_renderAddTxDetail/_renderAddTxAmount` ที่เงื่อนไขเป็น false เสมอระหว่างโหลด

**เก็บไว้โดยตั้งใจ**: `debugBenefitRule`, `debugDashboardCreditAlerts`, `_lastRuleTransactionsDebug` (developer diagnostics; ตัวหลังมี test); `ui_v2_preview.html`, `find_dead_css.py`, `remove_dead_css.py`, `.codex-ui-audit/`, `codex-skills` (ไฟล์ทำงานของผู้ใช้ที่ cleanup รอบแรกเลือกเก็บ); migration/recovery/backend ทั้งหมด

## 4. Logic ซ้ำ (รวมเป็น source of truth เดียว)

- `esc` 33 สำเนาใน `app_v2.js` (2 ตัวไม่ escape `'`) และ `jsArg` 3 สำเนา → `MTSafeRender.escapeHtml` / `MTSafeRender.jsArg` ซึ่งโหลดก่อน `app_v2.js` ทั้ง production และ demo (ผลลัพธ์ใน HTML text/attribute เท่าเดิม)
- Shared-expense settlement, investment valuation, credit billing metadata, overlay open/close — ตามตารางข้อ 2

## 5. งานซ้ำตอนเปิดแอป (แก้)

`init()` render หน้าแรกกลางไฟล์ จากนั้น block ต่อ ๆ มาเรียก `App.render*()` ซ้ำอีก ~25 จุดทั้งที่ยังไม่มี paint ระหว่างกลาง (ทั้งหมดอยู่ใน task เดียวกัน) วัดได้ว่า Dashboard render **11–12 ครั้งต่อการเปิดแอป** แต่ละครั้ง ~55–58 ms ที่ 2,675 รายการบน desktop

แผน: ลบ render ระหว่างทางทั้งหมด แล้ว render หน้าปัจจุบันครั้งเดียว**ก่อน** `MTScreenHooks.install` (จุดเดียวกับ render สุดท้ายเดิมในแง่ hook: ยังไม่มี hook → จำนวนครั้งที่ hook/animation ทำงานเท่าเดิม) render ของ `split_bill.js` / `onboarding.js` / demo ที่ apply patch ของตัวเองคงไว้ — คาดว่าเหลือ 3 ครั้ง persist ตอน boot คงไว้ทั้งหมด (เกี่ยวกับ migration/ความปลอดภัยข้อมูล)

## 6. CSS (ลบ)

- rule ที่ทุก selector อ้าง class/id ที่ไม่มีโค้ดใดสร้าง (เช่น `.mt-stat-card`, `.dashboard-upcoming-*`, `.finance-cockpit-*`, `.mt-auth-btn`, `.reward-summary-compact`, `.v5-ls-*`, `.mt-merchant-suggest*`) และ selector ที่ตายภายใน selector list — **ยกเว้น** icon map `.ti-*`, utility family (`.c-*`, `.finance-gap-*`, `.finance-mb-*`, `.finance-stack`) และ component library `v2-*` ที่ `UI_DESIGN_SPEC.md` กำหนดไว้สำหรับ redesign
- declaration ที่ถูก rule ซึ่งมี selector เหมือนกันทุกตัวอักษร ใน context เดียวกันหรือกว้างกว่า และ importance ≥ ทับเสมอ (ไม่แตะค่าที่อาจเป็น fallback ของ browser เก่า เช่น `dvh`, `env()`, `color-mix`, `-webkit-`)

## 7. ไฟล์ที่ไม่เกี่ยวกับระบบ (ลบ)

`.superpowers/brainstorm/**` — เนื้อหาเป็นของโปรเจกต์อื่น ("Beautrium Live Commerce Autopilot") พร้อม `server.pid`/state ของ tool และถูก deploy สาธารณะเพราะ workflow upload ทั้ง repo → ลบและเพิ่ม `.superpowers/` ใน `.gitignore`

## เกณฑ์ผ่าน

`node --test tests/*.test.js` ผ่านทั้งหมด (เพิ่ม regression tests ของ bug ข้อ 1), `node --check` ทุกไฟล์, ESLint `no-undef` ไม่มีชื่อนอก scope เหลือ, harness: DOM + computed style ของทุกหน้าและ sheet เท่าเดิมทั้ง light/dark/production/demo ยกเว้นจุดที่ตั้งใจแก้ (B8), ไม่มี page error, และ bump release version ตาม `release_manifest.js`

## ผลลัพธ์

ดำเนินการครบตามแผนบน branch นี้ · release `2026.10.03-audit-r131`

| ตัวชี้วัด | ก่อน (r130) | หลัง (r131) |
| --- | --- | --- |
| `app_v2.js` | 24,408 บรรทัด / 1,441,348 bytes | 23,357 บรรทัด / 1,365,876 bytes |
| JS + CSS ใน core assets | 2,423,029 bytes | 2,316,726 bytes (−106 KB, −4.4%) |
| `style_v2.css` / `ui_v2.css` | 273,952 / 71,395 bytes | 245,398 / 70,664 bytes |
| Dashboard render ต่อการเปิดแอป (2,675 รายการ) | 11–12 ครั้ง | 3 ครั้ง |
| DOMContentLoaded แบบ warm (desktop, 2,675 รายการ) | ~445–457 ms | ~340–372 ms |
| `App.*` definition ที่ตาย/ถูกเขียนทับ | 55 | 0 (เหลือ debug hooks 3 ตัวที่ตั้งใจเก็บ) |
| ตัวแปร/helper ที่ไม่ใช้ (ESLint) | 79+ | 0 |
| การอ้างชื่อนอก scope (ESLint `no-undef`, ไม่นับ module globals) | 24 จุด (13 ชื่อ) | 0 |
| สำเนา `esc` / `jsArg` ใน `app_v2.js` | 33 / 3 | 0 (ใช้ `MTSafeRender`) |
| CSS rule ที่ไม่มีวันตรง / declaration ที่ถูกทับเสมอ | 147 rules + 25 selectors / 398 | 0 (ยกเว้น design-system library) |
| Node tests | 263 ผ่าน | 266 ผ่าน (เพิ่ม 3 ไฟล์, ปรับ 2 ไฟล์) |

### การตรวจสอบ

- `node --test tests/*.test.js`: 266/266 ผ่าน · `node --check` 89 ไฟล์ผ่าน · ESLint `no-undef` = 0, `no-unused-vars` = 0 (เหลือ 2 false positive: comma-ternary และ loop ที่มี guard)
- Tests ใหม่: `block_scope_references` (จับ helper ที่เรียกข้าม block — รันกับโค้ดเดิมแล้วจับ B1–B4, B6, B7 ได้ครบ), `notification_deeplink_static` (B10), `local_date_static` (B6/B11) · `credit_billing_migration` ย้ายไปทดสอบ rollback ของ `persist()` จริง (mutation test: ลบบรรทัด rollback แล้ว test fail)
- Browser (Playwright, Chromium, 430×932, ข้อมูลสังเคราะห์ 8 กระเป๋าทุกชนิด/107 รายการ/Loan/Goal/Recurring, ปิด network ภายนอก, เวลาคงที่): เทียบกับโค้ดเดิม `8384fe0` ที่ serve คู่กัน
  - boot ตรงผ่าน hash ทั้ง 5 หน้า + หลังสลับหน้า 5 หน้า + 44 sheet/sub-screen × light/dark × production/demo: DOM และ computed style **เท่าเดิมทุกจุด** ยกเว้น (1) กล่องราคาว่างที่ตั้งใจลบ (B8) และ (2) เลขเวอร์ชันในหน้า More; ความต่างอื่นที่พบคือ animation ที่ยังเล่นอยู่ (aurora card, overdue pulse, count-up) ซึ่งเมื่อรอให้จบได้ค่าเดียวกัน
  - localStorage หลัง boot เท่าเดิมทุก key (ยกเว้น timestamp และ `mt_boot_last_log` ที่สั้นลงเพราะ render น้อยลง); CSV export ตรงกันทุก byte; shared-expense settlement ตรงกัน
  - ยืนยันว่า bug แก้แล้วใน browser: crypto form เปิดได้, แก้ชุดผ่อนบันทึกได้, save ล้มเหลวมี toast, import โปรได้หมวด `food`, deep link เปิด Goals/Budgets/Add-Tx, เวลา 02:00 วันที่ 1 ปฏิทินชี้วันที่ 1
  - ไม่มี page error / console error ใหม่

### ข้อสังเกตที่ไม่ได้แก้ (ต้องตัดสินใจเชิง product)

- `#wf-market-price-link` เดิมตั้งใจแสดงราคาตลาด + ลิงก์ในฟอร์มทอง/FCD แต่ไม่เคยทำงาน — ลบกล่องว่างแล้ว ถ้าต้องการฟีเจอร์นี้ต้องทำใหม่ในฟอร์มปัจจุบัน
- badge "วงเงินร่วม" บนการ์ดบัตรเครดิตถูกคำนวณแต่ไม่เคยแสดง (ตั้งแต่ history ที่มี) — ลบส่วนคำนวณ ไม่ได้เพิ่ม UI
- CSV export ให้ `bnpl_payment` / `investment_*` เป็นค่าบวก ขณะที่ `cc_payment` เป็นลบ — คงพฤติกรรมเดิม
- `persist()` ตอน boot ยังมี 4 ครั้ง (เกี่ยวกับ migration) — คงไว้เพื่อความปลอดภัยข้อมูล
- `docs/SDD/*` เป็น snapshot ที่อ้างบรรทัด/ฟังก์ชันเดิม (บางฟังก์ชันถูกลบในรอบนี้) — ไม่ได้แก้
- เครื่องมือ `find_dead_css.py` / `remove_dead_css.py` ใช้ path บนเครื่องผู้ใช้ และ `codex-skills` เป็น gitlink ที่ไม่มี `.gitmodules` — คงไว้ตามการตัดสินใจรอบแรก
