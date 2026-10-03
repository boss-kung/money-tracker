const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
function authFixture() {
  const store = new Map(), events = []
  const gate = { innerHTML: '', querySelector: () => null, remove() {} }
  const context = {
    console, URL, URLSearchParams, TextEncoder, Event, Date,
    location: { href: 'https://app.example/', hash: '', search: '', reload() {} },
    document: { title: 'Test', documentElement: { classList: { add() {}, remove() {} } }, getElementById: id => id === 'mt-auth-gate' ? gate : null,
      querySelector: () => null, addEventListener() {}, body: { appendChild() {} }, createElement: () => gate },
    localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    setTimeout: () => 0, clearTimeout() {}, addEventListener() {}, dispatchEvent: event => { events.push({ type: event.type, userId: context.MTAuthSync.state.user?.id || null }) },
    MT_SUPABASE_URL: 'https://test.supabase.example', MT_SUPABASE_ANON_KEY: 'anon',
    // Keep the non-awaited refresh pending so this test isolates cached restoration.
    fetch: () => new Promise(() => {}),
  }
  context.window = context
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../auth_sync.js'), 'utf8'), context)
  return { context, store, events }
}
test('cached authentication restore publishes a ready-user event for late notification boot', async () => {
  const f = authFixture()
  f.store.set('mt_auth_sync_state', JSON.stringify({ accessToken: 'cached-token', refreshToken: 'refresh-token', expiresAt: Math.floor(Date.now() / 1000) + 3600, userId: 'user-a', email: 'test@example.com' }))
  await f.context.MTAuthSync.initAuthSync()
  assert.ok(f.events.some(e => e.type === 'mt:auth-state-changed' && e.userId === 'user-a'))
})
test('sign-out publishes state change after clearing the current user', async () => {
  const f = authFixture()
  f.context.MTAuthSync.state.user = { id: 'user-a' }
  f.context.MTAuthSync.state.session = { access_token: 'token-a' }
  await f.context.MTAuthSync.signOut({ clearLocalData: false })
  assert.deepEqual(f.events, [{ type: 'mt:auth-state-changed', userId: null }])
})
