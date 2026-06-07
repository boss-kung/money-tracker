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

test('privilege note links force an external browser window from the tap handler', () => {
  const noteRenderer = namedFunctionSource('renderPrivilegeNoteHtml')
  const openHandler = namedFunctionSource('openPrivilegeNoteUrl')

  assert.match(noteRenderer, /onclick="App\.openPrivilegeNoteUrl\(event,\s*this\.href\)"/)
  assert.match(openHandler, /preventDefault\s*\(\s*\)/)
  assert.match(openHandler, /stopPropagation\s*\(\s*\)/)
  assert.match(openHandler, /window\.open\s*\(\s*href\s*,\s*'_blank'\s*\)/)
  assert.match(openHandler, /\.opener\s*=\s*null/)
  assert.match(openHandler, /^function openPrivilegeNoteUrl[\s\S]*https\?:\\\/\\\//)
})

test('privilege detail note has multiline and long-url layout rules', () => {
  assert.match(cssSource, /\.privilege-detail-row-note\s+/)
  assert.match(cssSource, /\.privilege-detail-note-value\s+/)
  assert.match(cssSource, /white-space:\s*pre-wrap/)
  assert.match(cssSource, /overflow-wrap:\s*anywhere/)
  assert.match(cssSource, /min-width:\s*0/)
})
