/**
 * Money Tracker — AI Credit Card Promo Search
 * Google Apps Script Web App  (paste this at script.google.com)
 *
 * Setup:
 *  1. script.google.com → New project → paste this code
 *  2. Project Settings → Script Properties → Add:
 *       GEMINI_API_KEY  =  <your key from aistudio.google.com>
 *       MOCK_MODE       =  false   (set "true" only for local testing)
 *  3. Deploy → New deployment → Web App
 *       Execute as: Me
 *       Who has access: Anyone
 *  4. Copy the Web App URL and paste into index.html:
 *       window.MT_PROMO_SEARCH_ENDPOINT = "<url>";
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var GEMINI_MODEL = 'gemini-2.0-flash';
var GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

var ISSUER_SOURCES = {
  KTC: {
    urls: [
      'https://www.ktc.co.th/th/promotion/credit-card-promotion',
    ],
  },
  UOB: {
    urls: [
      'https://www.uob.co.th/th/personal/cards/promotions/index.html',
    ],
  },
  SCB: {
    urls: [
      'https://www.scb.co.th/th/personal-banking/credit-cards/promotions.html',
    ],
  },
  Krungsri: {
    urls: [
      'https://www.krungsri.com/th/promotions/credit-card',
    ],
  },
  'First Choice': {
    urls: [
      'https://www.firstchoice.co.th/firstchoice/promotions',
      // TODO: verify current First Choice promo page URL
    ],
  },
  'Bangkok Bank': {
    urls: [
      'https://www.bangkokbank.com/th-TH/Personal/Cards/Credit-Cards/Promotions',
    ],
  },
  KBank: {
    urls: [
      'https://www.kasikornbank.com/th/personal/card/creditcard/privilege/Pages/main.aspx',
    ],
  },
  TTB: {
    urls: [
      'https://www.ttbbank.com/th/promotions/credit-card',
      // TODO: verify current TTB promo page URL
    ],
  },
  AEON: {
    urls: [
      'https://www.aeon.co.th/promotion/creditcard',
      // TODO: verify current AEON promo page URL
    ],
  },
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || '{}');
    var result = handlePromoSearch(payload);
    return respond(result);
  } catch (err) {
    return respond({ ok: false, message: String(err.message || err), results: [], warnings: [] });
  }
}

// Health check — GET returns ok
function doGet(e) {
  return respond({ ok: true, message: 'Promo Search endpoint is running' });
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Cache  (Google Apps Script CacheService — 6 hour TTL)
// ---------------------------------------------------------------------------

function cacheKey(issuers, month, mode) {
  return 'promo|' + issuers.slice().sort().join(',') + '|' + month + '|' + mode;
}

function cacheGet(key) {
  try {
    var cache = CacheService.getScriptCache();
    var raw = cache.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}

function cacheSet(key, data) {
  try {
    var cache = CacheService.getScriptCache();
    var json = JSON.stringify(data);
    // CacheService max value size is 100KB; skip caching if too large
    if (json.length < 90000) {
      cache.put(key, json, 6 * 60 * 60); // 6 hours
    }
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Mock mode  (PART K — enable only via Script Properties for local testing)
// ---------------------------------------------------------------------------

function getMockResults(payload) {
  var month = payload.month || '';
  var mode = payload.mode || 'monthly';
  var issuers = Array.isArray(payload.issuers) ? payload.issuers : [];
  var results = [];

  issuers.forEach(function(issuerRow) {
    var issuer = issuerRow.issuer || '';
    results.push({
      id: 'mock_promo_' + issuer.toLowerCase().replace(/\s+/g, '_') + '_abc1',
      issuer: issuer,
      cardNames: issuerRow.cardNames || [],
      title: '[MOCK] ' + issuer + ' Dining Cashback ' + month,
      mechanicSummary: '[ข้อมูล MOCK เพื่อทดสอบเท่านั้น] ใช้จ่ายร้านอาหารผ่านบัตร ' + issuer + ' ครบ 3,000 บาท รับ cashback 10% สูงสุด 300 บาท',
      registrationRequired: true,
      registrationChannel: 'Mobile App',
      registrationDeadline: month + '-15',
      campaignStartDate: month + '-01',
      campaignEndDate: month + '-31',
      rewardType: 'cashback',
      rewardValueText: '10% cashback สูงสุด 300 บาท',
      minSpendText: 'ครบ 3,000 บาท',
      capText: 'สูงสุด 300 บาท',
      quotaText: 'จำกัดสิทธิ์ตามเงื่อนไขธนาคาร',
      categories: ['dining'],
      importantConditions: ['ต้องลงทะเบียนก่อนใช้', '[MOCK DATA — ไม่ใช่ข้อมูลจริง]'],
      exclusions: [],
      sourceUrls: [{ label: 'MOCK — ไม่ใช่ลิงก์จริง', url: 'https://www.example.com/mock-' + issuer.toLowerCase() }],
      confidence: 'low',
      needsReview: true,
      missingFields: ['MOCK_DATA'],
    });
  });

  return {
    ok: true,
    mock: true,
    searchedAt: new Date().toISOString(),
    month: month,
    mode: mode,
    issuers: issuers.map(function(i) { return i.issuer; }),
    results: results,
    warnings: [
      '[MOCK MODE] ผลลัพธ์นี้เป็น mock data เพื่อทดสอบเท่านั้น ไม่ใช่ข้อมูลโปรโมชันจริง',
    ],
  };
}

// ---------------------------------------------------------------------------
// Official source fetching
// ---------------------------------------------------------------------------

function fetchPageText(url) {
  try {
    var isPdf = /\.pdf(\?.*)?$/i.test(url);
    if (isPdf) return { url: url, text: '', isPdf: true, pdfSkipped: true };

    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MoneyTrackerPromoBot/1.0)',
        'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
      },
    });

    if (res.getResponseCode() !== 200) return null;
    var ct = res.getHeaders()['Content-Type'] || '';
    if (!/html|text/i.test(ct)) return null;

    var html = res.getContentText('UTF-8');
    var text = extractTextFromHtml(html);
    return { url: url, text: text, isPdf: false };
  } catch (err) {
    return null;
  }
}

function extractTextFromHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 40000);
}

// ---------------------------------------------------------------------------
// AI extraction via Gemini
// ---------------------------------------------------------------------------

function buildPrompt(sourceDocs, payload) {
  var month = payload.month || '';
  var mode = payload.mode || 'monthly';
  var issuers = (payload.issuers || []).map(function(i) { return i.issuer; }).join(', ');

  var docsSection = sourceDocs.map(function(doc, idx) {
    if (doc.pdfSkipped) {
      return '--- Source ' + (idx+1) + ' [PDF — text not extracted] ---\nURL: ' + doc.url + '\n(PDF content must be reviewed manually)\n';
    }
    return '--- Source ' + (idx+1) + ' ---\nURL: ' + doc.url + '\n\n' + (doc.text || '(empty)') + '\n';
  }).join('\n');

  return 'You are a Thai credit card promotion analyst. Extract structured promotion data from the official bank website text below.\n\n'
    + 'STRICT RULES:\n'
    + '1. Summarize ONLY from the text and URLs provided. Do NOT invent or hallucinate any promotion details.\n'
    + '2. Return ONLY valid JSON array — no markdown, no explanation, no code fences.\n'
    + '3. If a field is unknown or missing, set it to null or "" and add the field name to missingFields.\n'
    + '4. If terms are unclear, set needsReview to true.\n'
    + '5. Every promotion MUST include at least one sourceUrls entry with the official URL from which the info was extracted.\n'
    + '6. Summarize mechanicSummary in Thai (th-TH).\n'
    + '7. Focus ONLY on credit card promotions. Ignore debit cards, loans, insurance-only, deposit-only.\n'
    + '8. Ignore promotions already expired relative to ' + month + '.\n'
    + '9. Focus on ' + (mode === 'ongoing' ? 'ongoing / evergreen promotions' : 'promotions active in ' + month) + '.\n'
    + '10. Target issuers: ' + issuers + '.\n\n'
    + 'OUTPUT FORMAT (JSON array):\n'
    + '[\n'
    + '  {\n'
    + '    "id": "promo_<issuer>_<random>",\n'
    + '    "issuer": "<issuer name>",\n'
    + '    "cardNames": [],\n'
    + '    "title": "<short title>",\n'
    + '    "mechanicSummary": "<Thai 2-3 sentence summary>",\n'
    + '    "registrationRequired": true|false|null,\n'
    + '    "registrationChannel": "<channel or null>",\n'
    + '    "registrationDeadline": "<YYYY-MM-DD or null>",\n'
    + '    "campaignStartDate": "<YYYY-MM-DD or null>",\n'
    + '    "campaignEndDate": "<YYYY-MM-DD or null>",\n'
    + '    "rewardType": "<cashback|points|discount|voucher|other|null>",\n'
    + '    "rewardValueText": "<human-readable or null>",\n'
    + '    "minSpendText": "<Thai or null>",\n'
    + '    "capText": "<Thai or null>",\n'
    + '    "quotaText": "<Thai or null>",\n'
    + '    "categories": ["dining|fuel|travel|shopping|online|entertainment|other"],\n'
    + '    "importantConditions": [],\n'
    + '    "exclusions": [],\n'
    + '    "sourceUrls": [{"label": "<label>", "url": "<exact source URL>"}],\n'
    + '    "confidence": "high|medium|low|unknown",\n'
    + '    "needsReview": false,\n'
    + '    "missingFields": []\n'
    + '  }\n'
    + ']\n\n'
    + 'If NO promotions found, return empty array: []\n\n'
    + '--- OFFICIAL SOURCE TEXT ---\n\n'
    + docsSection
    + '\n--- END OF SOURCE TEXT ---\n\n'
    + 'Return only the JSON array now:';
}

function callGemini(prompt, apiKey) {
  var url = GEMINI_API_BASE + GEMINI_MODEL + ':generateContent?key=' + apiKey;
  var body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
      temperature: 0.1,
    },
  });

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: body,
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini API error ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }

  var data = JSON.parse(res.getContentText());
  var text = (data.candidates || [])[0]
    && (data.candidates[0].content || {}).parts
    && data.candidates[0].content.parts[0]
    && data.candidates[0].content.parts[0].text;

  if (!text) throw new Error('Gemini ไม่ได้ส่ง text กลับมา');
  return text;
}

// ---------------------------------------------------------------------------
// Normalize & validate
// ---------------------------------------------------------------------------

function normalizeResults(aiJson, payload) {
  var arr = Array.isArray(aiJson) ? aiJson : [];
  return arr.map(function(item) {
    var sourceUrls = (Array.isArray(item.sourceUrls) ? item.sourceUrls : [])
      .map(function(s) { return { label: String(s.label || 'Official source'), url: String(s.url || '').trim() }; })
      .filter(function(s) { return /^https?:\/\//i.test(s.url); });

    var missingFields = Array.isArray(item.missingFields) ? item.missingFields.map(String) : [];

    if (!sourceUrls.length && missingFields.indexOf('sourceUrls') === -1) missingFields.push('sourceUrls');
    if (item.registrationRequired === true) {
      if (!item.registrationChannel && missingFields.indexOf('registrationChannel') === -1) missingFields.push('registrationChannel');
      if (!item.registrationDeadline && missingFields.indexOf('registrationDeadline') === -1) missingFields.push('registrationDeadline');
    }
    if (!item.campaignEndDate && missingFields.indexOf('campaignEndDate') === -1) missingFields.push('campaignEndDate');
    if (!item.rewardValueText && missingFields.indexOf('rewardValueText') === -1) missingFields.push('rewardValueText');

    var confidence = ['high','medium','low','unknown'].indexOf(item.confidence) !== -1 ? item.confidence : 'unknown';
    var needsReview = item.needsReview === true || !sourceUrls.length || !item.mechanicSummary || confidence === 'unknown';

    return {
      id: String(item.id || ('promo_' + String(item.issuer || '').toLowerCase().replace(/\s+/g, '_') + '_' + Math.random().toString(36).slice(2,6))),
      issuer: String(item.issuer || ''),
      cardNames: Array.isArray(item.cardNames) ? item.cardNames.filter(Boolean).map(String) : [],
      title: String(item.title || '').trim() || 'โปรที่ต้องตรวจสอบ',
      mechanicSummary: String(item.mechanicSummary || '').trim(),
      registrationRequired: item.registrationRequired === true,
      registrationChannel: String(item.registrationChannel || ''),
      registrationDeadline: String(item.registrationDeadline || ''),
      campaignStartDate: String(item.campaignStartDate || ''),
      campaignEndDate: String(item.campaignEndDate || ''),
      rewardType: String(item.rewardType || ''),
      rewardValueText: String(item.rewardValueText || ''),
      minSpendText: String(item.minSpendText || ''),
      capText: String(item.capText || ''),
      quotaText: String(item.quotaText || ''),
      categories: Array.isArray(item.categories) ? item.categories.filter(Boolean).map(String) : [],
      importantConditions: Array.isArray(item.importantConditions) ? item.importantConditions.filter(Boolean).map(String) : [],
      exclusions: Array.isArray(item.exclusions) ? item.exclusions.filter(Boolean).map(String) : [],
      sourceUrls: sourceUrls,
      confidence: confidence,
      needsReview: needsReview,
      missingFields: missingFields.filter(function(v,i,a) { return a.indexOf(v) === i; }),
    };
  }).filter(function(p) { return p.issuer && p.title; });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

function handlePromoSearch(payload) {
  var props = PropertiesService.getScriptProperties();
  var month = payload.month || '';
  var mode = payload.mode || 'monthly';
  var issuers = Array.isArray(payload.issuers) ? payload.issuers : [];

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, message: 'month must be in YYYY-MM format', results: [], warnings: [] };
  }
  if (!issuers.length) {
    return { ok: false, message: 'issuers must be a non-empty array', results: [], warnings: [] };
  }

  // Mock mode
  if (props.getProperty('MOCK_MODE') === 'true') {
    return getMockResults(payload);
  }

  var apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    return { ok: false, message: 'GEMINI_API_KEY ยังไม่ได้ตั้งค่าใน Script Properties', results: [], warnings: [] };
  }

  // Cache check
  var issuerNames = issuers.map(function(i) { return i.issuer; }).filter(Boolean);
  var ck = cacheKey(issuerNames, month, mode);
  var cached = cacheGet(ck);
  if (cached) return Object.assign({}, cached, { cached: true });

  // Fetch official pages
  var warnings = [];
  var sourceDocs = [];

  issuers.forEach(function(issuerRow) {
    var issuer = issuerRow.issuer;
    if (!issuer) return;
    var config = ISSUER_SOURCES[issuer] || { urls: [] };
    var fetched = false;

    config.urls.forEach(function(url) {
      try {
        var doc = fetchPageText(url);
        if (doc) {
          doc.issuer = issuer;
          sourceDocs.push(doc);
          if (doc.pdfSkipped) {
            warnings.push('ไฟล์ PDF ของ ' + issuer + ' (' + url + ') ไม่ได้รับการแปลงข้อความ — ควรตรวจสอบ PDF เอง');
          }
          fetched = true;
        }
      } catch (_) {}
    });

    if (!fetched) {
      warnings.push('ไม่สามารถดึงข้อมูลจากเว็บทางการของ ' + issuer + ' ได้ — อาจมีการป้องกัน bot');
    }
  });

  if (!sourceDocs.length) {
    return { ok: false, message: 'ไม่สามารถดึงข้อมูลจากเว็บทางการของธนาคารที่เลือกได้', results: [], warnings: warnings };
  }

  // Call Gemini
  var rawText = '';
  try {
    var prompt = buildPrompt(sourceDocs, payload);
    rawText = callGemini(prompt, apiKey);
  } catch (err) {
    return { ok: false, message: 'Gemini error: ' + String(err.message || err).slice(0, 200), results: [], warnings: warnings };
  }

  // Parse JSON
  var aiJson = [];
  try {
    var cleaned = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    aiJson = JSON.parse(cleaned);
    if (!Array.isArray(aiJson)) aiJson = [];
  } catch (_) {
    return {
      ok: false,
      message: 'AI ส่งข้อมูลกลับมาในรูปแบบที่ไม่ใช่ JSON — ลองค้นหาอีกครั้ง',
      results: [],
      warnings: warnings.concat(['AI raw (100 chars): ' + rawText.slice(0, 100)]),
    };
  }

  var results = normalizeResults(aiJson, payload);

  var needsReviewCount = results.filter(function(r) { return r.needsReview; }).length;
  if (needsReviewCount > 0) {
    warnings.push(needsReviewCount + ' โปรมีข้อมูลไม่ครบ ควรตรวจสอบกับเว็บทางการของธนาคาร');
  }
  warnings.push('บางโปรอาจเป็นสิทธิ์เฉพาะลูกค้าที่ได้รับ SMS — กรุณาตรวจสอบเงื่อนไขที่เว็บทางการ');

  var response = {
    ok: true,
    searchedAt: new Date().toISOString(),
    month: month,
    mode: mode,
    issuers: issuerNames,
    results: results,
    warnings: warnings,
  };

  cacheSet(ck, response);
  return response;
}
