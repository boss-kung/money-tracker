# Credit Card Billing UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แก้ UX เตือนจ่ายบัตรเครดิตให้เตือนเฉพาะยอด statement ที่ถึงกำหนดจ่ายจริง และเพิ่มการเลื่อนดูรอบเก่าในหน้าเครดิตการ์ดแต่ละใบสำหรับสรุปรอบบัตรเครดิตและสิทธิประโยชน์รอบนั้น

**Architecture:** แยกตรรกะรอบบิลเป็น pure helper ใน `credit_card_cycles.js` เพื่อให้ dashboard, upcoming items, notification snapshot, และหน้า credit card detail ใช้ source of truth เดียวกัน. หน้า detail จะเก็บ `S.ccDetailCycleOffsets[cardId]` เป็น offset รอบบิล แล้ว render section รอบบิล/สิทธิประโยชน์ใหม่ตาม offset พร้อมปุ่มซ้ายขวาและ horizontal snap บนมือถือ.

**Tech Stack:** Vanilla JavaScript, existing `App` global state, Node `node:test`, existing localStorage persistence via `storage_v2.js`, Supabase Edge Function notification pipeline.

---

## UX Situations To Cover

- วันนี้ยังไม่ปิดรอบบิล: ไม่เตือนจ่ายยอดของรอบกำลังใช้ แม้มียอด `card.balance` แล้ว ให้แสดงเป็น “รอบกำลังสะสม” ในหน้าบัตรและไม่เข้า `credit_due`.
- ปิดรอบบิลแล้วและมียอดค้าง: เตือนเมื่อ `statement.dueDate - today` ตรงกับ rule เช่น 3 วัน, 1 วัน, วันนี้, หรือเลยกำหนด เฉพาะ statement ที่ `balanceDue > 0`.
- ผู้ใช้จ่ายเต็มยอดแล้ว: ไม่เตือนอีก แม้ `card.balance` ยังติดลบจากยอดรอบใหม่.
- ผู้ใช้จ่ายบางส่วน: เตือนเฉพาะยอดคงเหลือของ statement เดิม.
- มีหลาย statement ค้างพร้อมกัน: เตือน statement ที่ due ใกล้สุดก่อน และ snapshot เก็บได้หลายรายการต่อบัตรโดยมี `statementId`.
- จ่ายช้าหลัง due date: dashboard/upcoming ยังแสดง overdue จนกว่า statement นั้นจะถูกจ่ายครบ.
- จ่ายรายการแบบไม่มี `statementId`: ระบบยังจับ payment ที่อยู่หลังวันตัดรอบถึงวันครบกำหนดของ statement นั้นได้ตาม logic เดิม.
- fixed due day vs after-cycle mode: due date ต้องมาจาก `resolveCardDueDate` เดิมผ่าน `App.getCardStatement`, ไม่ fallback ไปวันของรอบถัดไปจนทำให้เตือนผิดเดือน.
- ซ่อนจำนวนเงินใน notification: `amount` ใน snapshot เป็น `null` แต่ยังใช้ `amountDue > 0` ภายใน client ก่อนสร้าง snapshot.
- ไม่มีรอบบิลหรือ card setting ไม่ครบ: ไม่ส่ง notification; หน้า detail แสดง empty state เฉพาะ section statement.
- ดูรอบเก่า: ปัด/กดซ้ายขวาเพื่อดู current closed statement, รอบก่อนหน้า, และย้อนหลายรอบได้; ปุ่มขวากลับมารอบใหม่กว่าและ disabled เมื่ออยู่รอบล่าสุด.
- สิทธิประโยชน์รอบนี้: คำนวณตามรอบที่เลือกเดียวกับ statement card; ปุ่มบันทึก reward ทำงานเฉพาะรอบที่เป็น closed statement และมี `statementId`.

## File Structure

- Create: `credit_card_cycles.js`
  - Pure helpers สำหรับ date math, statement history, payable statement selection, และ notification snapshot rows.
- Create: `tests/credit_card_cycles.test.js`
  - Unit tests สำหรับทุก situation หลักโดยไม่ต้อง boot UI.
- Modify: `app_v2.js`
  - Replace `App.getCreditCardDueInfo`, `App.getCardStatement`, dashboard credit alert, `App.getUpcomingItems`, และ `App.openCCDetail` ให้ใช้ helper.
  - Add render helpers สำหรับ cycle pager, statement panel, benefit panel.
- Modify: `notifications_v2.js`
  - Build `creditDue` จาก payable statement rows แทน `card.balance`.
- Modify: `style_v2.css`
  - Add responsive styles สำหรับ cycle pager, snap scroller, disabled nav, compact statement state.
- Modify: `index.html`
  - Add `<script src="credit_card_cycles.js?...">` before `app_v2.js`.
- Modify: `sample-data_v2.js`
  - Add sample transactions ที่แยกรอบก่อนหน้า/รอบปัจจุบัน เพื่อ manual QA.
- No Supabase schema migration needed: `mt_notification_snapshots.credit_due` stores JSON arrays already.

---

### Task 1: Add Pure Credit Card Cycle Helper

**Files:**
- Create: `credit_card_cycles.js`
- Test: `tests/credit_card_cycles.test.js`

- [ ] **Step 1: Write failing tests for payable statements**

Create `tests/credit_card_cycles.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const CC = require('../credit_card_cycles.js')

const card = {
  id: 'ktc',
  name: 'KTC Cashback',
  type: 'credit',
  cycleDay: 25,
  dueAfterCycleDays: 10,
  dueDateMode: 'afterCycle',
}

test('current open cycle spending is not payable before cycle closes', () => {
  const txs = [
    { id:'t1', type:'expense', walletId:'ktc', amount:1000, date:'2026-06-01' },
  ]
  const rows = CC.getPayableStatements({ card, transactions:txs, refDate:'2026-06-03' })
  assert.equal(rows.length, 0)
})

test('closed unpaid statement is payable and current cycle balance does not change due date', () => {
  const txs = [
    { id:'old', type:'expense', walletId:'ktc', amount:5000, date:'2026-05-10' },
    { id:'new', type:'expense', walletId:'ktc', amount:9000, date:'2026-06-01' },
  ]
  const rows = CC.getPayableStatements({ card, transactions:txs, refDate:'2026-06-03' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].start, '2026-04-26')
  assert.equal(rows[0].end, '2026-05-25')
  assert.equal(rows[0].dueDate, '2026-06-04')
  assert.equal(rows[0].balanceDue, 5000)
})

test('fully paid statement is not payable even when newer cycle has spending', () => {
  const stId = 'ktc:2026-04-26:2026-05-25'
  const txs = [
    { id:'old', type:'expense', walletId:'ktc', amount:5000, date:'2026-05-10' },
    { id:'pay', type:'cc_payment', toWalletId:'ktc', amount:5000, date:'2026-05-30', statementId:stId },
    { id:'new', type:'expense', walletId:'ktc', amount:9000, date:'2026-06-01' },
  ]
  const rows = CC.getPayableStatements({ card, transactions:txs, refDate:'2026-06-03' })
  assert.equal(rows.length, 0)
})

test('partial payment leaves only remaining balance payable', () => {
  const stId = 'ktc:2026-04-26:2026-05-25'
  const txs = [
    { id:'old', type:'expense', walletId:'ktc', amount:5000, date:'2026-05-10' },
    { id:'pay', type:'cc_payment', toWalletId:'ktc', amount:2000, date:'2026-05-30', statementId:stId },
  ]
  const rows = CC.getPayableStatements({ card, transactions:txs, refDate:'2026-06-03' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].balanceDue, 3000)
})

test('notification rows include statement id and honor hidden amount', () => {
  const txs = [
    { id:'old', type:'expense', walletId:'ktc', amount:5000, date:'2026-05-10' },
  ]
  const visible = CC.getCreditDueNotificationRows({ cards:[card], transactions:txs, refDate:'2026-06-03', hideAmounts:false })
  const hidden = CC.getCreditDueNotificationRows({ cards:[card], transactions:txs, refDate:'2026-06-03', hideAmounts:true })
  assert.equal(visible[0].statementId, 'ktc:2026-04-26:2026-05-25')
  assert.equal(visible[0].amount, 5000)
  assert.equal(hidden[0].amount, null)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test tests/credit_card_cycles.test.js
```

Expected: FAIL with `Cannot find module '../credit_card_cycles.js'`.

- [ ] **Step 3: Implement `credit_card_cycles.js`**

Create `credit_card_cycles.js`:

```js
;(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory()
  else root.CreditCardCycles = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const DAY_MS = 86400000

  function pad2(n) { return String(n).padStart(2, '0') }
  function parseDate(dateStr) {
    const [y, m, d] = String(dateStr || '').slice(0, 10).split('-').map(Number)
    if (!y || !m || !d) return null
    return new Date(y, m - 1, d)
  }
  function dateStr(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  }
  function clampDay(year, monthIndex, day) {
    return Math.min(Math.max(1, Number(day || 1)), new Date(year, monthIndex + 1, 0).getDate())
  }
  function addDays(value, days) {
    const d = parseDate(value)
    if (!d) return ''
    d.setDate(d.getDate() + Number(days || 0))
    return dateStr(d)
  }
  function daysBetween(dateIso, refIso) {
    const date = parseDate(dateIso)
    const ref = parseDate(refIso)
    if (!date || !ref) return 0
    return Math.round((date - ref) / DAY_MS)
  }
  function clampCycleDay(day) { return Math.min(31, Math.max(1, Number(day || 25))) }
  function clampDueAfter(days) { return Math.min(60, Math.max(1, Number(days || 10))) }
  function statementId(cardId, start, end) { return `${cardId}:${start}:${end}` }

  function getStatementPeriod(card, refDate) {
    const ref = parseDate(refDate)
    if (!card || !ref) return null
    const cycleDay = clampCycleDay(card.cycleDay || 25)
    const ry = ref.getFullYear()
    const rm = ref.getMonth()
    const rd = ref.getDate()
    let end = new Date(ry, rm, clampDay(ry, rm, cycleDay))
    if (rd <= cycleDay) {
      const prev = new Date(ry, rm - 1, 1)
      end = new Date(prev.getFullYear(), prev.getMonth(), clampDay(prev.getFullYear(), prev.getMonth(), cycleDay))
    }
    const prevOfEnd = new Date(end.getFullYear(), end.getMonth() - 1, 1)
    const prevEndD = clampDay(prevOfEnd.getFullYear(), prevOfEnd.getMonth(), cycleDay)
    const start = new Date(prevOfEnd.getFullYear(), prevOfEnd.getMonth(), prevEndD + 1)
    return { start: dateStr(start), end: dateStr(end) }
  }

  function resolveDueDate(card, statementEnd, refDate) {
    if (!statementEnd) return ''
    if (String(card?.dueDateMode || 'afterCycle') === 'fixedDay' && Number(card?.dueDay || 0) > 0) {
      const end = parseDate(statementEnd)
      if (!end) return ''
      let due = new Date(end.getFullYear(), end.getMonth(), clampDay(end.getFullYear(), end.getMonth(), Number(card.dueDay)))
      if (dateStr(due) <= statementEnd) {
        const next = new Date(end.getFullYear(), end.getMonth() + 1, 1)
        due = new Date(next.getFullYear(), next.getMonth(), clampDay(next.getFullYear(), next.getMonth(), Number(card.dueDay)))
      }
      return dateStr(due)
    }
    return addDays(statementEnd, clampDueAfter(card?.dueAfterCycleDays || 10))
  }

  function getCardStatement({ card, transactions = [], refDate, rewardForTx, amountForTx, isPostedTx }) {
    const period = getStatementPeriod(card, refDate)
    if (!period || !card?.id) return null
    const dueDate = resolveDueDate(card, period.end, refDate)
    const id = statementId(card.id, period.start, period.end)
    const purchases = transactions.filter(t =>
      t && t.type === 'expense' &&
      String(t.walletId || '') === String(card.id) &&
      String(t.date || '') >= period.start &&
      String(t.date || '') <= period.end &&
      (typeof isPostedTx === 'function' ? isPostedTx(t) : t.scheduled !== true)
    )
    const payments = transactions.filter(t => {
      if (!t || t.type !== 'cc_payment' || String(t.toWalletId || '') !== String(card.id)) return false
      if (String(t.statementId || '') === id) return true
      const txDate = String(t.date || '')
      return txDate > period.end && txDate <= dueDate
    })
    const purchaseTotal = Math.round(purchases.reduce((sum, tx) => sum + Number(typeof amountForTx === 'function' ? amountForTx(tx) : tx.amount || 0), 0) * 100) / 100
    const paidTotal = Math.round(payments.reduce((sum, tx) => sum + Number(tx.amount || 0), 0) * 100) / 100
    const balanceDue = Math.max(0, Math.round((purchaseTotal - paidTotal) * 100) / 100)
    const reward = purchases.reduce((sum, tx) => {
      const est = typeof rewardForTx === 'function' ? rewardForTx(tx) : { points:0, cashback:0, discount:0 }
      sum.points += Number(est.points || 0)
      sum.cashback += Number(est.cashback || 0)
      sum.discount += Number(est.discount || 0)
      return sum
    }, { points:0, cashback:0, discount:0 })
    reward.points = Math.floor(reward.points)
    reward.cashback = Math.round(reward.cashback * 100) / 100
    reward.discount = Math.round(reward.discount * 100) / 100
    return { id, cardId:card.id, start:period.start, end:period.end, dueDate, dueAfterCycleDays:clampDueAfter(card.dueAfterCycleDays || 10), purchases, payments, purchaseTotal, paidTotal, balanceDue, paid:balanceDue <= 0 && purchaseTotal > 0, reward }
  }

  function shiftStatementRef(statement, deltaCycles) {
    return addDays(deltaCycles < 0 ? statement.start : statement.end, deltaCycles < 0 ? -1 : 1)
  }

  function getStatementHistory({ card, transactions = [], refDate, count = 6, rewardForTx, amountForTx, isPostedTx }) {
    const rows = []
    let cursor = refDate
    const seen = new Set()
    for (let i = 0; i < count; i++) {
      const st = getCardStatement({ card, transactions, refDate:cursor, rewardForTx, amountForTx, isPostedTx })
      if (!st || seen.has(st.id)) break
      rows.push(st)
      seen.add(st.id)
      cursor = shiftStatementRef(st, -1)
      if (!cursor) break
    }
    return rows
  }

  function getPayableStatements({ card, transactions = [], refDate, lookback = 6, rewardForTx, amountForTx, isPostedTx, includeOverdue = true }) {
    return getStatementHistory({ card, transactions, refDate, count:lookback, rewardForTx, amountForTx, isPostedTx })
      .filter(st => Number(st.balanceDue || 0) > 0)
      .filter(st => includeOverdue || String(st.dueDate || '') >= String(refDate || ''))
      .map(st => ({ ...st, daysLeft:daysBetween(st.dueDate, refDate) }))
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
  }

  function getNextPayableDueInfo({ card, transactions = [], refDate, rewardForTx, amountForTx, isPostedTx }) {
    const st = getPayableStatements({ card, transactions, refDate, rewardForTx, amountForTx, isPostedTx })[0]
    if (!st) return null
    return { daysLeft:st.daysLeft, dueStr:st.dueDate, dateStr:st.dueDate, statementId:st.id, amount:st.balanceDue, statement:st }
  }

  function getCreditDueNotificationRows({ cards = [], transactions = [], refDate, hideAmounts = false, maxDays = 7, rewardForTx, amountForTx, isPostedTx }) {
    return cards.flatMap(card =>
      getPayableStatements({ card, transactions, refDate, rewardForTx, amountForTx, isPostedTx })
        .filter(st => Number(st.daysLeft) <= Number(maxDays))
        .map(st => ({
          id: card.id,
          statementId: st.id,
          title: card.name,
          dueDate: st.dueDate,
          daysLeft: st.daysLeft,
          amount: hideAmounts ? null : st.balanceDue,
          amountDue: st.balanceDue,
          cycleStart: st.start,
          cycleEnd: st.end,
        }))
    ).slice(0, 25)
  }

  return {
    addDays,
    daysBetween,
    getStatementPeriod,
    getCardStatement,
    getStatementHistory,
    getPayableStatements,
    getNextPayableDueInfo,
    getCreditDueNotificationRows,
  }
})
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
node --test tests/credit_card_cycles.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add credit_card_cycles.js tests/credit_card_cycles.test.js
git commit -m "feat: add credit card cycle helper"
```

---

### Task 2: Wire App Statement/Due Logic To Helper

**Files:**
- Modify: `index.html`
- Modify: `app_v2.js`
- Test: `tests/credit_card_cycles.test.js`

- [ ] **Step 1: Add script before `app_v2.js`**

In `index.html`, add the helper script immediately before the existing `app_v2.js` script:

```html
<script src="credit_card_cycles.js?v=2026.06.03-r1"></script>
<script src="app_v2.js?v=2026.06.01-r67"></script>
```

- [ ] **Step 2: Replace `App.getCardStatement` body with helper delegation**

In `app_v2.js`, replace the body of `App.getCardStatement = function(cardId, refDate = today()) { ... }` with:

```js
  App.getCardStatement = function(cardId, refDate = today()) {
    const card = walletById(cardId)
    if (!card) return null
    if (typeof CreditCardCycles !== 'undefined') {
      return CreditCardCycles.getCardStatement({
        card,
        transactions: S.transactions || [],
        refDate,
        rewardForTx: tx => App.getTransactionRewardEstimate?.(tx) || { points:0, cashback:0, discount:0 },
        amountForTx: tx => typeof App._expectedLedgerAmountForTx === 'function'
          ? App._expectedLedgerAmountForTx(tx)
          : (App.getLedgerAmountForTx?.(tx) || tx.amount || 0),
        isPostedTx: tx => App._isPostedTx ? App._isPostedTx(tx) : tx.scheduled !== true,
      })
    }
    return null
  }
```

- [ ] **Step 3: Replace `App.getCreditCardDueInfo` with payable-statement logic**

In `app_v2.js`, replace the body of `App.getCreditCardDueInfo = function(card, refDate = today()) { ... }` with:

```js
  App.getCreditCardDueInfo = function(card, refDate = today()) {
    if (!card) return null
    if (typeof CreditCardCycles !== 'undefined') {
      return CreditCardCycles.getNextPayableDueInfo({
        card,
        transactions: S.transactions || [],
        refDate,
        rewardForTx: tx => App.getTransactionRewardEstimate?.(tx) || { points:0, cashback:0, discount:0 },
        amountForTx: tx => typeof App._expectedLedgerAmountForTx === 'function'
          ? App._expectedLedgerAmountForTx(tx)
          : (App.getLedgerAmountForTx?.(tx) || tx.amount || 0),
        isPostedTx: tx => App._isPostedTx ? App._isPostedTx(tx) : tx.scheduled !== true,
      })
    }
    return null
  }
```

- [ ] **Step 4: Update dashboard credit alert amount source**

In `App.renderDashboard`, change the `alertCards` credit filter/map block so it uses payable amount instead of `Math.abs(card.balance)`:

```js
    const alertCards = (typeof visibleWallets === 'function' ? visibleWallets() : S.wallets.filter(w => !w.hiddenFromWalletList))
      .filter(w => w.type === 'credit')
      .map(w => {
        const due = App.getCreditCardDueInfo ? App.getCreditCardDueInfo(w) : null
        const used = Number(due?.amount || 0)
        return due && used > 0 ? { ...w, used, due } : null
      })
      .filter(Boolean)
      .filter(card => Number(card.due?.daysLeft) >= 0)
      .filter(card => !hasPaymentForCreditDue(card, card.due))
      .sort((a, b) => Number(a.due?.daysLeft ?? 9999) - Number(b.due?.daysLeft ?? 9999))
```

- [ ] **Step 5: Update `App.getUpcomingItems` credit due amount**

Replace only the credit-card block in `App.getUpcomingItems`:

```js
    ;(S.wallets || []).filter(w => w.type === 'credit').forEach(card => {
      const due = App.getCreditCardDueInfo?.(card)
      if (!due?.dateStr || due.dateStr > end) return
      const amount = Math.max(0, Number(due.amount || due.statement?.balanceDue || 0))
      if (amount <= 0) return
      rows.push({ id:`cc-${card.id}:${due.statementId || due.dateStr}`, date:due.dateStr, icon:card.icon || '💳', title:`ชำระบัตร ${card.name}`, amount, type:'credit_due', status:due.daysLeft < 0 ? 'overdue' : 'upcoming', open:`App.openCCDetail('${esc(card.id)}')` })
    })
```

- [ ] **Step 6: Run smoke tests**

Run:

```bash
node --test tests/*.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add index.html app_v2.js tests/credit_card_cycles.test.js
git commit -m "fix: base credit card due alerts on payable statements"
```

---

### Task 3: Fix Notification Snapshot Credit Due Rows

**Files:**
- Modify: `notifications_v2.js`
- Test: `tests/credit_card_cycles.test.js`

- [ ] **Step 1: Add notification-specific test**

Append to `tests/credit_card_cycles.test.js`:

```js
test('credit due notification excludes current-cycle-only spending', () => {
  const rows = CC.getCreditDueNotificationRows({
    cards:[card],
    transactions:[{ id:'new', type:'expense', walletId:'ktc', amount:9000, date:'2026-06-01' }],
    refDate:'2026-06-03',
    hideAmounts:false,
  })
  assert.deepEqual(rows, [])
})
```

- [ ] **Step 2: Run test to verify helper behavior**

Run:

```bash
node --test tests/credit_card_cycles.test.js
```

Expected: PASS.

- [ ] **Step 3: Replace `creditDue` construction in `notifications_v2.js`**

Replace the current `const creditDue = (S.wallets || [])...` block in `buildSnapshot()` with:

```js
    const creditDue = typeof CreditCardCycles !== 'undefined'
      ? CreditCardCycles.getCreditDueNotificationRows({
          cards: (S.wallets || []).filter(w => w?.type === 'credit'),
          transactions: S.transactions || [],
          refDate: today,
          hideAmounts: Boolean(S.settings?.notifications?.hide_amounts_in_notification),
          maxDays: 7,
          rewardForTx: tx => App.getTransactionRewardEstimate?.(tx) || { points:0, cashback:0, discount:0 },
          amountForTx: tx => typeof App._expectedLedgerAmountForTx === 'function'
            ? App._expectedLedgerAmountForTx(tx)
            : (App.getLedgerAmountForTx?.(tx) || tx.amount || 0),
          isPostedTx: tx => App._isPostedTx ? App._isPostedTx(tx) : tx.scheduled !== true,
        })
      : []
```

- [ ] **Step 4: Confirm Supabase sender dedupe remains valid**

Run:

```bash
rg -n "credit_due|statementId|daysLeft" notifications_v2.js supabase/functions/send-custom-notification-rules/index.ts
```

Expected: `send-custom-notification-rules` still checks `snapshot.credit_due[].daysLeft`, and extra JSON fields such as `statementId` are ignored safely.

- [ ] **Step 5: Run smoke tests**

Run:

```bash
node --test tests/*.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add notifications_v2.js tests/credit_card_cycles.test.js
git commit -m "fix: sync only payable credit card statements"
```

---

### Task 4: Add Cycle Pager State And Rendering In Credit Card Detail

**Files:**
- Modify: `app_v2.js`
- Modify: `style_v2.css`

- [ ] **Step 1: Add pager state defaults**

Near the global state defaults around `S = { ... }`, ensure the state includes:

```js
ccDetailCycleOffsets: {},
```

In `App._ensureV2State`, append:

```js
S.ccDetailCycleOffsets ||= {}
```

- [ ] **Step 2: Add helper methods before `App.openCCDetail`**

Insert these functions immediately before `App.openCCDetail = function(cardId) {`:

```js
  App._getCCDetailCycleOffset = function(cardId) {
    S.ccDetailCycleOffsets ||= {}
    return Math.max(0, Number(S.ccDetailCycleOffsets[cardId] || 0))
  }

  App._setCCDetailCycleOffset = function(cardId, offset) {
    S.ccDetailCycleOffsets ||= {}
    S.ccDetailCycleOffsets[cardId] = Math.max(0, Number(offset || 0))
    App.openCCDetail(cardId)
  }

  App._getCCDetailStatementAtOffset = function(card, offset = 0) {
    const rows = typeof CreditCardCycles !== 'undefined'
      ? CreditCardCycles.getStatementHistory({
          card,
          transactions: S.transactions || [],
          refDate: today(),
          count: Math.max(6, Number(offset || 0) + 2),
          rewardForTx: tx => App.getTransactionRewardEstimate?.(tx) || { points:0, cashback:0, discount:0 },
          amountForTx: tx => typeof App._expectedLedgerAmountForTx === 'function'
            ? App._expectedLedgerAmountForTx(tx)
            : (App.getLedgerAmountForTx?.(tx) || tx.amount || 0),
          isPostedTx: tx => App._isPostedTx ? App._isPostedTx(tx) : tx.scheduled !== true,
        })
      : []
    return rows[Math.max(0, Number(offset || 0))] || null
  }

  App._renderCCCyclePager = function(cardId, offset, st) {
    const newerDisabled = offset <= 0
    const olderOffset = Number(offset || 0) + 1
    const newerOffset = Math.max(0, Number(offset || 0) - 1)
    return `<div class="cc-cycle-pager" role="group" aria-label="เลือกรอบบัตรเครดิต">
      <button class="icon-btn cc-cycle-nav" ${newerDisabled ? 'disabled' : ''} onclick="App._setCCDetailCycleOffset('${esc(cardId)}', ${newerOffset})" aria-label="รอบใหม่กว่า">‹</button>
      <div class="cc-cycle-current">
        <strong>${st ? `${thaiDate(st.start)} – ${thaiDate(st.end)}` : 'ยังไม่มีรอบบิล'}</strong>
        <span>${offset === 0 ? 'รอบล่าสุด' : `ย้อนหลัง ${offset} รอบ`}</span>
      </div>
      <button class="icon-btn cc-cycle-nav" onclick="App._setCCDetailCycleOffset('${esc(cardId)}', ${olderOffset})" aria-label="รอบเก่ากว่า">›</button>
    </div>`
  }

  App._renderCCStatementPanel = function(cardId, st) {
    if (!st) return `<div class="statement-compact statement-compact-th"><div class="empty-state">ยังไม่มีข้อมูลรอบบิล</div></div>`
    const status = st.paid ? 'ชำระแล้ว' : (Number(st.balanceDue || 0) > 0 ? 'ค้างชำระ' : 'ไม่มียอดต้องจ่าย')
    return `<div class="statement-compact statement-compact-th">
      <div class="statement-main">
        <div><b>สรุปรอบบัตรเครดิต</b><span>รอบ ${thaiDate(st.start)} – ${thaiDate(st.end)}</span><span>วันกำหนดชำระ ${thaiDate(st.dueDate)}</span></div>
        <em class="status-pill ${st.paid || Number(st.balanceDue || 0) <= 0 ? 'ok' : 'warn'}">${status}</em>
      </div>
      <div class="statement-metrics">
        <div><span>ยอดใช้ในรอบ</span><strong>${money(st.purchaseTotal)}</strong></div>
        <div><span>ชำระแล้ว</span><strong>${money(st.paidTotal)}</strong></div>
        <div><span>ค้างชำระ</span><strong>${money(st.balanceDue)}</strong></div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="App.openRewardLedgerScreen('${esc(cardId)}')">บัญชีคะแนนบัตรเครดิต</button>
    </div>`
  }

  App._renderCCBenefitPanel = function(cardId, st, rewardAcctHtml) {
    const rewards = st?.reward || { points:0, cashback:0, discount:0 }
    const hasRewards = rewards.points > 0 || rewards.cashback > 0 || rewards.discount > 0
    const alreadyRecorded = st && statementRewardRecorded(st.id)
    const recordBtn = hasRewards && st
      ? `<button class="btn btn-primary btn-sm v5-record-btn" onclick="App.recordActualRewards('${esc(cardId)}')" style="width:100%;margin-top:8px">${alreadyRecorded ? 'บันทึกแล้ว — เพิ่มอีกรายการ?' : 'บันทึกยอด'}</button>`
      : ''
    return `<div class="card card-pad cc-benefit-cycle-card" style="margin-bottom:12px">
      <div class="cc-detail-header">
        <div><div style="font-size:14px;font-weight:700">สิทธิประโยชน์รอบนี้</div><div style="font-size:12px;color:var(--muted)">${st ? `${thaiDate(st.start)} ถึง ${thaiDate(st.end)}` : 'ยังไม่มีข้อมูลรอบบิล'}</div></div>
        <button class="btn btn-secondary btn-sm" onclick="App.openCCBenefitScreen('${esc(cardId)}')" style="width:auto">ตั้งค่า</button>
      </div>
      <div class="reward-grid" style="margin-top:10px">
        <div class="reward-tile"><span>คะแนน</span><strong>${Number(rewards.points || 0).toLocaleString('en-US')}</strong></div>
        <div class="reward-tile"><span>เงินคืน</span><strong>${money(rewards.cashback || 0)}</strong></div>
        <div class="reward-tile"><span>ส่วนลดทันที</span><strong>${money(rewards.discount || 0)}</strong></div>
      </div>
      ${rewardAcctHtml || ''}${recordBtn}
    </div>`
  }
```

- [ ] **Step 3: Replace one-cycle HTML in `App.openCCDetail`**

Inside `App.openCCDetail`, replace the existing `const st`, `period`, `rewards`, `hasRewards`, `alreadyRecorded`, `recordBtn`, and `stHtml` setup with:

```js
    const offset = App._getCCDetailCycleOffset(cardId)
    const st = App._getCCDetailStatementAtOffset(card, offset)
    const rewardAcct = App.getRewardAccountForCard(cardId)
    const rewardAcctHtml = rewardAcct ? `<div class="v5-reward-acct-info"><span>⭐ ${esc(rewardAcct.name)}</span><strong>${App.getRewardAccountBalance(rewardAcct.id).toLocaleString('en-US')} คะแนน</strong></div>` : ''
    const cyclePagerHtml = App._renderCCCyclePager(cardId, offset, st)
    const stHtml = `${cyclePagerHtml}${App._renderCCStatementPanel(cardId, st)}`
    const benefitHtml = App._renderCCBenefitPanel(cardId, st, rewardAcctHtml)
```

Then in the big `App.openSubScreen` template, replace the inline benefit card with:

```js
${benefitHtml}
```

- [ ] **Step 4: Add CSS for pager and snap behavior**

Append to `style_v2.css`:

```css
.cc-cycle-pager {
  display: grid;
  grid-template-columns: 40px 1fr 40px;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
}
.cc-cycle-current {
  min-width: 0;
  text-align: center;
}
.cc-cycle-current strong,
.cc-cycle-current span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cc-cycle-current strong {
  font-size: 13px;
}
.cc-cycle-current span {
  color: var(--muted);
  font-size: 11px;
  margin-top: 2px;
}
.cc-cycle-nav {
  width: 40px;
  height: 40px;
  border-radius: 8px;
}
.cc-cycle-nav:disabled {
  opacity: .35;
  pointer-events: none;
}
.cc-benefit-cycle-card {
  scroll-snap-align: start;
}
@media (max-width: 640px) {
  .cc-detail-screen .statement-compact,
  .cc-detail-screen .cc-benefit-cycle-card {
    scroll-margin-top: 12px;
  }
}
```

- [ ] **Step 5: Manual check**

Run a local server:

```bash
python3 -m http.server 4173
```

Open:

```text
http://localhost:4173
```

Expected: หน้า credit card detail แสดง pager เหนือ statement; กด `›` แล้ววันที่รอบ, ยอดใช้, ยอดชำระ, และ reward เปลี่ยนเป็นรอบเก่า; กด `‹` กลับรอบใหม่กว่าได้.

- [ ] **Step 6: Commit**

```bash
git add app_v2.js style_v2.css
git commit -m "feat: add credit card cycle history pager"
```

---

### Task 5: Make Reward Recording Respect Selected Statement

**Files:**
- Modify: `app_v2.js`

- [ ] **Step 1: Update selected statement lookup in reward recording**

Find `App.recordActualRewards = function(cardId) { ... }`. Replace any line that uses `App.getCardStatement(cardId)` as the statement source with:

```js
    const offset = App._getCCDetailCycleOffset?.(cardId) || 0
    const st = App._getCCDetailStatementAtOffset?.(walletById(cardId), offset) || App.getCardStatement?.(cardId)
```

- [ ] **Step 2: Guard open/current-cycle cases**

At the start of `App.recordActualRewards`, after `st` is assigned, add:

```js
    if (!st?.id) return notify('ยังไม่มีรอบบิลให้บันทึกยอด', 'warn')
```

- [ ] **Step 3: Manual check**

Run:

```bash
python3 -m http.server 4173
```

Expected: เมื่ออยู่รอบย้อนหลัง ปุ่ม “บันทึกยอด” สร้าง reward ledger ด้วย `statementId` ของรอบที่เลือก; เมื่อรอบนั้นถูกบันทึกแล้ว ปุ่มแสดง “บันทึกแล้ว — เพิ่มอีกรายการ?”.

- [ ] **Step 4: Commit**

```bash
git add app_v2.js
git commit -m "fix: record rewards for selected credit cycle"
```

---

### Task 6: Add Sample Data For Manual QA

**Files:**
- Modify: `sample-data_v2.js`

- [ ] **Step 1: Add cross-cycle credit card transactions**

In `DEFAULT_TRANSACTIONS`, add sample rows for one credit card:

```js
  { id:'tx_cc_prev_cycle_food', type:'expense', amount:3200, walletId:'w4', categoryId:'food', merchant:'Lotus', note:'รอบก่อนหน้า', date:'2026-05-10', rewardRuleIds:[] },
  { id:'tx_cc_prev_cycle_pay', type:'cc_payment', amount:1200, walletId:'w1', toWalletId:'w4', note:'จ่ายบางส่วนรอบก่อนหน้า', date:'2026-05-30', statementId:'w4:2026-04-26:2026-05-25' },
  { id:'tx_cc_current_cycle_online', type:'expense', amount:4500, walletId:'w4', categoryId:'shopping', merchant:'Shopee', channel:'online', note:'รอบปัจจุบัน ยังไม่ควรเตือนจ่าย', date:'2026-06-01', rewardRuleIds:[] },
```

- [ ] **Step 2: Manual expected states**

Run:

```bash
python3 -m http.server 4173
```

Expected on `2026-06-03` test data:

- Dashboard credit alert shows `2,000` due for statement `2026-04-26` to `2026-05-25`, not `6,500`.
- Notification snapshot debug includes `amountDue: 2000` for `w4` and excludes current-cycle-only amount.
- Credit card detail pager offset `0` shows previous closed statement; offset `1` shows the older statement if data exists or zero values if no purchases.

- [ ] **Step 3: Commit**

```bash
git add sample-data_v2.js
git commit -m "test: add credit card cycle sample data"
```

---

### Task 7: Full Regression And UX QA

**Files:**
- Verify only: `app_v2.js`, `notifications_v2.js`, `credit_card_cycles.js`, `style_v2.css`

- [ ] **Step 1: Run all Node tests**

Run:

```bash
node --test tests/*.test.js
```

Expected: PASS.

- [ ] **Step 2: Search for stale balance-based due logic**

Run:

```bash
rg -n "creditDue|credit_due|getCreditCardDueInfo|Math\\.abs\\(Number\\(card\\.balance|Math\\.abs\\(card\\.balance|statementDue" app_v2.js notifications_v2.js calculations.js
```

Expected: notification and upcoming/dashboard paths use `due.amount`, `due.statement.balanceDue`, or `Calc.getCreditLiabilitySummary` statement data; no notification path uses `Math.abs(card.balance)` as amount due.

- [ ] **Step 3: Browser QA matrix**

Run:

```bash
python3 -m http.server 4173
```

Check in browser:

- Dashboard: no credit alert when only current open cycle has spending.
- Dashboard: shows alert only within `CREDIT_ALERT_DAYS` for unpaid closed statement.
- More > การแจ้งเตือน > กฎแจ้งเตือนเอง: credit card due rule still lists and syncs.
- More > รายการที่จะถึง: credit card row amount equals selected payable statement balance.
- Credit card detail desktop: pager buttons work and do not overflow.
- Credit card detail mobile width 390px: date label truncates cleanly and buttons remain tappable.
- Payment overlay: paying a statement attaches current selected statement id through `App.openCCPay` / `App.confirmCCPay` path.

- [ ] **Step 4: Commit final QA notes if code changed**

If QA requires fixes:

```bash
git add app_v2.js notifications_v2.js credit_card_cycles.js style_v2.css index.html sample-data_v2.js tests/credit_card_cycles.test.js
git commit -m "fix: polish credit card billing UX"
```

If QA requires no fixes, do not create an empty commit.

---

## Self-Review

- Spec coverage: notification UX now distinguishes payable closed statements from current-cycle spending; credit card detail gains historical navigation for both statement summary and benefits.
- Placeholder scan: no `TBD`, no vague “handle edge cases”, and every code-changing step includes concrete code.
- Type consistency: helper returns `statementId`, `amount`, `statement.balanceDue`, `cycleStart`, `cycleEnd`; app and notification tasks use the same names.
