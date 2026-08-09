/* Context-aware output encoding for HTML and inline JavaScript arguments. */
;(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.MTSafeRender = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const HTML_ENTITIES = Object.freeze({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => HTML_ENTITIES[char])
  }

  // Returns a JSON string literal that is safe inside a double-quoted HTML
  // event attribute. The browser decodes &quot; only after parsing the attribute,
  // while JSON keeps quotes, apostrophes, and line separators inside the value.
  function jsArg(value) {
    return JSON.stringify(String(value ?? ''))
      .replace(/&/g, '\\u0026')
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
      .replace(/"/g, '&quot;')
  }

  return Object.freeze({ escapeHtml, jsArg })
})
