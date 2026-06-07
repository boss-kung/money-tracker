# Privilege Note Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make URLs inside privilege note text clickable while fixing multiline note layout in the privilege detail sheet.

**Architecture:** Keep the change local to the existing privileges IIFE. Add one renderer that escapes note text, linkifies only `http://` and `https://` URL tokens, and renders the note as a dedicated detail row with note-specific CSS.

**Tech Stack:** Vanilla JavaScript, static HTML strings, CSS, Node built-in `node:test`.

---

### Task 1: Regression Coverage

**Files:**
- Create: `tests/privilege_note_link_static.test.js`

- [ ] **Step 1: Write the failing static tests**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')
const cssSource = fs.readFileSync(path.join(__dirname, '..', 'style_v2.css'), 'utf8')

function namedFunctionSource(name) {
  const marker = `function ${name}`
  const start = appSource.indexOf(marker)
  assert.notEqual(start, -1, `${name} should exist`)
  const nextFunction = appSource.indexOf('\n  function ', start + marker.length)
  const nextAppExport = appSource.indexOf('\n  App.', start + marker.length)
  const boundaries = [nextFunction, nextAppExport].filter(index => index !== -1)
  assert.ok(boundaries.length, `${name} should have a detectable boundary`)
  return appSource.slice(start, Math.min(...boundaries))
}

test('privilege detail note uses a dedicated linkified renderer', () => {
  const detailBody = namedFunctionSource('openPrivilegeDetailSheet')
  const noteRenderer = namedFunctionSource('renderPrivilegeNoteHtml')

  assert.doesNotMatch(detailBody, /privilege\.note\s*\?\s*\['หมายเหตุ',\s*privilege\.note\]/)
  assert.match(detailBody, /renderPrivilegeNoteHtml\s*\(\s*privilege\.note\s*\)/)
  assert.match(noteRenderer, /https\?:\\\/\\\//)
  assert.match(noteRenderer, /target="_blank"/)
  assert.match(noteRenderer, /rel="noopener noreferrer"/)
  assert.match(noteRenderer, /esc\s*\(/)
})

test('privilege detail note has multiline and long-url layout rules', () => {
  assert.match(cssSource, /\.privilege-detail-row-note\s+/)
  assert.match(cssSource, /\.privilege-detail-note-value\s+/)
  assert.match(cssSource, /white-space:\s*pre-wrap/)
  assert.match(cssSource, /overflow-wrap:\s*anywhere/)
  assert.match(cssSource, /min-width:\s*0/)
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/privilege_note_link_static.test.js`

Expected: FAIL because `renderPrivilegeNoteHtml` and note-specific CSS do not exist yet.

### Task 2: Implementation

**Files:**
- Modify: `app_v2.js`
- Modify: `style_v2.css`
- Modify: `index.html`

- [ ] **Step 1: Add the note renderer**

Add `renderPrivilegeNoteHtml(note)` inside the privileges IIFE. It should split note text around `http://` and `https://` URL tokens, escape non-URL text, escape URL attributes, keep trailing punctuation outside links, and return a dedicated `.privilege-detail-row-note` block.

- [ ] **Step 2: Use the renderer in the detail sheet**

Remove note from the generic `rows` list and append `${renderPrivilegeNoteHtml(privilege.note)}` after the generic rows.

- [ ] **Step 3: Add CSS**

Add `.privilege-detail-note-value` rules using `flex: 1`, `min-width: 0`, `text-align: left`, `white-space: pre-wrap`, and `overflow-wrap: anywhere`. Style note links with the app primary color.

- [ ] **Step 4: Bump cache version**

Update the `app_v2.js?v=...` query string in `index.html`.

### Task 3: Verification

- [ ] **Step 1: Run targeted test**

Run: `node --test tests/privilege_note_link_static.test.js`

Expected: PASS.

- [ ] **Step 2: Run related static test**

Run: `node --test tests/cc_benefit_rule_sheet_static.test.js`

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run: `node --test tests/`

Expected: PASS.
