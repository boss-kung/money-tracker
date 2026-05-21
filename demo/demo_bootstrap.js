;(function () {
  'use strict'

  window.MT_DEMO_MODE = true
  window.MT_DEMO_STORAGE_PREFIX = 'mt_demo__'

  const prefix = window.MT_DEMO_STORAGE_PREFIX
  const storage = window.localStorage
  if (!storage || storage.__mtDemoPatched) return

  const raw = {
    getItem: storage.getItem.bind(storage),
    setItem: storage.setItem.bind(storage),
    removeItem: storage.removeItem.bind(storage),
    key: storage.key.bind(storage),
    clear: storage.clear.bind(storage),
  }

  const shouldPrefix = key => {
    const value = String(key || '')
    return value.startsWith('mt_') || value === 'MT_GOLD_PROXY_URL'
  }
  const toDemoKey = key => {
    const value = String(key || '')
    return shouldPrefix(value) && !value.startsWith(prefix) ? `${prefix}${value}` : value
  }

  storage.getItem = key => raw.getItem(toDemoKey(key))
  storage.setItem = (key, value) => raw.setItem(toDemoKey(key), value)
  storage.removeItem = key => raw.removeItem(toDemoKey(key))
  storage.key = index => raw.key(index)
  storage.clear = () => {
    const keys = []
    for (let i = 0; i < storage.length; i += 1) {
      const key = raw.key(i)
      if (key && key.startsWith(prefix)) keys.push(key)
    }
    keys.forEach(key => raw.removeItem(key))
  }

  Object.defineProperty(storage, '__mtDemoPatched', { value: true })

  window.MTDemoStorage = {
    prefix,
    raw,
    toDemoKey,
    removeDemoKeys() {
      const keys = []
      for (let i = 0; i < storage.length; i += 1) {
        const key = raw.key(i)
        if (key && key.startsWith(prefix)) keys.push(key)
      }
      keys.forEach(key => raw.removeItem(key))
    },
  }
})()
