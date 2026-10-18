const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('account-delete migration removes orphan notification rows and enforces cascade ownership', () => {
  const migrationPath = 'supabase/migrations/202610060001_notification_account_delete_cascade.sql'
  assert.ok(fs.existsSync(path.join(root, migrationPath)), 'missing account-delete cascade migration')
  const sql = read(migrationPath).toLowerCase()
  for (const table of [
    'mt_notification_devices',
    'mt_notification_preferences',
    'mt_notification_snapshots',
    'mt_notification_rules',
    'mt_notification_logs',
  ]) {
    assert.match(sql, new RegExp(`delete\\s+from\\s+public\\.${table}\\s+where\\s+user_id\\s+is\\s+null`), `${table} orphan cleanup missing`)
    assert.match(sql, new RegExp(`${table}[\\s\\S]*?user_id[\\s\\S]*?on\\s+delete\\s+cascade`), `${table} cascade FK missing`)
    assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${table}[\\s\\S]*?user_id[\\s\\S]*?not\\s+null`), `${table} non-null ownership missing`)
  }
})

test('delete-account explicitly cleans owned rows before deleting auth user', () => {
  const source = read('supabase/functions/delete-account/index.ts')
  const deleteUserAt = source.indexOf('admin.auth.admin.deleteUser(userId)')
  assert.ok(deleteUserAt > 0, 'auth delete call missing')
  const cleanupBlock = source.slice(0, deleteUserAt)
  assert.match(cleanupBlock, /for \(const table of \[/)
  assert.match(cleanupBlock, /\.from\(table\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\('user_id', userId\)/)
  for (const table of [
    'mt_notification_logs',
    'mt_notification_rules',
    'mt_notification_snapshots',
    'mt_notification_preferences',
    'mt_notification_devices',
    'mt_user_vaults',
    'mt_delete_otps',
  ]) {
    const cleanupAt = cleanupBlock.indexOf(`'${table}'`)
    assert.ok(cleanupAt >= 0 && cleanupAt < deleteUserAt, `${table} cleanup must precede auth deletion`)
  }
})

test('notification cron queries fail closed for null-owner rows', () => {
  const daily = read('supabase/functions/send-daily-expense-reminders/index.ts')
  assert.match(daily, /\.not\('user_id',\s*'is',\s*null\)/)

  const custom = read('supabase/functions/send-custom-notification-rules/index.ts')
  assert.match(custom, /\.not\('user_id',\s*'is',\s*null\)/g)
  assert.ok((custom.match(/\.not\('user_id',\s*'is',\s*null\)/g) || []).length >= 3, 'custom cron must filter devices, rules, and snapshots')
})
