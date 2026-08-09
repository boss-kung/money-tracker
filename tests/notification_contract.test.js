const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('Web Push schema matches the device upsert contract', () => {
  const migration = read('supabase/migrations/202608090001_notification_delivery_contract.sql')
  assert.match(migration, /add column if not exists push_subscription jsonb/i)
  assert.match(migration, /alter column fcm_token drop not null/i)
  assert.match(migration, /unique index if not exists mt_notification_devices_install_id_uidx/i)
  assert.match(migration, /notification rules[\s\S]*for all to authenticated/i)
})

test('notification mutation functions require a user and installation ownership', () => {
  for (const name of [
    'register-notification-device',
    'sync-notification-rules',
    'sync-notification-snapshot',
    'update-notification-preferences',
  ]) {
    const source = read(`supabase/functions/${name}/index.ts`)
    assert.match(source, /requireAuthenticatedUserId\(req\)/, name)
    assert.match(source, /requireInstallOwnership\(/, name)
  }
})

test('notification delivery functions authenticate cron before creating admin client', () => {
  for (const name of ['send-daily-expense-reminders', 'send-custom-notification-rules']) {
    const source = read(`supabase/functions/${name}/index.ts`)
    assert.ok(source.indexOf('requireCronSecret(req)') < source.indexOf('adminClient()'), name)
  }
  const cron = read('supabase/migrations/202608090002_secure_notification_cron.sql')
  assert.match(cron, /vault\.decrypted_secrets/)
  assert.match(cron, /x-mt-cron-secret/)
  assert.doesNotMatch(cron, /Bearer eyJ/)
})

test('Notification Snapshot transport sends the privacy-limited values that were built locally', () => {
  const source = read('notifications_v2.js')
  for (const field of [
    'todayTxCount',
    'lastTxDate',
    'upcomingBills',
    'creditDue',
    'budgetAlerts',
    'recurringDue',
    'privilegesExpiring',
  ]) {
    assert.match(source, new RegExp(`${field}: snapshot\\.${field}`), field)
  }
  assert.doesNotMatch(source, /todayTxCount:\s*0,[\s\S]{0,240}privilegesExpiring:\s*\[\]/)
})
