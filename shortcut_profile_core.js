/* Local-only compiler and matcher for user-defined notification profiles. */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.MTShortcutProfileCore = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'
  const LIMITS = { thb_amount: 64, date: 32, time: 16, text: 256, last4: 4, reference: 128 }
  const MAX_SAMPLE_LENGTH = 32768
  function normalizeProfileText(value) { return String(value ?? '').normalize('NFKC').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US') }
  function detectProfileCandidates(text) {
    const normalized = normalizeProfileText(text); const result = []; let id = 0
    const add = (type, match, value, start, end) => result.push({ id: `candidate-${id++}`, type, value, start, end })
    for (const match of normalized.matchAll(/[0-9][0-9,]*(?:\.\d{1,2})?/gu)) add('thb_amount', match[0], match[0], match.index, match.index + match[0].length)
    for (const match of normalized.matchAll(/\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\b/gu)) add('date', match[0], match[0], match.index, match.index + match[0].length)
    for (const match of normalized.matchAll(/\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/gu)) add('time', match[0], match[0], match.index, match.index + match[0].length)
    for (const match of normalized.matchAll(/\b\d{4}\b/gu)) add('last4', match[0], match[0], match.index, match.index + match[0].length)
    normalized.split(' ').forEach((value, index, words) => { if (value && !/^\d/.test(value) && value.length <= LIMITS.text) { const start = words.slice(0, index).join(' ').length + (index ? 1 : 0); add('text', value, value, start, start + value.length) } })
    return result
  }
  function detectProfileAmountCandidates(text) {
    const normalized = normalizeProfileText(text)
    const candidates = detectProfileCandidates(text).filter(candidate => candidate.type === 'thb_amount')
    const dateTimeSpans = detectProfileCandidates(text).filter(candidate => candidate.type === 'date' || candidate.type === 'time')
    return candidates.map(candidate => {
      const before = normalized.slice(Math.max(0, candidate.start - 8), candidate.start)
      const after = normalized.slice(candidate.end, Math.min(normalized.length, candidate.end + 8))
      const currencyConfirmed = /(?:thb|บาท|฿)\s*$/iu.test(before) || /^(?:\s*)(?:thb|บาท|฿)(?:\s|$)/iu.test(after)
      const overlapsDateOrTime = dateTimeSpans.some(span => candidate.start < span.end && candidate.end > span.start)
      return { ...candidate, currencyConfirmed, overlapsDateOrTime }
    })
  }
  function validateProfileDraft(draft = {}) {
    const errors = {}
    const samples = Array.isArray(draft.samples) ? draft.samples.map(value => String(value ?? '')) : []
    const amountCandidates = samples.slice(0, 2).map(detectProfileAmountCandidates)
    if (!String(draft.appLabel || '').trim()) errors.appLabel = 'ระบุชื่อแอป'
    if (samples.length !== 2) errors.samples = 'ต้องมีตัวอย่างแจ้งเตือน 2 รายการ'
    samples.slice(0, 2).forEach((sample, index) => {
      if (!sample.trim()) errors[`sample_${index}`] = 'วางตัวอย่างแจ้งเตือนก่อนดำเนินการต่อ'
      else if (sample.length > MAX_SAMPLE_LENGTH) errors[`sample_${index}`] = 'ตัวอย่างยาวเกิน 32,768 ตัวอักษร'
    })
    if (samples.length === 2 && samples[0].trim() && samples[0].trim() === samples[1].trim()) errors.samples = 'ตัวอย่างแจ้งเตือนต้องไม่เหมือนกัน'
    if (draft.direction !== 'debit' && draft.direction !== 'credit') errors.direction = 'เลือกทิศทางรายการ'
    const mustContain = Array.isArray(draft.mustContain) ? draft.mustContain.map(normalizeProfileText).filter(Boolean) : []
    if (!mustContain.length) errors.mustContain = 'ระบุคำที่ต้องมีอย่างน้อย 1 คำ'
    else if (samples.length === 2 && samples.every(sample => sample.trim()) && mustContain.some(anchor => !samples.every(sample => normalizeProfileText(sample).includes(anchor)))) errors.mustContain = 'คำที่ต้องมีต้องพบในตัวอย่างทั้งสองรายการ'
    const selections = Array.isArray(draft.amountSelections) ? draft.amountSelections : []
    amountCandidates.forEach((candidates, index) => {
      const selectedId = selections[index]
      const selected = candidates.find(candidate => candidate.id === selectedId)
      if (!selected) errors[`amount_${index}`] = 'เลือกยอดเงินจากตัวอย่าง'
      else if (selected.overlapsDateOrTime) errors[`amount_${index}`] = 'เลือกยอดเงินที่ไม่ใช่วันที่หรือเวลา'
    })
    return { valid: Object.keys(errors).length === 0, errors, amountCandidates }
  }
  function candidateFor(selection, candidates) {
    if (selection && typeof selection === 'object') {
      if (selection.id) return candidates.find(candidate => candidate.id === selection.id)
      if (Number.isInteger(selection.start) && Number.isInteger(selection.end)) return candidates.find(candidate => candidate.start === selection.start && candidate.end === selection.end)
    }
    if (typeof selection === 'string') return candidates.find(candidate => candidate.id === selection)
    if (Number.isInteger(selection)) return candidates[selection]
    return null
  }
  function commonSuffix(values) { let result = String(values[0] || ''); for (const value of values.slice(1)) { let index = 0; while (index < result.length && index < value.length && result[result.length - 1 - index] === value[value.length - 1 - index]) index++; result = result.slice(result.length - index) } return result.trim() }
  function commonPrefix(values) { let result = String(values[0] || ''); for (const value of values.slice(1)) { let index = 0; while (index < result.length && index < value.length && result[index] === value[index]) index++; result = result.slice(0, index) } return result.trim() }
  function deriveExtractor(samples, selections, field, valueType) {
    const selected = samples.map((sample, index) => {
      const candidates = detectProfileCandidates(sample); const item = candidateFor(selections?.[index]?.[field], candidates)
      if (!item || item.type !== valueType && !(field === 'merchant' && item.type === 'text') && !(field === 'transactionReference' && item.type === 'text')) throw new Error(`invalid_${field}`)
      const normalized = normalizeProfileText(sample); return { normalized, item }
    })
    const before = commonSuffix(selected.map(({ normalized, item }) => normalized.slice(Math.max(0, item.start - 32), item.start)))
    const after = commonPrefix(selected.map(({ normalized, item }) => normalized.slice(item.end, Math.min(normalized.length, item.end + 32))))
    if (!before && !after) throw new Error(`ambiguous_${field}`)
    return { ...(before ? { before } : {}), ...(after ? { after } : {}), occurrence: 1, valueType, maxLength: LIMITS[valueType] }
  }
  function compileProfileVariant(input) {
    if (!input || !Array.isArray(input.samples) || input.samples.length !== 2) throw new Error('two_samples_required')
    const direction = input.direction === 'credit' ? 'credit' : input.direction === 'debit' ? 'debit' : (() => { throw new Error('direction_required') })()
    const selections = input.selections || []
    const variant = { id: String(input.id || 'variant-1'), direction, mustContain: (input.mustContain || []).map(normalizeProfileText).filter(Boolean), mustNotContain: (input.mustNotContain || []).map(normalizeProfileText).filter(Boolean), amount: input.extractors?.amount || deriveExtractor(input.samples, selections, 'amount', 'thb_amount') }
    for (const [field, type] of [['date', 'date'], ['time', 'time'], ['merchant', 'text'], ['accountLast4', 'last4'], ['cardLast4', 'last4'], ['transactionReference', 'reference']]) {
      if (selections.some(selection => selection?.[field] !== undefined)) variant[field] = input.extractors?.[field] || deriveExtractor(input.samples, selections, field, type)
    }
    return variant
  }
  function compileProfileVariantRule(input) { return { format_version: 1, variants: [compileProfileVariant(input)] } }
  function matchProfileRule(rule, text, capturedAt) {
    const normalized = normalizeProfileText(text); if (!normalized) return { status: 'needs_review', reason: 'notification_content_unavailable' }
    if ((rule.variants || []).some(variant => (variant.mustNotContain || []).some(anchor => normalized.includes(normalizeProfileText(anchor))))) return { status: 'ignored' }
    const complete = []
    for (const variant of rule.variants || []) {
      if ((variant.mustContain || []).some(anchor => !normalized.includes(normalizeProfileText(anchor)))) continue
      const extract = field => { if (!field) return null; const before = field.before ? normalizeProfileText(field.before) : ''; const after = field.after ? normalizeProfileText(field.after) : ''; let start = before ? normalized.indexOf(before) + before.length : 0; if (before && start === before.length - 1) return null; const end = after ? normalized.indexOf(after, start) : Math.min(normalized.length, start + Number(field.maxLength || 64)); const raw = normalized.slice(start, end < 0 ? start : end).trim(); if (!raw || raw.length > field.maxLength) return null; return raw }
      const raw = extract(variant.amount); const number = raw && raw.match(/[0-9][0-9,]*(?:\.\d{1,2})?/); if (!number) continue
      const dateRaw = extract(variant.date); const dateMatch = dateRaw && dateRaw.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}` : null
      const timeRaw = extract(variant.time); const timeMatch = timeRaw && timeRaw.match(/([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?/); const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}:${timeMatch[3] || '00'}` : null
      if (variant.date && !date || variant.time && !time) continue
      complete.push({ direction: variant.direction, amount: `${Number(number[0].replace(/,/g, '')).toFixed(2)}`, transactionDate: date, transactionDateTime: date && time ? `${date}T${time}+07:00` : null, merchant: extract(variant.merchant), accountLast4: extract(variant.accountLast4), cardLast4: extract(variant.cardLast4), transactionReference: extract(variant.transactionReference), variantId: variant.id })
    }
    if (complete.length > 1) return { status: 'needs_review', reason: 'ambiguous_variant' }
    if (complete.length === 1) return { status: 'complete', value: complete[0] }
    return { status: 'needs_review', reason: 'no_variant_match' }
  }
  function profileAmountNumber(value) {
    const match = String(value ?? '').replace(/,/g, '').match(/[0-9]+(?:\.\d{1,2})?/)
    return match ? Number(match[0]) : null
  }
  function profileAmountMatches(result, candidate) {
    const resultAmount = profileAmountNumber(result?.value?.amount)
    const candidateAmount = profileAmountNumber(candidate?.value)
    return result?.status === 'complete' && resultAmount !== null && candidateAmount !== null && resultAmount === candidateAmount
  }
  return { normalizeProfileText, detectProfileCandidates, detectProfileAmountCandidates, validateProfileDraft, compileProfileVariant, compileProfileVariantRule, matchProfileRule, profileAmountMatches }
})
