const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

test('user vault migration enables owner-only RLS policies', () => {
  const migrationPath = path.join(root, 'supabase/migrations/202606040001_secure_user_vaults.sql')
  const sql = fs.readFileSync(migrationPath, 'utf8')

  assert.match(sql, /create table if not exists public\.mt_user_vaults/i)
  assert.match(sql, /user_id uuid not null references auth\.users\(id\)/i)
  assert.match(sql, /alter table public\.mt_user_vaults enable row level security/i)
  assert.match(sql, /to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\)/i)
  assert.match(sql, /to authenticated\s+with check \(\(select auth\.uid\(\)\) = user_id\)/i)
  assert.doesNotMatch(sql, /\btransactions\b|\bwallets\b|\bamount\b|\bmerchant\b/i)
})

test('auth sync module enforces google-only sessions and does not store plaintext vault data', () => {
  const source = fs.readFileSync(path.join(root, 'auth_sync.js'), 'utf8')

  assert.match(source, /provider:\s*'google'/)
  assert.match(source, /code_challenge_method', 'S256'/)
  assert.match(source, /grant_type=pkce/)
  assert.match(source, /auth_code/)
  assert.match(source, /isGoogleSession/)
  assert.match(source, /mt_user_vaults/)
  assert.match(source, /ciphertext/)
  assert.match(source, /state\.locked = row \? true : !state\.dataKey/)
  assert.match(source, /function needsVaultUnlock\(\)/)
  assert.match(source, /data-mt-auth-action="\$\{needsUnlock \? 'unlock' : 'sync'\}"/)
  assert.match(source, /debugSnapshot/)
  assert.doesNotMatch(source, /\.from\('mt_user_vaults'\)[\s\S]{0,500}(transactions|wallets|amount|merchant)/i)
})
