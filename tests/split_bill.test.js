const test = require('node:test')
const assert = require('node:assert/strict')

global.localStorage = (() => {
  const map = new Map()
  return {
    getItem: k => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  }
})()

global.window = global
global.App = {}
global.document = {
  getElementById: () => null,
  createElement: () => ({}),
  head: { appendChild: () => {} },
}

require('../split_bill.js')

const people = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
]

function resetPeople() {
  localStorage.setItem('mt_split_people', JSON.stringify(people))
}

test('split bill final total matches preview total after per-person rounding', () => {
  resetPeople()
  const draft = {
    peopleIds: people.map(p => p.id),
    items: [
      {
        id: 'item-1',
        name: 'Meal',
        price: 100,
        splitMode: 'equal',
        participants: people.map(p => ({ personId: p.id, ratio: 1 })),
      },
    ],
    pipeline: [],
    payments: { a: 100 },
    rounding: { mode: 'off', amount: 0 },
  }

  const previewTotal = SplitBillCalc.runPipeline(SplitBillCalc.itemSubtotal(draft), draft.pipeline, draft.rounding).finalTotal
  const result = SplitBillCalc.calcResult(draft)
  const shareTotal = result.personResults.reduce((sum, row) => Math.round((sum + row.finalShare) * 100) / 100, 0)
  const transferTotal = result.transfers.reduce((sum, row) => Math.round((sum + row.amount) * 100) / 100, 0)

  assert.equal(previewTotal, 100)
  assert.equal(result.finalTotal, previewTotal)
  assert.equal(shareTotal, previewTotal)
  assert.equal(transferTotal, 66.66)
  assert.deepEqual(result.transfers.map(t => t.amount), [33.33, 33.33])
})

test('split bill uses item subtotal as the single source of truth with fees', () => {
  resetPeople()
  const draft = {
    peopleIds: people.map(p => p.id),
    items: [
      {
        id: 'item-1',
        name: 'Meal',
        price: 100,
        splitMode: 'equal',
        participants: people.map(p => ({ personId: p.id, ratio: 1 })),
      },
    ],
    pipeline: [
      { id: 'vat', type: 'vat', label: 'VAT', enabled: true, mode: 'percent', value: 7, base: 'running' },
    ],
    payments: { a: 107 },
    rounding: { mode: 'off', amount: 0 },
  }

  const previewTotal = SplitBillCalc.runPipeline(SplitBillCalc.itemSubtotal(draft), draft.pipeline, draft.rounding).finalTotal
  const result = SplitBillCalc.calcResult(draft)
  const shareTotal = result.personResults.reduce((sum, row) => Math.round((sum + row.finalShare) * 100) / 100, 0)

  assert.equal(previewTotal, 107)
  assert.equal(result.finalTotal, previewTotal)
  assert.equal(shareTotal, previewTotal)
  assert.equal(result.warnings.length, 0)
})
