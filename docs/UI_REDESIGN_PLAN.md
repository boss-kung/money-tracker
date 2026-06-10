# UI Redesign Plan — Money Tracker (ครอบคลุมทุกหน้า)

> แผนรีดีไซน์ให้ทุกหน้าเป็นไปตาม [`UI_DESIGN_SPEC.md`](UI_DESIGN_SPEC.md) แบบ **ไม่หลุดแม้แต่หน้าเดียว**
> ใช้เป็น checklist ติดตามงานได้ — ติ๊ก `[x]` เมื่อหน้าใดเสร็จ + ผ่าน QA
> หลักการคุมดีไซน์ทั้งหมดอยู่ใน UI_DESIGN_SPEC.md — เอกสารนี้คือ "ทำหน้าไหน ลำดับใด อย่างไร ไม่ให้ bug"

---

## A. ยุทธศาสตร์: ทำไมต้องเริ่มที่ "Shared Shell"

แอปมี **90+ จุดเข้าหน้าจอ** แต่ทุกหน้าถูกสร้างผ่าน **primitive ร่วมไม่กี่ตัว**:

| Primitive | จำนวนที่เรียกใช้ | สร้างหน้าแบบ |
|---|---|---|
| `openSubScreen()` | ~65 | sub-screen (← header + scroll) |
| `*-overlay` / `openOverlay()` | ~60 / 21 | form & modal overlay |
| `showConfirm()` | ~38 | dialog ยืนยัน |
| `class="overlay"` | ~27 | overlay พื้นหลัง |
| `openDynamicSheet()` | ~5 | bottom sheet |
| route render (`renderDashboard/...`) | 5 | route page |

**กุญแจ:** ถ้ารีดีไซน์ **"เปลือก" (shell) ของ primitive เหล่านี้ครั้งเดียว** หน้าส่วนใหญ่จะเปลี่ยนตามทันทีโดยไม่ต้องแตะทีละหน้า → consistency สูงสุด + งานน้อยสุด + bug น้อยสุด. นี่คือเหตุผลที่ **เฟส 0 = Shared Shell** สำคัญที่สุดและต้องทำก่อน

### 5 Archetypes (เปลือกที่ทุกหน้าใช้)
1. **Route page** — colored header card + white sheet + nav/FAB (5 หน้า)
2. **Sub-screen** — `.sub-header` (← / title / action) + `.sub-scroll` (เปิดด้วย `openSubScreen`)
3. **Sheet** — bottom sheet (เปิดด้วย `openDynamicSheet` / overlay) + ปุ่ม primary ดำล่างสุด
4. **Form overlay** — `*-overlay` + `.form-group`/`.form-input` + header save
5. **Dialog** — `showConfirm` / `*Actions` / `*Dialog` (กล่องกลางจอ)

> รีดีไซน์ archetype 2–5 = แก้ CSS ของ `.sub-header`, `.sub-scroll`, `.overlay`, `.form-*`, dialog wrapper + เทมเพลตใน `openSubScreen/openOverlay/openDynamicSheet/showConfirm`. หน้าที่เรียกใช้ไม่ต้องแก้ markup เลย (ยกเว้นเนื้อหาเฉพาะหน้า)

---

## B. ลำดับการทำ (Roadmap) — เริ่มจากตรงนี้

> **สถานะ Phase 0 — ✅ landed (2026-06-10), gate OFF ใน production**
> - Feature flag `.ui-v2` (gate-then-flip): `applyTheme()` toggle จาก `S.settings.uiV2` · dev `App.setUIV2(true)` หรือ `?uiv2=1`
> - Icon font: Tabler subset 95 glyphs, self-host `assets/fonts/tabler-icons-subset.woff2` (17.7KB), cache ใน SW
> - Component library `ui_v2.css` (ทุก rule scope ใต้ `.ui-v2`, ใช้ prefix `v2-`): header/bento/ai-bar/list-card/seg-pill/quick-action/group/badge/progress/btn-dark + dot สีผู้ใช้ + hideMoney blur + income-header contrast fix (#15803D)
> - QA harness: `ui_v2_preview.html` (gallery, toggle dark/ui-v2/hide-money) — verify แล้ว light+dark, 81 tests เขียว, flag OFF = production ไม่เปลี่ยน, ไม่มี console error
> - **ยังเหลือ (ทยอยทำตอน build route pages):** theme-color ต่อหน้า, restyle เปลือก sheet/dialog/form เต็มตัว (ตอนนี้ทำ sub-header), chart tokens, multi-currency, state matrix เต็ม → ดู §H2
> - Versions bumped: `APP_VERSION` + `app_v2.js?v` + `ui_v2.css?v` = `2026.06.10-uiv2-r86`



| เฟส | ขอบเขต | ความเสี่ยง | ผลลัพธ์ |
|---|---|---|---|
| **0. Shared Shell + tokens** | สร้าง class กลาง §3 ของ spec + รีดีไซน์เปลือก 5 archetypes | ⚠️ กลาง (กระทบทุกหน้า — ต้องเทสต์รวม) | ทุกหน้าได้ลุคใหม่ฐาน |
| **1. Route pages (5)** | dashboard → wallets → more → transactions → reports | 🟢 ต่ำ | หน้าหลักที่ผู้ใช้เห็นบ่อยสุด |
| **2. Core flows** | add-tx sheet, tx detail, wallet detail, CC detail, CC pay | 🟡 กลาง (แตะ logic) | flow ใช้งานหลัก |
| **3. CC benefits cluster** | privileges, reward, benefit rules, credit limit groups | 🟡 กลาง | ฟีเจอร์เด่นของแอป |
| **4. Insight/Coaching cluster** | reports coach, coaching hub, ask-my-money, summaries, AI | 🟢 ต่ำ | |
| **5. Feature clusters** | goals, budget, recurring, upcoming, installments, loans, split, crypto | 🟢 ต่ำ (ใช้ shell แล้ว) | |
| **6. Forms & Dialogs (batch)** | ทุก `*Form` + `*Dialog` + `*Actions` | 🟢 ต่ำ (shell คุมแล้ว) | เก็บรายละเอียด |
| **7. Standalone/full-screen** | onboarding, app-lock (PIN), privacy.html, rescue.html, demo | 🟡 กลาง (นอก app shell) | ปิดงาน |

**เริ่มที่:** เฟส 0 → แล้ว **Dashboard (Home)** เป็นหน้าแรกของเฟส 1 (เห็นผลชัด + เป็น template ให้หน้าอื่น)

---

## C. Inventory ครบทุกหน้า + Checklist

> จัดกลุ่มตาม cluster. คอลัมน์ Archetype = เปลือกที่ใช้ (R=route, S=sub-screen, Sh=sheet, F=form, D=dialog, X=standalone)
> ทุกบรรทัด = 1 หน้าจอจริง. **ห้ามข้าม**

### C1. Route Pages — เฟส 1
- [x] `dashboard` — Home (R) · `renderDashboard` — ✅ landed r87. Restructure ตาม mockup โดย **ไม่แตะ logic**: CSS reorder (`order`) + reskin `.mt-net-card` เป็น hero airy + **inject AI bar + quick actions (additive)**. คงทุกฟีเจอร์ (health ring, metrics→bento, alerts, month nav→seg-pill). Verify light+dark + flag-off = เดิมเป๊ะ + 81 tests เขียว
- [x] `transactions` — เมนูรายการ (R) · `renderTransactions`, `renderTransactionsList` — ✅ landed r89. CSS-only: chips→seg-pill, `.tx-summary-card`→bento, `.tx-group-card`→list card, `.tx-row` icon chip (shared). Verify light+dark
- [x] `wallets` — กระเป๋าเงิน (R) · `renderWallets` — ✅ landed r88. **CSS-only reskin (ไม่แตะ JS)**: `.page-header` (h1+summary+tabs) → brand header น้ำเงิน, `.wallet-summary-card` → bento, `.wallet-tab` → seg-pill, `.wallet-card` gradient คงเดิม. Verify light+dark (header น้ำเงินทั้ง 2 โหมด ผ่าน !important override `.page-header{bg:var(--bg)!important}` ใน dark). flag-off = เดิมรับประกัน (ไม่มี JS เปลี่ยน)
- [x] `reports` — รายงาน 7 มุมมอง (R) · `renderReports`, `setRptView` — ✅ landed r89. CSS-only: view/month chips→seg-pill, `#reports-content .card`→radius 16, `.report-category-title`→v2. AI Coach card เดิมเข้าธีมพอดี. Verify light+dark
- [x] `more` — เพิ่มเติม/ตั้งค่า (R) · `renderMore` — ✅ landed r89. CSS-only: `.more-tab-btn`→seg-pill, `.sec-title`→v2 label, `.card.card-pad`→group card, `.settings-row`→row + `.s-icon`→icon chip + `.s-arrow`→chevron. Verify light+dark

### C2. Transaction Flow — เฟส 2
> **สถานะเฟส 2 (r90):** core flows เดิม **ใกล้ v2 อยู่แล้ว** (type-tabs สี semantic, amount เลขใหญ่, gradient cards, rounded tiles). ใส่ CSS polish แบบ gated (radius, reward-tile→purple bento, sub-screen card). **CSS-only → flag-off ปลอดภัย, ไม่มี error.** ⚠️ QA: sheets/sub-screens render ผ่าน positioned container — transplant ดูภาพไม่ได้ จึง verify ด้วย computed-style (reward-tile bg=#F5F3FF ✓) แทน. **ยืนยันภาพจริงควรทำในแอป (หลัง login)**
- [~] เพิ่มรายการ (Sh) · `openAddTx`, `_renderAddTxDetail`, `_setTxType` — CSS polish (type-tab/numpad/cat/flag radius). เดิมมีสี semantic + เลขใหญ่อยู่แล้ว
- [ ] แก้ไขรายการ (Sh) · `openEditTx`
- [ ] ทำซ้ำรายการ (Sh) · `openDuplicateTx`
- [ ] รายละเอียดรายการ (S) · `openTxDetailSub`, `openTxDetail`, `openTxDetailFromRuleTransactions`
- [ ] รายการของวัน (Sh) · `openDaySheet`
- [ ] บันทึกเร็ว / Quick Capture (Sh) · `openQuickCapture`
- [ ] ชำระบัตรเครดิต (Sh) · `openCCPay`, `saveCCPay`, `toggleCCPayDiscount`

### C3. Wallets — เฟส 1–2
- [ ] รายละเอียดกระเป๋า (S) · `openWalletDetail`, range chips
- [ ] ฟอร์มกระเป๋า/เพิ่ม-แก้ (F) · `openWalletForm`, `_syncWalletFormSections`, `saveWallet`
- [ ] รายละเอียดบัตรเครดิต (S) · `openCCDetail` (+ statement/cycle)
- [ ] ซ่อมยอดคงเหลือ (S) · `openBalanceRepairScreen`

### C4. CC Benefits / Rewards / Privileges — เฟส 3
- [ ] สิทธิประโยชน์บัตร (S) · `openCCBenefitScreen`
- [ ] ภาพรวมสิทธิประโยชน์ (S) · `openCCBenefitOverviewScreen`
- [ ] ฟอร์มกฎสิทธิประโยชน์ (F) · `openCCBenefitRuleForm`
- [ ] คัดลอกกฎ (D) · `openCCBenefitRuleCopyDialog`
- [ ] นำเข้ากฎ (D) · `openCCBenefitImportDialog`
- [ ] เพดานสิทธิประโยชน์ (Sh) · `openBenefitCapBreakdownSheet`
- [ ] กลุ่มวงเงินเครดิต (S) · `openCreditLimitGroupScreen`
- [ ] ฟอร์มกลุ่มวงเงิน (F) · `openCreditLimitGroupForm`
- [ ] บัญชีคะแนน/Reward ledger (S) · `openRewardLedgerScreen`
- [ ] ฟอร์มบัญชีคะแนน (F) · `openRewardAccountForm`
- [ ] ปรับคะแนน (F) · `openAdjustPointsForm`
- [ ] รายการตามกฎ (Sh) · `openRuleTransactionsSheet`
- [ ] หน้าสิทธิพิเศษ (S) · `openPrivilegesScreen`
- [ ] รายละเอียดสิทธิพิเศษ (S) · `openPrivilegeDetail`
- [ ] ฟอร์มสิทธิพิเศษ (F) · `openPrivilegeForm`
- [ ] เมนูจัดการสิทธิพิเศษ (D) · `openPrivilegeActions`
- [ ] ทำเครื่องหมายใช้แล้ว (D) · `openPrivilegeUsedDialog`
- [ ] เปิดลิงก์โน้ตสิทธิพิเศษ (D) · `openPrivilegeNoteUrl`

### C5. Insight / Coaching / AI — เฟส 4
- [ ] AI Coach รายงาน (S/Sh) · `openReportsCoach`
- [ ] ศูนย์โค้ชชิ่ง (S) · `openCoachingHub`
- [ ] รีวิวรายเดือน (S) · `openMonthlyReview`
- [ ] สรุปการเงิน (S) · `openFinanceSummary`
- [ ] โปรไฟล์โค้ชการเงิน (S) · `openFinanceCoachProfile`
- [ ] ความจำการเงิน (S) · `openFinancialMemory`
- [ ] Proactive brief (Sh) · `openProactiveBrief`
- [ ] วิเคราะห์ feedback (S) · `openFeedbackAnalytics`
- [ ] เหตุผล feedback (D) · `openRecommendationFeedbackReason`
- [ ] พรีวิว action การเงิน (Sh) · `openFinanceActionPreview`, `renderFinanceAssumptionPreview`
- [ ] ถามเรื่องเงิน / Ask My Money (Sh) · `openAskMyMoney`

### C6. Planning / Scenario / Life — เฟส 5
- [ ] วางแผนชีวิต (S) · `openLifePlanning`
- [ ] ฟอร์มแผนชีวิต (F) · `openAddLifePlanForm`
- [ ] Planning Lab (S) · `openPlanningLab`
- [ ] Scenario Lab (S) · `openScenarioLab`
- [ ] เทียบ scenario (S) · `openScenarioCompare`, `renderScenarioPreview`

### C7. Goals / Budget — เฟส 5
- [ ] เป้าหมายการออม (S) · `openGoalsScreen`
- [ ] ฟอร์มเป้าหมาย (F) · `openGoalForm`
- [ ] ปรับสมดุลเป้าหมาย (S) · `openGoalRebalanceCompare`
- [ ] ตั้งงบประมาณ (S) · `openBudgetScreen`, `saveBudgets`

### C8. Categories / Channels / Merchants — เฟส 5
- [ ] จัดการหมวดหมู่ (S) · `openCategoryScreen`
- [ ] ฟอร์มหมวดหมู่ (F) · `openCategoryForm`, `saveCategory`
- [ ] จัดการช่องทาง (S) · `openChannelScreen`
- [ ] ฟอร์มร้านค้า (F) · `openMerchantForm`

### C9. Recurring / Upcoming / Installments — เฟส 5
- [ ] รายการประจำ (S) · `openRecurringScreen`
- [ ] ฟอร์มรายการประจำ (F) · `openRecurringForm`
- [ ] เมนูรายการประจำ (D) · `openRecurringActions`
- [ ] บิลที่จะถึง (S) · `openUpcomingBillsScreen`, `openUpcomingScreen`
- [ ] ฟอร์มบิล (F) · `openUpcomingBillForm`
- [ ] จ่ายบิล (Sh) · `openUpcomingBillPayment`
- [ ] เลื่อนบิล (D) · `openUpcomingBillReschedule`
- [ ] ศูนย์ผ่อนชำระ (S) · `openInstallmentCenter`
- [ ] แก้กลุ่มผ่อน (F) · `openEditInstallmentGroup`

### C10. Loans (loans_v2.js) — เฟส 5
- [ ] หน้าสินเชื่อ (S) · `openLoansScreen`
- [ ] รายละเอียดสินเชื่อ (S) · `openLoanDetail`
- [ ] ฟอร์มสินเชื่อ (F) · `openLoanForm`
- [ ] ฟอร์มชำระคืน (F) · `openRepaymentForm`

### C11. Split Bill / Shared (split_bill.js) — เฟส 5
- [ ] หน้าหารบิล (S) · `openSplitBillScreen`
- [ ] รายละเอียดหารบิล (S) · `openSplitBillDetail`
- [ ] ฟอร์มหารบิล (F) · `openSplitBillForm`
- [ ] จัดการคน (S) · `openSplitPeopleScreen`
- [ ] ผูกรายการ (S/D) · `openSplitBillLinkedTransaction`, `openSplitBillLinkedTxForm`
- [ ] หารบิลจาก add-tx (Sh) · `openSplitBillFromAddTx`
- [ ] ขอรับคืน (Sh) · `openSharedExpenseReimbursement`
- [ ] แดชบอร์ดการเงินร่วม (S) · `openSharedFinanceDashboard`

### C12. Crypto (crypto_vault.js) — เฟส 5
- [ ] พอร์ตคริปโต (S) · `openCryptoPortfolioDetail`
- [ ] ฟอร์มเหรียญ (F) · `openCryptoHoldingForm`
- [ ] ฟอร์มรายการคริปโต (F) · `openCryptoTxForm`

### C13. BNPL (bnpl.js) — ⏸️ ซ่อนหลัง feature flag (commit 204364a)
- [ ] หน้าจัดการ BNPL plan (S) · `BNPL.ui` / `refreshPlanScreen` — **ทำเมื่อ flag เปิด** (อย่าโชว์ entry ใหม่ก่อน flag)

### C14. Notifications — เฟส 6
- [ ] กฎแจ้งเตือน custom (S) · `openCustomNotificationRulesScreen`
- [ ] ฟอร์มกฎแจ้งเตือน (F) · `openNotificationRuleForm`

### C15. Data / System / Meta — เฟส 6
- [ ] พรีวิวนำเข้าข้อมูล (S/Sh) · `openImportPreview`, `_validateImportPayload`
- [ ] บันทึกการกระทำ (S) · `openActionAuditLog`
- [ ] ประวัติฟีเจอร์ (S) · `openFeatureHistory`
- [ ] dialog ยืนยันกลาง (D) · `showConfirm` — **เปลือกร่วม เฟส 0**
- [ ] sheet/overlay primitive (Sh) · `openDynamicSheet`, `openOverlay`, `openSubScreen` — **เปลือกร่วม เฟส 0**
- [ ] toast (—) · `showToast` — ปรับสไตล์เฟส 0

### C16. Standalone / Full-screen — เฟส 7
- [ ] Onboarding flow (X) · `onboarding.js` (welcome + step rows)
- [ ] App Lock / PIN (X) · `app_lock.js` (unlock screen)
- [ ] `privacy.html` (X) — นโยบายความเป็นส่วนตัว
- [ ] `rescue.html` (X) — Money Tracker Rescue
- [ ] `demo/index.html` (X) — เดโม (sync สคริปต์เวอร์ชันให้ตรง)
- [ ] App shell skeleton / boot (X) · `index.html` boot screen (commit a72b6bf/aea255f — ระวัง white-flash)

---

## D. รายละเอียดการแก้แต่ละ Archetype (วิธีทำจริง)

### D0. Shared Shell (เฟส 0) — ทำก่อนทุกอย่าง
1. เพิ่ม class กลางใน `style_v2.css`: `.bento-card`, `.list-card`, `.ai-bar`, `.seg-pill`, `.screen-header--brand` (ตาม spec §3)
2. รีดีไซน์เปลือก archetype 2–5:
   - `.sub-header` / `.sub-scroll` (ใช้โดย `openSubScreen`) → padding, title 18/500, ปุ่ม ← เป็น icon chip
   - `.overlay` / form wrapper (`openOverlay`) → radius 22, พื้น `--surface`
   - bottom sheet (`openDynamicSheet`) → handle bar, ปุ่ม primary ดำล่าง
   - `showConfirm` dialog → radius, ปุ่มคู่ (ยืนยัน primary / ยกเลิก secondary)
   - `.toast` → radius, เงา `--shadow-float`
3. ผล: หน้า sub-screen/form/dialog ~80% ได้ลุคใหม่ทันที

### D1. Route page (เฟส 1)
- ห่อ header เดิมด้วย `.screen-header--brand` (สีตามหน้า) → bento ใน header → sheet ทับ -12px
- chips เดิม → `.seg-pill` · list เดิม → `.list-card` + `.tx-icon`
- **อย่าแตะ:** ฟังก์ชันคำนวณ/ดึงข้อมูล, id ที่ JS query, onclick

### D2. Sub-screen / D3. Sheet / D4. Form / D5. Dialog
- ส่วนใหญ่ได้จาก D0 แล้ว → แต่ละหน้าแค่เปลี่ยน **เนื้อหาเฉพาะ** ให้ใช้ `.bento-card`/`.list-card` แทน markup เดิม
- Form: ใช้ `.form-group`/`.form-input` เดิม (มีสไตล์แล้ว) — แค่จัดกลุ่ม + ปุ่ม save ดำ

---

## E. กฎกัน Bug (บังคับทุก PR) 🚫🐛

> "ฟีเจอร์ทุกอย่างต้องทำงานเหมือนเดิม ไม่ Bug" — กฎเหล่านี้กันการพังขณะเปลี่ยน UI

1. **ห้ามแตะ logic / data flow** — แก้ได้แค่ `class`, markup wrapper, inline style → CSS class. ห้ามแก้ชื่อฟังก์ชัน, signature, การคำนวณ
2. **รักษา `id=` ทุกตัวที่ JS อ้างอิง** — grep `getElementById`/`querySelector` ของหน้านั้นก่อนแก้ ห้ามเปลี่ยน/ลบ id เหล่านั้น
3. **รักษา event binding** — `onclick`, `oninput`, `onchange`, `data-*`, `aria-*` ต้องคงเดิมเป๊ะ
4. **รัน test ทุกครั้ง** — `node --test tests/` ⚠️ tests เป็น **static regex over source string** การเปลี่ยน markup อาจทำ test แดง → ต้องรันและแก้ให้เขียว
5. **เทสต์ทั้ง light + dark mode** + ความกว้าง ≤430px
6. **เทสต์ flow จริงหลังแก้แต่ละหน้า:** เพิ่ม/แก้/ลบรายการ, เปิด-ปิด sheet/overlay, submit form, dialog ยืนยัน — ครบ action ของหน้านั้น
7. **bump `?v=`** ของไฟล์ JS ที่แก้ ใน `index.html`; แก้ `index.html` → bump `APP_VERSION` ใน `service-worker_v2.js`
8. **wallet tab bar:** `.wallet-tab-bar?.remove()` ก่อน guard (ตาม CLAUDE.md)
9. **satellite module:** ถ้าแตะ loans/bnpl/split/crypto ต้องคง guard `typeof App/S !== 'undefined'` และไม่ทำลายการ patch `_ledgerFlows`
10. **1 PR = 1 cluster** (หรือ 1 หน้า) — ห้ามรวมหลาย cluster

### Definition of Done ต่อหน้า
หน้าใดติ๊ก `[x]` ได้เมื่อ: ✅ ใช้ component จาก spec · ✅ ผ่าน light+dark · ✅ ทุก action ของหน้าทำงาน · ✅ `node --test` เขียว · ✅ bump version แล้ว

---

## F. สรุปจุดเริ่ม

1. **เฟส 0** — สร้าง shared shell (`.bento-card`/`.list-card`/`.ai-bar`/`.seg-pill` + เปลือก sub-screen/sheet/form/dialog) → multiplier ที่ทำให้ทุกหน้าได้ฐานใหม่
2. **Dashboard** เป็นหน้าแรกของเฟส 1 → ใช้เป็น reference ให้ route page ที่เหลือ
3. ไล่ตาม cluster C1→C16 ตาม Roadmap §B, ติ๊ก checklist §C, ยึดกฎกัน bug §E ทุก PR

---

## G. Element Transformation Map (old → new)

> ระดับ element: ของเดิมหน้าตาไง → เปลี่ยนเป็น component ไหน + **ต้องรักษาอะไรไว้ (กันพัง)**
> **G1 = ของกลาง ใช้ทุกหน้า** (ไม่ต้องเขียนซ้ำต่อหน้า) · **G2 = element พิเศษเฉพาะหน้า** (มีแค่ 6 หน้า)
> หน้าที่ไม่อยู่ใน G2 → ใช้ G1 + archetype shell (§A) ล้วน ไม่มี element พิเศษ

### G1. Global map (ใช้ได้ทุกหน้า)
| Element เดิม | → component ใหม่ (spec §3) | ต้องรักษาไว้ (กันพัง) |
|---|---|---|
| แถวรายการ tx (`.tx`, `.list-item`) | `.list-card` + `.tx-icon` (radius 12, พื้น semantic-soft) | `onclick` เปิด tx detail, ลำดับ DOM, formatter `fmt/money` |
| chips filter (`.chip`) | `.seg-pill` (active = `--primary` ทึบ) | `onclick` เดิม (`setRptView`/`setWalletTxRange`/filter), ค่า active state |
| การ์ดสรุปเลข (div ad-hoc) | `.bento-card` (พื้น semantic-soft, label+ค่า) | id ที่ JS เขียนค่า (เช่น `tx-expense-total`, `tx-income-total`) |
| header หน้า route | `.screen-header--brand` (สี + overlap sheet -12px) | id ยอดเงิน, `onclick` toggle hideMoney |
| insight/AI กระจัดกระจาย | `.ai-bar` (พื้น `--dark-card`) | `onclick` (`openAskMyMoney`/`openReportsCoach`) |
| ปุ่ม submit ใน sheet/form | ปุ่ม primary ดำ full-width | `onclick` save (`saveTx`/`saveWallet`/...), สถานะ disabled |
| `.sub-header` (← / title / action) | icon chip ← + title 18/500 | `onclick="App.closeSubScreen()"`, ปุ่ม action ขวา |
| dialog (`showConfirm`) | wrapper radius 22 + ปุ่มคู่ | callback ยืนยัน/ยกเลิก, ปุ่ม primary/secondary |
| toggle / progress / badge | spec §3.7 | `onclick` toggle, ค่า aria-pressed |
| empty state | คงข้อความเดิม + ไอคอน | ข้อความ/CTA เดิม (เช่น "บัตรนี้ยังไม่มีสิทธิประโยชน์") |

### G2. Per-screen special elements (เฉพาะ 6 หน้านี้)

**Dashboard** (`renderDashboard`)
| เดิม | → ใหม่ | กันพัง |
|---|---|---|
| balance block (`#wf-balance`, `#wf-balance-group`) | `.screen-header--brand` พื้น `--primary` + ยอด 30px | **คง id `wf-balance*`, `wf-cc-balance*`** (JS เขียนค่า) |
| net sparkline (`.mt-net-sparkline`, `.mt-net-spark-path`) | คงกราฟ แต่ใส่ในการ์ดขาว radius 16 | คง path/viewBox/`.nw-chart-*` |
| summary banner (`.mt-summary-banner-stats`) | `.bento-card` ×2 รายรับ/รายจ่าย | formatter เดิม |
| quick actions | 4 icon วงกลม | `onclick` `openAddTx` ฯลฯ |

**Add-tx** (`_renderAddTxDetail`)
| เดิม | → ใหม่ | กันพัง |
|---|---|---|
| `.type-tabs`/`.type-tab` | สี active ตามชนิด (จ่าย แดง/รับ เขียว/โอน ฟ้า) | `onclick="App._setTxType()"`, class `type-{v}` |
| `.amount-summary-card` | ตัวเลข 38px สีตามชนิด = พระเอก | id/โครงเครื่องคิดเลข, reward preview |
| select/inputs (`#tx-channel/-wallet/-towallet/-merchant/-date/-note`) | `.form-input` จัดกลุ่ม | **คง id ทั้งหมด + `onchange`/`oninput`** |
| flag pills (`.flag-pill`) | pill `.seg-pill`-like | `onclick="App._toggleTxFlag()"` |

**Wallets** (`renderWallets`)
| เดิม | → ใหม่ | กันพัง |
|---|---|---|
| header สรุป | `.screen-header--brand` + bento สินทรัพย์/หนี้สิน | คงค่าที่ดึงจาก `_ledgerFlows` |
| wallet tab bar (`.wallet-tab-bar`) | `.seg-pill` | once-injection guard → `.wallet-tab-bar?.remove()` ก่อน guard |
| wallet card | `.wallet-card-colored` + `--wallet-color/-2` | **ห้าม inline `background:`** ตรง (ดู CLAUDE.md) |
| badge บัตรครบกำหนด | badge `--expense` | logic วันครบกำหนดเดิม |

**CC Detail** (`openCCDetail`)
| เดิม | → ใหม่ | กันพัง |
|---|---|---|
| การ์ดบัตร | gradient `--dark-card` navy + ยอดค้างเด่น | `.cc-detail-screen` (JS อ่านค่า reward จาก DOM, line 149) |
| `.reward-grid`/`.reward-tile` | bento 3: วงเงิน/ใช้ไป%/แต้ม | **คง `.reward-grid .reward-tile strong`** (JS query) |
| รอบบิล | progress `--primary` + ช่วงวันที่ | ใช้ `getCardStatement` เดิม ไม่คำนวณใหม่ |

**CC Benefits** (`openCCBenefitScreen`, reward rules)
| เดิม | → ใหม่ | กันพัง |
|---|---|---|
| สรุปคะแนน/เงินคืน | การ์ด `--purple` | formatter คะแนน `formatPointsWithEstimatedValue` |
| `.reward-rule-results` | การ์ดต่อกฎ + badge ชนิด (เงินคืน/แต้ม/ส่วนลด) | `onclick` แก้/ลบกฎ, empty state เดิม |
| เพดาน/เดือน | progress `--income` | logic cap เดิม (`openBenefitCapBreakdownSheet`) |

**Reports** (`renderReports`, `setRptView`)
| เดิม | → ใหม่ | กันพัง |
|---|---|---|
| chips 7 มุมมอง | `.seg-pill` | `onclick="App.setRptView()"`, ค่า `rptView` 7 ตัว |
| AI Coach insight | `.ai-bar` บนสุด | ข้อมูลจาก insight engine (line 3470) |
| `.report-category-title` + กราฟ | การ์ดขาว radius 16 + `.list-card` หมวด | คง `.nw-chart-*`, โครงกราฟ |

> **วิธีใช้:** ก่อนแก้หน้าใด — (1) เปิด G1 ทำตามทุกแถวที่หน้านั้นมี (2) ถ้าหน้าอยู่ใน G2 ทำ element พิเศษเพิ่ม (3) grep id/onclick ในคอลัมน์ "กันพัง" ของหน้านั้นยืนยันว่าไม่ถูกแตะ

---

## H. Open Questions & Gaps (จากการวิเคราะห์ก่อนเริ่ม)

> เรื่องที่ spec/plan แรกยังไม่ได้คิด. ✅ = ตัดสินใจแล้ว · ⬜ = ยังต้องคิด/ทำตอนเฟส 0

### H1. ตัดสินใจแล้ว (lock เข้าสเปก)
| # | เรื่อง | Decision | งานที่ตามมา |
|---|---|---|---|
| 1 | **ระบบไอคอน** | ✅ **Icon font** (self-host) | เลือก/subset webfont (แนะนำ Tabler `.woff2`), วางใน `assets/`, เพิ่มเข้า SW cache + bump. CSP `font-src 'self'` รองรับแล้ว. emoji คงไว้สำหรับข้อมูลผู้ใช้ (ดู spec §5) |
| 2 | **Rollout** | ✅ **Gate หลัง flag แล้ว flip พร้อมกัน** | สร้าง flag (เช่น `S.settings.uiV2` หรือ build flag) ครอบทุก PR; production เห็นของเก่าจน redesign ครบ แล้วเปิดทีเดียว (ดู spec §0) |
| 3 | **สีผู้ใช้ตั้งเอง** | ✅ **ใช้ได้แค่ dot เล็ก ห้ามพื้นใหญ่** | แก้จุด `style="background:${color}"`/box-shadow (app_v2.js ~1669,1691,2694) → dot (ดู spec §3.8) |

### H2. ต้องทำ/นิยามในเฟส 0 (ก่อนหรือระหว่างสร้าง shared shell)
| # | เรื่อง | สิ่งที่ต้องทำ |
|---|---|---|
| 4 | **iOS safe-area + theme-color** | header สีต้องลากถึง `safe-area-inset-top`; อัปเดต `theme-color` (`#meta-theme`, applyTheme ~1147) ให้ตรงสี header ต่อหน้า; sync boot skeleton bg (`#EEF6FF` ใน index.html) กับ `--bg` |
| 5 | **hideMoney (blur)** | ตัวเลขก้อนใหญ่ใน `.screen-header--brand`/`.bento-card` ต้องรับ class blur เดิม — ระบุ element ที่ต้อง mask |
| 6 | **State matrix ต่อ component** | นิยาม: empty (ผู้ใช้ใหม่ทุกหน้า), loading (skeleton มีแล้ว line 6942 — restyle), error/offline (API crypto/gold/fx ล่ม), overflow (ไทยยาว/เลขใหญ่) สำหรับ `.list-card`/`.bento-card`/header |
| 7 | **Multi-currency** | กฎ format/จัดแนวเมื่อ THB+USD+crypto+gold อยู่ด้วยกัน (ใช้ formatter เดิม ~482 จุด) |
| 8 | **Dark mode พื้นสีแบรนด์** | ระบุ header สี + wallet gradient ในโหมดมืด: คงสด หรือหรี่ |
| 9 | **Chart token system** | สี/แกน/เส้น grid/empty-chart รวมสำหรับ reports bar·line, dashboard sparkline (`.nw-chart-*`), crypto, gold |
| 10 | **Contrast a11y** | ขาวบนเขียว `#16A34A` ตก WCAG (~2.9:1) → header/card เขียวที่ใช้ตัวอักษรขาวต้องปรับ (เข้มขึ้น/เพิ่ม overlay) |

### H3. Process (ตั้งระบบก่อนไล่หน้า)
| # | เรื่อง | สิ่งที่ต้องทำ |
|---|---|---|
| 11 | **Visual regression QA** | `node --test` เป็น regex จับ visual ไม่ได้ → ตั้ง screenshot baseline อย่างน้อย 5 route + flow หลัก (เทียบก่อน/หลังแต่ละ PR) |
| 12 | **Motion + perf budget** | นิยาม transition (sheet/page/skeleton→content) + `prefers-reduced-motion`; ตั้งงบ perf (render innerHTML ไฟล์ 24k บรรทัด, ระวัง gradient/shadow flash) |
