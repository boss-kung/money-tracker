const test = require('node:test')
const assert = require('node:assert/strict')

const GoldMarket = require('../gold_market.js')

function createStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
  }
}

test('normalises blank primary API payload as unusable', () => {
  const blankPayload = {
    status: 'success',
    response: {
      update_date: '',
      update_time: '',
      price: {
        gold: { buy: '', sell: '' },
        gold_bar: { buy: '', sell: '' },
      },
    },
  }

  assert.equal(GoldMarket.normaliseGoldPayload(blankPayload), null)
})

test('parses Aurora gold HTML card prices', () => {
  const html = `
    <h2>ราคาทองวันนี้ <span>+150</span></h2>
    <span>09:10 น. (ครั้งที่ 3)</span>
    <div>ทองคำแท่ง</div>
    <span>รับซื้อคืน</span><span>65,300</span>
    <span>ขายออก</span><span>65,500</span>
    <div>รับซื้อรูปพรรณออโรร่า</div>
    <span>63,341</span>
  `

  const row = GoldMarket.parseAuroraGold(html)

  assert.equal(row.jewelryBuy, 63341)
  assert.equal(row.barBuy, 65300)
  assert.equal(row.barSell, 65500)
  assert.equal(row.source, 'Aurora')
})

test('parses Gold Traders markdown text from readable proxy', () => {
  const text = `
    # ราคาทองตามประกาศ สมาคมค้าทองคำ
    ประจำวันที่ 13/06/2569 เวลา 09:08 (ครั้งที่ 1)
    ทองคำแท่ง 96.5%
    รับซื้อ 65,300.00
    ขายออก 65,500.00
    ทองรูปพรรณ 96.5%
    ฐานภาษี63,990.36
    ขายออก 66,300.00
  `

  const row = GoldMarket.parseGoldTradersText(text)

  assert.equal(row.jewelryBuy, 63990.36)
  assert.equal(row.jewelrySell, 66300)
  assert.equal(row.barBuy, 65300)
  assert.equal(row.barSell, 65500)
  assert.equal(row.source, 'Gold Traders Association')
})

test('falls back to Aurora proxy when primary API returns blank prices', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(url)
    if (url === 'https://api.chnwt.dev/thai-gold-api/latest') {
      return {
        ok: true,
        json: async () => ({
          response: {
            price: {
              gold: { buy: '', sell: '' },
              gold_bar: { buy: '', sell: '' },
            },
          },
        }),
      }
    }
    if (url === 'https://gold.example.test/aurora') {
      return {
        ok: true,
        text: async () => `
          <div>09:10 น. 3 65,300 65,500 63,341</div>
          <div>รับซื้อรูปพรรณออโรร่า</div>
        `,
      }
    }
    throw new Error(`unexpected URL ${url}`)
  }

  const row = await GoldMarket.fetchThaiGoldViaSource({
    fetchImpl,
    storage: createStorage(),
    goldTradersReadableUrls: [],
    auroraProxyUrl: 'https://gold.example.test/aurora',
    now: () => new Date('2026-06-13T07:00:00.000Z'),
  })

  assert.equal(row.jewelryBuy, 63341)
  assert.equal(row.barBuy, 65300)
  assert.equal(row.barSell, 65500)
  assert.equal(row.fetchedVia, 'aurora-proxy')
  assert.deepEqual(calls, [
    'https://api.chnwt.dev/thai-gold-api/latest',
    'https://gold.example.test/aurora',
  ])
})

test('falls back to Gold Traders readable proxy before Aurora proxies', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(url)
    if (url === 'https://api.chnwt.dev/thai-gold-api/latest') {
      return {
        ok: true,
        json: async () => ({
          response: {
            price: {
              gold: { buy: '', sell: '' },
              gold_bar: { buy: '', sell: '' },
            },
          },
        }),
      }
    }
    if (url === 'https://gold.example.test/readable') {
      return {
        ok: true,
        text: async () => `
          ทองคำแท่ง 96.5%
          รับซื้อ 65,300.00
          ขายออก 65,500.00
          ทองรูปพรรณ 96.5%
          ฐานภาษี63,990.36
          ขายออก 66,300.00
        `,
      }
    }
    throw new Error(`unexpected URL ${url}`)
  }

  const row = await GoldMarket.fetchThaiGoldViaSource({
    fetchImpl,
    storage: createStorage(),
    goldTradersReadableUrls: ['https://gold.example.test/readable'],
    auroraProxyUrls: ['https://gold.example.test/aurora'],
    now: () => new Date('2026-06-13T07:00:00.000Z'),
  })

  assert.equal(row.jewelryBuy, 63990.36)
  assert.equal(row.fetchedVia, 'goldtraders-readable-proxy')
  assert.deepEqual(calls, [
    'https://api.chnwt.dev/thai-gold-api/latest',
    'https://gold.example.test/readable',
  ])
})

test('uses stale cache when all live sources fail', async () => {
  const cached = {
    savedAt: Date.parse('2026-06-12T07:00:00.000Z'),
    data: {
      jewelryBuy: 63000,
      barBuy: 65000,
      barSell: 65200,
      fetchedAt: '2026-06-12T07:00:00.000Z',
    },
  }
  const storage = createStorage({ MT_GOLD_LAST: JSON.stringify(cached) })

  const row = await GoldMarket.fetchThaiGoldViaSource({
    fetchImpl: async () => { throw new Error('network down') },
    storage,
    now: () => new Date('2026-06-13T08:00:00.000Z'),
  })

  assert.equal(row.jewelryBuy, 63000)
  assert.equal(row.fetchedVia, 'cache-stale')
})
