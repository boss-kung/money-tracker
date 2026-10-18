const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const config = read('supabase/config.toml')
const manage = read('supabase/functions/manage-shortcut-tokens/index.ts')
const ingest = read('supabase/functions/ingest-shortcut-capture/index.ts')
const inbox = read('supabase/functions/shortcut-inbox/index.ts')
const migration = read('supabase/migrations/202610180001_shortcut_transaction_inbox.sql')
const manifest = require('../release_manifest.js')

test('only the public ingestion edge function disables gateway JWT verification', () => {
  assert.match(config, /\[functions\.ingest-shortcut-capture\][\s\S]*verify_jwt\s*=\s*false/)
  assert.match(config, /\[functions\.manage-shortcut-tokens\][\s\S]*verify_jwt\s*=\s*true/)
  assert.match(config, /\[functions\.shortcut-inbox\][\s\S]*verify_jwt\s*=\s*true/)
})

test('authenticated handlers resolve the user before creating a privileged client', () => {
  assert.match(manage, /const userId = await deps\.requireUser\(req\)[\s\S]{0,120}const supabase = deps\.createAdminClient\(\)/)
  assert.match(inbox, /const userId = await deps\.requireUser\(req\)[\s\S]{0,120}const supabase = deps\.createAdminClient\(\)/)
  assert.match(manage, /requireAuthenticatedUserId/)
  assert.match(inbox, /requireAuthenticatedUserId/)
})

test('client and database surfaces do not expose service-role access or capture payload logs', () => {
  for (const file of ['shortcut_capture.js', 'shortcut_capture_core.js', 'quick_capture.js']) {
    assert.doesNotMatch(read(file), /service[_-]?role|SUPABASE_SERVICE_ROLE_KEY/i)
  }
  assert.match(migration, /revoke all on table public\.mt_shortcut_tokens from public, anon, authenticated/i)
  assert.match(migration, /revoke all on table public\.mt_shortcut_captures from public, anon, authenticated/i)
  for (const source of [ingest, manage, inbox]) {
    assert.doesNotMatch(source, /console\.(?:log|info|warn|error|debug)\([^\n]*(?:raw_text|relevant_text|capture|ciphertext)/i)
  }
})

test('release is pinned to the shortcut inbox contract version', () => {
  assert.equal(manifest.version, '2026.10.18-shortcut-inbox-r143')
})
