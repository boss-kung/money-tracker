# แผน cleanup และลดงานซ้ำของ Money Tracker

วันที่: 2 ตุลาคม 2026 · สถานะ: ดำเนินการ cleanup ที่ยืนยันได้แล้วเมื่อ 3 ตุลาคม 2026 — ดู [ผลการแก้ไข](CODE_CLEANUP_RESULTS.md)

## เป้าหมายและขอบเขต

ผู้ใช้พบความช้าในทุกช่วง โดยเฉพาะเปิดแอป แตะดูข้อมูล เปิดฟอร์ม และบันทึกข้อมูล เป้าหมายคือให้โหลดและตอบสนองเร็วขึ้น พร้อมลดโค้ดซ้อนทับที่ทำให้การแก้ไขครั้งต่อไปยาก

สมมติฐานของแผน: คงหน้าตาและพฤติกรรมเดิม คงข้อมูลการเงิน ยอด Wallet, Posted/Scheduled Transaction, Ledger Amount, รอบบิล และความสามารถ offline ทั้งหมด ไม่เปลี่ยน framework หรือรูปแบบข้อมูลเป็นงานแรก

หลักฐานรอบนี้มาจาก source ปัจจุบันและชุดทดสอบ ไม่ได้ทำ browser profiling หรือวัดเครื่องที่ผู้ใช้พบอาการ จึงยังระบุไม่ได้ว่าแต่ละจุดกินเวลากี่มิลลิวินาทีหรือแก้แล้วเร็วขึ้นกี่เปอร์เซ็นต์

## สิ่งที่ตรวจพบจริง

| จุด | หลักฐานปัจจุบัน | ความหมายต่อแผน |
| --- | --- | --- |
| โหลด JavaScript | `index.html` อ้าง local script 28 ไฟล์ รวม 2,099,432 bytes ก่อนบีบอัด | ต้องวัดทั้ง download, parse/evaluate และ initialization; ตัวเลขนี้ไม่ใช่ network transfer จริง |
| ไฟล์หลัก | `app_v2.js` 24,935 บรรทัด / 1,460,231 bytes | มี implementation และส่วนต่อเติมสะสมในไฟล์เดียว |
| CSS ที่โหลด | `style_v2.css` + `ui_v2.css` รวม 345,592 bytes | ต้องตรวจ cascade ทั้งสองไฟล์และ inline styles ร่วมกัน |
| บันทึก Transaction | `App.saveTx` ถูกกำหนดเป็น function 7 จุด: 6049, 17556, 22088, 22841, 23241, 23444, 24217 | หลายจุดเก็บฟังก์ชันก่อนหน้าไว้และเรียกต่อ เป็นพฤติกรรมที่ยังทำงานอยู่ |
| render รายการ | `App.renderTransactionsList` 5 จุด: 7556, 17727, 22003, 22604, 23418 | เรียก render เดิม ตามด้วย empty state / animation / summary หลายชุด |
| Ledger ซ้ำ | `recalculateWalletBalances` ที่ 5715 เรียก `ensureLedgerBaselines` ที่ 5685 ซึ่งคำนวณ flows แล้วคำนวณ flows อีกครั้งที่ 5720 | มีสอง `MTLedger.compute` ต่อการคำนวณยอดหนึ่งครั้ง |
| บันทึก Loan ซ้ำ | `LoanStore._commit` ที่ `loans_v2.js:73` คำนวณยอด แล้ว `persist()` เรียก `_beforePersistV40` ที่ `app_v2.js:5626` คำนวณยอดอีกครั้ง | เส้นทางนี้มีอย่างน้อยสี่ compute scans ก่อนนับงาน render เพิ่มเติม |
| การเขียน localStorage | `storage_v2.js:299` serialize ทุก collection, เขียนพร้อม readback, verify และ rollback เมื่อผิดพลาด | อาจเป็นงานหนักเมื่อข้อมูลมาก แต่การตรวจความถูกต้องและ rollback มีหน้าที่สำคัญ |
| DOM observers | `app_v2.js` มี `new MutationObserver` 12 จุด | เป็นจำนวนจุดสร้างใน source ไม่ใช่จำนวน observer ที่กำลังทำงาน; ต้องวัด callback และขอบเขตจริง |
| การจัดรูปแบบ input | `app_v2.js:1180` สังเกต DOM ทั้ง subtree และ `App.render` ที่ 1402 ยังเรียก `formatNumberInputsIn(document)` | มีโอกาสสแกน DOM ซ้ำจาก render เดียวกัน |
| ระบบที่มีอยู่แล้ว | `ledger.js`, `state_commit.js`, `screen_hooks.js`, `safe_render.js` | ใช้ module เหล่านี้ต่อ ไม่สร้างระบบคู่ขนาน |

ชุดทดสอบก่อนเริ่ม: `node --test tests/*.test.js` ผ่าน **238/238** ข้อ ไม่มี fail/skip ในการตรวจครั้งนี้ ทั้ง behavioral tests และ source checks ไม่ครอบคลุม browser rendering, ความลื่นบนมือถือ หรือ backend ทั้งหมด

เอกสารเก่าบางส่วนล้าสมัย: ปัจจุบัน Loan ไม่ได้ patch `_ledgerFlows` แล้ว; Ledger รับ Loan ผ่าน `MTLedger.compute` และ onboarding/notifications/split-bill/loan ใช้ screen hooks แล้ว ห้ามใช้รายการ dead code ในเอกสารเก่าเป็นคำสั่งลบทันที

## แยกโค้ดก่อนตัดสินใจลบ

1. **ไม่ถูกเรียกจริง**: ตรวจทั้ง direct call, inline `onclick`, การเรียกผ่านชื่อ method, retained references, demo, service worker และ fallback จึงลบได้
2. **ถูกแทนที่ แต่ยังถูกเรียกต่อ**: มี `const prev = App.method.bind(App)` แล้วเรียก `prev()` จาก implementation ใหม่ ต้องย้ายพฤติกรรมเข้าที่เดียวก่อนลบ
3. **ทำงานซ้ำจริง**: ตัวอย่าง Ledger คำนวณซ้ำ หรือ DOM ถูก query/animate หลายรอบ ให้ลดจำนวนงานโดยคงผลลัพธ์
4. **CSS override ตามเงื่อนไข**: responsive, dark mode, feature flag, pseudo state และ animation อาจต้องมีหลาย rule; selector เหมือนกันไม่ได้แปลว่าลบได้เสมอ

## ลำดับงานที่แนะนำ

### ช่วง 0 — วัดอาการและทำแผนที่โค้ดที่ทำงานจริง

ทำก่อนปรับ runtime เพื่อเลือกคอขวดตามหลักฐาน

- ใช้ `MTBoot` ที่มีอยู่ใน `index.html:80` และ `app_v2.js:1958` เป็นฐาน แยกเวลา storage hydration, first render, auth/app lock, finance feature rebuild และตลาด/notification sync
- วัด cold start, warm start, offline start และการกลับจาก background แยกกัน แยกเวลา user interaction กับการปลดล็อก/เข้าสู่ระบบออกจากเวลาประมวลผล
- ใช้ข้อมูลสังเคราะห์ขนาด 100 / 1,000 / 10,000 Transaction พร้อม Wallet หลายแบบ, บัตรเครดิต, Loan และ BNPL; ไม่แก้ข้อมูลจริงเพื่อสร้าง benchmark
- วัดตั้งแต่แตะปุ่มจนแสดงผล / บันทึก local สำเร็จ พร้อมจำนวน render, Ledger compute, storage writes, DOM observer callbacks และงานที่ขวาง main thread
- วัดซ้ำบนเครื่องและ browser เดิม บันทึก median/p95; desktop ใช้หาสาเหตุ และยืนยันบนมือถือ/PWA ที่พบอาการ
- ทำตาราง owner/definition/captured-reference ของ `saveTx`, `renderTransactionsList`, `renderReports`, `openOverlay`, `showPage` รวมทั้งลำดับ production กับ demo
- นับ initial renders หลัง feature พร้อมจริงด้วย: `app.firstRender.done` อยู่ก่อน hook installation ท้ายไฟล์ และยังมี file-level rerenders จึงไม่ใช่ตัวชี้วัด feature-complete UI เพียงตัวเดียว

**ผลส่งมอบ:** baseline timings, traces และรายการโค้ดลบได้ / ต้องรวม / ยังไม่ชัดเจน มีเหตุผลกำกับแต่ละรายการ

### ช่วง 1 — ลบสิ่งที่ยืนยันได้โดยความเสี่ยงต่ำ

- เริ่มจาก `_renderAddTxAmount` ที่ `app_v2.js:19044` ซึ่งเรียก implementation ก่อนหน้าอย่างเดียว และตัวแปร `DEFAULT_QUICK_AMOUNTS` ที่ 19041 ซึ่งไม่มี reference อื่น
- ตรวจบล็อก motion ที่ `app_v2.js:121` ซึ่ง guard ด้วย `window.App`/`window.S` ก่อน App พร้อม และมีสำเนาท้ายไฟล์ที่ 23504 ใช้ lexical `App`/`S` ถูกต้อง; บน fresh load ที่ตรวจ บล็อกแรก return ก่อนทำงาน จัดเป็น dead candidate หลัง characterization ของ production/demo ไม่ลบสำเนาที่ทำงานจริง
- ตรวจบล็อกว่างและ binding ที่ไม่ถูกใช้ เช่น `_renderWallets` ที่ `app_v2.js:5156` และ `baseRender` ที่ 5752 ก่อนลบเป็นชุดเล็ก
- ตรวจ `exportCSVLegacy` ที่ 4273 และ branch เก่า: ต้องยืนยัน dynamic/inline caller และพฤติกรรม export เดิมก่อนจัดเป็น dead code
- `style_v2.css.bak`, preview และภาพตรวจงานเป็นไฟล์ที่ไม่อยู่ใน startup list; ลบหรือย้ายเมื่อยืนยันว่าไม่ใช่ artifact ที่ผู้ใช้ต้องเก็บ การลบเหล่านี้ช่วยลดความรกของ repo/deploy แต่ไม่ได้ลดงาน startup โดยตรง
- อย่าลบ migration, recovery fallback, backend endpoint หรือ schema ด้วยเหตุผลว่า frontend ไม่เรียกเพียงอย่างเดียว

**ผ่านเมื่อ:** สิ่งที่ลบทุกจุดมีหลักฐานไม่ต้องใช้, export/import/demo/production ยังทำงาน, tests ที่เกี่ยวข้องผ่าน และไม่เสียพฤติกรรมเดิม

### ช่วง 2 — ลดงานซ้ำของปุ่มและการ render

เริ่มทีละ flow และทีละหน้าตามข้อกำหนด UI ของ repo

- รวมการตัดสินว่าบันทึกสำเร็จและการแจ้งผลของ Transaction ให้อยู่ใน module เจ้าของ flow เดียว ปัจจุบัน animation หลายชุดดัก `window.toast` เพื่อเดาว่า save สำเร็จ (`22088`, `23241`, `23444`)
- ใช้ seam ของ `MTStateCommit` และ `MTScreenHooks` ที่มีอยู่เพื่อจัดลำดับพฤติกรรม แยกผลบันทึก local กับสถานะ cloud sync ให้ชัดใน implementation
- จัด owner ของ bootstrap ให้เตรียม feature/hydration/migration แล้ว render ครั้งแรกเมื่อพร้อม ลด file-level rerenders ที่ทำซ้ำบนหน้าปัจจุบัน โดยรักษา app lock/auth/deep link และ first paint; วัดก่อนเลือกว่าจะย้ายขั้นตอนไหนออกจาก startup
- รวม animation ที่ทำงานกับเป้าหมายเดียวกัน ให้ทำครั้งเดียวต่อการเปลี่ยนข้อมูล; ลด forced layout จาก `offsetWidth` และ DOM queries ที่ซ้ำตามผล profiling
- ลดขอบเขต input formatting/observer ให้ตรง DOM ที่เปลี่ยน กำหนดอายุ observer และยกเลิก timer/frame ของหน้าที่ปิดแล้ว
- ปรับ Transaction list ที่ 7556 ให้ลดการสร้าง DOM ทั้งเดือนซ้ำ: เริ่มจากแบ่งงาน render/อัปเดตเฉพาะส่วน ถ้ารายการจำนวนมากยังเป็นคอขวดจึงพิจารณา windowing หรือ pagination โดยต้องคงยอดรวม การค้นหา filter, scroll position และ row actions
- รวม report dispatch ที่ 6733 / 19057 / 23791 โดยคง view ทั้งหมดรวม trend/calendar; implementation เก่าเหล่านี้ยังถูกเรียกต่อ จึงต้องย้ายก่อนลบ

**ผ่านเมื่อ:** กดบันทึกหนึ่งครั้งเกิด Transaction และ feedback ตามจำนวนที่ตั้งใจ ไม่มี animation ซ้ำที่เป้าหมายเดิม; กดซ้ำ/validation fail/storage fail ไม่สร้างข้อมูลซ้ำ; รายการและ back navigation ยังถูกต้อง

### ช่วง 3 — ลดการคำนวณและการเขียนซ้ำ

- ให้ Ledger flows ของการคำนวณยอดรอบเดียวถูกใช้ร่วมกันในขั้น Wallet Baseline และ reconcile; ต้องรักษา initialization ของ baseline เมื่อยังไม่เคยมี
- ยุบการคำนวณก่อนและระหว่าง commit ของ Loan ให้เหลือเจ้าของงานเดียว ยอด/หน่วยลงทุน/snapshot ต้องให้ผลเหมือนเดิม
- วัด `CreditCardCycles.prepareBillingMigration` ใน `persist()` ที่ 1094 ว่ายังมีงานราคาแพงต่อ save หลัง migration แล้วหรือไม่; ไม่ตัดการเตรียม schema ที่ยังจำเป็น
- พิจารณาเขียนเฉพาะ collection ที่เปลี่ยนหลังลด compute ซ้ำแล้ว โดยคง readback/verification/rollback ของ coherent snapshot, quota failure และหลัง import/restore
- ถ้าจะ cache ผล Ledger ต้องกำหนด invalidation ครอบคลุม Transaction, Wallet Baseline, Loan, rewards, วันใหม่, import, restore และ cross-tab; ห้าม cache ด้วยจำนวนรายการเพียงอย่างเดียว
- เก็บ notification snapshots และ finance rebuild ให้เกิดหลัง local commit สำเร็จ และไม่ขวาง feedback ผู้ใช้ถ้าพฤติกรรมอนุญาต

**ผ่านเมื่อ:** ผล Ledger และ credit billing เท่าเดิม, Scheduled Transaction ไม่เปลี่ยนยอดก่อนกำหนด, เปลี่ยนวันแล้วผลถูกต้อง, failed save ไม่รายงานสำเร็จ, restore/backup/cross-tab/sync ไม่ใช้ข้อมูลเก่า

### ช่วง 4 — เก็บ CSS และจัด module เพื่อลดโอกาสซ้อนทับอีก

- ตรวจ stylesheet ทั้งสองร่วมกับ inline/injected styles โดยยึด `docs/UI_DESIGN_SPEC.md` และ `docs/UI_REDESIGN_PLAN.md`
- รวม rule ที่ชนะจริงและลบ declaration เก่าทีละหน้า เปรียบเทียบ light/dark, mobile/desktop, `uiv2=0/1`, keyboard, sheet, disabled/error และ reduced motion
- เครื่องมือ `find_dead_css.py` / `remove_dead_css.py` เป็น heuristic ที่ไม่พอพิสูจน์ cascade ทุก context: ห้ามรันตัวลบอัตโนมัติเป็นหลักฐานว่าไม่กระทบหน้าตา
- แยก module ตามหน้าที่หลังลดซ้ำ โดยคง interface ที่ caller ใช้อยู่เพื่อจำกัดผลกระทบ เริ่ม Transaction flow / screen rendering / motion; เพียงแบ่งไฟล์แต่โหลดทุกไฟล์เหมือนเดิมไม่ได้รับประกันว่าเปิดเร็วขึ้น
- กำหนด owner เดียวต่อ flow และ screen; feature เพิ่มผ่าน named adapter ที่ seam ที่มีอยู่ ไม่กำหนด method ใหม่ทับไปเรื่อย ๆ
- อัปเดตเอกสารที่บอก architecture เก่า เพิ่ม CI รัน tests ก่อน deploy และ guard ที่ตรวจพฤติกรรมสำคัญจริง

**ผ่านเมื่อ:** ภาพเทียบทุกโหมดผ่าน, ฟีเจอร์เดิมอยู่ครบ, ไม่มี definition/animation ซ้ำที่ยืนยันแล้วใน scope ที่จัดการ และ tests ไม่ยึดตำแหน่งโค้ดเก่าจนขวาง refactor

### ช่วง 5 — ลดสิ่งที่โหลดตอนเปิด ตามผล baseline

ทำเมื่อ load order ชัดและ startup traces ชี้ว่าเป็นคอขวด

- คง Ledger, storage, shared formatting และ dependency ที่หน้าแรกต้องใช้ใน core
- สำรวจ screen/feature ที่ยังไม่เปิด เช่น report analytics, voice capture หรือรายละเอียดลงทุน ก่อนเลือกโหลดเมื่อใช้; การปรากฏในไฟล์ไม่ใช่หลักฐานว่าเลื่อนโหลดได้ เพราะ dashboard/notifications อาจใช้ข้อมูลเดียวกัน
- ใช้ `release_manifest.js` เป็น release contract ต่อไป ปรับ HTML production/demo และ service worker ให้สอดคล้อง ตรวจ offline first-use และ deployment update จากเวอร์ชันเก่า
- ตรวจ network-first timeout 900 ms ของ core code ใน `service-worker_v2.js:6` บนเครือข่ายช้า; อย่าสรุปว่าแต่ละ request บวกกันเป็นเวลา startup หรือเปลี่ยน cache policy ก่อนทดสอบความเข้ากันได้ของ release
- พิจารณาบีบอัด/minify เมื่อมี pipeline ที่ดูแลได้และผลวัดรองรับ แยกจากการ refactor ไม่จำเป็นต้องเริ่มด้วยการเพิ่ม framework/bundler

**ผ่านเมื่อ:** cold/warm/offline startup ดีขึ้นตาม trace, ทุก feature ที่ย้ายยังเปิดได้ offline ตาม contract และเปิดจาก notification/deep link ได้ถูกต้อง

## เกณฑ์ยอมรับและวิธีแบ่งงาน

- เริ่มด้วย baseline จากช่วง 0 แล้วตั้งเป้าระยะสั้นให้ชัด เช่นลด median และ p95 ของ flow ที่มีอาการอย่างน้อย 30% บน fixture/อุปกรณ์เดิม ตัวเลขนี้เป็นเป้าที่เสนอ ไม่ใช่ผลที่วัดแล้วหรือคำรับประกัน
- งานซ้ำที่ยืนยันและแก้ต้องมีตัวนับหรือ behavior test รองรับ เช่นหนึ่ง flow คำนวณ Ledger เท่าที่จำเป็น, หนึ่ง save ได้ Transaction เดียว, observers ไม่สะสมหลังเปิดปิดซ้ำ
- ตรวจชุด Node tests เดิมและเพิ่ม behavioral tests เฉพาะ behavior/optimization ที่เปลี่ยน อย่าเพิ่ม regex tests ที่ผูกกับรูปทรง implementation เก่า
- ตรวจ browser/PWA จริง: เปิดแอป, สลับหน้า, เปิด/ปิดฟอร์ม, บันทึก/แก้ไข/ลบ, filter/search, บัตรเครดิต/BNPL/Loan, lock/auth, import/restore และ offline
- ชุด backend/notification Deno tests และ deployment validation ต้องรันเมื่อแก้ integration ที่เกี่ยวข้อง; Node 238 tests ไม่ใช่หลักฐานว่า backend ผ่าน
- แบ่งเป็นชุดเปลี่ยนเล็กที่ย้อนกลับได้ เช่น baseline → dead/no-op → Transaction save → Transaction list → Ledger/commit → CSS ทีละหน้า → deferred loading แยกตาม feature หลีกเลี่ยง rewrite ทั้ง `app_v2.js` ครั้งเดียว
- ทุกชุดเก็บก่อน/หลัง: ขนาด asset, จำนวน compute/render/write, timings, test results, ภาพเทียบเมื่อแตะ UI และ release version เมื่อเปลี่ยน production assets

## แนวทางที่เลือก

**แนะนำ: วัดอาการ + ลบที่ยืนยัน + ยุบงานซ้ำเป็นช่วงเล็ก** ได้ทั้งความสะอาดและโอกาสแก้อาการที่ผู้ใช้เจอ โดยตรวจผลต่อข้อมูลทุกช่วง

ทางเลือกอื่น: ลบไฟล์เก่าอย่างเดียวทำได้เร็วแต่ไม่แตะงาน runtime ส่วน rewrite/module migration ทั้งชุดเพิ่มความเสี่ยงและยังพิสูจน์ไม่ได้ว่าจะเร็วขึ้น จึงไม่ใช่งานเริ่มต้น

เริ่มช่วง 0 และช่วง 1 ที่ยืนยันได้ จากนั้นจัดลำดับช่วง 2/3 ตาม traces; ถ้า startup network เป็นคอขวดหลัก สามารถขยับงานช่วง 5 ที่พิสูจน์ dependency/offline แล้วมาทำก่อน CSS cleanup ได้
