;(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MTUpcomingObligations=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const cents=v=>Number.isFinite(Number(v))?Math.max(0,Math.round(Number(v)*100)):0
  function projectCreditObligations({billingStates=[],transactions=[],refDate,endDate}) {
    const rows=[]
    for(const state of billingStates) {
      const card=state.card, cardId=card?.id || state.cardId || state.statements[0]?.cardId
      const obligations=state.statements.filter(s=>s.balanceDue>0).map(s=>({...s,remaining:cents(s.balanceDue),planned:0,plannedAfterDue:false}))
        .sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.id.localeCompare(b.id))
      const plans=transactions.filter(t=>t.type==='cc_payment' && t.toWalletId===cardId && t.date>refDate && t.date<=endDate)
        .slice().sort((a,b)=>a.date.localeCompare(b.date)||Number(a.createdSequence||0)-Number(b.createdSequence||0)||String(a.id).localeCompare(String(b.id)))
      for(const tx of plans) {
        let remaining=cents(tx.amount)
        const allocations=[]
        const target=obligations.find(s=>s.id===tx.statementId)
        const ordered=target?[target,...obligations.filter(s=>s!==target)]:obligations
        for(const st of ordered) {
          const amount=Math.min(remaining,st.remaining)
          if(amount>0) {
            st.remaining-=amount;st.planned+=amount;remaining-=amount
            st.plannedAfterDue ||= tx.date>st.dueDate
            allocations.push({statementId:st.id,amount:amount/100})
          }
        }
        const cashRequired=cents(tx.cashAmount ?? tx.amount)/100
        rows.push({id:`tx-${tx.id}`,date:tx.date,icon:'📅',title:tx.note || 'แผนชำระบัตร',type:'scheduled',cashflowKind:'settlement',amount:cashRequired,cashRequired,walletId:tx.walletId,toWalletId:cardId,statementId:tx.statementId,linkedAllocations:allocations,status:'upcoming'})
      }
      for(const st of obligations.filter(s=>s.end<refDate && s.dueDate<=endDate)) {
        rows.push({id:`cc-${cardId}:${st.id}`,date:st.dueDate,icon:card?.icon || '💳',title:`ชำระบัตร ${card?.name || ''}`,type:'credit_due',cashflowKind:'settlement',statementId:st.id,toWalletId:cardId,amount:st.balanceDue,plannedAmount:st.planned/100,unplannedAmount:st.remaining/100,cashRequired:st.remaining/100,plannedAfterDue:st.plannedAfterDue,status:st.dueDate<refDate?'overdue':'upcoming'})
      }
    }
    return rows
  }
  function getUpcomingCashRequirement(rows=[]) {
    return rows.reduce((sum,row)=>sum+(['expense','settlement'].includes(row.cashflowKind)?cents(row.cashRequired ?? row.amount):0),0)/100
  }
  return {projectCreditObligations,getUpcomingCashRequirement}
})
