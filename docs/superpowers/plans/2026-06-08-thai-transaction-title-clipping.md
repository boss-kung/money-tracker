# Thai Transaction Title Clipping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Thai tone marks in transaction titles, for example "เสื้อ", from being clipped in the "รายการ" transaction list.

**Architecture:** Fix the typography at the source: the rendered transaction title class `.tx-row-modern .tx-title`. Keep horizontal ellipsis behavior, but give the line box enough vertical room for Thai glyph marks. Add a static CSS regression test so later compact-density overrides cannot silently reintroduce the clipping.

**Tech Stack:** Vanilla HTML/CSS/JS, `node:test`, static CSS source tests.

---

## Root Cause

Browser inspection on `demo/index.html#transactions` shows transaction titles render as `.tx-title` inside `.tx-row-modern` from `App._txRow` in `app_v2.js`.

Effective computed style for a transaction title:

- `font-family`: `"LINE Seed Sans TH", ...`
- `font-size`: `16px`
- `line-height`: `18.56px` from `.tx-row-modern .tx-title { line-height: 1.16 !important; }`
- `overflow`: `hidden`, inherited from the base `.tx-title` ellipsis rule
- `white-space`: `nowrap`

The base `.tx-title` rule intentionally uses `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`. The clipping appears because the more specific compact row rule sets `line-height:1.16 !important`, while later Thai-safe global rules such as `.tx-title { line-height:1.38 !important; }` cannot win due to lower specificity.

## Files

- Modify: `style_v2.css`
- Create: `tests/thai_text_clipping_static.test.js`

## Task 1: Add Regression Test

- [ ] **Step 1: Create a static test for Thai-safe transaction title CSS**

Create `tests/thai_text_clipping_static.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const css = fs.readFileSync(path.join(__dirname, '..', 'style_v2.css'), 'utf8')

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'm'))
  assert.ok(match, `${selector} rule should exist`)
  return match[1]
}

test('modern transaction titles use a Thai-safe line-height while keeping ellipsis', () => {
  const baseTitle = ruleBody('.tx-title')
  const modernTitle = ruleBody('.tx-row-modern .tx-title')

  assert.match(baseTitle, /overflow:\\s*hidden/)
  assert.match(baseTitle, /text-overflow:\\s*ellipsis/)
  assert.match(baseTitle, /white-space:\\s*nowrap/)
  assert.match(modernTitle, /line-height:\\s*1\\.(3[5-9]|4\\d)\\s*!important/)
})
```

- [ ] **Step 2: Run the new test and verify it fails before the fix**

Run:

```bash
node --test tests/thai_text_clipping_static.test.js
```

Expected: FAIL because `.tx-row-modern .tx-title` currently sets `line-height:1.16 !important`.

## Task 2: Fix Transaction Title Typography

- [ ] **Step 1: Update only the specific modern transaction title rule**

Modify `style_v2.css` at the existing `.tx-row-modern .tx-title` rule:

```css
.tx-row-modern .tx-title {
  font-size:16px !important;
  line-height:1.38 !important;
  font-weight: 700 !important;
  letter-spacing:0 !important;
}
```

Rationale:

- `line-height:1.38` gives Thai tone marks and below-baseline marks room inside the clipped ellipsis box.
- Keeping `overflow:hidden`, `text-overflow:ellipsis`, and `white-space:nowrap` preserves single-line truncation.
- `letter-spacing:0` follows the project design rule and avoids tightening Thai text shapes.

- [ ] **Step 2: Run the targeted regression test**

Run:

```bash
node --test tests/thai_text_clipping_static.test.js
```

Expected: PASS.

## Task 3: Verify In Browser

- [ ] **Step 1: Start a static server**

Run:

```bash
python3 -m http.server 4173
```

- [ ] **Step 2: Open the demo transactions page**

Open:

```text
http://127.0.0.1:4173/demo/index.html?nosw=1#transactions
```

- [ ] **Step 3: Inspect computed style**

Expected for `#tx-list-content .tx-row-modern .tx-title`:

- `font-size`: `16px`
- `line-height`: about `22.08px`
- `overflow`: `hidden`
- `white-space`: `nowrap`

- [ ] **Step 4: Visual check**

Create or use a transaction title containing `เสื้อ` and confirm the `้` mark is visible, with no top/bottom clipping in the transaction list.

## Self-Review

- Spec coverage: Covers root cause and fix plan for Thai clipping on the "รายการ" transaction list.
- Placeholder scan: No TODO/TBD placeholders remain.
- Type consistency: Only CSS and static source test changes are required; no JS API changes.
