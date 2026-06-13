/* ============================================================
   Onboarding — New User Flow (B + D)
   Progressive checklist card + smart empty states
   Self-contained IIFE, no CSS file changes (inline styles only)
   Wraps App render functions — safe to disable by removing script tag
   ============================================================ */
;(function () {
  'use strict'
  if (typeof App === 'undefined' || typeof S === 'undefined') return

  // ── State helpers ────────────────────────────────────────────
  // localStorage key: 'mt_onboarding'
  // { dismissed, reportVisited, firstTxNudgeSeen, moreHintSeen }

  function _obGet() {
    try { return JSON.parse(localStorage.getItem('mt_onboarding') || '{}') } catch (_) { return {} }
  }
  function _obPatch(patch) {
    try { localStorage.setItem('mt_onboarding', JSON.stringify(Object.assign(_obGet(), patch))) } catch (_) {}
  }
  function _obDismissed() { return !!_obGet().dismissed }

  // ── Bootstrap: auto-dismiss for existing users ───────────────
  // If user already has wallet + transaction data (not a new user),
  // silently dismiss the checklist so they never see it.
  ;(function () {
    if (_obDismissed()) return
    const hasWallet = (S.wallets || []).filter(w => !w.hiddenFromWalletList).length > 0
    const hasTx     = (S.transactions || []).length > 0
    if (hasWallet && hasTx) _obPatch({ dismissed: true })
  })()

  // ── Shared helpers ───────────────────────────────────────────
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  // ════════════════════════════════════════════════════════════
  // PRIORITY 1: Checklist Card on Dashboard
  // Replaces the Phase 2 p2-setup-banner with a 3-step checklist.
  // Auto-ticks each step, disappears permanently when all done.
  // ════════════════════════════════════════════════════════════

  const _prevRenderDashboard = App.renderDashboard?.bind(App)
  App.renderDashboard = function () {
    if (_prevRenderDashboard) _prevRenderDashboard()

    // Always remove Phase 2 banners — checklist replaces them
    document.querySelector('.p2-setup-banner')?.remove()
    document.querySelector('.p2-first-tx-hint')?.remove()

    if (_obDismissed()) return

    const hasWallet = (S.wallets || []).filter(w => !w.hiddenFromWalletList).length > 0
    const hasTx     = (S.transactions || []).length > 0
    const reportVisited = !!_obGet().reportVisited

    // All done → dismiss permanently and stop rendering
    if (hasWallet && hasTx && reportVisited) {
      _obPatch({ dismissed: true })
      return
    }

    // Remove old checklist before re-injecting (prevent duplication on re-render)
    document.querySelector('.ob-checklist')?.remove()

    const netCard = document.querySelector('#dashboard-content .mt-net-card')
    if (!netCard) return

    const doneCount = [hasWallet, hasTx, reportVisited].filter(Boolean).length
    const pct       = Math.round(doneCount / 3 * 100)

    function stepRow(done, emoji, label, action, disabled) {
      if (done) {
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border)">
          <span style="font-size:16px;width:22px;text-align:center;color:var(--income)">✓</span>
          <span style="flex:1;font-size:13px;color:var(--muted);text-decoration:line-through">${esc(label)}</span>
        </div>`
      }
      const btnStyle = disabled
        ? 'width:auto;flex-shrink:0;opacity:.35;cursor:not-allowed'
        : 'width:auto;flex-shrink:0'
      const btnAttr  = disabled ? 'disabled' : `onclick="${esc(action)}"`
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border)">
        <span style="font-size:16px;width:22px;text-align:center">${esc(emoji)}</span>
        <span style="flex:1;font-size:13px;color:var(--text)">${esc(label)}</span>
        <button class="btn btn-primary btn-sm" style="${btnStyle}" ${btnAttr}>ทำเลย</button>
      </div>`
    }

    const card = document.createElement('div')
    card.className = 'card card-pad ob-checklist'
    card.style.cssText = 'margin-top:16px;margin-bottom:16px'
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:13px;font-weight:600;color:var(--text)">เริ่มต้น 3 ขั้น</span>
        <span style="font-size:12px;color:var(--muted)">${doneCount}/3 เสร็จแล้ว</span>
      </div>
      <div style="height:4px;background:var(--border);border-radius:999px;overflow:hidden;margin-bottom:4px">
        <div style="height:100%;width:${pct}%;background:var(--primary);border-radius:999px;transition:width .4s"></div>
      </div>
      ${stepRow(hasWallet, '👛', 'เพิ่มกระเป๋าเงิน', "App.showPage('wallets')", false)}
      ${stepRow(hasTx,     '📝', 'บันทึกรายการแรก',  'App.openAddTx()',          !hasWallet)}
      ${stepRow(reportVisited, '📊', 'ดูรายงานเดือนนี้', "App.showPage('reports')", !hasTx)}
    `
    netCard.insertAdjacentElement('afterend', card)
  }

  // ════════════════════════════════════════════════════════════
  // PRIORITY 2a: Track when user visits Reports tab
  // Sets reportVisited flag → triggers checklist step 3 tick
  // ════════════════════════════════════════════════════════════

  const _prevShowPageOB = App.showPage?.bind(App)
  App.showPage = function (page) {
    if (page === 'reports' && !_obDismissed() && !_obGet().reportVisited) {
      _obPatch({ reportVisited: true })
    }
    return _prevShowPageOB?.(page)
  }

  // ════════════════════════════════════════════════════════════
  // PRIORITY 2b: First-Tx Toast Nudge
  // Shows a one-time toast 600ms after saving the first transaction
  // ════════════════════════════════════════════════════════════

  const _prevSaveTxOB = App.saveTx?.bind(App)
  App.saveTx = function (...args) {
    const txCountBefore = (S.transactions || []).length
    const isEdit        = S.txMode === 'edit' && !!S.editingTxId
    if (_prevSaveTxOB) _prevSaveTxOB(...args)
    if (!isEdit && txCountBefore === 0 && (S.transactions || []).length > 0) {
      if (!_obGet().firstTxNudgeSeen) {
        _obPatch({ firstTxNudgeSeen: true })
        setTimeout(function () {
          try { toast('บันทึกรายการแรกแล้ว 🎉 ดูสรุปได้ที่ Reports', 'success') } catch (_) {}
        }, 600)
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // PRIORITY 3: Smart Empty State — Wallets Tab
  // Shows a welcome card with CTA when there are no wallets yet
  // ════════════════════════════════════════════════════════════

  const _prevRenderWalletsOB = App.renderWallets?.bind(App)
  App.renderWallets = function () {
    if (_prevRenderWalletsOB) _prevRenderWalletsOB()
    if (_obDismissed()) return

    const hasWallet = (S.wallets || []).filter(w => !w.hiddenFromWalletList).length > 0
    if (hasWallet) return

    const content = document.getElementById('wallets-content')
    if (!content || content.querySelector('.ob-wallet-hint')) return

    const hint = document.createElement('div')
    hint.className = 'ob-wallet-hint'
    hint.style.cssText = 'text-align:center;padding:20px 16px;background:var(--card);border-radius:var(--radius,12px);border:1px solid var(--border);margin-bottom:12px'
    hint.innerHTML = `
      <div style="font-size:32px;margin-bottom:6px">👛</div>
      <div style="font-size:14px;font-weight:600;margin-bottom:4px;color:var(--text)">ยังไม่มีกระเป๋าเงิน</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">เพิ่มบัญชีธนาคาร เงินสด หรือบัตรเครดิต</div>
      <button class="btn btn-primary btn-sm" style="width:auto" onclick="App.openWalletForm(null)">+ เพิ่มกระเป๋าแรก</button>
    `
    content.insertAdjacentElement('afterbegin', hint)
  }

  // ════════════════════════════════════════════════════════════
  // PRIORITY 4: Smart Empty State — Reports Tab
  // Shows a one-line hint with CTA when there are no transactions
  // ════════════════════════════════════════════════════════════

  const _prevRenderReportsOB = App.renderReports?.bind(App)
  App.renderReports = function () {
    if (_prevRenderReportsOB) _prevRenderReportsOB()
    if (_obDismissed()) return
    if ((S.transactions || []).length > 0) return

    const content = document.getElementById('reports-content')
    if (!content || content.querySelector('.ob-reports-hint')) return

    const hint = document.createElement('div')
    hint.className = 'ob-reports-hint'
    hint.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;padding:14px 16px;background:var(--card);border-radius:var(--radius,12px);border:1px solid var(--border);margin-bottom:12px;font-size:13px;color:var(--muted)'
    hint.innerHTML = `
      <span>📊 รายงานจะแสดงทันทีหลังบันทึกรายการแรก</span>
      <button class="btn btn-primary btn-sm" style="width:auto" onclick="App.openAddTx()">+ บันทึกรายการ</button>
    `
    content.insertAdjacentElement('afterbegin', hint)
  }

  // ════════════════════════════════════════════════════════════
  // PRIORITY 5: More Tab — One-time Context Hint
  // Nudges user toward Recurring after first transaction exists
  // but no advanced features are set up yet. Dismissable.
  // ════════════════════════════════════════════════════════════

  App._dismissMoreHint = function () {
    _obPatch({ moreHintSeen: true })
    document.querySelector('.ob-more-hint')?.remove()
  }

  const _prevRenderMoreOB = App.renderMore?.bind(App)
  App.renderMore = function () {
    if (_prevRenderMoreOB) _prevRenderMoreOB()
    if (_obGet().moreHintSeen) return

    const hasTx        = (S.transactions || []).length > 0
    const hasRecurring = (S.recurring || []).length > 0
    const hasBudget    = ((S.budgets || []).length + (S.incomeBudgets || []).length) > 0
    if (!hasTx || hasRecurring || hasBudget) return

    const content = document.getElementById('more-content')
    if (!content || content.querySelector('.ob-more-hint')) return

    // Find "ควบคุมเงินเดือนนี้" section title to inject before it
    const secTitles  = content.querySelectorAll('.sec-title')
    const targetSec  = Array.from(secTitles).find(el => el.textContent.includes('ควบคุมเงินเดือนนี้'))
    if (!targetSec) return

    const hint = document.createElement('div')
    hint.className = 'ob-more-hint'
    hint.style.cssText = 'display:flex;align-items:flex-start;gap:10px;background:var(--card);border-radius:var(--radius,12px);border:1px solid var(--border);padding:12px 14px;margin-bottom:8px'
    hint.innerHTML = `
      <span style="font-size:16px;margin-top:1px">💡</span>
      <span style="flex:1;font-size:13px;color:var(--muted)">มีรายการจ่ายซ้ำทุกเดือน? ตั้ง "รายการประจำ" ให้บันทึกเองอัตโนมัติ</span>
      <button class="btn-icon" style="font-size:13px;flex-shrink:0;padding:0 4px;line-height:1;color:var(--muted)" onclick="App._dismissMoreHint()" aria-label="ปิด">✕</button>
    `
    targetSec.insertAdjacentElement('beforebegin', hint)
  }

  // ════════════════════════════════════════════════════════════
  // INITIAL PAINT
  // init() in app_v2.js calls App.showPage(S.page) before this
  // script loads, so the first render happens without our wrappers.
  // Re-render the active page now so our empty states and checklist
  // are applied immediately on first load.
  // ════════════════════════════════════════════════════════════
  try {
    const p = S.page
    if      (p === 'dashboard') App.renderDashboard()
    else if (p === 'wallets')   App.renderWallets()
    else if (p === 'reports')   App.renderReports()
    else if (p === 'more')      App.renderMore()
  } catch (_) {}

})()
