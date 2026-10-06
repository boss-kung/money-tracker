const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('/Users/bosskung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

const root = path.resolve(__dirname, '../..')
const url = 'http://127.0.0.1:8765/index.html?nosw=1&nonoti=1&noapplock=1&noFinanceRebuild=1'
const outFile = path.join(__dirname, 'boot-evidence.json')
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const results = []
  for (const n of [1000, 5000]) for (const rules of [false, true]) for (let run = 1; run <= 3; run++) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
    await context.addInitScript(({ n, rules }) => {
      const wallets = [{ id: 'bank', type: 'bank', name: 'Test bank', openingBalance: 50000, balance: 50000 }, ...Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, type: 'credit', name: `Test ${i}`, creditLimit: 100000, openingBalance: 0, balance: 0, cycleDay: 25, dueAfterCycleDays: 10 }))]
      const base = new Date()
      const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      const transactions = Array.from({ length: n }, (_, i) => ({ id: `t${i}`, type: 'expense', walletId: `c${i % 5}`, amount: 100, ledgerAmount: 100, date: iso(new Date(base.getFullYear(), base.getMonth() - (i % 6), 1)), categoryId: 'food', createdSequence: i + 1, merchant: 'Test', rewardRuleIds: rules ? [`r${i % 5}`] : [] }))
      const ruleRows = rules ? Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, cardId: `c${i}`, name: 'Cashback test', active: true, type: 'cashback', cashback: { mode: 'percent', rate: 1 }, limits: { maxRewardAmountPerCycle: 100 } })) : []
      for (const [key, value] of Object.entries({ mt_wallets: wallets, mt_transactions: transactions, mt_cc_benefit_rules: ruleRows, mt_cc_benefits: {}, mt_categories: { expense: [{ id: 'food', name: 'Food', icon: '🍜' }], income: [] } })) localStorage.setItem(key, JSON.stringify(value))
      window.__perfLong = []
      new PerformanceObserver(list => window.__perfLong.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration })))).observe({ type: 'longtask', buffered: true })
    }, { n, rules })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:8765/') ? route.continue() : route.abort())
    await page.goto(url, { waitUntil: 'load', timeout: 120000 })
    await page.waitForTimeout(1800)
    const sample = await page.evaluate(() => {
      const log = Array.isArray(window.__mtBootLog) ? window.__mtBootLog : []
      const first = log.find(entry => entry.name === 'app.firstRender.done')
      const long = window.__perfLong || []
      return { firstRender: first?.at || null, bootLog: log, long, txCount: S.transactions.length, ruleCount: S.ccBenefitRules.length, descendants: document.querySelectorAll('#app *').length }
    })
    results.push({ n, rules, run, errors, ...sample })
    await context.close()
  }
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), url, results }, null, 2))
  await browser.close()
  console.log(JSON.stringify({ outFile, samples: results.length }))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
