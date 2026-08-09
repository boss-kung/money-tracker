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
    if (!tx || tx.scheduled !== true) return true
    return String(tx.date || '') <= String(today || todayLocalISO())
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
      addCash(loan.walletId, -Number(loan.amount || 0))
      ;(loan.repayments || []).forEach(repayment => addCash(repayment.walletId, Number(repayment.amount || 0)))
    })

    return { cash, units }
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
    getLedgerAmountForTx,
    getCCPaymentCashAmount,
    compute,
    validateIntegrity,
    reconcileWallets,
  })
})
