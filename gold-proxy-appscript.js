// Money Tracker Gold Proxy — v2.2.8
// Primary source: Gold Traders Association classic page
// Fallback source: Thai Gold API (GTA-compatible JSON)

const GOLDTRADERS_URL = 'https://classic.goldtraders.or.th/';
const THAI_GOLD_API_URL = 'https://api.chnwt.dev/thai-gold-api/latest';

function doGet(e) {
  const callback = e && e.parameter && e.parameter.callback;

  try {
    const official = fetchGoldTraders_();
    if (official && official.jewelryBuy) return output_(official, callback);
  } catch (err) {
    // Continue to fallback.
  }

  try {
    const fallback = fetchThaiGoldApi_();
    if (fallback && fallback.jewelryBuy) return output_(fallback, callback);
  } catch (err) {
    return output_({
      ok: false,
      source: 'Gold Traders Association / Thai Gold API',
      error: String(err),
      fetchedAt: new Date().toISOString()
    }, callback);
  }

  return output_({
    ok: false,
    source: 'Gold Traders Association / Thai Gold API',
    error: 'Cannot parse gold price from all sources',
    fetchedAt: new Date().toISOString()
  }, callback);
}

function fetchGoldTraders_() {
  const response = UrlFetchApp.fetch(GOLDTRADERS_URL, {
    method: 'get',
    followRedirects: true,
    muteHttpExceptions: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MoneyTrackerGoldProxy/2.2.8)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8'
    }
  });

  const html = response.getContentText('UTF-8');
  const data = parseGoldTradersClassic_(html);
  if (!data) return null;

  return {
    ok: true,
    source: 'Gold Traders Association',
    url: GOLDTRADERS_URL,
    fetchedVia: 'apps-script-official-page',
    fetchedAt: new Date().toISOString(),
    latestDate: data.latestDate || '',
    latestTime: data.latestTime || '',
    jewelryBuy: data.jewelryBuy,
    jewelrySell: data.jewelrySell,
    barBuy: data.barBuy,
    barSell: data.barSell
  };
}

function fetchThaiGoldApi_() {
  const response = UrlFetchApp.fetch(THAI_GOLD_API_URL, {
    method: 'get',
    followRedirects: true,
    muteHttpExceptions: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MoneyTrackerGoldProxy/2.2.8)',
      'Accept': 'application/json,text/plain,*/*'
    }
  });

  const json = JSON.parse(response.getContentText('UTF-8'));
  const data = parseThaiGoldApi_(json);
  if (!data) return null;

  return {
    ok: true,
    source: 'Thai Gold API / Gold Traders Association',
    url: THAI_GOLD_API_URL,
    fetchedVia: 'apps-script-json-api',
    fetchedAt: new Date().toISOString(),
    latestDate: data.latestDate || '',
    latestTime: data.latestTime || '',
    jewelryBuy: data.jewelryBuy,
    jewelrySell: data.jewelrySell,
    barBuy: data.barBuy,
    barSell: data.barSell
  };
}

function parseGoldTradersClassic_(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

  const price = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?)';
  const re = new RegExp(
    'ทองคำแท่ง\\s*96\\.5%\\s*ขายออก\\s*' + price +
    '\\s*รับซื้อ\\s*' + price +
    '\\s*ทองรูปพรรณ\\s*96\\.5%\\s*ขายออก\\s*' + price +
    '\\s*(?:ฐานภาษี|รับซื้อ)\\s*' + price,
    'i'
  );
  const m = text.match(re);
  if (!m) return null;

  const dateMatch = text.match(/ประจำวันที่\s*([^\s]+)\s+เวลา\s*([^\s]+\s*น\.?(?:\s*\([^)]*\))?)/i);

  return {
    latestDate: dateMatch ? dateMatch[1] : '',
    latestTime: dateMatch ? dateMatch[2] : '',
    barSell: toNumber_(m[1]),
    barBuy: toNumber_(m[2]),
    jewelrySell: toNumber_(m[3]),
    jewelryBuy: toNumber_(m[4])
  };
}

function parseThaiGoldApi_(json) {
  const root = json && (json.response || json.data || json);
  if (!root) return null;
  const price = root.price || {};
  const gold = price.gold || {};
  const goldBar = price.gold_bar || price.goldBar || {};
  const jewelryBuy = toNumber_(gold.buy);
  const jewelrySell = toNumber_(gold.sell);
  const barBuy = toNumber_(goldBar.buy);
  const barSell = toNumber_(goldBar.sell);
  if (!jewelryBuy && !barBuy) return null;

  return {
    latestDate: root.update_date || '',
    latestTime: root.update_time || '',
    jewelryBuy: jewelryBuy || barBuy,
    jewelrySell,
    barBuy,
    barSell
  };
}

function toNumber_(value) {
  return Number(String(value || '').replace(/,/g, '').replace(/[^\d.\-]/g, '')) || 0;
}

function output_(payload, callback) {
  const json = JSON.stringify(payload);

  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
