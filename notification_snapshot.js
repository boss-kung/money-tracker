;(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MTNotificationSnapshot=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function dateNumber(value) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return null
    const date=new Date(`${value}T00:00:00Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value ? date.getTime()/86400000:null
  }
  function calendarDaysBetween(from,to){const a=dateNumber(from),b=dateNumber(to);return a===null||b===null?null:b-a}
  function bangkokDate(now=new Date()){return new Date(now.getTime()+7*3600000).toISOString().slice(0,10)}
  function sanitizeDaysLeft(input) {
    if(!Array.isArray(input))return []
    return [...new Set(input.filter(v=>v && typeof v.daysLeft==='number' && Number.isFinite(v.daysLeft)).map(v=>Math.trunc(v.daysLeft)))].slice(0,100).map(daysLeft=>({daysLeft}))
  }
  function signals(dates,snapshotDate){return sanitizeDaysLeft(dates.map(date=>({daysLeft:calendarDaysBetween(snapshotDate,date)})).filter(s=>s.daysLeft!==null && s.daysLeft<=90))}
  function buildCreditSignals({billingStates=[],snapshotDate}){return signals(billingStates.flatMap(s=>s.payableStatements.filter(p=>p.balanceDue>0).map(p=>p.dueDate)),snapshotDate)}
  function buildBillSignals({bills=[],snapshotDate}){return signals(bills.filter(b=>b?.status==='pending').map(b=>b.dueDate),snapshotDate)}
  return {dateNumber,calendarDaysBetween,bangkokDate,sanitizeDaysLeft,buildCreditSignals,buildBillSignals}
})
