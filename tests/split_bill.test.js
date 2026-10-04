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

test('Transaction linking can defer Split Bill storage until the enclosing commit', () => {
  const bill = { id:'deferred', title:'Meal', linkedTransactionId:'' }
  localStorage.setItem('mt_split_bills', JSON.stringify([bill]))
  global.S = { splitBills:[bill] }
  try {
    assert.equal(App.linkSplitBillToTransaction('deferred', 'tx-new', { save:false }), true)
    assert.equal(S.splitBills[0].linkedTransactionId, 'tx-new')
    assert.equal(JSON.parse(localStorage.getItem('mt_split_bills'))[0].linkedTransactionId, '')
    assert.equal(App.linkSplitBillToTransaction('deferred', 'tx-direct'), true)
    assert.equal(JSON.parse(localStorage.getItem('mt_split_bills'))[0].linkedTransactionId, 'tx-direct')
  } finally { delete global.S }
})

test('split bill validation rejects non-positive ratios and unassigned items', () => {
  resetPeople()
  const errors = SplitBillCalc.validateDraft({
    peopleIds: ['a', 'b'],
    items: [
      {
        name: 'Invalid ratio',
        price: 100,
        splitMode: 'ratio',
        participants: [{ personId: 'a', ratio: 1 }, { personId: 'b', ratio: -1 }],
      },
      { name: 'Unassigned', price: 20, splitMode: 'equal', participants: [] },
    ],
    pipeline: [],
    rounding: { mode: 'off', amount: 0 },
  })

  assert.deepEqual(errors.map(error => error.code), ['invalid_ratio', 'missing_participants'])
})

test('split bill validation rejects a negative item price before clamping it for display', () => {
  const errors = SplitBillCalc.validateDraft({
    peopleIds: ['a'],
    items: [{ price: -1, splitMode: 'equal', participants: [{ personId: 'a' }] }],
  })
  assert.equal(errors[0].code, 'invalid_price')
})

test('split bill calculation never returns a negative total after an excessive discount', () => {
  resetPeople()
  const result = SplitBillCalc.calcResult({
    peopleIds: ['a', 'b'],
    items: [{
      name: 'Meal',
      price: 100,
      discount: { enabled: true, mode: 'fixed', value: 150 },
      splitMode: 'equal',
      participants: [{ personId: 'a' }, { personId: 'b' }],
    }],
    pipeline: [],
    payments: {},
    rounding: { mode: 'off', amount: 0 },
  })

  assert.equal(result.finalTotal, 0)
  assert.equal(result.personResults.reduce((sum, row) => sum + row.finalShare, 0), 0)
})

test('split bill pipeline clamps malformed negative subtotals to zero', () => {
  const result = SplitBillCalc.runPipeline(-100, [{ enabled: true, type: 'service', mode: 'fixed', value: 10 }])
  assert.equal(result.finalTotal, 10)
})

test('split bill does not assign an unassigned item to another person', () => {
  resetPeople()
  const result = SplitBillCalc.calcResult({
    peopleIds: ['a', 'b'],
    items: [
      { name: 'Assigned', price: 100, splitMode: 'equal', participants: [{ personId: 'a' }] },
      { name: 'Unassigned', price: 50, splitMode: 'equal', participants: [] },
    ],
    pipeline: [],
    payments: {},
    rounding: { mode: 'off', amount: 0 },
  })

  assert.equal(result.personResults.find(row => row.id === 'a').finalShare, 100)
  assert.equal(result.personResults.find(row => row.id === 'b').finalShare, 0)
  assert.match(result.warnings[0], /ยังไม่ได้ระบุผู้ร่วมรายการ/)
})

test('split bill store keeps the previous state when the durable commit fails', () => {
  const previousBill = { id: 'old', title: 'Old bill' }
  const nextBill = { id: 'new', title: 'New bill' }
  localStorage.setItem('mt_split_bills', JSON.stringify([previousBill]))
  global.S = { splitBills: [previousBill] }
  global.App.saveAll = () => false

  try {
    assert.equal(SbStore.upsertBill(nextBill), false)
    assert.deepEqual(S.splitBills, [previousBill])
    assert.deepEqual(JSON.parse(localStorage.getItem('mt_split_bills')), [previousBill])
  } finally {
    global.App.saveAll = undefined
    delete global.S
  }
})

test('split bill store archives people without removing historical references', () => {
  const person = { id: 'a', name: 'A', archived: false }
  localStorage.setItem('mt_split_people', JSON.stringify([person]))
  global.S = { splitPeople: [person] }
  global.App.saveAll = () => {
    localStorage.setItem('mt_split_people', JSON.stringify(S.splitPeople))
    return true
  }

  try {
    assert.equal(SbStore.archivePerson('a'), true)
    assert.equal(SbStore.getPerson('a').archived, true)
  } finally {
    global.App.saveAll = undefined
    delete global.S
  }
})
