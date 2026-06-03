# Net Card Aurora Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the dashboard `mt-net-card mt-aurora-on` to match the approved blue finance-card concept, including net worth, usable cash, Healthy donut, finance sparkline, and the integrated income/expense/debt/unpaid-bills metric row.

**Architecture:** Keep the existing dashboard render flow and animation hooks intact. Add small render helpers near the current dashboard card HTML in `app_v2.js`, then replace only the net-card markup block. Update `style_v2.css` with a scoped component system for the redesigned card, preserving existing `.mt-net-card`, `.mt-net-value`, `.mt-net-split`, `.mt-aurora-on`, and canvas particle behavior.

**Tech Stack:** Vanilla JavaScript, HTML template strings, CSS/SVG, existing `node:test` tests, in-app Browser QA.

---

## Approved Visual Spec

- Card style: vivid deep-blue rounded financial summary card with aurora shimmer, faint network/grid texture, canvas particles, and soft shadow.
- Top left: `สินทรัพย์สุทธิ`, small eye-slash affordance, large net-worth value.
- Under main value: `เงินพร้อมใช้`, amount, chevron.
- Center/lower top: glowing sparkline with circular points.
- Top right: donut status chart reading `71%` and `Healthy`.
- Bottom row: four equal integrated metric blocks: `รายรับ`, `รายจ่าย`, `หนี้สิน`, `บิลค้างจ่าย`.
- Keep existing animations: digit roll on `.mt-net-value`, aurora class on `.mt-net-card`, canvas particles, diff highlight, negative shake behavior if used.
- Dark mode: deeper navy card, readable text, subtle border/glow/dividers, not washed out.

## Files

- Modify: `/Users/bosskung/Document/Money Tracker/app_v2.js`
  - Add scoped render helpers inside `App.renderDashboard`, near the current dashboard card block.
  - Replace the current `html += <div class="mt-net-card">...` block at approximately lines `4094-4120`.
- Modify: `/Users/bosskung/Document/Money Tracker/style_v2.css`
  - Replace/extend dashboard net-card styles around lines `784-839`.
  - Keep compact overrides around lines `2138-2144` compatible with the new layout.
  - Keep animation definitions around lines `6440-6605`; only add class-specific refinements if needed.
- Optional modify: `/Users/bosskung/Document/Money Tracker/tests/dashboard_net_card_static.test.js`
  - Add a lightweight static regression test for required class names and Thai labels.

---

### Task 1: Add A Static Regression Test For The New Card Contract

**Files:**
- Create: `/Users/bosskung/Document/Money Tracker/tests/dashboard_net_card_static.test.js`

- [ ] **Step 1: Write the failing static test**

Create `/Users/bosskung/Document/Money Tracker/tests/dashboard_net_card_static.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')
const css = fs.readFileSync(path.join(root, 'style_v2.css'), 'utf8')

test('dashboard net card exposes approved finance-card regions', () => {
  const requiredAppTokens = [
    'mt-net-hero',
    'mt-net-main',
    'mt-net-status',
    'mt-net-ring',
    'mt-net-sparkline',
    'mt-net-metric-icon',
    'สินทรัพย์สุทธิ',
    'เงินพร้อมใช้',
    'สถานะการเงิน',
    'Healthy',
    'รายรับ',
    'รายจ่าย',
    'หนี้สิน',
    'บิลค้างจ่าย',
  ]

  for (const token of requiredAppTokens) {
    assert.ok(app.includes(token), `missing app token: ${token}`)
  }
})

test('dashboard net card keeps animation hooks and dark mode styling', () => {
  const requiredCssTokens = [
    '.mt-net-card',
    '.mt-net-card::before',
    '.mt-net-card::after',
    '.mt-net-value',
    '.mt-net-split',
    '.mt-net-ring',
    '.mt-net-sparkline',
    'html.dark .mt-net-card',
    '@keyframes mt-aurora',
  ]

  for (const token of requiredCssTokens) {
    assert.ok(css.includes(token), `missing css token: ${token}`)
  }
})
```

- [ ] **Step 2: Run the test and verify it fails before implementation**

Run:

```bash
node --test tests/dashboard_net_card_static.test.js
```

Expected:

```text
not ok 1 - dashboard net card exposes approved finance-card regions
```

The failure should mention at least one missing token such as `mt-net-hero`.

---

### Task 2: Replace The Existing Net Card Markup With The Approved Layout

**Files:**
- Modify: `/Users/bosskung/Document/Money Tracker/app_v2.js:4094`

- [ ] **Step 1: Add helper functions inside `App.renderDashboard` before `const hasUsableBreakdown`**

Insert this immediately before the existing line:

```js
const hasUsableBreakdown = (usable.creditDebt > 0 || usable.upcomingReserved > 0)
```

New code:

```js
    const healthyPct = (() => {
      const income = Number(stats.income || 0)
      const expense = Number(stats.expense || 0)
      if (income <= 0 && expense <= 0) return 71
      if (income <= 0) return 35
      const cashRatio = Math.max(0, Math.min(1, (income - expense) / income))
      const debtPressure = usable.creditDebt > 0 && usable.liquid > 0
        ? Math.min(.35, usable.creditDebt / Math.max(usable.liquid + usable.creditDebt, 1))
        : 0
      return Math.max(12, Math.min(96, Math.round((cashRatio * 82 + 18) * (1 - debtPressure))))
    })()

    const sparkValues = (() => {
      const monthsForTrend = Calc.getMonths ? Calc.getMonths(8).slice().reverse() : [dm]
      const values = monthsForTrend.map(month => {
        const income = S.transactions
          .filter(t => (t.date || '').startsWith(month) && t.type === 'income' && Calc.isPostedTx(t))
          .reduce((sum, t) => sum + Number(t.amount || 0), 0)
        const expense = S.transactions
          .filter(t => (t.date || '').startsWith(month) && t.type === 'expense' && Calc.isPostedTx(t))
          .reduce((sum, t) => sum + Number(t.amount || 0), 0)
        return income - expense
      })
      return values.some(v => Math.abs(v) > 0) ? values : [12, 18, 14, 24, 29, 25, 36, 31]
    })()

    function renderNetSparkline(values) {
      const width = 270
      const height = 86
      const pad = 8
      const min = Math.min(...values)
      const max = Math.max(...values)
      const span = Math.max(1, max - min)
      const points = values.map((value, index) => {
        const x = pad + (index * (width - pad * 2)) / Math.max(1, values.length - 1)
        const y = height - pad - ((value - min) / span) * (height - pad * 2)
        return [Number(x.toFixed(1)), Number(y.toFixed(1))]
      })
      const d = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x},${y}`).join(' ')
      const area = `${d} L${points[points.length - 1][0]},${height - pad} L${points[0][0]},${height - pad} Z`
      return `<svg class="mt-net-sparkline" viewBox="0 0 ${width} ${height}" aria-hidden="true">
        <path class="mt-net-spark-area" d="${area}"></path>
        <path class="mt-net-spark-path" d="${d}"></path>
        ${points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.1"></circle>`).join('')}
      </svg>`
    }

    function renderNetRing(pct) {
      const safePct = Math.max(0, Math.min(100, Number(pct) || 0))
      const circumference = 2 * Math.PI * 42
      const offset = circumference * (1 - safePct / 100)
      return `<div class="mt-net-ring" role="img" aria-label="สถานะการเงิน ${safePct}% Healthy">
        <svg viewBox="0 0 112 112" aria-hidden="true">
          <circle class="mt-net-ring-track" cx="56" cy="56" r="42"></circle>
          <circle class="mt-net-ring-fill" cx="56" cy="56" r="42" style="stroke-dasharray:${circumference.toFixed(2)};stroke-dashoffset:${offset.toFixed(2)}"></circle>
        </svg>
        <div class="mt-net-ring-text"><strong>${safePct}%</strong><span>Healthy</span></div>
      </div>`
    }

    function renderNetMetric({ tone, icon, label, value, sub }) {
      return `<div class="mt-net-metric mt-net-metric-${tone}">
        <span class="mt-net-metric-icon" aria-hidden="true">${icon}</span>
        <small>${label}</small>
        <strong>${value}</strong>
        ${sub ? `<em>${sub}</em>` : ''}
      </div>`
    }
```

- [ ] **Step 2: Replace the current `html +=` net card template**

Replace the current block from:

```js
    const hasUsableBreakdown = (usable.creditDebt > 0 || usable.upcomingReserved > 0)
    html += `
      <div class="mt-net-card">
```

through the closing:

```js
      </div>`
```

just before:

```js
    if (nearDueCards.length) {
```

with:

```js
    const hasUsableBreakdown = (usable.creditDebt > 0 || usable.upcomingReserved > 0)
    const unpaidBillTotal = Number(usable.upcomingReserved || 0)
    const unpaidBillCount = nearDueCards.length
    const pendingUpcomingBills = typeof Calc.getPendingUpcomingBills === 'function'
      ? Calc.getPendingUpcomingBills(S)
      : (S.upcomingBills || []).filter(b => b && b.status === 'pending')
    const unpaidBillCount = pendingUpcomingBills.length
    const debtTotal = Number(usable.creditDebt || 0)
    const prevMonth = Calc.getPreviousMonth?.(dm) || Calc.getMonths?.(2)?.[1] || ''
    const prevMonthly = prevMonth ? Calc.getMonthlyIncomeExpense(S.transactions, prevMonth) : null
    const shortMonthLabel = ym => String(mlabel(ym) || '').split(' ')[0] || ''
    const pctText = pct => `${Math.abs(pct) >= 10 ? Math.abs(pct).toFixed(0) : Math.abs(pct).toFixed(1)}%`
    const monthCompareSub = (current, previous, emptyText) => {
      const cur = Number(current || 0)
      const prev = Number(previous || 0)
      if (cur <= 0) return emptyText
      if (!(prev > 0)) return 'เดือนนี้'
      const diffPct = ((cur - prev) / prev) * 100
      if (Math.abs(diffPct) < 0.05) return `เท่าเดิมจาก ${shortMonthLabel(prevMonth)}`
      return `${diffPct > 0 ? '▲' : '▼'} ${pctText(diffPct)} จาก ${shortMonthLabel(prevMonth)}`
    }
    const incomeCompareSub = monthCompareSub(stats.income, prevMonthly?.income, 'ยังไม่มีรายรับ')
    const expenseCompareSub = monthCompareSub(stats.expense, prevMonthly?.expense, 'ยังไม่มีรายจ่าย')
    const billSub = unpaidBillCount > 0 ? `${unpaidBillCount} รายการ` : 'ไม่มีรายการ'

    html += `
      <div class="mt-net-card" aria-label="สรุปการเงิน">
        <div class="mt-net-hero">
          <div class="mt-net-main">
            <div class="mt-net-label">สินทรัพย์สุทธิ <span class="mt-net-eye" aria-hidden="true">⊘</span></div>
            <div class="mt-net-value" data-val-key="dashboard-net-worth">${dashboardNetWorth < 0 && !S.settings.hideMoney ? '-' : ''}${FMT(Math.abs(dashboardNetWorth))}</div>
            <button class="mt-net-cash-link" type="button" onclick="App.showPage('wallets')" aria-label="ดูเงินพร้อมใช้">
              <span>เงินพร้อมใช้</span>
              <strong data-val-key="dashboard-usable-cash">${usable.net < 0 && !S.settings.hideMoney ? '-' : ''}${FMT(Math.abs(usable.net))}</strong>
              <i aria-hidden="true">›</i>
            </button>
          </div>
          <div class="mt-net-chart" aria-hidden="true">
            ${renderNetSparkline(sparkValues)}
          </div>
          <div class="mt-net-status">
            <div class="mt-net-status-label">สถานะการเงิน</div>
            ${renderNetRing(healthyPct)}
          </div>
        </div>
        ${hasUsableBreakdown ? `<div class="mt-net-breakdown" aria-label="รายละเอียดเงินพร้อมใช้">
          <span>เงินสด ${FMT(usable.liquid)}</span>
          ${debtTotal > 0 ? `<span>หนี้บัตร -${FMT(debtTotal)}</span>` : ''}
          ${unpaidBillTotal > 0 ? `<span>รอจ่าย -${FMT(unpaidBillTotal)}</span>` : ''}
        </div>` : ''}
        <div class="mt-net-split" aria-label="สรุปรายรับรายจ่ายและภาระ">
          ${renderNetMetric({ tone: 'income', icon: '↓', label: 'รายรับ', value: `+${FMT(stats.income)}`, sub: incomeCompareSub })}
          <div class="mt-divider"></div>
          ${renderNetMetric({ tone: 'expense', icon: '↑', label: 'รายจ่าย', value: `-${FMT(stats.expense)}`, sub: expenseCompareSub })}
          <div class="mt-divider"></div>
          ${renderNetMetric({ tone: 'debt', icon: '▣', label: 'หนี้สิน', value: FMT(debtTotal), sub: 'คงเหลือ' })}
          <div class="mt-divider"></div>
          ${renderNetMetric({ tone: 'bill', icon: '□', label: 'บิลค้างจ่าย', value: FMT(unpaidBillTotal), sub: billSub })}
        </div>
        ${reimbursementInflow > 0 ? `<div class="list-item-sub mt-net-note">คงเหลือด้านบนไม่รวมเงินคืน เพื่อวัดรายรับปกติ · เงินสดสุทธิหลังรวมเงินคืน ${dashboardCashNet < 0 && !S.settings.hideMoney ? '-' : ''}${FMT(Math.abs(dashboardCashNet))}</div>` : ''}
      </div>`
```

- [ ] **Step 3: Run the static test**

Run:

```bash
node --test tests/dashboard_net_card_static.test.js
```

Expected:

```text
not ok 2 - dashboard net card keeps animation hooks and dark mode styling
```

The app tokens should now pass, while CSS tokens may still fail until Task 3.

---

### Task 3: Implement The Blue Aurora Card CSS And Dark Mode

**Files:**
- Modify: `/Users/bosskung/Document/Money Tracker/style_v2.css:784`
- Modify: `/Users/bosskung/Document/Money Tracker/style_v2.css:2138`

- [ ] **Step 1: Replace the existing net-card CSS block**

Replace the current `.mt-net-card` through `.mt-divider` block around lines `784-839` with:

```css
.mt-net-card {
  margin-top: 8px;
  color: #fff;
  border-radius: 24px;
  padding: 22px 24px 20px;
  position: relative;
  overflow: hidden;
  isolation: isolate;
  background:
    radial-gradient(circle at 86% 18%, rgba(125, 211, 252, .24), transparent 28%),
    radial-gradient(circle at 20% 0%, rgba(59, 130, 246, .34), transparent 30%),
    linear-gradient(135deg, #1065dc 0%, #0751bd 42%, #032b79 100%);
  border: 1px solid rgba(255,255,255,.18);
  box-shadow: 0 18px 36px rgba(15,23,42,.18), 0 4px 14px rgba(37,99,235,.22);
}
.mt-net-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background:
    linear-gradient(135deg, rgba(255,255,255,.18), transparent 28%, rgba(134,239,172,.12) 58%, rgba(96,165,250,.16)),
    repeating-linear-gradient(90deg, transparent 0 48px, rgba(255,255,255,.055) 49px 50px),
    repeating-linear-gradient(0deg, transparent 0 48px, rgba(255,255,255,.045) 49px 50px);
  background-size: 300% 300%, auto, auto;
  animation: mt-aurora 10s ease infinite;
  pointer-events: none;
  z-index: 0;
}
.mt-net-card::after {
  content: '';
  position: absolute;
  inset: auto 20px 96px 20px;
  height: 1px;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.28), transparent);
  box-shadow: 0 -1px 0 rgba(255,255,255,.08);
  z-index: 1;
}
.mt-net-hero {
  min-height: 206px;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(170px, .9fr) 150px;
  gap: 14px;
  position: relative;
  z-index: 1;
}
.mt-net-main { min-width: 0; padding-top: 2px; }
.mt-net-label,
.mt-net-status-label {
  font-size: 13px;
  line-height: 1.35;
  font-weight: 800;
  color: rgba(232, 244, 255, .82);
}
.mt-net-eye {
  display: inline-flex;
  margin-left: 5px;
  color: rgba(232,244,255,.62);
  font-size: 14px;
}
.mt-net-value {
  margin-top: 6px;
  font-size: clamp(34px, 7.6vw, 56px);
  line-height: .95;
  font-weight: 900;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 6px 18px rgba(15,23,42,.24);
}
.mt-net-cash-link {
  appearance: none;
  border: 0;
  background: transparent;
  color: #fff;
  display: inline-grid;
  grid-template-columns: auto auto auto;
  align-items: center;
  gap: 7px;
  margin-top: 18px;
  padding: 0;
  text-align: left;
  cursor: pointer;
}
.mt-net-cash-link span {
  grid-column: 1 / -1;
  color: rgba(232,244,255,.88);
  font-size: 13px;
  font-weight: 800;
}
.mt-net-cash-link strong {
  font-size: 19px;
  line-height: 1;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.mt-net-cash-link i {
  font-style: normal;
  font-size: 28px;
  line-height: 1;
  color: rgba(255,255,255,.86);
}
.mt-net-chart {
  position: relative;
  align-self: end;
  min-height: 116px;
  margin-bottom: 16px;
}
.mt-net-sparkline {
  width: 100%;
  height: 116px;
  overflow: visible;
  filter: drop-shadow(0 0 8px rgba(134,239,172,.34));
}
.mt-net-spark-area { fill: rgba(52, 211, 153, .10); }
.mt-net-spark-path {
  fill: none;
  stroke: #7ddf9f;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mt-net-sparkline circle {
  fill: #0c73cc;
  stroke: #8af1ad;
  stroke-width: 2;
}
.mt-net-status {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.mt-net-ring {
  width: 132px;
  aspect-ratio: 1;
  position: relative;
  display: grid;
  place-items: center;
}
.mt-net-ring svg {
  position: absolute;
  inset: 0;
  transform: rotate(-90deg);
}
.mt-net-ring-track,
.mt-net-ring-fill {
  fill: none;
  stroke-width: 10;
  stroke-linecap: round;
}
.mt-net-ring-track { stroke: rgba(6, 42, 120, .72); }
.mt-net-ring-fill {
  stroke: #8be88e;
  filter: drop-shadow(0 0 8px rgba(134,239,172,.46));
  transition: stroke-dashoffset 1.4s cubic-bezier(.34, 1.56, .64, 1);
}
.mt-net-ring-text {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  gap: 2px;
  text-align: center;
}
.mt-net-ring-text strong {
  font-size: 30px;
  line-height: 1;
  font-weight: 900;
}
.mt-net-ring-text span {
  font-size: 15px;
  color: rgba(232,244,255,.86);
}
.mt-net-breakdown {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: -8px 0 14px;
  color: rgba(232,244,255,.78);
  font-size: 11.5px;
  font-weight: 700;
}
.mt-net-breakdown span {
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.07);
  border-radius: 999px;
  padding: 4px 8px;
}
.mt-net-split {
  display: flex;
  position: relative;
  z-index: 1;
  gap: 0 !important;
  margin-top: 10px !important;
  padding-top: 14px;
}
.mt-net-metric {
  min-width: 0;
  flex: 1 1 0;
  overflow: hidden;
  padding: 0 10px;
}
.mt-net-metric:first-child { padding-left: 0; }
.mt-net-metric:last-child { padding-right: 0; }
.mt-net-metric-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  margin-bottom: 11px;
  font-size: 24px;
  line-height: 1;
  font-weight: 900;
  background: rgba(255,255,255,.14);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.14);
}
.mt-net-metric small {
  display: block;
  font-size: 13px;
  line-height: 1.25;
  color: rgba(232,244,255,.86);
  font-weight: 800;
}
.mt-net-metric strong {
  display: block;
  font-size: clamp(13px, 3.4vw, 17px);
  font-weight: 900 !important;
  margin-top: 4px;
  letter-spacing: 0;
  line-height: 1.05;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.mt-net-metric em {
  display: block;
  margin-top: 7px;
  font-style: normal;
  color: rgba(232,244,255,.76);
  font-size: 11px;
  line-height: 1.25;
  white-space: nowrap;
}
.mt-net-metric-income .mt-net-metric-icon,
.mt-net-metric-income strong { color: #6ee7a8 !important; }
.mt-net-metric-expense .mt-net-metric-icon,
.mt-net-metric-expense strong { color: #ff7474 !important; }
.mt-net-metric-debt .mt-net-metric-icon,
.mt-net-metric-debt strong { color: #fbbf24 !important; }
.mt-net-metric-bill .mt-net-metric-icon,
.mt-net-metric-bill strong { color: #bfd4ff !important; }
.mt-divider {
  width: 1px;
  flex: 0 0 1px;
  background: linear-gradient(180deg, transparent, rgba(255,255,255,.22), transparent);
}
.mt-net-note {
  position: relative;
  z-index: 1;
  padding: 10px 0 0 !important;
  color: rgba(232,244,255,.70) !important;
}
html.dark .mt-net-card {
  background:
    radial-gradient(circle at 84% 16%, rgba(45, 212, 191, .16), transparent 30%),
    radial-gradient(circle at 18% 0%, rgba(37, 99, 235, .25), transparent 34%),
    linear-gradient(135deg, #0b3a88 0%, #082760 48%, #06183f 100%);
  border-color: rgba(147,197,253,.22);
  box-shadow: 0 20px 42px rgba(0,0,0,.42), 0 0 0 1px rgba(96,165,250,.08);
}
html.dark .mt-net-ring-track { stroke: rgba(2, 12, 34, .78); }
```

- [ ] **Step 2: Fix compact override so it does not shrink the new card too aggressively**

Replace the existing compact overrides around lines `2138-2144`:

```css
.mt-net-card,
.nw-card {
  padding: 18px 18px 16px !important;
  border-radius: 24px !important;
}
.mt-net-split { gap: 14px !important; margin-top: 10px !important; }
.mt-net-metric strong { font-size: 12.5px !important; margin-top: 1px !important; line-height: 1.05 !important; letter-spacing: -.055em !important; white-space: nowrap !important; }
```

with:

```css
.mt-net-card,
.nw-card {
  border-radius: 24px !important;
}
.nw-card {
  padding: 18px 18px 16px !important;
}
.mt-net-split { margin-top: 10px !important; }
.nw-card .mt-net-metric strong {
  font-size: 12.5px !important;
  margin-top: 1px !important;
  line-height: 1.05 !important;
  letter-spacing: 0 !important;
  white-space: nowrap !important;
}
```

- [ ] **Step 3: Add responsive rules for narrow mobile screens**

Add after the `html.dark .mt-net-ring-track` rule:

```css
@media (max-width: 560px) {
  .mt-net-card {
    padding: 18px 18px 16px;
    border-radius: 22px;
  }
  .mt-net-hero {
    grid-template-columns: minmax(0, 1fr) 116px;
    min-height: 190px;
  }
  .mt-net-chart {
    grid-column: 1 / -1;
    order: 3;
    min-height: 72px;
    margin: -10px 0 6px;
  }
  .mt-net-sparkline { height: 76px; }
  .mt-net-status {
    align-items: center;
  }
  .mt-net-ring { width: 108px; }
  .mt-net-ring-text strong { font-size: 25px; }
  .mt-net-ring-text span { font-size: 13px; }
  .mt-net-card::after {
    inset: auto 18px 116px 18px;
  }
  .mt-net-split {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px 0 !important;
  }
  .mt-net-split .mt-divider { display: none; }
  .mt-net-metric {
    padding: 0 10px;
    border-left: 1px solid rgba(255,255,255,.16);
  }
  .mt-net-metric:nth-of-type(1),
  .mt-net-metric:nth-of-type(4) {
    border-left: 0;
    padding-left: 0;
  }
  .mt-net-metric strong {
    font-size: 15px;
  }
  .mt-net-metric em {
    white-space: normal;
  }
}
```

- [ ] **Step 4: Run the static test**

Run:

```bash
node --test tests/dashboard_net_card_static.test.js
```

Expected:

```text
ok 1 - dashboard net card exposes approved finance-card regions
ok 2 - dashboard net card keeps animation hooks and dark mode styling
```

---

### Task 4: Verify Existing Animation Hooks Still Run

**Files:**
- Modify only if needed: `/Users/bosskung/Document/Money Tracker/app_v2.js:20277`
- Modify only if needed: `/Users/bosskung/Document/Money Tracker/style_v2.css:6440`

- [ ] **Step 1: Confirm hooks still target the redesigned DOM**

Check these existing lines remain true:

```js
_digitRoll('#dashboard-content .mt-net-value')
document.querySelectorAll('#dashboard-content .mt-net-card').forEach(c => {
  c.classList.add('mt-aurora-on')
})
_netCardParticles()
```

Expected:

```text
.mt-net-value still exists once in the hero value.
.mt-net-card still exists as the root card.
The canvas particle code still inserts into .mt-net-card.
```

- [ ] **Step 2: If aurora should only show when class is present, scope the pseudo-element rule**

If visual QA shows the aurora running before `mt-aurora-on` is added, change:

```css
.mt-net-card::before {
```

to:

```css
.mt-net-card.mt-aurora-on::before {
```

Expected:

```text
Card still looks good before class injection, and aurora starts after renderDashboard enhancement runs.
```

- [ ] **Step 3: Run the full existing test suite**

Run:

```bash
node --test tests/*.test.js
```

Expected:

```text
# pass
```

All tests should pass, including the new static test and existing finance/credit/shared reimbursement tests.

---

### Task 5: Browser QA In Light And Dark Mode

**Files:**
- No planned code changes unless QA finds visual issues.

- [ ] **Step 1: Start a local server**

Run:

```bash
python3 -m http.server 4173
```

Expected:

```text
Serving HTTP on :: port 4173
```

- [ ] **Step 2: Open the app in the in-app Browser**

Open:

```text
http://localhost:4173/index.html
```

Expected:

```text
Dashboard loads without console errors caused by the redesigned net card.
```

- [ ] **Step 3: Verify light mode against the concept**

Checklist:

- [ ] `สินทรัพย์สุทธิ` is top-left and readable.
- [ ] `.mt-net-value` is large, white, and digit-roll animation still runs after dashboard render.
- [ ] `เงินพร้อมใช้` appears below the value with a chevron.
- [ ] Sparkline sits behind/lower center without covering text.
- [ ] Donut reads `Healthy` and percentage text is centered.
- [ ] Bottom row shows `รายรับ`, `รายจ่าย`, `หนี้สิน`, `บิลค้างจ่าย` with matching colors.
- [ ] Metric row is integrated with the card, not a separate plain text strip.
- [ ] No text overlaps or clipped money values.

- [ ] **Step 4: Verify dark mode**

Toggle dark mode using the app's existing theme control or by setting `html.dark` in DevTools.

Checklist:

- [ ] Card background becomes deeper navy, not black-on-black.
- [ ] Divider, icon containers, sparkline, and donut remain visible.
- [ ] White text and secondary labels have enough contrast.
- [ ] Page background and card shadow/border look intentional.

- [ ] **Step 5: Verify narrow mobile layout**

Set viewport to around `390x844`.

Checklist:

- [ ] Top hero remains readable with donut on the right.
- [ ] Sparkline moves below top hero content and does not collide with the bottom metric row.
- [ ] Bottom metrics collapse to a clean 2-column grid.
- [ ] Long Thai labels and money values do not overflow.

---

### Task 6: Final Cleanup And Handoff

**Files:**
- Modify only if previous tasks produced temporary artifacts.

- [ ] **Step 1: Confirm no debug artifacts remain**

Run:

```bash
rg -n "console\\.log|debug net|temporary|TODO|TBD" app_v2.js style_v2.css tests/dashboard_net_card_static.test.js
```

Expected:

```text
No matches from the new work, except existing unrelated project content if present.
```

- [ ] **Step 2: Check changed files**

Run:

```bash
git diff -- app_v2.js style_v2.css tests/dashboard_net_card_static.test.js
```

Expected:

```text
Diff only includes the redesigned dashboard net card, scoped CSS, and the static regression test.
```

- [ ] **Step 3: Run final verification**

Run:

```bash
node --test tests/*.test.js
```

Expected:

```text
# pass
```

---

## Self-Review

- Spec coverage: The plan covers the approved image's headline, usable cash, Healthy donut, sparkline, four metric blocks, integrated `mt-net-split`, preserved animations, light mode, dark mode, and mobile layout.
- Placeholder scan: No implementation step uses `TBD`, `TODO`, or vague "add appropriate" instructions.
- Type consistency: Helper names are defined before use: `renderNetSparkline`, `renderNetRing`, `renderNetMetric`, `healthyPct`, and `sparkValues`.
- Risk notes: The comparison subtexts should be computed from the previous month when data exists, with neutral fallback text when there is no previous baseline. Do not ship hard-coded comparison percentages as real finance data.
