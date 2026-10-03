const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// app_v2.js is a sequence of top-level IIFE blocks. A helper declared inside one
// block is invisible to the others; calling it from another block throws a
// ReferenceError that the surrounding try/catch or optional call usually hides.
const source = fs.readFileSync(path.join(__dirname, '..', 'app_v2.js'), 'utf8')
const lines = source.split('\n')

function topLevelBlocks() {
  const blocks = []
  let start = -1
  let depth = 0
  lines.forEach((line, index) => {
    // Some nested IIFEs are also written at column 0, so track nesting depth.
    if (/^;?\s*\((?:async\s+)?function\b/.test(line)) {
      if (depth === 0) start = index
      depth++
    } else if (depth > 0 && /^\}\)\(\);?\s*$/.test(line)) {
      depth--
      if (depth === 0) blocks.push({ startLine: start + 1, endLine: index + 1, text: lines.slice(start, index + 1).join('\n') })
    }
  })
  return blocks
}

const declarationPattern = /(?:^|[^\w$.])(?:function\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/g
// A preceding backslash means a regex escape such as \b( rather than a call.
const callPattern = /(?:^|[^\w$.'"`\\])([A-Za-z_$][\w$]*)\s*\(/g

function declaredNames(text) {
  return new Set([...text.matchAll(declarationPattern)].map(match => match[1]))
}

function stripStringsAndComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('app_v2 blocks only call helpers declared in their own scope or globally', () => {
  const blocks = topLevelBlocks()
  assert.ok(blocks.length > 30, 'expected the IIFE block structure of app_v2.js')
  // Script-level declarations start at column 0; anything nested is not global.
  const outside = lines.filter((_, index) => !blocks.some(block => index + 1 >= block.startLine && index + 1 <= block.endLine))
  const globals = new Set(outside.map(line => line.match(/^(?:async\s+)?(?:function\*?\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/)?.[1]).filter(Boolean))
  const localByBlock = blocks.map(block => declaredNames(block.text))
  const declaredSomewhereLocal = new Set(localByBlock.flatMap(names => [...names]))
  const problems = []
  blocks.forEach((block, index) => {
    const local = localByBlock[index]
    for (const match of stripStringsAndComments(block.text).matchAll(callPattern)) {
      const name = match[1]
      if (!declaredSomewhereLocal.has(name) || local.has(name) || globals.has(name)) continue
      problems.push(`${name} (block at line ${block.startLine})`)
    }
  })
  assert.deepEqual([...new Set(problems)], [])
})
