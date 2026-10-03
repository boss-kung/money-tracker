const test = require('node:test')
const assert = require('node:assert/strict')
const { notificationFixture, response, settle } = require('./helpers/notification_fixture.js')

test('transport preserves missing-device error identity for safe recovery', async () => {
  for (const body of [{ error: 'Notification device is not registered' }, { error: 'Notification device is not registered', code: 'DEVICE_NOT_REGISTERED' }]) {
    const f = notificationFixture({ fetch: () => response(403, body) })
    await assert.rejects(f.context.testNotifications.callFunction('sync-notification-rules', { installId: 'install-a' }), error => {
      assert.equal(error.status, 403)
      assert.equal(error.code, 'DEVICE_NOT_REGISTERED')
      assert.equal(error.functionName, 'sync-notification-rules')
      return true
    })
  }
})

test('transport keeps ownership rejection distinct from a missing device', async () => {
  const f = notificationFixture({ fetch: () => response(403, { error: 'Notification device belongs to another user', code: 'DEVICE_OWNERSHIP_MISMATCH' }) })
  await assert.rejects(f.context.testNotifications.callFunction('sync-notification-rules', { installId: 'install-a' }), error => {
    assert.equal(error.status, 403); assert.equal(error.code, 'DEVICE_OWNERSHIP_MISMATCH'); return true
  })
})

test('transport refuses anonymous notification mutations', async () => {
  const f = notificationFixture({ authenticated: false })
  await assert.rejects(f.context.testNotifications.callFunction('sync-notification-rules', { installId: 'install-a' }), error => error.code === 'UNAUTHORIZED')
  assert.equal(f.calls.length, 0)
})

test('captured old-account scope cannot dispatch a notification mutation', async () => {
  const f = notificationFixture()
  const oldScope = { userId: 'user-a', installId: 'install-a', accessToken: 'user-token-a', key: 'user-a:install-a' }
  f.context.MTAuthSync.state = { user: { id: 'user-b' }, session: { access_token: 'user-token-b' } }
  await assert.rejects(f.context.testNotifications.callFunction('sync-notification-rules', { installId: 'install-a' }, { scope: oldScope }), error => error.code === 'SCOPE_CHANGED')
  assert.equal(f.calls.length, 0)
})

async function syncBoth(f) {
  return Promise.all([f.context.testNotifications.syncSnapshot({ force: true }), f.context.testNotifications.syncCustomRules({ force: true })])
}

test('reload registers existing browser subscription and preferences before both sync paths', async () => {
  const f = notificationFixture()
  f.store.set('mt_notification_push_sub', JSON.stringify({ endpoint: 'https://push.example/stale' }))
  await syncBoth(f)
  assert.deepEqual(f.calls.slice(0, 2).map(c => c.name), ['register-notification-device', 'update-notification-preferences'])
  assert.equal(f.calls.filter(c => c.name === 'register-notification-device').length, 1)
  assert.equal(f.calls[0].payload.pushSubscription.endpoint, 'https://push.example/device')
  assert.equal(f.calls[1].payload.preferences.daily_expense_enabled, false)
  assert.equal(f.context.App.notificationSnapshotStatus.dirty, false)
})

test('delayed registration blocks both sync paths and commit debounce', async () => {
  let release
  const f = notificationFixture({ fetch: async c => {
    if (c.name === 'register-notification-device') await new Promise(resolve => { release = resolve })
    return response(200, { ok: true, accepted: true, revision: c.payload.snapshotRevision })
  } })
  const pending = syncBoth(f)
  await settle()
  f.commit()
  for (const timer of [...f.timeouts.values()]) if (timer.delay === 1000) timer.fn()
  await settle()
  assert.deepEqual(f.calls.map(c => c.name), ['register-notification-device'])
  release(); await pending; await settle()
  assert.equal(f.calls.filter(c => c.name === 'register-notification-device').length, 1)
  assert.ok(f.calls.find(c => c.name === 'sync-notification-rules'))
  assert.ok(f.calls.find(c => c.name === 'sync-notification-snapshot'))
})

test('failed activation does not persist a confirmed enabled state or send dependent sync', async () => {
  const f = notificationFixture({ enabled: false, fetch: () => response(500, { error: 'Registration unavailable' }) })
  await assert.rejects(f.context.testNotifications.enableNotifications(), /Registration unavailable/)
  assert.equal(f.context.S.settings.notifications.enabled, false)
  assert.deepEqual(f.calls.map(c => c.name), ['register-notification-device'])
  assert.equal(f.context.Notification.permission, 'granted')
})

test('activation reuses subscription and enables only after registration success', async () => {
  let release
  const f = notificationFixture({ enabled: false, fetch: async c => {
    if (c.name === 'register-notification-device') await new Promise(resolve => { release = resolve })
    return response(200, { ok: true, accepted: true, revision: c.payload.snapshotRevision })
  } })
  const pending = f.context.testNotifications.enableNotifications()
  await settle()
  assert.equal(f.context.S.settings.notifications.enabled, false)
  assert.equal(f.calls[0].payload.pushSubscription.endpoint, 'https://push.example/device')
  release(); assert.equal(await pending, true)
  assert.equal(f.context.S.settings.notifications.enabled, true)
  assert.ok(f.messages.some(m => m.type === 'success'))
})

for (const [name, options] of [['disabled with granted permission', { enabled: false }], ['signed out', { authenticated: false }], ['permission denied', { permission: 'denied' }]]) {
  test(`${name} skips both sync paths and manual action cannot report success`, async () => {
    const f = notificationFixture(options)
    await syncBoth(f)
    await f.context.App.syncAllNotificationData(); await settle()
    assert.equal(f.calls.length, 0)
    assert.equal(f.messages.some(m => m.type === 'success'), false)
  })
}

test('offline commit stays pending and resumes with registration when online', async () => {
  const f = notificationFixture()
  f.context.navigator.onLine = false
  f.commit(); await f.context.testNotifications.syncSnapshot({ force: true })
  assert.equal(f.calls.length, 0)
  assert.equal(f.context.App.notificationSnapshotStatus.dirty, true)
  f.context.navigator.onLine = true
  await syncBoth(f)
  assert.equal(f.context.App.notificationSnapshotStatus.dirty, false)
})

test('cached JSON cannot register without an actual browser subscription', async () => {
  const f = notificationFixture({ subscription: null })
  f.store.set('mt_notification_push_sub', JSON.stringify({ endpoint: 'https://push.example/stale' }))
  const results = await Promise.allSettled([f.context.testNotifications.syncSnapshot({ force: true }), f.context.testNotifications.syncCustomRules({ force: true })])
  assert.equal(f.calls.length, 0)
  assert.ok(results.every(r => r.status === 'rejected' && r.reason.code === 'NOTIFICATION_SYNC_SKIPPED'))
  assert.equal(f.context.App.notificationDeviceStatus.reason, 'subscription-required')
})

test('known missing device is re-registered and retried once after prior success', async () => {
  let exists = false, deletes = 0
  const f = notificationFixture({ fetch: c => {
    if (c.name === 'register-notification-device') exists = true
    if (c.name === 'sync-notification-rules' && deletes++ === 1) exists = false
    if (!exists) return response(403, { error: 'Notification device is not registered' })
    return response(200, { ok: true, accepted: true, revision: c.payload.snapshotRevision })
  } })
  await f.context.testNotifications.syncCustomRules({ force: true })
  await f.context.testNotifications.syncCustomRules({ force: true })
  assert.equal(f.calls.filter(c => c.name === 'register-notification-device').length, 2)
  assert.equal(f.calls.filter(c => c.name === 'sync-notification-rules').length, 3)
})

test('persistent missing device stops after one recovery and throttles automatic repeats', async () => {
  const f = notificationFixture({ fetch: c => c.name.startsWith('sync-')
    ? response(403, { error: 'Notification device is not registered', code: 'DEVICE_NOT_REGISTERED' })
    : response(200, { ok: true }) })
  await assert.rejects(f.context.testNotifications.syncCustomRules({ force: true }), /not registered/)
  const firstCount = f.calls.length
  assert.equal(f.calls.filter(c => c.name === 'register-notification-device').length, 2)
  assert.equal(f.calls.filter(c => c.name === 'sync-notification-rules').length, 2)
  await assert.rejects(f.context.testNotifications.syncCustomRules({ force: true }), /not registered/)
  assert.equal(f.calls.length, firstCount)
})

test('ownership rejection never triggers registration recovery', async () => {
  const f = notificationFixture({ fetch: c => c.name === 'sync-notification-rules'
    ? response(403, { error: 'Notification device belongs to another user', code: 'DEVICE_OWNERSHIP_MISMATCH' })
    : response(200, { ok: true }) })
  await assert.rejects(f.context.testNotifications.syncCustomRules({ force: true }), error => error.code === 'DEVICE_OWNERSHIP_MISMATCH')
  const firstCount = f.calls.length
  await assert.rejects(f.context.testNotifications.syncCustomRules({ force: true }))
  assert.equal(f.calls.length, firstCount)
  assert.equal(f.calls.filter(c => c.name === 'register-notification-device').length, 1)
})

for (const changed of ['account', 'install', 'signout']) {
  test(`${changed} during registration cannot send stale financial state or success markers`, async () => {
    let release
    const f = notificationFixture({ fetch: async c => {
      if (c.name === 'register-notification-device') await new Promise(resolve => { release = resolve })
      return response(200, { ok: true, accepted: true, revision: c.payload.snapshotRevision })
    } })
    const pending = Promise.allSettled([f.context.testNotifications.syncSnapshot({ force: true }), f.context.testNotifications.syncCustomRules({ force: true })])
    await settle()
    assert.equal(typeof release, 'function', 'registration must start before synchronization')
    if (changed === 'account') f.context.MTAuthSync.state = { user: { id: 'user-b' }, session: { access_token: 'user-token-b' } }
    if (changed === 'install') f.store.set('mt_notification_install_id', 'install-b')
    if (changed === 'signout') f.context.MTAuthSync.state = { user: null, session: null }
    f.context.App.notificationSnapshotStatus = { sentinel: 'current-account' }
    release(); await pending
    assert.deepEqual(f.calls.map(c => c.name), ['register-notification-device'])
    assert.equal(f.context.App.notificationSnapshotStatus.sentinel, 'current-account')
    assert.equal([...f.store.keys()].some(k => k.startsWith('mt_notification_last_rules_sync')), false)
  })
}

test('identical rules are uploaded for a new account instead of adopting global TTL', async () => {
  const f = notificationFixture()
  await f.context.testNotifications.syncCustomRules()
  f.context.MTAuthSync.state = { user: { id: 'user-b' }, session: { access_token: 'user-token-b' } }
  f.store.set('mt_notification_install_id', 'install-b')
  f.emit('mt:auth-state-changed')
  await f.context.testNotifications.syncCustomRules()
  assert.deepEqual(f.calls.filter(c => c.name === 'sync-notification-rules').map(c => c.payload.userId), ['user-a', 'user-b'])
  assert.ok(f.store.has('mt_notification_last_rules_sync:user-a:install-a'))
  assert.ok(f.store.has('mt_notification_last_rules_sync:user-b:install-b'))
})

test('auth completion after boot schedules notification recovery', async () => {
  const f = notificationFixture({ authenticated: false })
  f.context.testNotifications.runBackgroundNotificationSync(); await settle()
  assert.equal(f.calls.length, 0)
  f.context.MTAuthSync.state = { user: { id: 'user-a' }, session: { access_token: 'user-token-a' } }
  f.emit('mt:auth-state-changed')
  assert.ok([...f.timeouts.values()].some(t => t.delay === 1000))
  for (const t of [...f.timeouts.values()]) if (t.delay === 1000) t.fn()
  for (const t of [...f.timeouts.values()]) if (t.delay === 1200) t.fn()
  await settle()
  assert.ok(f.calls.find(c => c.name === 'register-notification-device'))
  assert.ok(f.calls.find(c => c.name === 'sync-notification-snapshot'))
})

test('manual sync reports partial failure rather than success', async () => {
  const f = notificationFixture({ fetch: c => c.name === 'sync-notification-snapshot'
    ? response(500, { error: 'Snapshot unavailable' })
    : response(200, { ok: true }) })
  await f.context.App.syncAllNotificationData(); await settle()
  assert.equal(f.messages.some(m => m.type === 'success'), false)
  assert.ok(f.messages.some(m => m.type === 'error' && /Snapshot unavailable/.test(m.message)))
  assert.equal(f.context.App.notificationSnapshotStatus.dirty, true)
})

test('disable waits for pending registration so a late enable cannot leave the server enabled', async () => {
  let release, serverEnabled = false
  const f = notificationFixture({ fetch: async c => {
    if (c.name === 'register-notification-device') {
      if (c.payload.enabled) await new Promise(resolve => { release = resolve })
      serverEnabled = c.payload.enabled
    }
    return response(200, { ok: true, accepted: true, revision: c.payload.snapshotRevision })
  } })
  const pending = f.context.testNotifications.syncSnapshot({ force: true }).catch(() => false)
  await settle(); assert.equal(typeof release, 'function')
  const disabled = f.context.testNotifications.disableNotifications()
  await settle()
  assert.equal(f.calls.some(c => c.name === 'register-notification-device' && c.payload.enabled === false), false)
  release(); await pending; assert.equal(await disabled, true)
  assert.equal(serverEnabled, false)
  assert.equal(f.context.S.settings.notifications.enabled, false)
  assert.equal(f.calls.some(c => c.name === 'sync-notification-snapshot'), false)
})

test('new activation can create a browser subscription and register it', async () => {
  const f = notificationFixture({ enabled: false, permission: 'default', subscription: null })
  assert.equal(await f.context.testNotifications.enableNotifications(), true)
  assert.equal(f.calls[0].payload.pushSubscription.endpoint, 'https://push.example/new')
  assert.equal(f.context.S.settings.notifications.enabled, true)
})

test('registration failure is visible instead of a confirmed enabled status', async () => {
  const f = notificationFixture({ fetch: () => response(500, { error: 'Registration unavailable' }) })
  await assert.rejects(f.context.testNotifications.syncCustomRules({ force: true }))
  assert.notEqual(f.context.testNotifications.statusLabel(), 'เปิดแล้ว')
})

test('unready service worker times out registration without sending cloud data', async () => {
  const f = notificationFixture()
  f.context.navigator.serviceWorker.ready = new Promise(() => {})
  const pending = f.context.testNotifications.syncCustomRules({ force: true })
  const outcome = pending.then(() => 'unexpected-success', error => error.code)
  await settle()
  const timers = [...f.timeouts.values()].filter(t => t.delay === 10000)
  assert.ok(timers.length, 'browser subscription lookup must have a deadline')
  for (const timer of timers) timer.fn()
  assert.equal(await outcome, 'SUBSCRIPTION_UNAVAILABLE')
  assert.equal(f.calls.length, 0)
})
