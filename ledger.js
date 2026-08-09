/* ============================================================
   Ledger Module
   Source of truth for Posted Transactions, Ledger Amounts, flows,
   integrity checks, and Wallet reconciliation.
   ============================================================ */
'use strict'

;(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.MTLedger = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const INVESTMENT_WALLET_TYPES = new Set(['gold', 'crypto', 'fcd'])

  const round2 = value => Math.round((Number(value) || 0) * 100) / 100
  const round8 = value => Math.round((Number(value) || 0) * 1e8) / 1e8

  function todayLocalISO() {
    const date = new Date()
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  function isPostedTx(tx, today = todayLocalISO()) {
    if (!tx) return false
    const txDate = String(tx.date || '')
    if (!txDate) return true
    return txDate <= String(today || todayLocalISO())
  }

  function isDatedActivityPosted(activity, today = todayLocalISO()) {
    if (!activity) return false
    const date = String(activity.date || '')
    return !date || date <= String(today || todayLocalISO())
  }

  function isLoanRepaymentPosted(loan, repayment, today = todayLocalISO()) {
    if (!isDatedActivityPosted(repayment, today)) return false
    const loanDate = String(loan?.date || '')
    const repaymentDate = String(repayment?.date || '')
    return !loanDate || !repaymentDate || repaymentDate >= loanDate
  }

  function getLoanContractRemaining(loan, today = todayLocalISO()) {
    const principal = Math.max(0, round2(loan?.amount))
    let remaining = principal
    const repayments = [...(loan?.repayments || [])]
      .filter(repayment => isLoanRepaymentPosted(loan, repayment, today))
      .sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')))
    repayments.forEach(repayment => {
      const amount = Math.max(0, round2(repayment?.amount))
      remaining = round2(Math.max(0, remaining - Math.min(remaining, amount)))
    })
    return remaining
  }

  function getLoanReceivable(loan, today = todayLocalISO()) {
    if (!isDatedActivityPosted(loan, today)) return 0
    return getLoanContractRemaining(loan, today)
  }

  function validateLoanRepayment(loan, repayment, today = todayLocalISO()) {
    const amount = round2(repayment?.amount)
    if (!(amount > 0)) return { ok:false, code:'INVALID_AMOUNT', remaining:getLoanContractRemaining(loan, today) }
    if (String(repayment?.date || '') < String(loan?.date || '')) return { ok:false, code:'BEFORE_LOAN_DATE', remaining:getLoanContractRemaining(loan, today) }
    if (!isDatedActivityPosted(repayment, today)) return { ok:false, code:'FUTURE_DATE', remaining:getLoanContractRemaining(loan, today) }
    const remaining = getLoanContractRemaining(loan, today)
    if (amount > remaining + 0.005) return { ok:false, code:'OVERPAYMENT', remaining }
    return { ok:true, code:'', remaining }
  }

  function getCCPaymentCashAmount(tx) {
    if (!tx || tx.type !== 'cc_payment') return round2(tx?.amount)
    const cashAmount = Number(tx.cashAmount)
    return Number.isFinite(cashAmount) && cashAmount > 0 ? round2(cashAmount) : round2(tx.amount)
  }

  function getLedgerAmountForTx(tx, { wallets = [], rewardForTx = null, preferStored = true } = {}) {
    if (preferStored && 'ledgerAmount' in (tx || {}) && Number.isFinite(Number(tx?.ledgerAmount))) {
      return round2(tx.ledgerAmount)
    }
    const baseAmount = round2(tx?.amount)
    if (!tx || tx.type !== 'expense') return baseAmount
    const wallet = (wallets || []).find(row => row?.id === tx.walletId)
    if (!wallet || wallet.type !== 'credit') return baseAmount
    if (Number(tx.instantDiscountAmount || 0) > 0) return baseAmount
    const reward = typeof rewardForTx === 'function' ? rewardForTx(tx) : tx.rewardEstimate
    const discount = Math.max(0, round2(reward?.discount))
    return discount > 0 ? round2(Math.max(0, baseAmount - discount)) : baseAmount
  }

  function compute({ transactions = [], wallets = [], loans = [], today = todayLocalISO(), rewardForTx = null } = {}) {
    const cash = {}
    const units = {}
    const addCash = (id, value) => { if (id) cash[id] = round2((cash[id] || 0) + Number(value || 0)) }
    const addUnits = (id, value) => { if (id) units[id] = round8((units[id] || 0) + Number(value || 0)) }

    ;(transactions || []).forEach(tx => {
      if (!isPostedTx(tx, today)) return
      const amount = tx.type === 'expense'
        ? getLedgerAmountForTx(tx, { wallets, rewardForTx, preferStored:false })
        : getLedgerAmountForTx(tx, { wallets, rewardForTx, preferStored:true })
      const unitAmount = Number(tx.unitsDelta || tx.units || 0)
      if (!amount && !unitAmount) return

      if (tx.type === 'income') addCash(tx.walletId, amount)
      else if (tx.type === 'expense') addCash(tx.walletId, -amount)
      else if (tx.type === 'transfer') { addCash(tx.walletId, -amount); addCash(tx.toWalletId, amount) }
      else if (tx.type === 'cc_payment') { addCash(tx.walletId, -getCCPaymentCashAmount(tx)); addCash(tx.toWalletId, amount) }
      else if (tx.type === 'investment_buy') { addCash(tx.cashWalletId || tx.sourceWalletId, -amount); addUnits(tx.walletId, tx.units) }
      else if (tx.type === 'investment_sell') { addCash(tx.cashWalletId || tx.sourceWalletId, amount); addUnits(tx.walletId, -Math.abs(Number(tx.units || 0))) }
      else if (tx.type === 'investment_adjust') addUnits(tx.walletId, tx.unitsDelta || tx.units)
      else if (tx.type === 'bnpl_payment') { addCash(tx.walletId, -amount); addCash(tx.toWalletId, amount) }
    })

    ;(loans || []).forEach(loan => {
      if (!isDatedActivityPosted(loan, today)) return
      let remaining = Math.max(0, round2(loan.amount))
      addCash(loan.walletId, -remaining)
      ;[...(loan.repayments || [])]
        .filter(repayment => isLoanRepaymentPosted(loan, repayment, today))
        .sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')))
        .forEach(repayment => {
          const credited = Math.min(remaining, Math.max(0, round2(repayment.amount)))
          if (!(credited > 0)) return
          addCash(repayment.walletId, credited)
          remaining = round2(remaining - credited)
        })
    })

    return { cash, units }
  }

  function getCommittedInstallmentDebt({ transactions = [], today = todayLocalISO(), walletId = '', amountForTx = null } = {}) {
    return round2((transactions || []).reduce((sum, tx) => {
      if (!tx?.installmentGroupId || tx.type !== 'expense' || isPostedTx(tx, today)) return sum
      if (walletId && String(tx.walletId || '') !== String(walletId)) return sum
      const amount = typeof amountForTx === 'function' ? amountForTx(tx) : getLedgerAmountForTx(tx)
      return sum + Math.max(0, Number(amount || 0))
    }, 0))
  }

  function getFinancialPosition({
    wallets = [],
    loans = [],
    today = todayLocalISO(),
    cryptoValue = 0,
    committedLiabilities = 0,
    walletValue = wallet => Number(wallet?.balance || 0),
    excludeWalletTypes = [],
  } = {}) {
    const excludedTypes = new Set((excludeWalletTypes || []).map(type => String(type || '').toLowerCase()))
    let walletAssets = 0
    let walletLiabilities = 0
    ;(wallets || []).forEach(wallet => {
      if (!wallet || wallet.excludeFromNetWorth || excludedTypes.has(String(wallet.type || '').toLowerCase())) return
      const value = Number(walletValue(wallet) || 0)
      if (!Number.isFinite(value)) return
      if (value >= 0) walletAssets += value
      else walletLiabilities += Math.abs(value)
    })
    const receivables = (loans || []).reduce((sum, loan) => sum + getLoanReceivable(loan, today), 0)
    const crypto = Math.max(0, Number(cryptoValue || 0))
    const committed = Math.max(0, Number(committedLiabilities || 0))
    const assets = walletAssets + receivables + crypto
    const liabilities = walletLiabilities + committed
    return {
      walletAssets:round2(walletAssets),
      receivables:round2(receivables),
      crypto:round2(crypto),
      assets:round2(assets),
      walletLiabilities:round2(walletLiabilities),
      committedLiabilities:round2(committed),
      liabilities:round2(liabilities),
      net:round2(assets - liabilities),
    }
  }

  function validateIntegrity({ transactions = [], wallets = [], today = todayLocalISO() } = {}) {
    const walletIds = new Set((wallets || []).map(wallet => wallet?.id).filter(Boolean))
    const issues = []
    ;(transactions || []).forEach(tx => {
      if (!isPostedTx(tx, today)) return
      if (!tx.walletId || !walletIds.has(tx.walletId)) issues.push({ txId:tx.id, date:tx.date, field:'walletId', value:tx.walletId })
      if ((tx.type === 'transfer' || tx.type === 'cc_payment') && (!tx.toWalletId || !walletIds.has(tx.toWalletId))) {
        issues.push({ txId:tx.id, date:tx.date, field:'toWalletId', value:tx.toWalletId })
      }
    })
    return issues
  }

  function reconcileWallets({ wallets = [], flows = { cash:{}, units:{} }, investmentUnitPrice = () => 0 } = {}) {
    return (wallets || []).map(wallet => {
      if (INVESTMENT_WALLET_TYPES.has(String(wallet?.type || '').toLowerCase())) {
        const units = round8(Number(wallet.openingUnits || 0) + Number(flows.units?.[wallet.id] || 0))
        return { id:wallet.id, units, balance:round2(units * Number(investmentUnitPrice(wallet) || 0)) }
      }
      return { id:wallet.id, balance:round2(Number(wallet.openingBalance || 0) + Number(flows.cash?.[wallet.id] || 0)) }
    })
  }

  return Object.freeze({
    isPostedTx,
    isDatedActivityPosted,
    getLedgerAmountForTx,
    getCCPaymentCashAmount,
    getLoanContractRemaining,
    getLoanReceivable,
    validateLoanRepayment,
    compute,
    getCommittedInstallmentDebt,
    getFinancialPosition,
    validateIntegrity,
    reconcileWallets,
  })
})
