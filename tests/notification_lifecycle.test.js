const test = require('node:test')
const assert = require('node:assert/strict')
const { notificationFixture, response } = require('./helpers/notification_fixture.js')

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
