# Software Design Document — Financial Tracker (Money Tracker)

เอกสารออกแบบระบบฉบับสมบูรณ์ เขียนจากการอ่านซอร์สโค้ดจริงทั้งรีโพสิทอรี
ทุกข้อความอ้างอิงไฟล์และบรรทัดจริง สิ่งใดที่ไม่ปรากฏในโค้ดจะเขียนกำกับว่า "ไม่พบในโค้ด"

## สารบัญ

### [ตอนที่ 1 — ภาพรวม ฟีเจอร์ และหน้าจอ](01-overview-features-screens.md)
- SECTION 1 — Project Overview (ระบบคืออะไร, วัตถุประสงค์, กลุ่มผู้ใช้, ปัญหาที่แก้, สถาปัตยกรรม, technology stack, โครงสร้างโฟลเดอร์, boot sequence)
- SECTION 2 — Feature Inventory (38 ฟีเจอร์ พร้อม entry point, route, database, logic, validation, error handling, empty/success/error state, edge case, limitation และความสัมพันธ์)
- SECTION 3 — Screen Documentation (5 หน้าหลัก, 6 overlay ที่ประกาศล่วงหน้า, overlay ที่ inject ตอน runtime, sub-screen 50+ หน้า, หน้า static)

### [ตอนที่ 2 — User Flow, UX, UI](02-userflow-ux-ui.md)
- SECTION 4 — User Flow (17 flow แบบทีละขั้น รวมเส้นทาง success / error / cancel / retry / timeout / permission denied)
- SECTION 5 — UX Analysis (user goal, journey, จำนวนคลิก, cognitive load, จุดที่สับสน, จุดที่ควรปรับ, จุดที่ดีอยู่แล้ว)
- SECTION 6 — UI Analysis (layout, component hierarchy, visual grouping, information hierarchy, consistency, responsive, accessibility, spacing, typography, color, feedback, animation, interaction)

### [ตอนที่ 3 — Business Logic, Database, API, Permission, State](03-logic-database-api-permission-state.md)
- SECTION 7 — Business Logic (ledger engine, posted vs scheduled, ledgerAmount, saveTx, สถิติรายเดือน, สินทรัพย์/หนี้สิน, เงินพร้อมใช้, คะแนนสุขภาพการเงิน, รอบบิลบัตร, สิทธิประโยชน์, หารบิล, BNPL, เงินให้ยืม, recurring, ราคาสินทรัพย์, การเข้ารหัส vault, storage เต็ม, วันที่, XSS)
- SECTION 8 — Database Analysis (localStorage 37 คีย์, schema ของทุก entity, ความสัมพันธ์, constraints, ตาราง PostgreSQL 7 ตาราง, index, trigger, RLS, cron, cache, data flow)
- SECTION 9 — API Documentation (Supabase Auth, REST, Edge Functions 7 ตัว, Web Push, FCM, API ภายนอก — พร้อม parameter, validation, response, error, authentication)
- SECTION 10 — Permission Matrix (ระดับหน้าจอ, ระดับข้อมูลในคลาวด์, ระดับเบราว์เซอร์, CORS)
- SECTION 11 — State Management (global state, local state, การ persist, reactivity, cache, mutation pattern, optimistic update, state ที่ซ่อนอยู่นอก S)

### [ตอนที่ 4 — Components, Code Structure, Sequence, Issues, Improvements](04-components-structure-sequence-issues.md)
- SECTION 12 — Reusable Components (HTML builder, CSS component, behavior helper และจุดที่ใช้ซ้ำได้ไม่ดี)
- SECTION 13 — Code Structure (layer, architecture pattern, separation of concerns, dependency direction, reusability, naming, error handling, testing structure, versioning)
- SECTION 14 — Sequence Diagram แบบข้อความ (7 เส้นทางหลัก ตั้งแต่ผู้ใช้จนถึงฐานข้อมูลและกลับ)
- SECTION 15 — Known Issues (TODO, schema mismatch, RLS ที่ขาด, dead code, duplicate code, render ที่ถูกนิยามซ้ำ, เวอร์ชันไม่ตรง, performance, memory, security, accessibility, กระบวนการ, ตรรกะ, เอกสารที่ไม่ตรงกับโค้ด)
- SECTION 16 — Improvement Suggestions (High / Medium / Low priority พร้อมเหตุผลและแนวทาง)

### [ตอนที่ 5 — Missing Docs, Feature Table, Dependency Map, Functional Spec](05-missing-docs-summary-dependency-funcspec.md)
- SECTION 17 — Missing Documentation (แยกตามระดับความจำเป็น)
- SECTION 18 — Feature Summary Table (38 ฟีเจอร์ในตารางเดียว)
- SECTION 19 — Dependency Map (ไฟล์, global object, หน้าจอ, บริการภายนอก, utility)
- SECTION 20 — Complete Functional Specification (ขอบเขต, FR 12 กลุ่ม, NFR 6 กลุ่ม, business rules 16 ข้อ, acceptance criteria 12 ชุด, ภาคผนวกตัวเลขสำคัญ)

## วิธีใช้เอกสารนี้

- Developer ที่เพิ่งเข้าโปรเจกต์ — อ่านตอนที่ 1 (SECTION 1) แล้วข้ามไปตอนที่ 4 (SECTION 13) เพื่อเข้าใจโครงสร้างโค้ดก่อนแตะอะไร
- Developer ที่จะแก้ฟีเจอร์ใดฟีเจอร์หนึ่ง — หาฟีเจอร์นั้นใน SECTION 2 แล้วตามไปที่ SECTION 7 (ตรรกะ) และ SECTION 14 (ลำดับการเรียก)
- QA — ใช้ SECTION 4 (User Flow) เป็นสคริปต์ทดสอบ และ SECTION 20 FS-5 (Acceptance Criteria) เป็นเกณฑ์ผ่าน
- UX/UI Designer — อ่าน SECTION 3, 5, 6 คู่กับ `docs/UI_DESIGN_SPEC.md`
- Product Owner — อ่าน SECTION 1, SECTION 18 (ตารางฟีเจอร์), SECTION 16 (ข้อเสนอปรับปรุงเรียงตามลำดับความสำคัญ)
- Business Analyst — อ่าน SECTION 20 ทั้งหมด โดยเฉพาะ FS-4 (Business Rules)
- ผู้ดูแลระบบ / DevOps — อ่าน SECTION 8, 9, 10 และ SECTION 15.2 / 15.3 ก่อน deploy อะไรก็ตาม

## เอกสารอื่นที่เกี่ยวข้องในรีโพ

- `CLAUDE.md` — คู่มือสำหรับ AI agent (มีจุดที่ไม่ตรงกับโค้ด ดู SECTION 15.14)
- `docs/UI_DESIGN_SPEC.md` — เอกสารควบคุมด้าน UI (design token, component library)
- `docs/UI_REDESIGN_PLAN.md` — แผน rollout การ redesign ทีละหน้าจอ
- `NOTIFICATIONS_SETUP.md` — ขั้นตอนตั้งค่าระบบแจ้งเตือน
- `docs/superpowers/plans/` — เอกสารแผนงานย้อนหลัง 5 ฉบับ
