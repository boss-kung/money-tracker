const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const productionFiles = fs.readdirSync(root)
  .filter(name => name.endsWith('.js'))
  .map(name => path.join(root, name))

test('dynamic inline handlers use context-safe JavaScript arguments', () => {
  const unsafe = []
  const eventAttribute = /\bon[a-z]+\s*=\s*(["'])([\s\S]*?)\1/gi
  for (const file of productionFiles) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(eventAttribute)) {
      if (/\$\{\s*(?:esc|ESC)\s*\(/.test(match[2])) {
        unsafe.push(`${path.basename(file)}:${source.slice(0, match.index).split('\n').length}`)
      }
    }
  }
  assert.deepEqual(unsafe, [], `unsafe escapeHtml() arguments in event attributes: ${unsafe.join(', ')}`)
})

test('dynamic event attributes do not interpolate raw action source', () => {
  const unsafe = []
  const eventAttribute = /\bon[a-z]+\s*=\s*(["'])([\s\S]*?)\1/gi
  for (const file of productionFiles) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(eventAttribute)) {
      if (/\$\{\s*esc\s*\(\s*action\s*\)/.test(match[2])) {
        unsafe.push(`${path.basename(file)}:${source.slice(0, match.index).split('\n').length}`)
      }
    }
  }
  assert.deepEqual(unsafe, [], `raw executable event source found: ${unsafe.join(', ')}`)
})
