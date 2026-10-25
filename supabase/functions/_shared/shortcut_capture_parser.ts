import {
  canonicalDedupeMaterial,
  normalizeCaptureText,
  sha256Hex,
  ShortcutRequestError,
  type ValidatedCaptureV1,
} from './shortcut_capture.ts'
import {
  normalizeShortcutCapturedAt,
  parseShortcutDateFromText,
  type ShortcutParsedDate,
} from './shortcut_date.ts'

const CAPTURE_METHODS = new Set(['line_notification', 'whats_on_screen'])
const PARSER_VERSION = 'shortcut-server-1.0.0'
const MAX_CAPTURES = 10

type CaptureSource = 'uob_thai' | 'uob_english' | 'scb_connect' | 'line_wallet'
type UobLanguage = 'thai' | 'english'

type ParsedCandidate = {
  text: string
  relevantText: string
  source: CaptureSource
  language?: UobLanguage
  amount: string | null
  direction: 'debit' | 'credit'
  merchant: string | null
  accountLast4: string | null
  cardLast4: string | null
  transactionDate: string | null
  transactionDateTime: string | null
  dateInvalid: boolean
  availableCredit: string | null
  complete: boolean
}

export type RawCaptureFailure = {
  item: number
  code: 'unreadable_capture'
}

export type RawCaptureBatch = {
  found: number
  captures: Array<{ item: number; capture: ValidatedCaptureV1 }>
  failures: RawCaptureFailure[]
}

function invalid(code = 'invalid_capture'): never {
  throw new ShortcutRequestError(400, code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeForParsing(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

function clean(value: string | undefined): string | null {
  return value?.trim().replace(/[ \t]+/g, ' ').replace(/\s*(?:…|\.\.\.)\s*$/u, '') || null
}

function amount(value: string | undefined): string | null {
  if (!value) return null
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isFinite(parsed) && parsed > 0 ? Math.abs(parsed).toFixed(2) : null
}

function availableCredit(value: string | undefined): string | null {
  if (!value) return null
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(2) : null
}

function rawText(value: unknown): string {
  if (typeof value !== 'string') invalid()
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 32 * 1024) invalid()
  return trimmed
}

function anchorSource(line: string): CaptureSource | null {
  if (/^\s*มีการใช้บัตร\s+UOB-\d{4}\b/iu.test(line)) return 'uob_thai'
  if (/^\s*You have spent\b/iu.test(line)) return 'uob_english'
  if (/^\s*รายการเงิน(?:ออก|เข้า)(?:\s|$)/u.test(line)) return 'scb_connect'
  if (/^\s*LINE Pay Purchase\b/iu.test(line)) return 'line_wallet'
  return null
}

function candidateSegments(text: string): Array<{ source: CaptureSource; text: string }> {
  const lines = text.split('\n')
  const anchors: Array<{ line: number; source: CaptureSource }> = []
  lines.forEach((line, index) => {
    const source = anchorSource(line)
    if (source) anchors.push({ line: index, source })
  })
  if (!anchors.length) invalid()
  return anchors.map((anchor, index) => ({
    source: anchor.source,
    text: lines.slice(anchor.line, anchors[index + 1]?.line ?? lines.length).join('\n').trim(),
  }))
}

function trimCandidateText(source: CaptureSource, text: string): string {
  const patterns: Record<CaptureSource, RegExp> = {
    uob_thai: /^\s*มีการใช้บัตร\s+UOB-\d{4}[\s\S]*?วงเงินคงเหลือใช้ได้\s*[\d,]+(?:\.\d{1,2})?\s*THB/iu,
    uob_english: /^\s*You have spent[\s\S]*?Available credit:\s*THB\s*[\d,]+(?:\.\d{1,2})?/iu,
    scb_connect: /^[\s\S]*?รายการเงิน(?:ออก|เข้า)[\s\S]*?ยอดเงินที่ใช้ได้\s*[\d,]+(?:\.\d{1,2})?\s*บาท/u,
    line_wallet: /^\s*LINE Pay Purchase[\s\S]*?Balance:\s*(?:THB\s*)?[\d,]+(?:\.\d{1,2})?/iu,
  }
  return text.match(patterns[source])?.[0].trim() ?? text.trim()
}

function parseCandidate(
  source: CaptureSource,
  text: string,
  captureMethod: 'line_notification' | 'whats_on_screen',
  capturedAt: string,
): ParsedCandidate {
  text = trimCandidateText(source, text)
  let parsedDate: ShortcutParsedDate = { transactionDate: null, transactionDateTime: null }
  let dateInvalid = false
  try {
    parsedDate = parseShortcutDateFromText(text, capturedAt)
  } catch {
    dateInvalid = true
  }
  if (source === 'uob_thai' || source === 'uob_english') {
    const thai = source === 'uob_thai'
    const transactionText = thai ? text.split(/วงเงินคงเหลือใช้ได้/iu, 1)[0] : text
    const parsedAmount = amount(transactionText.match(thai
      ? /(?:จำนวน\s*)?([\d,]+(?:\.\d{1,2})?)\s*THB/u
      : /spent\s+THB\s*([\d,]+(?:\.\d{1,2})?)/iu)?.[1])
    const thaiMerchant = text.match(/ที่ร้าน\s*([^\n\r]+)/u)?.[1]
      ?? text.match(/UOB-\d{4}\s+(?:จำนวน\s*)?(.+?)\s+[\d,]+(?:\.\d{1,2})?\s*THB/iu)?.[1]
    const merchant = clean(thai
      ? thaiMerchant
      : text.match(/\sat\s+(.+?)(?:\s+on\s+\d{2}\/|[\n\r]|$)/iu)?.[1])
    const cardLast4 = text.match(thai ? /UOB-(\d{4})/u : /ending\s+(?:UOB-)?(\d{4})/iu)?.[1] ?? null
    const availableCreditWithSuffix = text.match(/วงเงินคงเหลือใช้ได้\s*([\d,]+(?:\.\d{1,2})?)\s*THB/u)?.[1]
      ?? text.match(/Available credit:\s*THB\s*([\d,]+(?:\.\d{1,2})?)/iu)?.[1]
      ?? null
    const availableCreditValue = text.match(/วงเงินคงเหลือใช้ได้\s*([\d,]+(?:\.\d{1,2})?)/u)?.[1]
      ?? text.match(/Available credit:\s*THB\s*([\d,]+(?:\.\d{1,2})?)/iu)?.[1]
      ?? null
    return {
      text,
      relevantText: text,
      source,
      language: thai ? 'thai' : 'english',
      amount: parsedAmount,
      direction: 'debit',
      merchant,
      accountLast4: null,
      cardLast4,
      transactionDate: parsedDate.transactionDate,
      transactionDateTime: parsedDate.transactionDateTime,
      dateInvalid,
      availableCredit: availableCredit(availableCreditValue ?? undefined),
      complete: !dateInvalid && Boolean(parsedAmount) && (captureMethod === 'line_notification' || Boolean(availableCreditWithSuffix)),
    }
  }

  if (source === 'scb_connect') {
    const money = text.match(/รายการเงิน(ออก|เข้า)\s*-?([\d,]+(?:\.\d{1,2})?)\s*บาท/u)
    const credit = money?.[1] === 'เข้า'
    const parsedAmount = amount(money?.[2])
    return {
      text,
      relevantText: text,
      source,
      amount: parsedAmount,
      direction: credit ? 'credit' : 'debit',
      merchant: clean(text.match(credit ? /จากบัญชี\s+([^\n\r]+)/u : /เข้าบัญชี\s+([^\n\r]+)/u)?.[1]),
      accountLast4: text.match(credit ? /เข้าบัญชี[^\n\r]*X-(\d{4})/u : /จากบัญชี[^\n\r]*X-(\d{4})/u)?.[1] ?? null,
      cardLast4: null,
      transactionDate: parsedDate.transactionDate,
      transactionDateTime: parsedDate.transactionDateTime,
      dateInvalid,
      availableCredit: amount(text.match(/ยอดเงินที่ใช้ได้\s*([\d,]+(?:\.\d{1,2})?)\s*บาท/u)?.[1]),
      complete: !dateInvalid && Boolean(parsedAmount) && (captureMethod === 'line_notification' || /ยอดเงินที่ใช้ได้\s*[\d,]+(?:\.\d{1,2})?\s*บาท/u.test(text)),
    }
  }

  const parsedAmount = amount(text.match(/LINE Pay Purchase\s*(?:฿\s*|THB\s*)?([\d,]+(?:\.\d{1,2})?)/iu)?.[1])
  return {
    text,
    relevantText: text,
    source,
    amount: parsedAmount,
    direction: 'debit',
    merchant: clean(text.match(/Merchant:\s*([^\n\r]+)/iu)?.[1]),
    accountLast4: null,
    cardLast4: null,
    transactionDate: parsedDate.transactionDate,
    transactionDateTime: parsedDate.transactionDateTime,
    dateInvalid,
    availableCredit: amount(text.match(/Balance:\s*(?:THB\s*)?([\d,]+(?:\.\d{1,2})?)/iu)?.[1]),
    complete: !dateInvalid && Boolean(parsedAmount) && (captureMethod === 'line_notification' || /Balance:\s*(?:THB\s*)?[\d,]+(?:\.\d{1,2})?/iu.test(text)),
  }
}

function canonicalOptional(value: string | null): string | null {
  return value ? normalizeCaptureText(value).toLocaleLowerCase('en-US') : null
}

function canPair(left: ParsedCandidate, right: ParsedCandidate): boolean {
  if (!((left.source === 'uob_thai' && right.source === 'uob_english')
    || (left.source === 'uob_english' && right.source === 'uob_thai'))) return false
  if (!left.amount || !right.amount || left.amount !== right.amount) return false
  if (!left.cardLast4 || !right.cardLast4 || left.cardLast4 !== right.cardLast4) return false
  if (left.dateInvalid || right.dateInvalid) return false
  for (const [leftValue, rightValue] of [
    [left.merchant, right.merchant],
    [left.availableCredit, right.availableCredit],
    [left.transactionDate, right.transactionDate],
    [left.transactionDateTime, right.transactionDateTime],
  ] as Array<[string | null, string | null]>) {
    if (leftValue && rightValue && canonicalOptional(leftValue) !== canonicalOptional(rightValue)) return false
  }
  return true
}

function mergePair(left: ParsedCandidate, right: ParsedCandidate): ParsedCandidate {
  const primary = right.complete ? right : left.complete ? left : right
  const other = primary === right ? left : right
  return {
    ...primary,
    text: `${left.text}\n${right.text}`,
    relevantText: primary.relevantText,
    merchant: primary.merchant ?? other.merchant,
    accountLast4: primary.accountLast4 ?? other.accountLast4,
    cardLast4: primary.cardLast4 ?? other.cardLast4,
    transactionDate: primary.transactionDate ?? other.transactionDate,
    transactionDateTime: primary.transactionDateTime ?? other.transactionDateTime,
    dateInvalid: primary.dateInvalid || other.dateInvalid,
    availableCredit: primary.availableCredit ?? other.availableCredit,
    complete: primary.complete || other.complete,
  }
}

function payloadFromCandidate(
  candidate: ParsedCandidate,
  capturedAt: string,
  captureMethod: 'line_notification' | 'whats_on_screen',
): Omit<ValidatedCaptureV1, 'dedupe_key'> {
  const source = candidate.source === 'uob_english' ? 'uob_thai' : candidate.source
  return {
    schema_version: 'money-tracker.capture.v1',
    parser_version: PARSER_VERSION,
    source,
    bank: source === 'scb_connect' ? 'SCB' : source === 'uob_thai' ? 'UOB' : null,
    amount: candidate.amount ?? '',
    currency: 'THB',
    direction: candidate.direction,
    merchant: candidate.merchant,
    description: candidate.merchant,
    account_last4: candidate.accountLast4,
    card_last4: candidate.cardLast4,
    transaction_date: candidate.transactionDate,
    transaction_datetime: candidate.transactionDateTime,
    captured_at: capturedAt,
    capture_method: captureMethod,
    raw_text: candidate.text,
    relevant_text: normalizeCaptureText(candidate.relevantText),
    parse_status: 'complete',
    dedupe_version: 1,
  }
}

async function finalizeCapture(
  candidate: ParsedCandidate,
  capturedAt: string,
  captureMethod: 'line_notification' | 'whats_on_screen',
): Promise<ValidatedCaptureV1> {
  const payload: ValidatedCaptureV1 = { ...payloadFromCandidate(candidate, capturedAt, captureMethod), dedupe_key: '' }
  payload.dedupe_key = await sha256Hex(await canonicalDedupeMaterial(payload))
  return payload
}

export async function parseRawShortcutCaptures(input: unknown, now = new Date().toISOString()): Promise<RawCaptureBatch> {
  if (!isRecord(input) || typeof input.capture_method !== 'string' || !CAPTURE_METHODS.has(input.capture_method)) invalid()
  const originalText = rawText(input.raw_text)
  const capturedAt = normalizeShortcutCapturedAt(input.captured_at, now)
  const captureMethod = input.capture_method as 'line_notification' | 'whats_on_screen'
  const segments = candidateSegments(normalizeForParsing(originalText))
  const candidates = segments.map(({ source, text }) => parseCandidate(source, text, captureMethod, capturedAt))

  const logical: ParsedCandidate[] = []
  for (let index = 0; index < candidates.length; index += 1) {
    const current = candidates[index]
    const next = candidates[index + 1]
    if (next && canPair(current, next)) {
      logical.push(mergePair(current, next))
      index += 1
    } else {
      logical.push(current)
    }
  }
  if (logical.length > MAX_CAPTURES) invalid('too_many_captures')

  const captures: RawCaptureBatch['captures'] = []
  const failures: RawCaptureFailure[] = []
  for (const [index, candidate] of logical.entries()) {
    const item = index + 1
    if (!candidate.complete || !candidate.amount) {
      failures.push({ item, code: 'unreadable_capture' })
      continue
    }
    captures.push({ item, capture: await finalizeCapture(candidate, capturedAt, captureMethod) })
  }
  if (!captures.length && logical.length === 1) invalid()
  return { found: logical.length, captures, failures }
}
