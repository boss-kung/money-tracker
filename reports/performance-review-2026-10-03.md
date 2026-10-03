# วิเคราะห์อาการค้างช่วงเปิด Money Tracker — 3 ตุลาคม 2026

## ข้อสรุป

สาเหตุด้าน CPU ที่มีหลักฐานหนักที่สุดคือ **การคำนวณสิทธิประโยชน์บัตรเครดิตย้อนหลังซ้ำสำหรับแต่ละ Transaction บน main thread** ถูกขยายด้วยการสร้าง Billing state ซ้ำและการเรียก Dashboard หลายครั้งระหว่าง boot

## ผลหลังแก้ข้อ 3–4

อัปเดต `2026.10.03-perf-r131` ต่อจาก r130 ใน workspace ยังไม่ได้ deploy

**บัญชี:** auth, user lookup และ vault GET มี deadline 8 วินาที รวมการอ่าน JSON response; refresh retry รวมไม่เกิน 12 วินาทีรวม backoff ใช้ AbortController และ deadline แยกที่ยังจบได้แม้ network implementation ไม่ยอม abort ความผิดพลาดเครือข่าย/timeout ไม่ล้าง refresh token; token ที่ถูกหมุนใหม่ถูกเก็บก่อน user verification เพื่อไม่กลับไปใช้ token เก่าที่อาจถูกใช้แล้ว การหมดเวลาหลัง refresh หรือใน OAuth callback เข้า retry UI เดิม โดยเก็บ auth gate ไว้ระหว่าง restore และป้องกันการ restore ซ้อน/ผลเก่าหลัง logout

แยกการสร้าง vault ใหม่ออกจากช่วงรอเปิดแอปหลังยืนยันบัญชีและผล GET ว่า cloud ว่าง ส่วน decrypt/apply vault เดิมและการล้างข้อมูล demo ยังทำตามลำดับเดิม การ upload ที่ยังไม่ยืนยันมี guard ป้องกันสร้างซ้ำ และรายการแก้ไขระหว่าง upload ยังคง dirty สำหรับ sync ต่อ ไม่ตัด timeout ของ POST แล้วสร้างใหม่ด้วย key ใหม่ เพราะ response ที่หายไม่ได้แปลว่า server ไม่บันทึก

ก่อนส่ง POST ครั้งแรก เก็บ pending creation แยกตามเจ้าของบัญชีไว้ในเครื่อง โดยมี recovery key, encrypted row และ revision เดิม ถ้า logout/reload หรือ response หายยังไม่สูญเสีย key เมื่อ cloud ยืนยัน row ที่ตรงกันจึงบันทึก confirmed recovery key ก่อนลบ pending copy และแจ้งผู้ใช้ ถ้า row ไม่ตรงกันไม่สร้างทับด้วย key ใหม่; ถ้าเก็บ pending record ไม่สำเร็จจะไม่ส่ง POST

เมื่อ retry พบ row เดิมบน cloud จะรักษารายการแก้ไขใหม่ในเครื่องและ dirty revision แทนการนำ snapshot เก่ามาทับ ส่วนเครื่องที่ว่าง/demo หรือกำลังกู้หลัง logout ยัง apply ข้อมูลที่กู้ได้ และหลัง guard การสร้าง backup ถูกปล่อยจะ schedule sync ของรายการแก้ไขต่อ

**งานวิเคราะห์:** เดือนย้อนหลังใช้ monthly aggregates โดยไม่สร้าง current context; เดือนปัจจุบันใช้ context ครั้งเดียว เพิ่ม async path ที่ yield ระหว่างแต่ละ calculation, billing ของแต่ละบัตร และแต่ละเดือน จัดต่อด้วย `scheduler.postTask` priority `background` หรือ `setTimeout` เมื่อไม่รองรับ เพื่อให้ foreground tasks ได้ทำงานก่อน ตาม [แนวทาง scheduling ของ Chrome](https://developer.chrome.com/blog/use-scheduler-yield?hl=en) งานยกเลิกเมื่อมี commit ใหม่/เปลี่ยนวัน/ซ่อนแอป และกลับมาทำต่อเมื่อแอป visible ผลเก่าหรือผลยังไม่ครบไม่ถูก publish; content signature ตรวจจับการแก้แถวเก่าแม้จำนวนรายการคงเดิม รวม wallet/settings/rules/memory ที่เกี่ยวข้อง

Finance brief ใช้ context แบบ async และ cache ตาม revision เช่นกัน หน้าประวัติแสดง loading ทันที และอัปเดตเฉพาะหน้าที่ยังเปิดอยู่ หลังงานที่ถูกพัก/ยกเลิกกลับมาคำนวณสำเร็จ

วัด 3 รอบต่อเงื่อนไขใน Chrome บนเครื่องนี้ ด้วย 5,000 expense Transactions กระจาย 12 เดือน/บัตร 5 ใบ ไม่ผูกโปรโมชั่น บล็อก external network และบังคับ full rebuild พร้อมล้าง billing cache ก่อนวัด เปรียบเทียบ Finance source ก่อนข้อ 3–4 กับ async path หลังแก้ ทั้งสองฝั่งใช้ app/cache ของข้อ 1–2 แล้ว:

| สิ่งที่วัด | ก่อนข้อ 3–4 (median) | หลังข้อ 3–4 (median) |
|---|---:|---:|
| เรียก current credit liability summary | 12 ครั้ง | 1 ครั้ง |
| ช่องว่างยาวสุดของ UI timer ที่ตั้งไว้ทุก 16 ms | 86.1 ms | 25.2 ms |
| UI timer ทำงานระหว่าง rebuild | 0 ครั้ง | 4 ครั้ง |
| long task ที่ทับช่วง rebuild | 1 ครั้ง/รอบ (78–96 ms) | ไม่พบใน 3 รอบ |
| เวลารวมจนได้ rows ครบ รวมเวลาที่ yield | 78.9 ms | 92.6 ms |

ยอด expense ของ rows ทั้งสองฝั่งเท่ากัน 500,000 บาท และมีครบ 12 เดือน จุดที่ดีขึ้นคือเวลาที่หน้าจอถูกขวางและการคำนวณซ้ำ เวลารวมหลังแบ่งงานอาจเพิ่มจากการให้เวลา UI จึงไม่ใช้ผลนี้รับรองว่า full rebuild เสร็จเร็วขึ้นทุกกรณี ตัวเลข forced rebuild 1,157.7 ms ในการวิเคราะห์เดิมเป็น source ก่อนข้อ 1–2 และสภาวะอื่น จึงไม่ใช้เทียบเปอร์เซ็นต์กับตารางนี้

Browser auth test ใช้ expired token สังเคราะห์และ fetch ที่ไม่ resolve/ไม่ยอม abort: ออกจาก restoring ประมาณ 12.2 วินาทีจาก navigation โดย refresh ใช้งบ 12 วินาที, มี retry UI, token ยังอยู่ และ gate ยังปิดบังแอป เมื่อกด retry ด้วย response สังเคราะห์ที่สำเร็จ restoring=false, error=null, session พร้อม และ gate ปิดลง ไม่พบ page error

Browser smoke ผ่าน production deep link, demo navigation 5 หน้า, PIN privacy/unlock และ initial history ที่ถูกยกเลิกตอน hidden แล้ว resume จนแสดง 12 เดือน เทสต์เพิ่มเติมครอบคลุมการเก็บ token/rotation, late responses, concurrent retry, same-count edits, cancellation ก่อน publish, past predictions และ history resume

คำสั่ง `node --test tests/*.test.js` รอบสุดท้ายผ่าน **322/322** (ไม่มี skip/fail) รวม auth regression 26 รายการ, Finance background 13 รายการ และ App lifecycle/history 9 รายการ ตรวจ syntax และ `git diff --check` ผ่าน Independent review พบและแก้ key loss ระหว่าง logout/POST, snapshot retry ทับรายการใหม่ และ history cancel/resume แล้ว ไม่เหลือ blocker ที่พบในการตรวจ scoped patch นี้

ข้อจำกัด: การคำนวณแต่ละ phase/บัตร/เดือนและ signature check ก่อน publish ยังเป็น synchronous; ข้อมูลมากหรือกฎโปรโมชั่นหนักยังอาจเกิด long task ได้ ยังไม่ได้วัด Safari/iOS หรือบัญชี/cloud จริง และยังไม่ได้เปลี่ยนงานเป็น Worker ส่วน auth deadline 12 วินาทีเป็นงบ refresh retries; ขั้น user lookup/vault GET/storage bridge มี deadline ของตนเอง จึงไม่ใช่เวลาสูงสุดรวมของ login ทุกขั้น

## ผลหลังแก้ข้อ 1–2

อัปเดต `2026.10.03-perf-r130` เพิ่ม revision cache สำหรับ cycle usage, reward estimate และ Billing state โดยล้าง cache ก่อน State Commit, เมื่อ commit ล้มเหลว, ก่อน reconciliation, ก่อน/หลัง refresh สิทธิประโยชน์ และเมื่อวันท้องถิ่นเปลี่ยน รวมทั้งให้ statement, due info และ liability summary ใช้ Billing snapshot เดียวกัน ประวัติรอบบิลที่ย้อนเกิน 6 เดือนยังขอช่วงข้อมูลครบตามเดิม นอกจากนี้ boot render requests จาก feature blocks และ onboarding ถูกส่งผ่าน coordinator ที่รวมคำขอในเฟรมเดียวและรอ storage hydration

รัน benchmark เดิมซ้ำ 3 รอบต่อเงื่อนไขด้วย 1,000 Transactions และบัตร 5 ใบ:

| เงื่อนไข | ก่อนแก้ (median) | หลังแก้ (median) | เปลี่ยนแปลง |
|---|---:|---:|---:|
| Dashboard done รอบสุดท้าย — ไม่มี rule | 389.1 ms | 304.6 ms | เร็วขึ้น 22% |
| Dashboard done รอบสุดท้าย — มี rule | 7,095.9 ms | 1,092.8 ms | เร็วขึ้น 85% |
| long task ยาวสุด — มี rule | 3,286 ms | 526 ms | สั้นลง 84% |
| Dashboard starts ระหว่าง boot — มี rule | 12 | 3 | ลดลง 75% |

รอบ render แรกหลังแก้รวมคำขอเริ่มต้น/feature registrations 18 เหตุผลไว้ใน batch เดียว Onboarding ที่โหลดภายหลังอาจรวมใน batch แรกหรือขอ render เพิ่มในเฟรมถัดไป ส่วน market-price sync ยังอัปเดตแบบ asynchronous โดย Dashboard renders หลังแรกใช้ค่าคำนวณที่ cache แล้ว ก่อนแก้มี render สำเร็จ 8 ครั้ง หลังแก้มี 3 ครั้งในกรณีผูก rule ไม่พบ page error และเทสต์ทั้งหมด 274 รายการผ่าน รวมกรณี same-day threshold ordering, เปลี่ยน cap, แก้/ลบ/undo ธุรกรรม, เปลี่ยนวัน และประวัติบิลเกิน 6 เดือน

Browser smoke ผ่าน 3 เงื่อนไข: production deep link เปิดฟอร์มเพิ่มรายการ, demo navigation 5 หน้า และ PIN unlock โดยตรวจว่า privacy overlay ยังคงปิดบังหน้าระหว่างล็อก การทดสอบใช้ข้อมูลสังเคราะห์และบล็อก network ภายนอก จึงยังไม่ได้ยืนยัน login/cloud sync หรือ push notification จริง

ชุด r130 ลดการ replay ซ้ำด้วยการ reuse ผลลัพธ์ แต่การคำนวณครั้งแรกยัง replay ประวัติเดิม ไม่ได้เปลี่ยนเป็น single-pass index และยังพบ long task ประมาณ 0.53 วินาที จึงยังไม่รับรองว่าไม่มีค้างบนอุปกรณ์จริง ผลของ auth timeout และการแบ่งงานวิเคราะห์ที่ทำต่อใน r131 อยู่ในส่วนด้านบน

ผลก่อนแก้ด้านล่างเก็บไว้เพื่ออธิบาย root cause; หมายเลขบรรทัดในส่วนวิเคราะห์อ้างอิง source ก่อน patch

จำลองได้จริงด้วย 1,000 Transactions และบัตรเครดิต 5 ใบ: เมื่อทุก Transaction ผูกกฎ cashback ของบัตรตนเอง ช่วง boot วาด Dashboard รอบสุดท้ายที่มี log เสร็จประมาณ 7.1 วินาที เทียบกับ 0.39 วินาทีเมื่อไม่ผูกกฎ และมี long task ต่อเนื่องประมาณ 3.3 วินาที CPU profile พบ stack ใต้ `App.getRuleCycleUsage` ประมาณ 87% ของเวลาที่เก็บ sample

เป็นการยืนยัน bottleneck ในเงื่อนไขทดลอง ไม่ใช่การยืนยันว่าข้อมูลและอุปกรณ์จริงของผู้ใช้มีเงื่อนไขเดียวกัน หากไม่ได้ใช้กฎโปรโมชั่น ต้องให้น้ำหนักกับ boot renders, Billing state, งาน rebuild และ auth ตามอาการที่เห็น

ขั้นวิเคราะห์เดิมไม่ได้เปลี่ยน source หรือข้อมูลการเงินผู้ใช้ หลังได้รับอนุญาตให้แก้ข้อ 1–2 จึงแก้ source ใน workspace ตามผลด้านบน ยังไม่ได้ deploy และไม่ได้ใช้ข้อมูลการเงินจริงของผู้ใช้ในการทดลอง

## วิธีทดลองและขอบเขต

- Chrome headless ในโปรไฟล์ใหม่ viewport 390×844 บนเครื่องนี้ ไม่ได้จำลองความเร็ว CPU ของโทรศัพท์
- เสิร์ฟไฟล์ปัจจุบันจาก localhost และบล็อก requests ภายนอกทั้งหมด ไม่ใช้บัญชีหรือข้อมูลผู้ใช้
- ปิด Service Worker, notification background sync, App Lock และ finance rebuild อัตโนมัติผ่าน flags ที่มีอยู่ เพื่อแยกภาระคำนวณ
- ไม่ได้ทดสอบ cloud sync/login จริงหรือ Safari/iOS การทดลอง boot ยังอยู่หลัง auth gate จึงวัด log การคำนวณ/วาดเบื้องหลัง ไม่ใช่เวลาเข้าสู่หน้าการเงินของบัญชีจริง
- การทดลอง Dashboard แยกต่างหากนำ gate ออกจาก DOM ของโปรไฟล์ทดลอง เพื่อวัดหน้าที่มองเห็น
- ใช้ source จริงก่อน/หลัง patch; instrumentation และการปิดเอฟเฟกต์เกิดใน browser ทดลองเท่านั้น
- ตัวเลขเบื้องต้น 0/1,000/5,000 เป็นหนึ่ง sample ต่อเงื่อนไข; การทดลองโปรโมชั่นและ boot ใช้ 3 รอบ พร้อมแสดงค่ามัธยฐาน
- การทดลองปิดเอฟเฟกต์ปิดทั้ง observers และ animation hooks พร้อมกัน มีลำดับ/DOM ต่างกัน จึงใช้คัดสมมติฐานเบื้องต้น ไม่ใช้คำนวณเปอร์เซ็นต์ความเร็วหรือยืนยันว่าแอนิเมชันไม่มีผล

## 1. [สูงสุดเมื่อใช้โปรโมชั่น] สิทธิประโยชน์บัตรเครดิตคำนวณย้อนหลังซ้ำ

Call chain:

`Dashboard / Upcoming / Liability summary → Billing state → amountForTx + rewardForTx → getTransactionRewardEstimate → calculateSelectedRewardEstimate → getRuleCycleUsage`

จุดต้นเหตุ:

- `app_v2.js:16008` คำนวณ live estimate เมื่อ Transaction มี `rewardRuleIds`
- `app_v2.js:15935` เรียก cycle usage ต่อ rule
- `app_v2.js:15196` และ `15242` สร้าง Map จาก Transactions ทั้งหมด แล้ว filter/sort ประวัติและ replay สิทธิ์ก่อนรายการที่กำลังพิจารณา
- ในเส้นทางนี้มีการ normalize กฎทั้งหมดซ้ำผ่าน `ensureCCBenefitRulesState` และ normalize ชื่อร้าน/ช่องทางซ้ำจำนวนมาก
- `credit_card_cycles.js:248` สร้าง Billing state และเรียก reward callback ทั้งตอนหาจำนวนเงิน Ledger และสรุป reward ตามรายการ

เมื่อทำแบบนี้สำหรับ Transactions จำนวนมาก ต้นทุนสามารถเพิ่มใกล้กำลังสองตามจำนวนรายการและจำนวนกฎ ไม่ใช่แค่การ scan หนึ่งรอบ

**ทดลองเปลี่ยนตัวแปรเดียว:** ข้อมูลเดียวกัน 5 บัตร ธุรกรรม expense กระจาย 6 เดือน กฎ cashback 1% พร้อม cap ต่อรอบ 100 บาท เปิด/ปิดการผูก rule เท่านั้น วัด Dashboard 3 ครั้งต่อเงื่อนไข

| Transactions | ไม่ผูก rule: median | ผูก rule: median | getRuleCycleUsage ต่อ render |
|---:|---:|---:|---:|
| 250 | 53.8 ms | 190.2 ms | 2,000 |
| 500 | 64.4 ms | 548.9 ms | 4,000 |
| 1,000 | 78.3 ms | 1,886.8 ms | 8,000 |

ที่ 1,000 รายการ cycle usage ใช้เวลารวมเฉลี่ย 1,789.8 ms ต่อ render ตัวเลข caller มีเวลาซ้อนกัน จึงไม่บวกเวลาของฟังก์ชันต่าง ๆ เข้าด้วยกัน

**แนวทางแก้ที่เสนอ:** เตรียม index ตาม card/cycle/rule, normalize ข้อมูลครั้งเดียวต่อ revision และคำนวณ usage ตามลำดับวันที่/createdSequence หนึ่งรอบต่อกลุ่ม เก็บผลที่ reuse ได้ต่อ Transaction หลีกเลี่ยง replay ประวัติใหม่ใน render callbacks ทุกครั้ง

ห้ามใช้ stored estimate อย่างเดียวโดยไม่มีกฎ invalidate เพราะการเปลี่ยนโปรโมชั่นหรือแก้ธุรกรรมเก่าอาจกระทบ cap/threshold ของรายการหลังจากนั้น ต้องรักษาผลลัพธ์เดิมเรื่อง same-day ordering, caps, thresholds, ส่วนลด และ Ledger Amount

## 2. [สูง] boot เรียก Dashboard หลายครั้งและสร้าง Billing state ซ้ำ

ทั้ง 6 boot runs เรียก `app.renderDashboard.start` **12 ครั้ง** และมี `done` **8 ครั้ง** อีก 4 ครั้งเกิดก่อน dependencies พร้อมและไม่มี done จึงไม่เรียกทั้ง 12 ครั้งว่า render สำเร็จ

พบ init renders หลายบล็อก เช่น `app_v2.js:4648`, `17517`, `18539`, `19163`, `23737` รวมถึง notification/onboarding ที่โหลดภายหลัง การ register extension เสร็จทีละบล็อกแล้ววาดหน้าอีกครั้งทำให้ข้อมูลเดิมถูกคำนวณซ้ำ

| 1,000 Transactions, 5 บัตร | รอบ 1 | รอบ 2 | รอบ 3 |
|---|---:|---:|---:|
| Dashboard done รอบสุดท้าย — ไม่มี rule | 400.0 ms | 389.1 ms | 384.0 ms |
| Dashboard done รอบสุดท้าย — มี rule | 7,157.2 ms | 7,095.9 ms | 7,068.9 ms |
| long task ยาวสุด — ไม่มี rule | 112 ms | 144 ms | 144 ms |
| long task ยาวสุด — มี rule | 3,324 ms | 3,286 ms | 3,279 ms |

เวลาในตารางนับจาก `MTBoot` เริ่ม ไม่ใช่การรับรอง interactive readiness หรือเวลา login; `bootScreen.hideRequested` มี rule เกิดประมาณ 5.65–5.74 วินาที ขณะที่ log วาดหน้าบางส่วนยังทำต่อ

Dashboard ปกติหนึ่ง render ใน probe สร้าง Billing state รวม **20 ครั้งสำหรับ 5 บัตร** นับรวม `buildCardBillingState`, `getCardStatement`, `getNextPayableDueInfo` ที่เรียก engine ภายใน โดยไม่ได้บวก caller ซ้อนกับ engine ซ้ำ

- `app_v2.js:16086`: facade ไม่มี shared result
- `credit_card_cycles.js:252`: engine เรียก `prepareBillingMigration` ทุกครั้ง แม้ metadata เตรียมไว้แล้ว
- `calculations.js:436`: liability summary ขอ billing, statement และ due แยกกัน ทำให้ replay engine หลายครั้ง
- `app_v2.js:16740`: Upcoming สร้าง Billing state อีกชุด

**แนวทางแก้ที่เสนอ:** register ฟีเจอร์ให้ครบก่อน initial render และรวม boot invalidation ให้ render ครั้งเดียวเมื่อ state/dependencies พร้อม แยกการอัปเดต auth/ราคาตลาดที่มาภายหลังอย่างชัดเจน พร้อมทดสอบ App Lock, auth gate, hash routes และ notification deep links

สร้าง Billing snapshot ที่ใช้ร่วมกันภายใน render/operation เดียว แล้วดึง statement/due/alerts/upcoming จาก snapshot นั้น การ reuse ข้าม operation ต้องมี invalidation จากธุรกรรม, rule, wallet settings, migration/carryover และวันใหม่ หลีกเลี่ยง cache ที่อาศัย array reference เพราะ `S` มีการแก้ข้อมูลในที่เดิม

## 3. [สูงสำหรับอาการรอหน้าเชื่อมต่อ] auth request ไม่มี timeout ของแอป

`auth_sync.js:260`, `294`, `638` เรียก fetch โดยไม่มี AbortController/deadline ของแอป เส้นทาง cached token หมดอายุจะรอ `restoreSession` และคง `state.restoring` จน request จบ; retry เริ่มได้ต่อเมื่อ request เดิม reject

จำลองด้วย expired token สังเคราะห์และ fetch ที่ไม่ resolve โดยไม่ส่งคำขอจริง: ที่ 1.3 และ 10.3 วินาที หน้าจอยังแสดง “กำลังเชื่อมต่อบัญชี...”, `restoring=true`, `restoreError=null`, ไม่มี signal สำหรับยกเลิก request

อาการนี้เป็นการรอ network ภายใต้ auth gate ไม่ใช่ CPU freeze หากผู้ใช้ค้างที่ข้อความนี้ สาเหตุนี้ควรเลื่อนขึ้นอันดับแรก

**แนวทางแก้ที่เสนอ:** timeout แบบยกเลิก request ได้, จำกัดเวลารวมของ retry, แสดงข้อผิดพลาดและปุ่ม retry เมื่อถึง deadline พร้อมรักษา refresh token เมื่อเป็น network failure และคงข้อกำหนด auth/app lock เดิม

## 4. [รอง แต่ทำให้ค้างซ้ำหลังเปิด] Finance feature rebuild ยังทำงานก้อนใหญ่บน main thread

- `app_v2.js:21184` schedule boot หลัง 7 วินาทีและหลัง commit ประมาณ 1.2 วินาที
- `app_v2.js:21151` ใช้ requestIdleCallback แต่ callback ยังทำ synchronous rebuild ทั้งก้อน ไม่มีการแบ่งงานตาม idle deadline
- `finance_intelligence.js:1202`: `featureForMonth` เรียก full `buildContext` ใหม่สำหรับแต่ละเดือน รวมถึงเดือนเก่าที่ไม่ใช้ current health/forecast
- `finance_intelligence.js:1319`: full rebuild ทำ 12 เดือน

ทดลอง full rebuild แบบบังคับกับ 5,000 รายการ/5 บัตรที่ไม่ผูก rule ใช้ **1,157.7 ms**, เรียก liability summary 12 ครั้ง และสร้าง Billing state รวม 240 ครั้ง นี่เป็น forced cold/full path ไม่ใช่เวลา rebuild ปกติทุก boot; fresh store มี skip และ incremental path

**แนวทางแก้ที่เสนอ:** สร้าง current context/Billing snapshot ครั้งเดียว ใช้ month aggregates สำหรับประวัติ และแบ่ง rebuild เป็นงานสั้นที่ yield ให้ UI หรือย้ายการคำนวณ pure ไป Worker การเลื่อนเวลาเริ่มอย่างเดียวไม่ทำให้ task ก้อนใหญ่ตอบสนองดีขึ้น ตาม [แนวทาง long tasks ของ Chrome](https://web.dev/articles/optimize-long-tasks) และ [requestIdleCallback](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback)

## 5. [รอง] observers, animations และรายการธุรกรรมขนาดใหญ่

พบ observers ที่ดู subtree ของทั้งแอป (`app_v2.js:1046`, `21946`, `22110`, `22316`, `22710` เป็นต้น) ขณะที่ count-up/typewriter เปลี่ยน text DOM หลายครั้งต่อวินาที จึงเกิด callbacks ซ้ำแม้ไม่ได้เพิ่มรายการใหม่

probe Dashboard ที่ 1,000 รายการ: callbacks รวม 2,250 ครั้งในช่วงรอ 1.2 วินาที ใช้เวลา callback รวม 43 ms แต่การปิด observers/animation hooks ไม่ได้ทำให้ synchronous Dashboard duration ลดลงอย่างสม่ำเสมอ จึงยังไม่ใช่ root cause หลักที่ยืนยันได้

Canvas particles (`app_v2.js:21878`) หยุดเมื่อ canvas หลุด DOM แต่ยังไม่มี check ว่าหน้า Dashboard ถูกซ่อน; CSS มีเอฟเฟกต์ infinite และ scroll handler ของ wallets แก้ style ของทุกบัตร

Transaction list (`app_v2.js:7074`) สร้าง DOM ทั้งเดือนพร้อม bind swipe/events ทุกแถว ทดลอง 417 แถวพบ showPage 904 ms หนึ่ง sample และการปิดเอฟเฟกต์ไม่ได้แก้ bottleneck นี้ ใช้เป็นหลักฐานให้ profile layout ต่อ ไม่ใช้สรุปว่าเวลาทั้งหมดเป็น JavaScript row generation

**แนวทางแก้ที่เสนอ:** ใช้ named post-render hooks แทน watchers กว้าง, จำกัด observer เฉพาะ node/ชนิด mutation, รวม DOM reads ก่อน writes, หยุด animation/timers เมื่อหน้าไม่ active, รองรับ reduced motion และทยอยแสดงรายการประมาณ 30–50 แถวพร้อมรักษายอดรวมทุกแถว

## สิ่งที่ยังไม่มีหลักฐานว่าเป็นตัวการหลัก

- localStorage: probe 5,000 รายการ `Storage.saveAll` ใช้ 5 ms ขณะที่ persist รวมประมาณ 48 ms ซึ่งส่วนใหญ่เป็น billing preparation ไม่ควรเริ่มด้วยการย้ายฐานข้อมูลทั้งระบบ แม้ serialization ทุก collection ยังเป็นต้นทุนที่เพิ่มตามข้อมูล
- notifications: อาการ CPU ค้างเกิดได้แม้ปิด background sync แล้ว จึงไม่จำเป็นต้องมี network แจ้งเตือนจึงจะเกิด; snapshot เองใช้ billing engine จึงอาจขยายภาระเมื่อเปิดใช้
- ไฟล์ `app_v2.js` ประมาณ 1.44 MB และ styles ประมาณ 345 KB เป็นภาระ startup ที่ควรวัดเพิ่ม แต่ profile กรณีโปรโมชั่นชี้ไปที่ computation มากกว่า download/parse การแบ่งไฟล์อย่างเดียวไม่แก้ replay ซ้ำ
- ยังไม่ได้ยืนยัน memory leak, GPU cost บนอุปกรณ์จริง หรือ service-worker/cache mismatch

## ลำดับแก้ที่เสนอ ก่อนลงมือ

1. **ชุดแรก:** ลด repeated reward replay + reuse Billing snapshot + รวม boot render เป็นงานเดียว เน้นสาเหตุที่ทดลองได้และต้นทุนสูงที่สุด
2. **ถ้าค้างหน้าเชื่อมต่อ:** เพิ่ม auth deadline/retry ที่มีเวลารวมจำกัด ทำเป็น patch แยกเพื่อทดสอบ network failure ชัดเจน
3. **ชุดถัดไป:** reuse Finance context และแบ่ง feature rebuild ไม่ให้ block UI
4. **งานความลื่น:** จำกัด observers, หยุด animation ของหน้าที่ซ่อน และทยอยวาด Transaction list

เกณฑ์ตรวจหลังแก้: ผล Ledger/statement/reward เท่าเดิมก่อน-หลังทั้ง caps, thresholds, same-day ordering, repayments, carryovers และ scheduled-to-posted; initial render ไม่ทำซ้ำเพราะการ register ฟีเจอร์; Billing calculation reuse ต่อบัตร/operation; มี benchmark ชุดเดิมและ trace บนอุปกรณ์ที่ผู้ใช้พบอาการจริง เป้าหมายสำหรับงานเบื้องหลังคือแบ่งให้ไม่มี synchronous task ยาวเกิน 50 ms ในชุดทดลอง โดยต้องวัดก่อนรับรอง

## หลักฐานและวิธีรันซ้ำ

เก็บไว้ที่ `reports/performance-2026-10-03/`:

- `mt-perf-boot.cjs` + `mt-perf-boot-evidence.json`: boot 3 รอบต่อเงื่อนไข ไม่มี function timing wrappers
- `mt-perf-boot.cpuprofile`: CPU samples ของ boot ที่ผูก rule รอบแรก เปิดได้ใน Chrome DevTools Performance
- `mt-perf-boot-after-evidence.json` + `mt-perf-boot-after.cpuprofile`: benchmark หลังแก้รอบสุดท้าย ใช้ source `2026.10.03-perf-r130` ไม่มีการทดสอบอื่นรันพร้อมกัน
- `mt-perf-smoke.cjs` + `mt-perf-smoke-evidence.json`: ผล deep link, demo navigation และ PIN unlock หลังแก้
- `mt-perf-r131-smoke-evidence.json`: เพิ่มกรณี initial history hidden/cancel/resume ใน release r131
- `mt-perf-background.cjs` + `mt-perf-background-evidence.json`: full rebuild ก่อน/หลังข้อ 3–4, UI heartbeat และ long tasks โดยคง app/cache ของข้อ 1–2 ไว้ทั้งสองเงื่อนไข
- `mt-perf-auth-after.cjs` + `mt-perf-auth-after-evidence.json`: network timeout ที่ไม่ยอม abort และกด retry สำเร็จหลังข้อ 3
- `mt-perf-focus.cjs` + evidence: โปรโมชั่นเปิด/ปิดและ function timing 3 รอบต่อเงื่อนไข
- `mt-perf-probe.cjs` + evidence: ขนาดข้อมูล, operation timings, observers และ forced rebuild
- `mt-perf-auth.cjs` + evidence: auth request ไม่ตอบกลับด้วย token สังเคราะห์

เริ่ม `python3 -m http.server 8765 --bind 127.0.0.1` ที่ root แล้วรัน `node reports/performance-2026-10-03/mt-perf-boot.cjs` เป็นต้น Scripts ใช้ Playwright ที่ติดตั้งใน bundled runtime ของเครื่องนี้ และ paths เฉพาะเครื่อง; ต้องปรับ path เมื่อใช้เครื่องอื่น Outputs ปัจจุบันเขียน `/private/tmp/` และหลักฐานใน reports เป็นสำเนาของ run นี้

Background benchmark ต้องเตรียม Finance source ก่อนข้อ 3–4 ที่ `/private/tmp/mt-finance-before-r131.js` ด้วย `git show 6f8a981eb182b3763ac8aebb8dd88eec36e66ce3:finance_intelligence.js > /private/tmp/mt-finance-before-r131.js` (SHA-256 `79a2d718524506fafc809fdb3111e2cf56278e7366324be49a909f38782abe6c`) Browser route ใช้ source นี้เฉพาะ before condition; after ใช้ source workspace ปัจจุบัน
