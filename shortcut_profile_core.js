/* Local-only compiler and matcher for user-defined notification profiles. */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.MTShortcutProfileCore = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'
  const LIMITS = { thb_amount: 64, date: 32, time: 16, text: 256, last4: 4, reference: 128 }
  function normalizeProfileText(value) { return String(value ?? '').normalize('NFKC').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US') }
  function detectProfileCandidates(text) {
    const normalized = normalizeProfileText(text); const result = []; let id = 0
    const add = (type, match, value, start, end) => result.push({ id: `candidate-${id++}`, type, value, start, end })
    for (const match of normalized.matchAll(/(?:thb|บาท|฿)?\s*[0-9][0-9,]*(?:\.\d{1,2})?/giu)) add('thb_amount', match[0].trim(), match[0].trim(), match.index, match.index + match[0].length)
    for (const match of normalized.matchAll(/\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\b/gu)) add('date', match[0], match[0], match.index, match.index + match[0].length)
    for (const match of normalized.matchAll(/\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/gu)) add('time', match[0], match[0], match.index, match.index + match[0].length)
    for (const match of normalized.matchAll(/\b\d{4}\b/gu)) add('last4', match[0], match[0], match.index, match.index + match[0].length)
    normalized.split(' ').forEach((value, index, words) => { if (value && !/^\d/.test(value) && value.length <= LIMITS.text) { const start = words.slice(0, index).join(' ').length + (index ? 1 : 0); add('text', value, value, start, start + value.length) } })
    return result
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
  return { normalizeProfileText, detectProfileCandidates, compileProfileVariant, compileProfileVariantRule, matchProfileRule }
})
