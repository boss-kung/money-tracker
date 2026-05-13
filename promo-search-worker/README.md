# Money Tracker — AI Credit Card Promo Search Worker

Cloudflare Worker that powers the **โปรบัตรเครดิต** feature in Money Tracker.

## What it does

- Accepts `POST /promo-search` from the GitHub Pages frontend
- Fetches official bank promotion pages for the requested issuers
- Sends extracted text to Claude (Anthropic AI) server-side
- Returns structured, source-backed promotion JSON
- Never fabricates promotion data
- Marks incomplete results with `needsReview` + `missingFields`

## Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/): `npm install -g wrangler`
- Cloudflare account (free tier works)
- Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

---

## Setup

### 1. Install dependencies

```bash
cd promo-search-worker
npm install
```

### 2. Log in to Cloudflare

```bash
wrangler login
```

### 3. Add the Anthropic API key as a secret

```bash
npm run secret
# Paste your Anthropic API key when prompted.
# It is stored encrypted in Cloudflare — never committed to the repo.
```

### 4. Deploy the Worker

```bash
npm run deploy
```

Wrangler will print the Worker URL, e.g.:
```
https://money-tracker-promo-search.<your-subdomain>.workers.dev
```

### 5. Connect the frontend

Open `index.html` in the Money Tracker repo and paste the Worker URL:

```html
window.MT_PROMO_SEARCH_ENDPOINT = "https://money-tracker-promo-search.<your-subdomain>.workers.dev/promo-search";
```

### 6. Deploy GitHub Pages

```bash
git add index.html
git commit -m "Connect promo search endpoint"
git push
```

### 7. Test

Open **More → โปรบัตรเครดิต → ค้นหาโปรเดือนนี้** on your device.

---

## Local development (mock mode)

To test the frontend shape without a real AI call, enable mock mode in `wrangler.toml`:

```toml
[vars]
MOCK_MODE = "true"   # Enable ONLY for local dev
```

Then run locally:

```bash
npm run dev
# Worker listens at http://localhost:8787
```

Set the endpoint in index.html temporarily:
```js
window.MT_PROMO_SEARCH_ENDPOINT = "http://localhost:8787/promo-search";
```

**Important:** Remove `MOCK_MODE = "true"` before deploying to production.
Mock results are clearly labeled and must never appear as real user data.

---

## Request schema

```json
{
  "month": "2026-05",
  "mode": "monthly",
  "issuers": [
    {
      "issuer": "KTC",
      "cardNames": ["KTC VISA PLATINUM"],
      "walletIds": ["wallet_xxx"]
    }
  ],
  "locale": "th-TH",
  "officialSourcesOnly": true,
  "sourcesRequired": true
}
```

## Response schema

```json
{
  "ok": true,
  "searchedAt": "2026-05-13T14:20:00.000Z",
  "month": "2026-05",
  "mode": "monthly",
  "issuers": ["KTC"],
  "results": [
    {
      "id": "promo_ktc_abc1",
      "issuer": "KTC",
      "cardNames": [],
      "title": "Dining Cashback",
      "mechanicSummary": "...",
      "registrationRequired": true,
      "registrationChannel": "KTC Mobile",
      "registrationDeadline": "2026-05-31",
      "campaignStartDate": "2026-05-01",
      "campaignEndDate": "2026-05-31",
      "rewardType": "cashback",
      "rewardValueText": "10% cashback สูงสุด 300 บาท",
      "minSpendText": "ครบ 3,000 บาท",
      "capText": "สูงสุด 300 บาท",
      "quotaText": "จำกัดสิทธิ์ตามเงื่อนไขธนาคาร",
      "categories": ["dining"],
      "importantConditions": ["ต้องลงทะเบียนก่อนใช้"],
      "exclusions": [],
      "sourceUrls": [{"label": "KTC Official Promotion", "url": "https://..."}],
      "confidence": "medium",
      "needsReview": false,
      "missingFields": []
    }
  ],
  "warnings": ["บางโปรอาจเป็นสิทธิ์เฉพาะลูกค้าที่ได้รับ SMS"]
}
```

---

## Environment variables

| Variable | Where to set | Required | Default |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | `wrangler secret put` | Yes | — |
| `MOCK_MODE` | `wrangler.toml [vars]` | No | `"false"` |
| `CACHE_TTL_HOURS` | `wrangler.toml [vars]` | No | `"6"` |

---

## Known limitations (Phase 1)

- **PDF terms are not extracted.** PDFs are flagged with `needsReview: true` and the URL is preserved. Manual review required.
- **Some bank pages may block automated fetches** (Cloudflare WAF, bot detection). Affected issuers will appear in `warnings`.
- **In-memory cache only.** Cache resets on Worker restart/redeploy. Cloudflare KV is planned for Phase 2.
- **No bypass-cache UI.** Frontend always uses cached results for the same issuer/month/mode within the TTL window.

## Phase 2 roadmap

- Cloudflare KV for persistent caching
- Per-issuer custom parsers for structured HTML scraping
- PDF extraction via external service
- Cache bypass via `X-Force-Refresh: true` header
- Webhook push when new promotions are detected
