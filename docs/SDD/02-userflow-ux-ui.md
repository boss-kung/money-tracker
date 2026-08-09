# SDD ตอนที่ 2 — User Flow / UX / UI

ต่อจากตอนที่ 1 (SECTION 1–3)

---

# SECTION 4 — User Flow

ทุก flow ด้านล่างอ้างอิงลำดับการเรียกฟังก์ชันจริงในโค้ด

## 4.1 Flow: เปิดแอปครั้งแรก (Cold Start)

```
ผู้ใช้เปิด URL / แตะไอคอน PWA
↓
เบราว์เซอร์โหลด index.html  → ทาสีพื้นหลังทันทีจาก inline <style>
↓
inline script สร้าง window.MTBoot + อ่าน debug flags
↓
ตรวจ ?demo=1 ?
   ├─ ใช่ → location.replace('./demo/index.html') → จบ flow นี้
   └─ ไม่ → ไปต่อ
↓
โหลด CSS แบบ non-blocking (media="print" → onload → media="all")
↓
โหลดสคริปต์ 20 ไฟล์แบบ defer ตามลำดับ
↓
app_lock.js ประเมิน readConfig()?.enabled
   ├─ ยังไม่ตั้ง App Lock → unlocked = true → เรียก init() ทันที
   └─ ตั้งไว้แล้ว → renderUnlock() แสดงหน้าล็อก และ "เรียก init() ไปด้วยพร้อมกัน"
↓
init()
   ├─ Storage.init() อ่าน localStorage ทุกคีย์
   │     ├─ พบข้อมูลเดิม → ใช้ข้อมูลนั้น
   │     └─ ไม่พบ → seed จาก DEFAULT_* ใน sample-data_v2.js
   ├─ MT_STORAGE_HYDRATED = true (ปลดล็อกให้ persist() ทำงานได้)
   ├─ อ่าน route: location.hash → localStorage['mt_last_page'] → 'dashboard'
   ├─ applyTheme()
   ├─ migration statusNormV1 + rewardEstimateSlimV1
   ├─ bind bottom nav + hashchange
   ├─ App.showPage(S.page) → render หน้าแรก
   ├─ requestHideBootScreen('first-render')
   ├─ setupServiceWorkerUpdates() + setupConnectivityWatch()
   ├─ MTAuthSync.initAuthSync()
   └─ App._autoSyncMarketIfStale()
↓
โมดูลที่โหลดหลัง app_v2.js patch เพิ่ม
   ├─ loans_v2.js  → wrap _ledgerFlows → recalc → render ใหม่
   ├─ onboarding.js → wrap render 6 ตัว → render หน้าปัจจุบันซ้ำเพื่อให้ empty state ทำงาน
   └─ notifications_v2.js / split_bill.js → เขียนทับ renderMore
↓
พร้อมใช้งาน
```

เส้นทางกรณีผิดพลาด
- `localStorage` ใช้ไม่ได้ (`isLocalStorageAvailable()` เป็นเท็จ) → `Storage.load` คืน null ทุกคีย์ → seed default; `Storage.save` toast "อุปกรณ์นี้ไม่พร้อมบันทึก local storage กรุณาส่งออกข้อมูลสำรองไว้ก่อน"
- JSON เสีย → `Storage.load` catch แล้ว toast "พบข้อมูลบางส่วนอ่านไม่ได้ ระบบใช้ค่าปลอดภัยแทน" และคืน null (ใช้ default แทน)
- ค้างเกิน 9 วินาที → timeout บังคับซ่อน boot screen แล้ว render auth gate

## 4.2 Flow: ปลดล็อกแอป (App Lock)

```
แอปเปิด / กลับจาก background
↓
MTAppLock ตรวจ config.enabled
   ├─ ปิดอยู่ → ผ่านทันที
   └─ เปิดอยู่ → renderUnlock()
↓
มี biometric credential ?
   ├─ มี → queueAutoBiometric() หน่วง 280ms แล้วเรียก unlockWithBiometric อัตโนมัติ
   │        ├─ สำเร็จ → unlockSuccess(config,'biometric') → ปิดหน้าล็อก
   │        └─ ล้มเหลว
   │             ├─ NotAllowedError → แสดง "ใช้รหัสแทนได้"
   │             └─ อื่น ๆ → แสดงข้อความ error → รอ PIN
   └─ ไม่มี → รอ PIN
↓
ผู้ใช้กดตัวเลขบน keypad (MTAppLock.press)
↓
ครบ 6 หลัก → verifyEnteredPin() อัตโนมัติ (ไม่ต้องกดยืนยัน)
↓
ตรวจ lockedUntil > now ?
   ├─ ใช่ → renderUnlock("ใส่ผิดหลายครั้ง กรุณารอ N วินาที") → หยุด
   └─ ไม่ → deriveHash(pin, salt, iterations) แล้ว safeEqual กับ hash ที่เก็บ
        ├─ ตรง → unlockSuccess → รีเซ็ต failureCount → เขียน sessionStorage → ปิดหน้าล็อก
        └─ ไม่ตรง → failureCount++
             ├─ < 5 ครั้ง → "รหัสไม่ถูกต้อง"
             └─ >= 5 ครั้ง → lockedUntil = now + min(300000, 30000*(n-4)) → "ใส่ผิด N ครั้ง กรุณารอสักครู่"
```

## 4.3 Flow: บันทึกรายจ่าย (เส้นทางหลัก)

```
ผู้ใช้แตะ FAB "+"
↓
App.openAddTx() → รีเซ็ต S.tx → openOverlay('overlay-add-tx') → pushLayer() (history +1)
↓
[ขั้นที่ 1] _renderAddTxAmount() แสดง numpad
↓
ผู้ใช้กดตัวเลข → App._numpad(key) → อัปเดต S.tx.amount → _syncAddTxAmountUI()
   (มีตัวเลือกเครื่องคิดเลข + - × ÷ ผ่าน App._calcOp)
↓
ผู้ใช้เลือกประเภท (รายจ่าย/รายรับ/โอน) → App._setTxType(type)
   ├─ transfer → ล้าง merchant, ปิด recurring/installment, ใส่ค่าเริ่มต้นกระเป๋าปลายทาง
   └─ อื่น ๆ ที่ไม่ใช่ expense → ปิด recurring/installment
↓
กด "ถัดไป" → App._goToDetail()
   ├─ _evalCalc() คำนวณค่าที่ค้างในเครื่องคิดเลข
   ├─ parseFloat(amount) === 0 ? → toast('กรุณาระบุจำนวนเงิน','error') → หยุดอยู่ขั้นเดิม
   └─ ผ่าน → S.tx.step = 'detail' → _renderAddTxDetail()
↓
[ขั้นที่ 2] ผู้ใช้กรอกรายละเอียด
   ├─ เลือกกระเป๋า
   ├─ เลือกหมวดหมู่ (App._selectCat)
   ├─ พิมพ์ร้านค้า → App._showMerchantDropdown → เลือก → App._pickMerchant → อาจ auto-fill หมวด+กระเป๋า
   │    (App.getMerchantSuggestion จำค่าที่ใช้บ่อย)
   ├─ ถ้ากระเป๋าเป็นบัตรเครดิต → แสดงกฎสิทธิประโยชน์ที่เข้าเงื่อนไข
   │    ├─ ผู้ใช้ไม่แตะ → ระบบเลือกชุดที่คุ้มที่สุดให้เอง (getOptimalBenefitSelection)
   │    └─ ผู้ใช้แตะ → rewardRulesTouched = true → ใช้ตามที่เลือก
   ├─ ถ้ากระเป๋าเป็น BNPL → กรอกจำนวนงวด
   ├─ สวิตช์ "ผ่อนชำระ" → กรอกจำนวนเดือน
   ├─ สวิตช์ "รายการประจำ" → ตั้งความถี่
   └─ สวิตช์ "ค่าใช้จ่ายร่วม" → ระบุจำนวนคน หรือส่วนของเราเอง
↓
กด "บันทึก" → App.saveTx()
↓
validateTransactionDraft()
   ├─ ไม่ผ่าน → toast(error) → หยุด (overlay ยังเปิดอยู่ ข้อมูลไม่หาย)
   └─ ผ่าน → ไปต่อ
↓
เป็นรายรับที่รับคืน และยอดเกินยอดค้าง และยังไม่ยืนยัน ?
   ├─ ใช่ → toast เตือน + ตั้ง allowOverReimbursement = true → หยุด (ต้องกดบันทึกซ้ำ)
   └─ ไม่ → ไปต่อ
↓
เป็นการผ่อน (ไม่ใช่ edit, expense, isInstallment, months >= 2) ?
   ├─ ใช่ → สร้าง N รายการ แชร์ installmentGroupId
   │        → งวดอนาคตตั้ง scheduled: true
   │        → _registerMerchantFromTx → refreshTransactionRewardEstimates
   │        → recalculateWalletBalances → persist()
   │        → ปิด overlay → showPage('transactions')
   │        → toast("สร้างรายการผ่อน N งวดแล้ว") → จบ
   └─ ไม่ → ไปต่อ
↓
cleanTxFromDraft(id) สร้าง object ธุรกรรม
   ├─ canonicalize ชื่อร้านให้ตรงกับ S.merchants
   ├─ คำนวณ rewardEstimate (แล้วย่อด้วย _slimRewardEstimate)
   ├─ _applyInstantDiscountToTx — ถ้ามีส่วนลดทันที ลด amount จริงและเก็บ benefitBaseAmount
   └─ กำหนด ledgerAmount ตามกรณี (splitBill / sharedExpense / ปกติ)
↓
isEdit ? แทนที่แถวเดิม : unshift เข้าหัว array
↓
ผลข้างเคียง
   ├─ ถ้าเป็นการรับคืน → _syncSharedExpenseSettlement(parentTxId)
   ├─ ถ้ามี splitBillId → linkSplitBillToTransaction()
   ├─ ถ้าเป็น BNPL wallet + งวด >= 2 → BNPL.store.createPlan()
   └─ _registerMerchantFromTx + refreshTransactionRewardEstimates
↓
recalculateWalletBalances({save:false, recordSnapshot:true})
↓
persist() → Storage.saveAll(S) → verify readback
   ├─ สำเร็จ → MTAuthSync.markDirty() (ตั้งเวลา sync ขึ้น cloud)
   └─ ล้มเหลว → toast("บันทึกไม่สำเร็จ — แนะนำสำรองข้อมูลก่อนลองใหม่")
↓
ปิด overlay → popLayer() (history -1)
↓
isEdit ? App.render() : App.showPage('transactions')
↓
toast("บันทึกรายการแล้ว" / "แก้ไขรายการแล้ว")
↓
ถ้าติ๊ก "รายการประจำ" และเป็น expense และไม่ใช่ edit
   → _createRecurringFromDraft() → ผูก sourceRecurringId กลับเข้า tx → persist อีกครั้ง
↓
onboarding.js: ถ้าเป็นรายการแรกในชีวิต → toast("บันทึกรายการแรกแล้ว 🎉 ดูสรุปได้ที่ Reports") หลัง 600ms
```

เส้นทางยกเลิก
```
ผู้ใช้แตะ backdrop / ปุ่มปิด / กดปุ่มย้อนกลับของระบบ
↓
App.closeAddTx() → ปิด overlay + รีเซ็ต S.tx ทั้งหมดกลับค่าเริ่มต้น
↓
ข้อมูลที่กรอกไว้หายทั้งหมด (ไม่มี draft สำหรับรายการเดี่ยว — ต่างจากหารบิลที่มี draft)
```

## 4.4 Flow: บันทึกเร็วด้วยเสียง

```
ผู้ใช้แตะปุ่มไมค์ (#fab-mic)
↓
App.openQuickCapture() → สร้าง/เปิด overlay → _qcRenderInput()
↓
ผู้ใช้แตะไอคอน 🎤 → App._qcMicStart(event)
↓
speechSupported() ?
   ├─ ไม่รองรับ → onError("ไม่รองรับการรับเสียงในเบราว์เซอร์นี้") → toast
   └─ รองรับ → _setMicListening(true) แสดง waveform + จุดกระพริบ
↓
SpeechRecognition (lang th-TH) เริ่มฟัง
   ├─ onresult → เติมข้อความลงช่อง → หน่วง 350ms → App._qcSubmit() อัตโนมัติ
   ├─ onerror
   │    ├─ not-allowed → toast("กรุณาอนุญาตการเข้าถึงไมค์")
   │    ├─ no-speech   → toast("ไม่ได้ยินเสียง — ลองอีกครั้ง")
   │    └─ อื่น ๆ      → toast("รับเสียงไม่สำเร็จ")
   └─ onend → _setMicListening(false)
↓
App._qcSubmit() → parseQuickCapture(raw)
↓
ไม่พบยอดเงิน (amount <= 0) ?
   ├─ ใช่ → _qcRenderInput(raw, "ไม่พบจำนวนเงิน — ลองพิมพ์ใหม่ เช่น \"กาแฟ 65\"") → กลับหน้ากรอก
   └─ ไม่ → _qcRenderPreview(result)
↓
[หน้า Preview] แสดงยอด + 4 แถว (หมวด / ร้าน / กระเป๋า / วันที่)
↓
มีหมวดหมู่ ?
   ├─ ไม่มี → ปุ่ม "บันทึก" ถูก disable + แสดงคำเตือน "⚠️ ยังไม่มีหมวดหมู่ — กด แก้ไข ก่อนบันทึก"
   └─ มี → ปุ่ม "บันทึก" ใช้งานได้
↓
ผู้ใช้เลือก
   ├─ "✓ บันทึก" → _applyToSxState(result) → closeQuickCapture() → App.saveTx()
   │      (เข้า validate เดิมทั้งหมด ถ้าไม่ผ่านจะ toast error)
   ├─ "แก้ไข" หรือแตะแถวใดแถวหนึ่ง → _applyToSxState → ปิด quick capture → เปิด overlay-add-tx ขั้น detail
   ├─ "←" กลับ → _qcRenderInput(rawInput เดิม)
   └─ "✕" ปิด → stopListening() + ปิด overlay + ล้าง _qcResult
```

## 4.5 Flow: ชำระบัตรเครดิต

```
ผู้ใช้แตะ "ชำระ" (จากการ์ดบัตร หรือหน้า CC detail)
↓
App.openCCPay(cardId)
   ├─ ดึงยอดค้าง = getCreditCardDueInfo().amount || statement.balanceDue || |balance|
   ├─ สร้างรายการกระเป๋าต้นทาง (ตัด credit และ bnpl ออก)
   └─ เปิด overlay พร้อมยอดเต็มจำนวนเป็นค่าเริ่มต้น
↓
ผู้ใช้เลือกกระเป๋าต้นทาง
↓
ผู้ใช้ปรับยอด (พิมพ์เอง หรือกดชิป เต็มจำนวน / 1,000 / 500)
   → oninput → App.updateCCPayPreview() คำนวณสรุปสด
↓
มีส่วนลดตอนชำระ ?
   ├─ ใช่ → toggleCCPayDiscount() → แสดงช่อง "ส่วนลด" และ "เงินที่จ่ายจริง"
   │        → แก้ช่องใดช่องหนึ่ง ระบบคำนวณอีกช่องให้อัตโนมัติ
   └─ ไม่ → cashAmount = amount
↓
กด "ชำระเงิน" → App.saveCCPay()
↓
Validation ตามลำดับ
   ├─ ไม่พบบัตร/ไม่ใช่ credit → toast("ไม่พบบัตรเครดิต")
   ├─ ไม่เลือกกระเป๋า → _showFieldError('cc-pay-wallet','กรุณาเลือกกระเป๋าต้นทาง')
   ├─ amount <= 0 → _showFieldError('cc-pay-amount','กรุณาระบุยอดชำระ')
   ├─ cashAmount <= 0 → _showFieldError('cc-pay-cash-amount','กรุณาระบุเงินที่จ่ายจริง')
   ├─ cashAmount > amount + 0.01 → "เงินที่จ่ายจริงต้องไม่เกินยอดที่ตัดจากบัตร"
   ├─ ส่วนลดไม่สอดคล้อง → "ส่วนลดต้องตรงกับยอดตัดบัตรลบเงินที่จ่ายจริง"
   └─ ยอดกระเป๋าไม่พอ → "ยอดเงินในกระเป๋าไม่เพียงพอ"
↓
สร้าง tx { type:'cc_payment', amount, walletId: source, toWalletId: card, statementId }
   (ถ้ามีส่วนลด เพิ่ม cashAmount, discountAmount, discountSource:'platform')
↓
unshift → recalculateWalletBalances → persist() → ปิด overlay
↓
ถ้ากำลังเปิดหน้า CC detail ของบัตรนี้อยู่ → openCCDetail(cardId) ใหม่
↓
re-render หน้าปัจจุบัน
↓
toast("ชำระ ฿X สำเร็จ" + " · จ่ายจริง ฿Y" ถ้ามีส่วนลด)
```

## 4.6 Flow: จ่ายงวด BNPL

```
ผู้ใช้แตะ "จ่ายงวด" (บนการ์ดกระเป๋า หรือในหน้ารายการแผน)
↓
BNPL.ui.openPayModal(planId, no)
   ├─ ไม่พบแผน หรืองวดนี้จ่ายแล้ว → return เงียบ ๆ (ไม่มี feedback)
   └─ พบ → เติมเนื้อหา + เปิด overlay-bnpl-pay
↓
แสดง: ชื่อร้าน, งวด n/N, วันครบกำหนด (สีแดง + ⚠️ ถ้าเลยกำหนด), ยอดงวด
↓
เหลือมากกว่า 1 งวด ?
   └─ ใช่ → แสดง checkbox "ปิดยอดทั้งหมด (N งวดที่เหลือ · ฿X)"
        → ติ๊ก → BNPL.ui._togglePayoff() อัปเดตยอดและคำบรรยายสด
↓
เลือกบัญชีที่จ่าย (เฉพาะ bank/cash/ewallet/saving ที่ไม่ถูกซ่อน) + วันที่จ่าย
↓
กด "ยืนยันจ่าย" → BNPL.ui._confirmPay()
   ├─ ไม่เลือกบัญชี → App.toast("กรุณาเลือกบัญชีที่จ่าย","error") → หยุด
   └─ เลือกแล้ว → payoffAll() หรือ payInstallment()
        ├─ ตรวจซ้ำว่าประเภทกระเป๋าถูกต้อง (defense in depth) → ถ้าไม่ถูก console.warn + คืน null
        ├─ สร้าง tx bnpl_payment + ตั้ง paidTxId ให้งวดที่จ่าย
        ├─ ถ้าทุกงวดจ่ายครบ → plan.status = 'paid_off'
        ├─ App.recalculateWalletBalances({save:false})
        └─ persist()
↓
ปิด modal → _refreshPlanScreen() → App.render()
↓
toast("บันทึกการชำระงวดแล้ว ✓" หรือ "ปิดยอดทั้งหมดแล้ว ✓")
```

กรณีลบ tx การชำระภายหลัง
```
ผู้ใช้ลบ tx bnpl_payment
↓
BNPLStore.unlinkPaymentByTxId(txId) → ล้าง paidTxId ของทุกงวดที่ผูกกับ tx นี้
   → ถ้าแผนเคย paid_off จะกลับเป็น active
   → คืน undo token { planId, nos, prevStatus }
↓
ผู้ใช้กด Undo ? → BNPLStore.relinkPayment(token, txId) คืนสถานะเดิม
```

## 4.7 Flow: เข้าสู่ระบบและซิงก์ข้อมูล

```
ผู้ใช้แตะเมนูบัญชี → "เข้าสู่ระบบด้วย Google"
↓
signInWithGoogle()
   ├─ ตรวจ configured() (ต้องมี MT_SUPABASE_URL และ anon key)
   ├─ สร้าง PKCE verifier สุ่ม → เก็บ localStorage['mt_auth_sync_pkce_verifier']
   ├─ คำนวณ challenge (SHA-256 + base64url)
   └─ redirect ไป {supabaseUrl}/auth/v1/authorize?provider=google&...
↓
Google → Supabase → redirect กลับมาที่ MT_AUTH_REDIRECT_URL พร้อม ?code=
↓
parseSessionFromUrl() → exchangeCodeForSession(code)
↓
setSession(session) → เก็บ token → fetchUser() → scheduleBackgroundTokenRefresh()
↓
pullRemoteVault()
   ├─ ไม่มี vault บนคลาวด์
   │    → ensureFirstRunBackup()
   │    → generateRecoveryKey() → showRecoveryKeySheet(key) ให้ผู้ใช้บันทึกไว้
   │    → createVaultFromLocalData(recoveryKey)
   │         ├─ deriveKey(recoveryKey, salt, 310000 รอบ)
   │         ├─ generateDataKey() (AES-GCM 256)
   │         ├─ wrapDataKey(dataKey, passphraseKey)
   │         ├─ encryptVault(payload, dataKey) → ciphertext + iv + checksum
   │         └─ POST /rest/v1/mt_user_vaults
   └─ มี vault อยู่แล้ว
        ├─ มี recovery key เก็บไว้ในเครื่อง → unlockVault() อัตโนมัติ
        └─ ไม่มี → showVaultLockedSheet() → ผู้ใช้กรอก recovery key → promptUnlock()
             ├─ ถูก → decryptVault() → ตรวจ checksum → applyPayload() → render ใหม่
             └─ ผิด → error "Vault checksum mismatch" หรือ decrypt ล้มเหลว → แจ้งผู้ใช้
↓
เมื่อข้อมูลเปลี่ยน → persist() → MTAuthSync.markDirty()
↓
debounce 2.5 วินาที → autoSyncIfReady() → syncNow({direction:'push'})
   ├─ ตรวจ data_version บนเซิร์ฟเวอร์
   │    ├─ ตรงกับที่เรามี → push ทับ
   │    └─ ใหม่กว่า → handleRemoteConflict(remote) → ให้ผู้ใช้เลือก
   └─ push สำเร็จ → อัปเดต lastAppliedVaultVersion
```

Flow ลบบัญชี
```
ผู้ใช้เลือก "ลบบัญชีถาวร"
↓
showDeleteAccountSheet() แสดงผลกระทบ 3 ข้อ + อีเมลที่จะส่ง OTP
↓
กด "ดำเนินการต่อ — ส่ง OTP" → sendDeleteOtp()
   → GET {supabaseUrl}/auth/v1/reauthenticate (Supabase ส่ง OTP ทางอีเมล)
↓
showDeleteAccountOtpSheet() ให้กรอกรหัส
↓
verifyOtpAndDelete(token)
   ├─ POST /auth/v1/verify {token, type:'reauthentication'}
   │    └─ ผิด/หมดอายุ → โยน error → แสดงข้อความ
   └─ ถูก → deleteAccount()
        ├─ deleteVault() → DELETE /rest/v1/mt_user_vaults?user_id=eq.<id>
        ├─ POST /functions/v1/delete-account (ลบ auth user ด้วย service role)
        ├─ clearDeviceRecoveryKey()
        ├─ Storage.reset() + localStorage.clear() + sessionStorage.clear()
        └─ location.reload()
```

## 4.8 Flow: เปิดใช้การแจ้งเตือน

```
ผู้ใช้เปิดสวิตช์แจ้งเตือนในหน้า More
↓
App.enableNotifications() → enableNotifications()
↓
ตรวจ isConfigured() (ต้องมี Supabase URL + anon key + VAPID key)
   └─ ไม่ครบ → แจ้งผู้ใช้ว่ายังตั้งค่าไม่ครบ
↓
Notification.permission
   ├─ 'granted' → ใช้เลย
   ├─ 'default' → await Notification.requestPermission()
   │      ├─ ผู้ใช้อนุญาต → ไปต่อ
   │      └─ ผู้ใช้ปฏิเสธ → statusLabel() = "ถูกบล็อก" → หยุด
   └─ 'denied' → หยุด (ต้องไปแก้ที่ตั้งค่าเบราว์เซอร์เอง)
↓
สมัคร push subscription จาก Service Worker (VAPID public key)
↓
POST /functions/v1/register-notification-device
   { installId, pushSubscription, platform, browser, timezone, permission, enabled, appVersion, userAgent, hideAmounts }
   ├─ 400 "installId is required"
   ├─ 400 "pushSubscription is required when enabling notifications"
   └─ 200 { ok:true } → upsert ทั้ง device และ preferences
↓
runBackgroundNotificationSync('boot')
   ├─ syncSnapshot() → POST /functions/v1/sync-notification-snapshot (TTL 10 นาที)
   └─ syncCustomRules() → POST /functions/v1/sync-notification-rules (TTL 6 ชม. + hash guard)
```

Flow การส่งจริง (ฝั่งเซิร์ฟเวอร์)
```
pg_cron ยิงทุก 15 นาที (mt_custom_notification_rules) และทุกวัน 13:30 UTC = 20:30 เวลาไทย (mt_daily_expense_reminders)
↓
Edge Function send-custom-notification-rules
   ├─ ดึง devices ที่ enabled = true และ permission = 'granted' และมี push_subscription.endpoint
   ├─ ดึง rules ที่ enabled = true ของ install_id เหล่านั้น
   ├─ ดึง snapshots ล่าสุด
   └─ สำหรับแต่ละกฎ → shouldSend(rule, snapshot, bangkokParts())
        ├─ คืน '' → skipped++
        └─ คืน dedupeKey
             ├─ ตรวจ mt_notification_logs ว่ามี status='sent' แล้วหรือยัง → ถ้ามี skipped++
             └─ ยังไม่ส่ง → sendWebPush() ให้ทุก device ของ install นั้น
                  ├─ สำเร็จอย่างน้อย 1 → upsert log status='sent'
                  └─ ล้มเหลวทั้งหมด → upsert log status='error' + บันทึก failures[]
↓
ผู้ใช้ได้รับ notification → กด
↓
service-worker notificationclick
   ├─ หา window client ที่ origin+pathname ตรงกัน
   │    ├─ พบ → client.focus() + postMessage({type:'NOTIFICATION_NAVIGATE', route})
   │    │        → app_v2.js รับ message → showPage(pageMap[route]) → เปิด sub-screen ที่ตรงกัน
   │    └─ ไม่พบ → clients.openWindow('./index.html#<hash>')
```

หน้าต่างเวลา `isInCurrentWindow` — กฎจะยิงเมื่อ `0 <= (นาทีปัจจุบัน - นาทีของกฎ) < 15` เท่านั้น
เงื่อนไขแยกรายทริกเกอร์ (จาก `shouldSend`)
- `daily_time` — ถึงเวลาที่ตั้ง
- `weekly_time` — ตรงวันในสัปดาห์ที่เลือก + ถึงเวลา
- `one_time` — วันที่ตรง + ถึงเวลา
- `no_transaction_today` — ถึงเวลา และ `today_tx_count === 0`
- `upcoming_bill_due` — ถึงเวลา และมีบิลที่ `daysLeft === daysBefore`
- `credit_card_due` — ถึงเวลา และมีบัตรที่ `daysLeft === daysBefore`
- `backup_stale` — ถึงเวลา และไม่ได้ export มานาน >= `staleDays` (ค่าเริ่มต้น 30)
- `monthly_time` — วันที่ของเดือนตรง (clamp 1–28) + ถึงเวลา
- `weekday_only_time` — จันทร์–ศุกร์ + ถึงเวลา
- `no_tx_streak` — ไม่มีรายการติดต่อกัน >= `streakDays` (ค่าเริ่มต้น 3) + ถึงเวลา

## 4.9 Flow: นำเข้าข้อมูลจากไฟล์ backup

```
ผู้ใช้แตะ "นำเข้าข้อมูล (JSON)"
↓
คลิก <input type="file" accept=".json"> ที่ซ่อนอยู่
↓
เลือกไฟล์ → onchange → App.importData(input)
↓
Storage.importJSON(file, onSuccess, onError)
   ├─ ไม่มีไฟล์ → onError('ไม่พบไฟล์')
   ├─ ขนาด > 10MB → onError('ไฟล์ backup ต้องมีขนาดไม่เกิน 10MB')
   └─ FileReader อ่านเป็นข้อความ
        ├─ JSON.parse ล้มเหลว → onError(err.message)
        └─ สำเร็จ → normalizeBackupPayload(data)
             ├─ ไม่ใช่ object → throw 'ไฟล์สำรองข้อมูลไม่ถูกต้อง'
             ├─ ไม่มี transactions/wallets เป็น array → throw 'ไม่พบข้อมูลหลักของแอป'
             ├─ _stripDangerousKeys ลบ __proto__ / constructor / prototype แบบ recursive
             ├─ aiInsightStore → ลบฟิลด์ action ทุกตัว, กรองเฉพาะ insight ที่มี id เป็น string
             └─ เติมค่า default ให้คีย์ที่ขาด ตาม BACKUP_DEFAULTS
↓
App._validateImportPayload(data)
   ├─ errors → { ok:false } → แสดง error
   └─ กรอง transactions ทีละแถว สะสม warnings
        ├─ type ไม่อยู่ใน 8 ชนิด → "ข้ามรายการ type ผิด: X"
        ├─ amount <= 0 (ยกเว้น investment_adjust) → "ข้ามรายการจำนวนเงินไม่ถูกต้อง"
        ├─ date ไม่ตรงรูปแบบ → "ข้ามรายการวันที่ไม่ถูกต้อง"
        ├─ walletId ไม่มีในไฟล์ → "ข้ามรายการที่อ้างอิง wallet ไม่พบ"
        └─ toWalletId ไม่มีในไฟล์ → "ข้ามรายการที่อ้างอิงปลายทางไม่พบ"
↓
App.openImportPreview() แสดงจำนวนรายการเดิม vs รายการที่ผ่าน + รายการ warning
↓
ผู้ใช้ตัดสินใจ
   ├─ ยกเลิก → ปิด sub-screen + ล้างค่าใน <input type="file">
   └─ ยืนยัน → App.confirmImportPayload()
        ├─ Storage.createLocalBackup(S, 'pre-import') (rotation เก็บ 3 ชุด)
        ├─ App._applyBackupPayload() หรือ _applyImportMergePayload()
        ├─ recalculateWalletBalances + persist()
        └─ render ใหม่ทั้งแอป
```

## 4.10 Flow: ตรวจสอบและซ่อมยอดคงเหลือ

```
More → ตั้งค่า → จัดการ → "ตรวจสอบยอดคงเหลือ"
↓
App.openBalanceRepairScreen()
↓
มี baseline (openingBalance / openingUnits) แล้วหรือยัง ?
   ├─ ยัง → showConfirm("ตั้งค่า Baseline / บันทึกยอดตอนนี้เป็นจุดอ้างอิง ดำเนินการต่อ?")
   │      ├─ ยกเลิก → ไม่ทำอะไร
   │      └─ ยืนยัน → _snapshotOpeningBalances() → persist → toast("บันทึก Baseline แล้ว")
   └─ มีแล้ว → คำนวณตารางเปรียบเทียบ
↓
สำหรับแต่ละกระเป๋า
   expected = openingBalance + cashFlow   (หรือ openingUnits + unitsFlow แล้วคูณราคา)
   gap = |expected - current|
   ├─ gap <= 0.01 (และ unitGap <= 1e-8) → แสดง "✓ ถูกต้อง"
   └─ เกิน → แสดง "⚠️ ต่างกัน ฿X" + ปุ่ม "แก้ไข"
↓
ผู้ใช้เลือก
   ├─ "แก้ไข" รายตัว → _repairOneWallet(id) → persist → เปิดหน้านี้ใหม่ → toast("แก้ไขยอดแล้ว")
   ├─ "แก้ทั้งหมด" → _rebuildWalletBalances() → toast("แก้ไข N กระเป๋าแล้ว" หรือ "ยอดทุกกระเป๋าถูกต้องแล้ว") → ปิดหน้า
   └─ "รีเซ็ต Baseline ใหม่" → showConfirm(danger) → ลบ openingBalance ทั้งหมด → snapshot ใหม่
```

## 4.11 Flow: กดปุ่มย้อนกลับของระบบ (Android / gesture)

```
ผู้ใช้เปิด overlay หรือ sub-screen
↓
patched openOverlay/openSubScreen → pushLayer() → pendingDelta++ → queueMicrotask
↓
microtask flush → history.pushState() ตามจำนวน delta สุทธิ
↓
ผู้ใช้กดปุ่มย้อนกลับของระบบ
↓
popstate ยิง
   ├─ depth <= 0 → ไม่ทำอะไร (ปล่อยให้ออกจากแอปตามปกติ)
   └─ depth > 0 → poppingOurs = true → closeTopLayer()
        ├─ มี confirm dialog เปิดอยู่ → คลิก .v23-cancel-btn
        ├─ มี overlay เปิดอยู่ → ตัวบนสุด
        │      ├─ overlay-add-tx → App.closeAddTx()
        │      └─ อื่น ๆ → App.closeOverlay(id)
        └─ มี sub-screen เปิดอยู่ → คลิกปุ่ม ← ใน .sub-header (หรือ closeSubScreen ถ้าไม่มี)
   → poppingOurs = false
```

กรณีสลับชั้นใน tick เดียว (เช่น กด "ทำซ้ำ" จากหน้ารายละเอียด)
```
closeOverlay('overlay-tx-detail') → pendingDelta = -1
openOverlay('overlay-add-tx')     → pendingDelta = 0
↓
microtask flush เห็น delta = 0 → ไม่เรียก history API เลย → ไม่เกิด race
```

## 4.12 Flow: หารบิล

```
More → เงินร่วมกัน → "หารบิล" → App.openSplitBillScreen()
↓
มี draft ค้างอยู่ ? → _loadDraft() → กลับไปขั้นที่ค้างไว้
↓
กด "+ บิลใหม่" → App.openSplitBillForm()
↓
[ขั้น 1] เลือกคนที่ร่วมจ่าย
   ├─ _sbTogglePerson / _sbSelectAllPeople / _sbClearAllPeople
   └─ _sbQuickAdd เพิ่มคนใหม่ระหว่างทาง
↓
[ขั้น 2] เพิ่มรายการอาหาร/สินค้า
   ├─ _sbAddItem / _sbEditItem / _sbDeleteItem
   ├─ ต่อรายการ: เลือกคนที่หาร (_sbItemTogglePerson), โหมดหาร (_sbItemSetMode), ส่วนลดรายการ (_sbItemToggleDiscount)
   └─ ทุกครั้งที่แก้ → _saveDraft() ลง localStorage
↓
[ขั้น 3] ตั้งค่าค่าบริการ / ภาษี / ส่วนลดรวม (pipeline)
   ├─ _sbPipeToggle เปิด/ปิดแต่ละขั้น
   ├─ _sbPipeBaseToggle เลือกว่าคิดจากฐานไหน
   ├─ _sbPipeMove จัดลำดับขั้น
   └─ _sbToggleRounding / _sbSetRoundingMode / _sbToggleRoundingSign ตั้งการปัดเศษ
↓
_sbUpdatePreview() คำนวณสด
   ├─ itemSubtotal → runPipeline → calcShares (allocateCents ระดับสตางค์)
   └─ calcResult → รายการโอนระหว่างคน (transfers)
↓
[ขั้น 4] บันทึกการจ่าย (_sbPayAll / _sbPayClear / _sbUpdatePayRemaining / _sbSavePayments)
↓
กด "บันทึกบิล" → App._sbSaveBill() → เก็บลง mt_split_bills → _clearDraft()
↓
เปิด App.openSplitBillDetail(billId)
↓
ทางเลือกต่อ
   ├─ "คัดลอกสรุป" → _sbCopy / _sbDetailCopyLine → clipboard (มี fallback 2 ชั้น)
   ├─ "สร้างรายการจ่าย" → App.openSplitBillLinkedTxForm(billId) → บันทึก tx แล้วผูกกลับ
   └─ "ลบบิล" → App._sbDelete(billId)
↓
เมื่อผูก tx แล้ว → App.getSharedReceivableForTx(txId) คำนวณยอดค้างรับต่อคน
   → สถานะ pending / partial / settled / over_reimbursed
   → ตรวจ link state: linked / mismatch (แสดง warning "ข้อมูลหารบิลกับรายการจ่ายยังไม่ตรงกัน")
```

## 4.13 Flow: ลบข้อมูลและ Undo

```
ผู้ใช้กดลบ (ร้านค้า / หมวดหมู่ / ชุดผ่อน / รายการ)
↓
มีการอ้างอิงอยู่หรือไม่ ?
   ├─ กระเป๋า/หมวดหมู่ที่มีรายการอ้างอิง → ไม่ลบจริง แต่ตั้ง archived = true
   │      → toast("มีรายการอ้างอิง จึง Archive ... แทนการลบ")
   └─ ไม่มี → ลบจริง
↓
บางกรณี (ชุดผ่อน, กระเป๋า) แสดง App.showConfirm(danger) ก่อน
↓
ลบออกจาก S แล้วเรียก App._withUndo(message, undoFn, commitFn)
   ├─ แสดงแถบ Undo
   ├─ ผู้ใช้กด Undo ภายในเวลาที่กำหนด → undoFn() คืนข้อมูลกลับตำแหน่งเดิม
   └─ หมดเวลา → commitFn() → persist()
```

## 4.14 Flow: เมื่อ localStorage เต็ม

```
persist() → Storage.saveAll(S) → Storage.save(key, data)
↓
localStorage.setItem โยน QuotaExceededError
↓
ยังไม่เคย retry และไม่ใช่คีย์ backup เอง ?
   ├─ ใช่ → ลบ mt_pre_import_backup + pruneLocalBackups(1) → retry 1 ครั้ง
   │      ├─ สำเร็จ → คืน true (ผู้ใช้ไม่รู้ตัว)
   │      └─ ล้มเหลว → ไปต่อ
   └─ ไม่ → ไปต่อ
↓
บันทึก lastSaveError + toast("พื้นที่จัดเก็บเต็ม กรุณาส่งออกข้อมูลก่อนเพิ่มรายการใหม่")
   (มี throttle 1200ms กัน toast ซ้ำ)
↓
saveAll คืน false → persist() toast("บันทึกไม่สำเร็จ — แนะนำสำรองข้อมูลก่อนลองใหม่")
↓
ผู้ใช้ควรไป More → ระบบ → พื้นที่จัดเก็บ → "ล้าง Backup ในเครื่องเพื่อคืนพื้นที่"
```

## 4.15 Flow: มีเวอร์ชันใหม่ (Service Worker update)

```
SW ตรวจพบไฟล์ใหม่ → updatefound → worker.state === 'installed' และมี controller อยู่
↓
showUpdateBanner(registration) แสดงแถบ "มีเวอร์ชันใหม่ พร้อมอัปเดต" + ปุ่ม "รีโหลด"
↓
ผู้ใช้กด "รีโหลด"
   ├─ ตั้ง sessionStorage['mt_sw_update_reload'] = '1'
   ├─ postMessage({type:'SKIP_WAITING'}) ให้ SW ตัวใหม่
   └─ ตั้ง timeout 1600ms — ถ้า controllerchange ไม่ยิง จะ location.reload() เอง
↓
controllerchange ยิง → ตรวจ flag → reload ครั้งเดียว (กันวน)
```

## 4.16 Flow: Timeout / Retry ที่มีจริงในระบบ

- Service Worker fetch ไฟล์โค้ดหลัก — `networkFirstWithTimeout` timeout 900ms แล้ว fallback ไป cache
- Boot screen — timeout 9,000ms บังคับซ่อน
- CSS หลัก — รอสูงสุด 24 รอบ (ประมาณ 2.2 วินาที) ก่อนยอมแสดงหน้าจอโดยไม่รอ CSS
- Notification sync — background 3,000ms, manual 10,000ms
- Auth token refresh — retry สูงสุด 3 ครั้ง (`refreshSessionWithRetry`)
- Storage bridge — รอสูงสุด 8,000ms (`STORAGE_BRIDGE_TIMEOUT_MS`)
- WebAuthn — timeout 60,000ms
- ราคาทอง — ไม่มี timeout ระบุ ใช้การไล่ fallback ทีละแหล่งแทน
- ไม่พบในโค้ด — retry อัตโนมัติสำหรับการบันทึกที่ล้มเหลว (นอกจาก quota 1 ครั้ง), circuit breaker, exponential backoff

## 4.17 Flow: Permission Denied

รายการจุดที่ขอ permission จริงในระบบ

| Permission | ขอเมื่อไร | ถ้าปฏิเสธ |
|---|---|---|
| Notification | กดเปิดแจ้งเตือน | `statusLabel()` = "ถูกบล็อก"; ไม่สมัคร push; ต้องไปแก้ที่ตั้งค่าเบราว์เซอร์ |
| Microphone (via SpeechRecognition) | กดปุ่มไมค์ใน Quick Capture | toast "กรุณาอนุญาตการเข้าถึงไมค์"; ยังพิมพ์เองได้ |
| WebAuthn / biometric | เปิด Face ID/Touch ID หรือปลดล็อกอัตโนมัติ | `NotAllowedError` → "ใช้รหัสแทนได้" แล้วกลับไปใช้ PIN |
| Web Share (ตอน export) | กด export | catch แล้ว fallback เป็น anchor download |
| Clipboard | คัดลอกโค้ดสิทธิ์ / สรุปหารบิล | `_clipCopy` ล้มเหลว → `_fallbackCopy` ใช้ `document.execCommand` แบบเก่า |

ระบบไม่มีแนวคิด "permission denied" ระดับข้อมูล เพราะไม่มี role (ดู SECTION 10)

---

# SECTION 5 — UX Analysis

## 5.1 บันทึกรายการ (F-01)

- User goal — บันทึกรายจ่ายให้เสร็จเร็วที่สุดขณะยืนอยู่หน้าเคาน์เตอร์
- User journey — แตะ FAB → กดตัวเลข → ถัดไป → เลือกหมวด → บันทึก
- จำนวนคลิกขั้นต่ำ (ทางที่ดีที่สุด) — FAB (1) + ตัวเลข 2–3 หลัก (2–3) + ถัดไป (1) + เลือกหมวด (1) + บันทึก (1) = ประมาณ 6–7 การแตะ
  โดยกระเป๋าถูกเติมให้อัตโนมัติจาก `App._getMostRecentWallet` และวันที่เป็นวันนี้อยู่แล้ว
- เส้นทางที่เร็วกว่า — Quick Capture: แตะไมค์ (1) + พูด (0 แตะ) + บันทึก (1) = 2 การแตะ ถือเป็นจุดแข็งที่ชัดเจนของแอปนี้
- Cognitive load — ขั้นที่ 1 ต่ำมาก (มีแค่ตัวเลขกับประเภท) แต่ขั้นที่ 2 สูง เพราะฟิลด์ทั้งหมดอยู่หน้าเดียวกัน
  รวมถึงตัวเลือกขั้นสูงอย่างกฎสิทธิประโยชน์ ค่าใช้จ่ายร่วม ผ่อน และรายการประจำ
- จุดที่ผู้ใช้อาจสับสน
  1. numpad ของแอปเองไม่มีปุ่ม `00` ทั้งที่คนไทยพิมพ์เลขหลักร้อย/พันบ่อย
  2. ปุ่มเครื่องคิดเลขในหน้าจำนวนเงินไม่มีคำอธิบาย ผู้ใช้อาจไม่รู้ว่ากดบวกลบได้
  3. การบันทึกซ้ำเพื่อยืนยันยอดรับคืนที่เกิน (`allowOverReimbursement`) เป็นรูปแบบที่ไม่พบในแอปทั่วไป ผู้ใช้อาจคิดว่าปุ่มค้าง
  4. ยอดที่แสดงหลังบันทึกอาจไม่ตรงกับที่กรอก ถ้ามีส่วนลดทันทีจากกฎสิทธิประโยชน์ (`amount` ถูกลดจริง)
  5. หลังบันทึกใหม่ ระบบเด้งไปหน้า "รายการ" อัตโนมัติ แต่หลังแก้ไขกลับอยู่หน้าเดิม — พฤติกรรมไม่สม่ำเสมอ
- จุดที่ควรปรับปรุง
  - เพิ่มปุ่ม `00` และ `000` ใน numpad
  - แสดงยอดสุทธิหลังส่วนลดแบบ real-time ก่อนกดบันทึก
  - เก็บ draft ของรายการเดี่ยวเหมือนที่หารบิลทำ (ตอนนี้ปิด overlay = ข้อมูลหายหมด)
  - เปลี่ยน double-tap confirm ให้เป็น dialog ยืนยันที่ชัดเจน
- จุดที่ UX ดีอยู่แล้ว
  - แยกจำนวนเงินออกเป็นขั้นแรก ทำให้เริ่มพิมพ์ได้ทันทีโดยไม่ต้องคิดเรื่องอื่น
  - กระเป๋าและหมวดหมู่เติมอัตโนมัติจากประวัติร้านค้า
  - ตรวจยอดเงิน/วงเงินไม่พอตั้งแต่ก่อนบันทึก ไม่ปล่อยให้ยอดติดลบ
  - ข้อความ error ระบุชัดว่าต้องแก้อะไร เช่น "วงเงินบัตรคงเหลือ ฿X (วงเงินร่วม) ไม่พอสำหรับ ฿Y"

## 5.2 หน้า Dashboard

- User goal — รู้ภายใน 3 วินาทีว่า "วันนี้มีอะไรต้องทำ และเงินเหลือเท่าไร"
- Cognitive load — สูง หน้านี้มีองค์ประกอบได้ถึง 11 บล็อกในกรณีเลวร้ายที่สุด
  (topbar, แถบเตือน ledger, month nav, alert รายการประจำ, แบนเนอร์สรุปเดือน, การ์ด net, checklist onboarding,
  คะแนนสุขภาพ, alert บัตร, งบประมาณ, การ์ด AI, รายการล่าสุด)
- Pain point ที่มองเห็นจากโค้ด
  - แบนเนอร์และ alert หลายชั้นอาจซ้อนกันช่วงต้นเดือน (แบนเนอร์สรุปเดือนก่อน + alert รายการประจำ + alert บัตร + insight)
  - โค้ดเองยอมรับปัญหานี้และเพิ่ม `dedupDashboardAlerts()` (บรรทัด 23903) เพื่อลบ alert รายการประจำที่ซ้ำกับรายการรอจ่าย
  - คะแนนสุขภาพการเงินเป็นตัวเลข 0–100 ที่มาจากสูตรถ่วงน้ำหนัก แต่ผู้ใช้เห็นแค่ตัวเลข ต้องแตะ `_showHealthyBreakdown` เพื่อดูที่มา
- จำนวนคลิกไปยังฟีเจอร์สำคัญ — 1 คลิก (bottom nav) สำหรับ 5 หน้าหลัก, 2–3 คลิกสำหรับฟีเจอร์ใน More
- จุดที่ควรปรับปรุง — จัดลำดับความสำคัญของ alert ให้เหลือไม่เกิน 2 บล็อกพร้อมกัน แล้วรวมที่เหลือเป็น "ดูทั้งหมด"
- จุดที่ดีอยู่แล้ว — alert รายการประจำมีปุ่ม action ในตัว (บันทึก/ข้าม) ไม่ต้องเข้าหน้าอื่น

## 5.3 หน้า More

- User goal — หาเมนูที่ต้องการ
- ปัญหาเชิงโครงสร้าง — หน้านี้มีมากกว่า 35 รายการเมนู กระจายใน 3 แท็บและ 12 หัวข้อย่อย
- ทางแก้ที่โค้ดทำแล้ว — มีช่องค้นหาฟีเจอร์ (`App._filterMoreContent`) ที่เวลาค้นจะแสดงทุกแท็บพร้อมกันและซ่อนแถบแท็บ ถือเป็นการแก้ที่ตรงจุด
- Cognitive load — สูงสำหรับผู้ใช้ใหม่ ต่ำลงมากถ้าใช้ช่องค้นหา
- จุดที่อาจสับสน
  - แท็บเริ่มต้นคือ "บัตร" ไม่ใช่ "ตั้งค่า" ซึ่งขัดกับความคาดหวังของคำว่า "เพิ่มเติม"
  - เมนู "ให้ยืมเงิน" อยู่ใต้หัวข้อ "เงินร่วมกัน" ร่วมกับ "หารบิล" ทั้งที่เป็นคนละแนวคิด
  - มีรายการที่ชื่อคล้ายกันมาก: "ภาพรวมการเงิน" / "ลองและเทียบแผน" / "ผู้ช่วยส่วนตัว" / "ถามได้เลย" — ต้องอ่าน desc ถึงจะแยกออก
- จุดที่ดี — ทุกแถวแสดงตัวเลขสรุป (เช่น "3 หมวด", "2 รอจ่าย", "5 สิทธิ์") ทำให้ผู้ใช้รู้สถานะโดยไม่ต้องเข้าไปดู

## 5.4 หารบิล (Split Bill)

- User goal — หารค่าอาหารให้แม่นยำแล้วส่งสรุปให้เพื่อน
- Journey — เลือกคน → เพิ่มรายการ → ตั้งค่าบริการ/ภาษี → บันทึกการจ่าย → คัดลอกสรุป
- จำนวนคลิก — สูงมาก สำหรับบิล 5 รายการกับ 4 คน อาจมากกว่า 40 การแตะ
- จุดแข็ง
  - auto-save draft ทำให้ปิดแอปกลางคันแล้วกลับมาต่อได้ (ไม่มีในฟลูว์อื่น)
  - `allocateCents` แบ่งเงินระดับสตางค์ให้ผลรวมตรงเป๊ะ ไม่มีเศษหาย
  - pipeline ที่จัดลำดับเองได้ ครอบคลุมกรณี "VAT คิดหลังส่วนลด" กับ "ส่วนลดหลัง VAT" ที่ร้านต่างกัน
  - มี fallback การคัดลอก 2 ชั้น รองรับเบราว์เซอร์ที่ Clipboard API ใช้ไม่ได้
- Pain point — pipeline ที่ยืดหยุ่นมากเป็นดาบสองคม ผู้ใช้ทั่วไปอาจไม่เข้าใจว่า "ฐานการคำนวณ" หมายถึงอะไร
- ข้อเสนอ — มี preset สำเร็จ 2–3 แบบ (เช่น "ร้านทั่วไป: +10% เซอร์วิส แล้ว +7% VAT")

## 5.5 สิทธิประโยชน์บัตรเครดิต

- User goal — รู้ว่ารูดบัตรใบไหนคุ้มที่สุด และได้เงินคืนครบตามสิทธิ์
- จุดแข็งที่โดดเด่นมาก — `getOptimalBenefitSelection` เลือกชุดกฎที่คุ้มที่สุดให้อัตโนมัติ ผู้ใช้ไม่ต้องคิดเอง
  และ `getSuggestedBenefitRules` ทำเครื่องหมาย `fullyUsed` เพื่อกันไม่ให้เลือกสิทธิ์ที่ใช้เต็มแล้ว
- Cognitive load — สูงมากในขั้นตอน "สร้างกฎ" ซึ่งเป็น wizard 3 ขั้น มีตัวแปรหลายสิบตัว (ประเภท เงื่อนไข ร้าน ช่องทาง เพดานต่อรายการ/ต่อรอบ ฯลฯ)
- ทางแก้ที่โค้ดทำแล้ว — มี template (`App._benefitRuleTemplate`, `_ccbrLoadTemplate`), การนำเข้าจากลิงก์ธนาคาร, และการคัดลอกกฎข้ามบัตร (`copyCCBenefitRulesToCards`)
- Pain point — ถ้า parser ของธนาคารพัง ผู้ใช้ต้องกลับไปกรอกมือทั้งหมด ซึ่งเป็นงานหนัก
- จุดที่ดี — มีหน้าแยกดูว่ากฎแต่ละข้อ track รายการอะไรไว้ (`openRuleTransactionsSheet`) และเพดานเหลือเท่าไรรายร้าน/ช่องทาง (`openBenefitCapBreakdownSheet`) ซึ่งช่วยสร้างความไว้วางใจในตัวเลข

## 5.6 App Lock

- User goal — ไม่ให้คนอื่นเห็นข้อมูลการเงินเมื่อหยิบมือถือไป
- จุดแข็ง — auto-biometric ทำงานทันทีที่แสดงหน้าล็อก ผู้ใช้แทบไม่ต้องทำอะไร; ปลดล็อกอัตโนมัติเมื่อครบ 6 หลักโดยไม่ต้องกดยืนยัน
- Pain point — PIN ขั้นต่ำ 6 หลักยาวกว่ามาตรฐาน 4 หลักที่คนคุ้นเคย; ไม่มีทางกู้คืนถ้าลืม PIN (ต้องล้างข้อมูลเบราว์เซอร์)
- ข้อสังเกตด้าน UX ที่สำคัญ — จอล็อกมีจุด 6 จุดตายตัวแม้ผู้ใช้ตั้ง PIN ยาวกว่า 6 หลัก (`keypadHtml` ใช้ `MIN_PIN_LENGTH` เสมอ) ทำให้ผู้ใช้ที่ตั้ง 8 หลักเห็นจุดไม่ครบ
- ข้อสังเกตด้านความสอดคล้อง — การปิด App Lock ใช้ `window.confirm()` ของเบราว์เซอร์ ต่างจากทุกที่ในแอปที่ใช้ `App.showConfirm` แบบ custom

## 5.7 การนำทางโดยรวม

- bottom nav 5 แท็บ เป็นรูปแบบมาตรฐาน เข้าใจง่าย มีจุดบอกแท็บที่เลือก (`.nav-btn.active::after`)
- FAB แสดงเฉพาะ 2 หน้าที่เกี่ยวข้อง (dashboard, transactions) ลด noise
- sub-screen มี 3 วิธีย้อนกลับ: ปุ่ม ←, ปัดจากขอบซ้าย (threshold 28px เริ่ม, 80px จบ, เบี่ยงแนวตั้งไม่เกิน 60px), ปุ่มย้อนกลับของระบบ
- กดค้างปุ่ม ← 1 วินาที = กลับหน้าหลักทันที (พร้อม haptic 12ms) — ฟีเจอร์ที่ดีสำหรับหน้าที่ซ้อนลึก แต่ค้นพบได้ยาก (มีแค่ tooltip)
- Pain point ใหญ่ที่สุด — sub-screen ไม่มี URL ของตัวเอง ทำให้แชร์ลิงก์หน้าใดหน้าหนึ่งไม่ได้ และรีเฟรชแล้วหลุดกลับหน้าหลัก

## 5.8 Onboarding

- จุดแข็ง — checklist 3 ขั้นสั้นและชัด, ปุ่มขั้นถัดไปถูก disable จนขั้นก่อนเสร็จ (บังคับลำดับที่ถูกต้อง), auto-dismiss สำหรับผู้ใช้เดิมโดยไม่รบกวน
- Pain point — ไม่มีการอธิบายว่าฟีเจอร์ขั้นสูง (สิทธิประโยชน์ หารบิล BNPL) มีอยู่และทำอะไรได้ ผู้ใช้ต้องค้นพบเอง
- ข้อเสนอ — เพิ่ม tooltip แนะนำครั้งเดียวสำหรับฟีเจอร์เด่น 3 อย่างหลังจากบันทึกรายการครบ 10 รายการ

## 5.9 สรุปจุดที่ UX แข็งแรงอยู่แล้ว

1. Quick Capture ด้วยเสียงภาษาไทย พร้อม parser ที่จับกระเป๋า/ร้าน/หมวด/วันที่ได้ในประโยคเดียว
2. การเลือกสิทธิประโยชน์ที่คุ้มที่สุดให้อัตโนมัติ
3. ระบบ ledger ที่คำนวณยอดใหม่เสมอ ทำให้ข้อมูลไม่มีทาง drift แบบถาวร พร้อมเครื่องมือตรวจ/ซ่อมให้ผู้ใช้เอง
4. การรองรับปุ่มย้อนกลับของระบบอย่างถูกต้องทุกชั้น รวมถึงกรณีสลับชั้นใน tick เดียว
5. การจัดการ localStorage เต็มแบบมีชั้นเชิง (retry เงียบ → แจ้งเตือน → หน้าวิเคราะห์ → ปุ่มคืนพื้นที่)
6. ข้อความ error ทุกจุดเป็นภาษาไทยที่บอกวิธีแก้ ไม่ใช่รหัสข้อผิดพลาด

## 5.10 สรุปจุดที่ควรปรับปรุงมากที่สุด (เชิง UX)

1. ไม่มี draft สำหรับฟอร์มบันทึกรายการ — ปิดพลาดครั้งเดียวข้อมูลหายหมด
2. หน้า Dashboard แน่นเกินไปในบางช่วงเวลาของเดือน
3. sub-screen ไม่มี route จริง แชร์และรีเฟรชไม่ได้
4. เมนูใน More เยอะเกินไปและชื่อคล้ายกันหลายรายการ
5. พฤติกรรมหลังบันทึกไม่สม่ำเสมอ (เพิ่มใหม่เด้งไปหน้ารายการ แต่แก้ไขอยู่ที่เดิม)
6. จุด PIN บนจอล็อกไม่สะท้อนความยาวจริงของ PIN

---

# SECTION 6 — UI Analysis

## 6.1 ระบบดีไซน์ที่ใช้อยู่

`docs/UI_DESIGN_SPEC.md` เป็นเอกสารควบคุมด้าน UI ตามที่ระบุใน `CLAUDE.md` โดยกำหนด
- ทิศทางการออกแบบ "Calm Banking + AI Bento"
- design token ผูกกับ `:root` ใน `style_v2.css`
- component library ร่วม: `.bento-card`, `.list-card`, `.ai-bar`, `.seg-pill` และอื่น ๆ
- กติกา: ใช้เฉพาะ token/component จากสเปก ห้ามเพิ่มสีใหม่หรือ hardcode hex, ทุกการเปลี่ยนแปลงต้องผ่านทั้งโหมดสว่างและมืด, redesign ทีละหน้าจอต่อหนึ่ง PR
- `docs/UI_REDESIGN_PLAN.md` เป็นแผน rollout ทีละหน้าจอ

สถานะจริงในโค้ด — แอปอยู่ระหว่างการ redesign จึงมีสองระบบซ้อนกัน
- ระบบเดิม: `style_v2.css` (10,525 บรรทัด) พร้อมคลาสเฉพาะกิจจำนวนมาก และ inline style จำนวนมหาศาลใน template string
- ระบบใหม่: `ui_v2.css` (1,112 บรรทัด) เปิดใช้ด้วยคลาส `ui-v2` บน `<html>` ควบคุมด้วย `S.settings.uiV2` หรือ query `?uiv2=1`

## 6.2 Layout

- Layout หลักเป็น mobile-first เต็มจอเดียว ไม่มี sidebar ไม่มี multi-column
- โครงหน้า: `.page > .page-header (sticky) + .page-scroll` โดย `#page-dashboard` ไม่มี header แยก (renderer สร้างเอง)
- ความสูงจอถูกควบคุมด้วย CSS variable `--app-height` ที่คำนวณใหม่เมื่อคีย์บอร์ดเปิด/ปิด (`reassertStableAppHeight`)
  โดยในโหมด standalone ใช้ `max(innerHeight, screen.height)` เพื่อกันจอกระตุกบน iOS
- safe area รองรับด้วย `viewport-fit=cover` + `env(safe-area-inset-*)`
- overlay ใช้รูปแบบ bottom sheet (`.sheet` มี `.sheet-handle`) ซึ่งเป็นมาตรฐานของแอปมือถือ
- `#overlay-add-tx .sheet` ตั้ง `max-height:98dvh` ส่วน overlay รายการที่ track ไว้ใช้ `92dvh` และ quick capture ใช้ `90dvh`

## 6.3 Component Hierarchy

```
#app
├── #toast-container            (role="status" aria-live="polite")
├── .page × 5
│   ├── .page-header            (sticky; chips / search / summary)
│   └── .page-scroll            (เนื้อหาที่ render ด้วย innerHTML)
├── #bottom-nav                 (.nav-btn × 5, มี data-tab)
├── #fab                        (+ ปุ่มไมค์ #fab-mic ที่ inject ข้าง ๆ)
├── .overlay × 6 (ประกาศไว้ล่วงหน้า) + overlay ที่ inject ตอน runtime
│   └── .overlay-backdrop + .sheet > .sheet-handle + .sheet-header + .sheet-body
└── #sub-screen                 (คอนเทนเนอร์เดียวสำหรับ sub-screen ทุกหน้า)
    └── .sub-header (btn-icon ← + h2 + ปุ่มขวา) + .sub-scroll
```

Component ที่ใช้ซ้ำบ่อยที่สุด (ดูรายละเอียดใน SECTION 12)
`.card` / `.card-pad`, `.settings-row` (+ `.s-icon` `.s-label` `.s-value` `.s-arrow`), `.sec-title`,
`.form-group` + `.form-label` + `.form-input` + `.form-hint`, `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-outline` / `.btn-sm`,
`.btn-icon`, `.icon-btn`, `.chip`, `.toggle`, `.segmented-tabs` + `.segmented-tab`, `.search-field-wrap` + `.search-input` + `.search-clear-btn`,
`.list-item-icon` / `.list-item-info` / `.list-item-name` / `.list-item-sub`, `.color-row` + `.color-dot`,
`.wallet-card` + `.wc-header` `.wc-name` `.wc-type` `.wc-balance` `.wc-limit` `.wc-prog-bar` `.wc-prog-fill` `.cc-due-strip`,
`.cc-hero`, `.tx-date-header`, `.tx-group-card`, `.compact-card-list`, `.installment-compact-row`, `.amount-summary-card`

## 6.4 Visual Grouping

- ใช้การ์ด (`.card`) เป็นหน่วยจัดกลุ่มหลัก และ `.sec-title` เป็นหัวข้อเหนือการ์ด
- หน้า More ใช้รูปแบบ "หัวข้อ + การ์ดที่รวมหลาย `.settings-row`" ซึ่งเป็นรูปแบบเดียวกับ iOS Settings ทำให้คุ้นเคยทันที
- รายการธุรกรรมจัดกลุ่มตามวันที่ พร้อมยอดรวมของวันนั้นในหัวกลุ่ม — ช่วยให้สแกนได้เร็ว
- การ์ดกระเป๋าใช้สีพื้นหลังไล่เฉด (`linear-gradient(135deg, var(--wallet-color), var(--wallet-color-2))`) แยกแต่ละใบด้วยสี

## 6.5 Information Hierarchy

- ตัวเลขเงินคือ element ที่เด่นที่สุดเสมอ เช่น `font-size:40px;font-weight:800` ในหน้าชำระบัตร, `font-size:38px;font-weight:800` ในหน้า preview quick capture
- ใช้สีสื่อความหมายสม่ำเสมอ: `var(--income)` เขียวสำหรับรายรับ/เงินคืน, `var(--expense)` แดงสำหรับรายจ่าย/หนี้/อันตราย, `var(--muted)` สำหรับข้อความรอง
- ป้ายกำกับใช้ขนาดเล็ก (11–13px) และสี muted เพื่อไม่แย่งความสนใจจากตัวเลข
- ปุ่มหลักหนึ่งปุ่มต่อหนึ่งหน้าจอ (`.btn-primary`) ที่เหลือเป็น secondary หรือ outline

## 6.6 Consistency — จุดที่สม่ำเสมอ

- ทุก sub-screen ใช้ `.sub-header` โครงเดียวกัน ปุ่มย้อนกลับอยู่ซ้ายเสมอ
- ทุก overlay ใช้ `.sheet` โครงเดียวกัน มี handle ด้านบนเสมอ
- ทุกฟอร์มใช้ `.form-group` + `.form-label` + `.form-input`
- ทุก error ที่ผูกกับฟิลด์ใช้ `App._showFieldError(id, message)`
- ทุก toast ใช้ `toast(msg, type)` ที่มี dedup ในตัว (กันข้อความซ้ำภายใน 1200ms และกันข้อความที่ยังแสดงอยู่)
- ทุก empty state ใช้ `App._emptyState(icon, title, subtitle)`
- ทุกการยืนยันที่อันตรายใช้ `App.showConfirm({title, body, danger, confirmLabel, onConfirm})`

## 6.7 Consistency — จุดที่ไม่สม่ำเสมอ (พบจากโค้ดจริง)

1. inline style ปะปนกับคลาสอย่างหนัก — template string จำนวนมากมี `style="..."` ยาวหลายสิบอักขระ ซึ่งขัดกับกติกาใน `UI_DESIGN_SPEC.md`
   ตัวอย่าง: `loans_v2.js` และ `bnpl.js` เขียน inline style เกือบทั้งหมด ไม่ได้ใช้ token
2. hardcode สีนอก token — `bnpl.js` ใช้ `#6c48c5`, `#22c55e`, `#ef4444`, `#FCA5A5`, `rgba(252,165,165,.95)`;
   `loans_v2.js` ใช้ `#D97706`; `onboarding.js` ใช้ `rgba(217,119,6,.1)` — ขัดกับกติกา "ห้ามใช้ hex ใหม่"
3. ปุ่มปิดใน sheet ไม่เหมือนกัน — `index.html` ใช้ `.btn-icon`, แต่ `bnpl.js` ใช้ `.sheet-close`
4. `window.confirm()` ถูกใช้ที่เดียวใน `app_lock.js` บรรทัด 512 ขณะที่ทุกที่ใช้ `App.showConfirm`
5. ฟังก์ชัน escape HTML ถูกนิยามซ้ำอย่างน้อย 6 ที่ ด้วยชุดอักขระที่ไม่เหมือนกัน
   - `App._esc` และ `quick_capture.js` — escape 5 ตัว (`& < > ' "`)
   - `bnpl.js`, `loans_v2.js`, `onboarding.js`, `split_bill.js` — escape 4 ตัว ไม่รวม `'`
   ซึ่งมีผลด้านความปลอดภัยจริงในบริบท attribute ที่ใช้ single quote (ดู SECTION 15)
6. รูปแบบวันที่ — มีฟังก์ชันจัดรูปแบบวันที่อย่างน้อย 4 ชุด (`Calc.labelDate`, `Calc.shortDate`, `fmtDate` ใน bnpl.js, `fmtDate` ใน loans_v2.js) ที่ให้ผลคล้ายกันแต่คนละโค้ด

## 6.8 Responsive

- ออกแบบสำหรับมือถือแนวตั้งเป็นหลัก (`manifest.json` ล็อก `"orientation": "portrait"`)
- มี zoom lock แบบแข็ง (บล็อก "V6.2 Hard mobile zoom lock" บรรทัด 10–81) ซึ่งกันการ pinch-zoom — มีผลด้าน accessibility (ดู SECTION 15)
- ไม่พบ breakpoint สำหรับ tablet/desktop ในโครงหลัก — `.codex-ui-audit/desktop-dashboard.png` แสดงว่ามีการตรวจบน desktop แต่ไม่พบ media query เฉพาะ desktop ในโครงหน้าหลัก
- ใช้ `dvh` แทน `vh` ในความสูง sheet เพื่อรองรับแถบ URL ที่ยืดหดบนมือถือ
- ฟอนต์ใช้ `clamp()` ในบางที่ (เช่น `privacy.html` `h1 { font-size: clamp(22px, 5vw, 30px) }`)

## 6.9 Accessibility

สิ่งที่ทำแล้ว
- `#toast-container` มี `role="status" aria-live="polite" aria-atomic="false"` — screen reader อ่าน toast ได้
- overlay ทุกตัวมี `role="dialog"`, `aria-modal="true"`, และ `aria-label` หรือ `aria-labelledby`
- ปุ่มไอคอนมี `aria-label` เช่น `aria-label="ปิด"`, `aria-label="เพิ่มรายการ"`, `aria-label="ล้างการค้นหา"`
- toggle มี `aria-pressed` (เช่น ปุ่มโหมดมืด, ปุ่มส่วนลดในหน้าชำระบัตร)
- FAB ตั้ง `aria-hidden` และ `tabIndex = -1` เมื่อถูกซ่อน (`App._syncPageChrome`) — ป้องกันการ focus ปุ่มที่มองไม่เห็น
- `.overlay-backdrop` ตั้ง `aria-hidden="true"`
- ปุ่มย้อนกลับใน sub-screen ตั้ง `aria-label="ย้อนกลับ กดค้างเพื่อกลับหน้าหลัก"` และ `title` อธิบายการกดค้าง
- มีเทสต์ static ตรวจขนาดพื้นที่แตะ (`tests/touch_target_size_static.test.js`)
- `<html lang="th">` ถูกต้อง

สิ่งที่ยังขาด
- zoom lock ขัดกับ WCAG 1.4.4 (Resize Text) — ผู้ใช้สายตาเลือนรางขยายจอไม่ได้
- ไม่พบ focus trap ใน overlay — กด Tab อาจหลุดไปยัง element ด้านหลัง
- ไม่พบการคืน focus กลับ element ต้นทางเมื่อปิด overlay
- ไม่พบ `prefers-reduced-motion` ในโค้ดหลัก ขณะที่แอปมี animation suite ขนาดใหญ่ 2 บล็อก (บรรทัด 21575 และ 22652)
- สีสถานะพึ่งพาสีล้วนในหลายจุด (เขียว/แดง) โดยไม่มีไอคอนกำกับเสมอ
- ไม่พบการทดสอบ contrast ratio ในเทสต์
- emoji ถูกใช้เป็นไอคอนความหมายจำนวนมากโดยไม่มีข้อความทางเลือกกำกับ

## 6.10 Spacing

- ระยะที่พบบ่อย: 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48 px — สอดคล้องกับสเกล 4px แต่ไม่เคร่งครัด
- padding ของ `.sub-scroll` ที่พบบ่อยคือ `12px 16px 40px` หรือ `16px 16px 48px` (ระยะล่างเผื่อ FAB และ safe area)
- มีเทสต์เฉพาะสำหรับระยะปลอดภัยของ FAB (`tests/fab_scroll_clearance_static.test.js`)

## 6.11 Typography

- ฟอนต์หลัก LINE Seed Sans TH 3 น้ำหนัก (Regular 400, Bold, ExtraBold 800) โหลด self-host พร้อม `font-display: swap` และ `local()` fallback
- สเกลที่ใช้จริง: 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 28, 38, 40 px
- น้ำหนัก: 400 (เนื้อความ), 600 (หัวข้อย่อย), 700 (หัวข้อ), 800 (ตัวเลขเงินและหัวข้อสำคัญ)
- มีเทสต์เฉพาะสำหรับปัญหาตัวอักษรไทยถูกตัด (`tests/thai_text_clipping_static.test.js`) และมีแผนแก้ที่ `docs/superpowers/plans/2026-06-08-thai-transaction-title-clipping.md`
  — สะท้อนว่าเคยมีปัญหา line-height กับสระ/วรรณยุกต์ไทย

## 6.12 Color Usage

- ควบคุมผ่าน CSS custom properties: `--primary` (ผู้ใช้เลือกได้ 8 สี), `--income`, `--expense`, `--muted`, `--text`, `--border`, `--card`, `--surface-soft`, `--radius`
- โหมดมืดใช้คลาส `dark` บน `<html>` ไม่ใช่ media query ล้วน (แต่ inline style ตอนบูตใช้ `prefers-color-scheme`)
- `<meta name="theme-color">` เปลี่ยนตามโหมด (`#0F172A` มืด / `#1E293B` สว่าง)
- สีการ์ดกระเป๋าต้องส่งผ่าน `--wallet-color` / `--wallet-color-2` เท่านั้น เพราะ `.wallet-card-colored` ใช้ `!important`
- ปัญหา — hardcode hex กระจายอยู่ในโมดูลบริวารและ inline style ตามที่ระบุใน 6.7

## 6.13 Feedback

- Toast — 4 ประเภท (`info`, `success`, `warn`, `error`) แสดง 3 วินาที แตะเพื่อปิดได้ มี dedup 2 ชั้น
- Field error — `App._showFieldError(id, message)` แสดงข้อความติดกับฟิลด์ที่ผิด
- Confirm dialog — `App.showConfirm` รองรับโหมด danger
- Haptic — `navigator.vibrate(12)` เมื่อกดค้างปุ่มย้อนกลับ, `vibrate(20)` เมื่อเข้าโหมดล้างแคช
- Progress bar — งบประมาณ, วงเงินบัตร, ความคืบหน้าแผน BNPL, ความคืบหน้าการคืนเงินกู้, checklist onboarding
- สถานะออฟไลน์ — จุดสีข้าง ๆ ชื่อแอป (`#mt-offline-dot`) + toast เมื่อสถานะเปลี่ยน
- Undo bar — `App._withUndo`
- ไม่มี skeleton loading — ถูกถอดออกโดยเจตนา (commit `90fa8b6 Remove boot-time skeleton loading screen` และเทสต์ `tests/boot_skeleton_static.test.js`)

## 6.14 Animation

- มี animation suite 2 บล็อกใหญ่ใน `app_v2.js`
  - "MT Animation Suite · Priority 1 – 4 + WOW W1 – W15" (บรรทัด 21575)
  - "MT Animation Suite · Wave 2 (A1–A8 + B1–B26)" (บรรทัด 22652)
- animation ที่ระบุได้ชัดจากโค้ด
  - sub-screen slide (ปิดได้ด้วยคลาส `no-page-slide` และ opts `{animate:false}`)
  - overlay unlock/lock transition ของ App Lock (`locking` 280ms, `unlocking` 260ms, `unlocked` 360ms)
  - boot screen fade out 240ms
  - waveform ของไมค์ (`qc-wave` 0.75s infinite) และจุดบันทึก (`qc-dot-pulse` 1s infinite)
  - progress bar transition 0.3–0.4s
- `App.replaceSubScreen` และ `App._suppressNextSubScreenAnimationUntil` ใช้กันการเด้งซ้ำเมื่อเปลี่ยนหน้าเร็ว ๆ
- ข้อสังเกต — ไม่พบการเคารพ `prefers-reduced-motion`

## 6.15 Interaction

- Tap — มาตรฐาน
- Long press — ปุ่มย้อนกลับใน sub-screen (1000ms, ยกเลิกถ้าขยับเกิน 12px)
- Swipe — ปัดจากขอบซ้ายเพื่อย้อนกลับ (sub-screen); ปัดเปลี่ยนรอบบิลในหน้า CC detail (`App._bindCCCycleSwipe`)
- Drag and drop — จัดเรียงกระเป๋า (`_walletDragStart` / `_walletDragMove` / `_walletDragEnd`)
- Multi-tap easter egg — แตะแท็บ "เพิ่มเติม" 3 ครั้งใน 2.5 วินาที = ล้างแคชแอป; แตะเลขเวอร์ชัน 5 ครั้งใน 3 วินาที = เข้าโหมด demo
- Number input — แปลง `type="number"` เป็น `type="text"` + `inputmode="decimal"` อัตโนมัติ แล้วใส่คอมมาให้เมื่อ blur และถอดคอมมาเมื่อ focus
  (`formatNumberInputsIn`, `stripFormattedNumberInputs`) พร้อม MutationObserver ที่จับ input ที่เพิ่งถูกเพิ่มเข้า DOM
- Keyboard handling — ติดคลาส `keyboard-open` บน body เมื่อ focus ที่ input หรือเมื่อ `visualViewport` หดลงเกิน 120px เพื่อซ่อน nav/FAB
- iOS bfcache — ล้างคลาส `keyboard-open` ที่ค้างเมื่อ `pageshow` และเมื่อกลับมาที่แอป
