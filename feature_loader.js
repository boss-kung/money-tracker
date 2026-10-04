/* Ordered, coalesced loader for optional feature modules. */
;(function (root) {
  'use strict'
  const release = root.MT_RELEASE || { version: '', deferredAssets: [] }
  const baseHref = /\/demo(?:\/|$)/.test(root.location?.pathname || '')
    ? new URL('../', root.location.href)
    : new URL('./', root.location.href)
  const assetByName = new Map((release.deferredAssets || []).map(asset => [String(asset).split('/').pop(), asset]))
  const groups = {
    notifications: ['notification_snapshot.js', 'notification_sync.js', 'notification_device_lifecycle.js', 'notifications_v2.js'],
    advanced: ['split_bill.js', 'loans_v2.js'],
    capture: ['quick_capture.js'],
    onboarding: ['onboarding.js'],
  }
  const states = new Map()
  const pending = new Map()
  const timeoutMs = 12000

  function groupAssets(group) {
    const names = groups[group]
    if (!names) throw new Error(`Unknown feature group: ${group}`)
    return names.map(name => assetByName.get(name) || `./${name}`)
  }

  function loadScript(asset) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      const url = new URL(asset.replace(/^\.\//, ''), baseHref)
      if (release.version) url.searchParams.set('v', release.version)
      script.async = false
      script.src = url.href
      const timer = setTimeout(() => {
        script.remove()
        reject(new Error(`Timed out loading ${asset}`))
      }, timeoutMs)
      script.onload = () => { clearTimeout(timer); resolve(asset) }
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error(`Failed loading ${asset}`)) }
      ;(document.head || document.documentElement).appendChild(script)
    })
  }

  function load(group) {
    if (states.get(group) === 'ready') return Promise.resolve(true)
    if (pending.get(group)) return pending.get(group)
    states.set(group, 'loading')
    const promise = groupAssets(group)
      .reduce((chain, asset) => chain.then(() => loadScript(asset)), Promise.resolve())
      .then(() => {
        states.set(group, 'ready')
        try { root.App?.requestRender?.(`feature-ready:${group}`) } catch (_) {}
        return true
      })
      .catch(error => { states.set(group, 'error'); throw error })
      .finally(() => pending.delete(group))
    pending.set(group, promise)
    return promise
  }

  function ready(group) {
    return states.get(group) === 'ready'
  }

  function schedule(groupsToLoad = Object.keys(groups)) {
    const run = () => groupsToLoad.reduce((chain, group) => chain.then(() => load(group).catch(() => false)), Promise.resolve())
    if (typeof root.requestIdleCallback === 'function') return root.requestIdleCallback(run, { timeout: 2500 })
    return root.setTimeout(run, 0)
  }

  root.MTFeatureLoader = Object.freeze({ load, ready, schedule, groups: Object.freeze(groups) })
})(typeof window !== 'undefined' ? window : globalThis)
