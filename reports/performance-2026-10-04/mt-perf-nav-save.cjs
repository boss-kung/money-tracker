const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('/Users/bosskung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

const root = path.resolve(__dirname, '../..')
const url = 'http://127.0.0.1:8765/index.html?nosw=1&nonoti=1&noapplock=1&noFinanceRebuild=1'
const outFile = path.join(__dirname, 'nav-save-evidence.json')

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const results = []
  for (const n of [1000, 5000]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
    await context.addInitScript(({ n }) => {
      const wallets = [{ id: 'bank', type: 'bank', name: 'Test bank', openingBalance: 50000, balance: 50000 }, ...Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, type: 'credit', name: `Test ${i}`, creditLimit: 100000, openingBalance: 0, balance: 0, cycleDay: 25, dueAfterCycleDays: 10 }))]
      const now = new Date()
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const transactions = Array.from({ length: n }, (_, i) => ({ id: `t${i}`, type: 'expense', walletId: i % 6 === 0 ? 'bank' : `c${(i - 1) % 5}`, amount: 100, ledgerAmount: 100, date: `${month}-${String((i % 28) + 1).padStart(2, '0')}`, categoryId: 'food', merchant: 'Test', note: '', createdSequence: i + 1 }))
      for (const [key, value] of Object.entries({ mt_wallets: wallets, mt_transactions: transactions, mt_categories: { expense: [{ id: 'food', name: 'Food', icon: '🍜' }], income: [] } })) localStorage.setItem(key, JSON.stringify(value))
      window.__perfLong = []
      new PerformanceObserver(list => window.__perfLong.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration })))).observe({ type: 'longtask', buffered: true })
    }, { n })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:8765/') ? route.continue() : route.abort())
    await page.goto(url, { waitUntil: 'load', timeout: 120000 })
    await page.waitForTimeout(1000)
    const result = await page.evaluate(async () => {
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const timed = async action => {
        const start = performance.now()
        await action()
        const syncMs = performance.now() - start
        await frame()
        return { syncMs, visibleMs: performance.now() - start }
      }
      const navigation = await timed(() => App.showPage('transactions'))
      const rowsInitial = document.querySelectorAll('#tx-list-content .tx-row, #tx-list-content .tx-row-modern').length
      const descendantsInitial = document.querySelectorAll('#app *').length
      App.loadMoreTransactions()
      await frame()
      const rowsAfterLoadMore = document.querySelectorAll('#tx-list-content .tx-row, #tx-list-content .tx-row-modern').length
      const save = await timed(() => persist('performance-probe', { dirtyKeys: ['transactions'] }))
      return { navigation, save, rowsInitial, rowsAfterLoadMore, descendantsInitial, descendantsAfterLoadMore: document.querySelectorAll('#app *').length, long: window.__perfLong || [], transactionCount: S.transactions.length }
    })
    results.push({ n, errors, ...result })
    await context.close()
  }
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), url, results }, null, 2))
  await browser.close()
  console.log(JSON.stringify({ outFile, samples: results.length }))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
