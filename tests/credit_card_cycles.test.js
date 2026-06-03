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

test('credit due notification excludes current-cycle-only spending', () => {
  const rows = CC.getCreditDueNotificationRows({
    cards:[card],
    transactions:[{ id:'new', type:'expense', walletId:'ktc', amount:9000, date:'2026-06-01' }],
    refDate:'2026-06-03',
    hideAmounts:false,
  })
  assert.deepEqual(rows, [])
})

test('detail history starts with current open cycle and then previous month', () => {
  const midMonthCard = { ...card, id:'scb', cycleDay:19, dueAfterCycleDays:10 }
  const rows = CC.getStatementHistory({
    card: midMonthCard,
    transactions:[
      { id:'current', type:'expense', walletId:'scb', amount:900, date:'2026-06-03' },
      { id:'prev', type:'expense', walletId:'scb', amount:700, date:'2026-05-01' },
      { id:'older', type:'expense', walletId:'scb', amount:500, date:'2026-04-01' },
    ],
    refDate:'2026-06-03',
    includeOpen:true,
    count:3,
  })
  assert.equal(rows[0].start, '2026-05-20')
  assert.equal(rows[0].end, '2026-06-19')
  assert.equal(rows[1].start, '2026-04-20')
  assert.equal(rows[1].end, '2026-05-19')
  assert.equal(rows[2].start, '2026-03-20')
  assert.equal(rows[2].end, '2026-04-19')
})
