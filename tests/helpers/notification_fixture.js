const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '../..')
function notificationFixture({ enabled = true, permission = 'granted', authenticated = true, subscription = undefined, fetch: fetchOverride } = {}) {
  const store = new Map(), calls = [], messages = [], listeners = new Map(), timeouts = new Map()
  let timerId = 0, afterCommit = () => {}, serverRegistered = false
  const sub = subscription === undefined ? { endpoint: 'https://push.example/device', keys: { p256dh: 'test-key', auth: 'test-auth' } } : subscription
  const pushManager = {
    getSubscription: async () => sub && ({ toJSON: () => sub, unsubscribe: async () => { throw new Error('Existing subscription must be reused') } }),
    subscribe: async () => ({ toJSON: () => ({ endpoint: 'https://push.example/new', keys: { p256dh: 'new-key', auth: 'new-auth' } }) }),
  }
  const localStorage = {
    getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key), get length() { return store.size }, key: index => [...store.keys()][index],
  }
  localStorage.setItem('mt_notification_install_id', 'install-a')
  const context = {
    console, performance, AbortController, Intl, URLSearchParams, atob,
    setTimeout: (fn, delay) => { timeouts.set(++timerId, { fn, delay }); return timerId },
    clearTimeout: id => timeouts.delete(id), setInterval: () => ++timerId,
    S: { settings: { notifications: { enabled, seededDefaultRuleV1: true, routedByTriggerV1: true, customRules: [] } }, wallets: [], transactions: [] },
    App: {}, localStorage, Notification: { permission, requestPermission: async () => 'granted' }, PushManager: function () {},
    navigator: { onLine: true, userAgent: 'test-browser', platform: 'Mac', serviceWorker: { ready: Promise.resolve({ pushManager }) } },
    document: { visibilityState: 'visible' }, location: { protocol: 'https:', hash: '', search: '' },
    persist: () => afterCommit(), getStateCommit: () => ({ addAfterCommit: fn => { afterCommit = fn } }),
    toast: (message, type) => messages.push({ message, type }),
    MTSafeRender: require('../../safe_render.js'), MTScreenHooks: { register() {} },
    MT_SUPABASE_URL: 'https://test.supabase.example', MT_SUPABASE_ANON_KEY: 'test-anon-key', MT_FCM_VAPID_KEY: 'AQID',
    MTAuthSync: { state: { user: authenticated ? { id: 'user-a' } : null, session: authenticated ? { access_token: 'user-token-a' } : null } },
    addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn) },
  }
  context.window = context
  context.fetch = async (url, options) => {
    const name = url.split('/').at(-1), payload = JSON.parse(options.body)
    const call = { name, payload, headers: options.headers }; calls.push(call)
    if (fetchOverride) return fetchOverride(call, context)
    if (name === 'register-notification-device') serverRegistered = true
    if (!serverRegistered) return response(403, { error: 'Notification device is not registered' })
    return response(200, { ok: true, accepted: true, revision: payload.snapshotRevision })
  }
  vm.createContext(context)
  for (const file of ['notification_snapshot.js', 'notification_sync.js', 'notification_device_lifecycle.js']) {
    const target = path.join(root, file)
    if (fs.existsSync(target)) vm.runInContext(fs.readFileSync(target, 'utf8'), context, { filename: file })
  }
  const source = fs.readFileSync(path.join(root, 'notifications_v2.js'), 'utf8')
  // Expose the actual IIFE functions at the test seam without shipping test-only exports.
  const seam = 'globalThis.testNotifications = {callFunction,syncCustomRules,syncSnapshot,enableNotifications,disableNotifications,runBackgroundNotificationSync,captureScope:typeof captureNotificationScope === "function"?captureNotificationScope:null};'
  vm.runInContext(source.replace(/\}\)\(\)\s*$/, `${seam}})()`), context, { filename: 'notifications_v2.js' })
  return { context, calls, messages, store, pushManager, timeouts, commit: () => afterCommit(),
    emit: name => { for (const fn of listeners.get(name) || []) fn({}) } }
}
function response(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body } }
async function settle() { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
module.exports = { notificationFixture, response, settle }
