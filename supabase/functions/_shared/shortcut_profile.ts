import { validateShortcutTransactionDate } from './shortcut_date.ts'

const MAX_RULE_BYTES = 16 * 1024
const MAX_VARIANTS = 5
const MAX_ANCHOR_LENGTH = 256
const FIELD_LIMITS: Record<string, number> = {
  thb_amount: 64,
  date: 32,
  time: 16,
  text: 256,
  last4: 4,
  reference: 128,
}

export type ProfileValueType = 'thb_amount' | 'date' | 'time' | 'text' | 'last4' | 'reference'

export type BoundedFieldExtractor = {
  before?: string
  after?: string
  occurrence: 1 | 2 | 3
  valueType: ProfileValueType
  maxLength: number
}

export type ShortcutProfileVariant = {
  id: string
  direction: 'debit' | 'credit'
  mustContain: string[]
  mustNotContain: string[]
  amount: BoundedFieldExtractor
  date?: BoundedFieldExtractor
  time?: BoundedFieldExtractor
  merchant?: BoundedFieldExtractor
  accountLast4?: BoundedFieldExtractor
  cardLast4?: BoundedFieldExtractor
  transactionReference?: BoundedFieldExtractor
}

export type ShortcutProfileRule = { format_version: 1; variants: ShortcutProfileVariant[] }

export type ProfileMatchResult =
  | { status: 'ignored' }
  | { status: 'needs_review'; reason: 'notification_content_unavailable' | 'no_variant_match' | 'ambiguous_variant' | 'incomplete_fields' | 'unsupported_currency' }
  | { status: 'complete'; value: { direction: 'debit' | 'credit'; amount: string; transactionDate: string | null; transactionDateTime: string | null; merchant: string | null; accountLast4: string | null; cardLast4: string | null; transactionReference: string | null; variantId: string } }

type CompleteProfileValue = Extract<ProfileMatchResult, { status: 'complete' }>['value']

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }

export function normalizeProfileText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
}

function invalidProfile(): never { throw new Error('invalid_profile') }

function literal(value: unknown, allowEmpty = false): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') invalidProfile()
  const result = normalizeProfileText(value)
  if (!allowEmpty && !result) invalidProfile()
  if (result.length > MAX_ANCHOR_LENGTH) invalidProfile()
  return result
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalidProfile()
}

function extractor(value: unknown): BoundedFieldExtractor {
  if (!isRecord(value)) invalidProfile()
  exactKeys(value, ['before', 'after', 'occurrence', 'valueType', 'maxLength'])
  const before = literal(value.before)
  const after = literal(value.after)
  const occurrence = value.occurrence
  const valueType = value.valueType
  const maxLength = value.maxLength
  if (before === undefined && after === undefined) invalidProfile()
  if (before === undefined && occurrence !== 1) invalidProfile()
  if (occurrence !== 1 && occurrence !== 2 && occurrence !== 3) invalidProfile()
  if (typeof valueType !== 'string' || !(valueType in FIELD_LIMITS)) invalidProfile()
  if (!Number.isInteger(maxLength) || Number(maxLength) < 1 || Number(maxLength) > FIELD_LIMITS[valueType]) invalidProfile()
  return Object.freeze({ ...(before ? { before } : {}), ...(after ? { after } : {}), occurrence: occurrence as 1 | 2 | 3, valueType: valueType as ProfileValueType, maxLength: Number(maxLength) })
}

function literals(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) invalidProfile()
  const result = value.map(item => literal(item)).filter((item): item is string => Boolean(item))
  if (result.length !== value.length) invalidProfile()
  return result
}

function variant(value: unknown): ShortcutProfileVariant {
  if (!isRecord(value)) invalidProfile()
  exactKeys(value, ['id', 'direction', 'mustContain', 'mustNotContain', 'amount', 'date', 'time', 'merchant', 'accountLast4', 'cardLast4', 'transactionReference'])
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id)) invalidProfile()
  if (value.direction !== 'debit' && value.direction !== 'credit') invalidProfile()
  const mustContain = literals(value.mustContain)
  const mustNotContain = literals(value.mustNotContain)
  const amount = extractor(value.amount)
  const fields: Record<string, unknown> = { date: value.date, time: value.time, merchant: value.merchant, accountLast4: value.accountLast4, cardLast4: value.cardLast4, transactionReference: value.transactionReference }
  const result: Record<string, unknown> = { id: value.id, direction: value.direction, mustContain, mustNotContain, amount }
  for (const [key, field] of Object.entries(fields)) if (field !== undefined) result[key] = extractor(field)
  return result as ShortcutProfileVariant
}

function canonicalSize(rule: ShortcutProfileRule): number { return new TextEncoder().encode(JSON.stringify(rule)).byteLength }

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

export function validateShortcutProfileRule(input: unknown): ShortcutProfileRule {
  if (!isRecord(input)) invalidProfile()
  exactKeys(input, ['format_version', 'variants'])
  if (input.format_version !== 1 || !Array.isArray(input.variants) || input.variants.length < 1 || input.variants.length > MAX_VARIANTS) invalidProfile()
  const variants = input.variants.map(variant)
  const ids = new Set(variants.map(item => item.id))
  if (ids.size !== variants.length || variants.some(item => item.mustContain.length + item.mustNotContain.length === 0 && !item.amount.before && !item.amount.after)) invalidProfile()
  const rule = { format_version: 1 as const, variants }
  if (canonicalSize(rule) > MAX_RULE_BYTES) invalidProfile()
  return deepFreeze(rule)
}

function occurrenceIndex(text: string, needle: string, occurrence: number): number {
  let from = 0
  let found = -1
  for (let index = 0; index < occurrence; index++) {
    found = text.indexOf(needle, from)
    if (found < 0) return -1
    from = found + needle.length
  }
  return found
}

function extractSpan(text: string, field: BoundedFieldExtractor): string | null {
  const before = field.before
  const after = field.after
  let start = 0
  if (before) {
    const position = occurrenceIndex(text, before, field.occurrence)
    if (position < 0) return null
    start = position + before.length
  }
  let end = Math.min(text.length, start + field.maxLength)
  if (after) {
    const position = text.indexOf(after, start)
    if (position < 0 || position < start) return null
    end = position
  }
  const result = text.slice(start, end).trim()
  return result ? result : null
}

function amount(value: string): { value: string; unsupported: boolean } | null {
  if (/(?:USD|EUR|GBP|JPY|CNY|ดอลลาร์|ยูโร)/iu.test(value) && !/(?:THB|บาท|฿)/iu.test(value)) return { value: '', unsupported: true }
  const matches = value.match(/(?:THB|บาท|฿)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/giu) || []
  if (matches.length !== 1) return null
  const number = matches[0].match(/[0-9][0-9,]*(?:\.\d{1,2})?/)?.[0]
  if (!number) return null
  const raw = number.replace(/,/g, '')
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  const [whole, fraction = ''] = raw.split('.')
  return { value: `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`, unsupported: false }
}

function typed(value: string, field: BoundedFieldExtractor): { value: string | null; unsupported: boolean } {
  if (field.valueType === 'thb_amount') return amount(value) || { value: null, unsupported: false }
  if (field.valueType === 'date') {
    const match = value.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})|([0-3]?\d)[/-]([0-1]?\d)[/-](\d{4})/)
    if (!match) return { value: null, unsupported: false }
    const normalized = match[1] ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : `${match[6]}-${match[5].padStart(2, '0')}-${match[4].padStart(2, '0')}`
    try { return { value: validateShortcutTransactionDate(normalized), unsupported: false } } catch { return { value: null, unsupported: false } }
  }
  if (field.valueType === 'time') {
    const match = value.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/)
    return match ? { value: `${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}`, unsupported: false } : { value: null, unsupported: false }
  }
  if (field.valueType === 'last4') return /^\d{4}$/.test(value) ? { value, unsupported: false } : { value: null, unsupported: false }
  const result = normalizeProfileText(value)
  return result && result.length <= field.maxLength ? { value: result, unsupported: false } : { value: null, unsupported: false }
}

function matchVariant(variant: ShortcutProfileVariant, text: string, _capturedAt: string): { complete: boolean; unsupported: boolean; value?: CompleteProfileValue } {
  if (variant.mustContain.some(anchor => !text.includes(anchor))) return { complete: false, unsupported: false }
  if (variant.mustNotContain.some(anchor => text.includes(anchor))) return { complete: false, unsupported: false }
  if (/(?:usd|eur|gbp|jpy|cny|ดอลลาร์|ยูโร)/iu.test(text) && !/(?:thb|บาท|฿)/iu.test(text)) return { complete: false, unsupported: true }
  const extracted = (field: BoundedFieldExtractor | undefined) => field ? typed(extractSpan(text, field) || '', field) : { value: null, unsupported: false }
  const parsedAmount = extracted(variant.amount)
  if (parsedAmount.unsupported) return { complete: false, unsupported: true }
  if (!parsedAmount.value) return { complete: false, unsupported: false }
  const date = extracted(variant.date)
  const time = extracted(variant.time)
  const merchant = extracted(variant.merchant)
  const account = extracted(variant.accountLast4)
  const card = extracted(variant.cardLast4)
  const reference = extracted(variant.transactionReference)
  const optional = [date, time, merchant, account, card, reference]
  if (optional.some(item => item.unsupported)) return { complete: false, unsupported: true }
  const dateValue = date.value
  const timeValue = time.value
  const transactionDateTime = dateValue && timeValue ? `${dateValue}T${timeValue}+07:00` : null
  if (variant.date && !dateValue || variant.time && !timeValue || variant.merchant && !merchant.value || variant.accountLast4 && !account.value || variant.cardLast4 && !card.value || variant.transactionReference && !reference.value) return { complete: false, unsupported: false }
  return { complete: true, unsupported: false, value: { direction: variant.direction, amount: parsedAmount.value, transactionDate: dateValue, transactionDateTime, merchant: merchant.value, accountLast4: account.value, cardLast4: card.value, transactionReference: reference.value, variantId: variant.id } }
}

export function matchShortcutProfile(rule: ShortcutProfileRule, text: string, capturedAt: string): ProfileMatchResult {
  const normalized = normalizeProfileText(text)
  if (!normalized) return { status: 'needs_review', reason: 'notification_content_unavailable' }
  const complete: Array<NonNullable<ReturnType<typeof matchVariant>['value']>> = []
  let sawUnsupported = false
  let sawCandidate = false
  for (const variant of rule.variants) {
    if (variant.mustNotContain.some(anchor => normalized.includes(anchor))) return { status: 'ignored' }
    const result = matchVariant(variant, normalized, capturedAt)
    if (variant.mustContain.every(anchor => normalized.includes(anchor))) sawCandidate = true
    if (result.unsupported) sawUnsupported = true
    if (result.complete && result.value) complete.push(result.value)
  }
  if (complete.length > 1) return { status: 'needs_review', reason: 'ambiguous_variant' }
  if (complete.length === 1) return { status: 'complete', value: complete[0] }
  if (sawUnsupported) return { status: 'needs_review', reason: 'unsupported_currency' }
  return { status: 'needs_review', reason: sawCandidate ? 'incomplete_fields' : 'no_variant_match' }
}

export function parseShortcutProfileMarker(rawText: string): { shortCode: string; notificationText: string } | null {
  if (typeof rawText !== 'string') return null
  const lines = rawText.replace(/\r\n?/g, '\n').split('\n')
  const first = lines.findIndex(line => line.trim() !== '')
  if (first < 0) return null
  const match = /^MT-PROFILE:([A-HJ-NP-Z2-9]{6})$/.exec(lines[first].trim())
  if (!match) return null
  lines.splice(first, 1)
  return { shortCode: match[1], notificationText: lines.join('\n').trim() }
}
