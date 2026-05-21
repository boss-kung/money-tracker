;(function () {
  'use strict'

  window.MT_DEMO_MODE = true
  window.MT_DEMO_STORAGE_DISABLED = true

  const memory = new Map()
  const demoStorage = {
    get length() { return memory.size },
    key(index) { return Array.from(memory.keys())[Number(index) || 0] || null },
    getItem(key) {
      key = String(key || '')
      return memory.has(key) ? memory.get(key) : null
    },
    setItem(key, value) {
      memory.set(String(key || ''), String(value))
    },
    removeItem(key) {
      memory.delete(String(key || ''))
    },
    clear() {
      memory.clear()
    },
  }

  try {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      enumerable: true,
      value: demoStorage,
    })
  } catch (_) {
    window.MT_DEMO_STORAGE_DISABLED = false
  }

  window.MTDemoStorage = { memory, removeDemoKeys() { memory.clear() } }
})()
