# UI Design Spec — Money Tracker

> **Single source of truth สำหรับการรีดีไซน์ทุกหน้า**
> เอกสารนี้คุมให้ทุกหน้า consistent ระหว่างการเปลี่ยนดีไซน์ ("Calm Banking + AI Bento")
> ก่อนแก้ UI หน้าใด **อ่านเอกสารนี้ก่อน** และห้ามเพิ่ม token/สี/ค่าใหม่นอกที่กำหนดไว้ที่นี่
>
> อ้างอิงสถาปัตยกรรมโค้ดที่ [`CLAUDE.md`](../CLAUDE.md) · tokens จริงอยู่ที่ `style_v2.css` `:root` (บรรทัด ~1569)

---

## 0. Design DNA (ปรัชญา)

ภาษาดีไซน์เดียวที่หลอมจากแอปอ้างอิง:

1. **Colored header, calm body** — หน้าหลักเปิดด้วย header การ์ดสีแบรนด์ (น้ำเงิน) ที่มี "ตัวเลขเด่นที่สุดในจอ" เนื้อหาที่เหลือวางบนพื้น `--bg` สงบตา
2. **White sheet overlap** — เนื้อหาเลื่อนทับ header ด้วยมุมโค้งบน สร้างมิติแบบบัตรซ้อน
3. **Bento over big-chart** — สรุปข้อมูลเป็นการ์ดเล็ก 2–3 ช่องที่อ่านจบใน 1 วินาที ดีกว่ากราฟใหญ่ตัวเดียว
4. **AI is first-class** — แถบ AI สีดำคอนทราสต์ ปักหมุดในตำแหน่งที่เห็นง่าย (ผูก `ai_insights.js`, `ask_my_money_core.js`)
5. **Flat + soft shadow, ไม่ใช่ glassmorphism** — เงาฟุ้งบาง อ่านง่ายกลางแดด ลดความเสี่ยง render/white-flash
6. **Semantic color = ความหมาย** — เขียว=รายรับ/บวก, แดง=รายจ่าย/หนี้, ฟ้า=แบรนด์/โอน, ม่วง=แต้ม/รีวอร์ด, เหลือง=เตือน/งบ

### กฎเหล็ก (Non-negotiables)
- ✅ ใช้ token จาก `:root` เท่านั้น — **ห้าม hardcode hex** ในโค้ด UI (ยกเว้นสีบนพื้นสีแบรนด์ เช่น `#ffffff1f` overlay บน header)
- ✅ ทุกอย่างต้องผ่านทั้ง **light + dark mode** — เทสต์ทั้งสองก่อน merge
- ✅ ทำ **ทีละหน้า / ทีละ PR** (scope discipline) — ห้ามแก้สีทั้งระบบรวดเดียว
- ✅ **redesign ทั้งหมดอยู่หลัง feature flag** (ตัดสินใจแล้ว: gate-then-flip) — งานทุก PR ซ่อนหลัง flag, เปิดให้ผู้ใช้พร้อมกันเมื่อครบทุกหน้า เพื่อไม่ให้ production เห็นครึ่งเก่าครึ่งใหม่
- ❌ ห้าม gradient หนัก, glassmorphism เต็มจอ, neon, เงาเข้มเกิน `--shadow-float`
- ❌ ห้ามฟอนต์อื่นนอกจาก LINE Seed Sans TH

---

## 1. Design Tokens

> ทั้งหมดนิยามไว้แล้วใน `style_v2.css`. **ส่วนนี้คือ contract — อย่าเปลี่ยนค่า เพียงใช้ตาม.**

### 1.1 Color — Light (`:root`)
| Token | Hex | ใช้กับ |
|---|---|---|
| `--bg` | `#F6F7FB` | พื้นหน้าจอ |
| `--surface` | `#FFFFFF` | การ์ด, list card, sheet |
| `--elevated` | `#F1F5F9` | ปุ่ม secondary, icon chip พื้นกลาง, เส้นคั่นอ่อน |
| `--surface-soft` | `#F8FAFC` | input, การ์ดซ้อนชั้นใน |
| `--text` | `#0F172A` | ข้อความหลัก |
| `--muted` | `#64748B` | ข้อความรอง, label, caption |
| `--border` | `#E2E8F0` | เส้นขอบ, divider |
| `--primary` | `#2563EB` | แบรนด์, header, FAB, active state, โอน |
| `--primary-soft` | `#EFF6FF` | พื้น tx-icon, insight card, chip active แบบอ่อน |
| `--income` | `#16A34A` | รายรับ, ค่าบวก, สำเร็จ |
| `--income-soft` | `#F0FDF4` | พื้นการ์ดรายรับ |
| `--expense` | `#DC2626` | รายจ่าย, หนี้, ค่าลบ, อันตราย |
| `--expense-soft` | `#FEF2F2` | พื้นการ์ดรายจ่าย |
| `--transfer` / `--transfer-soft` | `#2563EB` / `#EFF6FF` | โอนเงิน (= primary) |
| `--amber` / `--amber-soft` | `#F59E0B` / `#FFFBEB` | เตือน, งบประมาณ |
| `--purple` / `--purple-soft` | `#7C3AED` / `#F5F3FF` | แต้ม/คะแนน, รีวอร์ด, ลงทุน |
| `--dark-card` | `#0F172A` | **AI bar**, ปุ่มบันทึกหลัก, การ์ดบัตรเครดิต |

### 1.2 Color — Dark (`html.dark`)
ทุก token map อัตโนมัติ — ใช้ชื่อเดิม ไม่ต้องเขียน override เอง. ค่าอ้างอิง:
`--bg #0B1120` · `--surface #172033` · `--elevated #202C42` · `--text #F8FAFC` · `--muted #A5B4C7` · `--border #2B3A52` · `--dark-card #020617`. *-soft ทั้งหมดเป็น rgba โปร่งของสีเต็ม.

### 1.3 Typography
| ระดับ | size | weight | token/หมายเหตุ |
|---|---|---|---|
| Balance / hero number | 28–34px | 500 | `letter-spacing:-.5px`; ทศนิยม `opacity:.7` size เล็กลง |
| Section number (bento) | 20–24px | 500 | |
| Screen title | 18px | 500 | |
| Sheet/sub title | 15px | 500 | |
| Body | 15px | 400 | `--body-fs` |
| List item name | 13px | 400–500 | |
| Label / caption | 11–12px | 400 | `--label-fs` สี `--muted` |
| Section label (uppercase) | 10–11px | 500 | `--muted`, `letter-spacing:.5px` |
| Micro / nav | 9.6–10px | 400 | `--nav-label-fs` |

- **ฟอนต์เดียว:** `--font-line` (LINE Seed Sans TH)
- **น้ำหนัก 2 ระดับเท่านั้น:** 400 (ปกติ) / 500 (เน้น). หลีกเลี่ยง 700+ ยกเว้น chip active เดิมที่ใช้ 700/800 (คงไว้ได้ ไม่ต้องไล่แก้)
- **input/select/textarea/button = 16px** เสมอ (กัน iOS zoom — บังคับใน CSS แล้ว)
- **Sentence case** — ห้าม ALL CAPS ยกเว้น section label สั้นๆ

### 1.4 Spacing / Layout
| Token | ค่า | |
|---|---|---|
| `--app-max-w` | 430px | ความกว้างคอนเทนเนอร์สูงสุด |
| `--app-gutter` | 16px | ระยะขอบซ้าย-ขวามาตรฐาน |
| `--nav-h` | 64px | bottom nav |
| `--fab-size` | 54px | FAB กลาง |
| `--touch-h` / `-sm` | 44 / 36px | touch target ขั้นต่ำ |
| gutter ภายในการ์ด | 12–16px | |
| ช่องว่างระหว่างการ์ด | 8–14px | |
| จังหวะแนวตั้ง section | 16–22px | |

### 1.5 Radius
| Token | ค่า | ใช้กับ |
|---|---|---|
| icon chip (tx-icon) | 11–14px | กล่องไอคอนสี่เหลี่ยมมน |
| `--radius` | 16px | การ์ดมาตรฐาน, wallet card |
| `--radius-lg` | 22px | sheet, การ์ดใหญ่ |
| sheet overlap top | 20px | ขอบบน white sheet ที่ทับ header |
| pill / chip / toggle | 999px | |
| ปุ่มในกล่องเล็ก | 10–12px | |

### 1.6 Shadow
ใช้ตามลำดับความสูง ห้ามประดิษฐ์เงาใหม่:
`--shadow-xs` (การ์ดนิ่ง) → `--shadow-sm` (การ์ดยกเล็กน้อย, default การ์ดส่วนใหญ่) → `--shadow-md` (ยกเด่น) → `--shadow-float` (FAB, overlay, sheet ลอย). **ห้ามเกิน float.**

---

## 2. Layout System

### 2.1 โครงหน้า (Page skeleton)
```
┌─────────────────────────────┐  ≤430px, จัดกลาง
│  [Header card]  ── primary screens เท่านั้น
│   • สีแบรนด์/semantic เต็มกว้าง
│   • ตัวเลขเด่น + bento ใน header
├─────────────────────────────┤  white sheet, margin-top:-12px, radius 20 20 0 0
│  [Segmented chips]  (ถ้ามี filter)
│  [AI bar]           (ถ้าหน้านั้นมี insight)
│  [Bento row]        (ถ้ามีสรุป)
│  [Section label]
│  [List card / content]
│  ...scrollable...
├─────────────────────────────┤
│  [Bottom nav 5 + center FAB]  ── route pages เท่านั้น
└─────────────────────────────┘
```

### 2.2 ชนิดของหน้า
- **Route pages** (มี nav + FAB): `dashboard, transactions, wallets, reports, more` — เปิดด้วย **header card สี**
- **Sub screens** (มีปุ่ม ← กลับ): CC detail, CC benefits, wallet detail, จัดการหมวดหมู่, ตั้งงบ ฯลฯ — header เป็นแถบเรียบ (ไอคอน ← + title + action ขวา) ไม่เต็มสี
- **Sheets** (เลื่อนขึ้นจากล่าง): Add-tx, CC pay, forms — header แถวเดียว (✕ / title / บันทึก) + ปุ่ม primary ดำ full-width ล่างสุด

### 2.3 Header card — สเปก
| ส่วน | รายละเอียด |
|---|---|
| พื้น | `--primary` (dashboard/wallets/more) · `--income` (กระเป๋าเงินสด) · `--dark-card` (บัตรเครดิต) |
| ข้อความ | สีขาว; รอง = `rgba(255,255,255,.85)` |
| overlay box | `background:#ffffff1f`, radius 8–10, ใช้ทำ bento ใน header |
| ตัวเลขหลัก | 26–34px / 500 |
| padding | 16–18px |
| ทับ sheet | ให้ sheet ถัดมา `margin-top:-12px; border-radius:20px 20px 0 0` |

---

## 3. Component Library

> ทุก component = pattern เดียวใช้ซ้ำทุกหน้า. **เฟส 0 (✅ landed): สร้างไว้ใน `ui_v2.css` แล้ว** — ทุก class มี prefix `v2-` และ scope ใต้ `.ui-v2` (เช่น `.v2-bento-card`, `.v2-list-card`, `.v2-ai-bar`, `.v2-seg .pill`, `.v2-header`, `.v2-row`, `.v2-group`, `.v2-qa`, `.v2-badge`, `.v2-prog`, `.v2-btn-dark`, `.v2-catdot`). ไอคอนใช้ `.ti .ti-*` (Tabler subset). ชื่อด้านล่างเป็นเชิงแนวคิด — ใช้ชื่อจริง `v2-` ในโค้ด

### 3.1 `.bento-card` — การ์ดสรุปเลขเด่น
- พื้น: semantic-soft (`--primary-soft` / `--income-soft` / ...) ตามความหมาย
- radius 14 · padding 10–12
- บรรทัด 1: label 10px/500 สี semantic เต็ม + ไอคอนนำ
- บรรทัด 2: ค่า/ข้อความ 11–14px สี `--text`
- วางเป็นแถว `display:flex; gap:8px` ครั้งละ 2–3 ใบ

### 3.2 `.ai-bar` — แถบ AI
- พื้น `--dark-card`, ข้อความขาว, radius 14, padding 11–14
- ซ้าย: ไอคอน + ข้อความสั้น (insight อันดับ 1) · ขวา: ไอคอนไมค์/chevron
- ผูก action: `ask_my_money_core.js` (Home) หรือเปิด insight detail (Reports)

### 3.3 `.list-card` + `.tx-row`
- การ์ดขาว radius 14, padding `2px 12px`
- แต่ละแถว: `tx-icon` (32–36px, radius 11–14, พื้น semantic-soft, emoji/icon 15–17px) + ชื่อ(13px) & sub(10px `--muted`) + จำนวนเงินสี semantic ขวา
- คั่นแถวด้วย `border-bottom:1px solid var(--border)` ยกเว้นแถวสุดท้าย
- ใช้ `.tx-icon` เดิม (มีแล้ว `style_v2.css:1291`) เป็นฐาน

### 3.4 `.seg-pill` — chips filter
- inactive: พื้น `--elevated`, ข้อความ `--muted`
- active: พื้น `--primary`, ข้อความ `#fff`, weight 500
- radius 999, padding `5px 11px`, font 11px
- ใช้แทน chips เดิมทุกหน้า (transactions, wallets tab, reports view, range)

### 3.5 `.wallet-card`
- ใช้ระบบเดิม `.wallet-card-colored` + inline `--wallet-color` / `--wallet-color-2` (ห้าม inline `background:` ตรงๆ — ดู CLAUDE.md §CSS Wallet Card Colors)
- radius 16, padding 13–15, ข้อความขาว
- หัว: icon+ชื่อ ซ้าย / ป้ายชนิดหรือ badge เตือนขวา
- ยอด 20px/500; บรรทัดเสริม (วงเงินเหลือ ฯลฯ) 10px opacity .7
- **badge เตือน** (บัตรครบกำหนด): พื้น `--expense`, ข้อความขาว, radius 6, 10px

### 3.6 Buttons
| ชนิด | สเปก | ใช้ |
|---|---|---|
| primary (ดำ) | `--dark-card` พื้น, ขาว, full-width, radius 14, 13px padding | บันทึก/ยืนยันใน sheet |
| primary (ฟ้า) | `.btn-primary` `--primary` + เงา | action หลักทั่วไป |
| secondary | `.btn-secondary` พื้น `--elevated`, border | action รอง |
| danger / outline | `--expense` | ลบ/ออก |
| icon chip | 30px, radius 9, พื้น semantic-soft, ไอคอนสี semantic | แถว settings |

### 3.7 อื่นๆ
- **Toggle:** `.toggle` เดิม — on = `--primary`, หัวขาว 18px
- **Progress bar:** track `--elevated`/`--border` h5–7 radius 3–4; fill semantic (`--primary` รอบบิล, `--income` เพดานรีวอร์ด, `--expense` เกินงบ)
- **Form input:** พื้น `--surface-soft`, border `--border`, radius (ดู `.form-input`), focus ring `color-mix(--primary 26%)`
- **Section label:** 10px/500 `--muted`, letter-spacing .5, margin `8px 0 6px`
- **FAB:** วงกลม `--fab-size`, `--primary`, ไอคอน + ขาว, ลอยกลาง nav (`margin-top:-26px`), เงา `--shadow-float`
- **Badge ชนิดรีวอร์ด:** เงินคืน=`--income-soft`/`--income` · แต้ม=`--purple-soft`/`--purple` · ส่วนลด=`--primary-soft`/`--primary`

### 3.8 User-defined colors (สีที่ผู้ใช้ตั้งเอง) — กฎคุม (ตัดสินใจแล้ว)
ผู้ใช้กำหนดสีหมวดหมู่ได้เอง (hex อิสระ, default `#2563EB`). เพื่อไม่ให้ชนกับ controlled palette:
- ✅ ใช้สีผู้ใช้ได้แค่ **dot/จุดเล็ก** (เช่น `.color-dot` 8–12px, เส้นบางใน progress, จุดนำหน้า legend)
- ❌ **ห้ามเป็นพื้นใหญ่** — ห้ามใช้เป็น background ของการ์ด/แถว/ชิป/header หรือ box-shadow สีจัด
- พื้นของ `tx-icon`/การ์ดให้ใช้ semantic-soft จาก palette เสมอ ส่วนสีผู้ใช้ไปอยู่ที่ dot เท่านั้น
- กราฟ: ใช้ palette กลาง เป็นหลัก; ถ้าจำเป็นต้องแยกหมวดด้วยสีผู้ใช้ ให้เป็นจุด/เส้นบาง ไม่ใช่แท่งเต็มสีจัด
- **ที่ต้องแก้:** จุด render ที่ใช้ `style="background:${color}"` / box-shadow สีผู้ใช้ (app_v2.js ~1669, 1691, 2694) → เปลี่ยนเป็น dot

---

## 4. Per-Screen Anatomy

> ลำดับองค์ประกอบบนลงล่างของแต่ละหน้า + touchpoint โค้ด. ใช้ component library §3 เท่านั้น

### 4.1 Dashboard (Home)
1. Header `--primary`: greeting+avatar+bell → balance รวม → bento รายรับ/รายจ่าย → (option: segmented Week/Month/Year)
2. Sheet: bento AI insight + เป้าออม → `.ai-bar` "ถามเรื่องเงิน" → quick-action 4 ไอคอนวงกลม → section "รายการล่าสุด"+ดูทั้งหมด → `.list-card` group วัน
- **Touchpoint:** `App.renderDashboard` · upcoming/budget cards (~4504)

### 4.2 Transactions
1. Header เรียบ(ขาว): title + search → bento รายรับ/รายจ่าย → `.seg-pill` ทั้งหมด/รายรับ/รายจ่าย
2. group `วันนี้/เมื่อวาน` (section label) → `.list-card` ต่อกลุ่ม
- **Touchpoint:** `App.renderTransactions`

### 4.3 Add-tx Sheet
1. แถว ✕ / "เพิ่มรายการ" / บันทึก
2. type-tabs สี active ตามชนิด (จ่าย=`--expense` / รับ=`--income` / โอน=`--primary`)
3. **จำนวนเงินตัวใหญ่** (38px) สีตามชนิด = พระเอก
4. หมวดหมู่ scroll chips → บัญชี+วันที่ → flag ผ่อน/ประจำ (pill)
5. ปุ่มบันทึกดำ full-width
- **Touchpoint:** `_renderAddTxDetail` (3264) · `.type-tab` (1311) · `.amount-summary-card` (1379). ⚠️ อย่าแตะ logic เครื่องคิดเลข/reward preview

### 4.4 Wallets
1. Header `--primary`: "กระเป๋าเงิน" → "เงินที่ใช้จ่ายได้" → bento สินทรัพย์/หนี้สิน
2. `.seg-pill` tab (ทั้งหมด/บัญชี/บัตร/ลงทุน) → section label ต่อกลุ่ม → `.wallet-card` (gradient)
- **Touchpoint:** `renderWallets` (~13708). ⚠️ tab bar มี once-injection guard — `.wallet-tab-bar?.remove()` ก่อน guard ถ้าแก้

### 4.5 CC Detail (sub screen)
1. Header ← / ชื่อบัตร / ⚙️
2. การ์ดบัตร `--dark-card` gradient navy: "ยอดค้างชำระ" เด่น + เลขท้าย + ครบกำหนด
3. bento 3: วงเงิน / ใช้ไป% / แต้มสะสม
4. การ์ด "รอบบิลปัจจุบัน" + progress (`--primary`) + ช่วงวันที่ตัดรอบ
5. section "รายการในรอบนี้" → `.list-card` (sub แสดง +แต้ม/เงินคืน)
- **Touchpoint:** `App.openCCDetail` (patched, 145) · `getCardStatement` (`credit_card_cycles.js`) · `.reward-tile`

### 4.6 CC Benefits / สิทธิประโยชน์ (sub screen)
1. Header ← / "สิทธิประโยชน์" / + เพิ่ม
2. การ์ดสรุป `--purple`: เงินคืนสะสม + แต้ม + มูลค่าโดยประมาณ
3. section "กฎสิทธิประโยชน์" → การ์ดต่อกฎ: ชื่อ+badge ชนิด + เงื่อนไข + (option) progress เพดาน/เดือน
- **Touchpoint:** reward rules render (3432) · `.reward-rule-results` · empty state เดิม "บัตรนี้ยังไม่มีสิทธิประโยชน์"

### 4.7 Reports
1. Header เรียบ: "รายงาน" + เดือน
2. `.seg-pill` 7 มุมมอง (สินทรัพย์/รายจ่าย/รายรับ/กระแสเงินสด/เครดิต/งบประมาณ/ความมั่งคั่ง)
3. `.ai-bar` AI Coach (insight อันดับ 1) → การ์ดกราฟพื้นขาว radius 16 → `.list-card` หมวด (มี icon)
- **Touchpoint:** `App.renderReports` (6422) · `setRptView` · view list (6438) · insight (3470)

### 4.8 More
1. Header `--primary`: avatar + ชื่อ + สถานะ sync
2. group การ์ด "การจัดการ" (เป้าหมาย/รายการประจำ/งบ/หมวดหมู่) → "ทั่วไป" (โหมดมืด toggle / สำรองข้อมูล) — แต่ละแถว icon chip สี + chevron
- **Touchpoint:** `App.renderMore` (1339)

### 4.9 Wallet Detail (sub screen)
1. Header ← / ชื่อกระเป๋า / ⋯
2. การ์ดยอด gradient ตามสีกระเป๋า: ยอด + bento รับเข้า/จ่ายออก
3. `.seg-pill` ช่วงเวลา (ทั้งหมด/เดือนนี้/3 เดือน) → `.list-card` รายการ
- **Touchpoint:** `openWalletDetail` · range chips (2367)

---

## 5. Iconography & Content

**ระบบไอคอน 2 ชั้น (ตัดสินใจแล้ว):**
- **Icon font** = ไอคอนระบบ/UI ทั้งหมด — nav, settings rows, action (search, bell, settings, chevron, ←, ✕, plus, mic ฯลฯ)
  - ใช้ **icon font ที่ self-host** (เช่น Tabler Icons webfont `.woff2`) วางใน `assets/` — **ห้ามโหลดจาก CDN** เพราะ CSP `font-src 'self'` + ต้องทำงาน offline (PWA)
  - **subset เฉพาะ glyph ที่ใช้จริง** เพื่อคุมขนาดไฟล์ · เพิ่มไฟล์ฟอนต์เข้า cache ใน `service-worker_v2.js` + bump `APP_VERSION`
  - ขนาด: nav 21px · inline 16–20px · decorative ≤24px; สีสืบทอดจาก parent (`currentColor`)
- **Emoji** = ข้อมูลของผู้ใช้/เนื้อหา — หมวดหมู่, merchant, ชนิดกระเป๋า, ชนิดรายการ (มี merchant emoji แล้ว commit `17788a1`) **คงไว้เป็น emoji** ไม่แปลงเป็น icon font
- ใส่ emoji/icon ใน `tx-icon` เสมอ — ห้ามแถวเปล่า
- **ตัวเลขเงิน:** ใช้ formatter เดิม (`fmt`/`money`) — สีตามทิศ (เขียวบวก/แดงลบ/ฟ้าโอน), เครื่องหมาย + / -, ทศนิยมเล็กลง
- **ภาษา:** ไทยทั้งหมด, sentence case

---

## 6. Motion (เบาๆ พอ)
- transition ทั่วไป `.15s` (มีใน CSS เดิม) — สี/พื้น/ขนาดปุ่ม
- กดปุ่ม: `active` scale ~0.98
- เปลี่ยน tab/chip: เปลี่ยนสีพื้นทันที ไม่ต้องมี slide
- Sheet: เลื่อนขึ้นจากล่าง (ใช้กลไก overlay เดิม)
- ❌ ห้าม animation ตกแต่งหนักๆ ที่กระทบ perf บนมือถือ

---

## 7. Do / Don't สรุป

| ✅ Do | ❌ Don't |
|---|---|
| ใช้ token จาก `:root` | hardcode hex ในโค้ด UI |
| header สีแบรนด์ + ตัวเลขเด่น (route pages) | ใส่ header สีในทุก sub screen |
| bento เล็ก อ่านจบไว | กราฟใหญ่รก ๆ เป็นพระเอก |
| AI bar สีดำ ปักหมุด | ซ่อน AI ลึกในเมนู |
| semantic color ตามความหมาย | สุ่มสีตามลำดับ (rainbow) |
| เทสต์ light + dark | เช็คแค่โหมดเดียว |
| ทีละหน้า ทีละ PR | รื้อสีทั้งระบบรวดเดียว |
| flat + soft shadow | glassmorphism / gradient หนัก / neon |

---

## 8. Implementation Checklist (ทุก PR ที่แตะ UI)

- [ ] ใช้เฉพาะ component §3 และ token §1 — ไม่มีค่าใหม่
- [ ] ผ่าน light + dark mode
- [ ] touch target ≥ 44px, input = 16px
- [ ] **bump `?v=`** ของไฟล์ JS ที่แก้ ใน `index.html`
- [ ] ถ้าแก้ `index.html` → **bump `APP_VERSION`** ใน `service-worker_v2.js`
- [ ] ถ้าแตะ wallet tab bar → `.wallet-tab-bar?.remove()` ก่อน guard
- [ ] เทสต์บนความกว้าง ≤430px
- [ ] ไม่หลุด scope (แก้เฉพาะหน้าที่ระบุใน PR)

---

## 9. ลำดับลงมือ (Roadmap)

| เฟส | งาน | หมายเหตุ |
|---|---|---|
| **0** | สร้าง class กลาง §3 (`.bento-card`, `.list-card`, `.ai-bar`, `.seg-pill`, `.screen-header--brand`) | ทำครั้งเดียว ใช้ซ้ำทุกหน้า |
| **1 (Tier 1)** | More → Wallets → Transactions → Reports → Home | markup/CSS ล้วน เสี่ยงต่ำ |
| **2 (Tier 2)** | Add-tx amount, CC detail, CC benefits | แตะ logic นิดหน่อย ต้องเทสต์ |
| **3 (Tier 3)** | net-worth chart, savings goal cards | ฟีเจอร์เสริม |
