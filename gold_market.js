;(function(root) {
  const GOLD_API_URL = 'https://api.chnwt.dev/thai-gold-api/latest'
  const GOLDTRADERS_URL = 'https://www.goldtraders.or.th/'
  const AURORA_GOLD_URL = 'https://www.aurora.co.th/price/gold_pricelist'
  const GOLD_CACHE_KEY = 'MT_GOLD_LAST'
  const GOLD_CACHE_FRESH_MS = 12 * 60 * 60 * 1000
  const DEFAULT_GOLDTRADERS_READABLE_URLS = [
    'https://r.jina.ai/http://r.jina.ai/http://https://www.goldtraders.or.th/',
  ]
  const DEFAULT_AURORA_PROXY_URLS = [
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(AURORA_GOLD_URL),
    'https://corsproxy.io/?' + encodeURIComponent(AURORA_GOLD_URL),
  ]

  function toNumber(value) {
    return Number(String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '')) || 0
  }

  function nowISO(now) {
    return (typeof now === 'function' ? now() : new Date()).toISOString()
  }

  function cleanHtml(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function parseJsonMaybe(raw) {
    if (typeof raw !== 'string') return raw
    const trimmed = raw.trim()
    try { return JSON.parse(trimmed) } catch (_) {}
    const jsonp = trimmed.match(/^[^(]+\(([\s\S]*)\);?$/)
    if (jsonp) {
      try { return JSON.parse(jsonp[1]) } catch (_) {}
    }
    return null
  }

  function normaliseGoldPayload(raw, opts = {}) {
    const json = parseJsonMaybe(raw)
    if (!json) return null

    const rootData = json.response || json.data || json
    const price = rootData.price || rootData.prices || {}
    const gold = price.gold || rootData.gold || {}
    const goldBar = price.gold_bar || price.goldBar || rootData.gold_bar || rootData.goldBar || {}

    const jewelryBuy = toNumber(
      json.jewelryBuy ?? json.goldBuy ?? json.ornamentBuy ?? json.price ??
      rootData.jewelryBuy ?? rootData.jewelry_buy ?? rootData.goldBuy ?? rootData.ornamentBuy ??
      gold.buy ?? gold.bid ?? gold.taxBase
    )
    const jewelrySell = toNumber(json.jewelrySell ?? rootData.jewelrySell ?? rootData.jewelry_sell ?? gold.sell ?? gold.ask)
    const barBuy = toNumber(json.barBuy ?? rootData.barBuy ?? rootData.bar_buy ?? goldBar.buy ?? goldBar.bid)
    const barSell = toNumber(json.barSell ?? rootData.barSell ?? rootData.bar_sell ?? goldBar.sell ?? goldBar.ask)

    if (!jewelryBuy && !barBuy && !barSell) return null

    return {
      ok: true,
      source: json.source || rootData.source || 'Thai Gold API / Gold Traders Association',
      url: json.url || rootData.url || GOLD_API_URL,
      fetchedAt: json.fetchedAt || rootData.fetchedAt || nowISO(opts.now),
      latestDate: json.latestDate || rootData.latestDate || rootData.update_date || json.update_date || '',
      latestTime: json.latestTime || rootData.latestTime || rootData.update_time || json.update_time || '',
      jewelryBuy: jewelryBuy || barBuy || 0,
      jewelrySell: jewelrySell || 0,
      barBuy: barBuy || 0,
      barSell: barSell || 0,
      fetchedVia: json.fetchedVia || json.via || 'direct-json',
    }
  }

  function parseAuroraGold(html, opts = {}) {
    const clean = cleanHtml(html)
    if (!clean) return null

    const priceRe = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?)'
    const intradayRow = clean.match(new RegExp(
      '\\d{1,2}:\\d{2}(?::\\d{2})?\\s*น\\.?\\s+(?:\\(\\s*ครั้งที่\\s*)?\\d+\\)?\\s+' +
      priceRe + '\\s+' + priceRe + '\\s+' + priceRe,
      'i'
    ))
    if (intradayRow) {
      const barBuy = toNumber(intradayRow[1])
      const barSell = toNumber(intradayRow[2])
      const jewelryBuy = toNumber(intradayRow[3])
      if (jewelryBuy) {
        return { jewelryBuy, barBuy, barSell, source: 'Aurora', url: AURORA_GOLD_URL, fetchedAt: nowISO(opts.now) }
      }
    }

    const labeledCard = clean.match(new RegExp(
      'ทองคำแท่ง\\s+รับซื้อคืน\\s+' + priceRe +
      '\\s+ขายออก\\s+' + priceRe +
      '[\\s\\S]*?(?:รับซื้อรูปพรรณออโรร่า|ทองรูปพรรณ)[\\s\\S]*?' + priceRe,
      'i'
    ))
    if (labeledCard) {
      const barBuy = toNumber(labeledCard[1])
      const barSell = toNumber(labeledCard[2])
      const jewelryBuy = toNumber(labeledCard[3])
      if (jewelryBuy) {
        return { jewelryBuy, barBuy, barSell, source: 'Aurora', url: AURORA_GOLD_URL, fetchedAt: nowISO(opts.now) }
      }
    }

    const jewelryIdx = clean.search(/รับซื้อรูปพรรณออโรร่า/i)
    const tail = jewelryIdx >= 0 ? clean.slice(jewelryIdx) : clean
    const nums = tail.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g) || []
    for (let i = 0; i <= nums.length - 3; i++) {
      const a = toNumber(nums[i])
      const b = toNumber(nums[i + 1])
      const c = toNumber(nums[i + 2])
      if (a > 10000 && b > 10000 && c > 10000 && c <= Math.max(a, b)) {
        return { jewelryBuy: c, barBuy: a, barSell: b, source: 'Aurora', url: AURORA_GOLD_URL, fetchedAt: nowISO(opts.now) }
      }
    }
    return null
  }

  function parseGoldTradersText(text, opts = {}) {
    const clean = cleanHtml(text)
    if (!clean) return null

    const priceRe = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?)'
    const row = clean.match(new RegExp(
      'ทองคำแท่ง\\s*96\\.5%[\\s\\S]*?รับซื้อ\\s*' + priceRe +
      '[\\s\\S]*?ขายออก\\s*' + priceRe +
      '[\\s\\S]*?ทองรูปพรรณ\\s*96\\.5%[\\s\\S]*?(?:ฐานภาษี|รับซื้อ)\\s*' + priceRe +
      '[\\s\\S]*?ขายออก\\s*' + priceRe,
      'i'
    ))
    if (!row) return null

    const latest = clean.match(/ประจำวันที่\s*([^\s]+)\s+เวลา\s*([0-9:.]+(?:\s*\([^)]*\))?)/i)
    const barBuy = toNumber(row[1])
    const barSell = toNumber(row[2])
    const jewelryBuy = toNumber(row[3])
    const jewelrySell = toNumber(row[4])
    if (!jewelryBuy && !barBuy) return null

    return {
      ok: true,
      jewelryBuy: jewelryBuy || barBuy,
      jewelrySell,
      barBuy,
      barSell,
      source: 'Gold Traders Association',
      url: GOLDTRADERS_URL,
      fetchedAt: nowISO(opts.now),
      latestDate: latest?.[1] || '',
      latestTime: latest?.[2] || '',
    }
  }

  function readGoldCache(storage) {
    try {
      const row = JSON.parse(storage?.getItem?.(GOLD_CACHE_KEY) || 'null')
      return row && row.data?.jewelryBuy ? row : null
    } catch (_) {
      return null
    }
  }

  function writeGoldCache(storage, data, now) {
    try {
      storage?.setItem?.(GOLD_CACHE_KEY, JSON.stringify({ savedAt: (typeof now === 'function' ? now() : new Date()).getTime(), data }))
    } catch (_) {}
  }

  async function fetchJson(fetchImpl, url, opts = {}) {
    const response = await fetchImpl(url, { cache: 'no-store' })
    if (!response?.ok) return null
    return normaliseGoldPayload(await response.json(), opts)
  }

  async function fetchText(fetchImpl, url, opts = {}) {
    const response = await fetchImpl(url, { cache: 'no-store' })
    if (!response?.ok) return null
    const text = await response.text()
    return parseGoldTradersText(text, opts) || parseAuroraGold(text, opts) || normaliseGoldPayload(text, opts)
  }

  async function fetchThaiGoldViaSource(options = {}) {
    const fetchImpl = options.fetchImpl || root.fetch?.bind(root)
    const storage = options.storage || root.localStorage
    const now = options.now
    const fetchJsonp = options.fetchJsonp
    const customProxyUrl = String(options.customProxyUrl || root.MT_GOLD_PROXY_URL || storage?.getItem?.('MT_GOLD_PROXY_URL') || '').trim()
    const auroraProxyUrl = String(options.auroraProxyUrl || root.MT_GOLD_AURORA_PROXY_URL || storage?.getItem?.('MT_GOLD_AURORA_PROXY_URL') || '').trim()
    const goldTradersReadableUrls = options.goldTradersReadableUrls || DEFAULT_GOLDTRADERS_READABLE_URLS
    const auroraProxyUrls = auroraProxyUrl ? [auroraProxyUrl] : (options.auroraProxyUrls || DEFAULT_AURORA_PROXY_URLS)
    if (!fetchImpl && !fetchJsonp) return null

    if (customProxyUrl && fetchJsonp) {
      try {
        const payload = await fetchJsonp(customProxyUrl)
        const data = normaliseGoldPayload(payload, { now }) || parseAuroraGold(payload, { now })
        if (data?.jewelryBuy) {
          writeGoldCache(storage, data, now)
          return { ...data, fetchedVia: 'apps-script-proxy' }
        }
      } catch (_) {}
    }

    if (fetchImpl) {
      try {
        const data = await fetchJson(fetchImpl, GOLD_API_URL, { now })
        if (data?.jewelryBuy) {
          writeGoldCache(storage, data, now)
          return { ...data, fetchedVia: 'direct-api' }
        }
      } catch (_) {}

      for (const url of goldTradersReadableUrls) {
        try {
          const data = await fetchText(fetchImpl, url, { now })
          if (data?.jewelryBuy) {
            writeGoldCache(storage, data, now)
            return { ...data, fetchedVia: 'goldtraders-readable-proxy' }
          }
        } catch (_) {}
      }

      for (const url of auroraProxyUrls) {
        try {
          const data = await fetchText(fetchImpl, url, { now })
          if (data?.jewelryBuy) {
            writeGoldCache(storage, data, now)
            return { ...data, fetchedVia: 'aurora-proxy' }
          }
        } catch (_) {}
      }
    }

    const cached = readGoldCache(storage)
    const nowMs = (typeof now === 'function' ? now() : new Date()).getTime()
    if (cached && nowMs - cached.savedAt < GOLD_CACHE_FRESH_MS) return { ...cached.data, fetchedVia: 'cache' }

    if (fetchImpl) {
      const proxyUrls = options.publicProxyUrls || [
        'https://api.allorigins.win/raw?url=' + encodeURIComponent(GOLD_API_URL),
        'https://corsproxy.io/?' + encodeURIComponent(GOLD_API_URL),
      ]
      for (const url of proxyUrls) {
        try {
          const response = await fetchImpl(url, { cache: 'no-store' })
          if (!response?.ok) continue
          const text = await response.text()
          const data = normaliseGoldPayload(text, { now })
          if (data?.jewelryBuy) {
            writeGoldCache(storage, data, now)
            return { ...data, fetchedVia: 'public-proxy' }
          }
        } catch (_) {}
      }
    }

    if (cached) return { ...cached.data, fetchedVia: 'cache-stale' }
    return null
  }

  const api = {
    AURORA_GOLD_URL,
    DEFAULT_GOLDTRADERS_READABLE_URLS,
    DEFAULT_AURORA_PROXY_URLS,
    GOLD_API_URL,
    GOLD_CACHE_KEY,
    GOLD_CACHE_FRESH_MS,
    cleanHtml,
    fetchThaiGoldViaSource,
    normaliseGoldPayload,
    parseAuroraGold,
    parseGoldTradersText,
    readGoldCache,
    toNumber,
    writeGoldCache,
  }

  root.MTGoldMarket = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
