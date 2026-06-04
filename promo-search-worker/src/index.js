/**
 * Money Tracker — AI Credit Card Promo Search
 * Cloudflare Worker  POST /promo-search
 *
 * Required secrets (set via `wrangler secret put`):
 *   ANTHROPIC_API_KEY   — Anthropic Claude API key
 *
 * Optional env vars (set in wrangler.toml [vars]):
 *   MOCK_MODE           — "true" enables mock responses (local dev only, NEVER set in production)
 *   CACHE_TTL_HOURS     — cache lifetime in hours (default 6)
 */

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = [
  'https://boss-kung.github.io',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:3000',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function handleOptions(request) {
  const origin = request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
    },
  });
}

// ---------------------------------------------------------------------------
// In-memory cache (resets on Worker restart — good enough for Phase 1)
// ---------------------------------------------------------------------------

const _cache = new Map();

function cacheKey(issuers, month, mode) {
  return `${[...issuers].sort().join(',')}|${month}|${mode}`;
}

function cacheGet(key, ttlMs) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttlMs) { _cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data) {
  _cache.set(key, { ts: Date.now(), data });
}

// ---------------------------------------------------------------------------
// Official issuer source configuration  (PART B)
// ---------------------------------------------------------------------------

const ISSUER_SOURCES = {
  KTC: {
    officialDomains: ['www.ktc.co.th'],
    promotionSearchHints: [
      'https://www.ktc.co.th/promotion',
      'https://www.ktc.co.th/th/promotion/credit-card-promotion',
    ],
    knownPromotionUrls: [
      'https://www.ktc.co.th/th/promotion/credit-card-promotion',
    ],
  },
  UOB: {
    officialDomains: ['www.uob.co.th'],
    promotionSearchHints: [
      'https://www.uob.co.th/th/personal/cards/promotions/index.html',
    ],
    knownPromotionUrls: [
      'https://www.uob.co.th/th/personal/cards/promotions/index.html',
    ],
  },
  SCB: {
    officialDomains: ['www.scb.co.th', 'www.cardx.co.th'],
    promotionSearchHints: [
      'https://www.scb.co.th/th/personal-banking/credit-cards/promotions.html',
      'https://www.cardx.co.th/th/promotions',
    ],
    knownPromotionUrls: [
      'https://www.scb.co.th/th/personal-banking/credit-cards/promotions.html',
    ],
  },
  Krungsri: {
    officialDomains: ['www.krungsri.com'],
    promotionSearchHints: [
      'https://www.krungsri.com/th/promotions/credit-card',
    ],
    knownPromotionUrls: [
      'https://www.krungsri.com/th/promotions/credit-card',
    ],
  },
  'First Choice': {
    officialDomains: ['www.firstchoice.co.th', 'www.krungsri.com'],
    promotionSearchHints: [
      'https://www.firstchoice.co.th/firstchoice/promotions',
    ],
    knownPromotionUrls: [
      // TODO: verify current URL for First Choice promotions
    ],
  },
  'Bangkok Bank': {
    officialDomains: ['www.bangkokbank.com'],
    promotionSearchHints: [
      'https://www.bangkokbank.com/th-TH/Personal/Cards/Credit-Cards/Promotions',
    ],
    knownPromotionUrls: [
      'https://www.bangkokbank.com/th-TH/Personal/Cards/Credit-Cards/Promotions',
    ],
  },
  KBank: {
    officialDomains: ['www.kasikornbank.com'],
    promotionSearchHints: [
      'https://www.kasikornbank.com/th/personal/card/creditcard/privilege/Pages/main.aspx',
    ],
    knownPromotionUrls: [
      'https://www.kasikornbank.com/th/personal/card/creditcard/privilege/Pages/main.aspx',
    ],
  },
  TTB: {
    officialDomains: ['www.ttbbank.com'],
    promotionSearchHints: [
      'https://www.ttbbank.com/th/promotions/credit-card',
    ],
    knownPromotionUrls: [
      // TODO: verify current URL for TTB promotions
    ],
  },
  AEON: {
    officialDomains: ['www.aeon.co.th'],
    promotionSearchHints: [
      'https://www.aeon.co.th/promotion/creditcard',
    ],
    knownPromotionUrls: [
      // TODO: verify current URL for AEON promotions
    ],
  },
};

// ---------------------------------------------------------------------------
// Source resolution & fetching  (PART C)
// ---------------------------------------------------------------------------

function resolveOfficialSources(issuer) {
  return ISSUER_SOURCES[issuer] || {
    officialDomains: [],
    promotionSearchHints: [],
    knownPromotionUrls: [],
  };
}

async function searchOfficialPromoPages(issuer, month, mode) {
  const config = resolveOfficialSources(issuer);
  const urls = [
    ...config.knownPromotionUrls,
    ...config.promotionSearchHints,
  ].filter(Boolean);

  const fetched = [];
  for (const url of urls) {
    try {
      const result = await fetchOfficialSource(url, issuer, month);
      if (result) fetched.push(result);
    } catch (_) {
      // non-fatal — continue with remaining URLs
    }
  }
  return fetched;
}

async function fetchOfficialSource(url, issuer, month) {
  const isPdf = /\.pdf(\?.*)?$/i.test(url);

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MoneyTrackerPromoBot/1.0)',
      'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
    cf: { cacheTtl: 3600, cacheEverything: false },
  });

  if (!res.ok) return null;

  if (isPdf) {
    // PDF binary extraction is out of scope for Phase 1
    return {
      url,
      issuer,
      isPdf: true,
      text: '',
      pdfSkipped: true,
    };
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('html') && !contentType.includes('text')) return null;

  const html = await res.text();
  const text = extractTextFromHtml(html);
  return { url, issuer, isPdf: false, text };
}

function extractTextFromHtml(html) {
  // Remove scripts, styles, and HTML tags; collapse whitespace
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
    .slice(0, 40000); // limit per page to keep prompt manageable
}

// ---------------------------------------------------------------------------
// AI extraction  (PART D)
// ---------------------------------------------------------------------------

function buildAiExtractionPrompt(sourceDocuments, requestPayload) {
  const { month, mode, issuers, locale } = requestPayload;
  const issuerNames = issuers.map(i => i.issuer).join(', ');

  const docsSection = sourceDocuments.map((doc, idx) => {
    if (doc.pdfSkipped) {
      return `--- Source ${idx + 1} [PDF — text not extracted] ---\nURL: ${doc.url}\nIssuer: ${doc.issuer}\n(PDF content must be reviewed manually)\n`;
    }
    return `--- Source ${idx + 1} ---\nURL: ${doc.url}\nIssuer: ${doc.issuer}\n\n${doc.text || '(empty)'}\n`;
  }).join('\n');

  return `You are a Thai credit card promotion analyst. Your task is to extract structured promotion data from the official bank website text provided below.

STRICT RULES:
1. Summarize ONLY from the text and URLs provided. Do NOT invent or hallucinate any promotion details.
2. Return ONLY valid JSON — no markdown, no explanation, no code fences.
3. If a field value is unknown or missing, set it to null or empty string ("") and add the field name to missingFields.
4. If promotion terms are unclear or ambiguous, set needsReview to true.
5. Every promotion MUST include at least one sourceUrls entry with the official URL from which the information was extracted.
6. Summarize mechanicSummary in Thai (th-TH).
7. Focus ONLY on credit card promotions. Ignore debit cards, loans, insurance-only, deposit-only, or unrelated promotions unless clearly linked to credit card usage.
8. Ignore promotions that have already expired relative to ${month}.
9. Focus on ${mode === 'ongoing' ? 'ongoing / evergreen promotions' : `promotions active in ${month}`}.
10. Target issuers: ${issuerNames}.

OUTPUT FORMAT (JSON array of promotion objects):
[
  {
    "id": "promo_<issuer_shortcode>_<random_4chars>",
    "issuer": "<issuer name, must match one of: ${issuerNames}>",
    "cardNames": ["<specific card name if mentioned, else empty array>"],
    "title": "<short promotion title in Thai or English>",
    "mechanicSummary": "<2-3 sentence Thai summary of how the promotion works>",
    "registrationRequired": <true|false|null>,
    "registrationChannel": "<e.g. KTC Mobile, SMS, web — or null>",
    "registrationDeadline": "<YYYY-MM-DD or null>",
    "campaignStartDate": "<YYYY-MM-DD or null>",
    "campaignEndDate": "<YYYY-MM-DD or null>",
    "rewardType": "<cashback|points|discount|voucher|other|null>",
    "rewardValueText": "<human-readable reward value, e.g. '10% cashback สูงสุด 300 บาท' or null>",
    "minSpendText": "<min spend condition in Thai or null>",
    "capText": "<cap/ceiling in Thai or null>",
    "quotaText": "<quota limit in Thai or null>",
    "categories": ["<spending categories: dining|fuel|travel|shopping|online|entertainment|other>"],
    "importantConditions": ["<key conditions that affect eligibility or reward>"],
    "exclusions": ["<excluded merchants, card types, or transaction types>"],
    "sourceUrls": [{"label": "<page title or 'Official Promotion Page'>", "url": "<exact URL of source>"}],
    "confidence": "<high|medium|low|unknown>",
    "needsReview": <true|false>,
    "missingFields": ["<field names that are missing or uncertain>"]
  }
]

If NO promotions are found for the target issuers and month, return an empty array: []

--- OFFICIAL SOURCE TEXT BELOW ---

${docsSection}

--- END OF SOURCE TEXT ---

Return only the JSON array now:`;
}

async function callAiExtractor(prompt, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.content?.[0]?.text || '';
  return content;
}

// ---------------------------------------------------------------------------
// Normalization & Validation  (PARTS C + E)
// ---------------------------------------------------------------------------

function normalizePromoResults(aiJson, requestPayload) {
  const rawArray = Array.isArray(aiJson) ? aiJson : [];
  const month = requestPayload.month || '';

  return rawArray.map((item, idx) => {
    const sourceUrls = Array.isArray(item?.sourceUrls)
      ? item.sourceUrls
          .map(s => ({ label: String(s?.label || 'Official source'), url: String(s?.url || '').trim() }))
          .filter(s => /^https?:\/\//i.test(s.url))
      : [];

    const missingFields = Array.isArray(item?.missingFields)
      ? [...item.missingFields.map(String)]
      : [];

    if (!sourceUrls.length && !missingFields.includes('sourceUrls')) {
      missingFields.push('sourceUrls');
    }

    const registrationRequired = item?.registrationRequired === true;
    if (registrationRequired) {
      if (!item?.registrationChannel && !missingFields.includes('registrationChannel')) {
        missingFields.push('registrationChannel');
      }
      if (!item?.registrationDeadline && !missingFields.includes('registrationDeadline')) {
        missingFields.push('registrationDeadline');
      }
    }

    if (!item?.campaignEndDate && !missingFields.includes('campaignEndDate')) {
      missingFields.push('campaignEndDate');
    }
    if (!item?.rewardValueText && !missingFields.includes('rewardValueText')) {
      missingFields.push('rewardValueText');
    }

    const confidence = ['high', 'medium', 'low', 'unknown'].includes(item?.confidence)
      ? item.confidence
      : 'unknown';

    const needsReview =
      item?.needsReview === true ||
      !sourceUrls.length ||
      !item?.mechanicSummary ||
      confidence === 'unknown';

    const idSuffix = Math.random().toString(36).slice(2, 6);
    const issuer = String(item?.issuer || '');

    return {
      id: String(item?.id || `promo_${issuer.toLowerCase().replace(/\s+/g, '_')}_${idSuffix}`),
      issuer,
      cardNames: Array.isArray(item?.cardNames) ? item.cardNames.filter(Boolean).map(String) : [],
      title: String(item?.title || '').trim() || 'โปรที่ต้องตรวจสอบ',
      mechanicSummary: String(item?.mechanicSummary || '').trim(),
      registrationRequired,
      registrationChannel: String(item?.registrationChannel || ''),
      registrationDeadline: String(item?.registrationDeadline || ''),
      campaignStartDate: String(item?.campaignStartDate || ''),
      campaignEndDate: String(item?.campaignEndDate || ''),
      rewardType: String(item?.rewardType || ''),
      rewardValueText: String(item?.rewardValueText || ''),
      minSpendText: String(item?.minSpendText || ''),
      capText: String(item?.capText || ''),
      quotaText: String(item?.quotaText || ''),
      categories: Array.isArray(item?.categories) ? item.categories.filter(Boolean).map(String) : [],
      importantConditions: Array.isArray(item?.importantConditions) ? item.importantConditions.filter(Boolean).map(String) : [],
      exclusions: Array.isArray(item?.exclusions) ? item.exclusions.filter(Boolean).map(String) : [],
      sourceUrls,
      confidence,
      needsReview,
      missingFields: [...new Set(missingFields)],
    };
  });
}

function validatePromoResults(results) {
  if (!Array.isArray(results)) return [];

  return results.filter(promo => {
    if (!promo.issuer) return false; // must have issuer
    if (!promo.title) return false;  // must have title
    return true;
  });
}

// ---------------------------------------------------------------------------
// Mock mode  (PART K — local testing only, NEVER in production by default)
// ---------------------------------------------------------------------------

function getMockResults(requestPayload) {
  const { month, mode, issuers } = requestPayload;
  const results = [];

  for (const issuerRow of issuers) {
    const issuer = issuerRow.issuer;
    results.push({
      id: `mock_promo_${issuer.toLowerCase().replace(/\s+/g, '_')}_abc1`,
      issuer,
      cardNames: issuerRow.cardNames || [],
      title: `[MOCK] ${issuer} Dining Cashback ${month}`,
      mechanicSummary: `[ข้อมูล MOCK เพื่อทดสอบเท่านั้น] ใช้จ่ายร้านอาหารผ่านบัตร ${issuer} ครบ 3,000 บาท รับ cashback 10% สูงสุด 300 บาท`,
      registrationRequired: true,
      registrationChannel: 'Mobile App',
      registrationDeadline: `${month}-15`,
      campaignStartDate: `${month}-01`,
      campaignEndDate: `${month}-31`,
      rewardType: 'cashback',
      rewardValueText: '10% cashback สูงสุด 300 บาท',
      minSpendText: 'ครบ 3,000 บาท',
      capText: 'สูงสุด 300 บาท',
      quotaText: 'จำกัดสิทธิ์ตามเงื่อนไขธนาคาร',
      categories: ['dining'],
      importantConditions: ['ต้องลงทะเบียนก่อนใช้', '[MOCK DATA — ไม่ใช่ข้อมูลจริง]'],
      exclusions: [],
      sourceUrls: [
        { label: 'MOCK — Official Promotion Page (ไม่ใช่ลิงก์จริง)', url: `https://www.example.com/mock-promo-${issuer.toLowerCase()}` },
      ],
      confidence: 'low',
      needsReview: true,
      missingFields: ['MOCK_DATA'],
    });
  }

  return {
    ok: true,
    mock: true,
    searchedAt: new Date().toISOString(),
    month,
    mode,
    issuers: issuers.map(i => i.issuer),
    results,
    warnings: [
      '[MOCK MODE] ผลลัพธ์นี้เป็น mock data เพื่อทดสอบเท่านั้น ไม่ใช่ข้อมูลโปรโมชันจริง',
      'ปิดการใช้งาน MOCK_MODE ก่อน deploy จริง',
    ],
  };
}

// ---------------------------------------------------------------------------
// Main search handler  (PARTS A + C + D + E + F)
// ---------------------------------------------------------------------------

async function handlePromoSearch(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return { ok: false, message: 'Request body must be valid JSON', results: [], warnings: [] };
  }

  const { month, mode = 'monthly', issuers = [], locale = 'th-TH' } = payload;

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, message: 'month must be in YYYY-MM format', results: [], warnings: [] };
  }
  if (!Array.isArray(issuers) || issuers.length === 0) {
    return { ok: false, message: 'issuers must be a non-empty array', results: [], warnings: [] };
  }

  // Mock mode — only for local dev
  if (String(env.MOCK_MODE || '').toLowerCase() === 'true') {
    return getMockResults(payload);
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      message: 'ANTHROPIC_API_KEY ยังไม่ได้ตั้งค่าใน Worker secrets',
      results: [],
      warnings: [],
    };
  }

  // Check cache
  const cacheTtlHours = parseFloat(env.CACHE_TTL_HOURS || '6');
  const cacheTtlMs = cacheTtlHours * 60 * 60 * 1000;
  const issuerNames = issuers.map(i => i.issuer).filter(Boolean);
  const ck = cacheKey(issuerNames, month, mode);
  const cached = cacheGet(ck, cacheTtlMs);
  if (cached) {
    return { ...cached, cached: true };
  }

  // Fetch official sources
  const warnings = [];
  const allSourceDocs = [];

  for (const issuerRow of issuers) {
    const issuer = issuerRow.issuer;
    if (!issuer) continue;

    try {
      const docs = await searchOfficialPromoPages(issuer, month, mode);
      for (const doc of docs) {
        allSourceDocs.push(doc);
        if (doc.pdfSkipped) {
          warnings.push(`ไฟล์ PDF ของ ${issuer} (${doc.url}) ไม่ได้รับการแปลงข้อความ — ควรตรวจสอบ PDF เอง`);
        }
      }
      if (!docs.length) {
        warnings.push(`ไม่สามารถดึงข้อมูลจากเว็บทางการของ ${issuer} ได้ — อาจมี CORS หรือ block`);
      }
    } catch (err) {
      warnings.push(`เกิดข้อผิดพลาดขณะดึงข้อมูลจาก ${issuer}: ${String(err?.message || err).slice(0, 100)}`);
    }
  }

  if (!allSourceDocs.length) {
    return {
      ok: false,
      message: 'ไม่สามารถดึงข้อมูลจากเว็บทางการของธนาคารที่เลือกได้',
      results: [],
      warnings,
    };
  }

  // Build AI prompt and call Claude
  let rawAiText = '';
  try {
    const prompt = buildAiExtractionPrompt(allSourceDocs, payload);
    rawAiText = await callAiExtractor(prompt, apiKey);
  } catch (err) {
    return {
      ok: false,
      message: `AI extraction failed: ${String(err?.message || err).slice(0, 200)}`,
      results: [],
      warnings,
    };
  }

  // Parse AI JSON output
  let aiJson = [];
  try {
    // Strip any accidental markdown fences
    const cleaned = rawAiText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    aiJson = JSON.parse(cleaned);
    if (!Array.isArray(aiJson)) aiJson = [];
  } catch (_) {
    return {
      ok: false,
      message: 'AI ส่งข้อมูลกลับมาในรูปแบบที่ไม่ใช่ JSON — ลองค้นหาอีกครั้ง',
      results: [],
      warnings: [...warnings, `AI raw output (100 chars): ${rawAiText.slice(0, 100)}`],
    };
  }

  // Normalize + validate
  const normalized = normalizePromoResults(aiJson, payload);
  const results = validatePromoResults(normalized);

  // Add review warnings
  const needsReviewCount = results.filter(r => r.needsReview).length;
  if (needsReviewCount > 0) {
    warnings.push(`${needsReviewCount} โปรมีข้อมูลไม่ครบ ควรตรวจสอบกับเว็บทางการของธนาคารก่อนตัดสินใจ`);
  }

  warnings.push('บางโปรอาจเป็นสิทธิ์เฉพาะลูกค้าที่ได้รับ SMS หรือ invitation — กรุณาตรวจสอบเงื่อนไขที่เว็บทางการ');

  const response = {
    ok: true,
    searchedAt: new Date().toISOString(),
    month,
    mode,
    issuers: issuerNames,
    results,
    warnings,
  };

  cacheSet(ck, response);
  return response;
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    // Preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    // Only POST /promo-search
    if (request.method !== 'POST' || url.pathname !== '/promo-search') {
      return jsonResponse(
        { ok: false, message: 'Only POST /promo-search is supported', results: [], warnings: [] },
        404,
        origin,
      );
    }

    try {
      const result = await handlePromoSearch(request, env);
      const status = result.ok ? 200 : 400;
      return jsonResponse(result, status, origin);
    } catch (err) {
      console.error('Unhandled error:', err);
      return jsonResponse(
        { ok: false, message: 'Internal server error — กรุณาลองใหม่', results: [], warnings: [] },
        500,
        origin,
      );
    }
  },
};
