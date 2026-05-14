/**
 * Money Tracker — AI Credit Card Promo Search
 * Google Apps Script Web App  (paste this at script.google.com)
 *
 * Setup:
 *  1. script.google.com → New project → paste this code
 *  2. Project Settings → Script Properties → Add:
 *       GEMINI_API_KEY  =  <your key from aistudio.google.com>
 *       MOCK_MODE       =  false
 *  3. Deploy → New deployment → Web App
 *       Execute as: Me  /  Who has access: Anyone
 *  4. Paste the Web App URL into index.html:
 *       window.MT_PROMO_SEARCH_ENDPOINT = "<url>";
 *
 * Architecture (2-step):
 *  Step 1 — Gemini + Google Search grounding → raw promo text + source URLs
 *  Step 2 — Gemini + responseSchema (no tools) → guaranteed-valid JSON
 *  (Google Search + responseSchema cannot be used together in Gemini API)
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var SCRIPT_VERSION = '2026.05.14-benefit-v2';
var GEMINI_MODEL = 'gemini-2.5-flash';
var GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

var ISSUER_CONFIG = {
  KTC:              { domain: 'ktc.co.th',          promoUrl: 'https://www.ktc.co.th/promotion' },
  UOB:              { domain: 'uob.co.th',           promoUrl: 'https://www.uob.co.th/personal/credit-cards/promotions.page' },
  SCB:              { domain: 'cardx.co.th',         promoUrl: 'https://www.cardx.co.th/credit-card/promotion' },
  Krungsri:         { domain: 'krungsricard.com',    promoUrl: 'https://www.krungsricard.com/th/promotion/' },
  'First Choice':   { domain: 'firstchoice.co.th',  promoUrl: 'https://www.firstchoice.co.th/promotion/credit-card' },
  'Bangkok Bank':   { domain: 'bangkokbank.com',     promoUrl: 'https://www.bangkokbank.com/th-TH/Personal/Cards/Credit-Cards/Promotions' },
  KBank:            { domain: 'kasikornbank.com',    promoUrl: 'https://www.kasikornbank.com/th/promotion/creditcard/pages/index.aspx' },
  TTB:              { domain: 'ttbbank.com',         promoUrl: 'https://www.ttbbank.com/th/promotion' },
  AEON:             { domain: 'aeon.co.th',          promoUrl: 'https://www.aeon.co.th/aeon/promotions/' },
  UnionPay:         { domain: 'unionpayintl.com',    promoUrl: 'https://www.unionpayintl.com/cardholderServ/serviceCenter/merchant?language=th' },
  JCB:              { domain: 'specialoffers.jcb',   promoUrl: 'https://www.specialoffers.jcb/th/campaign/d/southeast-and-south-asia/thailand/' },
};

// JSON Schema enforced in Step 2
var PROMO_RESPONSE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id:                   { type: 'string' },
      issuer:               { type: 'string' },
      cardNames:            { type: 'array', items: { type: 'string' } },
      title:                { type: 'string' },
      mechanicSummary:      { type: 'string' },
      registrationRequired: { type: 'boolean' },
      registrationChannel:  { type: 'string' },
      registrationDeadline: { type: 'string' },
      campaignStartDate:    { type: 'string' },
      campaignEndDate:      { type: 'string' },
      rewardType:           { type: 'string' },
      rewardValueText:      { type: 'string' },
      minSpendText:         { type: 'string' },
      capText:              { type: 'string' },
      quotaText:            { type: 'string' },
      categories:           { type: 'array', items: { type: 'string' } },
      importantConditions:  { type: 'array', items: { type: 'string' } },
      exclusions:           { type: 'array', items: { type: 'string' } },
      sourceUrls: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            url:   { type: 'string' },
          },
          required: ['label', 'url'],
        },
      },
      confidence:    { type: 'string' },
      needsReview:   { type: 'boolean' },
      missingFields: { type: 'array', items: { type: 'string' } },
    },
    required: ['id', 'issuer', 'title', 'mechanicSummary', 'registrationRequired',
               'sourceUrls', 'confidence', 'needsReview', 'missingFields'],
  },
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || '{}');
    if (payload.action === 'ping') {
      return respond({ ok: true, version: SCRIPT_VERSION, features: ['promoSearch', 'analyzeBenefitUrl'] });
    }
    if (payload.action === 'analyzeBenefitUrl') {
      return respond(handleBenefitAnalysis(payload));
    }
    return respond(handlePromoSearch(payload));
  } catch (err) {
    return respond({ ok: false, message: String(err.message || err), results: [], warnings: [] });
  }
}

function doGet() {
  return respond({ ok: true, message: 'Money Tracker endpoint running', version: SCRIPT_VERSION, features: ['promoSearch', 'analyzeBenefitUrl'] });
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function cacheKey(issuers, month, mode) {
  return 'promov3|' + issuers.slice().sort().join(',') + '|' + month + '|' + mode;
}

function cacheGet(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function cacheSet(key, data) {
  try {
    var json = JSON.stringify(data);
    if (json.length < 90000) CacheService.getScriptCache().put(key, json, 6 * 60 * 60);
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

function getMockResults(payload) {
  var month = payload.month || '';
  var mode  = payload.mode  || 'monthly';
  var issuers = Array.isArray(payload.issuers) ? payload.issuers : [];
  var results = issuers.map(function(row) {
    var issuer = row.issuer || '';
    return {
      id: 'mock_' + issuer.toLowerCase().replace(/\s+/g, '_') + '_test',
      issuer: issuer,
      cardNames: [],
      title: '[MOCK] ' + issuer + ' Test Promo ' + month,
      mechanicSummary: '[MOCK DATA] ข้อมูลจำลองสำหรับทดสอบเท่านั้น',
      registrationRequired: false,
      registrationChannel: '', registrationDeadline: '',
      campaignStartDate: month + '-01', campaignEndDate: month + '-31',
      rewardType: 'cashback', rewardValueText: '5% cashback',
      minSpendText: '', capText: '', quotaText: '',
      categories: [], importantConditions: ['[MOCK]'], exclusions: [],
      sourceUrls: [{ label: 'MOCK', url: 'https://example.com/mock' }],
      confidence: 'low', needsReview: true, missingFields: ['MOCK_DATA'],
    };
  });
  return {
    ok: true, mock: true,
    searchedAt: new Date().toISOString(),
    month: month, mode: mode,
    issuers: issuers.map(function(i) { return i.issuer; }),
    results: results,
    warnings: ['[MOCK MODE] ผลลัพธ์นี้เป็น mock data เพื่อทดสอบเท่านั้น'],
  };
}

// ---------------------------------------------------------------------------
// Step 1 — Gemini + Google Search grounding
// Returns { rawText: string, groundingSources: [{label, url}] }
// ---------------------------------------------------------------------------

function buildSearchPrompt(issuers, month, mode) {
  var modeDesc = mode === 'ongoing'
    ? 'โปรโมชันแบบ ongoing หรือ evergreen ที่ยังมีผลบังคับใช้อยู่'
    : 'โปรโมชันที่ใช้งานได้ในเดือน ' + month;

  var issuerLines = issuers.map(function(issuer) {
    var cfg = ISSUER_CONFIG[issuer] || {};
    return '- ' + issuer + (cfg.promoUrl ? ' → ' + cfg.promoUrl : '');
  }).join('\n');

  return 'ค้นหาและสรุปโปรโมชันบัตรเครดิตจากเว็บทางการของธนาคารต่อไปนี้\n\n'
    + 'ธนาคาร / ลิงก์หน้าโปร:\n' + issuerLines + '\n\n'
    + 'เงื่อนไขการค้นหา:\n'
    + '- เดือน: ' + month + '\n'
    + '- ประเภท: ' + modeDesc + '\n\n'
    + 'สิ่งที่ต้องสรุปสำหรับแต่ละโปร:\n'
    + '1. ชื่อโปร\n'
    + '2. mechanic (วิธีได้รับสิทธิ์ + ขั้นต่ำ + เพดาน)\n'
    + '3. ต้องลงทะเบียนมั้ย ถ้าใช่ ลงทะเบียนที่ไหน ภายในวันไหน\n'
    + '4. วันเริ่ม-สิ้นสุดของโปร\n'
    + '5. หมวดหมู่ร้านค้าที่ร่วมรายการ\n'
    + '6. เงื่อนไขสำคัญและข้อยกเว้น\n'
    + '7. URL ของหน้าเว็บทางการที่พบข้อมูล\n\n'
    + 'สรุปเป็นภาษาไทย ข้อมูลเท่าที่ค้นพบได้จริงจากเว็บทางการเท่านั้น ห้ามแต่งขึ้นเอง';
}

function callGeminiWithSearch(prompt, apiKey) {
  var url = GEMINI_API_BASE + GEMINI_MODEL + ':generateContent?key=' + apiKey;
  var body = JSON.stringify({
    systemInstruction: { parts: [{ text: 'คุณเป็น AI ผู้ช่วยค้นหาโปรโมชันบัตรเครดิตจากเว็บทางการของธนาคารในไทย ข้อมูลที่สรุปต้องมาจากแหล่งที่ค้นพบจริงเท่านั้น' }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: 8192, temperature: 0.1 },
  });

  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    payload: body, muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini Search error ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }

  var data   = JSON.parse(res.getContentText());
  var cand   = (data.candidates || [])[0] || {};
  var parts  = ((cand.content || {}).parts || []);

  // Skip thinking parts (Gemini 2.5 Flash)
  var rawText = parts
    .filter(function(p) { return !p.thought && typeof p.text === 'string'; })
    .map(function(p) { return p.text; })
    .join('\n');

  // Extract grounding source URLs
  var groundingSources = [];
  var chunks = (cand.groundingMetadata || {}).groundingChunks || [];
  chunks.forEach(function(chunk) {
    if (chunk.web && chunk.web.uri && /^https?:\/\//i.test(chunk.web.uri)) {
      groundingSources.push({ label: chunk.web.title || 'Official source', url: chunk.web.uri });
    }
  });

  return { rawText: rawText, groundingSources: groundingSources };
}

// ---------------------------------------------------------------------------
// Step 2 — Gemini + responseSchema (no tools) → guaranteed JSON array
// ---------------------------------------------------------------------------

function buildExtractionPrompt(rawText, groundingSources, issuers, month) {
  var sourcesText = groundingSources.length
    ? groundingSources.map(function(s) { return s.url; }).join('\n')
    : '(ไม่พบแหล่งข้อมูลเพิ่มเติม)';

  return 'จากข้อมูลโปรโมชันบัตรเครดิตด้านล่าง สกัดและจัดโครงสร้างเป็น JSON array\n\n'
    + 'ธนาคารที่ต้องการ: ' + issuers.join(', ') + '\n'
    + 'เดือน: ' + month + '\n\n'
    + '=== ข้อมูลที่ค้นพบ ===\n'
    + rawText.slice(0, 4000) + '\n\n'
    + '=== URL แหล่งข้อมูล ===\n'
    + sourcesText + '\n\n'
    + 'กฎสำคัญ:\n'
    + '- ใช้เฉพาะข้อมูลที่มีอยู่ข้างบน ห้ามเพิ่มข้อมูลที่ไม่มีในนั้น\n'
    + '- ทุกโปรต้องมี sourceUrls อย่างน้อย 1 รายการ จาก URL แหล่งข้อมูลข้างบน\n'
    + '- ถ้าข้อมูลใดไม่ชัดเจนให้ตั้ง needsReview: true และเพิ่มชื่อ field ใน missingFields\n'
    + '- id ให้ใช้รูปแบบ promo_<issuer>_<4chars> เช่น promo_KTC_ab12\n'
    + '- mechanicSummary ต้องเป็นภาษาไทย 2-3 ประโยค\n'
    + '- ถ้าไม่พบโปรใดเลยสำหรับธนาคารนั้น ไม่ต้องใส่เข้ามา\n'
    + '- ถ้าไม่พบโปรเลย ตอบ []\n'
    + '- สูงสุด 3 โปรต่อธนาคาร เลือกเฉพาะที่สำคัญที่สุด';
}

function callGeminiJsonSchema(prompt, apiKey) {
  var url = GEMINI_API_BASE + GEMINI_MODEL + ':generateContent?key=' + apiKey;
  var body = JSON.stringify({
    systemInstruction: { parts: [{ text: 'คุณเป็น JSON extraction API ตอบกลับด้วย JSON array ที่ถูกต้องตาม schema เท่านั้น' }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: PROMO_RESPONSE_SCHEMA,
      maxOutputTokens: 16384,
      temperature: 0.1,
    },
  });

  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    payload: body, muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini JSON error ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }

  var data  = JSON.parse(res.getContentText());
  var cand  = (data.candidates || [])[0] || {};
  var parts = ((cand.content || {}).parts || []);
  var text  = parts
    .filter(function(p) { return !p.thought && typeof p.text === 'string'; })
    .map(function(p) { return p.text; })
    .join('');

  return JSON.parse(text); // responseSchema guarantees valid JSON
}

// ---------------------------------------------------------------------------
// Normalize & post-process
// ---------------------------------------------------------------------------

function normalizeResults(aiResults, groundingSources) {
  if (!Array.isArray(aiResults)) return [];

  return aiResults.filter(function(item) {
    return item && item.issuer && item.title;
  }).map(function(item) {
    var sourceUrls = (Array.isArray(item.sourceUrls) ? item.sourceUrls : [])
      .filter(function(s) { return s && /^https?:\/\//i.test(s.url); });

    // Fill in grounding sources if none found for this issuer
    if (!sourceUrls.length && groundingSources.length) {
      var cfg = ISSUER_CONFIG[item.issuer] || {};
      var matched = groundingSources.filter(function(s) {
        return cfg.domain && s.url.indexOf(cfg.domain) !== -1;
      });
      sourceUrls = (matched.length ? matched : groundingSources.slice(0, 2))
        .map(function(s) { return { label: s.label, url: s.url }; });
    }

    var missingFields = Array.isArray(item.missingFields) ? item.missingFields.map(String) : [];
    if (!sourceUrls.length && missingFields.indexOf('sourceUrls') === -1) missingFields.push('sourceUrls');
    if (item.registrationRequired) {
      if (!item.registrationChannel && missingFields.indexOf('registrationChannel') === -1) missingFields.push('registrationChannel');
    }
    if (!item.campaignEndDate && missingFields.indexOf('campaignEndDate') === -1) missingFields.push('campaignEndDate');
    if (!item.rewardValueText && missingFields.indexOf('rewardValueText') === -1) missingFields.push('rewardValueText');

    var validConf = ['high', 'medium', 'low', 'unknown'];
    var confidence = validConf.indexOf(item.confidence) !== -1 ? item.confidence : 'unknown';
    var needsReview = item.needsReview === true || !sourceUrls.length || confidence === 'unknown';

    return {
      id: String(item.id || ('promo_' + String(item.issuer).toLowerCase().replace(/\s+/g, '_') + '_' + Math.random().toString(36).slice(2, 6))),
      issuer: String(item.issuer),
      cardNames:            Array.isArray(item.cardNames) ? item.cardNames.filter(Boolean).map(String) : [],
      title:                String(item.title || '').trim() || 'โปรที่ต้องตรวจสอบ',
      mechanicSummary:      String(item.mechanicSummary || '').trim(),
      registrationRequired: item.registrationRequired === true,
      registrationChannel:  String(item.registrationChannel || ''),
      registrationDeadline: String(item.registrationDeadline || ''),
      campaignStartDate:    String(item.campaignStartDate || ''),
      campaignEndDate:      String(item.campaignEndDate || ''),
      rewardType:           String(item.rewardType || ''),
      rewardValueText:      String(item.rewardValueText || ''),
      minSpendText:         String(item.minSpendText || ''),
      capText:              String(item.capText || ''),
      quotaText:            String(item.quotaText || ''),
      categories:           Array.isArray(item.categories) ? item.categories.filter(Boolean).map(String) : [],
      importantConditions:  Array.isArray(item.importantConditions) ? item.importantConditions.filter(Boolean).map(String) : [],
      exclusions:           Array.isArray(item.exclusions) ? item.exclusions.filter(Boolean).map(String) : [],
      sourceUrls:           sourceUrls,
      confidence:           confidence,
      needsReview:          needsReview,
      missingFields:        missingFields.filter(function(v, i, a) { return a.indexOf(v) === i; }),
    };
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

function handlePromoSearch(payload) {
  var props   = PropertiesService.getScriptProperties();
  var month   = payload.month   || '';
  var mode    = payload.mode    || 'monthly';
  var issuers = Array.isArray(payload.issuers) ? payload.issuers : [];

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, message: 'month must be in YYYY-MM format', results: [], warnings: [] };
  }
  if (!issuers.length) {
    return { ok: false, message: 'issuers must be a non-empty array', results: [], warnings: [] };
  }

  if (props.getProperty('MOCK_MODE') === 'true') return getMockResults(payload);

  var apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    return { ok: false, message: 'GEMINI_API_KEY ยังไม่ได้ตั้งค่าใน Script Properties', results: [], warnings: [] };
  }

  var issuerNames = issuers.map(function(i) { return i.issuer; }).filter(Boolean);

  // Cache check
  var ck = cacheKey(issuerNames, month, mode);
  var cached = cacheGet(ck);
  if (cached) return Object.assign({}, cached, { cached: true });

  // ── Step 1: Google Search grounding ──────────────────────────────────────
  var searchInfo;
  try {
    var searchPrompt = buildSearchPrompt(issuerNames, month, mode);
    searchInfo = callGeminiWithSearch(searchPrompt, apiKey);
  } catch (err) {
    return { ok: false, message: 'Search error: ' + String(err.message || err).slice(0, 300), results: [], warnings: [] };
  }

  if (!searchInfo.rawText || searchInfo.rawText.trim().length < 50) {
    return { ok: false, message: 'ไม่พบข้อมูลโปรโมชันจากการค้นหา — ลองใหม่อีกครั้ง', results: [], warnings: [] };
  }

  // ── Step 2: JSON extraction with responseSchema ───────────────────────────
  var aiResults;
  try {
    var extractPrompt = buildExtractionPrompt(searchInfo.rawText, searchInfo.groundingSources, issuerNames, month);
    aiResults = callGeminiJsonSchema(extractPrompt, apiKey);
  } catch (err) {
    return { ok: false, message: 'Extraction error: ' + String(err.message || err).slice(0, 300), results: [], warnings: [] };
  }

  var results  = normalizeResults(aiResults, searchInfo.groundingSources);
  var warnings = [];

  var needsReviewCount = results.filter(function(r) { return r.needsReview; }).length;
  if (needsReviewCount > 0) warnings.push(needsReviewCount + ' โปรมีข้อมูลไม่ครบ — ควรตรวจสอบที่เว็บทางการของธนาคาร');
  warnings.push('บางโปรอาจเป็นสิทธิ์เฉพาะลูกค้าที่ได้รับ SMS หรือ invitation — กรุณาตรวจสอบเงื่อนไขที่เว็บทางการ');

  var response = {
    ok: true,
    searchedAt: new Date().toISOString(),
    month: month, mode: mode,
    issuers: issuerNames,
    results: results,
    warnings: warnings,
  };

  cacheSet(ck, response);
  return response;
}

// ---------------------------------------------------------------------------
// Benefit URL analysis — extract structured benefit rules from page content
// ---------------------------------------------------------------------------

var BENEFIT_RULE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      name:                     { type: 'string' },
      type:                     { type: 'string' },
      cashbackRate:             { type: 'number' },
      cashbackMode:             { type: 'string' },
      cashbackFixedAmount:      { type: 'number' },
      discountRate:             { type: 'number' },
      pointsMultiplier:         { type: 'number' },
      pointsBahtPerPoint:       { type: 'number' },
      merchants:                { type: 'array', items: { type: 'string' } },
      categories:               { type: 'array', items: { type: 'string' } },
      channels:                 { type: 'array', items: { type: 'string' } },
      minSpend:                 { type: 'number' },
      maxRewardPerCycle:        { type: 'number' },
      maxRewardPerTx:           { type: 'number' },
      maxEligibleSpendPerCycle: { type: 'number' },
      startDate:                { type: 'string' },
      endDate:                  { type: 'string' },
      confidence:               { type: 'number' },
      warnings:                 { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'type', 'confidence'],
  },
};

function handleBenefitAnalysis(payload) {
  var props = PropertiesService.getScriptProperties();

  if (props.getProperty('MOCK_MODE') === 'true') {
    return {
      ok: true,
      ruleDrafts: [{
        rule: { name: '[MOCK] Cashback 5%', type: 'cashback', cardId: payload.cardId },
        campaignTitle: '[MOCK] Cashback 5%',
        confidence: 0.9,
        warnings: ['[MOCK DATA]'],
        reviewFields: [],
        diagnostics: [],
      }],
      diagnostics: ['[MOCK MODE]'],
    };
  }

  var apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    return { ok: false, message: 'GEMINI_API_KEY ยังไม่ได้ตั้งค่า', ruleDrafts: [], diagnostics: [] };
  }

  var text = String(payload.mainContentText || '').slice(0, 8000);
  var sourceUrl = String(payload.sourceUrl || '');

  if (!text || text.trim().length < 50) {
    return { ok: false, message: 'เนื้อหาน้อยเกินไป ไม่สามารถวิเคราะห์ได้', ruleDrafts: [], diagnostics: [] };
  }

  var prompt = 'สกัดสิทธิประโยชน์บัตรเครดิตจากเนื้อหาด้านล่าง\n\n'
    + 'URL: ' + sourceUrl + '\n\n'
    + '=== เนื้อหา ===\n' + text + '\n\n'
    + 'กฎสำคัญ:\n'
    + '- ตอบเป็น JSON array เท่านั้น\n'
    + '- แต่ละ item คือ 1 สิทธิประโยชน์/กฎ\n'
    + '- name ต้องเป็นภาษาไทย กระชับ ไม่เกิน 40 ตัวอักษร\n'
    + '- type: cashback | discount | points | mixed\n'
    + '- cashbackRate: ตัวเลขเปอร์เซ็นต์ เช่น 5 (ไม่ใช่ 0.05)\n'
    + '- channels: online | offline | all\n'
    + '- startDate / endDate: รูปแบบ YYYY-MM-DD หรือ null\n'
    + '- confidence: 0-1 ความมั่นใจในข้อมูล\n'
    + '- warnings: รายการเตือน เช่น ไม่พบวันหมดอายุ\n'
    + '- ฟิลด์ที่หาไม่ได้ให้ใส่ null หรือ array ว่าง\n'
    + '- ถ้าไม่มีสิทธิประโยชน์ชัดเจน ตอบ []';

  var url = GEMINI_API_BASE + GEMINI_MODEL + ':generateContent?key=' + apiKey;
  var body = JSON.stringify({
    systemInstruction: { parts: [{ text: 'คุณเป็น JSON extraction API สำหรับสกัดสิทธิประโยชน์บัตรเครดิต ตอบด้วย JSON array เท่านั้น' }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: BENEFIT_RULE_SCHEMA,
      maxOutputTokens: 4096,
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
    return { ok: false, message: 'Gemini error ' + res.getResponseCode(), ruleDrafts: [], diagnostics: [] };
  }

  var data = JSON.parse(res.getContentText());
  var parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  var responseText = parts
    .filter(function(p) { return !p.thought && typeof p.text === 'string'; })
    .map(function(p) { return p.text; })
    .join('');

  var items;
  try {
    items = JSON.parse(responseText);
    if (!Array.isArray(items)) items = [];
  } catch (_) {
    return { ok: false, message: 'Gemini ตอบกลับ JSON ไม่ถูกต้อง', ruleDrafts: [], diagnostics: [responseText.slice(0, 200)] };
  }

  var ruleDrafts = items.map(function(item) {
    var type = String(item.type || 'cashback');
    if (type === 'mixed') type = 'both';
    var rule = {
      name: String(item.name || 'สิทธิประโยชน์จาก AI').slice(0, 60),
      type: type,
      cardId: String(payload.cardId || ''),
      source: sourceUrl,
      active: true,
      suggestedConditions: {
        categories: Array.isArray(item.categories) ? item.categories : [],
        merchants: Array.isArray(item.merchants) ? item.merchants : [],
        channels: Array.isArray(item.channels) ? item.channels : [],
        minSpend: Number(item.minSpend) || null,
      },
      validity: {
        mode: (item.startDate || item.endDate) ? 'range' : 'always',
        startDate: item.startDate || '',
        endDate: item.endDate || '',
        statementCycleHint: 'statement_cycle',
      },
      cashback: {
        mode: String(item.cashbackMode || 'percent'),
        rate: Number(item.cashbackRate) || null,
        fixedAmount: Number(item.cashbackFixedAmount) || null,
      },
      discount: {
        mode: 'percent',
        rate: Number(item.discountRate) || null,
        fixedAmount: null,
      },
      points: {
        bahtPerPoint: Number(item.pointsBahtPerPoint) || null,
        multiplier: Number(item.pointsMultiplier) || 1,
        multiplierMode: 'total',
      },
      limits: {
        maxEligibleSpendPerTx: null,
        maxEligibleSpendPerCycle: Number(item.maxEligibleSpendPerCycle) || null,
        maxRewardAmountPerTx: Number(item.maxRewardPerTx) || null,
        maxRewardAmountPerCycle: Number(item.maxRewardPerCycle) || null,
      },
      rewardTrigger: { mode: 'none', thresholdAmount: null, grantMode: 'once_per_cycle' },
      allowStacking: true,
      isBaseRule: false,
      priority: 20,
    };
    var warnings = Array.isArray(item.warnings) ? item.warnings : [];
    var reviewFields = [];
    if (!item.cashbackRate && !item.discountRate && !item.pointsMultiplier) reviewFields.push('reward');
    if (!item.merchants || !item.merchants.length) reviewFields.push('merchants');
    if (!item.endDate) reviewFields.push('validity');
    return {
      rule: rule,
      sourceUrl: sourceUrl,
      campaignTitle: rule.name,
      confidence: Number(item.confidence) || 0.5,
      warnings: warnings,
      reviewFields: reviewFields,
      diagnostics: [],
    };
  });

  var diags = [];
  if (items.length === 0) diags.push('ไม่พบสิทธิประโยชน์ที่ชัดเจนในหน้านี้ ลองใส่ลิงก์หน้าโปรโมชันโดยตรง');
  diags.push('endpoint version: ' + SCRIPT_VERSION);
  return {
    ok: true,
    version: SCRIPT_VERSION,
    ruleDrafts: ruleDrafts,
    diagnostics: diags,
  };
}

// ---------------------------------------------------------------------------
// Local test function (run from Apps Script editor → check Execution log)
// ---------------------------------------------------------------------------

function testSearch() {
  var result = handlePromoSearch({
    month: new Date().toISOString().slice(0, 7),
    mode: 'monthly',
    issuers: [{ issuer: 'KTC', cardNames: [], walletIds: [] }],
  });
  Logger.log(JSON.stringify(result, null, 2));
}
