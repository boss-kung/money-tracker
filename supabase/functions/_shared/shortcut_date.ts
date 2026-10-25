import { ShortcutRequestError } from './shortcut_capture.ts'

const BANGKOK = 'Asia/Bangkok'
const MIN_CAPTURE_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_CAPTURE_FUTURE_MS = 10 * 60 * 1000
const MIN_GREGORIAN_YEAR = 2000
const MAX_GREGORIAN_YEAR = 2200

export type ShortcutParsedDate = {
  transactionDate: string | null
  transactionDateTime: string | null
}

function invalid(): never {
  throw new ShortcutRequestError(400, 'invalid_capture')
}

function dateParts(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) invalid()
  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (year < MIN_GREGORIAN_YEAR || year > MAX_GREGORIAN_YEAR) invalid()
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) invalid()
  return { year, month, day }
}

function bangkokIso(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const get = (type: string) => parts.find(part => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+07:00`
}

function parseInstant(value: unknown): Date {
  if (typeof value !== 'string' || !value.trim() || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value.trim())) invalid()
  const instant = new Date(value.trim())
  if (Number.isNaN(instant.getTime())) invalid()
  return instant
}

export function normalizeShortcutCapturedAt(value: unknown, serverNow: string): string {
  const now = parseInstant(serverNow)
  if (value === null || value === undefined || value === '') return bangkokIso(now)
  const raw = String(value).trim()
  const instant = parseInstant(raw)
  const age = instant.getTime() - now.getTime()
  if (age < -MIN_CAPTURE_AGE_MS || age > MAX_CAPTURE_FUTURE_MS) invalid()
  return raw.replace(/z$/i, 'Z').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
}

export function validateShortcutTransactionDate(value: unknown, allowNull = false): string | null {
  if ((value === null || value === undefined || value === '') && allowNull) return null
  if (typeof value !== 'string') invalid()
  const trimmed = value.trim()
  dateParts(trimmed)
  return trimmed
}

export function bangkokCalendarDate(value: string): string {
  const instant = parseInstant(value)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => parts.find(part => part.type === type)?.value || ''
  const result = `${get('year')}-${get('month')}-${get('day')}`
  dateParts(result)
  return result
}

function canonicalYear(yearText: string | undefined): number | null {
  if (!yearText) return null
  if (!/^\d{4}$/.test(yearText)) invalid()
  const numeric = Number(yearText)
  const year = numeric >= 2543 && numeric <= 2743 ? numeric - 543 : numeric
  if (year < MIN_GREGORIAN_YEAR || year > MAX_GREGORIAN_YEAR) invalid()
  return year
}

function calendarDayNumber(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / 86400000
}

function resolveYearlessDate(month: number, day: number, capturedAt: string): string {
  const capturedDate = bangkokCalendarDate(capturedAt)
  const captured = dateParts(capturedDate)
  const captureDay = calendarDayNumber(captured.year, captured.month, captured.day)
  const candidates = [captured.year - 1, captured.year, captured.year + 1]
    .map(year => {
      const candidate = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
      try {
        dateParts(candidate)
        const dayNumber = calendarDayNumber(year, month, day)
        return { candidate, distance: Math.abs(dayNumber - captureDay), delta: dayNumber - captureDay }
      } catch {
        return null
      }
    })
    .filter(Boolean) as Array<{ candidate: string; distance: number; delta: number }>
  const allowed = candidates.filter(item => item.delta <= 0 || item.delta <= 1)
  if (!allowed.length) invalid()
  allowed.sort((left, right) => left.distance - right.distance || left.delta - right.delta)
  return allowed[0].candidate
}

export function parseShortcutDateFromText(text: string, capturedAt: string): ShortcutParsedDate {
  const match = /(\d{2})\/(\d{2})(?:\/(\d{2,4}))?(?:\s+@?(\d{2}):(\d{2}))?/u.exec(text)
  if (!match) return { transactionDate: null, transactionDateTime: null }
  const [, dayText, monthText, yearText, hourText, minuteText] = match
  const day = Number(dayText)
  const month = Number(monthText)
  const year = canonicalYear(yearText)
  let transactionDate: string
  if (year === null) {
    transactionDate = resolveYearlessDate(month, day, capturedAt)
  } else {
    transactionDate = `${year.toString().padStart(4, '0')}-${monthText}-${dayText}`
    dateParts(transactionDate)
  }
  if (hourText === undefined) return { transactionDate, transactionDateTime: null }
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (hour > 23 || minute > 59) invalid()
  return {
    transactionDate,
    transactionDateTime: `${transactionDate}T${hourText}:${minuteText}:00+07:00`,
  }
}
