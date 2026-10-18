import {
  canonicalDedupeMaterial,
  normalizeCaptureText,
  sha256Hex,
  ShortcutRequestError,
  type ValidatedCaptureV1,
} from './shortcut_capture.ts'

const CAPTURE_METHODS = new Set(['line_notification', 'whats_on_screen'])
const PARSER_VERSION = 'shortcut-server-1.0.0'

const FULL_BLOCK_PATTERNS = [
  /มีการใช้บัตร\s+UOB-\d{4}[\s\S]*?วงเงินคงเหลือใช้ได้\s*[\d,]+(?:\.\d{1,2})?\s*THB/giu,
  /You have spent[\s\S]*?Available credit:\s*THB\s*[\d,]+(?:\.\d{1,2})?/giu,
  /รายการเงิน(?:ออก|เข้า)\s*-?[\d,]+(?:\.\d{1,2})?\s*บาท[\s\S]*?ยอดเงินที่ใช้ได้\s*[\d,]+(?:\.\d{1,2})?\s*บาท/giu,
  /LINE Pay Purchase[\s\S]*?Balance:\s*(?:THB\s*)?[\d,]+(?:\.\d{1,2})?/giu,
]

// LINE may deliver only a notification preview, which often omits the
// available-credit/balance/date suffix present in the full bank screen. These
// relaxed patterns are deliberately enabled only for line_notification
// captures and stop at the next transaction anchor so the latest block wins.
const COMPACT_NOTIFICATION_PATTERNS = [
  /มีการใช้บัตร\s+UOB-\d{4}[\s\S]*?(?:จำนวน\s*)?[\d,]+(?:\.\d{1,2})?\s*THB[\s\S]*?(?=\n(?:มีการใช้บัตร|You have spent|รายการเงิน(?:ออก|เข้า)|LINE Pay Purchase)|$)/giu,
  /You have spent[\s\S]*?THB\s*[\d,]+(?:\.\d{1,2})?[\s\S]*?(?=\n(?:มีการใช้บัตร|You have spent|รายการเงิน(?:ออก|เข้า)|LINE Pay Purchase)|$)/giu,
  /รายการเงิน(?:ออก|เข้า)\s*-?[\d,]+(?:\.\d{1,2})?\s*บาท[\s\S]*?(?=\n(?:มีการใช้บัตร|You have spent|รายการเงิน(?:ออก|เข้า)|LINE Pay Purchase)|$)/giu,
  /LINE Pay Purchase\s*(?:฿\s*|THB\s*)?[\d,]+(?:\.\d{1,2})?[\s\S]*?(?=\n(?:มีการใช้บัตร|You have spent|รายการเงิน(?:ออก|เข้า)|LINE Pay Purchase)|$)/giu,
]

function invalid(): never {
  throw new ShortcutRequestError(400, 'invalid_capture')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeForParsing(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ')
}

function latestBlock(text: string, captureMethod: string): string | null {
  const patterns = captureMethod === 'line_notification'
    ? [...COMPACT_NOTIFICATION_PATTERNS, ...FULL_BLOCK_PATTERNS]
    : FULL_BLOCK_PATTERNS
  const matches = patterns.flatMap(pattern => [...text.matchAll(pattern)].map(match => ({ index: match.index ?? -1, text: match[0] })))
  return matches.sort((left, right) => left.index - right.index).at(-1)?.text ?? null
}

function clean(value: string | undefined): string | null {
  return value?.trim().replace(/[ \t]+/g, ' ').replace(/\s*(?:…|\.\.\.)\s*$/u, '') || null
}

function amount(value: string | undefined): string | null {
  if (!value) return null
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isFinite(parsed) && parsed > 0 ? Math.abs(parsed).toFixed(2) : null
}

function dateFromText(text: string): string | null {
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})\s+@?(\d{2}):(\d{2})/u)
  if (!match) return null
  const [, day, month, year, hour, minute] = match
  return `${year}-${month}-${day}T${hour}:${minute}:00+07:00`
}

function timestamp(value: unknown, fallback: string): string {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : fallback
  if (Number.isNaN(Date.parse(candidate)) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(candidate)) invalid()
  return candidate.replace(/z$/i, 'Z').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
}

function rawText(value: unknown): string {
  if (typeof value !== 'string') invalid()
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 32 * 1024) invalid()
  return trimmed
}

export async function parseRawShortcutCapture(input: unknown, now = new Date().toISOString()): Promise<ValidatedCaptureV1> {
  if (!isRecord(input) || typeof input.capture_method !== 'string' || !CAPTURE_METHODS.has(input.capture_method)) invalid()
  const originalText = rawText(input.raw_text)
  const capturedAt = timestamp(input.captured_at, now)
  const block = latestBlock(normalizeForParsing(originalText), input.capture_method)
  if (!block) invalid()

  const payload: ValidatedCaptureV1 = {
    schema_version: 'money-tracker.capture.v1',
    parser_version: PARSER_VERSION,
    source: 'unknown',
    bank: null,
    amount: '',
    currency: 'THB',
    direction: 'debit',
    merchant: null,
    description: null,
    account_last4: null,
    card_last4: null,
    transaction_datetime: dateFromText(block),
    captured_at: capturedAt,
    capture_method: input.capture_method as 'line_notification' | 'whats_on_screen',
    raw_text: originalText,
    relevant_text: normalizeCaptureText(block),
    parse_status: 'complete',
    dedupe_version: 1,
    dedupe_key: '',
  }

  if (/มีการใช้บัตร|You have spent/iu.test(block)) {
    const thai = /มีการใช้บัตร/u.test(block)
    payload.source = 'uob_thai'
    payload.bank = 'UOB'
    const transactionText = thai ? block.split(/วงเงินคงเหลือใช้ได้/iu, 1)[0] : block
    payload.amount = amount(transactionText.match(thai ? /(?:จำนวน\s*)?([\d,]+(?:\.\d{1,2})?)\s*THB/u : /spent\s+THB\s*([\d,]+(?:\.\d{1,2})?)/iu)?.[1]) || ''
    const thaiMerchant = block.match(/ที่ร้าน\s*([^\n\r]+)/u)?.[1]
      ?? block.match(/UOB-\d{4}\s+(?:จำนวน\s*)?(.+?)\s+[\d,]+(?:\.\d{1,2})?\s*THB/iu)?.[1]
    payload.merchant = clean(thai ? thaiMerchant : block.match(/\sat\s+(.+?)(?:\s+on\s+\d{2}\/|[\n\r]|$)/iu)?.[1])
    payload.card_last4 = block.match(thai ? /UOB-(\d{4})/u : /ending\s+(?:UOB-)?(\d{4})/iu)?.[1] ?? null
  } else if (/รายการเงิน(?:ออก|เข้า)/u.test(block)) {
    const money = block.match(/รายการเงิน(ออก|เข้า)\s*-?([\d,]+(?:\.\d{1,2})?)\s*บาท/u)
    const credit = money?.[1] === 'เข้า'
    payload.source = 'scb_connect'
    payload.bank = 'SCB'
    payload.amount = amount(money?.[2]) || ''
    payload.direction = credit ? 'credit' : 'debit'
    payload.merchant = clean(block.match(credit ? /จากบัญชี\s+([^\n\r]+)/u : /เข้าบัญชี\s+([^\n\r]+)/u)?.[1])
    payload.account_last4 = block.match(credit ? /เข้าบัญชี[^\n\r]*X-(\d{4})/u : /จากบัญชี[^\n\r]*X-(\d{4})/u)?.[1] ?? null
  } else if (/LINE Pay Purchase/iu.test(block)) {
    payload.source = 'line_wallet'
    payload.amount = amount(block.match(/LINE Pay Purchase\s*(?:฿\s*|THB\s*)?([\d,]+(?:\.\d{1,2})?)/iu)?.[1]) || ''
    payload.merchant = clean(block.match(/Merchant:\s*([^\n\r]+)/iu)?.[1])
  }

  if (payload.source === 'unknown' || !payload.amount) invalid()
  payload.description = payload.merchant
  payload.dedupe_key = await sha256Hex(await canonicalDedupeMaterial(payload))
  return payload
}
