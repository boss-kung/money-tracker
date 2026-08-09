# เอกสารออกแบบระบบ (Software Design Document) — Financial Tracker / Money Tracker

เอกสารชุดนี้เขียนจากการอ่านซอร์สโค้ดจริงในรีโพสิทอรีทั้งหมด ทุกข้อความที่ระบุไว้อ้างอิงจากไฟล์และบรรทัดจริง
สิ่งใดที่ไม่ปรากฏในโค้ด จะเขียนกำกับว่า "ไม่พบในโค้ด"

เอกสารแบ่งเป็น 5 ตอน
- ตอนที่ 1 (ไฟล์นี้) — SECTION 1 ภาพรวมระบบ, SECTION 2 คลังฟีเจอร์, SECTION 3 เอกสารหน้าจอ
- ตอนที่ 2 — SECTION 4 User Flow, SECTION 5 การวิเคราะห์ UX, SECTION 6 การวิเคราะห์ UI
- ตอนที่ 3 — SECTION 7 Business Logic, SECTION 8 ฐานข้อมูล, SECTION 9 API, SECTION 10 Permission Matrix, SECTION 11 State Management
- ตอนที่ 4 — SECTION 12 Reusable Components, SECTION 13 Code Structure, SECTION 14 Sequence Diagram, SECTION 15 Known Issues, SECTION 16 ข้อเสนอปรับปรุง
- ตอนที่ 5 — SECTION 17 เอกสารที่ขาด, SECTION 18 ตารางสรุปฟีเจอร์, SECTION 19 Dependency Map, SECTION 20 Functional Specification ฉบับเต็ม

---

# SECTION 1 — Project Overview

## 1.1 ระบบนี้คืออะไร

Financial Tracker (ชื่อภายในโค้ดคือ Money Tracker) เป็นแอปพลิเคชันบริหารการเงินส่วนบุคคล ทำงานเป็น Progressive Web App (PWA)
แบบ static site ทั้งหมด ไม่มี build step ไม่มี bundler ไม่มี npm ในตัวแอปหลัก

หลักฐานจากโค้ด
- `index.html` บรรทัด 346–393 โหลดสคริปต์ทั้งหมดด้วย `<script defer src="...?v=...">` ตรง ๆ ไม่มีการ import module
- `manifest.json` กำหนด `"display": "standalone"`, `"orientation": "portrait"`, `start_url` = `./index.html`
- `service-worker_v2.js` ทำ precache ไฟล์ static ทั้งหมด และมี push/notificationclick handler
- `.github/workflows/deploy.yml` deploy ทั้งโฟลเดอร์ (`path: '.'`) ขึ้น GitHub Pages
- `CLAUDE.md` ระบุ "The app is a static GitHub Pages site — no build step, no bundler, no npm."

ชื่อที่แสดงต่อผู้ใช้คือ "Financial Tracker" (`index.html` บรรทัด 79 `<title>`, `manifest.json` `"name"`)
ภาษาอินเทอร์เฟซคือภาษาไทยทั้งหมด (`<html lang="th">`) สกุลเงินหลักคือบาท (`Calc.fmt` เติม `฿` เสมอ)
วันที่แสดงเป็นพุทธศักราช (`Calc.monthLabel` และ `Calc.labelDate` ใน `calculations.js` บวก 543 กับปี ค.ศ.)

## 1.2 วัตถุประสงค์

จากโครงสร้างข้อมูลและฟีเจอร์ที่มีจริงในโค้ด วัตถุประสงค์ของระบบคือ

1. บันทึกและติดตามรายรับ-รายจ่ายรายวัน (`S.transactions`)
2. บริหารกระเป๋าเงินหลายประเภทพร้อมกัน — ธนาคาร เงินสด e-wallet บัตรเครดิต BNPL ทองคำ คริปโต และบัญชีเงินตราต่างประเทศ (FCD)
3. บริหารรอบบิลบัตรเครดิต วันครบกำหนดชำระ วงเงิน และวงเงินร่วมระหว่างบัตร (`credit_card_cycles.js`, `S.creditLimitGroups`)
4. คำนวณสิทธิประโยชน์บัตรเครดิต (คะแนน / เงินคืน / ส่วนลด) จากกฎที่ผู้ใช้กำหนดเอง (`S.ccBenefitRules`, `App.applyBenefitRule`)
5. ติดตามการผ่อนชำระ (installment) และแผน BNPL (`bnpl.js`)
6. บริหารหนี้ที่ให้คนอื่นยืม (`loans_v2.js`)
7. หารบิล/ค่าใช้จ่ายร่วม และติดตามยอดที่ต้องได้รับคืน (`split_bill.js`, `sharedExpense`)
8. งบประมาณรายจ่ายและรายรับรายเดือน (`S.budgets`, `S.incomeBudgets`)
9. เป้าหมายทางการเงินและแผนชีวิต (`S.goals`, `financialLifePlans`)
10. รายงานเชิงวิเคราะห์ 8 มุมมอง และปฏิทินการใช้จ่าย
11. ผู้ช่วย AI เชิงกฎ (rule-based) ให้คำแนะนำ 16 ประเภท (`ai_insights.js`) และเครื่องมือพยากรณ์/จำลองสถานการณ์ (`finance_intelligence.js`)
12. แจ้งเตือนผ่าน Web Push ตามกฎที่ผู้ใช้ตั้งเอง (`notifications_v2.js` + Supabase Edge Functions)
13. สำรอง/กู้คืนข้อมูล และซิงก์ข้ามอุปกรณ์แบบเข้ารหัสฝั่งผู้ใช้ (`auth_sync.js` + `crypto_vault.js`)
14. ล็อกแอปด้วย PIN / Face ID / Touch ID (`app_lock.js`)
15. บันทึกรายการแบบเร็วด้วยเสียงหรือข้อความภาษาไทย (`quick_capture.js`)
16. ค้นหาโปรโมชันบัตรเครดิตด้วย AI ผ่าน backend ภายนอก (`promo-search-appscript.js`, `promo-search-worker/`)

## 1.3 ใช้ทำอะไร / กลุ่มผู้ใช้

กลุ่มผู้ใช้ที่โค้ดออกแบบมารองรับ คือ ผู้ใช้ปลายทางรายบุคคลในประเทศไทย ที่ใช้บัตรเครดิตหลายใบและสนใจสิทธิประโยชน์บัตร
หลักฐาน
- ราคาทองอ้างอิงสมาคมค้าทองคำไทยและ Aurora (`gold_market.js` — `GOLDTRADERS_URL`, `AURORA_GOLD_URL`)
- วันหยุดธนาคารไทยถูกฝังไว้ใน `credit_card_cycles.js` (`DEFAULT_THAI_BANK_HOLIDAYS_MMDD`) และ `thai_bank_holidays.js`
- ตัวช่วยแปลงเลขไทยและคำอ่านตัวเลขไทยใน `quick_capture.js` (`THAI_NUM_WORDS`, `normalizeThaiDigits`)
- alias ธนาคารไทยใน `quick_capture.js` (`BANK_ALIASES` — SCB, KBANK, TTB, BBL, KTB, BAY, GSB, BAAC, UOB, Citi, TrueMoney, Rabbit, เป๋าตัง)
- ผู้ออกบัตรที่มี parser โปรโมชันเฉพาะ — CardX, UOB, AEON, First Choice, UnionPay (`App._parseCardXPromotionDrafts` ฯลฯ)

ระบบเป็นแบบ single-user ต่อหนึ่งอุปกรณ์/หนึ่งบัญชี ไม่มีระบบ role หรือ multi-tenant ภายในแอป (ดู SECTION 10)

## 1.4 ปัญหาที่ระบบนี้แก้

1. แอปบัญชีทั่วไปไม่รองรับรอบบิลบัตรเครดิตไทยที่ตัดรอบไม่ตรงเดือนปฏิทิน — ระบบนี้มี engine รอบบิลแยก (`credit_card_cycles.js`) รองรับทั้งโหมด "ครบกำหนด N วันหลังตัดรอบ" (`afterCycle`) และ "วันที่คงที่ทุกเดือน" (`fixedDay`) พร้อมเลื่อนย้อนหลังเมื่อชนวันหยุด/เสาร์อาทิตย์ (`shiftBackwardsToBusinessDay`)
2. ยอดคงเหลือกระเป๋าเพี้ยนจากการแก้ไขข้อมูลย้อนหลัง — ระบบใช้ ledger เป็น source of truth (`App._ledgerFlows`) และคำนวณยอดใหม่จาก openingBalance + flows ทุกครั้ง พร้อมหน้าตรวจสอบ/ซ่อม (`App.openBalanceRepairScreen`)
3. รายการผ่อนในอนาคตทำให้ตัวเลขเดือนปัจจุบันเพี้ยน — แก้ด้วยแนวคิด posted vs scheduled (`App._isPostedTx`) รายการที่ `scheduled === true` และวันที่ยังไม่ถึง จะไม่กระทบยอด
4. เงินที่จ่ายแทนเพื่อนถูกนับเป็นรายจ่ายเต็มจำนวน — แก้ด้วย `ledgerAmount` และ `sharedExpense` ที่แยก "ยอดจ่ายจริง" กับ "ส่วนของเรา"
5. เงินคืนจากเพื่อนถูกนับเป็นรายได้ — แก้ด้วย `isReimbursementTx` ที่กันออกจากยอดรายรับ (`Calc.getMonthlyIncomeExpense`)
6. ข้อมูลการเงินรั่วไหลสู่เซิร์ฟเวอร์ — แก้ด้วยการเข้ารหัสแบบ end-to-end ก่อนอัปโหลด (`crypto_vault.js`) และ snapshot ที่ส่งขึ้นเซิร์ฟเวอร์เพื่อแจ้งเตือน จะถูก sanitize เหลือเฉพาะตัวเลข `daysLeft` และ `pct` (`sync-notification-snapshot/index.ts`)
7. localStorage เต็ม — แก้ด้วย `App._slimRewardEstimate`, การ prune local backup, และหน้า `App.openStorageDiagnostics`

## 1.5 Architecture โดยรวม

สถาปัตยกรรมเป็นแบบ client-heavy / server-optional 4 ชั้น

ชั้นที่ 1 — Presentation (เบราว์เซอร์)
- HTML shell คงที่ 1 ไฟล์ (`index.html`) มี 5 หน้าเป็น `<div class="page">` และ overlay 6 ตัวที่ประกาศไว้ล่วงหน้า
- ทุกหน้าจอ render ด้วยการเซ็ต `innerHTML` จาก template string ไม่มี virtual DOM ไม่มี framework
- sub-screen ทุกหน้า (มากกว่า 50 หน้า) render ลง `<div id="sub-screen">` ตัวเดียวกัน

ชั้นที่ 2 — Application logic (`app_v2.js` 24,720 บรรทัด + โมดูลบริวาร)
- ทุกอย่างอยู่บน global object เดียวคือ `window.App` และ state เดียวคือ `S`
- โค้ดจัดเป็นบล็อก IIFE เรียงต่อกัน คั่นด้วยแบนเนอร์คอมเมนต์ แต่ละบล็อกจะ monkey-patch หรือเพิ่มเมธอดให้ `App`

ชั้นที่ 3 — Persistence (localStorage)
- `storage_v2.js` เป็น data-access layer เดียว มี 37 คีย์ (`KEYS`)
- `persist()` เรียก `Storage.saveAll(S)` ซึ่งเขียนทุกคีย์แล้ว verify ด้วย readback

ชั้นที่ 4 — Backend เสริม (ไม่บังคับ)
- Supabase — Auth (Google OAuth PKCE), ตาราง `mt_user_vaults` เก็บ ciphertext, Edge Functions 7 ตัว, pg_cron 2 ตาราง job
- Google Apps Script — proxy ราคาทอง (`gold-proxy-appscript.js`) และ AI promo search (`promo-search-appscript.js`)
- Cloudflare Worker — ทางเลือกของ promo search (`promo-search-worker/src/index.js`)
- API สาธารณะภายนอก — `api.chnwt.dev` (ราคาทอง), `api.frankfurter.dev` (อัตราแลกเปลี่ยน), `api.coingecko.com` / `api.coincap.io` (ราคาคริปโต)
  ทั้งหมดถูกอนุญาตไว้ใน CSP `connect-src` ที่ `index.html` บรรทัด 26–39

## 1.6 Technology Stack

Frontend
- Vanilla JavaScript (ES2020+) — ใช้ optional chaining, nullish coalescing, logical assignment (`||=`)
- CSS ล้วน 2 ไฟล์ — `style_v2.css` (10,525 บรรทัด) และ `ui_v2.css` (1,112 บรรทัด, ธีมทดลอง `ui-v2`)
- ไม่มี React / Vue / jQuery / Tailwind — ไม่พบในโค้ด
- ฟอนต์ LINE Seed Sans TH โหลดแบบ self-host (`assets/fonts/`)
- ไอคอนเป็น inline SVG และ emoji

PWA
- Service Worker `service-worker_v2.js` — cache-first สำหรับ navigation, network-first-with-timeout 900ms สำหรับไฟล์โค้ดหลัก, stale-while-revalidate สำหรับที่เหลือ
- Web Push API + Notification API
- Web Crypto API (PBKDF2 / AES-GCM) ใช้ทั้งใน App Lock และ vault encryption
- WebAuthn (platform authenticator) สำหรับ Face ID / Touch ID
- Web Speech API (`SpeechRecognition`) สำหรับบันทึกด้วยเสียง ภาษา `th-TH`

Backend
- Supabase (PostgreSQL + GoTrue Auth + Edge Functions บน Deno)
- Deno + `@supabase/supabase-js@2.45.4` (esm.sh) + `web-push@3.6.7` (npm:)
- Resend สำหรับส่งอีเมล OTP ยืนยันการลบบัญชี (`send-delete-otp/index.ts`)
- Firebase Cloud Messaging (มีโค้ด `_shared/fcm.ts` พร้อม service-account JWT signing แต่ฟังก์ชันที่ใช้งานจริงทั้งหมดเรียก `sendWebPush` ไม่ใช่ `sendFcm` — ดู SECTION 15)
- Google Apps Script + Gemini API (grounded search + JSON schema extraction)
- Cloudflare Workers + Wrangler (โปรเจกต์ย่อย `promo-search-worker/`, มี `node_modules` commit ลงรีโพ)

Testing
- Node.js built-in `node:test` + `node:assert/strict` เท่านั้น — ไม่มี Jest ไม่มี Vitest
- มีเทสต์ 26 ไฟล์ใน `tests/` แบ่งเป็น 2 แบบ
  1. static analysis test — อ่านซอร์สเป็น string แล้ว regex ตรวจ (เช่น `xss_escape_holes_static.test.js`, `touch_target_size_static.test.js`)
  2. unit test กับโมดูลที่ export ได้ (`calculations.js`, `credit_card_cycles.js`, `gold_market.js`, `split_bill.js`, `finance_intelligence.js`, `crypto_vault.js`, `ask_my_money_core.js`, `bnpl.js`)

CI/CD
- GitHub Actions `.github/workflows/deploy.yml` — trigger บน push ไปยัง `main`
  ขั้นตอน: checkout → รัน `python3 .github/gen_notification_config.py` เพื่อสร้าง `notification_config.js` จาก GitHub Secrets → `configure-pages` → `upload-pages-artifact` (path `.`) → `deploy-pages`
- ไม่มีขั้นตอนรันเทสต์ใน workflow — ดู SECTION 15

## 1.7 Folder Structure

```
Money Tracker/
├── index.html                     แอปจริง — shell + 5 หน้า + 6 overlay + รายการสคริปต์
├── privacy.html                   นโยบายความเป็นส่วนตัว (static, CSP default-src 'none')
├── rescue.html                    เครื่องมือกู้ข้อมูลเมื่อ demo เขียนทับ key จริง
├── ui_v2_preview.html             หน้า preview ธีม ui-v2 (104 บรรทัด)
├── manifest.json                  PWA manifest
├── service-worker_v2.js           SW: precache / routing / push / notificationclick
│
├── app_v2.js                      24,720 บรรทัด — core ทั้งหมด
├── storage_v2.js                  data-access layer, 37 คีย์, backup schema v3
├── calculations.js                Calc — ฟังก์ชันบริสุทธิ์ + module.exports (เทสต์ได้)
├── sample-data_v2.js              ค่าเริ่มต้น/ข้อมูลตัวอย่าง + getTODAY/getTHISMONTH
├── thai_bank_holidays.js          ThaiBankHolidays.has()
│
├── ai_insights.js                 InsightEngine — 16 กฎ (INS-01..INS-16)
├── finance_intelligence.js        FinanceIntelligence — พยากรณ์/scenario/health score/memory
├── ask_my_money_core.js           AskMyMoneyCore — parseIntent / parseRange (35 intent)
│
├── credit_card_cycles.js          CreditCardCycles — รอบบิล statement due date
├── bnpl.js                        window.BNPL = { store, calc, ui }
├── loans_v2.js                    window.LoanStore + UI ให้ยืมเงิน
├── split_bill.js                  หารบิล + SbStore + SplitBillCalc
├── crypto_vault.js                MTCryptoVault — PBKDF2/AES-GCM สำหรับ cloud sync
├── gold_market.js                 MTGoldMarket — ดึง/parse ราคาทอง 4 ชั้น fallback
│
├── auth_sync.js                   MTAuthSync — Google OAuth PKCE + encrypted vault sync
├── app_lock.js                    MTAppLock — PIN 6-12 หลัก + WebAuthn
├── notifications_v2.js            ตั้งค่า/ซิงก์กฎแจ้งเตือน + Web Push subscription
├── quick_capture.js               บันทึกเร็ว (พิมพ์/พูด) + parser ภาษาไทย
├── onboarding.js                  checklist 3 ขั้น + empty state (wrap render functions)
│
├── notification_config.js         ค่า public ที่ CI เขียนทับ (Supabase URL / anon key / VAPID)
├── notification_config.example.js เทมเพลตสำหรับ dev
│
├── style_v2.css                   10,525 บรรทัด — สไตล์หลัก
├── style_v2.css.bak               6,575 บรรทัด — ไฟล์สำรองเก่า (dead file)
├── ui_v2.css                      1,112 บรรทัด — ธีม ui-v2
│
├── find_dead_css.py               สคริปต์หา CSS ที่ไม่ถูกใช้
├── remove_dead_css.py             สคริปต์ลบ CSS ที่ไม่ถูกใช้
├── scripts/gen-splash.js          สร้างภาพ splash iOS ทุกขนาด
│
├── gold-proxy-appscript.js        Apps Script proxy ราคาทอง (doGet + JSONP)
├── promo-search-appscript.js      Apps Script AI promo search + benefit analysis
├── promo-search-worker/           Cloudflare Worker ทางเลือกของ promo search (มี node_modules)
│
├── demo/                          แอปเวอร์ชัน demo แยก namespace
│   ├── index.html                 โหลดสคริปต์เดียวกันแต่ prefix ../
│   ├── demo_bootstrap.js          ตั้ง MT_DEMO_MODE + สลับ storage key
│   ├── demo_overrides.js
│   └── sample-data_demo.js
│
├── supabase/
│   ├── functions/                 Edge Functions 7 ตัว + _shared 4 ไฟล์
│   └── migrations/                11 ไฟล์ SQL
│
├── tests/                         26 ไฟล์เทสต์ (node:test)
├── docs/
│   ├── UI_DESIGN_SPEC.md          design token + component library (source of truth ด้าน UI)
│   ├── UI_REDESIGN_PLAN.md        แผน rollout ทีละหน้าจอ
│   ├── superpowers/plans/         แผนงานย้อนหลัง 5 ฉบับ
│   └── SDD/                       เอกสารชุดนี้
├── assets/                        ไอคอน, splash 24 ไฟล์, ฟอนต์ 4 ไฟล์
├── CLAUDE.md                      คู่มือสำหรับ AI agent
├── NOTIFICATIONS_SETUP.md         ขั้นตอนตั้งค่าระบบแจ้งเตือน
└── .github/                       workflow + gen_notification_config.py
```

## 1.8 ภาพรวมการทำงานของระบบ (Boot Sequence)

ลำดับตามที่โค้ดทำงานจริง

1. เบราว์เซอร์โหลด `index.html` — inline `<style>` ทาสีพื้นหลังทันที (`#EEF6FF` / dark `#09111F`) เพื่อไม่ให้เห็นจอขาว
2. inline `<script>` บรรทัด 80–118 สร้าง `window.MTBoot` (ตัวจับเวลา boot), อ่าน debug flag จาก query string
   (`?debugBoot=1`, `?nosw=1`, `?nonoti=1`, `?noapplock=1` เฉพาะ localhost, `?noFinanceRebuild=1`), ติด global error handler
   และถ้ามี `?demo=1` จะ `location.replace('./demo/index.html')`
3. CSS หลักโหลดแบบ non-blocking (`media="print"` แล้วสลับเป็น `all` ใน `onload`)
4. สคริปต์ทั้ง 20 ไฟล์โหลดแบบ `defer` ตามลำดับใน HTML ซึ่ง "ลำดับสำคัญมาก" เพราะโมดูลบริวารต้องพบ `App` แล้ว
   ลำดับจริง: sample-data → thai_bank_holidays → storage → calculations → ai_insights → finance_intelligence →
   ask_my_money_core → notification_config → app_lock → credit_card_cycles → bnpl → crypto_vault → auth_sync →
   gold_market → app_v2 → split_bill → loans_v2 → quick_capture → notifications_v2 → onboarding
5. `app_v2.js` รันบล็อก IIFE ตามลำดับ สร้าง `S`, `App`, `persist()`, `toast()` แล้วจบด้วยการเรียก `init()`
   ผ่าน `MTAppLock.start(init)` (ถ้าไม่มี App Lock ก็เรียก `init()` ตรง ๆ)
6. `init()` (บรรทัด 1861) ทำตามลำดับ
   - `Storage.init()` โหลดทุกคีย์จาก localStorage → เซ็ตลง `S` ทีละฟิลด์ → ตั้ง `MT_STORAGE_HYDRATED = true`
   - ตั้ง `S.settings.storageMeta.appVersion`
   - อ่าน route จาก `location.hash` (`parseAppHashRoute`) หรือ `localStorage['mt_last_page']`
   - `applyTheme()` — toggle class `dark` / `ui-v2` และตั้ง CSS variable `--primary`
   - รัน migration 2 ตัว: `statusNormV1` (ตั้ง `scheduled` ให้แถวผ่อนอนาคต) และ `rewardEstimateSlimV1` (ย่อ rewardEstimate เก่า)
   - bind bottom nav (มี easter egg: แตะแท็บ "เพิ่มเติม" 3 ครั้งใน 2.5 วินาที = ล้างแคชแอป)
   - bind `hashchange`
   - `App.showPage(S.page)` → render หน้าแรก
   - ถ้า hash มี `?open=...` จะเปิด sub-screen ที่ระบุหลัง render เสร็จ
   - `setupServiceWorkerUpdates()` ลงทะเบียน SW + แสดงแบนเนอร์เมื่อมีเวอร์ชันใหม่
   - `setupConnectivityWatch()` ตรวจ online/offline
   - `MTAuthSync.initAuthSync()`
   - `App._autoSyncMarketIfStale()` ซิงก์ราคาสินทรัพย์ถ้าเก่า
7. หลัง `app_v2.js` โหลดเสร็จ โมดูลที่โหลดทีหลังจะ patch เพิ่ม
   - `loans_v2.js` wrap `App._ledgerFlows` และ `App._computeWalletFlows` เพื่อบวก flow ของเงินให้ยืม แล้ว recalc ใหม่
   - `onboarding.js` wrap `App.renderDashboard`, `App.showPage`, `App.saveTx`, `App.renderWallets`, `App.renderReports`, `App.renderMore`
   - `notifications_v2.js` และ `split_bill.js` เขียนทับ `App.renderMore` ของตัวเอง
8. safety timeout 9 วินาที (`app_v2.js` บรรทัด 2119) บังคับซ่อน boot screen ถ้ายังค้าง

---

# SECTION 2 — Feature Inventory

หมายเหตุร่วมสำหรับทุกฟีเจอร์
- Permission — ระบบไม่มี role ทุกฟีเจอร์ผู้ใช้คนเดียวเข้าถึงได้ทั้งหมด (ดู SECTION 10) ข้อจำกัดจริงคือ App Lock ระดับแอป
- API — ฟีเจอร์ส่วนใหญ่ไม่เรียก API ใด ๆ ทำงานบน localStorage ล้วน จะระบุเฉพาะฟีเจอร์ที่เรียกจริง
- Database — หมายถึงคีย์ localStorage ตาม `storage_v2.js` `KEYS`
- Loading state — แอปไม่มี spinner กลาง เพราะทุกอย่าง sync ยกเว้นฟีเจอร์ที่เรียก network (จะระบุเฉพาะที่มี)

## F-01 บันทึกรายการ (Add Transaction)

- จุดประสงค์ — บันทึกรายจ่าย รายรับ และการโอนเงินระหว่างกระเป๋า
- ใช้งานเมื่อไร — ทุกครั้งที่มีธุรกรรม
- Entry point — ปุ่ม FAB `#fab` (`index.html` บรรทัด 260, `onclick="App.openAddTx()"`), การ์ด insight บนแดชบอร์ด, deep link `#dashboard?open=addTx`, notification action `addTx`
- Route — overlay `#overlay-add-tx` ไม่เปลี่ยน URL page (แต่ push history 1 ชั้นผ่าน patch ที่บรรทัด 24680)
- หน้าที่ปรากฏ — FAB แสดงเฉพาะหน้า dashboard และ transactions (`App._syncPageChrome` บรรทัด 1271)
- Database — `mt_transactions`, และเมื่อเข้าเงื่อนไขจะแตะ `mt_merchants`, `mt_recurring`, `mt_bnpl_plans`, `mt_wallets`
- Logic ทั้งหมด
  1. `App.openAddTx()` รีเซ็ต `S.tx` เป็นค่าเริ่มต้น (`step:'amount'`, `type:'expense'`, `amount:'0'`, `date: TODAY`) แล้วเปิด overlay
  2. ขั้นที่ 1 "amount" — ตัวเลขป้อนผ่าน numpad ของแอปเอง (`App._numpad`) ไม่ใช่คีย์บอร์ดระบบ
     - จำกัดจำนวนเต็ม 10 หลัก ทศนิยม 2 ตำแหน่ง (บรรทัด 1407)
     - รองรับเครื่องคิดเลขในช่อง (`S.tx.calcOp`, `S.tx.calcLeft`, `App._evalCalc`, `App._calcOp`)
     - `⌫` เมื่อค่าเป็น '0' และมี `calcOp` ค้าง จะยกเลิก operator แทน
  3. `App._goToDetail()` — เรียก `_evalCalc()` ก่อน แล้วตรวจว่า `parseFloat(S.tx.amount)` ไม่เป็น 0 มิฉะนั้น toast "กรุณาระบุจำนวนเงิน"
  4. ขั้นที่ 2 "detail" — `App._renderAddTxDetail()` (นิยาม 4 ครั้ง ทับกัน: บรรทัด 3351, 15185, 18923, 19348) แสดงฟิลด์
     ประเภท (expense/income/transfer), กระเป๋า, กระเป๋าปลายทาง (เฉพาะ transfer), หมวดหมู่, ร้านค้า (มี dropdown แนะนำเอง),
     ช่องทาง (เฉพาะ expense), วันที่, หมายเหตุ, สวิตช์ "รายการประจำ", สวิตช์ "ผ่อนชำระ", ตัวเลือกกฎสิทธิประโยชน์ (เฉพาะบัตรเครดิต),
     ตัวเลือกค่าใช้จ่ายร่วม (sharedExpense), และจำนวนงวด BNPL (เฉพาะกระเป๋าประเภท bnpl)
  5. `App.saveTx()` (บรรทัด 6018) — ดูรายละเอียดใน SECTION 7
- Validation (`App.validateTransactionDraft` บรรทัด 10679) ตามลำดับการตรวจจริง
  1. ไม่มี `tx.type` → "ไม่พบประเภทรายการ"
  2. `amount <= 0` → "กรุณาระบุจำนวนเงินมากกว่า 0"
  3. ไม่มี `walletId` → "กรุณาเลือกกระเป๋าเงิน"
  4. หา wallet ไม่เจอ → "ไม่พบกระเป๋าเงินที่เลือก"
  5. `merchant` ยาวเกิน 100 ตัวอักษร → "ชื่อร้าน ยาวเกินไป (สูงสุด 100 ตัวอักษร)"
  6. `note` ยาวเกิน 1000 ตัวอักษร → ข้อความทำนองเดียวกัน
  7. transfer — ต้องมีปลายทาง, ปลายทางต้องไม่ซ้ำต้นทาง, ทั้งสองต้องเป็นประเภท bank/cash/ewallet/saving เท่านั้น
     (ถ้าเป็นทอง/คริปโต/FCD จะได้ข้อความบอกให้ใช้เมนูซื้อ/ขาย/ปรับจำนวนแทน), และยอดต้นทางต้องพอ
  8. expense — ต้องมี `categoryId`; ถ้ากระเป๋าไม่ใช่ credit และไม่ใช่ bnpl ยอดต้องพอ;
     ถ้าเป็น credit ต้องไม่เกินวงเงินคงเหลือ (`App.getAvailableCreditForCard`) โดยข้อความจะระบุ "(วงเงินร่วม)" ถ้าใช้ shared limit;
     ถ้าเป็น bnpl ต้องไม่เกิน `creditLimit + effectiveBalance`
  9. income — ต้องมี `categoryId`
  - กรณีแก้ไข ระบบจะ "ถอน" ผลของรายการเดิมออกก่อนคำนวณยอดคงเหลือ (`effectiveBalance`) เพื่อไม่ให้ validate ผิด
- กฎเพิ่มเติมสำหรับรายรับที่เป็นการรับคืน — ถ้ายอดเกินยอดค้างรับ ระบบจะไม่บันทึกทันที แต่ toast เตือนแล้วตั้ง
  `S.tx.allowOverReimbursement = true` ให้กดบันทึกอีกครั้งเพื่อยืนยัน (บรรทัด 6040–6051) เป็นรูปแบบ double-confirm
- Error handling — `saveTx` ห่อด้วย try/catch, error จะ `console.error` และ `notify('บันทึกรายการไม่สำเร็จ: ...','error')`
- Loading state — ไม่มี ทุกอย่างทำงาน synchronous
- Empty state — ถ้ายังไม่มีกระเป๋า `onboarding.js` จะบล็อกปุ่ม "บันทึกรายการแรก" (disabled)
- Success state — toast "บันทึกรายการแล้ว" หรือ "แก้ไขรายการแล้ว" หรือ "สร้างรายการผ่อน N งวดแล้ว"; ปิด overlay; ถ้าเป็นการเพิ่มใหม่จะเด้งไปหน้า transactions
- Edge cases ที่โค้ดจัดการจริง
  - รายการผ่อน: แบ่งยอดแบบ floor 2 ตำแหน่ง งวดสุดท้ายรับเศษ (`total - allocated`) เพื่อให้ผลรวมตรงเป๊ะ
  - รายการผ่อนงวดอนาคตถูกตั้ง `scheduled: true` จึงไม่กระทบยอดวันนี้
  - ส่วนลดทันที (instant discount) จะลดยอด `amount` จริงและเก็บยอดเดิมไว้ที่ `benefitBaseAmount`
  - ชื่อร้านจะถูก canonicalize ให้ตรงกับ `S.merchants` แบบ case-insensitive
- Limitation
  - ไม่มีการแนบรูป/สลิป — ไม่พบในโค้ด
  - ไม่มีสกุลเงินอื่นในรายการ (มีแต่กระเป๋า FCD ที่เก็บสกุลเงินระดับกระเป๋า)
  - แก้ไขรายการที่เป็นส่วนหนึ่งของชุดผ่อน จะแก้ได้เฉพาะแถวนั้น ต้องใช้ `App.openEditInstallmentGroup` เพื่อแก้ทั้งชุด
- ความสัมพันธ์ — เป็นแกนกลางของ F-02 (กระเป๋า), F-05 (บัตรเครดิต), F-08 (สิทธิประโยชน์), F-11 (รายการประจำ), F-12 (ผ่อน), F-14 (หารบิล), F-19 (AI insight)

## F-02 กระเป๋าเงิน (Wallets)

- จุดประสงค์ — จัดการบัญชี/แหล่งเงินทุกประเภท
- Entry point — แท็บ "กระเป๋า" ใน bottom nav; `App.openWalletForm(id)` จากปุ่มแก้ไข
- Route — page `#wallets`
- Database — `mt_wallets` และ cascade ไป `mt_bnpl_plans` เมื่อลบ
- ประเภทกระเป๋าที่รองรับ (จาก `App.openWalletForm` บรรทัด 10757)
  `bank` ธนาคาร, `cash` เงินสด, `ewallet` E-Wallet, `credit` บัตรเครดิต, `bnpl` BNPL, `gold` ทอง, `fcd` FCD
  โดย `bnpl` จะถูกกรองออกถ้า `BNPL_FEATURE_ENABLED` เป็นเท็จ
  นอกจากนี้ยังมีประเภท `crypto` และ `saving` ที่ปรากฏในตรรกะการคำนวณ (`Calc.getAssetBreakdown`, `getSpendableCashWallets`)
  แต่ไม่มีในรายการตัวเลือกของฟอร์ม — ดู SECTION 15
- Logic
  - ยอดคงเหลือไม่ได้แก้ตรง ๆ แต่คำนวณจาก `openingBalance + ledgerFlow` ทุกครั้งที่ `recalculateWalletBalances` ทำงาน
  - กระเป๋าลงทุน (gold/crypto/fcd) ใช้ `openingUnits + unitsFlow` แล้วคูณราคาต่อหน่วย (`App._investmentUnitPriceTHB`)
  - `Calc.getWalletAvailableBalance` หักยอด "รายการรอจ่าย" (upcoming bills) ที่ผูกกับกระเป๋านั้นออกจากยอดจริง
- Validation ตอนลบ (`App.deleteWallet` บรรทัด 6362) — ถ้ามีธุรกรรมหรือรายการประจำอ้างอิงอยู่ จะไม่ลบ แต่ตั้ง `archived = true` แล้ว toast "มีรายการอ้างอิง จึง Archive กระเป๋าแทนการลบ"
- Empty state — `onboarding.js` แทรกการ์ด "ยังไม่มีกระเป๋าเงิน" พร้อมปุ่ม "+ เพิ่มกระเป๋าแรก"
- Edge case — กระเป๋าที่ `hiddenFromWalletList = true` จะเปิดฟอร์มแก้ไขไม่ได้ (แจ้ง "กระเป๋านี้ถูกซ่อนจากหน้ากระเป๋าแล้ว")
- Limitation — สีการ์ดกำหนดผ่าน CSS variable `--wallet-color` / `--wallet-color-2` เท่านั้น ถ้าใส่ `background` ตรง ๆ จะถูก `!important` ทับ

## F-03 การจัดเรียงกระเป๋าแบบลากวาง

- Entry point — `App._toggleWalletReorder`
- Logic — `App._walletDragStart` / `_walletDragMove` / `_walletDragEnd` / `_walletReorderApply` และ `App._walletGroup()` จับกลุ่มว่าลากข้ามกลุ่มไม่ได้
- Limitation — ลากข้ามประเภทกระเป๋าไม่ได้

## F-04 รายการ (Transactions List)

- Entry point — แท็บ "รายการ"
- Route — page `#transactions`
- Logic (`App.renderTransactions` บรรทัด 7446 และ `renderTransactionsList` บรรทัด 7472)
  - header มีช่องค้นหาแบบ sticky + ปุ่ม "ตัวกรอง (N)" โดย N มาจาก `txActiveFilterCount()`
  - จัดกลุ่มตามวันที่ เรียงจากใหม่ไปเก่า แต่ละวันมีสรุปรายรับ/รายจ่ายของวันนั้น
  - รายจ่ายใช้ `Calc.getExpenseLedgerAmount` (คือส่วนของเราเท่านั้นในกรณีหารบิล) ไม่ใช่ยอดเต็ม
  - รายรับกันรายการที่เป็นการรับคืนออก (`isReimbursementTx`)
  - รักษาตำแหน่ง scroll ไว้เมื่อ re-render (`el.scrollTop` ถูกอ่านและเซ็ตกลับ)
- Filter — เดือน (6 เดือนล่าสุด), ประเภท (`S.txType`), ค้นหาข้อความ (`S.txSearch`)
- Empty state — `App._emptyState('📋','ไม่มีรายการ', ...)` ข้อความรองเปลี่ยนตามว่ามีคำค้นหรือไม่
- Limitation — ไม่มี pagination ทั้งเดือนถูก render ทีเดียว, ไม่มี sort ให้ผู้ใช้เลือก (ตายตัวเรียงตามวันที่ใหม่→เก่า)

## F-05 บัตรเครดิต: รอบบิลและวันครบกำหนด

- Entry point — แตะการ์ดบัตรในหน้ากระเป๋า → `App.openCCDetail(cardId)` (บรรทัด 16616)
- Database — `mt_wallets` (ฟิลด์ `cycleDay`, `dueDay`, `dueAfterCycleDays`, `dueDateMode`, `fixedDueDay`, `holidayShiftEnabled`, `customHolidays`, `includeDefaultHolidays`, `limit`), `mt_transactions`
- Logic (`credit_card_cycles.js`)
  - `getStatementPeriod(card, refDate, {includeOpen})` — คำนวณช่วงรอบจาก `cycleDay` (clamp 1–31 และ clamp ตามจำนวนวันจริงของเดือน)
  - `resolveDueDate(card, statementEnd)` — สองโหมด
    - `afterCycle` (ค่าเริ่มต้น) = `statementEnd + dueAfterCycleDays` (clamp 1–60 วัน)
    - `fixedDay` = วันที่คงที่ของเดือน (clamp 1–31); ถ้า `fixedDay <= cycleDay` จะเลื่อนไปเดือนถัดไป; แล้วเลื่อนย้อนหลังจนพ้นเสาร์-อาทิตย์และวันหยุดธนาคาร (สูงสุด 20 รอบ) เว้นแต่ `holidayShiftEnabled === false`
  - `getCardStatement` — รวบรวม purchases (expense ของบัตรในช่วง และ posted) และ payments (cc_payment ที่ `statementId` ตรง หรือวันที่อยู่ระหว่าง `end` ถึง `dueDate`) แล้วคำนวณ `purchaseTotal`, `paidTotal`, `balanceDue`, `paid`, และผลรวม reward
  - `getPayableStatements` — ย้อนหลัง 6 รอบ กรองเฉพาะที่ยังค้าง เรียงตามวันครบกำหนด
  - `getNextPayableDueInfo` — คืนรอบที่ต้องจ่ายเร็วที่สุด
- วันหยุดธนาคารเริ่มต้น 14 วัน (MM-DD): 01-01, 04-06, 04-13, 04-14, 04-15, 05-01, 05-05, 06-03, 07-28, 08-12, 10-13, 10-23, 12-05, 12-10, 12-31
- Edge case — `getStatementHistory` มี `seen` Set กันวนซ้ำถ้าคำนวณรอบแล้วได้ id เดิม
- ความสัมพันธ์ — ป้อนข้อมูลให้ dashboard alert, การแจ้งเตือน `credit_card_due`, INS-03, และ `Calc.getCreditLiabilitySummary`

## F-06 ชำระบัตรเครดิต (CC Payment)

- Entry point — ปุ่ม "ชำระ" ในหน้า CC detail, ปุ่มบนการ์ดบัตร → `App.openCCPay(cardId)` (บรรทัด 1450)
- Route — overlay `#overlay-cc-pay`
- Logic
  - แหล่งเงินกรองออกทั้ง `credit` และ `bnpl` (บรรทัด 1455)
  - ยอดตั้งต้น = ยอดค้างจาก `getCreditCardDueInfo` หรือ `statement.balanceDue` หรือ `|balance|`
  - รองรับ "มีส่วนลดตอนชำระ" — แยก "ยอดที่ตัดจากบัตร" (`amount`) กับ "เงินที่จ่ายจริง" (`cashAmount`) โดยส่วนต่างคือส่วนลด
  - preview คำนวณสดทุกครั้งที่พิมพ์ (`App.updateCCPayPreview`) และ sync สองทาง (แก้ discount → คำนวณ cash, แก้ cash → คำนวณ discount)
  - ปุ่มลัด: เต็มจำนวน / 1,000 / 500 (กรองค่าซ้ำและค่าที่ <= 0)
- Validation (`App.saveCCPay` บรรทัด 6195)
  1. ต้องพบบัตรและต้องเป็น type credit
  2. ต้องเลือกกระเป๋าต้นทาง
  3. `amount > 0`
  4. `cashAmount > 0`
  5. `cashAmount <= amount + 0.01`
  6. ถ้ามีส่วนลด `|(amount - cashAmount) - discount| <= 0.01`
  7. ถ้าต้นทางไม่ใช่บัตรเครดิต ยอดคงเหลือต้อง >= cashAmount
  - หมายเหตุจากคอมเมนต์ในโค้ด: อนุญาตให้ชำระเกินหรือน้อยกว่ายอดที่ระบบแจ้งได้
- ผลลัพธ์ — สร้าง tx `type:'cc_payment'` พร้อม `statementId` แล้ว recalc + persist + toast
- Edge case — ถ้ากำลังเปิดหน้า CC detail ของบัตรใบเดียวกันอยู่ จะ re-render หน้านั้นให้อัตโนมัติ

## F-07 วงเงินร่วม (Credit Limit Groups)

- Entry point — More → บัตร → "กลุ่มวงเงินร่วม" → `App.openCreditLimitGroupScreen`
- Database — `mt_credit_limit_groups`
- Logic — `App.getCreditLimitForCard`, `App.getCreditUsageForLimitGroup`, `App.getCreditCardsInLimitGroup`, `App.getAvailableCreditForCard`
  บัตรที่ `creditLimitMode === 'shared'` และมี `creditLimitGroupId` จะใช้วงเงินของกลุ่มร่วมกัน
- UX helper — ถ้ากรอก `issuer` แล้วพบบัตรอื่นจากผู้ออกบัตรเดียวกัน ฟอร์มจะขึ้นคำแนะนำให้ลองใช้วงเงินร่วม (บรรทัด 10790–10797)

## F-08 สิทธิประโยชน์บัตรเครดิต (Benefit Rules Engine)

- Entry point — More → บัตร → "รวมสิทธิประโยชน์บัตรเครดิต" (`App.openCCBenefitOverviewScreen`) หรือจากหน้าบัตร (`App.openCCBenefitScreen`)
- Database — `mt_cc_benefit_rules`, `mt_cc_benefits` (โครงสร้างเก่า), `mt_reward_ledger`, `mt_reward_accounts`
- Logic หลัก
  - ฟอร์มสร้างกฎเป็น wizard 3 ขั้น (`App._ccbrRenderStep`, `_ccbrNext`, `_ccbrBack`, `_ccbrReadStep`, `_ccbrStep`)
  - `App.applyBenefitRule` คำนวณผลของกฎหนึ่งข้อกับธุรกรรมหนึ่งรายการ คืนค่าประมาณ 50 ฟิลด์ (คะแนน เงินคืน ส่วนลด เพดาน ฯลฯ)
  - `App.calculateSelectedRewardEstimate(tx, ruleIds)` รวมผลของกฎที่เลือก
  - `App.getOptimalBenefitSelection(draft)` เลือกชุดกฎที่ให้ผลตอบแทนสูงสุดให้อัตโนมัติ (ใช้เมื่อผู้ใช้ยังไม่แตะตัวเลือกเอง — เช็คด้วย `rewardRulesTouched`)
  - `App.getSuggestedBenefitRules(draft)` คืนกฎที่เข้าเงื่อนไข พร้อมสถานะ `fullyUsed` เพื่อปิดกฎที่ใช้สิทธิ์เต็มแล้ว
  - `App.getRuleCycleUsage` นับการใช้สิทธิ์ในรอบ, `App.getBenefitCapBreakdown` แยกเพดานรายร้าน/ช่องทาง
  - ผลลัพธ์ที่บันทึกลง tx ถูกย่อด้วย `App._slimRewardEstimate` เหลือ 12 ฟิลด์ต่อกฎ เพื่อประหยัด localStorage
- นำเข้ากฎจากลิงก์ธนาคาร — `App.openCCBenefitImportDialog` → `App.analyzeCCBenefitLink` → `App._fetchBenefitSourceDocument` → parser เฉพาะผู้ออกบัตร
  (`_parseCardXPromotionDrafts`, `_parseUobPromotionDrafts`, `_parseAeonPromotionDrafts`, `_parseFirstChoicePromotionDrafts`, `_parseUnionPayPromotionDrafts`)
  หรือส่งให้ AI วิเคราะห์ (`App._analyzeBenefitTextWithAI` → `MT_PROMO_SEARCH_ENDPOINT`)
- API ที่ใช้ — Google Apps Script endpoint ที่ hard-code ไว้ใน `index.html` บรรทัด 363 และ CardX endpoint `cdx-prod-ssc-frontend.cardx.co.th` (อยู่ใน CSP)
- Loading state — มี (การวิเคราะห์ลิงก์เป็น async) แต่ implement เป็นการ re-render preview ไม่ใช่ spinner กลาง
- Error handling — `App.verifyBenefitEndpoint` ตรวจ endpoint ก่อน, ถ้า fetch ไม่ได้จะ fallback ไปพร็อกซีอื่น
- Limitation — parser ผูกกับโครงสร้าง HTML ของแต่ละธนาคาร ถ้าเว็บธนาคารเปลี่ยน parser จะพัง

## F-09 บัญชีคะแนนและสมุดบัญชีรางวัล (Reward Accounts / Ledger)

- Entry point — More → บัตร → "บัญชีคะแนนบัตรเครดิต" → `App.openRewardLedgerScreen`
- Database — `mt_reward_accounts`, `mt_reward_ledger`
- Logic — `App.getRewardAccountBalance`, `App.getRewardAccountForCard`, `App.getLinkedCardsForAccount`,
  `App.recordActualRewards` / `_confirmRecordRewards` / `_forceRecordRewards` (บันทึกคะแนนที่ได้รับจริง),
  `App.markCashbackReceived`, `App.openAdjustPointsForm` / `App.saveAdjustPoints` (ปรับยอดคะแนนด้วยมือ)
- การแปลงคะแนนเป็นบาท — `App.pointsToEstimatedBaht`, `App.getCardPointValueTHB`, `App.getCardPointValueConfig`,
  `App.normalizePointValueConfig` ใช้อัตราส่วน `pointsValue: { avgPoints, avgBaht }` (ค่าเริ่มต้นใน `sample-data_v2.js` คือ 1000 คะแนน = 100 บาท)
- Edge case — ถ้าลบรายการที่ `isRewardReceived` แล้ว หน้ารายละเอียดจะเตือนว่า "ถ้าลบรายการนี้ จะรับ Cashback รอบนี้ได้ใหม่"

## F-10 BNPL (Buy Now Pay Later)

- Entry point — สร้างอัตโนมัติเมื่อบันทึกรายจ่ายบนกระเป๋าประเภท `bnpl` พร้อมระบุจำนวนงวด >= 2 (`app_v2.js` บรรทัด 6125–6131)
- Route — sub-screen ผ่าน `BNPL.ui.openPlanList(walletId)`; overlay `#overlay-bnpl-pay` และ `#overlay-bnpl-edit` ถูก inject เข้า DOM ตอนโหลด (`BNPLui.injectOverlays`)
- Database — `mt_bnpl_plans`, `mt_transactions` (type `bnpl_payment`)
- Logic
  - `BNPLCalc.buildSchedule(total, n, purchaseDate, payDay)` — แบ่งงวดแบบ floor 2 ตำแหน่ง งวดสุดท้ายรับเศษ; ถ้ากระเป๋ามี `payDay` (1–28) จะบังคับวันครบกำหนดเป็นวันนั้นของทุกเดือน
  - `BNPLStore.payInstallment(planId, no, {walletId, date})` — สร้าง tx `bnpl_payment` และผูก `paidTxId`; ถ้าครบทุกงวด status → `paid_off`
  - `BNPLStore.payoffAll` — ปิดยอดทุกงวดที่เหลือด้วย tx เดียว (`bnplPayoffAll: true`)
  - `BNPLStore.updatePlan` — แก้ merchant/ยอดรวม/จำนวนงวด พร้อม rebuild schedule โดยรักษางวดที่จ่ายแล้ว และซิงก์ยอดกับ tx ต้นทาง
  - `BNPLStore.unlinkPaymentByTxId` / `relinkPayment` — ใช้เมื่อผู้ใช้ลบ tx การชำระ (รองรับ undo)
- Validation — แหล่งจ่ายต้องเป็น bank/cash/ewallet/saving เท่านั้น (defense in depth ทั้งใน `payInstallment` และ `payoffAll`)
- Error message — "กรุณาเลือกบัญชีที่จ่าย", "ลดจำนวนงวดต่ำกว่างวดที่จ่ายแล้วไม่ได้", "กรุณากรอกยอดรวมและจำนวนงวดให้ถูกต้อง"
- Empty state — "ยังไม่มีแผนผ่อน / บันทึกรายจ่ายผ่าน BNPL แล้วเลือกจำนวนงวด"
- Limitation ที่ระบุใน `CLAUDE.md` — ยังไม่มีหน้า detail เฉพาะของ BNPL wallet; `openWalletDetail` เป็นตัวจัดการ

## F-11 รายการประจำ (Recurring)

- Entry point — More → วางแผน → "รายการประจำ" → `App.openRecurringScreen` (บรรทัด 7550) หรือสวิตช์ในฟอร์มบันทึกรายการ
- Database — `mt_recurring`
- Logic
  - รองรับ 2 แบบความถี่: `days` (ทุกกี่วัน) และ `monthly` (วันที่กำหนดของเดือน พร้อม clamp วันที่ที่ไม่มีอยู่จริง)
  - `durationMonths` = จำนวนเดือน (ว่าง = ไม่สิ้นสุด)
  - `App.postRecurringNow(id)` บันทึกทันที, `App.skipRecurringNow` ข้ามรอบ, `App.snoozeRecurring(id, days=7)` เลื่อน, `App.toggleRecurring` หยุดชั่วคราว
  - `App._getOverdueRecurringLite` หารายการที่เลยกำหนด แล้วแดชบอร์ดแสดงเป็น alert พร้อมปุ่ม "บันทึก"/"ข้าม" และ badge "เกินกำหนด N รอบ"
  - เมื่อบันทึกรายการที่ติ๊ก "รายการประจำ" ระบบจะสร้าง recurring แล้วผูกกลับ (`sourceRecurringId`, `recurringInstanceKey`, `recurringOccurrenceNo`)
- Validation (`App.saveRecurring` บรรทัด 6312) — ต้องมีชื่อ (≤100 ตัวอักษร), ยอด > 0, เลือกกระเป๋า, เลือกหมวดหมู่
- Empty state — `App._emptyState('🔁','ยังไม่มีรายการประจำ','')`

## F-12 ผ่อนชำระ (Installments)

- Entry point — สวิตช์ "ผ่อนชำระ" ในฟอร์มบันทึกรายจ่าย; More → บัตร → "ศูนย์ผ่อนชำระ" (`App.openInstallmentCenter`)
- Logic
  - สร้าง N รายการพร้อมกัน แชร์ `installmentGroupId` เดียวกัน แต่ละแถวมี `installmentNo`, `installmentMonths`, `installmentTotalAmount`
  - งวดที่วันที่ยังไม่ถึง ตั้ง `scheduled: true`
  - `App.getInstallmentGroups()` รวมกลุ่ม คำนวณ `paid`, `remaining`, `next`
  - `App._getUnpostedInstallmentDebt(cardId)` คืนยอดผ่อนที่ยังไม่ถึงกำหนด ใช้หักวงเงินคงเหลือ
  - `App.openEditInstallmentGroup` / `App.saveInstallmentGroupEdit` แก้ทั้งชุด
  - `App.deleteInstallmentGroup` ลบทั้งชุดพร้อม undo
  - `App._repairInstallmentLedgerAmounts()` ทำงานตอน boot เพื่อซ่อม `ledgerAmount` ที่ไม่ตรง
- Edge case — ต้องมีอย่างน้อย 2 งวด (`months >= 2`) มิฉะนั้นจะบันทึกเป็นรายการเดี่ยว

## F-13 ให้ยืมเงิน (Loans)

- Entry point — More → เงินร่วมกัน → "ให้ยืมเงิน" → `App.openLoansScreen`
- Database — `mt_loans`
- Logic (`loans_v2.js`)
  - `LoanStore.create` หักยอดจากกระเป๋าทันที (`_adjustWallet(walletId, -amount)`)
  - `LoanStore.addRepayment` บวกยอดคืนเข้ากระเป๋า และถ้ายอดคงค้าง <= 0 จะตั้ง status = `settled`
  - `LoanStore.update` ถ้ายอดหรือกระเป๋าเปลี่ยน จะย้อนรายการเก่าก่อนแล้วค่อยลงใหม่
  - `LoanStore.delete` ย้อนทั้งเงินต้นและทุก repayment
  - patch `App._ledgerFlows` เพื่อให้ยอดกระเป๋าคำนวณรวมเงินให้ยืมทุกครั้งที่ recalc
- Validation — ต้องมีชื่อคนยืม, ยอด > 0, เลือกกระเป๋า (กระเป๋าที่เลือกได้จำกัดเฉพาะ bank/cash/ewallet/saving ที่ไม่ถูกซ่อน)
- สถานะภาพ — เกินกำหนด (`isOverdue`), ใกล้ครบกำหนด (`isDueSoon` ภายใน 7 วัน)
- Limitation สำคัญ — เงินให้ยืมไม่ถูกบันทึกเป็น transaction จึงไม่ปรากฏในหน้ารายการและรายงาน มีผลเฉพาะยอดกระเป๋า (ตามคอมเมนต์หัวไฟล์ "เงินที่ให้ยืมไม่นับเป็นรายจ่าย แต่กระทบยอดกระเป๋า")

## F-14 หารบิล (Split Bill)

- Entry point — More → เงินร่วมกัน → "หารบิล" → `App.openSplitBillScreen`; หรือจากฟอร์มบันทึกรายการ (`App.openSplitBillFromAddTx`)
- Database — `mt_split_bills`, `mt_split_people`, `mt_split_bill_draft`
- Logic (`split_bill.js`)
  - ฟอร์มเป็น wizard หลายขั้น (`stepBar`, `_step`) มี draft auto-save ลง localStorage (`_saveDraft` / `_loadDraft` / `_clearDraft`)
  - `allocateCents(ids, weights, totalAmount)` แบ่งเงินระดับสตางค์ให้ผลรวมตรงเป๊ะ
  - `runPipeline(subtotal, pipeline, rounding)` — คำนวณค่าบริการ/ภาษี/ส่วนลดตามลำดับที่ผู้ใช้จัดเรียงเองได้ (`_sbPipeMove`, `_sbPipeToggle`, `_sbPipeBaseToggle`)
  - `roundToUnit(satang, unit)` ปัดเศษตามหน่วยที่เลือก (`_sbSetRoundingMode`, `_sbToggleRoundingSign`)
  - `calcShares` / `calcResult` คำนวณส่วนของแต่ละคนและรายการโอน (transfers)
  - `App.linkSplitBillToTransaction(billId, txId)` ผูกบิลกับรายการจ่ายจริง; `App.getSplitBillLinkState` ตรวจสถานะ (`linked` / `mismatch` / อื่น ๆ)
  - `_lineText` สร้างข้อความสรุปสำหรับคัดลอกไปแชท พร้อม fallback การคัดลอก 2 ชั้น (`_clipCopy` → `_fallbackCopy`)
- ความสัมพันธ์ — เมื่อผูกกับ tx แล้ว `App.getSharedReceivableForTx` จะใช้ข้อมูลบิลคำนวณยอดค้างรับ

## F-15 ค่าใช้จ่ายร่วมแบบเร็ว (Quick Shared Expense)

- Entry point — สวิตช์ในฟอร์มบันทึกรายจ่าย (`App.setSharedExpenseEnabled`, `App.setSharedExpenseField`)
- Logic — `normalizeSharedExpenseDraft` (บรรทัด 5789)
  - `peopleCount` clamp 1–99
  - โหมด `equal` = `amount / peopleCount`, โหมด `custom` = ผู้ใช้ระบุ `myShare` เอง (clamp 0..amount)
  - `reimbursableAmount = amount - myShare`
  - `ledgerAmount` ของ tx ถูกตั้งเป็น `myShare` ทำให้รายงานนับเฉพาะส่วนของเรา
- การรับคืน — บันทึกเป็น tx `income` ที่มี `reimbursesSharedExpenseTxId` ชี้กลับ ทำให้ถูกกันออกจากยอดรายรับ
- สถานะการชำระคืน — `pending` / `partial` / `settled` / `over_reimbursed` (คำนวณใน `App.getSharedReceivableForTx`)
- Entry point เพิ่มเติม — `App.openSharedExpenseReimbursement`, `App.openSharedFinanceDashboard`, `App.repairSharedExpenseData`

## F-16 งบประมาณ (Budgets)

- Entry point — More → วางแผน → "งบประมาณรายรับ/รายจ่าย" → `App.openBudgetScreen` (บรรทัด 2982)
- Database — `mt_budgets`, `mt_income_budgets`
- Logic — `Calc.getBudgetProgress` และ `Calc.getIncomeBudgetProgress`
  - นับเฉพาะ posted transactions
  - รายจ่ายใช้ `getExpenseLedgerAmount`
  - รายรับกัน reimbursement ออก
  - `pct` clamp ที่ 100 เพื่อไม่ให้ CSS bar ล้น แต่เก็บ `rawPct` ไว้แสดงตัวเลขจริง
  - กรองเฉพาะงบที่ `monthlyLimit > 0`
- Daily chip บนแดชบอร์ด — `(limit - spent) / remainDays` โดย `remainDays` คำนวณจากวันที่เหลือในเดือน (ถ้าดูเดือนย้อนหลังใช้ 1)
- Alert — toast เตือนที่ 80% และ 100% (ระบุในแบนเนอร์ Wave 4 บรรทัด 23625)

## F-17 รายการรอจ่าย (Upcoming Bills)

- Entry point — More → วางแผน → "รายการรอจ่าย" → `App.openUpcomingBillsScreen`; deep link `#more?open=upcomingBills`
- Database — `mt_upcoming_bills`
- โครงสร้างข้อมูล (จาก `DEFAULT_UPCOMING_BILLS` ใน `sample-data_v2.js`)
  `id, title, amount, amountType('fixed'|'estimated'), dueDate, categoryId, walletId, merchantId, merchant, status, reminderDaysBefore[], note, source, createdAt, updatedAt, paidAt, transactionId`
- Logic
  - `Calc.getPendingUpcomingBills` / `getUpcomingReservedTotal` / `getUpcomingReservedByWallet` — ยอดที่ "กัน" ไว้
  - `Calc.getTotalAvailableCash = totalActualSpendableCash - upcomingReservedTotal`
  - `App.openUpcomingBillPayment` / `App.confirmUpcomingBillPayment` — จ่ายแล้วสร้าง tx และผูก `transactionId`
  - `App._rollbackUpcomingBillPayment` — ย้อนการจ่าย
  - `App.openUpcomingBillReschedule` / `confirmUpcomingBillReschedule` — เลื่อนกำหนด
  - `App.cancelUpcomingBill` — ยกเลิก
  - `App.toggleUpcomingReminderDay` — เลือกวันเตือนล่วงหน้า

## F-18 เป้าหมายและแผนชีวิต (Goals / Life Plans)

- Entry point — More → วางแผน → "เป้าหมายการเงิน" (`App.openGoalsScreen` บรรทัด 16851) และ "แผนอนาคตของคุณ" (`App.openLifePlanning`)
- Database — `mt_goals`, `mt_financial_life_plans`
- Logic — `App.getGoalProgress`, `App.getGoalCurrentAmount`, `App.archiveGoal`, `App.deleteGoal`, `App.openGoalRebalanceCompare`
  และฝั่ง FinanceIntelligence มี `goalOptimization`, `goalRebalanceScenarios`, `lifePlanningSummary`

## F-19 ผู้ช่วย AI เชิงกฎ (AI Insights)

- Entry point — การ์ดบนแดชบอร์ด, ในหน้ารายงาน, และในฟอร์มบันทึกรายการ
- Database — `mt_ai_insight_store`
- Engine — `ai_insights.js` (`InsightEngine`)
  - Cache TTL 4 ชั่วโมง (`CACHE_TTL_MS`), การ dismiss มีอายุ 30 วัน (`DISMISS_TTL_MS`), schema version 2
  - `buildPayload(S)` รวบรวมข้อมูล 20+ ชุด: สถิติรายเดือนและเดือนก่อน, งบประมาณ, ประวัติ 6 เดือน, ประวัติงบ 4 เดือน,
    เงินพร้อมใช้, รายการที่จะถึง, statement บัตร, บิลค้าง, ความคืบหน้าเป้าหมาย, สิทธิ์ใกล้หมดอายุ (<= 7 วัน),
    ร้านค้ายอดนิยม, ร้านที่ซื้อซ้ำ >= 3 ครั้งแต่ยังไม่ตั้งเป็น recurring, ราคาสินทรัพย์ที่ค้าง, รายการวันนี้และย้อนหลัง 3 วัน (ตรวจซ้ำซ้อน), ยอด recurring รายเดือน
  - `payloadHash` + `shouldRefresh` — คำนวณใหม่ก็ต่อเมื่อข้อมูลเปลี่ยนหรือหมดอายุ
- กฎทั้ง 16 ข้อ (จากคอมเมนต์และโค้ดจริง)
  1. INS-01 Cashflow Risk — เงินพร้อมใช้เทียบภาระที่ต้องจ่าย มี 2 ระดับ (critical / warn)
  2. INS-02 Budget Overrun — เกินงบ และใกล้เกินงบ
  3. INS-03 Credit Card Due Soon — แยกความเร่งด่วน <= 3 วัน กับ <= 7 วัน และเช็คว่าเงินพอจ่ายไหม
  4. INS-04 Upcoming Bill Due
  5. INS-05 Goal Behind Track
  6. INS-06 Expiring Privilege
  7. INS-07 Spending Concentration — กระจุกตัวในหมวดเดียว
  8. INS-08 Unregistered Recurring — ร้านที่ซื้อซ้ำแต่ยังไม่ตั้งรายการประจำ
  9. INS-09 Repeat Budget Overrun — เกินงบซ้ำหลายเดือน
  10. INS-10 Duplicate Transaction — รายการซ้ำซ้อน
  11. INS-11 Stale Asset Prices — ราคาทอง/คริปโต/FX ไม่อัปเดต
  12. INS-12 Daily Budget / Savings Forecast
  13. INS-13 Month-over-Month
  14. INS-14 Emergency Fund
  15. INS-15 Fixed Cost Ratio
  16. INS-16 Income Irregularity
- Placement filter (`getTopN`)
  - `dashboard` — เฉพาะ severity critical/warning, urgency >= 6, หรือ positive
  - `reports` — ทั้งหมด
  - `tx` — เฉพาะ type 01, 02, 12
- Actions ผู้ใช้ — `App.insightAct`, `App.insightDismiss`, `App.insightSnooze`, `App.insightRate`
  (`markActed`, `markDismissed`, `snooze(days)`, `rate` → ส่งต่อให้ `FinanceIntelligence.recommendationFeedback`)
- Security — ตอน import backup ระบบจะลบฟิลด์ `action` ออกจากทุก insight เพื่อกัน code injection (`storage_v2.js` บรรทัด 435–450)

## F-20 Finance Intelligence (พยากรณ์ / จำลอง / โค้ช)

- Entry point — More → วางแผน → "ภาพรวมการเงิน" (`App.openFinanceSummary`), "ลองและเทียบแผน" (`App.openPlanningLab`),
  "ผู้ช่วยส่วนตัว" (`App.openCoachingHub`), "แผนอนาคตของคุณ" (`App.openLifePlanning`)
- Database — `mt_financial_memory`, `mt_monthly_financial_features`, `mt_financial_recommendation_feedback`, `mt_financial_action_log`, `mt_financial_life_plans`
- API ที่ export (`finance_intelligence.js` บรรทัด 1363–1373) — 50 ฟังก์ชัน ครอบคลุม
  `buildContext`, `healthScore`, `forecasts`, `runScenario`, `compareScenarios`, `goalOptimization`, `goalRebalanceScenarios`,
  `behaviorProfile`, `inferredArchetype`, `personalizedGuidance`, `loadProfile`/`saveProfile`,
  `loadMemory`/`remember`/`memoryForMonth`/`memoryById`/`updateMemory`/`deleteMemory`,
  `recommendationFeedback` และตระกูล, `loadActionLog`/`recordActionLog`/`markActionUndone`,
  `adaptiveRecommendations`, `monthlyAutopilot`, `proactiveBrief`, `copilotBrief`, `proactiveAlertQueue`,
  `weeklyReview`, `monthlyCloseBrief`, `decisionLab`, `learningEngine`, `learningNudges`, `sharedFinance`,
  `actionProposals`, `featureForMonth`, life plan CRUD, feature store (rebuild เต็ม/incremental),
  `forecastAccuracyRows`/`forecastAccuracySummary`/`categoryForecastAccuracy`/`categorySeasonality`,
  `confidenceMeta`, `forecastExplanation`, `recommendationExplanation`
- Feature store — เก็บฟีเจอร์รายเดือนไว้ล่วงหน้า มี schema version และ freshness check; รีบิลด์ผ่าน
  `App.scheduleFinanceFeatureRebuild` / `App.rebuildFinanceFeaturesIfNeeded` และสามารถปิดด้วย flag `?noFinanceRebuild=1`
- ความแม่นยำการพยากรณ์ — `forecastAccuracySummary` คำนวณ MAPE และ bias จากผลจริงย้อนหลัง

## F-21 ถามได้เลย (Ask My Money)

- Entry point — More → เข้าใจพฤติกรรม → "ถามได้เลย" → `App.openAskMyMoney`; ส่งคำถามด้วย `App.submitAskQuery`; มีคำถามสำเร็จรูป `App._askPreset`
- Core — `ask_my_money_core.js` (`AskMyMoneyCore`) มี 2 ฟังก์ชัน
  - `parseRange(q, opts)` — ตีความช่วงเวลา: เดือนก่อน / 3 เดือน / 6 เดือน / สิ้นเดือน (forecast) / เดือนนี้ (ค่าเริ่มต้น)
  - `parseIntent(q, {category, merchant, lastIntent})` — ตีความเจตนา 35 แบบ เรียงตามลำดับความสำคัญ เช่น
    `shared_finance`, `scenario`, `actions`, `memory`, `health_score`, `autopilot`, `behavior`, `priorities`,
    `savings_scenario`, `cashflow_forecast`, `upcoming`, `emergency_fund`, `fixed_cost`, `goal_feasibility`,
    `net_worth`, `anomaly`, `comparison`, `budget_risk`, `budget_forecast`, `recent`, `merchant`, `category`,
    `credit`, `goals`, `savings`, `budget`, `cash`, `income`, `expense`, `overview`, `fallback`
- Logic — เป็น rule-based ล้วน ไม่มีการเรียก LLM ในเส้นทางนี้ (คำตอบประกอบขึ้นจาก `Calc` และ `FinanceIntelligence`)
- Limitation — เข้าใจเฉพาะคำที่ตรง regex ที่กำหนดไว้; คำถามนอกเหนือจะตกลง `fallback`

## F-22 บันทึกเร็ว (Quick Capture — พิมพ์/พูด)

- Entry point — ปุ่มไมค์ `#fab-mic` ที่ inject ไว้ข้าง FAB (`quick_capture.js` `_injectMicFab`) → `App.openQuickCapture()`
- Route — overlay `#overlay-quick-capture` (สร้างแบบ lazy)
- Logic parser (`parseQuickCapture`) — 8 ขั้น
  1. normalize เลขไทย (๐-๙) และแทนคำอ่านตัวเลขไทย (ตาราง 100+ รายการ เรียงยาวไปสั้นเพื่อไม่ให้ชนกัน)
  2. ตรวจคำบอกรายรับ 11 คำ (`INCOME_KW`) → กำหนด type
  3. ตีความวันที่สัมพัทธ์: เมื่อวานซืน / เมื่อวาน / เมื่อกี้ / ตอนนี้ / "N วันก่อน"
  4. จับคู่กระเป๋า 4 ชั้น: ชื่อเต็มตรง ๆ (ยาวสุดก่อน) → แพทเทิร์น "บัตร X"/"จ่ายด้วย X"/"โอน X"/"ใช้ X" → คำว่าเงินสด/cash → สแกน token จากขวาไปซ้าย
  5. ดึงจำนวนเงิน: ให้ความสำคัญกับ `฿X` และ `X บาท` ก่อน; ถ้าไม่มีใช้ตัวเลขที่มากที่สุด โดยตัดเลข 4 หลักช่วง 2000–2100 ทิ้ง (กันปี พ.ศ./ค.ศ.)
  6. แยก "ของที่ซื้อ" กับ "ชื่อร้าน" ด้วย prefix 20+ คำ (ร้าน/คาเฟ่/โรงแรม/ปั๊ม/…) และ fuzzy match 4 ชั้น
     (exact/substring → normalized substring → token overlap → Thai phonetic skeleton + Levenshtein + subsequence check)
  7. เดาหมวดหมู่จากคำสำคัญ 6 กลุ่ม (อาหาร เดินทาง บันเทิง สาธารณูปโภค สุขภาพ ช้อปปิ้ง)
  8. ถ้าเป็นรายรับแต่ได้หมวดรายจ่าย จะสลับไปหมวดรายรับตัวแรก
- ระดับความเชื่อมั่น — `high` (มีร้าน), `medium` (ไม่มีร้าน), `low_nocat` (ไม่มีหมวด), `low` (ไม่พบยอดเงิน)
- Speech — `SpeechRecognition` lang `th-TH`, `interimResults=false`, `continuous=false`
- Error message เสียง — `not-allowed` → "กรุณาอนุญาตการเข้าถึงไมค์", `no-speech` → "ไม่ได้ยินเสียง — ลองอีกครั้ง", อื่น ๆ → "รับเสียงไม่สำเร็จ"
- Success — หน้าจอ preview 4 แถว (หมวด/ร้าน/กระเป๋า/วันที่) แตะแถวไหนก็ไปหน้าแก้ไขเต็ม; ปุ่ม "บันทึก" ถูก disable ถ้าไม่มีหมวดหมู่
- Limitation — รองรับเฉพาะ expense/income ไม่รองรับ transfer; ไม่รองรับผ่อน/รายการประจำ

## F-23 รายงาน (Reports)

- Entry point — แท็บ "รายงาน"
- Route — page `#reports` และรองรับ `#reports?month=YYYY-MM` (เขียนกลับด้วย `writeAppHashRoute`)
- มุมมองทั้งหมด 8 แบบ (ชุดสุดท้ายที่ถูกเขียนทับ บรรทัด 23590–23600)
  `assets` สินทรัพย์, `expense` ใช้จ่าย, `income` รายรับ, `cashflow` กระแสเงินสด, `credit` บัตร/หนี้,
  `budget` งบประมาณ, `trend` แนวโน้ม, `calendar` ปฏิทิน
  (มุมมอง `networth` ปรากฏในเวอร์ชันแรกของ `renderReports` บรรทัด 6666 แต่ถูกแทนที่ในเวอร์ชันหลัง — ดู SECTION 15)
- Filter — chip เลือกเดือน 6 เดือนล่าสุด (`#report-month-chips`) และ chip เลือกมุมมอง (`#report-view-chips`)
- Logic — ใช้ `Calc.getMonthlyIncomeExpense`, `getCategoryBreakdown`, `getMerchantBreakdown`, `getMonthComparison`,
  `getAssetBreakdown`, `getCreditLiabilitySummary`, `getWeeklyNetSeries`
- ปฏิทินการใช้จ่าย — heatmap รายวัน (`renderSpendCalendar`), แตะวันเพื่อเปิด `App.openDaySheet`
- Empty state — `onboarding.js` แทรกข้อความ "รายงานจะแสดงทันทีหลังบันทึกรายการแรก" พร้อมปุ่มบันทึก

## F-24 ราคาทองและอัตราแลกเปลี่ยน

- Entry point — `App.refreshMarketPrices()`, `App._autoSyncMarketIfStale()` (เรียกอัตโนมัติตอนเปิดแอปและตอนกลับมาที่แอป)
- Database — `mt_market_prices`, cache แยกที่ `MT_GOLD_LAST`
- Logic (`gold_market.js` `fetchThaiGoldViaSource`) — fallback 5 ชั้นตามลำดับ
  1. Apps Script proxy ผ่าน JSONP (ถ้าตั้ง `MT_GOLD_PROXY_URL`) → `fetchedVia: 'apps-script-proxy'`
  2. `https://api.chnwt.dev/thai-gold-api/latest` โดยตรง → `'direct-api'`
  3. `r.jina.ai` อ่านหน้า goldtraders.or.th → `'goldtraders-readable-proxy'`
  4. allorigins / corsproxy อ่านหน้า Aurora → `'aurora-proxy'`
  5. cache ในเครื่องถ้าอายุ < 12 ชั่วโมง → `'cache'`
  6. พร็อกซีสาธารณะกับ API เดิม → `'public-proxy'`
  7. cache เก่ากว่า 12 ชั่วโมง → `'cache-stale'`
  8. คืน `null`
- Parser 3 ตัว — `normaliseGoldPayload` (JSON/JSONP), `parseGoldTradersText` (HTML สมาคมค้าทองคำ), `parseAuroraGold` (HTML Aurora, 3 กลยุทธ์: แถว intraday → การ์ดมีป้ายกำกับ → สแกนตัวเลขแบบ heuristic)
- อัตราแลกเปลี่ยน — `api.frankfurter.dev` (อยู่ใน CSP) ใช้กับกระเป๋า FCD
- คริปโต — `api.coingecko.com` และ `api.coincap.io` ผ่าน `App.refreshCryptoPrices` / `App.maybeAutoSyncCryptoPrices`
- Freshness — `App.getMarketFreshnessText` แสดงว่าอัปเดตเมื่อไร; INS-11 เตือนเมื่อราคาเก่า

## F-25 พอร์ตคริปโต (Crypto Portfolio)

- Entry point — `App.openCryptoPortfolioDetail()` (บรรทัด 14003)
- Database — `mt_crypto_assets`, `mt_crypto_holdings`, `mt_crypto_transactions`, `mt_crypto_sync_meta`
- Logic — `App.getCryptoPortfolioSummary`, `getCryptoHoldingValueTHB`, `getCryptoHoldingCostTHB`, `getCryptoHoldingUnrealizedPLTHB`,
  `App.openCryptoTxForm` / `saveCryptoTx` (buy/sell/adjust), `App.openCryptoHoldingForm` / `saveCryptoHolding` / `deleteCryptoHolding`,
  `App.setCryptoPortfolioSort`, `App._selectCryptoPreset` (preset 15 เหรียญใน `DEFAULT_CRYPTO_PRESETS`),
  `App._runCryptoSearch` / `_queueCryptoSearch` (ค้นเหรียญแบบ debounce)
- Migration — `S.migrations.cryptoCentralizedV1` ควบคุมการย้ายข้อมูลคริปโตจากรูปแบบเก่า

## F-26 สิทธิพิเศษ / คูปอง (Privileges)

- Entry point — More → บัตร → "สิทธิพิเศษ" → `App.openPrivilegesScreen('active')`; deep link `#more?open=privileges`
- Database — `mt_privileges`
- โครงสร้าง (จาก `DEFAULT_PRIVILEGES`) — `id, title, source, type, code, description, expiryDate, quantity, usedQuantity, estimatedValue, actualSavedAmount, usedAt, note, createdAt, updatedAt`
  โดย `type` ที่ปรากฏ: `discount_code`, `voucher`, `free_item`, `cashback`; `source` ที่ปรากฏ: `shopee`, `line`, `lazada`, `brand`, `credit_card`
- Logic — `App.openPrivilegeForm` / `savePrivilege` / `deletePrivilege` / `duplicatePrivilege` / `archivePrivilege` /
  `archiveExpiredPrivileges` / `confirmPrivilegeUsed` / `openPrivilegeUsedDialog` / `copyPrivilegeCode` /
  รหัสหลายชุดต่อสิทธิ์ (`addPrivilegeDraftCode`, `removePrivilegeDraftCode`, `updatePrivilegeDraftCode`)
- ความสัมพันธ์ — INS-06 เตือนเมื่อใกล้หมดอายุ (<= 7 วัน); trigger แจ้งเตือน `privilege_expiry`

## F-27 ค้นหาโปรโมชันบัตรด้วย AI

- Entry point — จากหน้าสิทธิประโยชน์บัตร (`App.openCCBenefitImportDialog` และเส้นทาง promo search)
- Database — `mt_credit_card_promo_searches`, `mt_credit_card_promotions`
- Backend ทางเลือกที่ 1 — Google Apps Script (`promo-search-appscript.js`)
  - `doPost(e)` รับ action; `doGet()` สำหรับ health check; `respond()` ตอบ JSON/JSONP
  - cache ใน CacheService (`cacheKey(issuers, month, mode)`, `cacheGet`, `cacheSet`)
  - `buildSearchPrompt` → `callGeminiWithSearch` (grounded search) → `buildExtractionPrompt` → `callGeminiJsonSchema` → `normalizeResults`
  - `handlePromoSearch(payload)` และ `handleBenefitAnalysis(payload)`
  - `getMockResults` สำหรับทดสอบโดยไม่เรียก AI
- Backend ทางเลือกที่ 2 — Cloudflare Worker (`promo-search-worker/src/index.js`)
  - รับเฉพาะ `POST /promo-search` (บรรทัด 628) มิฉะนั้นตอบ error
  - `searchOfficialPromoPages` → `fetchOfficialSource` → `callAiExtractor`
- Endpoint ที่ใช้จริง — hard-code ใน `index.html` บรรทัด 363 (`window.MT_PROMO_SEARCH_ENDPOINT`)

## F-28 นำเข้า / ส่งออกข้อมูล

- Entry point — More → ตั้งค่า → ข้อมูล
- ส่งออก JSON — `App.exportData()` → `Storage.exportJSON(S)` → `buildExportPayload` (schema version 3, 37 คีย์) → Blob → `Storage.triggerDownload`
  - `triggerDownload` พยายามใช้ `navigator.share({files})` ก่อน (เหมาะกับ iOS PWA) ถ้าไม่ได้จึงใช้ anchor download
- ส่งออก CSV — `App.exportCSV()` (และของเก่า `App.exportCSVLegacy`)
- นำเข้า — `App.importData(input)` → `Storage.importJSON(file, onSuccess, onError)` → `normalizeBackupPayload` → `App._validateImportPayload` → `App.openImportPreview` → `App.confirmImportPayload` → `App._applyBackupPayload` / `_applyImportMergePayload`
- Validation ตอนนำเข้า
  - ไฟล์ต้องไม่เกิน 10MB มิฉะนั้น "ไฟล์ backup ต้องมีขนาดไม่เกิน 10MB"
  - ต้องมี `transactions` และ `wallets` เป็น array
  - `_stripDangerousKeys` ลบ `__proto__`, `constructor`, `prototype` แบบ recursive (กัน prototype pollution)
  - `aiInsightStore.insights[].action` ถูกลบทิ้งเสมอ (กัน code injection)
  - แต่ละ transaction ต้อง: type อยู่ใน 8 ชนิดที่รู้จัก, amount > 0 (ยกเว้น `investment_adjust`), date ตรงรูปแบบ `YYYY-MM-DD`, walletId/toWalletId ต้องมีอยู่จริงในไฟล์
  - แถวที่ไม่ผ่านจะถูกข้ามและสะสมเป็น `warnings` แล้วแสดงในหน้า preview
- กู้คืน — `App.restorePreImportBackup()` และ local backup rotation 3 ชุด (`Storage.createLocalBackup`, `getLatestLocalBackup`, `pruneLocalBackups`)

## F-29 ตรวจสอบและซ่อมยอดคงเหลือ

- Entry point — More → ตั้งค่า → จัดการ → "ตรวจสอบยอดคงเหลือ" → `App.openBalanceRepairScreen()` (บรรทัด 5362)
- Logic
  - ครั้งแรกที่ยังไม่มี baseline จะถาม confirm เพื่อ snapshot ยอดปัจจุบันเป็น `openingBalance` / `openingUnits`
  - เปรียบเทียบยอดที่เก็บกับยอดที่คำนวณจาก transactions ทั้งหมด
  - threshold: เงิน 0.01 บาท, หน่วยสินทรัพย์ 1e-8
  - ซ่อมทีละกระเป๋า (`App._repairOneWallet`) หรือทั้งหมด (`App._rebuildWalletBalances`)
  - รีเซ็ต baseline ใหม่ (`App._resetOpeningBalances`) มี confirm แบบ danger
- ที่เกี่ยวข้อง — `App.runDataHealthCheck()` และ `App._validateLedgerIntegrity()` ที่ตรวจว่ามี tx อ้างถึงกระเป๋าที่ไม่มีอยู่หรือไม่ (ผลเก็บที่ `S._ledgerIssues` แล้วโชว์แถบเตือนบนแดชบอร์ด)

## F-30 พื้นที่จัดเก็บ (Storage Diagnostics)

- Entry point — More → ตั้งค่า → ระบบ → "พื้นที่จัดเก็บ" → `App.openStorageDiagnostics()` (บรรทัด 5417)
- Logic — `Storage.getUsageReport()` วน `localStorage` ทุกคีย์ นับ `key.length + value.length` เรียงมากไปน้อย แสดง 12 อันดับแรก
  มีป้ายอธิบายภาษาไทยสำหรับ 6 คีย์หลัก
- ปุ่ม "ล้าง Backup ในเครื่องเพื่อคืนพื้นที่" → `App._freeUpStorageNow()` → confirm → `Storage.freeUpEmergencySpace()`
  ซึ่งลบ `mt_local_backup_snapshots`, `mt_pre_import_backup`, `mt_boot_last_log` (ไม่แตะข้อมูลการเงินจริง)
- การป้องกันอัตโนมัติ — `Storage.save` เมื่อเจอ `QuotaExceededError` จะลบ `mt_pre_import_backup` และ prune local backup แล้วลองใหม่ 1 ครั้ง ก่อนแจ้งผู้ใช้

## F-31 App Lock

- Entry point — More → ตั้งค่า → ความปลอดภัย → "App Lock" → `MTAppLock.openSettings()`
- Database — `localStorage['mt_app_lock']`, `sessionStorage['mt_app_lock_session']` (ไม่ผ่าน `storage_v2.js`)
- Logic (`app_lock.js`)
  - PIN 6–12 หลัก, PBKDF2-SHA256 210,000 รอบ, salt 16 ไบต์สุ่ม, เปรียบเทียบด้วย `safeEqual` แบบ constant-time
  - ใส่ผิด >= 5 ครั้ง เริ่มหน่วงเวลา `min(300000, 30000 * (failures - 4))` มิลลิวินาที (สูงสุด 5 นาที)
  - Biometric ผ่าน WebAuthn platform authenticator, `userVerification: 'required'`, `attestation: 'none'`, timeout 60 วินาที
    เก็บเฉพาะ `credentialId` ไม่มี server-side verification (เป็น local gate)
  - Auto-biometric — เรียกอัตโนมัติเมื่อแสดงหน้าปลดล็อก โดยมี debounce 1.6 วินาที
  - Privacy lock — เมื่อ `visibilitychange` เป็น hidden, `pagehide`, หรือ `blur` ในโหมด standalone จะปิดบังหน้าจอทันที
- Error / message — "อุปกรณ์นี้ไม่รองรับ Web Crypto สำหรับ App Lock", "รหัสต้องมี 6-12 หลัก", "รหัสทั้งสองช่องไม่ตรงกัน",
  "รหัสไม่ถูกต้อง", "ใส่ผิด N ครั้ง กรุณารอสักครู่", "ใช้รหัสแทนได้" (กรณี `NotAllowedError` จาก biometric)
- Edge case สำคัญ — `MTAppLock.start(callback)` เรียก `callback()` (คือ `init()`) ทันทีแม้ยังล็อกอยู่ (บรรทัด 390–393)
  แอปจึงบูตเบื้องหลังขณะหน้าล็อกครอบอยู่ — เป็น privacy gate ไม่ใช่ security boundary ที่แท้จริง
- ปิด App Lock ใช้ `window.confirm()` ของเบราว์เซอร์ (บรรทัด 512) ต่างจากที่อื่นที่ใช้ `App.showConfirm`

## F-32 บัญชีผู้ใช้และการซิงก์ข้ามอุปกรณ์

- Entry point — เมนูบัญชีมุมขวาบนของหน้า More (`MTAuthSync.accountMenuHtml()`)
- Logic (`auth_sync.js`)
  - เข้าสู่ระบบด้วย Google OAuth 2.0 แบบ PKCE — `randomPkceVerifier()`, `pkceChallenge()`, redirect ไป `${supabaseUrl}/auth/v1/authorize`
  - session เก็บที่ `localStorage['mt_auth_sync_state']`, มี auto-refresh พร้อม retry สูงสุด 3 ครั้ง และ background refresh 5 นาทีก่อนหมดอายุ
  - ข้อมูลถูกเข้ารหัสก่อนอัปโหลดเสมอ (`crypto_vault.js`)
    - Recovery key สุ่มจากเครื่องผู้ใช้ (`generateRecoveryKey`)
    - PBKDF2-SHA256 310,000 รอบ derive key จาก recovery key + salt
    - data key AES-GCM 256 บิต สุ่มใหม่ แล้ว wrap ด้วย key ที่ derive ได้
    - payload ถูก canonical-stringify (คีย์เรียงตัวอักษร) แล้วเข้ารหัส AES-GCM พร้อม checksum SHA-256
  - `syncNow({direction, recoveryKey, silent})`, `markDirty()` + debounce 2.5 วินาที, `autoSyncIfReady()`
  - ตรวจจับ conflict (`handleRemoteConflict`) และตรวจจับข้อมูล demo (`currentDataLooksLikeDemo`, `showDemoVaultWarning`)
- ลบบัญชี — 2 ขั้น
  1. `sendDeleteOtp()` เรียก `GET /auth/v1/reauthenticate` (Supabase ส่ง OTP ทางอีเมล)
  2. `verifyOtpAndDelete(token)` เรียก `POST /auth/v1/verify` แล้วจึง `deleteAccount()` ซึ่งลบ vault → เรียก edge function `delete-account` → ล้าง localStorage/sessionStorage → reload
- หมายเหตุ — มี edge function `send-delete-otp` ที่ส่ง OTP เองผ่าน Resend และตาราง `mt_delete_otps` แต่เส้นทางที่โค้ดฝั่งไคลเอนต์ใช้จริงคือ GoTrue reauthenticate ไม่ใช่ฟังก์ชันนี้ (ดู SECTION 15)
- การกู้คืนกรณีลืม recovery key — `showVaultLockedSheet()` และ `readDeviceRecoveryKey()` (เก็บไว้ในเครื่องที่ `mt_auth_sync_recovery_key`)

## F-33 แจ้งเตือน (Notifications)

- Entry point — More → (ผ่าน `notifications_v2.js` ที่ wrap `App.renderMore`) และ `App.openCustomNotificationRulesScreen()`
- Database ฝั่งเครื่อง — `mt_notification_install_id`, `mt_notification_push_sub`, `mt_notification_last_snapshot_sync`, `mt_notification_last_rules_sync`, `mt_notification_last_rules_hash`
- Database ฝั่งเซิร์ฟเวอร์ — ดู SECTION 8
- Trigger ทั้งหมด 13 แบบ (`VALID_TRIGGERS` ใน `sync-notification-rules/index.ts`)
  `daily_time`, `weekly_time`, `one_time`, `no_transaction_today`, `upcoming_bill_due`, `credit_card_due`,
  `backup_stale`, `monthly_time`, `weekday_only_time`, `no_tx_streak`, `budget_over`, `recurring_due_today`, `privilege_expiry`
- Route ที่กดแล้วเปิดได้ 12 แบบ (`VALID_ROUTES`)
  `dashboard`, `addTx`, `transactions`, `wallets`, `reports`, `more`, `upcomingBills`, `creditCards`, `goals`, `recurring`, `budgets`, `privileges`
- Logic
  - `enableNotifications()` — ขอ permission → subscribe push → `POST /functions/v1/register-notification-device`
  - `buildSnapshot()` — สร้าง snapshot จากข้อมูลในเครื่อง แล้ว `syncSnapshot()` ส่งขึ้น (TTL 10 นาที)
  - `syncCustomRules()` — ส่งกฎขึ้น (TTL 6 ชั่วโมง, มี hash กันส่งซ้ำ)
  - cron ฝั่งเซิร์ฟเวอร์ทุก 15 นาทีประเมินกฎแล้วส่ง Web Push
  - dedupe ด้วย `mt_notification_logs` (unique key: install_id + notification_type + dedupe_key)
  - เมื่อกด notification → `service-worker_v2.js` `notificationclick` → focus client เดิมแล้ว `postMessage({type:'NOTIFICATION_NAVIGATE', route})` (เพราะ `client.navigate()` มักล้มเหลวเงียบ ๆ บน iOS PWA) หรือเปิดหน้าต่างใหม่ที่ `./index.html#<route hash>`
- Status label — "เปิดแล้ว" / "ถูกบล็อก" / ค่าอื่นตาม `Notification.permission`
- Privacy — snapshot ถูก sanitize ฝั่งเซิร์ฟเวอร์เหลือแค่ `{daysLeft}` และ `{pct, over}` สูงสุด 100 แถวต่อชุด

## F-34 Onboarding

- Logic (`onboarding.js`) — wrap render functions 6 ตัว
  - checklist 3 ขั้นบนแดชบอร์ด: เพิ่มกระเป๋า → บันทึกรายการแรก → ดูรายงาน (แต่ละขั้นถัดไปถูก disable จนขั้นก่อนเสร็จ)
  - auto-dismiss ถาวรเมื่อครบ 3 ขั้น หรือเมื่อพบว่าผู้ใช้มีข้อมูลอยู่แล้วตั้งแต่ตอนโหลด
  - toast ครั้งเดียวหลังบันทึกรายการแรก (หน่วง 600ms)
  - empty state ในหน้ากระเป๋าและรายงาน
  - hint ในหน้า More แนะนำให้ตั้งรายการประจำ (ปิดได้ถาวร)
- Database — `localStorage['mt_onboarding']` = `{ dismissed, reportVisited, firstTxNudgeSeen, moreHintSeen }`

## F-35 โหมด Demo และ Rescue

- Demo — `?demo=1` หรือ More → แตะเลขเวอร์ชัน 5 ครั้ง (`App._tapDemoEntry`) → `/demo/index.html`
  `demo_bootstrap.js` ตั้ง `MT_DEMO_MODE = true` และแทนที่ `window.localStorage` ทั้งตัวด้วย shim ที่เก็บใน `Map` ในหน่วยความจำ
  (`Object.defineProperty(window,'localStorage',{value: demoStorage})`) ดังนั้นโหมด demo จะเขียนทับข้อมูลจริงไม่ได้เลย
  ถ้า `defineProperty` ล้มเหลว จะตั้ง `MT_DEMO_STORAGE_DISABLED = false` เพื่อบอกว่าการแยกข้อมูลไม่สำเร็จ
- Rescue — `rescue.html` เป็นหน้า standalone ที่สแกน `localStorage` หา backup และเขียนกลับลงคีย์จริง (มี `APP_KEYS` 30 คีย์ และ `FIELD_MAP`)
- Guard — `App._looksLikeDemoData()` ตรวจว่าข้อมูลมีร่องรอย demo (`demo_` prefix, ชื่อ "SCB Main"/"KTC Cashback")
  ถ้าพบในแอปจริงจะขึ้นแบนเนอร์สีส้มค้างบนสุดพร้อมปุ่มเปิด Rescue (`App._showRescueBannerIfNeeded`)

## F-36 ธีมและการแสดงผล

- โหมดมืด — `App.toggleDark()` toggle class `dark` บน `<html>` และเปลี่ยน `<meta name="theme-color">`
- สีธีม 8 สี — `App.setAccent(color)` เขียน CSS variable `--primary`
- ซ่อนจำนวนเงิน — `App.toggleHideMoney()` ทำให้ `moneyFmt` คืน `฿*****`
- ธง ui-v2 — `S.settings.uiV2` หรือ query `?uiv2=1` / `?uiv2=0` toggle class `ui-v2`
- Zoom lock — บล็อกแยกที่บรรทัด 10–81 ("V6.2 Hard mobile zoom lock")

## F-37 การรองรับปุ่มย้อนกลับของระบบ

- Logic (บรรทัด 24598–24720) — patch `openOverlay`/`closeOverlay`/`openSubScreen`/`closeSubScreen`/`showConfirm`
  - แต่ละชั้นที่เปิด = `history.pushState` 1 ครั้ง; แต่ละชั้นที่ปิดผ่าน UI = `history.back()` 1 ครั้ง
  - `popstate` listener ปิดชั้นบนสุดโดยการ "คลิกปุ่มเดียวกับที่ผู้ใช้จะกด" เพื่อให้พฤติกรรมตรงกันเสมอ
  - `pendingDelta` + `queueMicrotask` netting — ป้องกัน race เมื่อปิดชั้นหนึ่งแล้วเปิดอีกชั้นใน tick เดียวกัน (เช่น ทำซ้ำ/แก้ไขรายการ)
  - `poppingOurs` flag แยกกรณี "เบราว์เซอร์ pop ให้แล้ว" กับ "ผู้ใช้ปิดเอง เรายังติดหนี้ pop อยู่"
- ขอบเขตที่ไม่ครอบคลุม (ระบุในคอมเมนต์เอง) — ไดอะล็อกที่สร้าง/ลบ DOM node เองโดยตรง เช่น privilege actions

## F-38 Undo

- `App._withUndo(message, undoFn, commitFn)` และ `App._doUndo` — ใช้กับ ลบร้านค้า, ลบหมวดหมู่, ลบชุดผ่อน, ลบรายการ ฯลฯ
- `App._undoState` เก็บสถานะปัจจุบัน

---

# SECTION 3 — Screen Documentation

## 3.0 โครงสร้าง Route ทั้งระบบ

ระบบใช้ hash routing ระดับหน้าเท่านั้น `APP_ROUTE_PAGES = {dashboard, transactions, wallets, reports, more}` (บรรทัด 1126)
- `writeAppHashRoute(page)` เขียน `#<page>` ด้วย `history.replaceState`; หน้ารายงานเพิ่ม `?month=YYYY-MM`
- `parseAppHashRoute()` อ่านกลับ และ validate ว่าเป็นหน้าที่รู้จัก มิฉะนั้นคืนค่าว่าง
- deep link เปิด sub-screen ใช้ query `?open=<name>` รองรับ 6 ค่า: `upcomingBills`, `goals`, `recurring`, `budgets`, `privileges`, `addTx`, `creditCards`
- Service Worker map route → hash ที่ `routeHash()` (12 route)
- sub-screen ทั้งหมด (50+ หน้า) ไม่มี URL เป็นของตัวเอง — refresh แล้วกลับไปหน้าหลักเสมอ

## 3.1 หน้า Dashboard (หน้าหลัก)

- Route — `#dashboard` (หน้าเริ่มต้น)
- DOM — `<div class="page active" id="page-dashboard"><div class="page-scroll" id="dashboard-content">`
- Renderer — `App.renderDashboard` ถูกนิยาม 5 ครั้ง (บรรทัด 874, 4211, 17426, 18755, 19199) และถูก wrap อีกโดย `onboarding.js`
- จุดประสงค์ — สรุปสถานะการเงินวันนี้ พร้อมสิ่งที่ต้องทำ
- Layout จากบนลงล่าง (ตาม `App.renderDashboard` บรรทัด 4211 เป็นต้นไป)
  1. Topbar — ชื่อแอป + จุดสถานะออฟไลน์ + ปุ่มรีเฟรช (`App.refreshDashboard`) + ปุ่มซ่อนเงิน (`App.toggleHideMoney`)
     (ซ่อนทั้งแถบเมื่อเปิดธีม ui-v2 เพราะย้ายไปอยู่ในการ์ดหัวเรื่องแทน)
  2. แถบเตือน ledger integrity — แสดงเมื่อ `S._ledgerIssues.length > 0` แตะแล้วเปิด `App._showLedgerIssues()`
  3. Month nav — chip 6 เดือนล่าสุด (`App.setDashMonth`)
  4. Alert รายการประจำที่ถึงกำหนด — พร้อมปุ่ม "บันทึก" / "ข้าม" และ badge "เกินกำหนด N รอบ"
  5. แบนเนอร์สรุปเดือนก่อน — แสดงเฉพาะวันที่ 1–5 ของเดือนและยังไม่ถูกปิด (`App._checkMonthlySummary`, `_dismissMonthlySummary`, `_showMonthlySummaryDetail`)
  6. การ์ด Net / ความมั่งคั่ง (`.mt-net-card`) — `onboarding.js` แทรก checklist ต่อจากการ์ดนี้
  7. คะแนนสุขภาพการเงิน (healthyPct) — สูตรถ่วงน้ำหนัก 3 องค์ประกอบ (ดู SECTION 7)
  8. Alert บัตรเครดิตใกล้ครบกำหนด — แสดงเฉพาะเมื่อ `daysLeft <= 3` และยังไม่พบการชำระ
  9. งบประมาณเดือนนี้ + daily chip
  10. การ์ด AI Insight (`InsightEngine.getTopN(n, 'dashboard', S)`)
  11. รายการล่าสุด 5 รายการของเดือนที่เลือก
- Components — `.mt-topbar`, `.mt-net-card`, `.mt-recurring-alert`, `.mt-summary-banner`, `.mt-integrity-warn`, `.chip`, `.card card-pad`, `.daily-budget-chip`, `.sec-title`
- ปุ่มทั้งหมดบนหน้านี้
  - `↻` รีเฟรช → `App.refreshDashboard()` (recalc + re-render + refresh ราคาตลาด + toast "รีเฟรชข้อมูลล่าสุดแล้ว")
  - `👁 / 🙈` ซ่อนเงิน → `App.toggleHideMoney()`
  - chip เดือน → `App.setDashMonth(m)`
  - "บันทึก" ในการ์ดรายการประจำ → `App.postRecurringNow(id)`
  - "ข้าม" → `App.skipRecurringNow(id)`
  - `×` ปิดแบนเนอร์สรุป → `App._dismissMonthlySummary(month)`
  - "ดูรายละเอียด" → `App._showMonthlySummaryDetail(month)`
  - "ดูรายงาน" ในหัวข้องบประมาณ → `App.setRptView('budget'); App.showPage('reports')`
  - "ดูอีก N หมวด" → เช่นเดียวกัน
  - ปุ่มบนการ์ด insight → `App.insightAct` / `insightDismiss` / `insightSnooze` / `insightRate`
  - FAB `+` → `App.openAddTx()`
  - FAB ไมค์ → `App.openQuickCapture()`
- Input — ไม่มี input โดยตรงบนหน้านี้
- State ที่ใช้ — `S.dashMonth`, `S.transactions`, `S.wallets`, `S.budgets`, `S.settings.hideMoney`, `S._ledgerIssues`, `S._isOffline`, `S._lastHealthyBreakdown`
- Empty state — checklist onboarding เข้ามาแทนเมื่อเป็นผู้ใช้ใหม่
- API — เรียก `App.refreshMarketPrices()` (network) เมื่อกดรีเฟรช

## 3.2 หน้า Transactions (รายการ)

- Route — `#transactions`
- DOM — `#page-transactions` มี `.page-header` (sticky) และ `.page-scroll#tx-list-content`
- Renderer — `App.renderTransactions` (บรรทัด 7446) + wrapper Wave 4 (บรรทัด 23681) ที่ย้ายการ์ดสรุปไปหลังแถวเดือน
- Layout
  - Header: ช่องค้นหา (`#tx-search`) พร้อมปุ่มล้าง `×`, ปุ่ม "ตัวกรอง (N)"
  - แผงตัวกรอง (toggle ด้วย `App.toggleTxFilterPanel`) — chip เดือน, chip ประเภท, การ์ดสรุปรายรับ/รายจ่าย
  - รายการจัดกลุ่มตามวันที่: หัววันที่ (`.tx-date-header`) + การ์ดกลุ่ม (`.tx-group-card`) ที่มีแถว `App._txRow(t)`
- Input — ช่องค้นหา 1 ช่อง (`oninput` → อัปเดต `S.txSearch` แล้ว re-render list เท่านั้น ไม่ re-render header)
- Filter — เดือน (`App.setTxMonth`), ประเภท (`App.setTxType`), ค้นหา, `App.clearTxFilters`, `App.clearTxMerchant`
- Search — ค้นได้จาก "รายการ ร้านค้า หมวด จำนวนเงิน" (ตาม placeholder)
- Sorting — ตายตัว วันที่ใหม่ → เก่า ไม่มีตัวเลือกให้ผู้ใช้
- Pagination — ไม่มี
- Modal — แตะแถวรายการ → `App.openTxDetail(id)` เปิด overlay `#overlay-tx-detail`
- Empty state — `📋 ไม่มีรายการ` + "ไม่พบผลการค้นหา" หรือ "ยังไม่มีรายการในช่วงนี้"
- State — `S.txMonth`, `S.txType`, `S.txSearch`, `S.transactions`
- พฤติกรรมพิเศษ — เก็บ `scrollTop` ก่อน re-render แล้วคืนค่ากลับ

## 3.3 หน้า Wallets (กระเป๋าเงิน)

- Route — `#wallets`
- DOM — `#page-wallets` มี `.page-header` (h1 + `#wallets-summary`) และ `#wallets-content`
- Renderer — `App.renderWallets` นิยาม 3 ครั้ง (บรรทัด 862, 14039) + wrap โดย `onboarding.js`
- Layout — สรุปยอดด้านบน, แถบแท็บกระเป๋า (`.wallet-tab-bar` inject ครั้งเดียว), การ์ดกระเป๋าแยกตามกลุ่ม
- การ์ดกระเป๋า — `App._walletCard(w, ctx)`; บัตรเครดิตมีแถบวงเงินและแถบวันครบกำหนด; BNPL ใช้ `BNPL.ui.walletCard`
- ปุ่ม — เพิ่มกระเป๋า (`App.openWalletForm(null)`), แก้ไข (`App.openWalletForm(id)`), ชำระบัตร (`App.openCCPay(id)`),
  จ่ายงวด BNPL (`BNPL.ui.openPayModal`), สลับโหมดจัดเรียง (`App._toggleWalletReorder`)
- การนำทางเข้าออก — แตะการ์ด: บัตรเครดิต → `App.openCCDetail(id)`; BNPL → `BNPL.ui.openPlanList(id)`; อื่น ๆ → `App.openWalletDetail(id)`
- Empty state — การ์ด "ยังไม่มีกระเป๋าเงิน" จาก `onboarding.js`
- ข้อควรระวังที่ระบุใน `CLAUDE.md` — `.wallet-tab-bar` inject ครั้งเดียว ถ้าเพิ่มแท็บใหม่ต้องลบของเดิมก่อนหรือเปลี่ยนชื่อคลาส

## 3.4 หน้า Reports (รายงาน)

- Route — `#reports` หรือ `#reports?month=YYYY-MM`
- DOM — `.page-header` มี h1 + `#report-month-chips` + `#report-view-chips`; เนื้อหาที่ `#reports-content`
- Renderer — `App.renderReports` นิยาม 5 ครั้ง (บรรทัด 6646, 17644, 18807, 19256, และ patch ปฏิทินที่ 23583)
- Tabs — chip 8 มุมมอง (assets / expense / income / cashflow / credit / budget / trend / calendar)
- Filter — chip เดือน 6 เดือนล่าสุด
- Table / Chart — เป็น HTML/SVG ที่วาดเอง ไม่มีไลบรารีกราฟ
- Modal — `App.openDaySheet(date)` จากปฏิทิน; `App.openReportsCoach` / `closeReportsCoach` เป็นแผงคำแนะนำ
- Empty state — ข้อความจาก `onboarding.js` เมื่อยังไม่มีรายการ
- State — `S.rptMonth`, `S.rptView`, `S.transactions`, `S.wallets`, `S.budgets`

## 3.5 หน้า More (เพิ่มเติม)

- Route — `#more`
- Renderer — `App.renderMore` เวอร์ชันสุดท้ายอยู่ที่บรรทัด 23706 (ก่อนหน้านั้นถูกเขียนทับโดย `notifications_v2.js` และ `split_bill.js` และ wrap โดย `onboarding.js`)
- Layout
  - Sticky header: หัวข้อ "เพิ่มเติม" + เมนูบัญชี (`MTAuthSync.accountMenuHtml()`) + ช่องค้นหาฟีเจอร์ (`#more-search`)
  - แถบแท็บ 3 แท็บ: บัตร (ค่าเริ่มต้น) / วางแผน / ตั้งค่า
- แท็บ "บัตร" — 5 รายการ
  1. 🎟️ สิทธิพิเศษ (แสดงจำนวนสิทธิ์ที่ยัง active) → `App.openPrivilegesScreen('active')`
  2. 🎁 บัญชีคะแนนบัตรเครดิต → `App.openRewardLedgerScreen()`
  3. 💎 รวมสิทธิประโยชน์บัตรเครดิต (นับกฎที่ active) → `App.openCCBenefitOverviewScreen()`
  4. 💳 กลุ่มวงเงินร่วม → `App.openCreditLimitGroupScreen()`
  5. 🧾 ศูนย์ผ่อนชำระ → `App.openInstallmentCenter()`
- แท็บ "วางแผน" — 6 กลุ่ม
  - สรุปของฉัน: 🛰️ ภาพรวมการเงิน (แสดง headline จาก `App.getCachedFinanceBrief()`) → `App.openFinanceSummary()`
  - ควบคุมเงินเดือนนี้: 💰 งบประมาณ, 🧾 รายการรอจ่าย, 🔁 รายการประจำ, 📅 ปฏิทินบิล
  - วางแผนอนาคต: 🎯 เป้าหมายการเงิน, 🗺️ แผนอนาคตของคุณ, 🧪 ลองและเทียบแผน
  - เข้าใจพฤติกรรม: 💬 ถามได้เลย, 📚 ประวัติย้อนหลัง
  - เงินร่วมกัน: 🍽️ หารบิล, 🤝 เงินที่แชร์กับคนอื่น, 💸 ให้ยืมเงิน (แสดงจำนวนรายและยอดรวม)
  - ผู้ช่วยส่วนตัว: 🧭 ผู้ช่วยส่วนตัว (แสดงจำนวน action log)
- แท็บ "ตั้งค่า" — 6 กลุ่ม
  - จัดการ: 🏷️ หมวดหมู่, 🏪 ร้านค้า/Platform, 🔀 ช่องทางการใช้จ่าย, 🔧 ตรวจสอบยอดคงเหลือ, 🩺 ตรวจสอบความถูกต้องของข้อมูล
  - ข้อมูล: 🧯 Rescue (แสดงเฉพาะเมื่อพบข้อมูล demo), 📤 ส่งออก JSON, 📊 ส่งออก CSV, 📥 นำเข้า JSON, 🧯 กู้คืน Backup ก่อน Import, 💾 สถานะข้อมูล (เวลาบันทึกล่าสุด / export ล่าสุด)
  - ความปลอดภัย: 🔒 App Lock, 🛡️ ล็อกแอปตอนนี้ (เฉพาะเมื่อเปิดใช้แล้ว)
  - การแสดงผล: 🌙 โหมดมืด (toggle), 🎨 สีธีม 8 สี
  - ระบบ: 💾 พื้นที่จัดเก็บ, 🧹 ล้างแคชแอป, 🔄 รีเซ็ตข้อมูลทั้งหมด (danger)
  - ท้ายหน้า: โลโก้ 💰, ชื่อแอป, เลขเวอร์ชัน (แตะ 5 ครั้งเข้าโหมด demo), ลิงก์นโยบายความเป็นส่วนตัว
  - หมายเหตุ: รายการตั้งค่าการแจ้งเตือนถูกเพิ่มโดย `notifications_v2.js` ซึ่ง wrap `App.renderMore` (`renderNotificationSettings`)
- Search — `App._filterMoreContent(q)` ค้นจากข้อความใน `.s-label` ทุกแถว, ซ่อนการ์ดและหัวข้อที่ไม่มีแถวเหลือ, ระหว่างค้นหาจะแสดงทุกแท็บพร้อมกันและซ่อนแถบแท็บ
- Input — ช่องค้นหา 1 ช่อง + `<input type="file" id="import-file-v5b" accept=".json">` ที่ซ่อนอยู่
- State — `S.moreTab`, `S.settings`, และเกือบทุก collection (เพื่อแสดงตัวเลขสรุป)

## 3.6 Overlay ที่ประกาศไว้ใน index.html (6 ตัว)

| id | หัวข้อ | ปิดอย่างไร | เนื้อหาถูกเติมโดย |
|---|---|---|---|
| `overlay-add-tx` | เพิ่ม/แก้ไขรายการ | backdrop → `App.closeAddTx()` | `App._renderAddTxAmount` / `_renderAddTxDetail` |
| `overlay-tx-detail` | รายละเอียด | backdrop + ปุ่ม ✕ | `App._renderTxDetail` |
| `overlay-wallet-form` | เพิ่ม/แก้ไขกระเป๋าเงิน | backdrop + ✕ (มีปุ่มบันทึกใน header) | `App.openWalletForm` |
| `overlay-cc-pay` | ชำระบัตรเครดิต | backdrop + ✕ | `App.openCCPay` |
| `overlay-benefit-cap-breakdown` | สิทธิ์คงเหลือรายร้าน/ช่องทาง | backdrop + ✕ | `App.openBenefitCapBreakdownSheet` |
| `overlay-rule-transactions` | รายการที่ track ไว้ | backdrop + ✕ | `App.openRuleTransactionsSheet` |

Overlay ที่ inject เพิ่มตอน runtime
- `overlay-bnpl-pay` และ `overlay-bnpl-edit` — จาก `bnpl.js` `injectOverlays()`
- `overlay-quick-capture` — จาก `quick_capture.js` `getOrCreateOverlay()`
- `#mt-app-lock` — จาก `app_lock.js` `ensureOverlay()`
- `v23-confirm-overlay` — จาก `App.showConfirm`
- `mt-delete-account-sheet`, `mt-recovery-key-overlay` — จาก `auth_sync.js`
- `mt-update-banner` — แบนเนอร์อัปเดต SW
- `mt-rescue-banner` — แบนเนอร์เตือนข้อมูล demo

ทุก overlay ใช้โครงสร้างเดียวกัน: `.overlay > .overlay-backdrop + .sheet > .sheet-handle + .sheet-header + .sheet-body`
และมี ARIA ครบ (`role="dialog"`, `aria-modal="true"`, `aria-label` หรือ `aria-labelledby`)

## 3.7 Sub-screens (หน้าซ้อนที่ใช้ `#sub-screen`)

ทุกหน้าใช้โครงสร้าง `.sub-header` (ปุ่ม ← + h2 + ปุ่มขวา) + `.sub-scroll`
รายการที่พบในโค้ด (จัดกลุ่มตามหมวด)

กระเป๋าและบัตร
- รายละเอียดกระเป๋า — `App.openWalletDetail(id)` (บรรทัด 2456) มีตัวกรองช่วงเวลา (`App.setWalletTxRange`, `setWalletTxCustom`, `_filterWalletTx`)
- รายละเอียดบัตรเครดิต — `App.openCCDetail(cardId)` (บรรทัด 16616) มี hero, pager รอบบิล (swipe ได้ `App._bindCCCycleSwipe`), รายการผ่อน, รายการล่าสุด
- แผน BNPL — `BNPL.ui.openPlanList(walletId)`
- ตรวจสอบยอดคงเหลือ — `App.openBalanceRepairScreen()`
- กลุ่มวงเงินร่วม — `App.openCreditLimitGroupScreen()` / `App.openCreditLimitGroupForm()`
- บัญชีคะแนน — `App.openRewardLedgerScreen()` / `App.openRewardAccountForm()` / `App.openAdjustPointsForm()`
- สิทธิประโยชน์บัตร — `App.openCCBenefitScreen(cardId)` / `App.openCCBenefitOverviewScreen()` / `App.openCCBenefitRuleForm()` (wizard 3 ขั้น) / `App.openCCBenefitRuleCopyDialog()` / `App.openCCBenefitImportDialog()`
- ศูนย์ผ่อนชำระ — `App.openInstallmentCenter(cardId?)` / `App.openEditInstallmentGroup()`
- Crypto — `App.openCryptoPortfolioDetail()` / `App.openCryptoHoldingForm()` / `App.openCryptoTxForm()`

การวางแผน
- งบประมาณ — `App.openBudgetScreen()`
- รายการรอจ่าย — `App.openUpcomingBillsScreen()` / `openUpcomingBillForm` / `openUpcomingBillPayment` / `openUpcomingBillReschedule`
- รายการประจำ — `App.openRecurringScreen()` / `openRecurringForm` / `openRecurringActions`
- ปฏิทินบิล — `App.openUpcomingScreen()`
- เป้าหมาย — `App.openGoalsScreen()` / `openGoalForm` / `openGoalRebalanceCompare`
- แผนชีวิต — `App.openLifePlanning()` / `openAddLifePlanForm`
- Planning Lab — `App.openPlanningLab()` / `openScenarioLab` / `openScenarioCompare` / `applyScenarioPreset` / `renderScenarioPreview`
- ภาพรวมการเงิน — `App.openFinanceSummary()` / `openProactiveBrief` / `openMonthlyReview`
- Coaching Hub — `App.openCoachingHub()` / `openFinanceCoachProfile` / `openActionAuditLog` / `openFeedbackAnalytics` / `openFinancialMemory` / `openFinanceActionPreview` / `openRecommendationFeedbackReason`
- ถามได้เลย — `App.openAskMyMoney()`
- ประวัติย้อนหลัง — `App.openFeatureHistory()`

เงินร่วมกัน
- หารบิล — `App.openSplitBillScreen()` / `openSplitBillDetail` / `openSplitBillForm` / `openSplitPeopleScreen`
- เงินที่แชร์ — `App.openSharedFinanceDashboard()` / `openSharedExpenseReimbursement`
- ให้ยืมเงิน — `App.openLoansScreen()` / `openLoanDetail` / `openLoanForm` / `openRepaymentForm`

ตั้งค่าและข้อมูล
- หมวดหมู่ — `App.openCategoryScreen(type, q)` (บรรทัด 1685) มีแท็บรายจ่าย/รายรับ + ช่องค้นหา + `openCategoryForm`
- ร้านค้า — `App.openMerchantScreen(q)` (บรรทัด 1703) + `openMerchantForm`
- ช่องทางการใช้จ่าย — `App.openChannelScreen()` (บรรทัด 3276) เพิ่ม/ลบ/เปลี่ยนชื่อช่องทางเอง
- สิทธิพิเศษ — `App.openPrivilegesScreen(tab)` / `openPrivilegeForm` / `openPrivilegeDetail` / `openPrivilegeActions` / `openPrivilegeUsedDialog`
- พื้นที่จัดเก็บ — `App.openStorageDiagnostics()`
- Preview นำเข้า — `App.openImportPreview()` (บรรทัด 17087)
- รายละเอียดรายการ (แบบ sub-screen) — `App.openTxDetailSub(id)` (บรรทัด 6507) มีปุ่มแก้ไข / ทำซ้ำ / ลบ
- กฎแจ้งเตือน — `App.openCustomNotificationRulesScreen()` / `App.openNotificationRuleForm()`

## 3.8 หน้า static แยกไฟล์

- `privacy.html` — นโยบายความเป็นส่วนตัว CSP เข้มมาก (`default-src 'none'`) รองรับ dark mode ผ่าน `prefers-color-scheme`
- `rescue.html` — เครื่องมือกู้ข้อมูล มี 3 การ์ด: สถานะตอนนี้ (สแกน), กู้คืน (ตัวเลือก), เปิดแอป (ลิงก์กลับแอปจริง / demo)
- `ui_v2_preview.html` — หน้าตัวอย่างธีม ui-v2
- `demo/index.html` — แอปเวอร์ชัน demo
