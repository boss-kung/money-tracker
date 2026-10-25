import {
  bangkokCalendarDate,
  normalizeShortcutCapturedAt,
  validateShortcutTransactionDate,
} from './shortcut_date.ts'

const SOURCES = new Set(['uob_thai', 'scb_connect', 'line_wallet'])
const CAPTURE_METHODS = new Set(['line_notification', 'whats_on_screen'])
const DIRECTIONS = new Set(['debit', 'credit'])
const CURRENCY = 'THB'
const SCHEMA_VERSION = 'money-tracker.capture.v1'
const MAX_TEXT_LENGTH = 32 * 1024

export type CaptureEnvelopeV1 = {
  schema_version: string
  parser_version: string
  source: string
  bank: string | null
  amount: string
  currency: string
  direction: 'debit' | 'credit'
  merchant: string | null
  description: string | null
  account_last4: string | null
  card_last4: string | null
  transaction_date: string | null
  transaction_reference: string | null
  transaction_datetime: string | null
  captured_at: string
  capture_method: 'line_notification' | 'whats_on_screen'
  raw_text: string
  relevant_text: string
  parse_status: 'complete'
  dedupe_version: number
  dedupe_key: string
}

export type ValidatedCaptureV1 = CaptureEnvelopeV1

export type ValidatedCustomProfileCaptureV1 = CaptureEnvelopeV1 & {
  source: 'custom_profile'
  profile_id: string
  profile_version: number
  profile_name: string
}

export type ValidatedNeedsReviewCaptureV1 = {
  schema_version: string
  parser_version: string
  source: 'custom_profile'
  profile_id: string
  profile_version: number
  profile_name: string
  captured_at: string
  capture_method: 'line_notification'
  raw_text: string
  relevant_text: string
  parse_status: 'needs_review'
  reason: 'notification_content_unavailable' | 'no_variant_match' | 'ambiguous_variant' | 'incomplete_fields' | 'unsupported_currency'
  dedupe_version: 2
  dedupe_key: string
}

export type CaptureDedupeIdentity = {
  version: 1 | 2
  dedupeKey: string
  baseKey: string
  legacyKey: string
  strong: boolean
  capturedAt: string
}

export class ShortcutRequestError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message = code) {
    super(message)
    this.name = 'ShortcutRequestError'
    this.status = status
    this.code = code
  }
}

function invalid(code = 'invalid_capture'): ShortcutRequestError {
  return new ShortcutRequestError(400, code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function normalizeCaptureText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]*\n+/g, '\n')
    .trim()
}

function cleanOptional(value: unknown, max = 512): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw invalid()
  const cleaned = normalizeCaptureText(value)
  if (!cleaned || cleaned.length > max) throw invalid()
  return cleaned
}

function canonicalAmount(value: unknown): string {
  const raw = typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : typeof value === 'string' ? value.trim() : ''
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw invalid()
  const [whole, fraction = ''] = raw.split('.')
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '')
  const amount = `${normalizedWhole}.${fraction.padEnd(2, '0')}`
  if (Number(amount) <= 0 || !Number.isFinite(Number(amount))) throw invalid()
  return amount
}

function isoDate(value: unknown, allowNull: true): string | null
function isoDate(value: unknown, allowNull?: false): string
function isoDate(value: unknown, allowNull = false): string | null {
  if ((value === null || value === undefined || value === '') && allowNull) return null
  if (typeof value !== 'string') throw invalid()
  const trimmed = value.trim()
  if (Number.isNaN(Date.parse(trimmed)) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) throw invalid()
  // Keep the caller's local calendar date/offset. The dedupe key is generated
  // on-device from that representation, so converting to UTC here could move a
  // late-night Thai transaction to the previous UTC date and break retries.
  return trimmed.replace(/z$/i, 'Z').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
}

function last4(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) throw invalid()
  return value
}

export async function canonicalDedupeMaterial(capture: Partial<CaptureEnvelopeV1> & Record<string, unknown>): Promise<string> {
  const amount = canonicalAmount(capture.amount)
  const identifier = String(capture.account_last4 || capture.card_last4 || '')
  const date = String(capture.transaction_datetime || capture.captured_at || '').slice(0, 10)
  const description = normalizeCaptureText(capture.description || capture.merchant || '').toLocaleLowerCase('en-US')
  const relevant = await sha256Hex(normalizeCaptureText(capture.relevant_text))
  return [
    `v${capture.dedupe_version ?? 1}`,
    String(capture.source || ''),
    String(capture.direction || ''),
    amount,
    CURRENCY,
    identifier,
    date,
    description,
    relevant,
  ].join('|')
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function captureCalendarDate(capture: Partial<CaptureEnvelopeV1> & Record<string, unknown>): string {
  const transactionDate = validateShortcutTransactionDate(capture.transaction_date, true)
  if (transactionDate) return transactionDate
  const transactionDateTime = isoDate(capture.transaction_datetime, true)
  if (transactionDateTime) return bangkokCalendarDate(transactionDateTime)
  if (cleanOptional(capture.transaction_reference, 128)) return ''
  return bangkokCalendarDate(String(capture.captured_at || ''))
}

function canonicalInstant(value: string): string {
  return new Date(value).toISOString()
}

export async function buildCaptureDedupeIdentity(
  capture: Partial<CaptureEnvelopeV1> & Record<string, unknown>,
): Promise<CaptureDedupeIdentity> {
  const version = Number(capture.dedupe_version ?? 1)
  if (version !== 1 && version !== 2) throw invalid()
  const capturedAt = isoDate(capture.captured_at)
  const amount = canonicalAmount(capture.amount)
  const identifier = String(capture.account_last4 || capture.card_last4 || '')
  const date = captureCalendarDate({ ...capture, captured_at: capturedAt })
  const description = normalizeCaptureText(capture.description || capture.merchant || '').toLocaleLowerCase('en-US')
  const relevant = await sha256Hex(normalizeCaptureText(capture.relevant_text))
  const baseMaterial = [
    'v2-base',
    String(capture.source || ''),
    String(capture.profile_id || ''),
    String(capture.direction || ''),
    amount,
    CURRENCY,
    identifier,
    date,
    description,
    relevant,
  ].join('|')
  const baseKey = await sha256Hex(baseMaterial)
  const transactionDateTime = isoDate(capture.transaction_datetime, true)
  const transactionReference = cleanOptional(capture.transaction_reference, 128)
  const strong = Boolean(transactionDateTime || transactionReference)
  const strongMaterial = [
    'v2-strong',
    baseKey,
    transactionDateTime ? canonicalInstant(transactionDateTime) : '',
    transactionReference || '',
  ].join('|')
  const bucket = Math.floor(Date.parse(capturedAt) / (5 * 60 * 1000))
  const dedupeMaterial = strong ? strongMaterial : ['v2-timeless', baseKey, bucket].join('|')
  const dedupeKey = await sha256Hex(dedupeMaterial)
  const legacyKey = await sha256Hex(await canonicalDedupeMaterial({ ...capture, dedupe_version: 1 }))
  if (version === 1) return { version, dedupeKey: legacyKey, baseKey, legacyKey, strong, capturedAt }
  return { version: version as 1 | 2, dedupeKey, baseKey, legacyKey, strong, capturedAt }
}

export async function buildNeedsReviewDedupeIdentity(capture: Pick<ValidatedNeedsReviewCaptureV1, 'source' | 'profile_id' | 'raw_text' | 'captured_at'>): Promise<CaptureDedupeIdentity> {
  const capturedAt = isoDate(capture.captured_at)
  const rawHash = await sha256Hex(normalizeCaptureText(capture.raw_text))
  const baseKey = await sha256Hex(['v2-custom-review', capture.source, capture.profile_id, rawHash].join('|'))
  const bucket = Math.floor(Date.parse(capturedAt) / (5 * 60 * 1000))
  const dedupeKey = await sha256Hex(['v2-custom-review-window', baseKey, bucket].join('|'))
  return { version: 2, dedupeKey, baseKey, legacyKey: dedupeKey, strong: false, capturedAt }
}

export async function validateNeedsReviewCapture(input: unknown, serverNow = new Date()): Promise<ValidatedNeedsReviewCaptureV1> {
  if (!isRecord(input) || input.schema_version !== SCHEMA_VERSION || input.source !== 'custom_profile' || input.parse_status !== 'needs_review' || input.capture_method !== 'line_notification') throw invalid()
  const reason = input.reason
  if (!['notification_content_unavailable', 'no_variant_match', 'ambiguous_variant', 'incomplete_fields', 'unsupported_currency'].includes(String(reason))) throw invalid()
  const profileId = typeof input.profile_id === 'string' && /^[0-9a-f-]{36}$/i.test(input.profile_id) ? input.profile_id : ''
  const profileVersion = Number(input.profile_version)
  const profileName = cleanOptional(input.profile_name, 64)
  const rawText = normalizeCaptureText(input.raw_text)
  const relevantText = normalizeCaptureText(input.relevant_text)
  if (!profileId || !Number.isInteger(profileVersion) || profileVersion < 1 || !profileName || rawText.length > MAX_TEXT_LENGTH || relevantText.length > MAX_TEXT_LENGTH) throw invalid()
  const capturedAt = normalizeShortcutCapturedAt(input.captured_at, serverNow.toISOString())
  const dedupeKey = typeof input.dedupe_key === 'string' ? input.dedupe_key : ''
  if (!/^[0-9a-f]{64}$/.test(dedupeKey)) throw invalid('invalid_dedupe_key')
  const normalized: ValidatedNeedsReviewCaptureV1 = { schema_version: SCHEMA_VERSION, parser_version: String(input.parser_version || '').trim().slice(0, 80), source: 'custom_profile', profile_id: profileId, profile_version: profileVersion, profile_name: profileName, captured_at: capturedAt, capture_method: 'line_notification', raw_text: rawText, relevant_text: relevantText, parse_status: 'needs_review', reason: reason as ValidatedNeedsReviewCaptureV1['reason'], dedupe_version: 2, dedupe_key: dedupeKey }
  const expected = await buildNeedsReviewDedupeIdentity(normalized)
  if (expected.dedupeKey !== dedupeKey) throw invalid('invalid_dedupe_key')
  return normalized
}

export async function validateCaptureV1(input: unknown, serverNow = new Date()): Promise<ValidatedCaptureV1> {
  if (!isRecord(input)) throw invalid()
  if (input.schema_version !== SCHEMA_VERSION || typeof input.parser_version !== 'string' || !input.parser_version.trim()) throw invalid()
  if (!SOURCES.has(String(input.source)) || !CAPTURE_METHODS.has(String(input.capture_method)) || !DIRECTIONS.has(String(input.direction))) throw invalid()
  const dedupeVersion = Number(input.dedupe_version)
  if (input.currency !== CURRENCY || input.parse_status !== 'complete' || ![1, 2].includes(dedupeVersion)) throw invalid()

  const rawText = normalizeCaptureText(input.raw_text)
  const relevantText = normalizeCaptureText(input.relevant_text)
  if (!rawText || !relevantText || rawText.length > MAX_TEXT_LENGTH || relevantText.length > MAX_TEXT_LENGTH) throw invalid()
  const capturedAt = normalizeShortcutCapturedAt(input.captured_at, serverNow.toISOString())
  const transactionDate = validateShortcutTransactionDate(input.transaction_date, true)
  const transactionReference = cleanOptional(input.transaction_reference, 128)
  const transactionDateTime = isoDate(input.transaction_datetime, true)
  const amount = canonicalAmount(input.amount)
  const merchant = cleanOptional(input.merchant)
  const description = cleanOptional(input.description) || merchant
  const accountLast4 = last4(input.account_last4)
  const cardLast4 = last4(input.card_last4)
  const dedupeKey = typeof input.dedupe_key === 'string' ? input.dedupe_key : ''
  if (!/^[0-9a-f]{64}$/.test(dedupeKey)) throw invalid('invalid_dedupe_key')

  const normalized: ValidatedCaptureV1 = {
    schema_version: SCHEMA_VERSION,
    parser_version: input.parser_version.trim().slice(0, 80),
    source: String(input.source),
    bank: String(input.source) === 'scb_connect' ? 'SCB' : String(input.source) === 'uob_thai' ? 'UOB' : null,
    amount,
    currency: CURRENCY,
    direction: String(input.direction) as 'debit' | 'credit',
    merchant,
    description,
    account_last4: accountLast4,
    card_last4: cardLast4,
    transaction_date: transactionDate,
    transaction_reference: transactionReference,
    transaction_datetime: transactionDateTime,
    captured_at: capturedAt,
    capture_method: String(input.capture_method) as 'line_notification' | 'whats_on_screen',
    raw_text: rawText,
    relevant_text: relevantText,
    parse_status: 'complete',
    dedupe_version: dedupeVersion,
    dedupe_key: dedupeKey,
  }
  const expectedKey = dedupeVersion === 1
    ? await sha256Hex(await canonicalDedupeMaterial(normalized))
    : (await buildCaptureDedupeIdentity(normalized)).dedupeKey
  if (expectedKey !== dedupeKey) throw invalid('invalid_dedupe_key')
  return normalized
}

export async function readBoundedJson(req: Request, maxBytes = MAX_TEXT_LENGTH): Promise<unknown> {
  if (!req.body) throw new ShortcutRequestError(400, 'invalid_json')
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
      size += chunk.byteLength
      if (size > maxBytes) throw new ShortcutRequestError(413, 'payload_too_large')
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new ShortcutRequestError(400, 'invalid_json') }
  try { return JSON.parse(text) } catch { throw new ShortcutRequestError(400, 'invalid_json') }
}
