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
