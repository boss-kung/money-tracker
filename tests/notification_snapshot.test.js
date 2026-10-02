const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs')
function api(){assert.ok(fs.existsSync(require('node:path').join(__dirname,'../notification_snapshot.js')),'numeric snapshot module exists');return require('../notification_snapshot.js')}
test('signed days and invalid dates are never converted into due-today signals',()=> {
 const N=api();assert.deepEqual(N.sanitizeDaysLeft([{daysLeft:-10},{daysLeft:NaN},{daysLeft:Infinity},{}]),[{daysLeft:-10}])
 assert.deepEqual(N.buildBillSignals({bills:[{status:'pending',dueDate:'2026-05-24'},{status:'pending',dueDate:'2026-02-30'}],snapshotDate:'2026-06-03'}),[{daysLeft:-10}])
})
test('snapshot preserves every distinct due day without sending financial details',()=> {
 const N=api(),rows=Array.from({length:40},(_,i)=>({balanceDue:1000+i,dueDate:`2026-07-${String(i%28+1).padStart(2,'0')}`,id:'secret',title:'secret'}))
 const signals=N.buildCreditSignals({billingStates:[{payableStatements:rows}],snapshotDate:'2026-06-03'})
 assert.equal(signals.length,28);assert.ok(signals.every(s=>Object.keys(s).join(',')==='daysLeft'))
})
test('snapshot date changes consistently at Bangkok midnight',()=> {
 assert.equal(api().bangkokDate(new Date('2026-06-02T17:00:00Z')),'2026-06-03')
 assert.equal(api().calendarDaysBetween('2026-06-02','2026-06-03'),1)
})
