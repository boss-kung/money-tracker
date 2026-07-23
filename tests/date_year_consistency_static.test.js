const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app_v2.js'), 'utf8')
const Calc = require(path.join(root, 'calculations.js'))

test('Calc.monthLabel renders Buddhist Era (พ.ศ.) year', () => {
  assert.equal(Calc.monthLabel('2026-07'), 'ก.ค. 2569')
})

test('dashboard month-chip helper (mlabel) delegates to Calc.monthLabel instead of re-implementing its own ค.ศ. label', () => {
  const fnMatch = app.match(/function mlabel\(ym\) \{[\s\S]*?\n  \}/)
  assert.ok(fnMatch, 'mlabel() function not found')
  assert.ok(
    fnMatch[0].includes('Calc.monthLabel'),
    'mlabel() must delegate to Calc.monthLabel to avoid a second, divergent ค.ศ./พ.ศ. implementation'
  )
})

test('reports year-selector chip displays พ.ศ. (y + 543), matching the month chips below it', () => {
  const chipLine = app.split('\n').find(l => l.includes('App._setRptYear(${y})'))
  assert.ok(chipLine, 'report year chip line not found')
  assert.ok(
    chipLine.includes('${y + 543}'),
    'report year chip must render y + 543 (พ.ศ.) — it sits next to month chips that already use Calc.monthLabel (พ.ศ.)'
  )
})
